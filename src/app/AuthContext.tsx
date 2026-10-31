import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import * as authService from '@/services/authService';
import { fetchProfile, touchLastSeen } from '@/services/profileService';
import { isSupabaseConfigured } from '@/services/supabase';
import { toAppError, type AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { Profile } from '@/services/types';

const log = createLogger('auth-context');

export interface AuthContextValue {
  /** The Supabase user, or null when signed out. */
  user: User | null;
  session: Session | null;
  /** The public profile row (username etc.), or null while it loads. */
  profile: Profile | null;
  /** True until the initial session restore has finished. */
  initialising: boolean;
  /** True when a sign-in / sign-up request is in flight. */
  busy: boolean;
  error: AppError | null;
  /** True when the project has no Supabase credentials configured. */
  misconfigured: boolean;
  /** True when the account still needs its email confirmed. */
  emailUnconfirmed: boolean;
  signIn: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signUp: (email: string, password: string, username: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  /** Re-reads the profile row, e.g. after a rename. */
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const misconfigured = !isSupabaseConfigured();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Loads the profile for a user, tolerating the narrow post-signup window in
   * which the provisioning trigger has not committed yet. */
  const loadProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const row = await fetchProfile(userId);
        if (row) return row;
      } catch (err) {
        log.warn('profile fetch failed', toAppError(err).message);
      }
      // 150ms, 300ms, 600ms — enough for a trigger to commit, short enough that
      // a genuine failure still surfaces quickly.
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
    return null;
  }, []);

  // Restore any persisted session on mount, then subscribe to changes.
  useEffect(() => {
    if (misconfigured) {
      setInitialising(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const restored = await authService.getSession();
        if (cancelled || !mounted.current) return;
        setSession(restored);
        if (restored?.user) {
          const row = await loadProfile(restored.user.id);
          if (!cancelled && mounted.current) setProfile(row);
        }
      } catch (err) {
        log.warn('session restore failed', toAppError(err).message);
      } finally {
        if (!cancelled && mounted.current) setInitialising(false);
      }

      const subscription = authService.onAuthStateChange((next) => {
        if (cancelled || !mounted.current) return;
        setSession(next);
        if (!next?.user) {
          setProfile(null);
          return;
        }
        void loadProfile(next.user.id).then((row) => {
          if (!cancelled && mounted.current) setProfile(row);
        });
      });
      unsubscribe = subscription.unsubscribe;
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [misconfigured, loadProfile]);

  // Record activity, but only once per mount and never as a blocking operation.
  useEffect(() => {
    if (!session?.user) return;
    void touchLastSeen(session.user.id);
  }, [session?.user?.id, session?.user]);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const row = await loadProfile(userId);
    if (mounted.current) setProfile(row);
  }, [session?.user?.id, loadProfile]);

  const withBusy = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (err) {
      const appError = toAppError(err);
      if (mounted.current) setError(appError);
      throw appError;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      initialising,
      busy,
      error,
      misconfigured,
      emailUnconfirmed: Boolean(session?.user && !authService.isEmailConfirmed(session.user)),
      async signIn(email, password) {
        return withBusy(async () => {
          const result = await authService.signInWithEmail(email, password);
          if (result.user) {
            const row = await loadProfile(result.user.id);
            if (mounted.current) setProfile(row);
          }
          return { needsEmailConfirmation: result.needsEmailConfirmation };
        });
      },
      async signUp(email, password, username) {
        return withBusy(async () => {
          const result = await authService.signUpWithEmail(email, password, username);
          if (result.session?.user) {
            const row = await loadProfile(result.session.user.id);
            if (mounted.current) setProfile(row);
          }
          return { needsEmailConfirmation: result.needsEmailConfirmation };
        });
      },
      async signOut() {
        setBusy(true);
        try {
          await authService.signOut();
        } finally {
          if (mounted.current) {
            setProfile(null);
            setSession(null);
            setBusy(false);
          }
        }
      },
      async requestPasswordReset(email) {
        await withBusy(() => authService.requestPasswordReset(email));
      },
      async updatePassword(password) {
        await withBusy(() => authService.updatePassword(password));
      },
      async resendConfirmation(email) {
        await withBusy(() => authService.resendConfirmationEmail(email));
      },
      refreshProfile,
      clearError() {
        setError(null);
      },
    }),
    [session, profile, initialising, busy, error, misconfigured, withBusy, loadProfile, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
