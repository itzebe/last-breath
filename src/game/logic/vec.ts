/** Minimal 2D vector helpers. Plain objects with x/y so they serialise cleanly
 * and stay trivially testable. */
export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, y: v.y * factor };
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Returns a unit vector, or (1, 0) when the input has no direction. */
export function normalise(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/** Angle in radians, measured the same way Phaser does. */
export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function fromAngle(radians: number, magnitude = 1): Vec2 {
  return { x: Math.cos(radians) * magnitude, y: Math.sin(radians) * magnitude };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Moves `from` toward `to` by at most `maxDelta`. */
export function moveTowards(from: Vec2, to: Vec2, maxDelta: number): Vec2 {
  const delta = sub(to, from);
  const dist = length(delta);
  if (dist <= maxDelta || dist === 0) return clone(to);
  return add(from, scale(delta, maxDelta / dist));
}

export function clampMagnitude(v: Vec2, max: number): Vec2 {
  const len = length(v);
  if (len <= max || len === 0) return clone(v);
  return scale(v, max / len);
}

/** Shortest signed angular difference from `a` to `b`, in radians. */
export function angleDelta(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
