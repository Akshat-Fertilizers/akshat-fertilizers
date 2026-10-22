import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Action = 'WAIVE_INTEREST' | 'REAPPLY_DISCOUNT' | 'RECORD_PAYMENT';

export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'finance');
  const body = await readJson<{ order_id?: string; action?: Action; amount?: number; paid_on?: string; note?: string }>(req);
  if (!body.order_id || !UUID_RE.test(body.order_id)) throw new HttpError(400, 'INVALID_ORDER', 'order_id is required');
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  let order;
  switch (body.action) {
    case 'WAIVE_INTEREST':
      order = unwrap(await ctx.admin.rpc('waive_interest', { p_order_id: body.order_id, p_actor: ctx.user.id, p_note: note }));
      break;
    case 'REAPPLY_DISCOUNT':
      order = unwrap(await ctx.admin.rpc('reapply_discount', { p_order_id: body.order_id, p_actor: ctx.user.id, p_note: note }));
      break;
    case 'RECORD_PAYMENT': {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'INVALID_AMOUNT', 'amount must be > 0');
      if (body.paid_on && !/^\d{4}-\d{2}-\d{2}$/.test(body.paid_on)) throw new HttpError(400, 'INVALID_DATE', 'paid_on must be YYYY-MM-DD');
      order = unwrap(
        await ctx.admin.rpc('record_payment', {
          p_order_id: body.order_id,
          p_amount: Math.round(amount * 100) / 100,
          p_actor: ctx.user.id,
          p_paid_on: body.paid_on ?? null,
          p_note: note,
        }),
      );
      break;
    }
    default:
      throw new HttpError(400, 'INVALID_ACTION', 'action must be WAIVE_INTEREST | REAPPLY_DISCOUNT | RECORD_PAYMENT');
  }
  return NextResponse.json({ order });
});
