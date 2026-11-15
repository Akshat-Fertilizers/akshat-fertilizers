import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Finance: >90-day overdue interest controls.
 *  { action: 'RECALC', apy? }                 -> recompute across all overdue dealer credit orders
 *  { action: 'SET', order_id, amount }        -> manual override on one order
 */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'finance');
  const b = await readJson<{ action?: string; apy?: number; order_id?: string; amount?: number }>(req);

  if (b.action === 'RECALC') {
    const apy = b.apy == null ? 18 : Number(b.apy);
    if (!Number.isFinite(apy) || apy < 0 || apy > 100) throw new HttpError(400, 'INVALID_PCT', 'apy must be 0–100');
    const updated = unwrap(await ctx.db.rpc('recalc_overdue', { p_as_of: null, p_apy: apy }));
    return NextResponse.json({ updated });
  }
  if (b.action === 'SET') {
    if (!b.order_id || !UUID_RE.test(b.order_id)) throw new HttpError(400, 'INVALID_ORDER', 'order_id is required');
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'INVALID_AMOUNT', 'amount must be ≥ 0');
    const order = unwrap(await ctx.db.rpc('set_overdue_interest', { p_order: b.order_id, p_amount: Math.round(amount * 100) / 100 }));
    return NextResponse.json({ order });
  }
  throw new HttpError(400, 'INVALID_ACTION', 'action must be RECALC or SET');
});
