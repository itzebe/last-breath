import { describe, expect, it } from 'vitest';
import {
  DEATHMATCH_RULES,
  createDeathmatchState,
  deathmatchScoreContribution,
  formatMatchClock,
  recordPlayerDeath,
  recordPlayerElimination,
  tickDeathmatch,
  type DeathmatchRules,
} from '@/game/logic/deathmatch';
import { CombatSimulation, PLAYER_RADIUS, type SimulationEvent } from '@/game/logic/simulation';
import { ARENA_OBSTACLES, avoidObstacles } from '@/game/logic/obstacles';
import { vec, distance } from '@/game/logic/vec';
import { matchScore, type MatchFacts } from '@/services/progression';

/**
 * Deathmatch is a mode of the same arena, so these tests are split the same way
 * the code is: the rules are verified in isolation (no frames, no arena), and
 * the simulation wiring is verified by actually playing the mode headlessly.
 */

/* ── Rules in isolation ──────────────────────────────────────────────────── */

describe('deathmatch rules', () => {
  it('starts in a countdown that runs down before the clock', () => {
    const state = createDeathmatchState();
    expect(state.phase).toBe('countdown');
    expect(state.remainingMs).toBe(DEATHMATCH_RULES.countdownMs);

    // Almost the whole countdown, without crossing it.
    const first = tickDeathmatch(state, DEATHMATCH_RULES.countdownMs - 10);
    expect(first.started).toBe(false);
    expect(state.phase).toBe('countdown');

    // The last slice trips it, and the match clock replaces the countdown value.
    const second = tickDeathmatch(state, 10);
    expect(second.started).toBe(true);
    expect(state.phase).toBe('active');
    expect(state.remainingMs).toBe(DEATHMATCH_RULES.durationMs);
  });

  it('counts active time down and loses when the clock expires', () => {
    const state = createDeathmatchState();
    tickDeathmatch(state, DEATHMATCH_RULES.countdownMs); // enter active

    const tick = tickDeathmatch(state, DEATHMATCH_RULES.durationMs);
    expect(tick.finished).toBe(true);
    expect(state.phase).toBe('finished');
    expect(state.outcome).toBe('defeat');
  });

  it('wins when the elimination target is reached, regardless of the clock', () => {
    const state = createDeathmatchState();
    tickDeathmatch(state, DEATHMATCH_RULES.countdownMs); // enter active

    let finished = false;
    for (let i = 0; i < DEATHMATCH_RULES.eliminationTarget; i += 1) {
      finished = recordPlayerElimination(state) || finished;
    }
    expect(state.playerEliminations).toBe(DEATHMATCH_RULES.eliminationTarget);
    expect(finished).toBe(true);
    expect(state.phase).toBe('finished');
    expect(state.outcome).toBe('victory');
  });

  it('a death is not the end: the player re-enters after a delay', () => {
    const state = createDeathmatchState();
    tickDeathmatch(state, DEATHMATCH_RULES.countdownMs); // enter active

    const ended = recordPlayerDeath(state);
    expect(ended).toBe(false);
    expect(state.phase).toBe('active');
    expect(state.playerDeaths).toBe(1);
    expect(state.opponentEliminations).toBe(1);
    expect(state.playerRespawnMs).toBe(DEATHMATCH_RULES.playerRespawnDelayMs);

    // Half the delay: still down.
    tickDeathmatch(state, DEATHMATCH_RULES.playerRespawnDelayMs / 2);
    expect(state.playerRespawnMs).toBeGreaterThan(0);

    // The rest of the delay: eligible to re-enter, reported once.
    const tick = tickDeathmatch(state, DEATHMATCH_RULES.playerRespawnDelayMs);
    expect(tick.playerRespawned).toBe(true);
    expect(state.playerRespawnMs).toBe(0);
  });

  it('asks for a replacement opponent while the arena is under strength', () => {
    const state = createDeathmatchState();
    tickDeathmatch(state, DEATHMATCH_RULES.countdownMs); // enter active

    const short = tickDeathmatch(state, 16, DEATHMATCH_RULES, 1);
    expect(short.needsOpponent).toBe(true);

    const full = tickDeathmatch(state, 16, DEATHMATCH_RULES, DEATHMATCH_RULES.opponentCount);
    expect(full.needsOpponent).toBe(false);
  });

  it('never mutates a finished match', () => {
    const state = createDeathmatchState();
    tickDeathmatch(state, DEATHMATCH_RULES.countdownMs);
    tickDeathmatch(state, DEATHMATCH_RULES.durationMs); // finished: defeat

    const before = { ...state };
    const tick = tickDeathmatch(state, 1000, DEATHMATCH_RULES, 0);
    expect(tick).toEqual({ started: false, finished: false, playerRespawned: false, needsOpponent: false });
    expect(state).toEqual(before);
    expect(recordPlayerElimination(state)).toBe(false);
    expect(recordPlayerDeath(state)).toBe(false);
    expect(state).toEqual(before);
  });

  it('honours custom tuning', () => {
    const rules: DeathmatchRules = {
      countdownMs: 100,
      durationMs: 5000,
      eliminationTarget: 3,
      opponentCount: 2,
      respawnDelayMs: 500,
      playerRespawnDelayMs: 400,
    };
    const state = createDeathmatchState(rules);
    expect(state.remainingMs).toBe(100);
    tickDeathmatch(state, 100, rules);
    expect(state.remainingMs).toBe(5000);
    recordPlayerElimination(state, rules);
    recordPlayerElimination(state, rules);
    expect(recordPlayerElimination(state, rules)).toBe(true);
    expect(state.outcome).toBe('victory');
  });

  it('mirrors the server score formula and reports no wave', () => {
    const state = createDeathmatchState();
    tickDeathmatch(state, DEATHMATCH_RULES.countdownMs);
    for (let i = 0; i < 4; i += 1) recordPlayerElimination(state);

    const contribution = deathmatchScoreContribution(state, 30);
    // kills*50 + seconds*2 + victory*5000 + kills*25 = 200 + 60 + 0 + 100
    expect(contribution.score).toBe(360);
    expect(contribution.waveReached).toBe(0);
  });

  it('formats the clock as m:ss', () => {
    expect(formatMatchClock(165_000)).toBe('2:45');
    expect(formatMatchClock(0)).toBe('0:00');
    expect(formatMatchClock(-500)).toBe('0:00');
  });
});

/* ── The mode, played for real in the headless simulation ────────────────── */

const FRAME_MS = 1000 / 60;

/** A no-risk practice loadout so a played-out match is deterministic and short. */
const FAST_RULES: DeathmatchRules = {
  countdownMs: 1000,
  durationMs: 60_000,
  eliminationTarget: 3,
  opponentCount: 2,
  respawnDelayMs: 200,
  playerRespawnDelayMs: 400,
};

describe('deathmatch simulation', () => {
  it('seeds the arena with AI opponents and starts in the countdown', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 3, mode: 'deathmatch' });
    const snapshot = sim.snapshot();

    expect(snapshot.mode).toBe('deathmatch');
    expect(snapshot.deathmatch?.phase).toBe('countdown');
    expect(snapshot.enemies.length).toBe(DEATHMATCH_RULES.opponentCount);
    // Every seeded hostile is an AI opponent, never a wave enemy.
    expect(snapshot.enemies.every((enemy) => enemy.isOpponent)).toBe(true);
  });

  it('reports no deathmatch state in survival mode', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 3 });
    expect(sim.snapshot().mode).toBe('survival');
    expect(sim.snapshot().deathmatch).toBeNull();
  });

  it('emits match_started once the countdown ends', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 3, mode: 'deathmatch', deathmatchRules: FAST_RULES });
    const events: SimulationEvent[] = [];
    sim.subscribe((event) => events.push(event));

    let seconds = 0;
    while (!events.some((event) => event.type === 'match_started') && seconds < 5) {
      sim.step(FRAME_MS, { move: vec(), aim: null, firing: false });
      seconds += FRAME_MS / 1000;
    }
    expect(events.filter((event) => event.type === 'match_started')).toHaveLength(1);
  });

  it('ends in victory when the player reaches the elimination target', () => {
    const sim = new CombatSimulation({
      loadout: ['rifle'],
      seed: 11,
      mode: 'deathmatch',
      deathmatchRules: FAST_RULES,
      playerInvulnerable: true,
    });

    let eliminations = 0;
    sim.subscribe((event) => {
      if (event.type === 'opponent_eliminated') eliminations += 1;
    });

    // Play like a competent human: always face the nearest opponent, hold fire,
    // reload when empty, and close to a sensible engagement range.
    for (let i = 0; i < 60 * 120 && !sim.isEnded; i += 1) {
      sim.step(FRAME_MS, fightStep(sim));
    }

    const snapshot = sim.snapshot();
    expect(snapshot.deathmatch?.outcome).toBe('victory');
    expect(snapshot.outcome).toBe('victory');
    expect(eliminations).toBe(FAST_RULES.eliminationTarget);
    expect(snapshot.deathmatch?.playerEliminations).toBe(FAST_RULES.eliminationTarget);
  });

  it('replaces fallen opponents so the arena stays populated', () => {
    const sim = new CombatSimulation({
      loadout: ['rifle'],
      seed: 5,
      mode: 'deathmatch',
      deathmatchRules: { ...FAST_RULES, eliminationTarget: 999 },
      playerInvulnerable: true,
    });

    // Run well past the first respawn delay and confirm opponents keep arriving.
    let maxAlive = 0;
    let spawns = 0;
    sim.subscribe((event) => {
      if (event.type === 'enemy_spawned') spawns += 1;
    });
    for (let i = 0; i < 60 * 20; i += 1) {
      sim.step(FRAME_MS, fightStep(sim));
      const alive = sim.snapshot().enemies.filter((enemy) => enemy.isOpponent && !enemy.dying).length;
      maxAlive = Math.max(maxAlive, alive);
    }
    expect(spawns).toBeGreaterThan(FAST_RULES.opponentCount);
    expect(maxAlive).toBeLessThanOrEqual(FAST_RULES.opponentCount);
  });

  it('respawns the player after a death rather than ending the match', () => {
    const sim = new CombatSimulation({
      loadout: ['pistol'],
      seed: 9,
      mode: 'deathmatch',
      deathmatchRules: { ...FAST_RULES, durationMs: 600_000 },
    });

    const events: SimulationEvent[] = [];
    sim.subscribe((event) => events.push(event));

    // Idle and let the opponents do their work until the player is downed.
    let seconds = 0;
    while (!events.some((event) => event.type === 'player_died') && seconds < 120) {
      sim.step(FRAME_MS, { move: vec(), aim: null, firing: false });
      seconds += FRAME_MS / 1000;
    }
    expect(events.some((event) => event.type === 'player_died')).toBe(true);

    // Keep running: the match continues and the player re-enters.
    for (let i = 0; i < 60 * 5; i += 1) sim.step(FRAME_MS, { move: vec(), aim: null, firing: false });
    expect(sim.isEnded).toBe(false);
    expect(events.some((event) => event.type === 'player_respawned')).toBe(true);
    expect(sim.snapshot().deathmatch?.playerDeaths).toBeGreaterThan(0);
    expect(sim.snapshot().player.alive).toBe(true);
  });

  it('produces a score preview that matches the server formula', () => {
    const facts: MatchFacts = {
      mode: 'deathmatch',
      wave: 0,
      eliminations: 12,
      survivalSeconds: 90,
      damageDealt: 1500,
      outcome: 'victory',
    };
    const state = createDeathmatchState();
    for (let i = 0; i < 12; i += 1) recordPlayerElimination(state);
    state.outcome = 'victory';

    // The client's preview must agree with the database's recomputation exactly,
    // including the deathmatch-only bonus term.
    expect(deathmatchScoreContribution(state, 90).score).toBe(matchScore(facts));
  });
});

/** One frame of plausible play: aim at the nearest live opponent, hold fire,
 * reload when dry, and close to engagement range so range-keeping enemies
 * cannot stall the run. */
function fightStep(sim: CombatSimulation): { move: ReturnType<typeof vec>; aim: ReturnType<typeof vec> | null; firing: boolean } {
  const snapshot = sim.snapshot();
  const target = nearestLiving(sim);
  const state = snapshot.player.weapons[snapshot.player.weapon];
  if (state && state.ammoInMagazine === 0 && state.reloadRemainingMs === 0) sim.requestReload();

  let move = vec();
  if (target) {
    const toTarget = { x: target.x - sim.playerPos.x, y: target.y - sim.playerPos.y };
    const range = Math.hypot(toTarget.x, toTarget.y);
    if (range > 260) {
      const inv = 1 / Math.max(1, range);
      // Steer around the arena's cover instead of walking into it: the bot has
      // to navigate the same geometry a human does, or it stalls against a
      // crate and the test measures the bot rather than the mode.
      move = avoidObstacles(
        sim.playerPos,
        vec(toTarget.x * inv, toTarget.y * inv),
        ARENA_OBSTACLES,
        PLAYER_RADIUS,
      );
    }
  }
  return { move, aim: target, firing: true };
}

function nearestLiving(sim: CombatSimulation): ReturnType<typeof vec> | null {
  const snapshot = sim.snapshot();
  let best: ReturnType<typeof vec> | null = null;
  let bestDistance = Infinity;
  for (const enemy of snapshot.enemies) {
    if (enemy.dying) continue;
    const d = distance(sim.playerPos, enemy.position);
    if (d < bestDistance) {
      bestDistance = d;
      best = { ...enemy.position };
    }
  }
  return best;
}
