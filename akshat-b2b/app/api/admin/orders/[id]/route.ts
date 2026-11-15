import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUSES = ['RECEIVED', 'CONFIRMED_OFFLINE', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;

/** Operations: update an order's fulfilment status. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const ctx = await requireArea(req, 'operations');
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'INVALID_ORDER', 'Invalid order id');
  const { status } = await readJson<{ status?: string }>(req);
  if (!status || !(STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, 'INVALID_STATUS', `status must be one of ${STATUSES.join(', ')}`);
  }
  const order = unwrap(await ctx.db.rpc('set_order_status', { p_order: params.id, p_status: status }));
  return NextResponse.json({ order });
});
