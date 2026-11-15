import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Finance: manage order-value discount slabs and per-customer discount overrides.
 *  { action: 'UPSERT_SLAB', id?, min_amount, max_amount, discount_pct, is_active }
 *  { action: 'DELETE_SLAB', id }
 *  { action: 'SET_CUSTOM', user_id, custom_discount_pct|null }
 */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'finance');
  const b = await readJson<Record<string, unknown>>(req);

  if (b.action === 'UPSERT_SLAB') {
    const min = Number(b.min_amount), max = b.max_amount == null ? null : Number(b.max_amount), pct = Number(b.discount_pct);
    if (!Number.isFinite(min) || min < 0) throw new HttpError(400, 'INVALID_AMOUNT', 'min_amount is required');
    if (max != null && (!Number.isFinite(max) || max < min)) throw new HttpError(400, 'INVALID_AMOUNT', 'max_amount must be ≥ min_amount');
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'INVALID_PCT', 'discount_pct must be 0–100');
    const row = { min_amount: min, max_amount: max, discount_pct: pct, is_active: b.is_active !== false };
    const slab = b.id
      ? unwrap(await ctx.db.from('discount_slabs').update(row).eq('id', String(b.id)).select('*').single())
      : unwrap(await ctx.db.from('discount_slabs').insert(row).select('*').single());
    return NextResponse.json({ slab });
  }
  if (b.action === 'DELETE_SLAB') {
    if (!b.id || !UUID_RE.test(String(b.id))) throw new HttpError(400, 'INVALID_ID', 'id is required');
    unwrap(await ctx.db.from('discount_slabs').delete().eq('id', String(b.id)));
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'SET_CUSTOM') {
    if (!b.user_id || !UUID_RE.test(String(b.user_id))) throw new HttpError(400, 'INVALID_USER', 'user_id is required');
    const pct = b.custom_discount_pct == null ? null : Number(b.custom_discount_pct);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) throw new HttpError(400, 'INVALID_PCT', 'custom_discount_pct must be 0–100');
    const user = unwrap(await ctx.db.from('profiles').update({ custom_discount_pct: pct }).eq('id', String(b.user_id)).select('*').single());
    return NextResponse.json({ user });
  }
  throw new HttpError(400, 'INVALID_ACTION', 'action must be UPSERT_SLAB | DELETE_SLAB | SET_CUSTOM');
});
