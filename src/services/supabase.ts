import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseConfig, env } from '@/lib/env';

/**
 * The single Supabase client for the browser.
 *
 * Configuration:
 *   - `persistSession: true` keeps the session in localStorage so a refresh does
 *     not sign the player out (persistent sessions are a requirement).
 *   - `autoRefreshToken: true` silently renews the access token.
 *   - `detectSessionInUrl: true` is what lets email confirmation and password
 *     recovery links sign the user in when they land back on the app.
 *   - `flowType: 'pkce'` avoids putting tokens in the URL fragment.
 *
 * The anon key is a *publishable* key. It grants no data access on its own —
 * every table is guarded by Row Level Security.
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const { url, anonKey } = requireSupabaseConfig();
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'last-breath.auth',
    },
    global: { headers: { 'x-application-name': 'last-breath' } },
    db: { schema: 'public' },
  });
  return client;
}

/** True when build-time Supabase configuration is present. */
export function isSupabaseConfigured(): boolean {
  return env.isConfigured;
}

/** Test-only: drop the memoised client so a fresh one can be constructed. */
export function resetSupabaseClient(): void {
  client = null;
}
