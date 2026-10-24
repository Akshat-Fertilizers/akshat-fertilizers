import { NextResponse } from 'next/server';
import { HttpError, readJson, requireUser, route, mapDbError } from '@/lib/supabase-server';
import { MIN_ORDER_VALUE } from '@/lib/business';
import { UUID_RE, round2 } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  items?: { product_id?: unknown; qty?: unknown }[];
  client_ref?: unknown;
  notes?: unknown;
}

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const { profile } = ctx;

  // 1. KYC gate
  if (profile.role !== 'buyer') throw new HttpError(403, 'ONLY_BUYERS_CAN_ORDER', 'Admin accounts cannot place orders');
  if (!profile.is_approved) throw new HttpError(403, 'KYC_NOT_APPROVED', 'Your account is pending KYC approval');
  if (!profile.godown_id) throw new HttpError(409, 'NO_GODOWN_ASSIGNED', 'No godown is mapped to your account yet');

  // 2. Shape validation + de-duplication
  const body = await readJson<Body>(req);
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw new HttpError(400, 'INVALID_ITEMS', 'items must be a non-empty array (max 100 lines)');
  }
  const merged = new Map<string, number>();
  for (const it of body.items) {
    const id = String(it?.product_id ?? '');
    const qty = Number(it?.qty);
    if (!UUID_RE.test(id) || !Number.isInteger(qty) || qty <= 0 || qty > 999_999) {
      throw new HttpError(400, 'INVALID_ITEMS', 'Each item needs a valid product_id and a positive integer qty');
    }
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  const items = Array.from(merged, ([product_id, qty]) => ({ product_id, qty }));
  const clientRef = typeof body.client_ref === 'string' && body.client_ref.length <= 64 ? body.client_ref : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  // 3. ₹50,000 minimum on authoritative DB prices (never trust client prices)
  const { data: products, error } = await ctx.admin
    .from('products')
    .select('id, price, is_active')
    .in('id', items.map((i) => i.product_id));
  if (error) throw mapDbError(error);
  const priceOf = new Map((products ?? []).filter((p) => p.is_active).map((p) => [p.id as string, Number(p.price)]));
  const missing = items.filter((i) => !priceOf.has(i.product_id));
  if (missing.length) throw new HttpError(422, 'PRODUCT_NOT_AVAILABLE', 'Some products are not available', missing);
  const subtotal = round2(items.reduce((s, i) => s + round2(i.qty * priceOf.get(i.product_id)!), 0));
  if (subtotal < MIN_ORDER_VALUE) {
    throw new HttpError(422, 'MIN_ORDER_VALUE_NOT_MET', `Minimum indent value is ₹50,000 (current subtotal ₹${subtotal.toLocaleString('en-IN')})`, {
      subtotal,
      minimum: MIN_ORDER_VALUE,
      shortfall: round2(MIN_ORDER_VALUE - subtotal),
    });
  }

  // 4. Atomic transaction: stock lock + deduction from the buyer's godown, freight, credit check
  const { data, error: rpcErr } = await ctx.db.rpc('create_b2b_order', {
    p_items: items,
    p_client_ref: clientRef,
    p_notes: notes,
  });
  if (rpcErr) throw mapDbError(rpcErr);

  return NextResponse.json({ order: data }, { status: data?.idempotent_replay ? 200 : 201 });
});
