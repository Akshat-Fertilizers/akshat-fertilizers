import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

/** Manager-only: approve / reject a customer's offline KYC. */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'customers');
  const b = await readJson<{ user_id?: string; status?: string }>(req);
  if (!b.user_id || !UUID_RE.test(b.user_id)) throw new HttpError(400, 'INVALID_USER', 'user_id is required');
  if (!b.status || !(STATUSES as readonly string[]).includes(b.status)) {
    throw new HttpError(400, 'INVALID_STATUS', `status must be one of ${STATUSES.join(', ')}`);
  }
  const user = unwrap(await ctx.db.rpc('set_customer_status', { p_user: b.user_id, p_status: b.status }));
  return NextResponse.json({ user });
});
