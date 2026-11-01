import { describe, expect, it } from 'vitest';
import {
  ALL_UPGRADE_IDS,
  BASE_MODIFIERS,
  MODIFIER_CAPS,
  UPGRADES,
  applyUpgrade,
  modifiersFor,
  rollUpgradeOffer,
  summariseModifiers,
  type UpgradeId,
} from '@/game/logic/upgrades';
import { createSeededRandom } from '@/game/logic/simulation';

describe('upgrade catalogue', () => {
  it('defines a spec for every id, with a usable name and description', () => {
    for (const id of ALL_UPGRADE_IDS) {
      const spec = UPGRADES[id];
      expect(spec.id).toBe(id);
      expect(spec.name.length).toBeGreaterThan(2);
      expect(spec.description.length).toBeGreaterThan(10);
      expect(spec.maxStacks).toBeGreaterThan(0);
    }
  });

  it('covers every axis of play, not just damage', () => {
    const categories = new Set(ALL_UPGRADE_IDS.map((id) => UPGRADES[id].category));
    expect(categories).toContain('offence');
    expect(categories).toContain('defence');
    expect(categories).toContain('mobility');
    expect(categories).toContain('utility');
  });
});

describe('upgrade effects', () => {
  it('changes the modifier the description claims', () => {
    const boosted = applyUpgrade(BASE_MODIFIERS, 'hollow_point');
    expect(boosted.damageMultiplier).toBeGreaterThan(BASE_MODIFIERS.damageMultiplier);

    const faster = applyUpgrade(BASE_MODIFIERS, 'quick_hands');
    expect(faster.reloadMultiplier).toBeLessThan(BASE_MODIFIERS.reloadMultiplier);

    const tougher = applyUpgrade(BASE_MODIFIERS, 'plating');
    expect(tougher.damageTakenMultiplier).toBeLessThan(BASE_MODIFIERS.damageTakenMultiplier);
  });

  it('never mutates the input modifier set', () => {
    const before = { ...BASE_MODIFIERS };
    applyUpgrade(BASE_MODIFIERS, 'hollow_point');
    expect(BASE_MODIFIERS).toEqual(before);
  });

  it('composes multiple upgrades', () => {
    const modifiers = modifiersFor(['hollow_point', 'hollow_point', 'light_boots']);
    expect(modifiers.damageMultiplier).toBeGreaterThan(1.2);
    expect(modifiers.speedMultiplier).toBeGreaterThan(1);
  });
});

describe('stacking caps — the anti-trivialisation guarantee', () => {
  it('caps damage however many offence cards are taken', () => {
    const modifiers = modifiersFor(Array.from({ length: 40 }, () => 'hollow_point' as UpgradeId));
    expect(modifiers.damageMultiplier).toBeLessThanOrEqual(MODIFIER_CAPS.damageMultiplier);
  });

  it('never lets armour reach immunity', () => {
    const modifiers = modifiersFor(Array.from({ length: 40 }, () => 'plating' as UpgradeId));
    expect(modifiers.damageTakenMultiplier).toBeGreaterThanOrEqual(MODIFIER_CAPS.damageTakenMultiplier);
    expect(modifiers.damageTakenMultiplier).toBeGreaterThan(0);
  });

  it('never lets the dodge cooldown reach zero', () => {
    const modifiers = modifiersFor(Array.from({ length: 40 }, () => 'adrenaline' as UpgradeId));
    expect(modifiers.dodgeCooldownMultiplier).toBeGreaterThanOrEqual(MODIFIER_CAPS.dodgeCooldownMultiplier);
    expect(modifiers.dodgeCooldownMultiplier).toBeGreaterThan(0);
  });

  it('caps weak-point chance below certainty', () => {
    const modifiers = modifiersFor(Array.from({ length: 40 }, () => 'deadeye' as UpgradeId));
    expect(modifiers.critChance).toBeLessThanOrEqual(MODIFIER_CAPS.critChance);
    expect(modifiers.critChance).toBeLessThan(1);
  });

  it('caps movement speed, reload speed and magazine size', () => {
    expect(
      modifiersFor(Array.from({ length: 40 }, () => 'light_boots' as UpgradeId)).speedMultiplier,
    ).toBeLessThanOrEqual(MODIFIER_CAPS.speedMultiplier);
    expect(
      modifiersFor(Array.from({ length: 40 }, () => 'quick_hands' as UpgradeId)).reloadMultiplier,
    ).toBeGreaterThanOrEqual(MODIFIER_CAPS.reloadMultiplier);
    expect(
      modifiersFor(Array.from({ length: 40 }, () => 'twin_mag' as UpgradeId)).magazineMultiplier,
    ).toBeLessThanOrEqual(MODIFIER_CAPS.magazineMultiplier);
  });

  it('holds the caps regardless of application order', () => {
    const ids: UpgradeId[] = ['plating', 'hollow_point', 'deadeye', 'adrenaline'];
    const forwards = modifiersFor(ids);
    const backwards = modifiersFor([...ids].reverse());
    expect(forwards).toEqual(backwards);
  });
});

describe('upgrade offers', () => {
  it('offers three distinct upgrades', () => {
    const offer = rollUpgradeOffer([], 0, createSeededRandom(1));
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
  });

  it('never offers something already at its stack cap', () => {
    // twin_mag caps at 2.
    const offer = rollUpgradeOffer(['twin_mag', 'twin_mag'], 3, createSeededRandom(2));
    expect(offer).not.toContain('twin_mag');
  });

  it('is deterministic for a seed', () => {
    const a = rollUpgradeOffer([], 2, createSeededRandom(42));
    const b = rollUpgradeOffer([], 2, createSeededRandom(42));
    expect(a).toEqual(b);
  });

  it('biases the offer toward at least two different categories', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const offer = rollUpgradeOffer([], 0, createSeededRandom(seed));
      const categories = new Set(offer.map((id) => UPGRADES[id].category));
      expect(categories.size, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns an empty offer when everything is maxed', () => {
    const maxed = ALL_UPGRADE_IDS.flatMap((id) => Array.from({ length: UPGRADES[id].maxStacks }, () => id));
    expect(rollUpgradeOffer(maxed, 20, createSeededRandom(3))).toEqual([]);
  });
});

describe('modifier summary', () => {
  it('says nothing when nothing has been taken', () => {
    expect(summariseModifiers(BASE_MODIFIERS)).toEqual([]);
  });

  it('describes each changed axis', () => {
    const lines = summariseModifiers(modifiersFor(['hollow_point', 'plating', 'deadeye']));
    expect(lines.some((line) => line.includes('Damage'))).toBe(true);
    expect(lines.some((line) => line.includes('Damage taken'))).toBe(true);
    expect(lines.some((line) => line.includes('Weak-point'))).toBe(true);
  });
});
