'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Minus, Package, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { useProfile } from '@/lib/hooks/useProfile';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch, ApiError } from '@/lib/api';
import { computeCart, MIN_ORDER_VALUE } from '@/lib/business';
import type { CatalogItem, DiscountSlab, Order } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { waLink, waMsg } from '@/lib/whatsapp';
import { AppHeader } from '@/components/AppHeader';
import { Alert, Badge, Empty, FullPageLoader, STATUS_TONE, prettyStatus } from '@/components/ui';

export default function PortalPage() {
  const router = useRouter();
  const { session, profile, loading, signOut } = useProfile();
  const [tab, setTab] = useState<'catalogue' | 'orders'>('catalogue');
  const [catalogue, setCatalogue] = useState<CatalogItem[]>([]);
  const [slabs, setSlabs] = useState<DiscountSlab[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'red' | 'green'; msg: React.ReactNode } | null>(null);

  const isDealer = profile?.role === 'DEALER';

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (profile?.role === 'ADMIN') router.replace('/admin/dashboard');
  }, [loading, session, profile, router]);

  const refresh = useCallback(async () => {
    if (!profile || profile.status !== 'APPROVED') return;
    const sb = supabaseBrowser();
    const [c, s, o] = await Promise.all([
      sb.rpc('my_catalog'),
      sb.from('discount_slabs').select('*').eq('is_active', true),
      sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
    ]);
    setCatalogue((c.data as CatalogItem[]) ?? []);
    setSlabs((s.data as DiscountSlab[]) ?? []);
    setOrders((o.data as Order[]) ?? []);
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setQty = (id: string, qty: number) => setCart((c) => {
    const next = { ...c, [id]: Math.max(0, Math.floor(qty || 0)) };
    if (!next[id]) delete next[id];
    return next;
  });

  const cartLines = useMemo(() => catalogue.filter((p) => cart[p.id]).map((p) => ({ product: p, quantity: cart[p.id], price: Number(p.price ?? 0) })), [catalogue, cart]);
  const totals = useMemo(() => computeCart(cartLines.map((l) => ({ quantity: l.quantity, price: l.price })), { role: isDealer ? 'DEALER' : 'FARMER', slabs, customPct: profile?.custom_discount_pct }), [cartLines, isDealer, slabs, profile]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? catalogue.filter((p) => `${p.name} ${p.category ?? ''}`.toLowerCase().includes(q)) : catalogue;
  }, [catalogue, query]);

  async function placeOrder(below_min = false) {
    setBusy(true);
    setFlash(null);
    setGate(false);
    try {
      const items = Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity }));
      const res = await apiFetch<{ order: Order }>('/api/orders', { method: 'POST', json: { items, below_min } });
      const o = res.order;
      setCart({});
      await refresh();
      setTab('orders');
      if (isDealer) {
        setFlash({ tone: 'green', msg: <>Order <b>{o.order_number}</b> placed on 15-day credit{o.is_below_min_order ? ' (below-₹50k request — our team will review commercials)' : ''}. Pay {formatINR(o.final_amount)} by {formatDate(o.due_date)}.</> });
      } else {
        setFlash({ tone: 'green', msg: <>Order <b>{o.order_number}</b> placed ({formatINR(o.final_amount)}). <a className="font-bold underline" target="_blank" rel="noopener" href={waLink(waMsg.advanceCoordination(o.order_number, formatINR(o.final_amount)))}>Coordinate advance payment on WhatsApp →</a></> });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MIN_ORDER_NOT_MET') { setGate(true); }
      else setFlash({ tone: 'red', msg: e instanceof Error ? e.message : 'Could not place order' });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit() {
    if (isDealer && !totals.meetsMin) { setGate(true); return; }
    placeOrder(false);
  }

  if (loading || !profile) return <FullPageLoader />;
  if (profile.status !== 'APPROVED') {
    return (
      <div className="min-h-screen">
        <AppHeader profile={profile} onSignOut={signOut} />
        <div className="mx-auto max-w-xl p-10 text-center">
          <Clock className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-black">Account {prettyStatus(profile.status)}</h1>
          <p className="mt-2 text-gray-600">Our team is completing your KYC offline. Pricing and ordering unlock once your account is approved.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} onSignOut={signOut} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black">Welcome, {profile.full_name ?? profile.entity_name}</h1>
          <Badge tone={isDealer ? 'blue' : 'green'}>{profile.role}</Badge>
          {isDealer && <span className="text-sm font-medium text-gray-500">15-day credit · ₹50,000 minimum · volume discount slabs</span>}
          {!isDealer && <span className="text-sm font-medium text-gray-500">Advance payment · direct farmer pricing</span>}
          <div className="ml-auto flex gap-1 rounded-xl bg-gray-100 p-1">
            {(['catalogue', 'orders'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-1.5 text-sm font-black capitalize ${tab === t ? 'bg-white text-brand-700 shadow' : 'text-gray-500'}`}>{t === 'orders' ? 'My Orders' : 'Catalogue'}</button>
            ))}
          </div>
        </div>
        {flash && <Alert tone={flash.tone} onClose={() => setFlash(null)}>{flash.msg}</Alert>}

        {tab === 'catalogue' ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <section className="space-y-4">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input className="input pl-9" placeholder="Search product / category" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => {
                  const qty = cart[p.id] ?? 0;
                  return (
                    <article key={p.id} className="card flex flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-gray-400">{p.category}</p><h3 className="font-black leading-snug">{p.name}</h3></div>
                        {p.image_url ? <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-contain" /> : <Package className="h-5 w-5 shrink-0 text-gray-300" />}
                      </div>
                      <p className="mt-2 text-lg font-black">{p.price != null ? formatINR(p.price) : '—'}<span className="text-xs font-medium text-gray-500"> / {(p.unit ?? 'unit').toLowerCase()}</span></p>
                      <div className="mt-auto flex items-center gap-2 pt-3">
                        <button className="btn-secondary px-2" disabled={qty <= 0} onClick={() => setQty(p.id, qty - 1)}><Minus className="h-4 w-4" /></button>
                        <input className="input text-center" type="number" min={0} value={qty || ''} placeholder="0" onChange={(e) => setQty(p.id, Number(e.target.value))} />
                        <button className="btn-secondary px-2" onClick={() => setQty(p.id, qty + 1)}><Plus className="h-4 w-4" /></button>
                      </div>
                    </article>
                  );
                })}
                {!filtered.length && <div className="card sm:col-span-2 xl:col-span-3"><Empty>No products match.</Empty></div>}
              </div>
            </section>

            <aside className="card sticky top-24 h-fit p-5">
              <h2 className="flex items-center gap-2 font-black"><ShoppingCart className="h-5 w-5 text-brand-600" /> Your Order</h2>
              {cartLines.length === 0 ? <Empty>Add products to start an order.</Empty> : (
                <>
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {cartLines.map((l) => (
                      <div key={l.product.id} className="flex items-center justify-between gap-2 border-b border-gray-50 pb-2 text-sm">
                        <div className="min-w-0"><p className="truncate font-bold">{l.product.name}</p><p className="text-xs text-gray-500">{l.quantity} × {formatINR(l.price)}</p></div>
                        <span className="font-black">{formatINR(l.quantity * l.price)}</span>
                      </div>
                    ))}
                  </div>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd className="font-bold">{formatINR(totals.subtotal)}</dd></div>
                    {isDealer && totals.discount > 0 && <div className="flex justify-between text-brand-700"><dt>Discount ({totals.discountPct}%)</dt><dd className="font-bold">−{formatINR(totals.discount)}</dd></div>}
                    <div className="flex justify-between border-t border-gray-100 pt-1 text-base font-black"><dt>Total</dt><dd>{formatINR(totals.final)}</dd></div>
                  </dl>
                  {isDealer && !totals.meetsMin && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">₹{(MIN_ORDER_VALUE - totals.subtotal).toLocaleString('en-IN')} more to reach the ₹50,000 minimum.</p>}
                  <button className="btn-primary mt-3 w-full" disabled={busy} onClick={onSubmit}>{busy ? 'Placing…' : 'Place Order'}</button>
                  <button className="mt-2 w-full text-xs font-bold text-gray-400 hover:text-gray-700" onClick={() => setCart({})}><Trash2 className="mr-1 inline h-3 w-3" /> Clear</button>
                </>
              )}
            </aside>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr>
                <th className="th">Order</th><th className="th">Date</th><th className="th">Items</th><th className="th text-right">Subtotal</th><th className="th text-right">Discount</th>
                <th className="th text-right">Final</th><th className="th">Status</th><th className="th">Payment</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th>{isDealer && <th className="th">Due</th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => {
                  const outstanding = Number(o.final_amount) + Number(o.overdue_interest) - Number(o.amount_paid);
                  return (
                    <tr key={o.id}>
                      <td className="td font-black">{o.order_number}{o.is_below_min_order && <Badge tone="amber" className="ml-1">Below ₹50k</Badge>}</td>
                      <td className="td">{formatDate(o.created_at)}</td>
                      <td className="td text-xs">{(o.order_items ?? []).map((i) => `${i.product_name} ×${i.quantity}`).join(', ')}</td>
                      <td className="td text-right">{formatINR(o.subtotal)}</td>
                      <td className="td text-right">{Number(o.discount_amount) > 0 ? '−' + formatINR(o.discount_amount) : '—'}</td>
                      <td className="td text-right font-black">{formatINR(o.final_amount)}</td>
                      <td className="td"><Badge tone={STATUS_TONE[o.order_status]}>{prettyStatus(o.order_status)}</Badge></td>
                      <td className="td"><Badge tone={STATUS_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                      <td className="td text-right">{formatINR(o.amount_paid)}</td>
                      <td className="td text-right font-bold">{formatINR(outstanding)}{Number(o.overdue_interest) > 0 && <p className="text-xs text-red-600">incl. {formatINR(o.overdue_interest)} interest</p>}</td>
                      {isDealer && <td className="td">{formatDate(o.due_date)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!orders.length && <Empty>No orders yet.</Empty>}
          </div>
        )}
      </main>

      {/* ₹50k soft-gate */}
      {gate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm" onClick={() => setGate(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-gray-900">Minimum order is ₹50,000</h3>
            <p className="mt-2 text-sm text-gray-600">Your subtotal is <b>{formatINR(totals.subtotal)}</b>. Akshat’s standard minimum dealer order is ₹50,000. Dealer discounts apply above it:</p>
            <ul className="mt-3 space-y-1 rounded-xl bg-gray-50 p-3 text-sm">
              <li className="flex justify-between"><span>₹70,000 – ₹99,999</span><span className="font-black text-brand-700">10% off</span></li>
              <li className="flex justify-between"><span>₹1,00,000 and above</span><span className="font-black text-brand-700">15% off</span></li>
            </ul>
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn-primary w-full" onClick={() => setGate(false)}>Add More Products</button>
              <button className="btn-secondary w-full" disabled={busy} onClick={() => placeOrder(true)}>Submit Request Below ₹50,000</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
