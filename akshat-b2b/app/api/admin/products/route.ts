import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);
function price(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new HttpError(400, 'INVALID_AMOUNT', 'Price must be greater than 0');
  return Math.round(n * 100) / 100;
}

/**
 * Catalogue & Dual-Pricing management.
 *  { action: 'CREATE', name, category?, description?, specifications?, unit?, dealer_price?, farmer_price? }
 *  { action: 'UPDATE', id, ...any of the above, is_active? }
 *  { action: 'DELETE', id }
 * A product can only be activated once BOTH prices are set.
 */
export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'catalog');
  const b = await readJson<Record<string, unknown>>(req);

  const fields = () => {
    const f: Record<string, unknown> = {};
    const name = str(b.name, 160); if (name !== undefined) f.name = name;
    const category = str(b.category, 80); if (category !== undefined) f.category = category;
    const description = str(b.description, 2000); if (description !== undefined) f.description = description;
    const specifications = str(b.specifications, 4000); if (specifications !== undefined) f.specifications = specifications;
    const unit = str(b.unit, 20); if (unit !== undefined) f.unit = unit;
    const dp = price(b.dealer_price); if (dp !== undefined) f.dealer_price = dp;
    const fp = price(b.farmer_price); if (fp !== undefined) f.farmer_price = fp;
    return f;
  };

  if (b.action === 'CREATE') {
    const f = fields();
    if (!f.name) throw new HttpError(400, 'INVALID_NAME', 'Product name is required');
    const product = unwrap(await ctx.db.from('products').insert({ ...f, is_active: false }).select('*').single());
    return NextResponse.json({ product }, { status: 201 });
  }

  if (b.action === 'UPDATE') {
    if (!b.id || !UUID_RE.test(String(b.id))) throw new HttpError(400, 'INVALID_ID', 'id is required');
    const current = unwrap(await ctx.db.from('products').select('dealer_price, farmer_price').eq('id', String(b.id)).maybeSingle()) as
      | { dealer_price: number | null; farmer_price: number | null }
      | null;
    if (!current) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const f = fields();
    if (b.is_active !== undefined) {
      const dp = 'dealer_price' in f ? (f.dealer_price as number | null) : current.dealer_price;
      const fp = 'farmer_price' in f ? (f.farmer_price as number | null) : current.farmer_price;
      if (b.is_active && (dp == null || fp == null)) throw new HttpError(422, 'PRICE_NOT_SET', 'Set both dealer and farmer prices before showing this product');
      f.is_active = Boolean(b.is_active);
    }
    const product = unwrap(await ctx.db.from('products').update(f).eq('id', String(b.id)).select('*').single());
    return NextResponse.json({ product });
  }

  if (b.action === 'DELETE') {
    if (!b.id || !UUID_RE.test(String(b.id))) throw new HttpError(400, 'INVALID_ID', 'id is required');
    unwrap(await ctx.db.from('products').delete().eq('id', String(b.id)));
    return NextResponse.json({ ok: true });
  }
  throw new HttpError(400, 'INVALID_ACTION', 'action must be CREATE | UPDATE | DELETE');
});
