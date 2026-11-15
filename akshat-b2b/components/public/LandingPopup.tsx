'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, LogIn, Sprout, X } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';

/**
 * Landing pop-up: appears for logged-out visitors (once per browser session),
 * introduces the portal and prompts registration. Suppressed when signed in.
 */
export function LandingPopup() {
  const [open, setOpen] = useState(false);
  const [signup, setSignup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (cancelled) return;
      if (data.session) return; // logged in → suppress
      let seen = false;
      try {
        seen = sessionStorage.getItem('akf-landing') === '1';
      } catch {
        /* private mode */
      }
      if (!seen) {
        setOpen(true);
        try {
          sessionStorage.setItem('akf-landing', '1');
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl animate-[slideUp_0.4s_cubic-bezier(0.16,1,0.3,1)]" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-gray-100 p-2 text-gray-400 hover:text-gray-900"><X className="h-4 w-4" /></button>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-2xl font-black text-white">A</div>
        <h2 className="text-2xl font-black text-gray-900">Welcome to Akshat Fertilizers</h2>
        <p className="mt-2 text-gray-600">
          Register to unlock dealer &amp; farmer pricing, seasonal offers and online ordering. Browsing is open to everyone — prices show after you log in.
        </p>
        {!signup ? (
          <div className="mt-6 space-y-2">
            <Link href="/login" className="btn-primary w-full"><LogIn className="h-4 w-4" /> Log In</Link>
            <button onClick={() => setSignup(true)} className="btn-secondary w-full">Sign Up</button>
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            <Link href="/register?type=dealer" className="btn-primary w-full"><Building2 className="h-4 w-4" /> Register as a Dealer</Link>
            <Link href="/register?type=farmer" className="btn-secondary w-full"><Sprout className="h-4 w-4" /> Register as a Farmer</Link>
            <button onClick={() => setSignup(false)} className="w-full py-1 text-sm font-semibold text-gray-400 hover:text-gray-700">← Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
