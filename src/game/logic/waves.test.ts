import { describe, expect, it } from 'vitest';
import {
  difficultyIndex,
  eligibleArchetypes,
  isBossWave,
  pickupChance,
  planWave,
  waveClearReward,
} from '@/game/logic/waves';
import {
  ENEMY_ARCHETYPES,
  SPAWNABLE_ARCHETYPES,
  createRng,
  getArchetype,
  pickArchetype,
  scaleForWave,
  type EnemyArchetypeId,
} from '@/game/logic/enemies';

describe('wave planning', () => {
  it('starts the player against a small first wave', () => {
    const plan = planWave(1);
    expect(plan.wave).toBe(1);
    expect(plan.totalEnemies).toBeGreaterThan(0);
    expect(plan.totalEnemies).toBeLessThan(15);
    expect(plan.isBossWave).toBe(false);
  });

  it('increases enemy count monotonically across the first 20 waves', () => {
    let previous = 0;
    for (let wave = 1; wave <= 20; wave += 1) {
      const plan = planWave(wave);
      // Boss waves deliberately send fewer bodies; skip them in the monotonic check.
      if (plan.isBossWave) continue;
      expect(plan.totalEnemies, `wave ${wave}`).toBeGreaterThan(previous);
      previous = plan.totalEnemies;
    }
  });

  it('increases concurrency but caps it so the arena stays legible', () => {
    expect(planWave(2).maxConcurrent).toBeGreaterThan(planWave(1).maxConcurrent);
    expect(planWave(40).maxConcurrent).toBeLessThanOrEqual(22);
  });

  it('shortens the spawn interval as waves progress, with a floor', () => {
    expect(planWave(5).spawnIntervalMs).toBeLessThan(planWave(1).spawnIntervalMs);
    expect(planWave(60).spawnIntervalMs).toBeGreaterThanOrEqual(260);
  });

  it('shortens the intermission as waves progress, with a floor', () => {
    expect(planWave(5).intermissionMs).toBeLessThan(planWave(1).intermissionMs);
    expect(planWave(60).intermissionMs).toBeGreaterThanOrEqual(2400);
  });

  it('gives boss waves a longer intermission and their own label', () => {
    const boss = planWave(10);
    expect(boss.isBossWave).toBe(true);
    expect(boss.label).toContain('EXECUTOR');
    expect(boss.intermissionMs).toBeGreaterThan(planWave(9).intermissionMs);
  });

  it('identifies exactly the boss waves', () => {
    expect(isBossWave(10)).toBe(true);
    expect(isBossWave(20)).toBe(true);
    expect(isBossWave(30)).toBe(true);
    expect(isBossWave(9)).toBe(false);
    expect(isBossWave(11)).toBe(false);
  });

  it('never plans a wave with zero enemies', () => {
    for (const wave of [1, 2, 5, 10, 20, 30, 50, 100]) {
      expect(planWave(wave).totalEnemies).toBeGreaterThan(0);
    }
  });

  it('treats wave 0 and negative waves as wave 1 rather than producing nonsense', () => {
    expect(planWave(0).wave).toBe(1);
    expect(planWave(-5).totalEnemies).toBe(planWave(1).totalEnemies);
  });

  it('unlocks archetypes as waves progress and never loses one', () => {
    const early = eligibleArchetypes(1);
    const late = eligibleArchetypes(20);
    expect(late.length).toBeGreaterThan(early.length);
    for (const id of early) expect(late).toContain(id);
  });

  it('starts with a single archetype so wave 1 teaches one behaviour', () => {
    expect(eligibleArchetypes(1)).toEqual(['rusher']);
  });

  it('produces a difficulty index that rises with wave depth', () => {
    expect(difficultyIndex(10)).toBeGreaterThan(difficultyIndex(1));
    expect(difficultyIndex(20)).toBeGreaterThan(difficultyIndex(10));
  });

  it('awards more XP and score for deeper waves', () => {
    const early = waveClearReward(1);
    const late = waveClearReward(10);
    expect(late.xp).toBeGreaterThan(early.xp);
    expect(late.score).toBeGreaterThan(early.score);
  });

  it('makes health drops scarcer over time but keeps them possible', () => {
    expect(pickupChance(20, 'health')).toBeLessThan(pickupChance(1, 'health'));
    expect(pickupChance(500, 'health')).toBeGreaterThan(0);
  });

  it('keeps ammunition drops roughly constant', () => {
    expect(pickupChance(1, 'ammo')).toBeCloseTo(pickupChance(25, 'ammo'), 6);
  });
});

describe('enemy archetypes', () => {
  it('defines the five spawnable doctrines plus the boss', () => {
    expect(SPAWNABLE_ARCHETYPES).toHaveLength(5);
    expect(SPAWNABLE_ARCHETYPES).toEqual(['rusher', 'flanker', 'sniper', 'tank', 'hunter']);
    expect(ENEMY_ARCHETYPES.executor).toBeDefined();
  });

  it('gives every archetype a complete, sane specification', () => {
    for (const id of Object.keys(ENEMY_ARCHETYPES) as EnemyArchetypeId[]) {
      const archetype = ENEMY_ARCHETYPES[id];
      expect(archetype.id).toBe(id);
      expect(archetype.maxHealth).toBeGreaterThan(0);
      expect(archetype.speed).toBeGreaterThan(0);
      expect(archetype.radius).toBeGreaterThan(0);
      expect(archetype.attackCooldownMs).toBeGreaterThan(0);
      expect(archetype.xpValue).toBeGreaterThan(0);
      expect(archetype.scoreValue).toBeGreaterThan(0);
      expect(archetype.doctrine.length).toBeGreaterThan(10);
      expect(archetype.name.length).toBeGreaterThan(0);
    }
  });

  it('makes each doctrine genuinely distinct in behaviour, not just colour', () => {
    // Rusher, flanker, sniper, tank and hunter must differ in at least two of
    // health, speed, preferred range and damage.
    const ids = SPAWNABLE_ARCHETYPES;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = getArchetype(ids[i]!);
        const b = getArchetype(ids[j]!);
        let differing = 0;
        if (a.maxHealth !== b.maxHealth) differing += 1;
        if (a.speed !== b.speed) differing += 1;
        if (a.preferredRange !== b.preferredRange) differing += 1;
        if (a.contactDamage !== b.contactDamage) differing += 1;
        if (a.rangedDamage !== b.rangedDamage) differing += 1;
        expect(differing, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('makes the tank the toughest and slowest, and the flanker the fastest', () => {
    const tank = getArchetype('tank');
    const flanker = getArchetype('flanker');
    for (const id of SPAWNABLE_ARCHETYPES) {
      if (id === 'tank') continue;
      expect(tank.maxHealth).toBeGreaterThanOrEqual(getArchetype(id).maxHealth);
      expect(tank.speed).toBeLessThanOrEqual(getArchetype(id).speed);
    }
    expect(flanker.speed).toBeGreaterThanOrEqual(getArchetype('rusher').speed);
  });

  it('gives the sniper the longest preferred engagement range', () => {
    const sniper = getArchetype('sniper');
    for (const id of SPAWNABLE_ARCHETYPES) {
      if (id === 'sniper') continue;
      expect(sniper.preferredRange).toBeGreaterThan(getArchetype(id).preferredRange);
    }
  });

  it('gives the sniper a ranged attack and the rusher a contact attack', () => {
    expect(getArchetype('sniper').rangedDamage).toBeGreaterThan(0);
    expect(getArchetype('rusher').contactDamage).toBeGreaterThan(0);
  });

  it('makes the boss considerably tougher than any regular doctrine', () => {
    const boss = getArchetype('executor');
    for (const id of SPAWNABLE_ARCHETYPES) {
      expect(boss.maxHealth).toBeGreaterThan(getArchetype(id).maxHealth);
    }
  });

  it('scales health and damage up with wave depth', () => {
    const rusher = getArchetype('rusher');
    const wave1 = scaleForWave(rusher, 1);
    const wave10 = scaleForWave(rusher, 10);
    expect(wave10.health).toBeGreaterThan(wave1.health);
    expect(wave10.contactDamage).toBeGreaterThanOrEqual(wave1.contactDamage);
  });

  it('caps speed scaling so late waves do not become unplayable', () => {
    const rusher = getArchetype('rusher');
    const wave100 = scaleForWave(rusher, 100);
    // The cap is +30% over base.
    expect(wave100.speed).toBeLessThanOrEqual(Math.round(rusher.speed * 1.3) + 1);
  });

  it('never scales health to a non-finite or negative value', () => {
    const rusher = getArchetype('rusher');
    for (const wave of [1, 10, 100, 1000]) {
      const scaled = scaleForWave(rusher, wave);
      expect(Number.isFinite(scaled.health)).toBe(true);
      expect(scaled.health).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown archetype id', () => {
    expect(() => getArchetype('dragon' as never)).toThrow();
  });

  it('restricts early waves to the unlocked archetypes', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i += 1) {
      expect(pickArchetype(1, rng)).toBe('rusher');
    }
  });

  it('picks from the whole eligible pool at depth', () => {
    const rng = createRng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) seen.add(pickArchetype(25, rng));
    // By wave 25 every doctrine should be reachable.
    for (const id of SPAWNABLE_ARCHETYPES) expect(seen).toContain(id);
  });

  it('is deterministic for a given seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const first = Array.from({ length: 20 }, () => pickArchetype(15, a));
    const second = Array.from({ length: 20 }, () => pickArchetype(15, b));
    expect(first).toEqual(second);
  });

  it('never returns an archetype the wave has not unlocked', () => {
    const rng = createRng(99);
    for (let i = 0; i < 200; i += 1) {
      const picked = pickArchetype(3, rng);
      expect(getArchetype(picked).minWave).toBeLessThanOrEqual(3);
    }
  });

  it('returns a valid archetype even when the allowed list is empty', () => {
    const rng = createRng(1);
    const picked = pickArchetype(10, rng, []);
    expect(SPAWNABLE_ARCHETYPES).toContain(picked);
  });
});
