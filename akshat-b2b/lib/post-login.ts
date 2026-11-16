'use client';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolveResult {
  destination: string;
  blocked: 'PENDING' | 'REJECTED' | null;
  role?: string;
  status?: string;
  onboarded?: boolean;
}

/**
 * After any successful sign-in (password OR Google), ask the server where to go.
 * The server also promotes the configured owner email to ADMIN. Shared by the
 * login page and the OAuth callback so routing + admin bypass live in one place.
 */
export async function resolvePostLogin(sb: SupabaseClient): Promise<ResolveResult> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { destination: '', blocked: null };
  const res = await fetch('/api/auth/resolve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return { destination: '', blocked: null };
  return (await res.json()) as ResolveResult;
}

/** Start the Google OAuth flow, returning to /auth/callback on this origin. */
export async function signInWithGoogle(sb: SupabaseClient): Promise<{ error: string | null }> {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  return { error: error?.message ?? null };
}
