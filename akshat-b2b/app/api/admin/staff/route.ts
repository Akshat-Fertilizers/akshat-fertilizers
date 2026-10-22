import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROLES = ['manager', 'operations', 'finance', 'stock'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Body {
  action?: 'CREATE' | 'SET_ROLE';
  email?: string;
  name?: string;
  user_id?: string;
  staff_role?: string | null; // null demotes a staff member back to buyer
}

/** Manager-only: create worker logins and assign/revoke their scoped role. */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'team');
  const b = await readJson<Body>(req);

  if (b.action === 'CREATE') {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'A valid email is required');
    if (!b.staff_role || !ROLES.includes(b.staff_role as (typeof ROLES)[number])) throw new HttpError(400, 'INVALID_ROLE', `Role must be one of ${ROLES.join(', ')}`);
    const password = `Akshat@${Math.random().toString(36).slice(2, 8)}${Math.floor(1000 + Math.random() * 9000)}`;
    const created = await ctx.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { business_name: String(b.name ?? '').trim() || email },
    });
    if (created.error || !created.data.user) {
      const dup = /already|registered|exists/i.test(created.error?.message ?? '');
      throw new HttpError(dup ? 409 : 400, dup ? 'EMAIL_TAKEN' : 'CREATE_FAILED', dup ? 'That email already has an account — assign a role to it instead' : created.error?.message ?? 'Could not create user');
    }
    const user = unwrap(await ctx.admin.rpc('admin_set_staff_role', { p_user_id: created.data.user.id, p_staff_role: b.staff_role, p_actor: ctx.user.id }));
    return NextResponse.json({ user, temp_password: password }, { status: 201 });
  }

  if (b.action === 'SET_ROLE') {
    if (!b.user_id || !UUID_RE.test(b.user_id)) throw new HttpError(400, 'INVALID_USER', 'user_id is required');
    const role = b.staff_role ?? null;
    if (role !== null && !ROLES.includes(role as (typeof ROLES)[number])) throw new HttpError(400, 'INVALID_ROLE', `Role must be one of ${ROLES.join(', ')} (or null to revoke)`);
    const user = unwrap(await ctx.admin.rpc('admin_set_staff_role', { p_user_id: b.user_id, p_staff_role: role, p_actor: ctx.user.id }));
    return NextResponse.json({ user });
  }

  throw new HttpError(400, 'INVALID_ACTION', 'action must be CREATE or SET_ROLE');
});
