/**
 * Typed access to build-time environment configuration.
 *
 * Only `VITE_`-prefixed values reach the browser bundle. Server-only secrets
 * (service-role key, database URL) are never read here — they exist solely for
 * local tooling and must never be shipped to the client.
 */

export interface AppEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly siteUrl: string;
  readonly isConfigured: boolean;
}

function read(key: string): string {
  const raw = (import.meta.env as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

const supabaseUrl = read('VITE_SUPABASE_URL');
const supabaseAnonKey = read('VITE_SUPABASE_ANON_KEY');

/** Where Supabase should send the user back after an email link. */
function resolveSiteUrl(): string {
  const explicit = read('VITE_SITE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:12000';
}

export const env: AppEnv = Object.freeze({
  supabaseUrl,
  supabaseAnonKey,
  siteUrl: resolveSiteUrl(),
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
});

/**
 * Fail loudly and early rather than letting a half-configured client produce
 * confusing network errors deep inside a request.
 */
export function requireSupabaseConfig(): { url: string; anonKey: string } {
  if (!env.isConfigured) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
        'in .env.local (see .env.example) and restart the dev server.',
    );
  }
  return { url: env.supabaseUrl, anonKey: env.supabaseAnonKey };
}
