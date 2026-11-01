/** Row shapes returned by the database. Kept in one place so the services layer
 * and the UI agree on names, and so a migration that renames a column breaks the
 * build rather than silently returning `undefined` at runtime. */

export type MatchMode = 'survival' | 'deathmatch' | 'operations';
export type MatchOutcome = 'defeat' | 'extracted' | 'victory' | 'abandoned';
export type LeaderboardSort = 'level' | 'xp' | 'eliminations' | 'wave' | 'survival';

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface PlayerStatistics {
  profile_id: string;
  total_xp: number;
  level: number;
  matches_played: number;
  total_eliminations: number;
  total_deaths: number;
  total_damage_dealt: number;
  total_shots_fired: number;
  total_shots_hit: number;
  total_play_seconds: number;
  highest_wave: number;
  best_survival_seconds: number;
  best_eliminations: number;
  created_at: string;
  updated_at: string;
}

export interface MatchRecord {
  id: string;
  profile_id: string;
  client_match_id: string;
  mode: MatchMode;
  wave_reached: number;
  eliminations: number;
  deaths: number;
  damage_dealt: number;
  shots_fired: number;
  shots_hit: number;
  survival_seconds: number;
  score: number;
  xp_awarded: number;
  outcome: MatchOutcome;
  created_at: string;
  /** Operations: objectives completed and whether the mission was extracted. */
  objectives_completed: number;
  extracted: boolean;
}

export interface UnlockedWeapon {
  profile_id: string;
  weapon_id: string;
  unlocked_at: string;
  source: 'default' | 'level' | 'achievement' | 'grant';
}

export interface WeaponDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  damage: number;
  fire_rate_ms: number;
  reload_ms: number;
  magazine: number;
  pellets: number;
  spread_deg: number;
  projectile_speed: number;
  range_px: number;
  is_default: boolean;
  unlock_level: number;
  sort_order: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  xp_reward: number;
  sort_order: number;
}

export interface PlayerAchievement {
  profile_id: string;
  achievement_id: string;
  unlocked_at: string;
  progress: number;
}

export interface LeaderboardRow {
  rank: number;
  profile_id: string;
  username: string;
  level: number;
  total_xp: number;
  eliminations: number;
  highest_wave: number;
  best_survival_seconds: number;
  matches_played: number;
}

/** Raw match facts the client may report. Score and XP are deliberately absent:
 * the server derives them in `submit_match`. */
export interface MatchSubmission {
  clientMatchId: string;
  mode: MatchMode;
  waveReached: number;
  eliminations: number;
  deaths: number;
  damageDealt: number;
  shotsFired: number;
  shotsHit: number;
  survivalSeconds: number;
  outcome: MatchOutcome;
  /** True when THE EXECUTOR was defeated this run. */
  bossDefeated: boolean;
  /** True when the adaptive director committed at least one tactical change. */
  adapted: boolean;
  /**
   * Operations: mission objectives completed before the run ended. Optional —
   * the RPC and the Zod schema both default it, so a survival or deathmatch
   * call site does not have to mention it.
   */
  objectivesCompleted?: number;
  /** Operations: true when the player reached extraction and finished. */
  extracted?: boolean;
}

export interface MatchSubmissionResult {
  duplicate: boolean;
  matchId: string;
  score: number;
  xpAwarded: number;
  stats: PlayerStatistics;
  newWeapons: string[];
  /** Achievement ids unlocked by this submission, empty on a duplicate. */
  newAchievements: string[];
}
