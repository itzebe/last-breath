import { describe, expect, it } from 'vitest';
import {
  add,
  angleDelta,
  angleOf,
  clamp,
  clampMagnitude,
  distance,
  distanceSq,
  fromAngle,
  length,
  lengthSq,
  lerp,
  moveTowards,
  normalise,
  scale,
  sub,
  vec,
} from '@/game/logic/vec';

describe('vector helpers', () => {
  it('constructs and clones without sharing references', () => {
    const a = vec(1, 2);
    expect(a).toEqual({ x: 1, y: 2 });
    const b = { ...a };
    b.x = 99;
    expect(a.x).toBe(1);
  });

  it('defaults to the origin', () => {
    expect(vec()).toEqual({ x: 0, y: 0 });
  });

  it('adds and subtracts componentwise', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec(1, 2), vec(3, 4))).toEqual({ x: -2, y: -2 });
  });

  it('scales both components', () => {
    expect(scale(vec(2, -3), 2)).toEqual({ x: 4, y: -6 });
    const zeroed = scale(vec(2, -3), 0);
    // A negative component times zero is `-0`, which is a distinct value under
    // Object.is. It is numerically zero, so compare as a number.
    expect(zeroed.x).toBeCloseTo(0, 12);
    expect(zeroed.y).toBeCloseTo(0, 12);
  });

  it('computes length and squared length consistently', () => {
    const v = vec(3, 4);
    expect(length(v)).toBe(5);
    expect(lengthSq(v)).toBe(25);
  });

  it('computes distance between points', () => {
    expect(distance(vec(0, 0), vec(3, 4))).toBe(5);
    expect(distanceSq(vec(0, 0), vec(3, 4))).toBe(25);
  });

  it('normalises to unit length', () => {
    const unit = normalise(vec(3, 4));
    expect(length(unit)).toBeCloseTo(1, 10);
    expect(unit.x).toBeCloseTo(0.6, 10);
    expect(unit.y).toBeCloseTo(0.8, 10);
  });

  it('returns a safe default direction when normalising a zero vector', () => {
    const unit = normalise(vec(0, 0));
    expect(Number.isFinite(unit.x)).toBe(true);
    expect(Number.isFinite(unit.y)).toBe(true);
    expect(length(unit)).toBeCloseTo(1, 10);
  });

  it('converts to and from an angle round-trip', () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const vector = fromAngle(angle, 5);
      expect(length(vector)).toBeCloseTo(5, 10);
      expect(angleOf(vector)).toBeCloseTo(angle, 10);
    }
  });

  it('interpolates between two points', () => {
    expect(lerp(vec(0, 0), vec(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
    expect(lerp(vec(0, 0), vec(10, 20), 0)).toEqual({ x: 0, y: 0 });
    expect(lerp(vec(0, 0), vec(10, 20), 1)).toEqual({ x: 10, y: 20 });
  });

  it('clamps a vector magnitude without changing its direction', () => {
    const clamped = clampMagnitude(vec(30, 40), 5);
    expect(length(clamped)).toBeCloseTo(5, 10);
    expect(angleOf(clamped)).toBeCloseTo(angleOf(vec(30, 40)), 10);
  });

  it('leaves a vector inside the limit untouched', () => {
    const small = vec(1, 1);
    expect(clampMagnitude(small, 10)).toEqual(small);
  });

  it('clamps a zero vector without dividing by zero', () => {
    const clamped = clampMagnitude(vec(0, 0), 5);
    expect(clamped).toEqual({ x: 0, y: 0 });
  });

  it('moves toward a target and stops exactly on it', () => {
    const moved = moveTowards(vec(0, 0), vec(10, 0), 3);
    expect(moved).toEqual({ x: 3, y: 0 });
    const arrived = moveTowards(vec(0, 0), vec(2, 0), 10);
    expect(arrived).toEqual({ x: 2, y: 0 });
  });

  it('handles moving toward the current position', () => {
    expect(moveTowards(vec(5, 5), vec(5, 5), 10)).toEqual({ x: 5, y: 5 });
  });

  it('clamps a scalar into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('computes the shortest signed angular difference across the wrap point', () => {
    // Just below +π and just above -π are close together, not far apart.
    const delta = angleDelta(Math.PI - 0.1, -Math.PI + 0.1);
    expect(Math.abs(delta)).toBeLessThan(0.3);
    expect(delta).toBeGreaterThan(0);
  });

  it('returns a zero angular difference for identical angles', () => {
    expect(angleDelta(1.234, 1.234)).toBeCloseTo(0, 12);
  });

  it('keeps angular differences within ±π', () => {
    for (const a of [-10, -3, 0, 3, 10]) {
      for (const b of [-10, -3, 0, 3, 10]) {
        const delta = angleDelta(a, b);
        expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI + 1e-10);
      }
    }
  });
});
