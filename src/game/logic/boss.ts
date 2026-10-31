/**
 * THE EXECUTOR — boss combat decisions.
 *
 * This module is deliberately pure: every function here maps inputs (health,
 * distance, attack index) to a decision, with no state and no side effects. The
 * stateful `CombatSimulation` owns the boss entity and applies these decisions;
 * keeping the *choices* pure means the escalation curve and the attack rotation
 * can be unit-tested directly instead of only through a long, fragile fight.
 *
 * Design rules that the tests below pin down:
 *  - Damage never scales with phase. Only the *pattern* escalates, so a phase
 *    change is a change in how the boss threatens, never in how hard it hits.
 *  - Every attack has a telegraph longer than zero and shorter than its
 *    cooldown, so the wind-up is always readable and the boss can never chain
 *    two attacks with no gap.
 *  - Attack selection is deterministic given the attack index, so a replay and
 *    a test see the same sequence.
 */

export type BossPhase = 1 | 2 | 3;

/**
 * The attacks THE EXECUTOR can wind up.
 *
 * Each has a distinct telegraph duration and shape so the player can learn to
 * read it. The telegraph is the *whole* fairness mechanism: damage is never
 * increased to make the boss harder, only the pattern changes. A longer wind-up
 * means a more punishing attack, so the player always has time to react.
 */
export type BossAttackKind =
  /** Phase 1: a slow three-round volley aimed at where the player is. */
  | 'volley'
  /** Phase 2: a fast single shot, fired at close range during a pursuit. */
  | 'lance'
  /** Phase 3: a radial burst in every direction — must be dodged, not outrun. */
  | 'burst'
  /** Phase 3: a rotating spiral of shots that sweeps the arena. */
  | 'spiral'
  /** Phase 3: a ground-slam area attack centred on the boss. */
  | 'slam';

export interface BossAttackSpec {
  /** Milliseconds of visible wind-up before the attack lands. */
  readonly telegraphMs: number;
  /** Milliseconds before the boss may begin another attack. */
  readonly cooldownMs: number;
  /** Minimum distance to the player for this attack to be chosen. */
  readonly minRange: number;
  /** Maximum distance to the player for this attack to be chosen. */
  readonly maxRange: number;
  /** The phase this attack belongs to. */
  readonly phase: BossPhase;
}

/**
 * Telegraph and cooldown per attack. The numbers are the balance surface: a
 * `slam` telegraphs for 900 ms, which is generous, but covers the whole arena —
 * the player's answer is to move, not to shoot.
 */
export const BOSS_ATTACKS: Readonly<Record<BossAttackKind, BossAttackSpec>> = Object.freeze({
  volley: { telegraphMs: 620, cooldownMs: 1150, minRange: 0, maxRange: 1200, phase: 1 },
  lance: { telegraphMs: 380, cooldownMs: 820, minRange: 0, maxRange: 1200, phase: 2 },
  burst: { telegraphMs: 780, cooldownMs: 1900, minRange: 0, maxRange: 1200, phase: 3 },
  spiral: { telegraphMs: 700, cooldownMs: 2300, minRange: 0, maxRange: 1200, phase: 3 },
  slam: { telegraphMs: 900, cooldownMs: 2600, minRange: 0, maxRange: 420, phase: 3 },
});

/** Health fractions at which the boss advances a phase. */
export const BOSS_PHASE_THRESHOLDS = { phase2: 0.62, phase3: 0.3 } as const;

/** How long the boss pauses, immobile and non-attacking, on a phase change. */
export const BOSS_PHASE_TRANSITION_MS = 1400;

/**
 * The phase the boss should be in for a given health fraction.
 *
 * `healthRatio` is `health / maxHealth`, clamped to [0, 1]. The thresholds are
 * inclusive at the lower bound: at exactly `phase2`, the boss is already in
 * phase 2.
 */
export function bossPhaseForHealth(healthRatio: number): BossPhase {
  const ratio = Math.max(0, Math.min(1, healthRatio));
  if (ratio > BOSS_PHASE_THRESHOLDS.phase2) return 1;
  if (ratio > BOSS_PHASE_THRESHOLDS.phase3) return 2;
  return 3;
}

/**
 * Picks the next attack for a phase. Deterministic given the attack index so a
 * replay, the AI debug overlay and a unit test all see the same sequence.
 *
 * Phase 1 fires the readable volley. Phase 2 fires a fast lance during its
 * pursuit. Phase 3 rotates through area patterns; the `slam` is only eligible
 * when the player is inside its (short) range, so a distant player is chased
 * with bursts and spirals rather than slammed from across the arena.
 */
export function chooseBossAttack(phase: BossPhase, distanceToPlayer: number, index: number): BossAttackKind {
  if (phase === 1) return 'volley';
  if (phase === 2) return 'lance';
  const rotation: BossAttackKind[] =
    distanceToPlayer <= BOSS_ATTACKS.slam.maxRange
      ? ['burst', 'spiral', 'slam']
      : ['burst', 'spiral'];
  return rotation[((index % rotation.length) + rotation.length) % rotation.length]!;
}

/** The stance the boss holds in each phase, for the renderer and the overlay. */
export function bossStanceForPhase(phase: BossPhase): 'hold' | 'approach' | 'reposition' {
  if (phase === 1) return 'hold';
  if (phase === 2) return 'approach';
  return 'reposition';
}

/**
 * Whether a phase change should occur this frame, and between which phases.
 * Returns `null` when the phase is unchanged, so the caller can skip the whole
 * transition ceremony.
 */
export function nextBossPhase(
  current: BossPhase,
  healthRatio: number,
): { from: BossPhase; to: BossPhase } | null {
  const target = bossPhaseForHealth(healthRatio);
  if (target === current) return null;
  return { from: current, to: target };
}
