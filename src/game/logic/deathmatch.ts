/**
 * Deathmatch match rules.
 *
 * Deathmatch is a *mode* of the same arena, not a second game. It reuses the
 * player, the weapons, the projectile and collision code, the enemy archetypes
 * and the adaptive director unchanged. What differs is only the match
 * structure: instead of waves that must be cleared, there is a clock, a target
 * and opponents who come back after they die.
 *
 * Keeping those rules here — pure, clock-free and separately testable — means
 * the simulation only has to ask "is the match over, and who won", and the
 * answer can be verified without running a single frame.
 */

export type DeathmatchOutcome = 'victory' | 'defeat';

export interface DeathmatchRules {
  /** Seconds of pre-match countdown before the clock starts. */
  readonly countdownMs: number;
  /** Match length once the countdown finishes. */
  readonly durationMs: number;
  /** Eliminations needed to win outright, before the clock expires. */
  readonly eliminationTarget: number;
  /** How many AI opponents are kept alive in the arena at once. */
  readonly opponentCount: number;
  /** Milliseconds before a fallen AI opponent is replaced. */
  readonly respawnDelayMs: number;
  /** Milliseconds the player waits before re-entering after being downed. */
  readonly playerRespawnDelayMs: number;
}

/**
 * The tuning surface for the mode. Chosen so a match is winnable but not
 * automatic: six simultaneous opponents at roughly one kill every seven seconds
 * reaches the target with a little over a minute to spare.
 */
export const DEATHMATCH_RULES: DeathmatchRules = Object.freeze({
  countdownMs: 3200,
  durationMs: 180_000,
  eliminationTarget: 25,
  opponentCount: 6,
  respawnDelayMs: 2400,
  playerRespawnDelayMs: 2600,
});

export type DeathmatchPhase = 'countdown' | 'active' | 'finished';

export interface DeathmatchState {
  phase: DeathmatchPhase;
  /** Milliseconds left in the countdown, then in the match. */
  remainingMs: number;
  playerEliminations: number;
  playerDeaths: number;
  /** Milliseconds until the player re-enters, or 0 when on their feet. */
  playerRespawnMs: number;
  /** Eliminations the AI opponents have scored against the player. */
  opponentEliminations: number;
  outcome: DeathmatchOutcome | null;
}

export function createDeathmatchState(rules: DeathmatchRules = DEATHMATCH_RULES): DeathmatchState {
  return {
    phase: 'countdown',
    remainingMs: rules.countdownMs,
    playerEliminations: 0,
    playerDeaths: 0,
    playerRespawnMs: 0,
    opponentEliminations: 0,
    outcome: null,
  };
}

export interface DeathmatchTick {
  /** True when the countdown has just ended and the clock is now running. */
  started: boolean;
  /** True when this tick ended the match. */
  finished: boolean;
  /** True when the player has just become eligible to re-enter. */
  playerRespawned: boolean;
  /** True when an AI opponent should be spawned to top the arena up. */
  needsOpponent: boolean;
}

/**
 * Advances the match clock. Deliberately does not touch the player, the
 * opponents or combat — it reports what the simulation should do, and the
 * simulation does it. That keeps the rules testable in isolation.
 */
export function tickDeathmatch(
  state: DeathmatchState,
  dtMs: number,
  rules: DeathmatchRules = DEATHMATCH_RULES,
  aliveOpponents = 0,
): DeathmatchTick {
  const tick: DeathmatchTick = {
    started: false,
    finished: false,
    playerRespawned: false,
    needsOpponent: false,
  };
  if (state.phase === 'finished') return tick;

  if (state.playerRespawnMs > 0) {
    state.playerRespawnMs = Math.max(0, state.playerRespawnMs - dtMs);
    if (state.playerRespawnMs === 0) tick.playerRespawned = true;
  }

  if (state.phase === 'countdown') {
    state.remainingMs = Math.max(0, state.remainingMs - dtMs);
    if (state.remainingMs === 0) {
      state.phase = 'active';
      state.remainingMs = rules.durationMs;
      tick.started = true;
    }
    return tick;
  }

  // ── Active ────────────────────────────────────────────────────────────────
  state.remainingMs = Math.max(0, state.remainingMs - dtMs);

  if (state.playerEliminations >= rules.eliminationTarget) {
    state.phase = 'finished';
    state.outcome = 'victory';
    tick.finished = true;
    return tick;
  }
  if (state.remainingMs === 0) {
    state.phase = 'finished';
    // The clock is the referee: running out of time is a loss, however close the
    // score was. Reaching the target is the only win condition.
    state.outcome = 'defeat';
    tick.finished = true;
    return tick;
  }

  // The arena is kept populated so the player is never left with an empty room.
  tick.needsOpponent = aliveOpponents < rules.opponentCount;
  return tick;
}

/** Records an elimination by the player. */
export function recordPlayerElimination(
  state: DeathmatchState,
  rules: DeathmatchRules = DEATHMATCH_RULES,
): boolean {
  if (state.phase === 'finished') return false;
  state.playerEliminations += 1;
  if (state.playerEliminations >= rules.eliminationTarget) {
    state.phase = 'finished';
    state.outcome = 'victory';
    return true;
  }
  return false;
}

/**
 * Records the player being downed. In deathmatch a death is not the end of the
 * match: the player re-enters after a delay, and the death is counted against
 * them. Returns true when this death finished the match (which can only happen
 * if the clock had already expired on the same tick).
 */
export function recordPlayerDeath(
  state: DeathmatchState,
  rules: DeathmatchRules = DEATHMATCH_RULES,
): boolean {
  if (state.phase === 'finished') return false;
  state.playerDeaths += 1;
  state.opponentEliminations += 1;
  state.playerRespawnMs = rules.playerRespawnDelayMs;
  return false;
}

/**
 * Score contribution for a deathmatch. Mirrors the `deathmatch` branch of the
 * SQL `submit_match` scoring so the results screen never overstates the reward:
 *
 *     score = kills*50 + seconds*2 + (victory ? 5000 : 0) + kills*25
 *
 * `waveReached` is deliberately 0 for this mode — there are no waves, and
 * reporting a fabricated wave would corrupt the `highest_wave` statistic.
 */
export function deathmatchScoreContribution(
  state: DeathmatchState,
  survivalSeconds: number,
): { score: number; waveReached: number } {
  const kills = Math.max(0, state.playerEliminations);
  const seconds = Math.max(0, Math.floor(survivalSeconds));
  const score =
    kills * 50 + seconds * 2 + (state.outcome === 'victory' ? 5000 : 0) + kills * 25;
  return { score, waveReached: 0 };
}

/** Human-readable clock, e.g. `2:45`. */
export function formatMatchClock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
