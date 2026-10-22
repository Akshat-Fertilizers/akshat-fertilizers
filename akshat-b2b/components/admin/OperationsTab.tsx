'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, HandCoins, Lock, PackageCheck, RefreshCw, Send, Truck, X, XCircle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Order, OrderStatus } from '@/lib/types';
import { cn, formatDate, formatINR, todayIST } from '@/lib/utils';
import { Alert, Badge, Empty, Metric, Spinner, STATUS_TONE, paymentLabel } from '@/components/ui';
import { TrendingUp, ShoppingBag, Wallet, AlertCircle } from 'lucide-react';

type Filter = OrderStatus | 'ACTIVE' | 'SETTLED' | 'ALL' | 'TALLY_QUEUE';
const FILTERS: Filter[] = ['ACTIVE', 'PENDING', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'SETTLED', 'CANCELLED', 'TALLY_QUEUE', 'ALL'];
const FILTER_LABEL: Partial<Record<Filter, string>> = { ACTIVE: 'Active', SETTLED: 'Settled', TALLY_QUEUE: 'Queued for Tally', ALL: 'All' };
const isSettled = (o: Order) => o.payment_status === 'PAID';
const isActive = (o: Order) => o.status !== 'CANCELLED' && !isSettled(o);
const matches = (o: Order, f: Filter) =>
  f === 'ALL' ? true
  : f === 'ACTIVE' ? isActive(o)
  : f === 'SETTLED' ? isSettled(o)
  : f === 'TALLY_QUEUE' ? o.is_locked_for_tally && !o.tally_synced
  : o.status === f;

const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: typeof Truck }[]>> = {
  PENDING: [{ status: 'APPROVED', label: 'Approve', icon: CheckCircle2 }],
  APPROVED: [{ status: 'DISPATCHED', label: 'Mark dispatched', icon: Truck }],
  DISPATCHED: [{ status: 'DELIVERED', label: 'Mark delivered', icon: PackageCheck }],
};

export function OperationsTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [settle, setSettle] = useState({ paid_on: todayIST(), reference: '' });
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseBrowser()
      .from('orders')
      .select('*, buyer:users!orders_buyer_id_fkey(business_name, gstin, state, email), order_items(*)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    setOrders((data as Order[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => orders.filter((o) => matches(o, filter)), [orders, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, orders.filter((o) => matches(o, f)).length])), [orders]);

  const open = (o: Order | null) => {
    setSelected(o);
    setSettle({ paid_on: todayIST(), reference: '' });
  };

  async function act(order: Order, path: string, body?: unknown) {
    setBusy(path);
    setError(null);
    try {
      const res = await apiFetch<{ order: Order }>(`/api/admin/orders/${order.id}/${path}`, { method: 'POST', json: body ?? {} });
      const merged = { ...order, ...res.order };
      setOrders((os) => os.map((o) => (o.id === order.id ? merged : o)));
      setSelected(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const metrics = useMemo(() => {
    const live = orders.filter((o) => o.status !== 'CANCELLED');
    return {
      collected: live.reduce((s, o) => s + Number(o.amount_paid), 0),
      receivable: live.filter((o) => o.payment_status !== 'PAID').reduce((s, o) => s + (Number(o.amount_due) - Number(o.amount_paid)), 0),
      active: live.filter((o) => o.payment_status !== 'PAID').length,
      pending: orders.filter((o) => o.status === 'PENDING').length,
    };
  }, [orders]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Platform Dashboard</h1>
          <p className="mt-1 font-medium text-gray-500">Real-time business metrics &amp; fulfilment tracking</p>
        </div>
        <button onClick={load} className="btn-secondary"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh</button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Gross Revenue (collected)" value={formatINR(metrics.collected)} accent="green" icon={TrendingUp} hint="Payments received to date" />
        <Metric label="Outstanding Receivables" value={formatINR(metrics.receivable)} accent="amber" icon={Wallet} hint="Unpaid dealer balances" />
        <Metric label="Active Orders" value={metrics.active} accent="blue" icon={ShoppingBag} hint="Open, not yet settled" />
        <Metric label="Pending Approval" value={metrics.pending} accent="red" icon={AlertCircle} pulse={metrics.pending > 0} hint="Awaiting your action" />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-gray-900">Order Fulfilment Pipeline</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === f ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600')}>
            {FILTER_LABEL[f] ?? f} <span className="opacity-70">({counts[f] ?? 0})</span>
          </button>
        ))}
      </div>
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Indent</th><th className="th">Dealer</th><th className="th">Godown</th><th className="th">Date</th><th className="th text-right">Invoice</th><th className="th">Status</th><th className="th">Payment</th><th className="th">Tally</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((o) => (
              <tr key={o.id} onClick={() => open(o)} className="cursor-pointer hover:bg-brand-50/50">
                <td className="td font-medium">{o.order_no}</td>
                <td className="td">{o.buyer?.business_name}<p className="text-xs text-slate-500">{o.buyer?.gstin}</p></td>
                <td className="td">{o.godown_id}</td>
                <td className="td">{formatDate(o.purchase_date)}</td>
                <td className="td text-right">{formatINR(o.base_amount)}</td>
                <td className="td"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                <td className="td"><Badge tone={STATUS_TONE[o.payment_status]}>{paymentLabel(o)}</Badge></td>
                <td className="td">
                  {o.tally_synced ? <Badge tone="green">Synced</Badge> : o.is_locked_for_tally ? <Badge tone="violet"><Lock className="h-3 w-3" /> Queued</Badge> : <Badge>Open</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && !loading && <Empty>No orders in this stage.</Empty>}
      </div>

      {/* Slide-out order drawer */}
      <div className={cn('fixed inset-0 z-40 bg-slate-900/40 transition-opacity', selected ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => open(null)} />
      <aside className={cn('fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300', selected ? 'translate-x-0' : 'translate-x-full')}>
        {selected && (
          <>
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <p className="text-xs text-slate-500">Indent</p>
                <h2 className="text-lg font-semibold">{selected.order_no}</h2>
                <div className="mt-1 flex gap-2">
                  <Badge tone={STATUS_TONE[selected.status]}>{selected.status}</Badge>
                  <Badge tone={STATUS_TONE[selected.payment_status]}>{paymentLabel(selected)}</Badge>
                  {selected.is_locked_for_tally && <Badge tone="violet"><Lock className="h-3 w-3" /> {selected.tally_synced ? 'In Tally' : 'Locked'}</Badge>}
                </div>
              </div>
              <button onClick={() => open(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
              <section className="grid grid-cols-2 gap-3">
                <div><p className="label">Dealer</p><p className="font-medium">{selected.buyer?.business_name}</p><p className="text-xs text-slate-500">{selected.buyer?.gstin} · {selected.buyer?.email}</p></div>
                <div><p className="label">Ship-to / Godown</p><p className="font-medium">{selected.ship_to_state}</p><p className="text-xs text-slate-500">{selected.godown_id}</p></div>
                <div><p className="label">Purchase date</p><p>{formatDate(selected.purchase_date)}</p></div>
                <div><p className="label">Due date (15 days)</p><p>{formatDate(selected.due_date)}</p></div>
              </section>

              <section>
                <p className="label">Line items</p>
                <table className="w-full rounded-lg border border-slate-200">
                  <thead className="bg-slate-50"><tr><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Amount</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selected.order_items ?? []).map((it) => (
                      <tr key={it.id}>
                        <td className="td">{it.product_name}<p className="text-xs text-slate-500">{it.sku} · HSN {it.hsn_code} · GST {it.gst_rate}%</p></td>
                        <td className="td text-right">{it.qty}</td>
                        <td className="td text-right">{formatINR(it.unit_price)}</td>
                        <td className="td text-right">{formatINR(it.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <dl className="space-y-1 rounded-lg bg-slate-50 p-4">
                {[
                  ['Subtotal', selected.subtotal],
                  ['GST', selected.gst_amount],
                  ['Freight', selected.freight],
                  ['Invoice value', selected.base_amount],
                  [`Early discount (${selected.early_discount_pct}%)`, -Number(selected.discount_amount)],
                  ['Penalty interest', selected.penalty_interest],
                  ['Paid', -Number(selected.amount_paid)],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd>{formatINR(v as number)}</dd></div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Balance</dt><dd>{formatINR(Number(selected.amount_due) - Number(selected.amount_paid))}</dd></div>
              </dl>
              {isSettled(selected) ? (
                <Alert tone="green">
                  Settled — received on <b>{formatDate(selected.settled_on)}</b>
                  {selected.settlement_ref && <> · ref <b>{selected.settlement_ref}</b></>} · total collected {formatINR(selected.amount_paid)}
                </Alert>
              ) : selected.status !== 'CANCELLED' && (
                <section className="rounded-lg border border-brand-200 bg-brand-50/50 p-4">
                  <p className="label">Mark as settled</p>
                  <p className="mb-3 text-xs text-slate-500">
                    Books the full remaining balance as received on this date. Early discount and 18% p.a. interest are recalculated as of the receipt date.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="paid_on">Received on</label>
                      <input id="paid_on" type="date" className="input" min={selected.purchase_date} max={todayIST()} value={settle.paid_on} onChange={(e) => setSettle((s) => ({ ...s, paid_on: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label" htmlFor="settle_ref">UTR / cheque no.</label>
                      <input id="settle_ref" className="input" maxLength={64} value={settle.reference} onChange={(e) => setSettle((s) => ({ ...s, reference: e.target.value }))} />
                    </div>
                  </div>
                  <button
                    className="btn-primary mt-3 w-full"
                    disabled={!!busy || !settle.paid_on}
                    onClick={() => confirm(`Mark ${selected.order_no} as settled (received ${settle.paid_on})?`) && act(selected, 'settle', settle)}
                  >
                    {busy === 'settle' ? <Spinner /> : <HandCoins className="h-4 w-4" />} Mark as Settled
                  </button>
                </section>
              )}
              {selected.notes && <p className="rounded-lg border border-slate-200 p-3 text-slate-600">{selected.notes}</p>}
              {selected.is_locked_for_tally && (
                <Alert tone="amber">Locked for Tally on {formatDate(selected.locked_at)} — voucher fields are immutable (Edit Log 7.1). Corrections must be raised as credit/debit notes.</Alert>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 p-4">
              {(NEXT[selected.status] ?? []).map(({ status, label, icon: Icon }) => (
                <button key={status} className="btn-secondary" disabled={!!busy} onClick={() => act(selected, 'status', { status })}>
                  {busy === 'status' ? <Spinner /> : <Icon className="h-4 w-4" />} {label}
                </button>
              ))}
              {['PENDING', 'APPROVED'].includes(selected.status) && !selected.is_locked_for_tally && Number(selected.amount_paid) === 0 && (
                <button
                  className="btn-danger"
                  disabled={!!busy}
                  onClick={() => confirm(`Cancel ${selected.order_no}? Stock returns to ${selected.godown_id}.`) && act(selected, 'status', { status: 'CANCELLED' })}
                >
                  <XCircle className="h-4 w-4" /> Cancel
                </button>
              )}
              <div className="flex-1" />
              <button
                className="btn-primary"
                disabled={!!busy || selected.is_locked_for_tally || !['APPROVED', 'DISPATCHED', 'DELIVERED'].includes(selected.status)}
                title={selected.status === 'PENDING' ? 'Approve the order first' : undefined}
                onClick={() => confirm(`Lock ${selected.order_no} and queue it for Tally? This cannot be undone.`) && act(selected, 'lock')}
              >
                {busy === 'lock' ? <Spinner /> : <Send className="h-4 w-4" />} {selected.is_locked_for_tally ? (selected.tally_synced ? 'Synced to Tally' : 'Queued for Tally') : 'Lock & Sync to Tally'}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
