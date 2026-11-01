import { describe, expect, it } from 'vitest';
import {
  MEMORY_MS,
  REINFORCEMENT_COOLDOWN_MS,
  REVIVE_CHANNEL_MS,
  SNIPER_CHARGE_MS,
  SQUAD_MIN_SIZE,
  applySuppression,
  canSeePlayer,
  clusterSquads,
  coverUrgency,
  createAwareness,
  electCommander,
  findReviveTarget,
  isAlerted,
  isSearching,
  movementForRole,
  shouldCallReinforcements,
  shouldReload,
  sightRangeFor,
  squadFocusAngles,
  squadTarget,
  updateAwareness,
  type SquadMember,
} from '@/game/logic/tactics';
import { getArchetype } from '@/game/logic/enemies';
import type { Obstacle } from '@/game/logic/obstacles';
import { vec } from '@/game/logic/vec';

const WALL: Obstacle = { id: 'w', x: 300, y: 0, width: 60, height: 400, cover: 0.8, kind: 'pillar' };

function member(id: number, x: number, y: number, role: SquadMember['role'] = 'assault'): SquadMember {
  return { id, position: vec(x, y), role, health: 100, maxHealth: 100 };
}

describe('perception and memory', () => {
  it('starts with no knowledge of the player at all', () => {
    const awareness = createAwareness();
    expect(awareness.lastKnown).toBeNull();
    expect(awareness.everSeen).toBe(false);
    expect(isAlerted(awareness)).toBe(false);
  });

  it('records the position the moment the player is visible', () => {
    const awareness = updateAwareness(createAwareness(), 16, true, vec(500, 500));
    expect(awareness.lastKnown).toEqual(vec(500, 500));
    expect(awareness.msSinceSeen).toBe(0);
    expect(isAlerted(awareness)).toBe(true);
  });

  it('keeps remembering for the memory window after losing sight', () => {
    let awareness = updateAwareness(createAwareness(), 16, true, vec(500, 500));
    awareness = updateAwareness(awareness, 2000, false, vec(900, 900));
    expect(awareness.lastKnown).toEqual(vec(500, 500));
    expect(isSearching(awareness)).toBe(true);
  });

  it('genuinely forgets past the memory window — it does not cheat', () => {
    let awareness = updateAwareness(createAwareness(), 16, true, vec(500, 500));
    awareness = updateAwareness(awareness, MEMORY_MS + 100, false, vec(900, 900));
    expect(awareness.lastKnown).toBeNull();
    expect(isAlerted(awareness)).toBe(false);
  });

  it('never invents a position it never saw', () => {
    let awareness = createAwareness();
    for (let i = 0; i < 100; i += 1) awareness = updateAwareness(awareness, 16, false, vec(1234, 567));
    expect(awareness.lastKnown).toBeNull();
    expect(awareness.everSeen).toBe(false);
  });

  it('respects line of sight when deciding what a hostile can see', () => {
    // Player on the far side of a wall, within the rusher's 660-unit sight range.
    expect(canSeePlayer(vec(0, 0), vec(600, 0), 'rusher', [WALL])).toBe(false);
    // Same distance, no wall.
    expect(canSeePlayer(vec(0, 0), vec(600, 0), 'rusher', [])).toBe(true);
  });

  it('refuses to see beyond the archetype sight range', () => {
    expect(canSeePlayer(vec(0, 0), vec(5000, 0), 'rusher', [])).toBe(false);
  });

  it('gives the marksman the longest sight of any infantry archetype', () => {
    const sniper = sightRangeFor('sniper');
    for (const id of ['rusher', 'flanker', 'tank', 'hunter', 'commander', 'medic'] as const) {
      expect(sniper).toBeGreaterThan(sightRangeFor(id));
    }
  });
});

describe('squad coordination', () => {
  it('clusters nearby hostiles into one squad', () => {
    const clusters = clusterSquads([member(1, 0, 0), member(2, 100, 0), member(3, 200, 0)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('keeps distant hostiles in separate squads', () => {
    const clusters = clusterSquads([member(1, 0, 0), member(2, 2000, 0)]);
    expect(clusters).toHaveLength(2);
  });

  it('is deterministic and orders members by id', () => {
    const members = [member(5, 0, 0), member(2, 100, 0), member(9, 200, 0)];
    expect(clusterSquads(members)).toEqual(clusterSquads([...members].reverse()));
    expect(clusterSquads(members)[0]).toEqual([2, 5, 9]);
  });

  it('does not elect a commander for a squad that is too small', () => {
    expect(electCommander([member(1, 0, 0), member(2, 50, 0)])).toBeNull();
  });

  it('always elects a dedicated COMMANDER when one is present', () => {
    const members = [member(1, 0, 0), member(2, 50, 0), member(3, 100, 0, 'commander'), member(4, 150, 0)];
    expect(electCommander(members)).toBe(3);
  });

  it('otherwise elects the healthiest member, with a stable tie-break', () => {
    const members = [
      { ...member(1, 0, 0), health: 40 },
      { ...member(2, 50, 0), health: 90 },
      { ...member(3, 100, 0), health: 60 },
    ];
    expect(electCommander(members)).toBe(2);
  });

  it('fans a squad across distinct approach angles', () => {
    const angles = squadFocusAngles(5);
    expect(angles).toHaveLength(5);
    // Strictly increasing and symmetric around zero.
    for (let i = 1; i < angles.length; i += 1) expect(angles[i]!).toBeGreaterThan(angles[i - 1]!);
    expect(angles[0]! + angles[angles.length - 1]!).toBeCloseTo(0, 6);
  });

  it('gives a lone hostile no fake coordination', () => {
    expect(squadFocusAngles(1)).toEqual([0]);
  });

  it('has a squad minimum of at least three', () => {
    expect(SQUAD_MIN_SIZE).toBeGreaterThanOrEqual(3);
  });

  it('shares the commander’s knowledge with the squad when sight is lost', () => {
    const commanderMemory = vec(800, 400);
    const target = squadTarget(vec(100, 100), commanderMemory, false, vec(0, 0));
    expect(target).toEqual(commanderMemory);
  });

  it('uses live vision over memory when the player is visible', () => {
    const live = vec(1200, 900);
    expect(squadTarget(vec(100, 100), vec(800, 400), true, live)).toEqual(live);
  });
});

describe('cover decisions', () => {
  it('makes a marksman far more cover-seeking than a rusher', () => {
    const context = { suppressed: false, reloading: false, healthFraction: 1, underPressure: false };
    expect(coverUrgency('sniper', context)).toBeGreaterThan(coverUrgency('assault', context));
  });

  it('raises urgency when suppressed, reloading or hurt', () => {
    const calm = coverUrgency('assault', {
      suppressed: false,
      reloading: false,
      healthFraction: 1,
      underPressure: false,
    });
    const pressured = coverUrgency('assault', {
      suppressed: true,
      reloading: true,
      healthFraction: 0.2,
      underPressure: true,
    });
    expect(pressured).toBeGreaterThan(calm);
    expect(pressured).toBeLessThanOrEqual(1);
  });
});

describe('reload decisions', () => {
  it('always reloads an empty magazine', () => {
    expect(shouldReload(0, 30, true, 0)).toBe(true);
  });

  it('keeps firing with sight and a partly-full magazine', () => {
    expect(shouldReload(20, 30, true, 0)).toBe(false);
  });

  it('tops up opportunistically when out of sight and below half', () => {
    expect(shouldReload(10, 30, false, 0)).toBe(true);
    expect(shouldReload(20, 30, false, 0)).toBe(false);
  });

  it('never starts a second reload while one is running', () => {
    expect(shouldReload(0, 30, true, 500)).toBe(false);
  });
});

describe('medic revive targeting', () => {
  it('picks the nearest downed ally within reach', () => {
    const target = findReviveTarget(vec(0, 0), [
      { id: 1, position: vec(500, 0) },
      { id: 2, position: vec(120, 0) },
      { id: 3, position: vec(300, 0) },
    ]);
    expect(target?.id).toBe(2);
  });

  it('returns null when nothing is close enough to help', () => {
    expect(findReviveTarget(vec(0, 0), [{ id: 1, position: vec(5000, 0) }])).toBeNull();
  });

  it('has a positive channel time, so a revive is contestable', () => {
    expect(REVIVE_CHANNEL_MS).toBeGreaterThan(1000);
  });
});

describe('suppression and reinforcement calls', () => {
  it('suppresses on incoming fire and decays otherwise', () => {
    const suppressed = applySuppression(0, true);
    expect(suppressed).toBeGreaterThan(0);
    expect(applySuppression(suppressed, false)).toBe(suppressed);
    expect(applySuppression(0, false)).toBe(0);
  });

  it('calls reinforcements only for a broken squad', () => {
    expect(shouldCallReinforcements(2, 0, 0)).toBe(true);
    expect(shouldCallReinforcements(5, 0, 0)).toBe(false);
  });

  it('respects the call cooldown and the per-commander cap', () => {
    expect(shouldCallReinforcements(1, REINFORCEMENT_COOLDOWN_MS, 0)).toBe(false);
    expect(shouldCallReinforcements(1, 0, 3)).toBe(false);
  });
});

describe('role movement', () => {
  const base = {
    position: vec(0, 0),
    target: vec(400, 0),
    hasSight: true,
    distanceToTarget: 400,
    preferredRange: 100,
    approachOffset: 0,
    coverPosition: null,
    reviveTarget: null,
  } as const;

  it('sends an assault straight at the player', () => {
    const intent = movementForRole('assault', base);
    expect(intent.moving).toBe(true);
    expect(intent.desiredDirection.x).toBeCloseTo(1, 6);
  });

  it('has a marksman hold its preferred band rather than close', () => {
    const inBand = movementForRole('sniper', { ...base, distanceToTarget: 100 });
    expect(inBand.moving).toBe(false);
    // Crowded well inside the band, it backs off.
    const tooClose = movementForRole('sniper', { ...base, distanceToTarget: 5 });
    expect(tooClose.desiredDirection.x).toBeLessThan(0);
  });

  it('makes a flanker approach off-axis', () => {
    const intent = movementForRole('flanker', { ...base, approachOffset: 1 });
    expect(Math.abs(intent.desiredDirection.y)).toBeGreaterThan(0.1);
  });

  it('sends everyone to cover when cover has been chosen', () => {
    const intent = movementForRole('assault', { ...base, coverPosition: vec(0, 300) });
    expect(intent.desiredDirection.y).toBeCloseTo(1, 6);
  });

  it('sends a medic to a downed ally instead of the player', () => {
    const intent = movementForRole('medic', { ...base, reviveTarget: vec(0, -200) });
    expect(intent.desiredDirection.y).toBeCloseTo(-1, 6);
  });

  it('stops at the last-known position when sight has been lost', () => {
    const far = movementForRole('hunter', { ...base, hasSight: false, distanceToTarget: 300 });
    expect(far.moving).toBe(true);
    const arrived = movementForRole('hunter', { ...base, hasSight: false, distanceToTarget: 20 });
    expect(arrived.moving).toBe(false);
  });

  it('keeps a commander at a standoff rather than leading the charge', () => {
    // The commander's own floor is 320 units; at 200 it backs off, at 340 it holds.
    const tooClose = movementForRole('commander', { ...base, distanceToTarget: 200 });
    expect(tooClose.moving).toBe(true);
    expect(tooClose.desiredDirection.x).toBeLessThan(0);
    const holding = movementForRole('commander', { ...base, distanceToTarget: 340 });
    expect(holding.moving).toBe(false);
  });
});

describe('sniper telegraph', () => {
  it('has a readable, positive aim charge', () => {
    expect(SNIPER_CHARGE_MS).toBeGreaterThan(300);
    expect(SNIPER_CHARGE_MS).toBeLessThan(getArchetype('sniper').attackCooldownMs);
  });
});
