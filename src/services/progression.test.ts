import { describe, expect, it } from 'vitest';
import {
  levelForXp,
  levelProgress,
  matchScore,
  matchXp,
  MAX_MATCH_XP,
  xpForLevel,
} from '@/services/progression';

/**
 * The progression curve is duplicated in TypeScript and SQL. These tests pin the
 * TypeScript side to the exact values the SQL helpers produce, so the interface
 * can never show a level the database disagrees with.
 *
 * Reference (from `20261031120000_extensions_and_helpers.sql`):
 *   xp_for_level(L) = (L - 1)^2 * 250
 *   1→0   2→250   3→1,000   4→2,250   5→4,000   10→20,250
 */
describe('level curve', () => {
  it('matches the SQL reference table exactly', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(250);
    expect(xpForLevel(3)).toBe(1_000);
    expect(xpForLevel(4)).toBe(2_250);
    expect(xpForLevel(5)).toBe(4_000);
    expect(xpForLevel(10)).toBe(20_250);
  });

  it('never returns a level below 1', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-100)).toBe(1);
  });

  it('is the exact inverse of xpForLevel at every threshold', () => {
    for (let level = 1; level <= 60; level += 1) {
      const threshold = xpForLevel(level);
      expect(levelForXp(threshold), `level ${level}`).toBe(level);
    }
  });

  it('does not advance a level one XP short of the threshold', () => {
    for (let level = 2; level <= 30; level += 1) {
      const threshold = xpForLevel(level);
      expect(levelForXp(threshold - 1), `level ${level}`).toBe(level - 1);
    }
  });

  it('is monotonic in XP', () => {
    let previous = 0;
    for (let xp = 0; xp <= 50_000; xp += 137) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('handles non-finite and fractional input without producing NaN', () => {
    expect(levelForXp(Number.NaN)).toBe(1);
    expect(levelForXp(1234.9)).toBe(levelForXp(1234));
    expect(xpForLevel(2.9)).toBe(xpForLevel(2));
  });

  it('reports progress inside the current level', () => {
    // Level 3 spans 1,000 → 2,250, a span of 1,250.
    const progress = levelProgress(1_625);
    expect(progress.level).toBe(3);
    expect(progress.into).toBe(625);
    expect(progress.span).toBe(1_250);
    expect(progress.remaining).toBe(625);
    expect(progress.fraction).toBeCloseTo(0.5, 5);
  });

  it('reports zero progress at an exact level threshold', () => {
    const progress = levelProgress(xpForLevel(5));
    expect(progress.level).toBe(5);
    expect(progress.into).toBe(0);
    expect(progress.fraction).toBe(0);
  });

  it('never reports a fraction outside 0–1', () => {
    for (const xp of [0, 1, 249, 250, 999, 1000, 100_000, 10_000_000]) {
      const { fraction } = levelProgress(xp);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('match score', () => {
  const base = {
    mode: 'survival' as const,
    wave: 5,
    eliminations: 40,
    survivalSeconds: 300,
    damageDealt: 5_000,
    outcome: 'defeat' as const,
  };

  it('matches the SQL formula for a defeat', () => {
    // wave*100 + kills*50 + seconds*2
    expect(matchScore(base)).toBe(5 * 100 + 40 * 50 + 300 * 2);
  });

  it('adds the victory bonus', () => {
    expect(matchScore({ ...base, outcome: 'victory' })).toBe(matchScore(base) + 5_000);
  });

  it('adds the deathmatch elimination bonus only in deathmatch', () => {
    expect(matchScore({ ...base, mode: 'deathmatch' })).toBe(matchScore(base) + 40 * 25);
  });

  it('never returns a negative score', () => {
    expect(
      matchScore({ ...base, wave: -10, eliminations: -10, survivalSeconds: -10 }),
    ).toBe(0);
  });
});

describe('match XP', () => {
  const base = {
    mode: 'survival' as const,
    wave: 5,
    eliminations: 40,
    survivalSeconds: 300,
    damageDealt: 5_000,
    outcome: 'defeat' as const,
  };

  it('matches the SQL formula for a defeat', () => {
    // kills*25 + wave*120 + min(seconds,3600)/2 + min(round(sqrt(damage)*2),400)
    const expected =
      40 * 25 + 5 * 120 + 300 / 2 + Math.min(Math.round(Math.sqrt(5_000) * 2), 400);
    expect(matchXp(base)).toBe(Math.round(expected));
  });

  it('adds the victory bonus', () => {
    expect(matchXp({ ...base, outcome: 'victory' })).toBe(matchXp(base) + 750);
  });

  it('caps the survival-time term at one hour', () => {
    const oneHour = matchXp({ ...base, survivalSeconds: 3_600 });
    const tenHours = matchXp({ ...base, survivalSeconds: 36_000 });
    expect(tenHours).toBe(oneHour);
  });

  it('caps the damage term', () => {
    const huge = matchXp({ ...base, damageDealt: 10_000_000 });
    const capped = matchXp({ ...base, damageDealt: 40_000 });
    expect(huge).toBe(capped);
  });

  it('never exceeds the server cap', () => {
    const absurd = matchXp({
      ...base,
      wave: 1_000_000,
      eliminations: 1_000_000,
      survivalSeconds: 1_000_000,
      damageDealt: 1_000_000_000,
      outcome: 'victory',
    });
    expect(absurd).toBe(MAX_MATCH_XP);
  });

  it('never returns a negative value', () => {
    // Every term must be clamped at zero. The damage term is positive here, so
    // the expectation is its contribution rather than zero.
    const damageOnly = Math.min(Math.round(Math.sqrt(base.damageDealt) * 2), 400);
    expect(
      matchXp({ ...base, wave: -5, eliminations: -5, survivalSeconds: -5, damageDealt: 0 }),
    ).toBe(0);
    expect(
      matchXp({ ...base, wave: -5, eliminations: -5, survivalSeconds: -5 }),
    ).toBe(damageOnly);
  });

  it('always returns an integer', () => {
    for (const seconds of [0, 1, 7, 123, 3_599]) {
      expect(Number.isInteger(matchXp({ ...base, survivalSeconds: seconds }))).toBe(true);
    }
  });
});
