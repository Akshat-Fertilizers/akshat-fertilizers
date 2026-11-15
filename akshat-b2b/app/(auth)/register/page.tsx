'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Building2, Sprout, UserPlus } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { INDIAN_STATES } from '@/lib/states';
import { Alert, Spinner } from '@/components/ui';

type Role = 'DEALER' | 'FARMER';

function RegisterForm() {
  const sp = useSearchParams();
  const initial = (sp.get('type')?.toUpperCase() === 'FARMER' ? 'FARMER' : 'DEALER') as Role;
  const [role, setRole] = useState<Role>(initial);
  const [form, setForm] = useState({ full_name: '', mobile: '', whatsapp: '', email: '', password: '', state: 'Maharashtra', city: '', entity_name: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.full_name.trim().length < 3) return setError('Enter your full name.');
    if (!/^[0-9+ ]{10,15}$/.test(form.mobile.trim())) return setError('Enter a valid mobile number.');
    if (form.entity_name.trim().length < 2) return setError(role === 'DEALER' ? 'Enter your business name.' : 'Enter your farm name.');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await apiFetch('/api/register', { method: 'POST', json: { role, ...form } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

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
      <h1 className="text-2xl font-black text-gray-900">Create your account</h1>
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
        <label className="label">Full name</label>
        <input className="input" required value={form.full_name} onChange={set('full_name')} />
      </div>
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
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Email</label><input className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></div>
        <div><label className="label">Password</label><input className="input" type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} /></div>
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : <UserPlus className="h-4 w-4" />} Register as {role === 'DEALER' ? 'Dealer' : 'Farmer'}</button>
      <p className="text-center text-sm text-gray-500">Already registered? <Link className="font-bold text-brand-700 hover:underline" href="/login">Log in</Link></p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
