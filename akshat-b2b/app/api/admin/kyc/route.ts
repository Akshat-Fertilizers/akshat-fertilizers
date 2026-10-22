import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'kyc');
  const b = await readJson<{ user_id?: string; is_approved?: boolean; credit_limit?: number; godown_id?: string }>(req);
  if (!b.user_id || !UUID_RE.test(b.user_id)) throw new HttpError(400, 'INVALID_USER', 'user_id is required');
  if (b.credit_limit !== undefined && (!Number.isFinite(Number(b.credit_limit)) || Number(b.credit_limit) < 0)) {
    throw new HttpError(400, 'INVALID_AMOUNT', 'credit_limit must be a non-negative number');
  }
  if (b.godown_id !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(b.godown_id)) throw new HttpError(400, 'INVALID_GODOWN', 'Invalid godown');
  const user = unwrap(
    await ctx.admin.rpc('admin_set_kyc', {
      p_user_id: b.user_id,
      p_is_approved: typeof b.is_approved === 'boolean' ? b.is_approved : null,
      p_credit_limit: b.credit_limit === undefined ? null : Math.round(Number(b.credit_limit) * 100) / 100,
      p_godown_id: b.godown_id ?? null,
      p_actor: ctx.user.id,
    }),
  );
  return NextResponse.json({ user });
});
