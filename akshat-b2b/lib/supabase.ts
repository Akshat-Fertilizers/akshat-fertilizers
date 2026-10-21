'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

/** Lazily-created browser client (session persisted in localStorage). */
export function supabaseBrowser(): SupabaseClient {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set');
    browserClient = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'af-b2b-auth' },
    });
  }
  return browserClient;
}
