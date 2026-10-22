import { NextResponse } from 'next/server';
import { HttpError, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Admin "Lock & Sync to Tally": freezes voucher fields and queues the order for /api/tally/sync. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const ctx = await requireArea(req, 'operations');
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'INVALID_ORDER', 'Invalid order id');
  const order = unwrap(await ctx.admin.rpc('lock_order_for_tally', { p_order_id: params.id, p_actor: ctx.user.id }));
  return NextResponse.json({ order });
});
