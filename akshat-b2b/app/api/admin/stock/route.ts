import { NextResponse } from 'next/server';
import { HttpError, readJson, requireArea, route, unwrap } from '@/lib/supabase-server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GODOWN_RE = /^[A-Z][A-Z0-9_]*$/;

interface Body {
  action?: 'TRANSFER' | 'ADJUST';
  product_id?: string;
  from_godown_id?: string;
  to_godown_id?: string;
  godown_id?: string;
  qty?: number;
  note?: string;
}

export const POST = route(async (req) => {
  const ctx = await requireArea(req, 'stock');
  const b = await readJson<Body>(req);
  const qty = Number(b.qty);
  if (!b.product_id || !UUID_RE.test(b.product_id)) throw new HttpError(400, 'INVALID_PRODUCT', 'product_id is required');
  if (!Number.isInteger(qty) || qty === 0) throw new HttpError(400, 'INVALID_AMOUNT', 'qty must be a non-zero integer');
  const note = typeof b.note === 'string' ? b.note.slice(0, 300) : null;

  if (b.action === 'TRANSFER') {
    if (!GODOWN_RE.test(b.from_godown_id ?? '') || !GODOWN_RE.test(b.to_godown_id ?? '')) {
      throw new HttpError(400, 'INVALID_GODOWN', 'from_godown_id and to_godown_id are required');
    }
    if (qty < 0) throw new HttpError(400, 'INVALID_AMOUNT', 'Transfer qty must be positive');
    const result = unwrap(
      await ctx.admin.rpc('transfer_stock', {
        p_product_id: b.product_id,
        p_from_godown: b.from_godown_id,
        p_to_godown: b.to_godown_id,
        p_qty: qty,
        p_actor: ctx.user.id,
        p_note: note,
      }),
    );
    return NextResponse.json({ result });
  }
  if (b.action === 'ADJUST') {
    if (!GODOWN_RE.test(b.godown_id ?? '')) throw new HttpError(400, 'INVALID_GODOWN', 'godown_id is required');
    const result = unwrap(
      await ctx.admin.rpc('adjust_stock', { p_product_id: b.product_id, p_godown_id: b.godown_id, p_delta: qty, p_actor: ctx.user.id, p_note: note }),
    );
    return NextResponse.json({ result });
  }
  throw new HttpError(400, 'INVALID_ACTION', 'action must be TRANSFER or ADJUST');
});
