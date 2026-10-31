import { getSupabaseClient } from './supabase';
import { toAppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { PlayerStatistics, Profile } from './types';

const log = createLogger('profile');

/** Loads the profile row for a user. Returns null when provisioning has not
 * completed yet (a narrow window right after sign-up). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, created_at, updated_at, last_seen_at')
      .eq('id', userId)
      .maybeSingle<Profile>();
    if (error) throw error;
    return data ?? null;
  } catch (error) {
    throw toAppError(error, 'Could not load your profile.');
  }
}

export async function fetchStatistics(userId: string): Promise<PlayerStatistics | null> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('player_statistics')
      .select('*')
      .eq('profile_id', userId)
      .maybeSingle<PlayerStatistics>();
    if (error) throw error;
    return data ?? null;
  } catch (error) {
    throw toAppError(error, 'Could not load your statistics.');
  }
}

/**
 * Profile and statistics together — the dashboard needs both, and issuing them
 * as one round trip keeps the loading state simple.
 */
export async function fetchPlayerOverview(
  userId: string,
): Promise<{ profile: Profile; statistics: PlayerStatistics }> {
  const [profile, statistics] = await Promise.all([fetchProfile(userId), fetchStatistics(userId)]);
  if (!profile) {
    throw toAppError({ code: 'PGRST116', message: 'profile missing' }, 'Your profile is still being set up.');
  }
  if (!statistics) {
    throw toAppError(
      { code: 'PGRST116', message: 'statistics missing' },
      'Your statistics record is still being set up.',
    );
  }
  return { profile, statistics };
}

/** Advisory availability check, used by the registration form. */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.rpc('is_username_available', { p_username: username });
    if (error) throw error;
    return data === true;
  } catch (error) {
    throw toAppError(error, 'Could not check that callsign.');
  }
}

/** Renames the signed-in player. RLS restricts this to their own row. */
export async function updateUsername(userId: string, username: string): Promise<Profile> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ username })
      .eq('id', userId)
      .select('id, username, display_name, created_at, updated_at, last_seen_at')
      .single<Profile>();
    if (error) throw error;
    log.info('username updated');
    return data;
  } catch (error) {
    throw toAppError(error, 'Could not update your callsign.');
  }
}

/**
 * Records activity. Best-effort: a failure here must never break the interface,
 * so errors are logged rather than thrown.
 */
export async function touchLastSeen(userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) log.warn('could not update last_seen_at', error.message);
}
