'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, MessageCircle, Phone, Users, XCircle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Profile, Role, Status } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { waLink, waMsg } from '@/lib/whatsapp';
import { Alert, Badge, Empty, Spinner, STATUS_TONE } from '@/components/ui';

export function CustomersTab() {
  const [rows, setRows] = useState<Profile[]>([]);
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [status, setStatus] = useState<Status | 'ALL'>('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from('profiles').select('*').neq('role', 'ADMIN').order('created_at', { ascending: false });
    setRows((data as Profile[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => rows.filter((r) => (role === 'ALL' || r.role === role) && (status === 'ALL' || r.status === status)), [rows, role, status]);
  const counts = useMemo(() => ({ PENDING: rows.filter((r) => r.status === 'PENDING').length, APPROVED: rows.filter((r) => r.status === 'APPROVED').length, REJECTED: rows.filter((r) => r.status === 'REJECTED').length }), [rows]);

  async function setCustomerStatus(u: Profile, next: Status) {
    setBusy(u.id);
    setMsg(null);
    try {
      await apiFetch('/api/admin/customers', { method: 'POST', json: { user_id: u.id, status: next } });
      setMsg({ tone: 'green', text: `${u.entity_name ?? u.full_name} ${next.toLowerCase()}` });
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Update failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-black"><Users className="h-5 w-5 text-brand-600" /> Customers &amp; KYC</h1>
        <div className="ml-auto flex items-center gap-2">
          <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value as Role | 'ALL')}>
            <option value="ALL">All types</option><option value="DEALER">Dealers</option><option value="FARMER">Farmers</option>
          </select>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as Status | 'ALL')}>
            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All status' : s} {s !== 'ALL' ? `(${counts[s] ?? 0})` : ''}</option>)}
          </select>
        </div>
      </div>
      <p className="text-sm text-gray-500">Approve or reject after collecting KYC offline. Use WhatsApp / Call to coordinate and notify customers.</p>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Customer</th><th className="th">Type</th><th className="th">Contact</th><th className="th">Location</th><th className="th">Registered</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((u) => (
              <tr key={u.id}>
                <td className="td"><p className="font-black">{u.entity_name ?? '—'}</p><p className="text-xs text-gray-500">{u.full_name} · {u.email}</p></td>
                <td className="td"><Badge tone={STATUS_TONE[u.role]}>{u.role}</Badge></td>
                <td className="td text-xs">{u.mobile}{u.whatsapp && u.whatsapp !== u.mobile && <><br />wa: {u.whatsapp}</>}</td>
                <td className="td text-xs">{[u.city, u.state].filter(Boolean).join(', ') || '—'}</td>
                <td className="td text-xs">{formatDate(u.created_at)}</td>
                <td className="td"><Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge></td>
                <td className="td">
                  <div className="flex items-center gap-1.5">
                    <a href={waLink(u.status === 'APPROVED' ? waMsg.approval(u.full_name ?? '') : waMsg.registration(u.entity_name ?? '', u.role), u.whatsapp ?? u.mobile ?? undefined)} target="_blank" rel="noopener" title="WhatsApp" className="rounded-lg bg-brand-50 p-2 text-brand-700 hover:bg-brand-100"><MessageCircle className="h-4 w-4" /></a>
                    <a href={`tel:${u.mobile ?? ''}`} title="Call" className="rounded-lg bg-gray-100 p-2 text-gray-600 hover:bg-gray-200"><Phone className="h-4 w-4" /></a>
                    {busy === u.id ? <Spinner /> : (
                      <>
                        {u.status !== 'APPROVED' && <button onClick={() => setCustomerStatus(u, 'APPROVED')} className={cn('rounded-lg bg-brand-600 px-2 py-2 text-white hover:bg-brand-700')} title="Approve"><CheckCircle2 className="h-4 w-4" /></button>}
                        {u.status !== 'REJECTED' && <button onClick={() => confirm(`Reject ${u.entity_name ?? u.full_name}?`) && setCustomerStatus(u, 'REJECTED')} className="rounded-lg bg-red-600 px-2 py-2 text-white hover:bg-red-700" title="Reject"><XCircle className="h-4 w-4" /></button>}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <Empty>No customers in this view.</Empty>}
      </div>
    </div>
  );
}
