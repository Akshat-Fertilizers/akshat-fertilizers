'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, LogIn, XCircle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { Alert, Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<'PENDING' | 'REJECTED' | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBlocked(null);
    const sb = supabaseBrowser();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setError(error?.message ?? 'Sign-in failed');
      setBusy(false);
      return;
    }
    const { data: profile } = await sb.from('profiles').select('role, status').eq('id', data.user.id).single();
    if (profile?.role === 'ADMIN') return router.replace('/admin/dashboard');
    if (profile?.status === 'APPROVED') return router.replace('/portal');
    // Not approved — block portal access, keep them signed out of the portal.
    await sb.auth.signOut();
    setBlocked(profile?.status === 'REJECTED' ? 'REJECTED' : 'PENDING');
    setBusy(false);
  }

  if (blocked) {
    return (
      <div className="space-y-4 text-center">
        {blocked === 'PENDING' ? <Clock className="mx-auto h-10 w-10 text-amber-500" /> : <XCircle className="mx-auto h-10 w-10 text-red-500" />}
        <h1 className="text-2xl font-black text-gray-900">{blocked === 'PENDING' ? 'Account pending approval' : 'Account not approved'}</h1>
        <p className="text-sm text-gray-600">
          {blocked === 'PENDING'
            ? 'Our team is completing your KYC offline. You can browse the website meanwhile; the portal unlocks once your account is approved.'
            : 'Your registration could not be approved. Please contact our team to proceed.'}
        </p>
        <div className="flex gap-2">
          <Link href="/" className="btn-secondary flex-1">Browse website</Link>
          <button onClick={() => setBlocked(null)} className="btn-primary flex-1">Try another account</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-2xl font-black text-gray-900">Customer login</h1>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : <LogIn className="h-4 w-4" />} Log in</button>
      <p className="text-center text-sm text-gray-500">
        New to Akshat? <Link className="font-bold text-brand-700 hover:underline" href="/register">Register as Dealer or Farmer</Link>
      </p>
    </form>
  );
}
