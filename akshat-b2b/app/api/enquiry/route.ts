import { NextResponse } from 'next/server';
import { HttpError, readJson, route } from '@/lib/supabase-server';
import { adminEmails, sendMail } from '@/lib/email';
import { adminEnquiry } from '@/lib/email-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Public website enquiry form → emails the admin inbox. No auth required. */
export const POST = route(async (req) => {
  const b = await readJson<{ name?: string; mobile?: string; message?: string }>(req);
  const name = text(b.name, 120);
  const mobile = text(b.mobile, 20);
  const message = text(b.message, 2000);
  if (name.length < 2) throw new HttpError(400, 'INVALID_NAME', 'Please enter your name');
  if (!/^[0-9+ ]{10,15}$/.test(mobile)) throw new HttpError(400, 'INVALID_MOBILE', 'Please enter a valid mobile number');

  const mail = adminEnquiry({ name, mobile, message });
  const sent = await sendMail({ to: adminEmails(), subject: mail.subject, html: mail.html });
  // Even if email is not configured yet, accept the enquiry so the visitor isn't blocked.
  return NextResponse.json({ ok: true, emailed: sent }, { status: 201 });
});
