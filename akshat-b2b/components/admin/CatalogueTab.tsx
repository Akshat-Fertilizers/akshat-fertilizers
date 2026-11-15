'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, PackageSearch, Plus, Save, Search } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner } from '@/components/ui';

type Draft = { name: string; category: string; dealer_price: string; farmer_price: string; unit: string };
const toDraft = (p: Product): Draft => ({ name: p.name, category: p.category ?? '', dealer_price: p.dealer_price == null ? '' : String(p.dealer_price), farmer_price: p.farmer_price == null ? '' : String(p.farmer_price), unit: p.unit ?? 'BAG' });

export function CatalogueTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from('products').select('*').order('category').order('name');
    const rows = (data as Product[]) ?? [];
    setProducts(rows);
    setDrafts(Object.fromEntries(rows.map((p) => [p.id, toDraft(p)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const field = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (!q || `${p.name} ${p.category ?? ''}`.toLowerCase().includes(q)) && (!onlyUnpriced || p.dealer_price == null || p.farmer_price == null));
  }, [products, query, onlyUnpriced]);
  const counts = useMemo(() => ({ total: products.length, live: products.filter((p) => p.is_active).length, unpriced: products.filter((p) => p.dealer_price == null || p.farmer_price == null).length }), [products]);

  async function save(p: Product, activate?: boolean) {
    const d = drafts[p.id];
    setBusy(p.id); setMsg(null);
    try {
      const body: Record<string, unknown> = { action: 'UPDATE', id: p.id, name: d.name, category: d.category, unit: d.unit,
        dealer_price: d.dealer_price === '' ? null : Number(d.dealer_price), farmer_price: d.farmer_price === '' ? null : Number(d.farmer_price) };
      if (activate !== undefined) body.is_active = activate;
      await apiFetch('/api/admin/products', { method: 'POST', json: body });
      setMsg({ tone: 'green', text: `${d.name} saved${activate === true ? ' and shown to customers' : activate === false ? ' and hidden' : ''}` });
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Save failed' });
    } finally { setBusy(null); }
  }

  async function create() {
    const name = prompt('New product name?'); if (!name) return;
    setBusy('new');
    try { await apiFetch('/api/admin/products', { method: 'POST', json: { action: 'CREATE', name } }); await load(); }
    catch (e) { setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Create failed' }); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-black"><PackageSearch className="h-5 w-5 text-brand-600" /> Products &amp; Dual Pricing</h1>
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <Badge tone="green">{counts.live} live</Badge><Badge tone="amber">{counts.unpriced} un-priced</Badge><Badge>{counts.total} total</Badge>
          <button onClick={create} className="btn-primary" disabled={busy === 'new'}>{busy === 'new' ? <Spinner /> : <Plus className="h-4 w-4" />} New</button>
        </div>
      </div>
      <p className="text-sm text-gray-500">Set a dealer price and a farmer price for each product. A product shows to customers only once both prices are set and it’s switched on.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input pl-9" placeholder="Search product / category" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={onlyUnpriced} onChange={(e) => setOnlyUnpriced(e.target.checked)} /> Only un-priced</label>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr className="text-left text-[11px] font-black uppercase tracking-widest text-gray-500">
            <th className="px-3 py-2">Product</th><th className="px-3 py-2 w-28">Category</th><th className="px-3 py-2 w-20">Unit</th><th className="px-3 py-2 w-28">Dealer ₹</th><th className="px-3 py-2 w-28">Farmer ₹</th><th className="px-3 py-2 w-40">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((p) => {
              const d = drafts[p.id]; if (!d) return null; const saving = busy === p.id;
              return (
                <tr key={p.id} className={cn(!p.is_active && 'bg-amber-50/30')}>
                  <td className="px-3 py-2"><div className="flex items-center gap-2">{p.image_url && <img src={p.image_url} alt="" className="h-9 w-9 shrink-0 rounded border border-gray-200 object-contain" />}<input className="input px-2 py-1 font-bold" value={d.name} onChange={(e) => field(p.id, { name: e.target.value })} /></div></td>
                  <td className="px-3 py-2"><input className="input px-2 py-1" value={d.category} onChange={(e) => field(p.id, { category: e.target.value })} /></td>
                  <td className="px-3 py-2"><input className="input px-2 py-1" value={d.unit} onChange={(e) => field(p.id, { unit: e.target.value })} /></td>
                  <td className="px-3 py-2"><input className="input px-2 py-1" inputMode="decimal" placeholder="—" value={d.dealer_price} onChange={(e) => field(p.id, { dealer_price: e.target.value })} /></td>
                  <td className="px-3 py-2"><input className="input px-2 py-1" inputMode="decimal" placeholder="—" value={d.farmer_price} onChange={(e) => field(p.id, { farmer_price: e.target.value })} /></td>
                  <td className="px-3 py-2"><div className="flex items-center gap-1.5">
                    <button className="btn-secondary px-2 py-1" disabled={saving} onClick={() => save(p)} title="Save">{saving ? <Spinner /> : <Save className="h-4 w-4" />}</button>
                    {p.is_active
                      ? <button className="btn-secondary px-2 py-1 text-red-600" disabled={saving} onClick={() => save(p, false)} title="Hide"><EyeOff className="h-4 w-4" /></button>
                      : <button className="btn-primary px-2 py-1" disabled={saving || d.dealer_price === '' || d.farmer_price === ''} onClick={() => save(p, true)} title={d.dealer_price === '' || d.farmer_price === '' ? 'Set both prices first' : 'Show to customers'}><Eye className="h-4 w-4" /></button>}
                    {p.is_active ? <Badge tone="green">Live</Badge> : (p.dealer_price == null || p.farmer_price == null) ? <Badge tone="amber">No price</Badge> : <Badge>Hidden</Badge>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <Empty>No products match.</Empty>}
      </div>
    </div>
  );
}
