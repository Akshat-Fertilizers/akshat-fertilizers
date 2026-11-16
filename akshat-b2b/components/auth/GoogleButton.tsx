'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { signInWithGoogle } from '@/lib/post-login';
import { Spinner } from '@/components/ui';

/** "Continue with Google" — kicks off Supabase Google OAuth. */
export function GoogleButton({ label = 'Continue with Google', onError }: { label?: string; onError?: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await signInWithGoogle(supabaseBrowser());
    if (error) {
      setBusy(false);
      onError?.(error);
    }
    // On success the browser redirects to Google, so no further work here.
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-gray-300 bg-white py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
    >
      {busy ? (
        <Spinner />
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
        </svg>
      )}
      {label}
    </button>
  );
}

/** A labelled "or" divider for the auth forms. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
      <span className="h-px flex-1 bg-gray-200" /> or <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}
