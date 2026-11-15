import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Finance: record an offline payment against an order (auto-recomputes outstanding + status). */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'finance');
  const b = await readJson<{ order_id?: string; amount?: number; mode?: string; note?: string }>(req);
  if (!b.order_id || !UUID_RE.test(b.order_id)) throw new HttpError(400, 'INVALID_ORDER', 'order_id is required');
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'INVALID_AMOUNT', 'amount must be greater than 0');
  const order = unwrap(
    await ctx.db.rpc('record_payment', {
      p_order: b.order_id,
      p_amount: Math.round(amount * 100) / 100,
      p_mode: typeof b.mode === 'string' ? b.mode.slice(0, 40) : null,
      p_note: typeof b.note === 'string' ? b.note.slice(0, 200) : null,
    }),
  );
  return NextResponse.json({ order });
});
