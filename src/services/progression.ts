/**
 * Player progression curve.
 *
 * This mirrors the SQL helpers in `20261031120000_extensions_and_helpers.sql`
 * exactly:
 *
 *     level_for_xp(xp)     = greatest(1, 1 + floor(sqrt(xp / 250)))
 *     xp_for_level(level)  = (level - 1)^2 * 250
 *
 * The database remains the authority — it derives `level` as a generated column
 * and computes awarded XP server-side. These functions exist only so the
 * interface can render progress bars and unlock requirements without a round
 * trip, and they are unit-tested against the same values the SQL produces.
 */

/** XP required to have reached `level`. Level 1 starts at 0 XP. */
export function xpForLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  const safe = Math.max(1, Math.floor(level));
  return (safe - 1) ** 2 * 250;
}

/**
 * The level a given XP total corresponds to.
 *
 * Non-finite input resolves to level 1 rather than propagating NaN — a missing
 * or corrupt XP value should read as "new player", not blank the interface.
 */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp)) return 1;
  const safe = Math.max(0, Math.floor(xp));
  return Math.max(1, 1 + Math.floor(Math.sqrt(safe / 250)));
}

export interface LevelProgress {
  /** Current level. */
  level: number;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP span of the current level. */
  span: number;
  /** XP still needed to reach the next level. */
  remaining: number;
  /** `into / span`, clamped to 0–1. */
  fraction: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelForXp(totalXp);
  const floorXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const span = Math.max(1, nextXp - floorXp);
  const into = Math.max(0, totalXp - floorXp);
  return {
    level,
    into,
    span,
    remaining: Math.max(0, nextXp - totalXp),
    fraction: Math.min(Math.max(into / span, 0), 1),
  };
}

/**
 * Score and XP for a completed match.
 *
 * These mirror the `submit_match` SQL function exactly. The database recomputes
 * both from the submitted facts and ignores any number the client supplies — the
 * client uses these only to show a running total during play and a provisional
 * summary on the results screen.
 *
 *     score = wave*100 + kills*50 + seconds*2 + (victory ? 5000 : 0)
 *             + (deathmatch ? kills*25 : 0)
 *
 *     xp    = kills*25 + wave*120 + min(seconds, 3600)/2
 *             + (victory ? 750 : 0) + min(round(sqrt(damage)*2), 400)
 */
export interface MatchFacts {
  mode: 'survival' | 'deathmatch' | 'operations';
  wave: number;
  eliminations: number;
  survivalSeconds: number;
  damageDealt: number;
  outcome: 'victory' | 'defeat' | 'extracted';
  /** Operations only: objectives completed, and whether extraction succeeded. */
  objectivesCompleted?: number;
  extracted?: boolean;
}

/** Cap applied server-side; mirrored so the preview cannot overstate a reward. */
export const MAX_MATCH_XP = 500_000;

export function matchScore(facts: MatchFacts): number {
  return (
    Math.max(0, facts.wave) * 100 +
    Math.max(0, facts.eliminations) * 50 +
    Math.max(0, facts.survivalSeconds) * 2 +
    (facts.outcome === 'victory' ? 5000 : 0) +
    (facts.mode === 'deathmatch' ? Math.max(0, facts.eliminations) * 25 : 0) +
    (facts.mode === 'operations' ? Math.max(0, facts.objectivesCompleted ?? 0) * 600 : 0) +
    (facts.extracted ? 9000 : 0)
  );
}

export function matchXp(facts: MatchFacts): number {
  const raw =
    Math.max(0, facts.eliminations) * 25 +
    Math.max(0, facts.wave) * 120 +
    Math.min(Math.max(0, facts.survivalSeconds), 3600) / 2 +
    (facts.outcome === 'victory' ? 750 : 0) +
    Math.min(Math.round(Math.sqrt(Math.max(0, facts.damageDealt)) * 2), 400) +
    (facts.mode === 'operations' ? Math.max(0, facts.objectivesCompleted ?? 0) * 150 : 0) +
    (facts.extracted ? 1200 : 0);
  return Math.min(Math.max(Math.round(raw), 0), MAX_MATCH_XP);
}
