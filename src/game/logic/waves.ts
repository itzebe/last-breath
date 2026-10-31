import { getArchetype, type EnemyArchetypeId } from './enemies';

/**
 * Survival wave composition.
 *
 * Difficulty is a curve with three inputs — how many hostiles, how tough they
 * are (handled in `enemies.scaleForWave`) and how many arrive at once. All three
 * are computed, not authored, so the curve is measurable and can be re-tuned in
 * one place.
 */

export interface WavePlan {
  readonly wave: number;
  /** Total hostiles to defeat before the wave completes. */
  readonly totalEnemies: number;
  /** How many may be alive simultaneously. */
  readonly maxConcurrent: number;
  /** Milliseconds between spawn batches. */
  readonly spawnIntervalMs: number;
  /** Milliseconds of breathing room before the next wave begins. */
  readonly intermissionMs: number;
  readonly isBossWave: boolean;
  /** Archetypes eligible this wave. */
  readonly allowedArchetypes: readonly EnemyArchetypeId[];
  /** Human-readable label for the wave banner. */
  readonly label: string;
}

const BOSS_WAVES = new Set([10, 20, 30]);

/** Enemy count grows linearly then eases; concurrency grows more slowly so the
 * arena stays readable on a phone screen. */
export function planWave(wave: number): WavePlan {
  const n = Math.max(1, Math.floor(wave));
  const isBossWave = BOSS_WAVES.has(n);

  const baseEnemies = 5 + Math.round(n * 2.4 + Math.pow(n, 1.35) * 0.55);
  const totalEnemies = isBossWave ? Math.round(baseEnemies * 0.55) : baseEnemies;

  // Concurrency is capped: beyond ~22 simultaneous bodies the arena stops being
  // legible on a 390px-wide screen, so late waves lean on toughness instead.
  const maxConcurrent = Math.min(4 + Math.floor(n * 0.9), 22);

  const spawnIntervalMs = Math.max(260, Math.round(1100 - n * 42));

  // Intermissions shorten as waves progress, but a boss wave always gets a
  // longer breather than the wave before it — the player needs time to reload,
  // reposition and read the arena before the Executor arrives. A flat constant
  // would break that guarantee at wave 9, whose intermission is already ~4.2s.
  const regularIntermissionMs = Math.max(2400, 5200 - n * 110);
  const intermissionMs = isBossWave ? Math.max(regularIntermissionMs + 1400, 5600) : regularIntermissionMs;

  return {
    wave: n,
    totalEnemies,
    maxConcurrent,
    spawnIntervalMs,
    intermissionMs,
    isBossWave,
    allowedArchetypes: eligibleArchetypes(n),
    label: isBossWave ? `WAVE ${n} — EXECUTOR PROTOCOL` : `WAVE ${n}`,
  };
}

export function isBossWave(wave: number): boolean {
  return BOSS_WAVES.has(wave);
}

/** Archetypes unlocked by a given wave. Derived from each archetype's `minWave`. */
export function eligibleArchetypes(wave: number): EnemyArchetypeId[] {
  const ids: EnemyArchetypeId[] = ['rusher', 'flanker', 'sniper', 'tank', 'hunter'];
  return ids.filter((id) => getArchetype(id).minWave <= wave);
}

/**
 * Difficulty index, 0 at wave 1 and rising without bound. Exposed so the debug
 * overlay and the balance tests can assert the curve actually rises.
 */
export function difficultyIndex(wave: number): number {
  const n = Math.max(1, wave);
  return Math.round((n - 1) * 100 + Math.pow(n - 1, 1.6) * 18);
}

/** XP and score awarded for clearing a wave, before per-kill values. */
export function waveClearReward(wave: number): { xp: number; score: number } {
  const n = Math.max(1, wave);
  return {
    xp: Math.round(40 + n * 22 + (isBossWave(n) ? 900 : 0)),
    score: Math.round(150 + n * 90 + (isBossWave(n) ? 5000 : 0)),
  };
}

/**
 * Pickup drop chance. Health drops get scarcer as waves progress (so late waves
 * are attritional) while ammo stays roughly constant.
 */
export function pickupChance(
  wave: number,
  kind: 'health' | 'ammo',
): number {
  const n = Math.max(1, wave);
  if (kind === 'health') return Math.max(0.08, 0.22 - n * 0.008);
  return 0.26;
}
