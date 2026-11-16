import { NextResponse } from 'next/server';
import { HttpError, readJson, route, serviceClient } from '@/lib/supabase-server';
import { adminEmails, sendMail } from '@/lib/email';
import { adminNewRegistration, registrationReceived } from '@/lib/email-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

interface Body {
  role?: string;
  full_name?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  password?: string;
  state?: string;
  city?: string;
  entity_name?: string;
}

/**
 * Split Dealer/Farmer registration (offline KYC). Creates the auth user + a
 * PENDING profile (via DB trigger). No KYC uploads, no online approval gate —
 * the team completes KYC offline over WhatsApp/phone.
 */
export const POST = route(async (req) => {
  const b = await readJson<Body>(req);
  const role = String(b.role ?? '').toUpperCase();
  if (role !== 'DEALER' && role !== 'FARMER') throw new HttpError(400, 'INVALID_ROLE', 'Choose Dealer or Farmer');
  const email = text(b.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'A valid email is required');
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
  const full_name = text(b.full_name, 120);
  if (full_name.length < 3) throw new HttpError(400, 'INVALID_NAME', 'Enter your full name');
  const mobile = text(b.mobile, 20);
  if (!/^[0-9+ ]{10,15}$/.test(mobile)) throw new HttpError(400, 'INVALID_MOBILE', 'Enter a valid mobile number');
  const entity_name = text(b.entity_name, 120);
  if (entity_name.length < 2) throw new HttpError(400, 'INVALID_ENTITY', role === 'DEALER' ? 'Business name is required' : 'Farm name is required');

  const meta = {
    role,
    full_name,
    mobile,
    whatsapp: text(b.whatsapp, 20) || mobile,
    state: text(b.state, 60),
    city: text(b.city, 60),
    entity_name,
  };

  const admin = serviceClient();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (error) {
    const dup = /already|registered|exists/i.test(error.message);
    throw new HttpError(dup ? 409 : 400, dup ? 'EMAIL_TAKEN' : 'REGISTER_FAILED', dup ? 'This email is already registered — please log in.' : error.message);
  }

  // Notifications (best-effort — never block the registration response).
  const customer = registrationReceived(full_name, role);
  const alert = adminNewRegistration({ full_name, role, email, mobile, entity_name, state: meta.state, city: meta.city });
  await Promise.allSettled([
    sendMail({ to: email, subject: customer.subject, html: customer.html }),
    sendMail({ to: adminEmails(), subject: alert.subject, html: alert.html, replyTo: email }),
  ]);

  return NextResponse.json({ ok: true, role }, { status: 201 });
});
