'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Truck, X } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Order, OrderStatus } from '@/lib/types';
import { cn, formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner, STATUS_TONE, prettyStatus } from '@/components/ui';

const STATUSES: OrderStatus[] = ['RECEIVED', 'CONFIRMED_OFFLINE', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

export function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OrderStatus | 'ALL' | 'BELOW50K'>('ALL');
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabaseBrowser().from('orders')
      .select('*, order_items(*), buyer:profiles!orders_user_id_fkey(full_name, entity_name, mobile, whatsapp, role, state, city)')
      .order('created_at', { ascending: false }).limit(500);
    setOrders((data as Order[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) =>
      (filter === 'ALL' || (filter === 'BELOW50K' ? o.is_below_min_order : o.order_status === filter)) &&
      (!q || `${o.order_number} ${o.buyer?.entity_name ?? ''} ${o.buyer?.full_name ?? ''}`.toLowerCase().includes(q)));
  }, [orders, query, filter]);

  async function setStatus(o: Order, status: OrderStatus) {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch<{ order: Order }>(`/api/admin/orders/${o.id}`, { method: 'POST', json: { status } });
      const merged = { ...o, ...res.order };
      setOrders((os) => os.map((x) => (x.id === o.id ? merged : x)));
      setSelected(merged);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-black"><Truck className="h-5 w-5 text-brand-600" /> Orders</h1>
        <button onClick={load} className="btn-secondary ml-auto"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input pl-9" placeholder="Search order no. / customer" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="ALL">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{prettyStatus(s)}</option>)}<option value="BELOW50K">Below ₹50k requests</option>
        </select>
      </div>
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Order</th><th className="th">Customer</th><th className="th">Date</th><th className="th text-right">Final</th><th className="th">Status</th><th className="th">Payment</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((o) => (
              <tr key={o.id} onClick={() => setSelected(o)} className="cursor-pointer hover:bg-brand-50/40">
                <td className="td font-black">{o.order_number}{o.is_below_min_order && <Badge tone="amber" className="ml-1">Below ₹50k</Badge>}</td>
                <td className="td">{o.buyer?.entity_name}<p className="text-xs text-gray-500">{o.customer_type}</p></td>
                <td className="td">{formatDate(o.created_at)}</td>
                <td className="td text-right font-black">{formatINR(o.final_amount)}</td>
                <td className="td"><Badge tone={STATUS_TONE[o.order_status]}>{prettyStatus(o.order_status)}</Badge></td>
                <td className="td"><Badge tone={STATUS_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && !loading && <Empty>No orders match.</Empty>}
      </div>

      <div className={cn('fixed inset-0 z-40 bg-gray-900/40 transition-opacity', selected ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setSelected(null)} />
      <aside className={cn('fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-300', selected ? 'translate-x-0' : 'translate-x-full')}>
        {selected && (
          <>
            <div className="flex items-start justify-between border-b border-gray-200 p-5">
              <div><p className="text-xs text-gray-500">Order</p><h2 className="text-lg font-black">{selected.order_number}</h2>
                <div className="mt-1 flex flex-wrap gap-2"><Badge tone={STATUS_TONE[selected.order_status]}>{prettyStatus(selected.order_status)}</Badge><Badge tone={STATUS_TONE[selected.payment_status]}>{selected.payment_status}</Badge>{selected.is_below_min_order && <Badge tone="amber">Below ₹50k</Badge>}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
              <section className="grid grid-cols-2 gap-3">
                <div><p className="label">Customer</p><p className="font-bold">{selected.buyer?.entity_name}</p><p className="text-xs text-gray-500">{selected.buyer?.full_name} · {selected.customer_type}</p></div>
                <div><p className="label">Contact</p><p className="font-bold">{selected.buyer?.mobile}</p><p className="text-xs text-gray-500">{[selected.buyer?.city, selected.buyer?.state].filter(Boolean).join(', ')}</p></div>
                <div><p className="label">Placed</p><p>{formatDate(selected.created_at)}</p></div>
                <div><p className="label">{selected.payment_terms === 'CREDIT_15D' ? 'Due (15 days)' : 'Terms'}</p><p>{selected.payment_terms === 'CREDIT_15D' ? formatDate(selected.due_date) : 'Advance payment'}</p></div>
              </section>
              <section>
                <p className="label">Line items</p>
                <table className="w-full rounded-lg border border-gray-200">
                  <tbody className="divide-y divide-gray-100">
                    {(selected.order_items ?? []).map((it) => (
                      <tr key={it.id}><td className="td">{it.product_name}</td><td className="td text-right">{it.quantity} × {formatINR(it.unit_price)}</td><td className="td text-right font-bold">{formatINR(it.total_price)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <dl className="space-y-1 rounded-lg bg-gray-50 p-4">
                <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd>{formatINR(selected.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Discount</dt><dd>−{formatINR(selected.discount_amount)}</dd></div>
                {Number(selected.overdue_interest) > 0 && <div className="flex justify-between text-red-600"><dt>Overdue interest</dt><dd>{formatINR(selected.overdue_interest)}</dd></div>}
                <div className="flex justify-between font-black"><dt>Final</dt><dd>{formatINR(Number(selected.final_amount) + Number(selected.overdue_interest))}</dd></div>
                <div className="flex justify-between border-t border-gray-200 pt-1"><dt className="text-gray-500">Paid</dt><dd>{formatINR(selected.amount_paid)}</dd></div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-gray-200 p-4">
              <select className="input flex-1" value={selected.order_status} disabled={busy} onChange={(e) => setStatus(selected, e.target.value as OrderStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{prettyStatus(s)}</option>)}
              </select>
              {busy && <Spinner className="self-center" />}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
