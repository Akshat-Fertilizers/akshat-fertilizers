import { NextResponse } from 'next/server';
import { requireUser, route } from '@/lib/supabase-server';
import { adminEmails } from '@/lib/email';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Post-login resolver. Decides where to send a freshly-authenticated user and
 * promotes the configured owner account to ADMIN. The admin allow-list lives in
 * ADMIN_NOTIFICATION_EMAIL (env) — never hardcoded in source — so the Gmail
 * owner lands straight on the dashboard via "Sign in with Google".
 *
 * Returns { destination, blocked } — blocked is 'PENDING' | 'REJECTED' when the
 * customer must not enter the portal (the client then signs them out).
 */
export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  let profile = ctx.profile;
  const email = (ctx.user.email ?? '').toLowerCase();

  // Admin bypass: promote an env-listed owner email the first time they log in.
  if (email && adminEmails().includes(email) && profile.role !== 'ADMIN') {
    const { data } = await ctx.admin
      .from('profiles')
      .update({ role: 'ADMIN', status: 'APPROVED', onboarded: true })
      .eq('id', ctx.user.id)
      .select('*')
      .single();
    if (data) profile = data as Profile;
  }

  let destination = '/portal';
  let blocked: 'PENDING' | 'REJECTED' | null = null;
  if (profile.role === 'ADMIN') destination = '/admin/dashboard';
  else if (!profile.onboarded) destination = '/register/complete';
  else if (profile.status === 'APPROVED') destination = '/portal';
  else {
    blocked = profile.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    destination = '';
  }

  return NextResponse.json({ destination, blocked, role: profile.role, status: profile.status, onboarded: profile.onboarded });
});
