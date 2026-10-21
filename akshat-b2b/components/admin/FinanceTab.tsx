'use client';
import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, Calculator, CheckCircle2, HandCoins, Percent, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { AgingBucket, AgingRow, Order } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner, Stat, STATUS_TONE } from '@/components/ui';

interface AgingResponse {
  summary: { as_of: string; scanned: number; discounts_stripped: number; orders_with_interest: number; interest_delta: number };
  buckets: Record<AgingBucket, { count: number; balance: number }>;
  totals: { receivable: number; penalty_interest: number };
  orders: AgingRow[];
  settled: Order[];
}

const BUCKETS: AgingBucket[] = ['CURRENT', '1-30', '31-60', '61-90', '90+'];

export function FinanceTab() {
  const [data, setData] = useState<AgingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [bucket, setBucket] = useState<AgingBucket | 'ALL'>('ALL');

  const run = useCallback(async () => {
    setBusy('aging');
    try {
      setData(await apiFetch<AgingResponse>('/api/finance/aging', { method: 'POST' }));
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Aging run failed' });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  async function adjust(row: AgingRow, action: 'WAIVE_INTEREST' | 'REAPPLY_DISCOUNT' | 'RECORD_PAYMENT') {
    let amount: number | undefined;
    let note: string | undefined;
    if (action === 'RECORD_PAYMENT') {
      const v = prompt(`Payment received for ${row.order_no} (balance ${formatINR(row.balance)})`, String(row.balance));
      if (!v) return;
      amount = Number(v);
    } else {
      const v = prompt(action === 'WAIVE_INTEREST' ? `Reason for waiving ${formatINR(row.penalty_interest)} interest on ${row.order_no}` : `Reason for re-applying early discount on ${row.order_no}`);
      if (v === null) return;
      note = v || undefined;
    }
    setBusy(row.id + action);
    try {
      await apiFetch('/api/finance/adjust', { method: 'POST', json: { order_id: row.id, action, amount, note } });
      setMsg({ tone: 'green', text: `${row.order_no}: ${action.replace('_', ' ').toLowerCase()} done` });
      await run();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Adjustment failed' });
    } finally {
      setBusy(null);
    }
  }

  const rows = (data?.orders ?? []).filter((r) => bucket === 'ALL' || r.bucket === bucket);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Finance & receivables aging</h1>
        <button onClick={run} className="btn-primary ml-auto" disabled={busy === 'aging'}>
          {busy === 'aging' ? <Spinner /> : <Calculator className="h-4 w-4" />} Run aging engine
        </button>
      </div>
      <p className="text-sm text-slate-500">
        15-day credit · early discount auto-stripped after due date · 18% p.a. penalty on bills older than 90 days (base × 18% ÷ 365 × days past due). Runs daily via Vercel Cron.
      </p>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total receivable" value={formatINR(data.totals.receivable)} hint={`${data.orders.length} open bills`} />
            <Stat label="Penalty interest" value={formatINR(data.totals.penalty_interest)} tone="red" hint={`${data.summary.orders_with_interest} bills > 90 days`} />
            <Stat label="Discounts stripped (this run)" value={data.summary.discounts_stripped} />
            <Stat label="Last run" value={formatDate(data.summary.as_of)} hint={<span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" /> {data.summary.scanned} scanned</span>} />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {BUCKETS.map((b) => (
              <button key={b} onClick={() => setBucket(bucket === b ? 'ALL' : b)} className={`card p-3 text-left ${bucket === b ? 'ring-2 ring-emerald-600' : ''}`}>
                <Badge tone={STATUS_TONE[b]}>{b === 'CURRENT' ? 'Not due' : `${b} days`}</Badge>
                <p className="mt-2 font-semibold">{formatINR(data.buckets[b].balance)}</p>
                <p className="text-xs text-slate-500">{data.buckets[b].count} bills</p>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Bill</th><th className="th">Dealer</th><th className="th">Due</th><th className="th text-right">Age</th>
              <th className="th text-right">Invoice</th><th className="th text-right">Discount</th><th className="th text-right">Interest</th><th className="th text-right">Balance</th><th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium">{r.order_no}<div><Badge tone={STATUS_TONE[r.bucket]}>{r.bucket}</Badge></div></td>
                <td className="td">{r.business_name}<p className="text-xs text-slate-500">{r.gstin}</p></td>
                <td className="td">{formatDate(r.due_date)}{r.days_past_due > 0 && <p className="text-xs text-rose-600">{r.days_past_due}d overdue</p>}</td>
                <td className="td text-right">{r.age_days}d</td>
                <td className="td text-right">{formatINR(r.base_amount)}</td>
                <td className="td text-right">
                  {Number(r.discount_amount) > 0 ? <span className="text-emerald-700">−{formatINR(r.discount_amount)}</span> : <span className="text-xs text-slate-400">stripped</span>}
                  {r.discount_override && <p className="text-xs text-slate-500">admin override</p>}
                </td>
                <td className="td text-right">
                  {r.interest_waived ? <span className="text-xs text-slate-400">waived</span> : <span className={Number(r.penalty_interest) > 0 ? 'text-rose-600' : ''}>{formatINR(r.penalty_interest)}</span>}
                </td>
                <td className="td text-right font-semibold">{formatINR(r.balance)}</td>
                <td className="td">
                  <div className="flex gap-1">
                    <button title="Record payment" className="btn-secondary px-2 py-1" disabled={!!busy} onClick={() => adjust(r, 'RECORD_PAYMENT')}><HandCoins className="h-4 w-4" /></button>
                    <button title="Waive interest" className="btn-secondary px-2 py-1" disabled={!!busy || r.interest_waived || Number(r.penalty_interest) <= 0} onClick={() => adjust(r, 'WAIVE_INTEREST')}><Percent className="h-4 w-4" /></button>
                    <button title="Re-apply early discount" className="btn-secondary px-2 py-1" disabled={!!busy || Number(r.discount_amount) > 0} onClick={() => adjust(r, 'REAPPLY_DISCOUNT')}><BadgePercent className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && busy !== 'aging' && <Empty>No open receivables.</Empty>}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Settled invoices <span className="text-sm font-normal text-slate-500">(latest {data?.settled.length ?? 0})</span>
        </h2>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Bill</th><th className="th">Dealer</th><th className="th">Purchased</th><th className="th">Received on</th><th className="th">Reference</th>
              <th className="th text-right">Invoice</th><th className="th text-right">Discount</th><th className="th text-right">Interest</th><th className="th text-right">Collected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.settled ?? []).map((o) => (
              <tr key={o.id}>
                <td className="td font-medium">{o.order_no}</td>
                <td className="td">{o.buyer?.business_name}<p className="text-xs text-slate-500">{o.buyer?.gstin}</p></td>
                <td className="td">{formatDate(o.purchase_date)}</td>
                <td className="td">{formatDate(o.settled_on)}</td>
                <td className="td text-xs">{o.settlement_ref ?? '—'}</td>
                <td className="td text-right">{formatINR(o.base_amount)}</td>
                <td className="td text-right">{Number(o.discount_amount) > 0 ? <span className="text-emerald-700">−{formatINR(o.discount_amount)}</span> : '—'}</td>
                <td className="td text-right">{o.interest_waived ? <span className="text-xs text-slate-400">waived</span> : formatINR(o.penalty_interest)}</td>
                <td className="td text-right font-semibold">{formatINR(o.amount_paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.settled.length && busy !== 'aging' && <Empty>No settled invoices yet.</Empty>}
      </div>
    </div>
  );
}
