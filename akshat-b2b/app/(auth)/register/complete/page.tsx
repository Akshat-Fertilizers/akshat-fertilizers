'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Sprout, UserCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { INDIAN_STATES } from '@/lib/states';
import { Alert, Spinner } from '@/components/ui';

type Role = 'DEALER' | 'FARMER';

/** First-time Google users complete their profile (pick Dealer/Farmer + KYC details) → PENDING. */
export default function CompleteProfilePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState<string>('');
  const [role, setRole] = useState<Role>('DEALER');
  const [form, setForm] = useState({ mobile: '', whatsapp: '', state: 'Maharashtra', city: '', entity_name: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Must be signed in; if already onboarded, bounce to the resolver's destination.
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.getSession();
      if (!data.session) return router.replace('/login');
      setName(data.session.user.user_metadata?.full_name || data.session.user.user_metadata?.name || '');
      const { data: p } = await sb.from('profiles').select('role, onboarded, status').eq('id', data.session.user.id).single();
      if (p?.role === 'ADMIN') return router.replace('/admin/dashboard');
      if (p?.onboarded) return router.replace(p.status === 'APPROVED' ? '/portal' : '/');
      setReady(true);
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[0-9+ ]{10,15}$/.test(form.mobile.trim())) return setError('Enter a valid mobile number.');
    if (form.entity_name.trim().length < 2) return setError(role === 'DEALER' ? 'Enter your business name.' : 'Enter your farm name.');
    setBusy(true);
    try {
      await apiFetch('/api/onboarding', { method: 'POST', json: { role, ...form } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="flex justify-center py-10"><Spinner /></div>;

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black text-gray-900">Registration received</h1>
        <Alert tone="green">
          Thank you for registering with Akshat Fertilizers! Our team will contact you on WhatsApp or by phone to collect the required documents and
          complete your registration. In the meantime, you can continue browsing our website.
        </Alert>
        <div className="flex gap-2">
          <Link href="/" className="btn-secondary flex-1">Browse website</Link>
          <Link href="/login" className="btn-primary flex-1">Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Complete your profile</h1>
        <p className="mt-1 text-sm text-gray-500">{name ? `Welcome, ${name}. ` : ''}Tell us a little more so we can set up your account.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
        {(['DEALER', 'FARMER'] as Role[]).map((r) => (
          <button key={r} type="button" onClick={() => setRole(r)}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-black transition ${role === r ? 'bg-white text-brand-700 shadow' : 'text-gray-500'}`}>
            {r === 'DEALER' ? <Building2 className="h-4 w-4" /> : <Sprout className="h-4 w-4" />} {r === 'DEALER' ? 'Dealer' : 'Farmer'}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label">{role === 'DEALER' ? 'Business name' : 'Farm name'}</label>
        <input className="input" required value={form.entity_name} onChange={set('entity_name')} placeholder={role === 'DEALER' ? 'e.g. Pune Agro Traders' : 'e.g. Green Valley Farm'} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Mobile</label><input className="input" type="tel" required value={form.mobile} onChange={set('mobile')} /></div>
        <div><label className="label">WhatsApp</label><input className="input" type="tel" value={form.whatsapp} onChange={set('whatsapp')} placeholder="same as mobile" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">State</label>
          <select className="input" value={form.state} onChange={set('state')}>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="label">City</label><input className="input" value={form.city} onChange={set('city')} /></div>
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : <UserCheck className="h-4 w-4" />} Finish registration</button>
    </form>
  );
}
