import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED = ['APPROVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;

export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const ctx = await requireArea(req, 'operations');
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'INVALID_ORDER', 'Invalid order id');
  const { status } = await readJson<{ status?: string }>(req);
  if (!status || !(ALLOWED as readonly string[]).includes(status)) {
    throw new HttpError(400, 'INVALID_STATUS', `status must be one of ${ALLOWED.join(', ')}`);
  }
  const order = unwrap(await ctx.admin.rpc('admin_set_order_status', { p_order_id: params.id, p_status: status, p_actor: ctx.user.id }));
  return NextResponse.json({ order });
});
