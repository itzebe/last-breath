import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';
import { env } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth');

export interface AuthResult {
  user: User | null;
  session: Session | null;
  /** True when the account still needs its email confirmed before sign-in works. */
  needsEmailConfirmation: boolean;
}

function redirectTo(path: string): string {
  return `${env.siteUrl}${path}`;
}

/**
 * Registration. The username travels in `options.data` and is picked up by the
 * `handle_new_user` trigger, which creates the profile row in the same
 * transaction as the auth user — so a taken username aborts the whole sign-up
 * rather than leaving an account without a profile.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  username: string,
): Promise<AuthResult> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        emailRedirectTo: redirectTo('/auth/callback'),
      },
    });
    if (error) throw error;

    // When email confirmation is enabled Supabase returns a user but no session.
    const needsEmailConfirmation = Boolean(data.user && !data.session);
    log.info('sign-up accepted', { needsEmailConfirmation });
    return { user: data.user ?? null, session: data.session ?? null, needsEmailConfirmation };
  } catch (error) {
    // A duplicate username surfaces as a unique-violation on profiles.
    const appError = toAppError(error, 'Could not create your account.');
    if (/profiles_username_key|duplicate key|already registered|user_already_exists/i.test(appError.message)) {
      throw new AppError('conflict', 'That callsign is already taken. Choose another.');
    }
    throw appError;
  }
}

/** Email + password sign-in. */
export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    log.info('signed in');
    return { user: data.user, session: data.session, needsEmailConfirmation: false };
  } catch (error) {
    throw toAppError(error, 'Could not sign you in.');
  }
}

/** Clears the local session. Never throws: a failed sign-out must not trap the user. */
export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    // A 403/404 here means the server session was already gone; the local
    // session is what matters, and supabase-js clears it either way.
    log.warn('sign-out reported an error; local session cleared regardless', toAppError(error).message);
  }
}

/** Sends the password-recovery email. */
export async function requestPasswordReset(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo('/auth/reset-password'),
    });
    if (error) throw error;
    log.info('password recovery requested');
  } catch (error) {
    throw toAppError(error, 'Could not send the reset email.');
  }
}

/** Completes a recovery flow. Requires the temporary session from the email link. */
export async function updatePassword(newPassword: string): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    log.info('password updated');
  } catch (error) {
    throw toAppError(error, 'Could not update your password.');
  }
}

/** Re-sends the confirmation email for an unconfirmed account. */
export async function resendConfirmationEmail(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo('/auth/callback') },
    });
    if (error) throw error;
    log.info('confirmation email re-sent');
  } catch (error) {
    throw toAppError(error, 'Could not resend the confirmation email.');
  }
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    log.warn('getSession failed', toAppError(error).message);
    return null;
  }
  return data.session;
}

export function onAuthStateChange(
  callback: (session: Session | null) => void,
): { unsubscribe: () => void } {
  const supabase = getSupabaseClient();
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return { unsubscribe: () => data.subscription.unsubscribe() };
}

/** Exchanges the `?code=` from a PKCE email link for a session. */
export async function exchangeCodeForSession(code: string): Promise<Session | null> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session ?? null;
  } catch (error) {
    throw toAppError(error, 'That link is invalid or has expired.');
  }
}

/** True when the signed-in user has a confirmed email (or none is required). */
export function isEmailConfirmed(user: User | null): boolean {
  if (!user) return false;
  if (!user.email) return true;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}
