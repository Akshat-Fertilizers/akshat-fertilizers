import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, safeEqual, serviceClient, unwrap } from '@/lib/supabase-server';
import { buildEnvelope, tallyConfigFromEnv, type TallyOrder } from '@/lib/tally';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Tally connector authenticates with x-api-key; admins may also pull/preview with their session. */
async function authorize(req: Request) {
  const key = process.env.TALLY_SYNC_API_KEY;
  const given = req.headers.get('x-api-key');
  if (key && given && safeEqual(given, key)) return serviceClient();
  if (given) throw new HttpError(401, 'INVALID_API_KEY', 'Invalid Tally API key');
  return (await requireAdmin(req)).admin;
}

/**
 * GET /api/tally/sync[?format=json&limit=100]
 * Returns ONLY orders with is_locked_for_tally = true AND tally_synced = false
 * (Tally Prime Edit Log 7.1: vouchers are pushed once, from immutable data).
 * Read-only: call POST to acknowledge after Tally imports successfully.
 */
export const GET = route(async (req) => {
  const admin = await authorize(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);

  const orders = unwrap(
    await admin
      .from('orders')
      .select(
        'id, order_no, purchase_date, ship_to_state, subtotal, freight, gst_amount, base_amount, locked_at,' +
          'buyer:users!orders_buyer_id_fkey(business_name, gstin, state),' +
          'godown:godowns(name, state),' +
          'order_items(sku, product_name, unit, qty, unit_price, line_total, gst_amount)',
      )
      .eq('is_locked_for_tally', true)
      .eq('tally_synced', false)
      .order('locked_at', { ascending: true })
      .limit(limit),
  ) as unknown as TallyOrder[];

  const ids = orders.map((o) => o.id);
  if (url.searchParams.get('format') === 'json') return NextResponse.json({ count: orders.length, order_ids: ids, orders });

  return new NextResponse(buildEnvelope(orders, tallyConfigFromEnv()), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `inline; filename="tally-vouchers-${new Date().toISOString().slice(0, 10)}.xml"`,
      'X-Voucher-Count': String(orders.length),
      'X-Order-Ids': ids.join(','),
      'Cache-Control': 'no-store',
    },
  });
});

/** POST /api/tally/sync  { "order_ids": [...] } — acknowledge successful import. */
export const POST = route(async (req) => {
  const admin = await authorize(req);
  const body = await readJson<{ order_ids?: unknown }>(req);
  const ids = Array.isArray(body.order_ids) ? body.order_ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  if (!ids.length || ids.length > 500) throw new HttpError(400, 'INVALID_IDS', 'order_ids must contain 1–500 UUIDs');
  const marked = unwrap(await admin.rpc('mark_tally_synced', { p_order_ids: ids }));
  return NextResponse.json({ marked });
});
