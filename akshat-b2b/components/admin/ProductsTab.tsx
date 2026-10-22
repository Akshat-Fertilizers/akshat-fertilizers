'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Eye, EyeOff, PackageSearch, Save, Search } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Godown, InventoryRow, Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner } from '@/components/ui';

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

interface Draft {
  price: string;
  gst_rate: string;
  hsn_code: string;
  unit: string;
  pack_label: string;
  stock: Record<string, string>;
}

const toDraft = (p: Product, inv: InventoryRow[], godowns: Godown[]): Draft => ({
  price: p.price == null ? '' : String(p.price),
  gst_rate: String(p.gst_rate),
  hsn_code: p.hsn_code ?? '',
  unit: p.unit ?? 'BAG',
  pack_label: p.pack_label ?? '',
  stock: Object.fromEntries(godowns.map((g) => [g.id, String(inv.find((r) => r.product_id === p.id && r.godown_id === g.id)?.stock_qty ?? 0)])),
});

export function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [inv, setInv] = useState<InventoryRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [p, g, i] = await Promise.all([
      sb.from('products').select('*').order('category').order('sort_order').order('name'),
      sb.from('godowns').select('*').order('id'),
      sb.from('inventory').select('*'),
    ]);
    const prods = (p.data as Product[]) ?? [];
    const gds = (g.data as Godown[]) ?? [];
    const inventory = (i.data as InventoryRow[]) ?? [];
    setProducts(prods);
    setGodowns(gds);
    setInv(inventory);
    setDrafts(Object.fromEntries(prods.map((pr) => [pr.id, toDraft(pr, inventory, gds)])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const setStock = (id: string, godown: string, v: string) => setDrafts((d) => ({ ...d, [id]: { ...d[id], stock: { ...d[id].stock, [godown]: v } } }));

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = products.filter(
      (p) => (!q || `${p.name} ${p.sku} ${p.category} ${p.subcategory ?? ''}`.toLowerCase().includes(q)) && (!onlyUnpriced || p.price == null),
    );
    const byCat = new Map<string, Product[]>();
    for (const p of shown) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
    return Array.from(byCat);
  }, [products, query, onlyUnpriced]);

  const counts = useMemo(() => ({ total: products.length, live: products.filter((p) => p.is_active).length, unpriced: products.filter((p) => p.price == null).length }), [products]);

  async function save(p: Product, activate?: boolean) {
    const d = drafts[p.id];
    setBusy(p.id);
    setMsg(null);
    try {
      const stock: Record<string, number> = {};
      for (const g of godowns) {
        const n = Number(d.stock[g.id]);
        if (Number.isInteger(n) && n !== (inv.find((r) => r.product_id === p.id && r.godown_id === g.id)?.stock_qty ?? 0)) stock[g.id] = n;
      }
      const body: Record<string, unknown> = {
        product_id: p.id,
        price: d.price === '' ? null : Number(d.price),
        gst_rate: Number(d.gst_rate),
        hsn_code: d.hsn_code,
        unit: d.unit,
        pack_label: d.pack_label,
        stock,
      };
      if (activate !== undefined) body.is_active = activate;
      await apiFetch('/api/admin/products', { method: 'POST', json: body });
      setMsg({ tone: 'green', text: `${p.name} saved${activate === true ? ' and shown to dealers' : activate === false ? ' and hidden' : ''}` });
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold"><PackageSearch className="h-5 w-5 text-brand-700" /> Products &amp; Pricing</h1>
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          <Badge tone="green">{counts.live} live</Badge>
          <Badge tone="amber">{counts.unpriced} un-priced</Badge>
          <Badge>{counts.total} total</Badge>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Catalogue imported from akshatfertilizer.com. Set the dealer price, GST, pack size and opening stock per godown, then switch a product on to show it to dealers. Dealers never see un-priced or hidden products.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search product / SKU / category" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyUnpriced} onChange={(e) => setOnlyUnpriced(e.target.checked)} /> Only un-priced
        </label>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {groups.map(([category, items]) => (
        <section key={category} className="card overflow-hidden">
          <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-semibold">{category} <span className="font-normal text-slate-400">({items.length})</span></h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 w-28">Price ₹</th>
                  <th className="px-3 py-2 w-24">GST %</th>
                  <th className="px-3 py-2 w-24">HSN</th>
                  <th className="px-3 py-2 w-28">Pack</th>
                  {godowns.map((g) => <th key={g.id} className="px-3 py-2 w-24">{g.id.replace('_GODOWN', '')} stock</th>)}
                  <th className="px-3 py-2 w-40">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((p) => {
                  const d = drafts[p.id];
                  if (!d) return null;
                  const saving = busy === p.id;
                  return (
                    <tr key={p.id} className={cn(p.is_active ? '' : 'bg-amber-50/30')}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {p.image_url && <img src={p.image_url} alt="" className="h-9 w-9 shrink-0 rounded border border-slate-200 object-contain" loading="lazy" />}
                          <div className="min-w-0">
                            <p className="font-medium leading-tight">{p.name}</p>
                            <p className="truncate text-xs text-slate-500">{p.subcategory ?? p.sku}{p.source_url && <a href={p.source_url} target="_blank" rel="noopener" className="ml-1 inline-flex text-brand-700"><ExternalLink className="inline h-3 w-3" /></a>}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><input className="input px-2 py-1" inputMode="decimal" placeholder="—" value={d.price} onChange={(e) => setField(p.id, { price: e.target.value })} /></td>
                      <td className="px-3 py-2">
                        <select className="input px-2 py-1" value={d.gst_rate} onChange={(e) => setField(p.id, { gst_rate: e.target.value })}>
                          {GST_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><input className="input px-2 py-1" value={d.hsn_code} onChange={(e) => setField(p.id, { hsn_code: e.target.value })} /></td>
                      <td className="px-3 py-2"><input className="input px-2 py-1" placeholder="25 kg bag" value={d.pack_label} onChange={(e) => setField(p.id, { pack_label: e.target.value })} /></td>
                      {godowns.map((g) => (
                        <td key={g.id} className="px-3 py-2"><input className="input px-2 py-1" inputMode="numeric" value={d.stock[g.id] ?? '0'} onChange={(e) => setStock(p.id, g.id, e.target.value)} /></td>
                      ))}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button className="btn-secondary px-2 py-1" disabled={saving} onClick={() => save(p)} title="Save">{saving ? <Spinner /> : <Save className="h-4 w-4" />}</button>
                          {p.is_active ? (
                            <button className="btn-secondary px-2 py-1 text-rose-600" disabled={saving} onClick={() => save(p, false)} title="Hide from dealers"><EyeOff className="h-4 w-4" /></button>
                          ) : (
                            <button className="btn-primary px-2 py-1" disabled={saving || d.price === ''} onClick={() => save(p, true)} title={d.price === '' ? 'Set a price first' : 'Show to dealers'}><Eye className="h-4 w-4" /></button>
                          )}
                          {p.is_active ? <Badge tone="green">Live</Badge> : p.price == null ? <Badge tone="amber">No price</Badge> : <Badge>Hidden</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!groups.length && <div className="card"><Empty>No products match.</Empty></div>}    </div>
  );
}
