import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIERS = ['manager', 'operations', 'finance', 'catalog'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Body {
  action?: 'CREATE' | 'SET_TIER';
  email?: string;
  name?: string;
  user_id?: string;
  tier?: string | null; // null revokes staff access
}

/** Manager-only: create staff logins and assign/revoke their scoped tier. */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'team');
  const b = await readJson<Body>(req);

  if (b.action === 'CREATE') {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'A valid email is required');
    if (!b.tier || !TIERS.includes(b.tier as (typeof TIERS)[number])) throw new HttpError(400, 'INVALID_TIER', `tier must be one of ${TIERS.join(', ')}`);
    const password = `Akshat@${Math.random().toString(36).slice(2, 8)}${Math.floor(1000 + Math.random() * 9000)}`;
    const created = await ctx.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: String(b.name ?? '').trim() || email },
    });
    if (created.error || !created.data.user) {
      const dup = /already|registered|exists/i.test(created.error?.message ?? '');
      throw new HttpError(dup ? 409 : 400, dup ? 'EMAIL_TAKEN' : 'CREATE_FAILED', dup ? 'That email already has an account — assign a tier to it instead' : created.error?.message ?? 'Could not create user');
    }
    const user = unwrap(await ctx.db.rpc('set_staff_tier', { p_user: created.data.user.id, p_tier: b.tier }));
    return NextResponse.json({ user, temp_password: password }, { status: 201 });
  }

  if (b.action === 'SET_TIER') {
    if (!b.user_id || !UUID_RE.test(b.user_id)) throw new HttpError(400, 'INVALID_USER', 'user_id is required');
    const tier = b.tier ?? null;
    if (tier !== null && !TIERS.includes(tier as (typeof TIERS)[number])) throw new HttpError(400, 'INVALID_TIER', `tier must be one of ${TIERS.join(', ')} (or null to revoke)`);
    const user = unwrap(await ctx.db.rpc('set_staff_tier', { p_user: b.user_id, p_tier: tier }));
    return NextResponse.json({ user });
  }
  throw new HttpError(400, 'INVALID_ACTION', 'action must be CREATE or SET_TIER');
});
