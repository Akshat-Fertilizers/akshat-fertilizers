'use client';
import { useCallback, useEffect, useState } from 'react';
import { Calculator, HandCoins, IndianRupee, Percent, Save } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { DiscountSlab, Order } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Metric, Spinner, STATUS_TONE } from '@/components/ui';

export function FinanceTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [slabs, setSlabs] = useState<DiscountSlab[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [o, s] = await Promise.all([
      sb.from('orders').select('*, buyer:profiles!orders_user_id_fkey(entity_name, full_name)').neq('payment_status', 'PAID').neq('order_status', 'CANCELLED').order('created_at'),
      sb.from('discount_slabs').select('*').order('min_amount'),
    ]);
    setOrders((o.data as Order[]) ?? []);
    setSlabs((s.data as DiscountSlab[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const outstanding = orders.reduce((s, o) => s + (Number(o.final_amount) + Number(o.overdue_interest) - Number(o.amount_paid)), 0);
  const overdue = orders.filter((o) => o.payment_status === 'OVERDUE');

  async function act(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ tone: 'green', text: okText }); await load(); }
    catch (e) { setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Failed' }); }
    finally { setBusy(null); }
  }

  function recordPayment(o: Order) {
    const bal = Number(o.final_amount) + Number(o.overdue_interest) - Number(o.amount_paid);
    const v = prompt(`Payment received for ${o.order_number} (balance ${formatINR(bal)})`, String(bal));
    if (!v) return;
    const amount = Number(v); if (!Number.isFinite(amount) || amount <= 0) return;
    const mode = prompt('Payment mode? (Cash / UPI / Cheque / Bank)', 'UPI') ?? undefined;
    act(o.id + 'pay', () => apiFetch('/api/admin/payments', { method: 'POST', json: { order_id: o.id, amount, mode } }), `Payment recorded for ${o.order_number}`);
  }
  function overrideInterest(o: Order) {
    const v = prompt(`Set overdue interest for ${o.order_number} (current ${formatINR(o.overdue_interest)}). Enter 0 to waive.`, String(o.overdue_interest));
    if (v === null) return;
    const amount = Number(v); if (!Number.isFinite(amount) || amount < 0) return;
    act(o.id + 'int', () => apiFetch('/api/admin/interest', { method: 'POST', json: { action: 'SET', order_id: o.id, amount } }), `Interest updated on ${o.order_number}`);
  }

  async function saveSlab(s: DiscountSlab, patch: Partial<DiscountSlab>) {
    const row = { ...s, ...patch };
    await act('slab' + s.id, () => apiFetch('/api/admin/discounts', { method: 'POST', json: { action: 'UPSERT_SLAB', id: s.id, min_amount: row.min_amount, max_amount: row.max_amount, discount_pct: row.discount_pct, is_active: row.is_active } }), 'Slab saved');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-black"><IndianRupee className="h-5 w-5 text-brand-600" /> Payments, Credit &amp; Discounts</h1>
        <button className="btn-primary ml-auto" disabled={busy === 'recalc'} onClick={() => act('recalc', () => apiFetch('/api/admin/interest', { method: 'POST', json: { action: 'RECALC' } }), 'Overdue interest recalculated')}>
          {busy === 'recalc' ? <Spinner /> : <Calculator className="h-4 w-4" />} Run overdue (18% p.a. &gt;90 days)
        </button>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <div className="grid gap-6 sm:grid-cols-3">
        <Metric label="Total Outstanding" value={formatINR(outstanding)} icon={HandCoins} accent="green" hint={`${orders.length} open orders`} />
        <Metric label="Overdue (>90 days)" value={overdue.length} icon={Percent} accent="red" hint={formatINR(overdue.reduce((s, o) => s + Number(o.overdue_interest), 0)) + ' interest'} />
        <Metric label="Open receivables" value={orders.length} icon={IndianRupee} accent="slate" />
      </div>

      <div className="card overflow-x-auto">
        <h2 className="border-b border-gray-100 px-5 py-3 font-black">Open receivables</h2>
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Order</th><th className="th">Customer</th><th className="th">Due</th><th className="th text-right">Final</th><th className="th text-right">Interest</th><th className="th text-right">Paid</th><th className="th text-right">Balance</th><th className="th">Payment</th><th className="th">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((o) => {
              const bal = Number(o.final_amount) + Number(o.overdue_interest) - Number(o.amount_paid);
              return (
                <tr key={o.id}>
                  <td className="td font-black">{o.order_number}</td>
                  <td className="td">{o.buyer?.entity_name}<p className="text-xs text-gray-500">{o.customer_type}</p></td>
                  <td className="td text-xs">{formatDate(o.due_date)}</td>
                  <td className="td text-right">{formatINR(o.final_amount)}</td>
                  <td className="td text-right">{Number(o.overdue_interest) > 0 ? <span className="text-red-600">{formatINR(o.overdue_interest)}</span> : '—'}</td>
                  <td className="td text-right">{formatINR(o.amount_paid)}</td>
                  <td className="td text-right font-black">{formatINR(bal)}</td>
                  <td className="td"><Badge tone={STATUS_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                  <td className="td"><div className="flex gap-1">
                    <button title="Record payment" className="btn-secondary px-2 py-1" disabled={!!busy} onClick={() => recordPayment(o)}><HandCoins className="h-4 w-4" /></button>
                    {o.payment_terms === 'CREDIT_15D' && <button title="Adjust / waive interest" className="btn-secondary px-2 py-1" disabled={!!busy} onClick={() => overrideInterest(o)}><Percent className="h-4 w-4" /></button>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!orders.length && <Empty>No open receivables.</Empty>}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="border-b border-gray-100 px-5 py-3 font-black">Dealer discount slabs</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="th">Min ₹</th><th className="th">Max ₹</th><th className="th">Discount %</th><th className="th">Active</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {slabs.map((s) => (
              <tr key={s.id}>
                <td className="td">{formatINR(s.min_amount)}</td>
                <td className="td">{s.max_amount == null ? 'and above' : formatINR(s.max_amount)}</td>
                <td className="td"><input className="input w-20 px-2 py-1" defaultValue={String(s.discount_pct)} onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(s.discount_pct)) saveSlab(s, { discount_pct: v }); }} /></td>
                <td className="td"><input type="checkbox" checked={s.is_active} onChange={(e) => saveSlab(s, { is_active: e.target.checked })} /></td>
                <td className="td">{busy === 'slab' + s.id ? <Spinner /> : <Save className="h-4 w-4 text-gray-300" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
