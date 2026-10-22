'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { STAFF_ROLE_LABEL } from '@/lib/business';
import type { Profile, StaffRole } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner } from '@/components/ui';

const ROLES: StaffRole[] = ['manager', 'operations', 'finance', 'stock'];
const TONE: Record<string, 'violet' | 'blue' | 'green' | 'amber'> = { manager: 'violet', operations: 'blue', finance: 'green', stock: 'amber' };

export function TeamTab({ meId }: { meId: string }) {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: React.ReactNode } | null>(null);
  const [form, setForm] = useState({ email: '', name: '', staff_role: 'operations' as StaffRole });

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from('users').select('*').eq('role', 'admin').order('staff_role').order('email');
    setStaff((data as Profile[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setMsg(null);
    try {
      const res = await apiFetch<{ temp_password: string }>('/api/admin/staff', { method: 'POST', json: { action: 'CREATE', ...form } });
      setMsg({
        tone: 'green',
        text: (
          <>
            Worker <b>{form.email}</b> created as {STAFF_ROLE_LABEL[form.staff_role]}. Share this one-time password — they can change it after signing in:{' '}
            <code className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono">{res.temp_password}</code>
          </>
        ),
      });
      setForm({ email: '', name: '', staff_role: 'operations' });
      await load();
    } catch (err) {
      setMsg({ tone: 'red', text: err instanceof Error ? err.message : 'Could not create worker' });
    } finally {
      setBusy(null);
    }
  }

  async function setRole(u: Profile, staff_role: StaffRole | null) {
    setBusy(u.id);
    setMsg(null);
    try {
      await apiFetch('/api/admin/staff', { method: 'POST', json: { action: 'SET_ROLE', user_id: u.id, staff_role } });
      setMsg({ tone: 'green', text: staff_role ? `${u.email} is now ${STAFF_ROLE_LABEL[staff_role]}` : `${u.email} removed from staff` });
      await load();
    } catch (err) {
      setMsg({ tone: 'red', text: err instanceof Error ? err.message : 'Could not update role' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="flex items-center gap-2 text-xl font-semibold"><Users className="h-5 w-5 text-emerald-700" /> Staff &amp; Roles</h1>
      <p className="text-sm text-slate-500">
        Each worker gets their own login and sees only their part of the console. <b>Manager</b> = full access · <b>Operations</b> = order pipeline · <b>Finance</b> = aging &amp; payments · <b>Stock</b> = products, pricing &amp; godown transfer.
      </p>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="w_email">Worker email</label>
          <input id="w_email" type="email" required className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="worker@akshatfertilizer.com" />
        </div>
        <div>
          <label className="label" htmlFor="w_name">Name</label>
          <input id="w_name" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" />
        </div>
        <div>
          <label className="label" htmlFor="w_role">Role</label>
          <select id="w_role" className="input" value={form.staff_role} onChange={(e) => setForm((f) => ({ ...f, staff_role: e.target.value as StaffRole }))}>
            {ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <button className="btn-primary" disabled={busy === 'create'}>{busy === 'create' ? <Spinner /> : <UserPlus className="h-4 w-4" />} Add worker</button>
      </form>

      <div className="card overflow-x-auto">
        <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold"><ShieldCheck className="h-4 w-4" /> Staff accounts <span className="font-normal text-slate-400">({staff.length})</span></h2>
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Email</th><th className="th">Name</th><th className="th">Role</th><th className="th">Added</th><th className="th">Change role</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((u) => {
              const role = u.staff_role ?? 'manager';
              const self = u.id === meId;
              return (
                <tr key={u.id}>
                  <td className="td font-medium">{u.email}{self && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td className="td">{u.business_name ?? '—'}</td>
                  <td className="td"><Badge tone={TONE[role]}>{STAFF_ROLE_LABEL[role]}</Badge></td>
                  <td className="td">{formatDate(u.created_at)}</td>
                  <td className="td">
                    {self ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : busy === u.id ? (
                      <Spinner />
                    ) : (
                      <div className="flex items-center gap-2">
                        <select className="input px-2 py-1" value={role} onChange={(e) => setRole(u, e.target.value as StaffRole)}>
                          {ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>)}
                        </select>
                        <button className="btn-secondary px-2 py-1 text-rose-600" title="Remove from staff" onClick={() => confirm(`Remove ${u.email} from staff? They become a normal account with no admin access.`) && setRole(u, null)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!staff.length && <Empty>No staff yet.</Empty>}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><KeyRound className="h-3.5 w-3.5" /> Workers sign in at /login with the email and one-time password you share, then change it from their account.</p>
    </div>
  );
}
