import { describe, expect, it } from 'vitest';
import {
  CombatSimulation,
  GRENADE_COUNT,
  type SimulationEvent,
  type SimulationInput,
} from '@/game/logic/simulation';
import { vec, distance } from '@/game/logic/vec';
import { LAST_EXIT } from '@/game/logic/operations';
import { UPGRADES } from '@/game/logic/upgrades';

const FRAME_MS = 1000 / 60;
const IDLE: SimulationInput = { move: vec(), aim: null, firing: false };

function advance(sim: CombatSimulation, seconds: number, input: SimulationInput = IDLE): void {
  const frames = Math.round((seconds * 1000) / FRAME_MS);
  for (let i = 0; i < frames; i += 1) sim.step(FRAME_MS, input);
}

function collectEvents(sim: CombatSimulation): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  sim.subscribe((event) => events.push(event));
  return events;
}

/** Runs until the predicate holds, or the budget runs out. */
function runUntil(sim: CombatSimulation, predicate: () => boolean, maxSeconds: number, input: SimulationInput = IDLE): boolean {
  const frames = Math.round((maxSeconds * 1000) / FRAME_MS);
  for (let i = 0; i < frames; i += 1) {
    if (predicate()) return true;
    sim.step(FRAME_MS, input);
  }
  return predicate();
}

/** Leaves the intermission so the arena is actually live, and gives the first
 * frame or two a chance to run so a mode that starts already-active still ticks. */
function start(sim: CombatSimulation): void {
  runUntil(sim, () => sim.snapshot().state === 'active', 6);
  advance(sim, 0.1, IDLE);
}

describe('dodge roll', () => {
  it('starts a roll, reports it in the snapshot, and locks in invulnerability', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 1 });
    start(sim);
    sim.step(FRAME_MS, { ...IDLE, dodge: true });

    const snapshot = sim.snapshot();
    expect(snapshot.dodge.rolling).toBe(true);
    expect(snapshot.dodge.invulnerable).toBe(true);
    expect(snapshot.dodge.cooldownMs).toBeGreaterThan(0);
  });

  it('refuses a second roll while one is on cooldown', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 2 });
    start(sim);
    sim.step(FRAME_MS, { ...IDLE, dodge: true });
    // Immediately ask for another: the first roll's cooldown must reject it.
    const cooldownAfterFirst = sim.snapshot().dodge.cooldownMs;
    sim.step(FRAME_MS, { ...IDLE, dodge: true });
    // Cooldown only ever decreases from here; it must not have been reset upward.
    expect(sim.snapshot().dodge.cooldownMs).toBeLessThan(cooldownAfterFirst);
  });

  it('carries the player in the steer direction, not in a random one', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 3 });
    start(sim);
    const before = sim.playerPos;
    // Steer hard east and roll.
    sim.step(FRAME_MS, { move: vec(1, 0), aim: null, firing: false, dodge: true });
    advance(sim, 0.25, { move: vec(1, 0), aim: null, firing: false });
    const after = sim.playerPos;
    expect(after.x).toBeGreaterThan(before.x + 20);
    expect(Math.abs(after.y - before.y)).toBeLessThan(20);
  });

  it('ends the roll and re-enables it once the cooldown elapses', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 4 });
    start(sim);
    sim.step(FRAME_MS, { ...IDLE, dodge: true });
    advance(sim, 0.5, IDLE);
    expect(sim.snapshot().dodge.rolling).toBe(false);
    // Well past any cooldown the base modifiers allow.
    advance(sim, 3, IDLE);
    expect(sim.snapshot().dodge.cooldownMs).toBe(0);
  });
});

describe('grenades', () => {
  it('starts with the documented complement and decrements on throw', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 5 });
    start(sim);
    expect(sim.snapshot().grenades.remaining).toBe(GRENADE_COUNT);

    sim.step(FRAME_MS, { ...IDLE, grenade: true, grenadeTarget: vec(600, 600) });
    expect(sim.snapshot().grenades.remaining).toBe(GRENADE_COUNT - 1);
  });

  it('emits a throw, then an explosion at the landing point', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 6 });
    start(sim);
    const events = collectEvents(sim);
    const player = sim.playerPos;
    const target = vec(player.x + 120, player.y);

    sim.step(FRAME_MS, { ...IDLE, grenade: true, grenadeTarget: target });
    expect(events.some((e) => e.type === 'grenade_thrown')).toBe(true);

    runUntil(sim, () => events.some((e) => e.type === 'grenade_exploded'), 4);
    const boom = events.find((e) => e.type === 'grenade_exploded');
    expect(boom).toBeDefined();
    if (boom && boom.type === 'grenade_exploded') {
      expect(boom.radius).toBeGreaterThan(0);
      // The blast is where it was thrown, not where the player is standing: the
      // throw decays, so it lands short of the target but well inside one blast
      // radius of it.
      expect(distance(boom.at, target)).toBeLessThan(150);
      expect(distance(boom.at, player)).toBeGreaterThan(20);
    }
  });

  it('damages hostiles inside the blast and reports how many it hit', () => {
    // Invulnerable so the player survives long enough to be placed in contact;
    // this test is about the blast, not about surviving the arena.
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 7, playerInvulnerable: true });
    start(sim);
    runUntil(sim, () => sim.snapshot().enemies.filter((e) => !e.dying).length > 0, 20);

    const victim = sim.snapshot().enemies.filter((e) => !e.dying)[0]!;
    // Stand just outside contact range of the hostile so the throw is in range.
    sim.setPlayerPosition(vec(victim.position.x + 60, victim.position.y));

    const events = collectEvents(sim);
    const hpBefore = victim.health;
    sim.step(FRAME_MS, { ...IDLE, grenade: true, grenadeTarget: victim.position });
    runUntil(sim, () => events.some((e) => e.type === 'grenade_exploded'), 4);

    const boom = events.find((e) => e.type === 'grenade_exploded');
    expect(boom).toBeDefined();
    if (boom && boom.type === 'grenade_exploded') {
      // A blast that lands on a hostile must register a hit; a zero here would
      // mean the explosion is purely cosmetic.
      expect(boom.hits).toBeGreaterThan(0);
    }
    const after = sim.snapshot().enemies.find((e) => e.id === victim.id);
    // Either the hostile took damage, or the blast finished it outright.
    expect(after === undefined || after.dying || after.health < hpBefore).toBe(true);
  });

  it('enforces a cooldown between throws', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 8 });
    start(sim);
    sim.step(FRAME_MS, { ...IDLE, grenade: true, grenadeTarget: vec(600, 600) });
    const afterFirst = sim.snapshot().grenades.remaining;
    // A second throw on the very next frame must be refused.
    sim.step(FRAME_MS, { ...IDLE, grenade: true, grenadeTarget: vec(700, 700) });
    expect(sim.snapshot().grenades.remaining).toBe(afterFirst);
  });
});

describe('Operations mode in the simulation', () => {
  it('starts a mission and exposes it in the snapshot', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 11, mode: 'operations', missionId: LAST_EXIT.id });
    start(sim);
    const mission = sim.snapshot().mission;
    expect(mission).not.toBeNull();
    expect(mission?.codename).toBe(LAST_EXIT.codename);
    expect(mission?.objectiveTotal).toBe(LAST_EXIT.objectives.length);
  });

  it('reports no mission in survival mode', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 12 });
    start(sim);
    expect(sim.snapshot().mission).toBeNull();
  });

  it('offers three upgrade choices at the first encounter, and freezes until one is taken', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 13, mode: 'operations', upgradesEnabled: true });
    start(sim);

    const offer = sim.snapshot().upgradeOffer;
    expect(offer.length).toBe(3);
    expect(new Set(offer).size).toBe(3);
    expect(sim.snapshot().awaitingUpgrade).toBe(true);

    // While an upgrade is pending the arena is frozen: elapsed time must not move.
    const elapsedBefore = sim.snapshot().elapsedMs;
    advance(sim, 1, IDLE);
    expect(sim.snapshot().elapsedMs).toBe(elapsedBefore);

    // Taking a card resolves the offer and applies a real modifier.
    const chosen = offer[0]!;
    expect(sim.chooseUpgrade(chosen)).toBe(true);
    expect(sim.snapshot().awaitingUpgrade).toBe(false);
    expect(sim.snapshot().upgrades).toContain(chosen);
  });

  it('applies the taken upgrade to the run modifiers', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 14, mode: 'operations', upgradesEnabled: true });
    start(sim);
    const offer = sim.snapshot().upgradeOffer;
    // Find a damage card if one is on offer; otherwise any card will do for the
    // "modifiers actually changed" assertion.
    const before = sim.snapshot().modifiers;
    const chosen = offer[0]!;
    sim.chooseUpgrade(chosen);
    const after = sim.snapshot().modifiers;

    const changed = (Object.keys(before) as (keyof typeof before)[]).some((key) => before[key] !== after[key]);
    expect(changed).toBe(true);
    expect(UPGRADES[chosen]).toBeDefined();
  });

  it('does not offer upgrades in a scored survival run', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 15, mode: 'survival' });
    start(sim);
    advance(sim, 2, IDLE);
    expect(sim.snapshot().upgradeOffer).toEqual([]);
    expect(sim.snapshot().awaitingUpgrade).toBe(false);
  });

  it('records objectives completed for the submission payload', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 16, mode: 'operations' });
    start(sim);
    const snapshot = sim.snapshot();
    expect(snapshot.mode).toBe('operations');
    // objectiveIndex is 1-based for display; at the start of the mission it is 1.
    expect(snapshot.mission?.objectiveIndex).toBe(1);
  });
});
