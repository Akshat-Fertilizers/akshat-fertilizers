'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, Leaf, XCircle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import { resolvePostLogin } from '@/lib/post-login';
import { Spinner } from '@/components/ui';

/**
 * Google OAuth return URL. supabase-js parses the session from the URL, then we
 * ask the server where to route (and promote the owner email to ADMIN).
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<'working' | 'PENDING' | 'REJECTED' | 'error'>('working');

  useEffect(() => {
    const sb = supabaseBrowser();
    let done = false;

    async function finish() {
      if (done) return;
      const { data } = await sb.auth.getSession();
      if (!data.session) return; // wait for onAuthStateChange
      done = true;
      try {
        const { destination, blocked } = await resolvePostLogin(sb);
        if (destination) return router.replace(destination);
        await sb.auth.signOut();
        setState(blocked === 'REJECTED' ? 'REJECTED' : 'PENDING');
      } catch {
        setState('error');
      }
    }

    // If Google returned an error, don't hang.
    const url = new URL(window.location.href);
    if (url.searchParams.get('error') || url.hash.includes('error=')) {
      setState('error');
      return;
    }

    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) void finish();
    });
    void finish();
    const t = setTimeout(() => { if (!done) setState('error'); }, 12000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-50 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-brand-100 bg-white p-8 text-center shadow-sm">
        {state === 'working' && (
          <>
            <Leaf className="mx-auto h-9 w-9 text-brand-600" />
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-gray-600"><Spinner /> Signing you in…</p>
          </>
        )}
        {state === 'PENDING' && (
          <>
            <Clock className="mx-auto h-9 w-9 text-amber-500" />
            <h1 className="text-xl font-black text-gray-900">Account pending approval</h1>
            <p className="text-sm text-gray-600">Thanks for signing in with Google. Our team is completing your KYC offline — the portal unlocks once your account is approved.</p>
            <Link href="/" className="btn-primary inline-flex">Browse website</Link>
          </>
        )}
        {state === 'REJECTED' && (
          <>
            <XCircle className="mx-auto h-9 w-9 text-red-500" />
            <h1 className="text-xl font-black text-gray-900">Account not approved</h1>
            <p className="text-sm text-gray-600">Your registration could not be approved. Please contact our team to proceed.</p>
            <Link href="/" className="btn-primary inline-flex">Browse website</Link>
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle className="mx-auto h-9 w-9 text-red-500" />
            <h1 className="text-xl font-black text-gray-900">Sign-in failed</h1>
            <p className="text-sm text-gray-600">Something went wrong signing in with Google. Please try again.</p>
            <Link href="/login" className="btn-primary inline-flex">Back to login</Link>
          </>
        )}
      </div>
    </div>
  );
}
