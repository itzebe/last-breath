import { describe, expect, it } from 'vitest';
import {
  BehaviourObserver,
  MIN_OBSERVATION_SECONDS,
  NEUTRAL_TRAITS,
  type PlayerTelemetrySample,
} from '@/game/logic/behaviour';

/** Feeds the observer a synthetic player for `seconds` at 60Hz. */
function simulate(
  observer: BehaviourObserver,
  seconds: number,
  shape: Partial<PlayerTelemetrySample>,
): void {
  const dt = 1000 / 60;
  const steps = Math.round((seconds * 1000) / dt);
  for (let i = 0; i < steps; i += 1) {
    observer.observe({
      dtMs: dt,
      speed: 0,
      nearestEnemyDistance: 300,
      didFire: false,
      didReload: false,
      heading: 0,
      arenaWidth: 2000,
      arenaHeight: 2000,
      ...shape,
      // Allow a per-step callback by passing functions through a wrapper below.
    });
  }
}

describe('BehaviourObserver', () => {
  it('starts neutral before any observation', () => {
    const observer = new BehaviourObserver();
    const traits = observer.snapshot();
    expect(traits.mobility).toBe(NEUTRAL_TRAITS.mobility);
    expect(traits.stationarity).toBe(NEUTRAL_TRAITS.stationarity);
    expect(observer.isReady()).toBe(false);
  });

  it('reports a stationary player as high stationarity, low mobility', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 10, { speed: 0 });
    const traits = observer.snapshot();
    expect(traits.stationarity).toBeGreaterThan(0.8);
    expect(traits.mobility).toBeLessThan(0.2);
  });

  it('reports a constantly moving player as high mobility', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 10, { speed: 120 });
    const traits = observer.snapshot();
    expect(traits.mobility).toBeGreaterThan(0.8);
    expect(traits.stationarity).toBeLessThan(0.2);
  });

  it('keeps mobility and stationarity exact complements so they cannot contradict', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 5, { speed: 100 });
    simulate(observer, 5, { speed: 0 });
    const traits = observer.snapshot();
    expect(traits.mobility + traits.stationarity).toBeCloseTo(1, 6);
  });

  it('raises ranged preference when engaging from far away', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 12, { nearestEnemyDistance: 500 });
    expect(observer.snapshot().rangedPreference).toBeGreaterThan(0.7);
  });

  it('lowers ranged preference when engaging up close', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 12, { nearestEnemyDistance: 60 });
    expect(observer.snapshot().rangedPreference).toBeLessThan(0.3);
  });

  it('raises fire volume for a player who fires constantly', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 10, { didFire: true, nearestEnemyDistance: 200 });
    expect(observer.snapshot().fireVolume).toBeGreaterThan(0.7);
  });

  it('detects repeated movement direction as predictability', () => {
    const observer = new BehaviourObserver();
    const dt = 1000 / 60;
    // A player circling consistently in one direction.
    for (let i = 0; i < 900; i += 1) {
      observer.observe({
        dtMs: dt,
        speed: 140,
        nearestEnemyDistance: 250,
        didFire: false,
        didReload: false,
        heading: i * 0.02, // steadily increasing → one consistent turn direction
        arenaWidth: 2000,
        arenaHeight: 2000,
      });
    }
    expect(observer.snapshot().predictability).toBeGreaterThan(0.5);
  });

  it('does not report predictability for jittery, alternating movement', () => {
    const observer = new BehaviourObserver();
    const dt = 1000 / 60;
    for (let i = 0; i < 900; i += 1) {
      observer.observe({
        dtMs: dt,
        speed: 140,
        nearestEnemyDistance: 250,
        didFire: false,
        didReload: false,
        // Alternating turn direction cancels out in the running tally.
        heading: (i % 2 === 0 ? 1 : -1) * 0.5,
        arenaWidth: 2000,
        arenaHeight: 2000,
      });
    }
    expect(observer.snapshot().predictability).toBeLessThan(0.4);
  });

  it('becomes ready only after the minimum observation window', () => {
    const observer = new BehaviourObserver();
    simulate(observer, MIN_OBSERVATION_SECONDS - 1, { speed: 100 });
    expect(observer.isReady()).toBe(false);
    simulate(observer, 2, { speed: 100 });
    expect(observer.isReady()).toBe(true);
  });

  it('moves traits gradually rather than snapping on one frame', () => {
    const observer = new BehaviourObserver();
    // A single frame of movement must barely move the needle.
    observer.observe({
      dtMs: 16,
      speed: 200,
      nearestEnemyDistance: 100,
      didFire: true,
      didReload: false,
      heading: 0,
      arenaWidth: 2000,
      arenaHeight: 2000,
    });
    const traits = observer.snapshot();
    expect(traits.mobility).toBeLessThan(0.55);
    expect(traits.mobility).toBeGreaterThan(0.5);
  });

  it('ignores zero-duration samples instead of dividing by zero', () => {
    const observer = new BehaviourObserver();
    const before = observer.snapshot();
    observer.observe({
      dtMs: 0,
      speed: 999,
      nearestEnemyDistance: 1,
      didFire: true,
      didReload: true,
      heading: 3,
      arenaWidth: 2000,
      arenaHeight: 2000,
    });
    expect(observer.snapshot()).toEqual(before);
  });

  it('resets cleanly between matches', () => {
    const observer = new BehaviourObserver();
    simulate(observer, 12, { speed: 200, nearestEnemyDistance: 60, didFire: true });
    expect(observer.isReady()).toBe(true);
    observer.reset();
    expect(observer.snapshot()).toEqual(NEUTRAL_TRAITS);
    expect(observer.isReady()).toBe(false);
  });
});
