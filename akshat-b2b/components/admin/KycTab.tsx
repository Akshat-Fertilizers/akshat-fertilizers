'use client';
import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Save } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Godown, Profile } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner } from '@/components/ui';

type Draft = { credit_limit: string; godown_id: string };

export function KycTab() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [view, setView] = useState<'pending' | 'approved'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [u, g] = await Promise.all([
      sb.from('users').select('*').eq('role', 'buyer').order('created_at', { ascending: false }),
      sb.from('godowns').select('*').order('id'),
    ]);
    const list = (u.data as Profile[]) ?? [];
    setUsers(list);
    setGodowns((g.data as Godown[]) ?? []);
    setDrafts(Object.fromEntries(list.map((x) => [x.id, { credit_limit: String(x.credit_limit ?? 0), godown_id: x.godown_id ?? '' }])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(u: Profile, is_approved?: boolean) {
    const d = drafts[u.id];
    setBusy(u.id);
    setMsg(null);
    try {
      await apiFetch('/api/admin/kyc', {
        method: 'POST',
        json: { user_id: u.id, is_approved, credit_limit: Number(d.credit_limit), godown_id: d.godown_id || undefined },
      });
      setMsg({ tone: 'green', text: `${u.business_name ?? u.email} updated` });
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Update failed' });
    } finally {
      setBusy(null);
    }
  }

  const list = users.filter((u) => (view === 'pending' ? !u.is_approved : u.is_approved));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">KYC account approvals</h1>
        <div className="ml-auto flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {(['pending', 'approved'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize ${view === v ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}>
              {v} ({users.filter((u) => (v === 'pending' ? !u.is_approved : u.is_approved)).length})
            </button>
          ))}
        </div>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Business</th><th className="th">GSTIN / State</th><th className="th">Registered</th><th className="th">Godown</th><th className="th">Credit limit (₹)</th><th className="th">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((u) => {
              const d = drafts[u.id] ?? { credit_limit: '0', godown_id: '' };
              const set = (k: keyof Draft, v: string) => setDrafts((s) => ({ ...s, [u.id]: { ...d, [k]: v } }));
              return (
                <tr key={u.id}>
                  <td className="td">
                    <p className="font-medium">{u.business_name ?? '—'}</p>
                    <p className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                  </td>
                  <td className="td">
                    <p className="font-mono text-xs">{u.gstin ?? <Badge tone="red">missing</Badge>}</p>
                    <p className="text-xs text-slate-500">{u.state ?? '—'}</p>
                  </td>
                  <td className="td">{formatDate(u.created_at)}</td>
                  <td className="td">
                    <select className="input py-1" value={d.godown_id} onChange={(e) => set('godown_id', e.target.value)}>
                      <option value="">Unassigned</option>
                      {godowns.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
                    </select>
                  </td>
                  <td className="td">
                    <input className="input w-36 py-1" type="number" min={0} step={1000} value={d.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} />
                    <p className="mt-0.5 text-xs text-slate-500">current {formatINR(u.credit_limit)}</p>
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      {u.is_approved ? (
                        <>
                          <button className="btn-secondary px-2 py-1" disabled={busy === u.id} onClick={() => save(u)} title="Save limit / godown"><Save className="h-4 w-4" /></button>
                          <button className="btn-secondary px-2 py-1 text-rose-600" disabled={busy === u.id} onClick={() => confirm('Revoke approval? The dealer loses stock visibility and ordering.') && save(u, false)} title="Revoke"><Ban className="h-4 w-4" /></button>
                        </>
                      ) : (
                        <button className="btn-primary py-1" disabled={busy === u.id || !u.gstin || !d.godown_id} onClick={() => save(u, true)}>
                          {busy === u.id ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Approve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty>No {view} accounts.</Empty>}
      </div>
    </div>
  );
}
