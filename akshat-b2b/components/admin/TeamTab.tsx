'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { STAFF_TIER_LABEL } from '@/lib/business';
import type { Profile, StaffTier } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner } from '@/components/ui';

const TIERS: StaffTier[] = ['manager', 'operations', 'finance', 'catalog'];
const TONE: Record<string, 'violet' | 'blue' | 'green' | 'amber'> = { manager: 'violet', operations: 'blue', finance: 'green', catalog: 'amber' };

export function TeamTab({ meId }: { meId: string }) {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: React.ReactNode } | null>(null);
  const [form, setForm] = useState({ email: '', name: '', tier: 'operations' as StaffTier });

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from('profiles').select('*').eq('role', 'ADMIN').order('staff_tier').order('email');
    setStaff((data as Profile[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy('create'); setMsg(null);
    try {
      const res = await apiFetch<{ temp_password: string }>('/api/admin/staff', { method: 'POST', json: { action: 'CREATE', ...form } });
      setMsg({ tone: 'green', text: <>Worker <b>{form.email}</b> created as {STAFF_TIER_LABEL[form.tier]}. One-time password: <code className="rounded bg-brand-100 px-1.5 py-0.5 font-mono">{res.temp_password}</code></> });
      setForm({ email: '', name: '', tier: 'operations' }); await load();
    } catch (err) { setMsg({ tone: 'red', text: err instanceof Error ? err.message : 'Failed' }); }
    finally { setBusy(null); }
  }
  async function setTier(u: Profile, tier: StaffTier | null) {
    setBusy(u.id); setMsg(null);
    try { await apiFetch('/api/admin/staff', { method: 'POST', json: { action: 'SET_TIER', user_id: u.id, tier } }); setMsg({ tone: 'green', text: tier ? `${u.email} is now ${STAFF_TIER_LABEL[tier]}` : `${u.email} removed from staff` }); await load(); }
    catch (err) { setMsg({ tone: 'red', text: err instanceof Error ? err.message : 'Failed' }); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <h1 className="flex items-center gap-2 text-xl font-black"><Users className="h-5 w-5 text-brand-600" /> Staff &amp; Roles</h1>
      <p className="text-sm text-gray-500"><b>Manager</b> = full access · <b>Operations</b> = orders · <b>Finance</b> = payments &amp; credit · <b>Catalogue</b> = products &amp; pricing.</p>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div><label className="label">Worker email</label><input type="email" required className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div><label className="label">Tier</label><select className="input" value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value as StaffTier }))}>{TIERS.map((t) => <option key={t} value={t}>{STAFF_TIER_LABEL[t]}</option>)}</select></div>
        <button className="btn-primary" disabled={busy === 'create'}>{busy === 'create' ? <Spinner /> : <UserPlus className="h-4 w-4" />} Add worker</button>
      </form>
      <div className="card overflow-x-auto">
        <h2 className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 font-black"><ShieldCheck className="h-4 w-4" /> Staff accounts <span className="font-normal text-gray-400">({staff.length})</span></h2>
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Email</th><th className="th">Name</th><th className="th">Tier</th><th className="th">Added</th><th className="th">Change</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((u) => {
              const tier = u.staff_tier ?? 'manager'; const self = u.id === meId;
              return (
                <tr key={u.id}>
                  <td className="td font-bold">{u.email}{self && <span className="ml-1 text-xs text-gray-400">(you)</span>}</td>
                  <td className="td">{u.full_name ?? '—'}</td>
                  <td className="td"><Badge tone={TONE[tier]}>{STAFF_TIER_LABEL[tier]}</Badge></td>
                  <td className="td text-xs">{formatDate(u.created_at)}</td>
                  <td className="td">{self ? <span className="text-xs text-gray-400">—</span> : busy === u.id ? <Spinner /> : (
                    <div className="flex items-center gap-2">
                      <select className="input px-2 py-1" value={tier} onChange={(e) => setTier(u, e.target.value as StaffTier)}>{TIERS.map((t) => <option key={t} value={t}>{STAFF_TIER_LABEL[t]}</option>)}</select>
                      <button className="btn-secondary px-2 py-1 text-red-600" title="Remove from staff" onClick={() => confirm(`Remove ${u.email} from staff?`) && setTier(u, null)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!staff.length && <Empty>No staff yet.</Empty>}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-gray-400"><KeyRound className="h-3.5 w-3.5" /> Workers sign in at /login with the email and one-time password you share.</p>
    </div>
  );
}
