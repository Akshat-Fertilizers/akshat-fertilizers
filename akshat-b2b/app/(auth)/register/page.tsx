'use client';
import { useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { INDIAN_STATES, validateGstin } from '@/lib/states';
import { Alert, Spinner } from '@/components/ui';

export default function RegisterPage() {
  const [form, setForm] = useState({ business_name: '', gstin: '', state: 'Maharashtra', phone: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const gstErr = validateGstin(form.gstin, form.state);
    if (gstErr) return setError(gstErr);
    if (form.business_name.trim().length < 3) return setError('Enter your registered business name.');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { business_name: form.business_name.trim(), gstin: form.gstin.trim().toUpperCase(), state: form.state, phone: form.phone.trim() },
      },
    });
    setBusy(false);
    if (error) {
      setError(/database error/i.test(error.message) ? 'This GSTIN is already registered or invalid.' : error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-black text-gray-900">Registration received</h1>
        <Alert tone="green">
          Please verify your email. Our accounts team will review your details and set your credit limit — you can view stock and place indents once
          your account is approved.
        </Alert>
        <Link href="/login" className="btn-secondary w-full">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-2xl font-black text-gray-900">Register as a B2B dealer</h1>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label">Business name (as per GST)</label>
        <input className="input" required value={form.business_name} onChange={set('business_name')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">GSTIN</label>
          <input className="input uppercase" required maxLength={15} placeholder="27ABCDE1234F1Z5" value={form.gstin} onChange={set('gstin')} />
        </div>
        <div>
          <label className="label">State</label>
          <select className="input" value={form.state} onChange={set('state')}>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Mobile</label>
        <input className="input" type="tel" pattern="[0-9+ ]{10,15}" value={form.phone} onChange={set('phone')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        </div>
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : <UserPlus className="h-4 w-4" />} Submit for Approval
      </button>
      <p className="text-center text-sm text-slate-500">
        Already registered? <Link className="font-medium text-brand-700 hover:underline" href="/login">Sign in</Link>
      </p>
    </form>
  );
}
