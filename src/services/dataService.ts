import { getSupabaseClient } from './supabase';
import { toAppError } from '@/lib/errors';
import { matchSubmissionSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';
import type {
  Achievement,
  LeaderboardRow,
  LeaderboardSort,
  MatchRecord,
  MatchSubmission,
  MatchSubmissionResult,
  PlayerAchievement,
  PlayerStatistics,
  UnlockedWeapon,
  WeaponDefinition,
} from './types';

const log = createLogger('data');

const LEADERBOARD_SORTS: readonly LeaderboardSort[] = [
  'level',
  'xp',
  'eliminations',
  'wave',
  'survival',
];

/** Clamps a caller-supplied sort key to the whitelist the database accepts. */
export function normaliseSort(sort: string): LeaderboardSort {
  return (LEADERBOARD_SORTS as readonly string[]).includes(sort)
    ? (sort as LeaderboardSort)
    : 'level';
}

export async function fetchWeaponCatalog(): Promise<WeaponDefinition[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('weapon_catalog')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as WeaponDefinition[];
  } catch (error) {
    throw toAppError(error, 'Could not load the weapon catalogue.');
  }
}

export async function fetchUnlockedWeapons(userId: string): Promise<UnlockedWeapon[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('unlocked_weapons')
      .select('profile_id, weapon_id, unlocked_at, source')
      .eq('profile_id', userId)
      .order('unlocked_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as UnlockedWeapon[];
  } catch (error) {
    throw toAppError(error, 'Could not load your loadout.');
  }
}

export async function fetchRecentMatches(userId: string, limit = 10): Promise<MatchRecord[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('match_history')
      .select('*')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50));
    if (error) throw error;
    return (data ?? []) as MatchRecord[];
  } catch (error) {
    throw toAppError(error, 'Could not load your match history.');
  }
}

export async function fetchAchievements(): Promise<Achievement[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Achievement[];
  } catch (error) {
    throw toAppError(error, 'Could not load achievements.');
  }
}

export async function fetchPlayerAchievements(userId: string): Promise<PlayerAchievement[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('player_achievements')
      .select('profile_id, achievement_id, unlocked_at, progress')
      .eq('profile_id', userId);
    if (error) throw error;
    return (data ?? []) as PlayerAchievement[];
  } catch (error) {
    throw toAppError(error, 'Could not load your achievements.');
  }
}

export async function fetchLeaderboard(
  sort: LeaderboardSort = 'level',
  limit = 25,
): Promise<LeaderboardRow[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_sort: normaliseSort(sort),
      p_limit: Math.min(Math.max(limit, 1), 100),
    });
    if (error) throw error;
    return (data ?? []) as LeaderboardRow[];
  } catch (error) {
    throw toAppError(error, 'Could not load the leaderboard.');
  }
}

interface SubmitMatchRpcResult {
  duplicate: boolean;
  match_id: string;
  score: number;
  xp_awarded: number;
  stats: PlayerStatistics;
  new_weapons: string[];
  new_achievements: string[] | null;
}

/**
 * Submits a finished match. The payload carries raw facts only — the database
 * derives score and XP and is idempotent on `clientMatchId`, so a retry after a
 * dropped response cannot double-count the match.
 */
export async function submitMatch(submission: MatchSubmission): Promise<MatchSubmissionResult> {
  // Validate locally before the round trip: a malformed payload would otherwise
  // fail deep inside Postgres with an opaque cast error.
  const parsed = matchSubmissionSchema.safeParse(submission);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? 'invalid submission';
    throw new Error(`Match submission rejected: ${detail}`);
  }
  const valid = parsed.data;

  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.rpc('submit_match', {
      p_client_match_id: valid.clientMatchId,
      p_mode: valid.mode,
      p_wave_reached: valid.waveReached,
      p_eliminations: valid.eliminations,
      p_deaths: valid.deaths,
      p_damage_dealt: valid.damageDealt,
      p_shots_fired: valid.shotsFired,
      p_shots_hit: valid.shotsHit,
      p_survival_seconds: valid.survivalSeconds,
      p_outcome: valid.outcome,
      p_boss_defeated: valid.bossDefeated,
      p_adapted: valid.adapted,
      p_objectives_completed: valid.objectivesCompleted,
      p_extracted: valid.extracted,
    });
    if (error) throw error;
    if (!data) throw new Error('empty response from submit_match');

    const row = data as SubmitMatchRpcResult;
    log.info('match submitted', { duplicate: row.duplicate, score: row.score, xp: row.xp_awarded });
    return {
      duplicate: row.duplicate,
      matchId: row.match_id,
      score: row.score,
      xpAwarded: row.xp_awarded,
      stats: row.stats,
      newWeapons: row.new_weapons ?? [],
      newAchievements: row.new_achievements ?? [],
    };
  } catch (error) {
    throw toAppError(error, 'Could not record your match.');
  }
}
