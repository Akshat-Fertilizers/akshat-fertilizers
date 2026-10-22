import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  product_id?: string;
  price?: number | null;
  gst_rate?: number;
  hsn_code?: string;
  unit?: string;
  pack_label?: string | null;
  is_active?: boolean;
  /** Absolute stock per godown, e.g. { "MH_GODOWN": 500 } */
  stock?: Record<string, number>;
}

const GODOWN_RE = /^[A-Z][A-Z0-9_]*$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

/** Admin → Products & Pricing: edit commercial fields, opening stock, and switch a product on/off for dealers. */
export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  const b = await readJson<Body>(req);
  if (!b.product_id || !UUID_RE.test(b.product_id)) throw new HttpError(400, 'INVALID_PRODUCT', 'product_id is required');

  const current = unwrap(await ctx.admin.from('products').select('id, price, is_active').eq('id', b.product_id).maybeSingle()) as
    | { id: string; price: number | null; is_active: boolean }
    | null;
  if (!current) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

  const patch: Record<string, unknown> = {};
  if (b.price !== undefined) {
    const price = b.price === null ? null : Number(b.price);
    if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 10_000_000)) throw new HttpError(400, 'INVALID_AMOUNT', 'Price must be greater than 0');
    patch.price = price === null ? null : Math.round(price * 100) / 100;
  }
  if (b.gst_rate !== undefined) {
    const g = Number(b.gst_rate);
    if (![0, 0.25, 3, 5, 12, 18, 28].includes(g)) throw new HttpError(400, 'INVALID_GST', 'GST must be one of 0, 0.25, 3, 5, 12, 18, 28');
    patch.gst_rate = g;
  }
  if (b.hsn_code !== undefined) {
    if (!/^\d{4,8}$/.test(String(b.hsn_code))) throw new HttpError(400, 'INVALID_HSN', 'HSN must be 4–8 digits');
    patch.hsn_code = String(b.hsn_code);
  }
  if (b.unit !== undefined) {
    const u = text(b.unit, 12)?.toUpperCase();
    if (!u || !/^[A-Z]+$/.test(u)) throw new HttpError(400, 'INVALID_UNIT', 'Unit must be a word like BAG, PACK, BOX, LTR');
    patch.unit = u;
  }
  if (b.pack_label !== undefined) patch.pack_label = text(b.pack_label, 40);
  if (b.is_active !== undefined) {
    const price = 'price' in patch ? patch.price : current.price;
    if (b.is_active && price == null) throw new HttpError(422, 'PRICE_REQUIRED', 'Set a price before showing this product to dealers');
    patch.is_active = Boolean(b.is_active);
  }

  const product = Object.keys(patch).length
    ? unwrap(await ctx.admin.from('products').update(patch).eq('id', b.product_id).select('*').single())
    : unwrap(await ctx.admin.from('products').select('*').eq('id', b.product_id).single());

  const inventory = [];
  for (const [godown, qty] of Object.entries(b.stock ?? {})) {
    if (!GODOWN_RE.test(godown) || !Number.isInteger(qty) || qty < 0 || qty > 10_000_000) {
      throw new HttpError(400, 'INVALID_AMOUNT', 'Stock must be a whole number ≥ 0 for a valid godown');
    }
    inventory.push(unwrap(await ctx.admin.rpc('set_stock', { p_product_id: b.product_id, p_godown_id: godown, p_qty: qty, p_actor: ctx.user.id, p_note: 'Set from Products & Pricing' })));
  }
  return NextResponse.json({ product, inventory });
});
