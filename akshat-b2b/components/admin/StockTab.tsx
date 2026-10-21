'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, PackagePlus, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Godown, InventoryRow, Product } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { Alert, Spinner } from '@/components/ui';

interface Movement { id: number; movement_type: string; product_id: string; from_godown_id: string | null; to_godown_id: string | null; qty: number; note: string | null; created_at: string }

export function StockTab({ adminId }: { adminId: string }) {
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inv, setInv] = useState<InventoryRow[]>([]);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [t, setT] = useState({ product_id: '', from: 'MH_GODOWN', to: 'MP_GODOWN', qty: '', note: '' });
  const [a, setA] = useState({ product_id: '', godown: 'MH_GODOWN', qty: '', note: '' });

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [g, p, i, m] = await Promise.all([
      sb.from('godowns').select('*').order('id'),
      sb.from('products').select('*').order('name'),
      sb.from('inventory').select('*'),
      sb.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(25),
    ]);
    setGodowns((g.data as Godown[]) ?? []);
    setProducts((p.data as Product[]) ?? []);
    setInv((i.data as InventoryRow[]) ?? []);
    setMoves((m.data as Movement[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load, adminId]);

  const qty = useMemo(() => {
    const m = new Map<string, number>();
    inv.forEach((r) => m.set(`${r.godown_id}|${r.product_id}`, r.stock_qty));
    return (g: string, p: string) => m.get(`${g}|${p}`) ?? 0;
  }, [inv]);
  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  async function submit(json: Record<string, unknown>, reset: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/api/admin/stock', { method: 'POST', json });
      setMsg({ tone: 'green', text: 'Stock updated' });
      reset();
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Stock update failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Godown stock</h1>
        <button onClick={load} className="btn-secondary ml-auto"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Product</th>{godowns.map((g) => <th key={g.id} className="th text-right">{g.name}</th>)}<th className="th text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => {
              const total = godowns.reduce((s, g) => s + qty(g.id, p.id), 0);
              return (
                <tr key={p.id} className={cn(!p.is_active && 'opacity-50')}>
                  <td className="td font-medium">{p.name}<p className="text-xs text-slate-500">{p.sku}</p></td>
                  {godowns.map((g) => {
                    const q = qty(g.id, p.id);
                    return <td key={g.id} className={cn('td text-right tabular-nums', q === 0 ? 'text-rose-600' : q < 100 ? 'text-amber-700' : '')}>{q.toLocaleString('en-IN')}</td>;
                  })}
                  <td className="td text-right font-semibold tabular-nums">{total.toLocaleString('en-IN')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <form
          className="card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: 'TRANSFER', product_id: t.product_id, from_godown_id: t.from, to_godown_id: t.to, qty: Number(t.qty), note: t.note }, () => setT({ ...t, qty: '', note: '' }));
          }}
        >
          <h2 className="font-semibold">Inter-godown transfer</h2>
          <select className="input" required value={t.product_id} onChange={(e) => setT({ ...t, product_id: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <select className="input" value={t.from} onChange={(e) => setT({ ...t, from: e.target.value })}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name} ({t.product_id ? qty(g.id, t.product_id) : '–'})</option>)}
            </select>
            <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
            <select className="input" value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" type="number" min={1} required placeholder="Qty (bags)" value={t.qty} onChange={(e) => setT({ ...t, qty: e.target.value })} />
            <input className="input col-span-2" placeholder="Note / truck no." value={t.note} onChange={(e) => setT({ ...t, note: e.target.value })} />
          </div>
          <button className="btn-primary w-full" disabled={busy || t.from === t.to}>{busy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Transfer stock</button>
        </form>

        <form
          className="card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: 'ADJUST', product_id: a.product_id, godown_id: a.godown, qty: Number(a.qty), note: a.note }, () => setA({ ...a, qty: '', note: '' }));
          }}
        >
          <h2 className="font-semibold">Inward receipt / write-off</h2>
          <select className="input" required value={a.product_id} onChange={(e) => setA({ ...a, product_id: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input" value={a.godown} onChange={(e) => setA({ ...a, godown: e.target.value })}>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" type="number" required placeholder="+in / −out" value={a.qty} onChange={(e) => setA({ ...a, qty: e.target.value })} />
            <input className="input col-span-2" placeholder="GRN / reason" value={a.note} onChange={(e) => setA({ ...a, note: e.target.value })} />
          </div>
          <button className="btn-secondary w-full" disabled={busy}>{busy ? <Spinner /> : <PackagePlus className="h-4 w-4" />} Post adjustment</button>
        </form>
      </div>

      <div className="card">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Recent movements</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {moves.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="w-24 text-xs text-slate-500">{formatDate(m.created_at)}</span>
              <span className="font-medium">{m.movement_type}</span>
              <span>{m.qty} × {pname(m.product_id)}</span>
              <span className="text-slate-500">{m.from_godown_id ?? '—'} → {m.to_godown_id ?? '—'}</span>
              {m.note && <span className="text-xs text-slate-400">{m.note}</span>}
            </li>
          ))}
          {!moves.length && <li className="px-4 py-6 text-center text-slate-500">No movements yet.</li>}
        </ul>
      </div>
    </div>
  );
}
