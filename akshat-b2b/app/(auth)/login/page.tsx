'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { Alert, Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setError(error?.message ?? 'Sign-in failed');
      setBusy(false);
      return;
    }
    const { data: profile } = await sb.from('users').select('role').eq('id', data.user.id).single();
    router.replace(profile?.role === 'admin' ? '/admin/dashboard' : '/home');
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Dealer sign in</h1>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : <LogIn className="h-4 w-4" />} Sign in
      </button>
      <p className="text-center text-sm text-slate-500">
        New dealer? <Link className="font-medium text-emerald-700 hover:underline" href="/register">Register for a B2B account</Link>
      </p>
    </form>
  );
}
