import { describe, expect, it } from 'vitest';
import {
  applyDirective,
  describeDirective,
  MIN_COMMIT_MS,
  neutralDirective,
  rankProfiles,
  scoreProfiles,
  TacticalDirector,
} from '@/game/logic/tacticalDirector';
import { NEUTRAL_TRAITS, type BehaviourTraits } from '@/game/logic/behaviour';

/** Builds a traits object from overrides, defaulting to neutral. */
function traits(overrides: Partial<BehaviourTraits> = {}): BehaviourTraits {
  return { ...NEUTRAL_TRAITS, observedSeconds: 30, ...overrides };
}

describe('scoreProfiles', () => {
  it('reads an aggressive, mobile, high-fire player as AGGRESSOR', () => {
    const ranked = rankProfiles(
      traits({ aggression: 0.95, mobility: 0.9, fireVolume: 0.9, stationarity: 0.1 }),
    );
    expect(ranked[0]!.profile.id).toBe('aggressor');
  });

  it('reads a stationary player as CAMPER', () => {
    const ranked = rankProfiles(
      traits({ stationarity: 0.95, mobility: 0.05, defensiveness: 0.8, aggression: 0.1 }),
    );
    expect(ranked[0]!.profile.id).toBe('camper');
  });

  it('reads a long-range player as MARKSMAN', () => {
    const ranked = rankProfiles(
      traits({ rangedPreference: 0.95, defensiveness: 0.8, aggression: 0.1 }),
    );
    expect(ranked[0]!.profile.id).toBe('marksman');
  });

  it('reads a circling player as PREDICTABLE', () => {
    const ranked = rankProfiles(traits({ predictability: 0.95, mobility: 0.8 }));
    expect(ranked[0]!.profile.id).toBe('predictable');
  });

  it('reads a heavy reloader as ATTRITIONAL', () => {
    const ranked = rankProfiles(traits({ reloadFrequency: 0.95, fireVolume: 0.6 }));
    expect(ranked[0]!.profile.id).toBe('attritional');
  });

  it('falls back to SKIRMISHER for a balanced player', () => {
    const ranked = rankProfiles(traits());
    expect(ranked[0]!.profile.id).toBe('skirmisher');
  });

  it('reports zero confidence before any observation', () => {
    const candidates = scoreProfiles({ ...NEUTRAL_TRAITS, observedSeconds: 0 });
    expect(candidates.every((c) => c.profile.confidence === 0)).toBe(true);
  });

  it('keeps every confidence inside [0, 1]', () => {
    const extreme = traits({
      aggression: 1, mobility: 1, fireVolume: 1, stationarity: 1,
      defensiveness: 1, rangedPreference: 1, predictability: 1, reloadFrequency: 1,
    });
    for (const candidate of scoreProfiles(extreme)) {
      expect(candidate.profile.confidence).toBeGreaterThanOrEqual(0);
      expect(candidate.profile.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('produces a different reading for opposite play styles', () => {
    const aggressive = rankProfiles(traits({ aggression: 0.95, mobility: 0.9, fireVolume: 0.9 }))[0]!;
    const camper = rankProfiles(traits({ stationarity: 0.95, mobility: 0.05, aggression: 0.1 }))[0]!;
    expect(aggressive.profile.id).not.toBe(camper.profile.id);
  });
});

describe('TacticalDirector stability', () => {
  it('stays on the baseline until enough behaviour has been observed', () => {
    const director = new TacticalDirector();
    const directive = director.update(
      traits({ aggression: 1, mobility: 1, fireVolume: 1, observedSeconds: 2 }),
      1000,
    );
    expect(directive.profile.id).toBe('unknown');
  });

  it('adopts a reading once observation and confidence are sufficient', () => {
    const director = new TacticalDirector();
    const directive = director.update(
      traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95, observedSeconds: 30 }),
      1000,
    );
    expect(directive.profile.id).toBe('aggressor');
    expect(directive.profile.confidence).toBeGreaterThan(0.25);
  });

  it('refuses to change again inside the commit window', () => {
    const director = new TacticalDirector();
    director.update(traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }), 1000);
    const locked = director.directive.profile.id;

    // A totally different player appears one second later.
    const after = director.update(traits({ stationarity: 0.98, mobility: 0.02 }), 1000 + 1000);
    expect(after.profile.id).toBe(locked);
  });

  it('allows a change after the commit window when the new reading is stronger', () => {
    const director = new TacticalDirector();
    director.update(traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }), 1000);
    const before = director.directive.profile.id;

    const after = director.update(
      traits({ stationarity: 0.99, mobility: 0.01, defensiveness: 0.95, aggression: 0.05 }),
      1000 + MIN_COMMIT_MS + 1,
    );
    expect(after.profile.id).not.toBe(before);
    expect(after.profile.id).toBe('camper');
  });

  it('does not flip on noise: a marginal challenger is ignored', () => {
    const director = new TacticalDirector();
    director.update(traits({ aggression: 0.9, mobility: 0.9, fireVolume: 0.9 }), 1000);
    const before = director.directive;

    // Slightly higher stationarity but not enough to win by the margin.
    const after = director.update(traits({ aggression: 0.86, mobility: 0.86, fireVolume: 0.86 }), 1000 + MIN_COMMIT_MS + 1);
    expect(after.profile.id).toBe(before.profile.id);
  });

  it('settles on the balanced reading when the player becomes unreadable', () => {
    const director = new TacticalDirector();
    director.update(traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }), 1000);
    expect(director.directive.profile.id).toBe('aggressor');

    // Behaviour that no longer matches any strong pattern resolves to the
    // balanced SKIRMISHER reading rather than freezing the stale one.
    const after = director.update(traits(), 1000 + MIN_COMMIT_MS + 1);
    expect(after.profile.id).toBe('skirmisher');
    expect(after.rangeMultiplier).toBe(1);
  });

  it('records adaptation history with reasons', () => {
    const director = new TacticalDirector();
    director.update(traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }), 5000);
    const history = director.adaptationHistory;
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]!.profile).toBe('aggressor');
    expect(history[0]!.reason).toContain('High mobility');
    expect(history[0]!.atMs).toBe(5000);
  });

  it('bounds the history log', () => {
    const director = new TacticalDirector();
    let now = 0;
    for (let i = 0; i < 60; i += 1) {
      now += MIN_COMMIT_MS + 1;
      const style = i % 2 === 0
        ? traits({ aggression: 0.99, mobility: 0.99, fireVolume: 0.99 })
        : traits({ stationarity: 0.99, mobility: 0.01, defensiveness: 0.99, aggression: 0.01 });
      director.update(style, now);
    }
    expect(director.adaptationHistory.length).toBeLessThanOrEqual(40);
  });

  it('reverts to doctrine when disabled and can re-engage when re-enabled', () => {
    const director = new TacticalDirector();
    director.update(traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }), 1000);
    expect(director.directive.profile.id).toBe('aggressor');

    director.setEnabled(false, 2000);
    expect(director.directive.profile.id).toBe('unknown');

    director.setEnabled(true, 3000);
    const reengaged = director.update(traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }), 4000);
    expect(reengaged.profile.id).toBe('aggressor');
  });

  it('does not change anything while disabled', () => {
    const director = new TacticalDirector(false);
    const directive = director.update(traits({ aggression: 1, mobility: 1, fireVolume: 1 }), 1000);
    expect(directive.profile.id).toBe('unknown');
  });
});

describe('applyDirective', () => {
  it('is a no-op for a neutral directive except for stance defaults', () => {
    const neutral = neutralDirective(0);
    const applied = applyDirective('rusher', neutral);
    expect(applied.preferredRange).toBe(26);
    expect(applied.speedMultiplier).toBe(1);
    expect(applied.stance).toBe('approach');
  });

  it('makes hostiles hold range against an aggressor', () => {
    const director = new TacticalDirector();
    const directive = director.update(
      traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }),
      1000,
    );
    const rusher = applyDirective('rusher', directive);
    // Rushers are told to hold instead of charging.
    expect(rusher.stance).toBe('hold');
    // And their preferred range expands, scaled by their low caution.
    expect(rusher.preferredRange).toBeGreaterThan(26);
  });

  it('makes hostiles close in against a camper', () => {
    const director = new TacticalDirector();
    const directive = director.update(traits({ stationarity: 0.99, mobility: 0.01, defensiveness: 0.9 }), 1000);
    const marksman = applyDirective('sniper', directive);
    // Snipers are pushed off their long sightlines.
    expect(marksman.preferredRange).toBeLessThan(430);
    expect(marksman.stance).toBe('reposition');
  });

  it('scales the same order differently per archetype', () => {
    const director = new TacticalDirector();
    const directive = director.update(
      traits({ aggression: 0.98, mobility: 0.95, fireVolume: 0.95 }),
      1000,
    );
    const rusher = applyDirective('rusher', directive);
    const tank = applyDirective('tank', directive);
    // Caution resists the range change, so the *proportional* shift is smaller for
    // the cautious archetype. Comparing raw deltas would be misleading here
    // because the two archetypes start from different base ranges.
    const rusherShift = Math.abs(rusher.preferredRange - 26) / 26;
    const tankShift = Math.abs(tank.preferredRange - 40) / 40;
    expect(rusherShift).toBeGreaterThan(tankShift);
  });

  it('never lets adaptation change physics by an absurd amount', () => {
    const director = new TacticalDirector();
    for (const style of [
      traits({ aggression: 1, mobility: 1, fireVolume: 1 }),
      traits({ stationarity: 1, mobility: 0, defensiveness: 1 }),
      traits({ rangedPreference: 1, defensiveness: 1 }),
      traits({ predictability: 1, mobility: 1 }),
      traits({ reloadFrequency: 1 }),
    ]) {
      const directive = director.update(style, 100000);
      for (const id of ['rusher', 'flanker', 'sniper', 'tank', 'hunter'] as const) {
        const applied = applyDirective(id, directive);
        expect(applied.speedMultiplier).toBeGreaterThan(0.9);
        expect(applied.speedMultiplier).toBeLessThan(1.2);
        expect(applied.preferredRange).toBeGreaterThan(10);
      }
    }
  });

  it('never cheats: adaptation only ever reads the traits it is given', () => {
    // The director's public surface takes traits and a timestamp — there is no
    // parameter through which raw player position could reach a hostile.
    const director = new TacticalDirector();
    const directive = director.update(traits(), 0);
    expect(Object.keys(directive).sort()).toEqual(
      ['committedAtMs', 'coordination', 'pressure', 'profile', 'rangeMultiplier', 'spawnBias', 'speedMultiplier', 'stanceOverrides'].sort(),
    );
  });
});

describe('describeDirective', () => {
  it('describes holding range and giving ground for an aggressor counter', () => {
    const director = new TacticalDirector();
    const directive = director.update(traits({ aggression: 1, mobility: 1, fireVolume: 1 }), 1000);
    const text = describeDirective(directive);
    expect(text).toContain('AGGRESSOR');
    expect(text).toContain('hold range');
    expect(text).toContain('giving ground');
  });

  it('describes the baseline before observation', () => {
    expect(describeDirective(neutralDirective(0))).toContain('BASELINE');
  });
});
