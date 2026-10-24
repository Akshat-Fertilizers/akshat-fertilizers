'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Minus, Package, Plus, Search, ShieldAlert, Warehouse } from 'lucide-react';
import { useProfile } from '@/lib/hooks/useProfile';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch, ApiError } from '@/lib/api';
import { computeCart, GODOWNS, type GodownId } from '@/lib/business';
import type { BuyerCredit, InventoryRow, Order, Product } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { AppHeader } from '@/components/AppHeader';
import { CreditBanner } from '@/components/storefront/CreditBanner';
import { CartPanel } from '@/components/storefront/CartPanel';
import { Alert, Badge, Empty, FullPageLoader, STATUS_TONE } from '@/components/ui';

type Shortage = { name?: string; sku?: string; requested: number; available: number };

export default function StorefrontPage() {
  const router = useRouter();
  const { session, profile, loading, signOut } = useProfile();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [credit, setCredit] = useState<BuyerCredit | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'red' | 'green'; msg: React.ReactNode } | null>(null);
  const [clientRef, setClientRef] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())));

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (profile?.role === 'admin') router.replace('/admin/dashboard');
  }, [loading, session, profile, router]);

  const approved = profile?.role === 'buyer' && profile.is_approved;

  const refresh = useCallback(async () => {
    if (!profile || !approved) return;
    const sb = supabaseBrowser();
    // RLS returns ONLY the buyer's state-mapped godown stock.
    const [p, inv, c, o] = await Promise.all([
      sb.from('products').select('*').eq('is_active', true).order('category').order('name'),
      sb.from('inventory').select('*'),
      sb.from('v_buyer_credit').select('*').eq('user_id', profile.id).maybeSingle(),
      sb.from('orders').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    setProducts((p.data as Product[]) ?? []);
    setStock(Object.fromEntries(((inv.data as InventoryRow[]) ?? []).map((r) => [r.product_id, r.stock_qty])));
    setCredit((c.data as BuyerCredit) ?? null);
    setOrders((o.data as Order[]) ?? []);
  }, [profile, approved]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const max = stock[id] ?? 0;
      const next = { ...c, [id]: Math.max(0, Math.min(max, Math.floor(qty || 0))) };
      if (!next[id]) delete next[id];
      return next;
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q)) : products;
  }, [products, query]);

  const cartTotal = useMemo(
    () => computeCart(products.filter((p) => cart[p.id]).map((p) => ({ qty: cart[p.id], price: Number(p.price), gst_rate: Number(p.gst_rate) })), profile?.state).total,
    [cart, products, profile?.state],
  );

  async function placeOrder() {
    setBusy(true);
    setFlash(null);
    try {
      const items = Object.entries(cart).map(([product_id, qty]) => ({ product_id, qty }));
      const res = await apiFetch<{ order: { order_no: string; amount_due: number; due_date: string } }>('/api/orders/create', {
        method: 'POST',
        json: { items, client_ref: clientRef },
      });
      setFlash({ tone: 'green', msg: <>Order <b>{res.order.order_no}</b> placed. Pay {formatINR(res.order.amount_due)} by {formatDate(res.order.due_date)} to keep the early-payment discount.</> });
      setCart({});
      setClientRef(crypto.randomUUID());
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK' && Array.isArray(e.details)) {
        setFlash({
          tone: 'red',
          msg: (
            <>
              Stock changed while you were ordering:
              <ul className="mt-1 list-disc pl-5">
                {(e.details as Shortage[]).map((s, i) => (
                  <li key={i}>{s.name ?? s.sku}: requested {s.requested}, available {s.available}</li>
                ))}
              </ul>
            </>
          ),
        });
        await refresh();
      } else {
        setFlash({ tone: 'red', msg: e instanceof Error ? e.message : 'Could not place order' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading || !session || !profile || profile.role === 'admin') return <FullPageLoader />;

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} onSignOut={signOut} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        {!approved ? (
          <div className="card mx-auto max-w-xl p-8 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
            <h1 className="mt-3 text-lg font-semibold">Account approval pending</h1>
            <p className="mt-2 text-sm text-slate-600">
              Thanks for registering <b>{profile.business_name}</b> ({profile.gstin}). Our accounts team is reviewing your details and setting your credit
              limit. Stock and ordering unlock automatically once approved.
            </p>
          </div>
        ) : (
          <>
            <CreditBanner credit={credit} pendingOrderValue={cartTotal} />
            {flash && <Alert tone={flash.tone} onClose={() => setFlash(null)}>{flash.msg}</Alert>}

            <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="flex items-center gap-2 text-lg font-semibold">
                    <Warehouse className="h-5 w-5 text-brand-700" />
                    {GODOWNS[profile.godown_id as GodownId] ?? profile.godown_id} stock
                  </h1>
                  <div className="relative ml-auto w-full sm:w-64">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input className="input pl-9" placeholder="Search product / SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((p) => {
                    const available = stock[p.id] ?? 0;
                    const qty = cart[p.id] ?? 0;
                    return (
                      <article key={p.id} className="card flex flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-500">{p.subcategory ?? p.category}</p>
                            <h3 className="font-semibold leading-snug">{p.name}</h3>
                          </div>
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-contain" loading="lazy" />
                          ) : (
                            <Package className="h-5 w-5 shrink-0 text-slate-300" />
                          )}
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {formatINR(p.price)}<span className="text-xs font-normal text-slate-500"> / {p.pack_label ?? p.unit.toLowerCase()} + {p.gst_rate}% GST</span>
                        </p>
                        <p className="mt-1 text-xs">
                          {available > 0 ? <Badge tone={available < 50 ? 'amber' : 'green'}>{available.toLocaleString('en-IN')} in stock</Badge> : <Badge tone="red">Out of stock</Badge>}
                        </p>
                        <div className="mt-auto flex items-center gap-2 pt-3">
                          <button className="btn-secondary px-2" disabled={qty <= 0} onClick={() => setQty(p.id, qty - 10)} aria-label="Less"><Minus className="h-4 w-4" /></button>
                          <input
                            className="input text-center"
                            type="number"
                            min={0}
                            max={available}
                            value={qty || ''}
                            placeholder="0"
                            disabled={available <= 0}
                            onChange={(e) => setQty(p.id, Number(e.target.value))}
                          />
                          <button className="btn-secondary px-2" disabled={qty >= available} onClick={() => setQty(p.id, qty + 10)} aria-label="More"><Plus className="h-4 w-4" /></button>
                        </div>
                      </article>
                    );
                  })}
                  {!filtered.length && <div className="card sm:col-span-2 xl:col-span-3"><Empty>No products match.</Empty></div>}
                </div>

                <div className="card">
                  <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold"><Clock className="h-4 w-4" /> Recent orders</h2>
                  {orders.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50"><tr><th className="th">Order</th><th className="th">Date</th><th className="th">Status</th><th className="th text-right">Due</th><th className="th">Due date</th><th className="th">Payment</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {orders.map((o) => (
                            <tr key={o.id}>
                              <td className="td font-medium">{o.order_no}</td>
                              <td className="td">{formatDate(o.purchase_date)}</td>
                              <td className="td"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                              <td className="td text-right">{formatINR(Number(o.amount_due) - Number(o.amount_paid))}</td>
                              <td className="td">{formatDate(o.due_date)}</td>
                              <td className="td"><Badge tone={STATUS_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>No orders yet.</Empty>
                  )}
                </div>
              </section>

              <CartPanel
                cart={cart}
                products={products}
                state={profile.state}
                availableCredit={Number(credit?.available ?? 0)}
                busy={busy}
                onQty={setQty}
                onClear={() => setCart({})}
                onSubmit={placeOrder}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
