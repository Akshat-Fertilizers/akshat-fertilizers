import { NextResponse } from 'next/server';
import { HttpError, mapDbError, readJson, requireApproved, route } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  items?: { product_id?: unknown; quantity?: unknown }[];
  below_min?: boolean;
}

/** Customer places an order. Pricing, dealer slab discount and the ₹50k soft-gate are enforced in create_order(). */
export const POST = route(async (req) => {
  const ctx = await requireApproved(req);
  const body = await readJson<Body>(req);
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw new HttpError(400, 'INVALID_ITEMS', 'Add at least one product to your order');
  }
  const merged = new Map<string, number>();
  for (const it of body.items) {
    const id = String(it?.product_id ?? '');
    const qty = Number(it?.quantity);
    if (!UUID_RE.test(id) || !Number.isInteger(qty) || qty <= 0 || qty > 999_999) {
      throw new HttpError(400, 'INVALID_ITEMS', 'Each line needs a valid product and a positive quantity');
    }
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  const items = Array.from(merged, ([product_id, quantity]) => ({ product_id, quantity }));

  const { data, error } = await ctx.db.rpc('create_order', { p_items: items, p_below_min: body.below_min === true });
  if (error) throw mapDbError(error);
  return NextResponse.json({ order: data }, { status: 201 });
});
