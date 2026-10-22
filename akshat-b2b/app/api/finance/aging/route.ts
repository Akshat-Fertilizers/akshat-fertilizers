import { NextResponse } from 'next/server';
import { HttpError, requireArea, route, safeEqual, serviceClient, unwrap, bearerToken } from '@/lib/supabase-server';
import type { AgingBucket, AgingRow, Order } from '@/lib/types';
import { round2 } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Vercel Cron (Bearer CRON_SECRET) or an admin session. */
async function authorize(req: Request) {
  const secret = process.env.CRON_SECRET;
  const token = bearerToken(req);
  if (secret && token && safeEqual(token, secret)) return { actor: null as string | null, admin: serviceClient(), isCron: true };
  const ctx = await requireArea(req, 'finance');
  return { actor: ctx.user.id, admin: ctx.admin, isCron: false };
}

async function run(req: Request) {
  const { actor, admin, isCron } = await authorize(req);
  const asOfParam = new URL(req.url).searchParams.get('as_of');
  if (asOfParam && (!/^\d{4}-\d{2}-\d{2}$/.test(asOfParam) || isCron)) {
    throw new HttpError(400, 'INVALID_DATE', 'as_of must be YYYY-MM-DD (admin only)');
  }

  // Strip early discounts past due date + accrue 18% APY on >90-day bills (atomic, idempotent per date)
  const summary = unwrap(await admin.rpc('recalculate_aging', { p_as_of: asOfParam, p_actor: actor }));
  if (isCron) return NextResponse.json({ summary });

  const [rows, settled] = await Promise.all([
    admin.from('v_receivables_aging').select('*').order('due_date', { ascending: true }).limit(2000).then((r) => unwrap(r) as AgingRow[]),
    admin
      .from('orders')
      .select('*, buyer:users!orders_buyer_id_fkey(business_name, gstin, state, email)')
      .eq('payment_status', 'PAID')
      .order('paid_at', { ascending: false })
      .limit(200)
      .then((r) => unwrap(r) as Order[]),
  ]);

  const buckets: Record<AgingBucket, { count: number; balance: number }> = {
    CURRENT: { count: 0, balance: 0 },
    '1-30': { count: 0, balance: 0 },
    '31-60': { count: 0, balance: 0 },
    '61-90': { count: 0, balance: 0 },
    '90+': { count: 0, balance: 0 },
  };
  let totalInterest = 0;
  for (const r of rows) {
    buckets[r.bucket].count += 1;
    buckets[r.bucket].balance = round2(buckets[r.bucket].balance + Number(r.balance));
    totalInterest += Number(r.penalty_interest);
  }
  return NextResponse.json({
    summary,
    buckets,
    totals: {
      receivable: round2(rows.reduce((s, r) => s + Number(r.balance), 0)),
      penalty_interest: round2(totalInterest),
    },
    orders: rows,
    settled,
  });
}

export const GET = route(run);
export const POST = route(run);
