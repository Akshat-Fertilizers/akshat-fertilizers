import { NextResponse } from 'next/server';
import { HttpError, readJson, requireUser, route, unwrap } from '@/lib/supabase-server';
import { adminEmails, sendMail } from '@/lib/email';
import { adminNewRegistration, registrationReceived } from '@/lib/email-templates';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Completes a first-time Google sign-in: the user picks Dealer/Farmer and fills
 * the offline-KYC details. Updates their own profile to PENDING via the
 * complete_onboarding() RPC (auth.uid()-scoped), then fires the same
 * registration notifications as the email/password flow.
 */
export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson<{ role?: string; mobile?: string; whatsapp?: string; state?: string; city?: string; entity_name?: string }>(req);
  const role = String(b.role ?? '').toUpperCase();
  if (role !== 'DEALER' && role !== 'FARMER') throw new HttpError(400, 'INVALID_ROLE', 'Choose Dealer or Farmer');
  const mobile = text(b.mobile, 20);
  if (!/^[0-9+ ]{10,15}$/.test(mobile)) throw new HttpError(400, 'INVALID_MOBILE', 'Enter a valid mobile number');
  const entity_name = text(b.entity_name, 120);
  if (entity_name.length < 2) throw new HttpError(400, 'INVALID_ENTITY', role === 'DEALER' ? 'Business name is required' : 'Farm name is required');

  const profile = unwrap(
    await ctx.db.rpc('complete_onboarding', {
      p_role: role,
      p_mobile: mobile,
      p_whatsapp: text(b.whatsapp, 20) || mobile,
      p_state: text(b.state, 60),
      p_city: text(b.city, 60),
      p_entity: entity_name,
    }),
  ) as Profile;

  const customer = registrationReceived(profile.full_name, role);
  const alert = adminNewRegistration({
    full_name: profile.full_name,
    role,
    email: profile.email,
    mobile,
    entity_name,
    state: profile.state,
    city: profile.city,
  });
  await Promise.allSettled([
    profile.email ? sendMail({ to: profile.email, subject: customer.subject, html: customer.html }) : Promise.resolve(false),
    sendMail({ to: adminEmails(), subject: alert.subject, html: alert.html, replyTo: profile.email ?? undefined }),
  ]);

  return NextResponse.json({ ok: true, role }, { status: 200 });
});
