'use client';
import { CheckCircle2, ShoppingCart, Trash2, Truck } from 'lucide-react';
import { computeCart, CREDIT_DAYS, EARLY_DISCOUNT_PCT, MIN_ORDER_VALUE } from '@/lib/business';
import type { Product } from '@/lib/types';
import { cn, formatINR } from '@/lib/utils';
import { Spinner } from '@/components/ui';

export function CartPanel({
  cart,
  products,
  state,
  availableCredit,
  busy,
  onQty,
  onClear,
  onSubmit,
}: {
  cart: Record<string, number>;
  products: Product[];
  state: string | null;
  availableCredit: number;
  busy: boolean;
  onQty: (id: string, qty: number) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const lines = products.filter((p) => (cart[p.id] ?? 0) > 0).map((p) => ({ product: p, qty: cart[p.id], price: Number(p.price), gst_rate: Number(p.gst_rate) }));
  const t = computeCart(lines, state);
  const progress = Math.min(100, (t.subtotal / MIN_ORDER_VALUE) * 100);
  const overCredit = t.total > availableCredit;
  const blockReason = !lines.length ? 'Cart is empty' : !t.meetsMinimum ? `Add ${formatINR(t.shortfall)} more to reach the ₹50,000 minimum` : overCredit ? 'Exceeds available credit' : null;

  return (
    <aside className="card sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="h-4 w-4" /> Your Order</h2>
        {lines.length > 0 && <button onClick={onClear} className="text-xs text-slate-500 hover:text-rose-600">Clear</button>}
      </div>

      <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
        {lines.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">Add products from your godown catalog.</p>}
        {lines.map(({ product, qty }) => (
          <div key={product.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="text-xs text-slate-500">{qty} × {formatINR(product.price)}</p>
            </div>
            <p className="text-sm font-medium">{formatINR(qty * Number(product.price))}</p>
            <button onClick={() => onQty(product.id, 0)} aria-label="Remove" className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t border-slate-100 p-4 text-sm">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-slate-600">Minimum order ₹50,000</span>
            {t.meetsMinimum ? (
              <span className="flex items-center gap-1 font-medium text-brand-700"><CheckCircle2 className="h-3.5 w-3.5" /> Met</span>
            ) : (
              <span className="text-slate-500">{formatINR(t.shortfall)} to go</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full transition-all', t.meetsMinimum ? 'bg-brand-600' : 'bg-amber-500')} style={{ width: `${progress}%` }} />
          </div>
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal (ex-GST)</dt><dd>{formatINR(t.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(t.gst)}</dd></div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-slate-500"><Truck className="h-3.5 w-3.5" /> Freight ({state ?? 'Other'})</dt>
            <dd>{formatINR(t.freight)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-semibold"><dt>Invoice total</dt><dd>{formatINR(t.total)}</dd></div>
          {t.subtotal > 0 && (
            <p className="text-xs text-brand-700">
              Pay {formatINR(t.payableIfEarly)} within {CREDIT_DAYS} days ({EARLY_DISCOUNT_PCT}% early-payment discount).
            </p>
          )}
        </dl>
        <button className="btn-primary w-full" disabled={!!blockReason || busy} onClick={onSubmit}>
          {busy && <Spinner />} Place Order
        </button>
        {blockReason && lines.length > 0 && <p className="text-center text-xs text-amber-700">{blockReason}</p>}
      </div>
    </aside>
  );
}
