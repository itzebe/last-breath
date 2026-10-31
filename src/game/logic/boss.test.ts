import { describe, expect, it } from 'vitest';
import {
  BOSS_ATTACKS,
  BOSS_PHASE_THRESHOLDS,
  BOSS_PHASE_TRANSITION_MS,
  bossPhaseForHealth,
  bossStanceForPhase,
  chooseBossAttack,
  nextBossPhase,
  type BossAttackKind,
  type BossPhase,
} from '@/game/logic/boss';
import { CombatSimulation, type SimulationEvent, type SimulationInput } from '@/game/logic/simulation';
import { vec } from '@/game/logic/vec';

const FRAME_MS = 1000 / 60;
const IDLE: SimulationInput = { move: vec(), aim: null, firing: false };

/** A run that opens directly on the boss wave (wave 10), so the boss tests do
 * not depend on surviving nine waves of escalating hostiles. */
function bossRun(seed = 5): CombatSimulation {
  const sim = new CombatSimulation({ loadout: ['sniper', 'rifle'], seed, maxWaves: 10, startWave: 10 });
  for (let i = 0; i < 60 * 4; i += 1) sim.step(FRAME_MS, IDLE);
  return sim;
}

/**
 * One frame of a competent fight: aim at the nearest living hostile (the boss
 * first, since it is the objective), hold fire, and reload the moment the
 * magazine runs dry. Without the reload the rifle exhausts its 32 rounds and the
 * fight silently stalls, which is exactly the kind of dead-end these tests exist
 * to catch.
 */
function fightStep(sim: CombatSimulation): void {
  const snapshot = sim.snapshot();
  const living = snapshot.enemies.filter((enemy) => !enemy.dying);
  const boss = living.find((enemy) => enemy.isBoss);
  let target = boss ?? null;
  if (!target) {
    let nearest = Infinity;
    for (const enemy of living) {
      const dx = enemy.position.x - sim.playerPos.x;
      const dy = enemy.position.y - sim.playerPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < nearest) {
        nearest = dist;
        target = enemy;
      }
    }
  }
  const weapon = snapshot.player.weapons[snapshot.player.weapon];
  if (weapon && weapon.ammoInMagazine === 0) sim.requestReload();

  // Close the distance so range-keeping hostiles cannot stall the run forever.
  let move = vec();
  if (target) {
    const dx = target.position.x - sim.playerPos.x;
    const dy = target.position.y - sim.playerPos.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    if (len > 220) move = vec(dx / len, dy / len);
  }
  sim.step(FRAME_MS, { move, aim: target ? { ...target.position } : null, firing: true });
}

describe('THE EXECUTOR — attack catalogue', () => {
  it('every attack telegraphs for a readable window shorter than its cooldown', () => {
    for (const [kind, spec] of Object.entries(BOSS_ATTACKS)) {
      expect(spec.telegraphMs, `${kind} telegraph`).toBeGreaterThan(0);
      expect(spec.cooldownMs, `${kind} cooldown`).toBeGreaterThan(0);
      expect(spec.telegraphMs, `${kind} telegraph < cooldown`).toBeLessThan(spec.cooldownMs);
    }
  });

  it('assigns each attack to exactly the phase that uses it', () => {
    expect(BOSS_ATTACKS.volley.phase).toBe(1);
    expect(BOSS_ATTACKS.lance.phase).toBe(2);
    expect(BOSS_ATTACKS.burst.phase).toBe(3);
    expect(BOSS_ATTACKS.spiral.phase).toBe(3);
    expect(BOSS_ATTACKS.slam.phase).toBe(3);
  });
});

describe('THE EXECUTOR — phase thresholds', () => {
  it('maps health fractions to phases at the documented thresholds', () => {
    expect(BOSS_PHASE_THRESHOLDS.phase2).toBeGreaterThan(BOSS_PHASE_THRESHOLDS.phase3);
    expect(BOSS_PHASE_THRESHOLDS.phase3).toBeGreaterThan(0);
    expect(BOSS_PHASE_THRESHOLDS.phase2).toBeLessThan(1);

    expect(bossPhaseForHealth(1)).toBe(1);
    expect(bossPhaseForHealth(BOSS_PHASE_THRESHOLDS.phase2 + 0.01)).toBe(1);
    expect(bossPhaseForHealth(BOSS_PHASE_THRESHOLDS.phase2)).toBe(2);
    expect(bossPhaseForHealth(BOSS_PHASE_THRESHOLDS.phase3 + 0.01)).toBe(2);
    expect(bossPhaseForHealth(BOSS_PHASE_THRESHOLDS.phase3)).toBe(3);
    expect(bossPhaseForHealth(0)).toBe(3);
  });

  it('clamps out-of-range health ratios instead of throwing', () => {
    expect(bossPhaseForHealth(2)).toBe(1);
    expect(bossPhaseForHealth(-1)).toBe(3);
    expect(bossPhaseForHealth(Number.NaN)).toBe(3);
  });

  it('reports a transition only when the phase actually changes', () => {
    expect(nextBossPhase(1, 1)).toBeNull();
    expect(nextBossPhase(1, BOSS_PHASE_THRESHOLDS.phase2)).toEqual({ from: 1, to: 2 });
    expect(nextBossPhase(1, 0.1)).toEqual({ from: 1, to: 3 });
    expect(nextBossPhase(3, 0)).toBeNull();
  });
});

describe('THE EXECUTOR — attack selection', () => {
  it('phase 1 only ever chooses the volley', () => {
    for (let index = 0; index < 12; index += 1) expect(chooseBossAttack(1, 400, index)).toBe('volley');
  });

  it('phase 2 only ever chooses the lance', () => {
    for (let index = 0; index < 12; index += 1) expect(chooseBossAttack(2, 400, index)).toBe('lance');
  });

  it('phase 3 rotates through the area patterns when the player is close', () => {
    const seen = new Set<BossAttackKind>();
    for (let index = 0; index < 9; index += 1) seen.add(chooseBossAttack(3, 200, index));
    expect(seen).toEqual(new Set<BossAttackKind>(['burst', 'spiral', 'slam']));
  });

  it('phase 3 drops the slam when the player is out of its range', () => {
    const far = BOSS_ATTACKS.slam.maxRange + 200;
    for (let index = 0; index < 9; index += 1) expect(chooseBossAttack(3, far, index)).not.toBe('slam');
  });

  it('is deterministic: the same index always yields the same attack', () => {
    for (let index = 0; index < 6; index += 1) {
      expect(chooseBossAttack(3, 200, index)).toBe(chooseBossAttack(3, 200, index));
    }
  });

  it('holds a distinct stance per phase', () => {
    const stances = new Set([bossStanceForPhase(1), bossStanceForPhase(2), bossStanceForPhase(3)]);
    expect(stances.size).toBe(3);
  });
});

describe('THE EXECUTOR — live arena integration', () => {
  it('spawns on the boss wave with a health pool and reports phase 1', () => {
    const snapshot = bossRun().snapshot();
    const boss = snapshot.enemies.find((enemy) => enemy.isBoss);
    expect(boss).toBeDefined();
    expect(boss?.phase).toBe(1);
    expect(snapshot.bossPhase).toBe(1);
    expect(snapshot.bossHealth).toBeGreaterThan(0);
    expect(snapshot.bossMaxHealth).toBe(boss?.maxHealth);
  });

  it('telegraphs before it fires: the wind-up is visible, then the attack lands', () => {
    const sim = bossRun();
    const events: SimulationEvent[] = [];
    sim.subscribe((event) => events.push(event));

    let sawTelegraph = false;
    for (let i = 0; i < 900 && !sawTelegraph; i += 1) {
      sim.step(FRAME_MS, IDLE);
      if (sim.snapshot().bossTelegraphMs > 0) sawTelegraph = true;
    }
    expect(sawTelegraph).toBe(true);

    const telegraphAttack = sim.snapshot().bossTelegraphAttack;
    expect(telegraphAttack).not.toBeNull();
    expect(events.some((event) => event.type === 'boss_attack')).toBe(false);

    const spec = BOSS_ATTACKS[telegraphAttack as BossAttackKind];
    for (let i = 0; i < Math.ceil(spec.telegraphMs / FRAME_MS) + 6; i += 1) sim.step(FRAME_MS, IDLE);

    const attackEvent = events.find((event) => event.type === 'boss_attack');
    expect(attackEvent).toBeDefined();
    if (attackEvent?.type === 'boss_attack') expect(attackEvent.attack).toBe(telegraphAttack);
  });

  it('escalates the attack pattern once a phase threshold is crossed', () => {
    // The player is deliberately invulnerable here: the assertion is about the
    // boss's decision wiring, not about surviving the fight, so the run must not
    // end before the escalation is observable.
    const sim = new CombatSimulation({
      loadout: ['rifle'],
      seed: 11,
      maxWaves: 10,
      startWave: 10,
      playerInvulnerable: true,
    });
    for (let i = 0; i < 60 * 4; i += 1) sim.step(FRAME_MS, IDLE);

    const events: SimulationEvent[] = [];
    sim.subscribe((event) => events.push(event));

    const seenPhases = new Set<BossPhase>();
    let sawTransitionPause = false;
    for (let i = 0; i < 60 * 180 && !sim.isEnded; i += 1) {
      const snapshot = sim.snapshot();
      if (snapshot.bossPhase) seenPhases.add(snapshot.bossPhase);
      if (snapshot.bossTransitioning) sawTransitionPause = true;
      fightStep(sim);
      if (seenPhases.has(3)) break;
    }

    expect(seenPhases.has(1)).toBe(true);
    expect(seenPhases.size).toBeGreaterThan(1);
    expect(sawTransitionPause).toBe(true);

    const attacks = events
      .filter((event): event is Extract<SimulationEvent, { type: 'boss_attack' }> => event.type === 'boss_attack')
      .map((event) => event.attack);
    expect(attacks.some((attack) => attack !== 'volley')).toBe(true);

    // The pause is a real, positive window.
    expect(BOSS_PHASE_TRANSITION_MS).toBeGreaterThan(BOSS_ATTACKS.volley.telegraphMs);
  });

  it('reports victory and the boss flag once the boss dies', () => {
    const sim = new CombatSimulation({
      loadout: ['rifle'],
      seed: 11,
      maxWaves: 10,
      startWave: 10,
      playerInvulnerable: true,
    });
    for (let i = 0; i < 60 * 4; i += 1) sim.step(FRAME_MS, IDLE);

    const events: SimulationEvent[] = [];
    sim.subscribe((event) => events.push(event));

    for (let i = 0; i < 60 * 300 && !sim.isEnded; i += 1) {
      fightStep(sim);
    }

    expect(sim.snapshot().bossDefeated).toBe(true);
    const bossDeath = events.find(
      (event) => event.type === 'enemy_died' && event.archetype === 'executor',
    );
    expect(bossDeath).toBeDefined();
    expect(sim.snapshot().outcome).toBe('victory');
  });

  it('never exposes boss fields in a non-boss run', () => {
    const sim = new CombatSimulation({ loadout: ['rifle'], seed: 3, maxWaves: 2 });
    for (let i = 0; i < 60 * 20 && !sim.isEnded; i += 1) sim.step(FRAME_MS, { move: vec(), aim: null, firing: true });
    expect(sim.snapshot().bossHealth).toBeNull();
    expect(sim.snapshot().bossPhase).toBeNull();
    expect(sim.snapshot().bossTelegraphMs).toBe(0);
    expect(sim.snapshot().bossTelegraphAttack).toBeNull();
  });
});
