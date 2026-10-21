import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Operations drawer "Mark as Settled": books the full remaining balance as received on `paid_on`
 * (discount / 18% interest recomputed for that date) and closes the invoice atomically.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const ctx = await requireAdmin(req);
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'INVALID_ORDER', 'Invalid order id');
  const b = await readJson<{ paid_on?: string; reference?: string; note?: string }>(req);
  if (b.paid_on && !/^\d{4}-\d{2}-\d{2}$/.test(b.paid_on)) throw new HttpError(400, 'INVALID_DATE', 'paid_on must be YYYY-MM-DD');
  const order = unwrap(
    await ctx.admin.rpc('settle_order', {
      p_order_id: params.id,
      p_actor: ctx.user.id,
      p_paid_on: b.paid_on || null,
      p_reference: typeof b.reference === 'string' ? b.reference.slice(0, 64) : null,
      p_note: typeof b.note === 'string' ? b.note.slice(0, 300) : null,
    }),
  );
  return NextResponse.json({ order });
});
