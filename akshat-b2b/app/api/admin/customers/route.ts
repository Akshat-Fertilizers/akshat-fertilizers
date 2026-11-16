import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';
import { sendMail } from '@/lib/email';
import { accountApproved, accountRejected } from '@/lib/email-templates';
import type { Profile } from '@/lib/types';

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
  const user = unwrap(await ctx.db.rpc('set_customer_status', { p_user: b.user_id, p_status: b.status })) as Profile;

  // Notify the customer of the decision (best-effort).
  if (user.email && (b.status === 'APPROVED' || b.status === 'REJECTED')) {
    const mail = b.status === 'APPROVED' ? accountApproved(user.full_name, user.role) : accountRejected(user.full_name);
    await sendMail({ to: user.email, subject: mail.subject, html: mail.html }).catch(() => {});
  }
  return NextResponse.json({ user });
});
