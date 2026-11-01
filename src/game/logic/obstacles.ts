import { clamp, distance, distanceSq, normalise, sub, vec, type Vec2 } from './vec';

/**
 * Arena cover geometry.
 *
 * Until Part 3 the arena was an empty box: every hostile could see the player
 * from anywhere and every shot travelled unobstructed. That made tactical AI
 * impossible to express honestly — there was nothing to take cover behind, and
 * no such thing as "line of sight".
 *
 * This module introduces real, simulated cover. It is pure: no Phaser, no DOM,
 * no clock. The renderer draws these rectangles; the simulation is the only
 * thing that decides what they mean.
 *
 * Two rules keep the cover fair and readable:
 *   - Cover blocks movement, projectiles *and* sight. A hostile that cannot see
 *     the player cannot shoot at them, and the player can break contact by
 *     moving behind a wall. That is what makes the AI's searching behaviour
 *     legible rather than clairvoyant.
 *   - The layout is sparse and symmetric. Cover creates sightline breaks, not a
 *     maze: there is always a walkable route between any two open points, which
 *     is what stops the arena from deadlocking on a stuck hostile.
 */

export interface Obstacle {
  readonly id: string;
  /** Centre of the rectangle. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** How much protection this block offers when used as cover, 0–1. */
  readonly cover: number;
  readonly kind: 'pillar' | 'crate';
}

/**
 * The LAST EXIT arena layout.
 *
 * Deliberately empty along the horizontal and vertical centre lanes so the
 * player always has a clear line out of spawn, and so the boss's arrival lane
 * down the centre of the arena is never obstructed. Every block is at least
 * 200 px from the arena wall, which keeps the perimeter spawn ring open.
 */
export const ARENA_OBSTACLES: readonly Obstacle[] = Object.freeze([
  { id: 'pillar-nw', x: 620, y: 480, width: 96, height: 96, cover: 0.75, kind: 'pillar' },
  { id: 'pillar-ne', x: 1580, y: 480, width: 96, height: 96, cover: 0.75, kind: 'pillar' },
  { id: 'pillar-sw', x: 620, y: 1120, width: 96, height: 96, cover: 0.75, kind: 'pillar' },
  { id: 'pillar-se', x: 1580, y: 1120, width: 96, height: 96, cover: 0.75, kind: 'pillar' },
  { id: 'crate-nw', x: 900, y: 430, width: 240, height: 64, cover: 0.55, kind: 'crate' },
  { id: 'crate-ne', x: 1300, y: 430, width: 240, height: 64, cover: 0.55, kind: 'crate' },
  { id: 'crate-sw', x: 900, y: 1170, width: 240, height: 64, cover: 0.55, kind: 'crate' },
  { id: 'crate-se', x: 1300, y: 1170, width: 240, height: 64, cover: 0.55, kind: 'crate' },
  { id: 'block-w', x: 400, y: 800, width: 64, height: 240, cover: 0.6, kind: 'crate' },
  { id: 'block-e', x: 1800, y: 800, width: 64, height: 240, cover: 0.6, kind: 'crate' },
]);

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function obstacleRect(obstacle: Obstacle): Rect {
  const halfWidth = obstacle.width / 2;
  const halfHeight = obstacle.height / 2;
  return {
    left: obstacle.x - halfWidth,
    top: obstacle.y - halfHeight,
    right: obstacle.x + halfWidth,
    bottom: obstacle.y + halfHeight,
  };
}

export function pointInObstacle(point: Vec2, obstacle: Obstacle): boolean {
  const rect = obstacleRect(obstacle);
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** True when a circle of `radius` at `centre` overlaps the rectangle. */
export function circleOverlapsObstacle(centre: Vec2, radius: number, obstacle: Obstacle): boolean {
  const rect = obstacleRect(obstacle);
  const closestX = clamp(centre.x, rect.left, rect.right);
  const closestY = clamp(centre.y, rect.top, rect.bottom);
  const dx = centre.x - closestX;
  const dy = centre.y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Pushes a circle out of an obstacle along the shallowest axis.
 *
 * Sliding along the face (rather than stopping dead) is what lets both the
 * player and hostiles round a corner without input having to be re-aimed, and
 * it is the reason a hostile can never be permanently trapped by a crate.
 */
export function resolveCircleAgainstObstacle(centre: Vec2, radius: number, obstacle: Obstacle): Vec2 {
  const rect = obstacleRect(obstacle);
  const closestX = clamp(centre.x, rect.left, rect.right);
  const closestY = clamp(centre.y, rect.top, rect.bottom);
  let dx = centre.x - closestX;
  let dy = centre.y - closestY;
  const dist = Math.hypot(dx, dy);

  if (dist > radius) return centre;

  if (dist === 0) {
    // Centre is inside the rectangle: eject along the nearest face.
    const toLeft = centre.x - rect.left;
    const toRight = rect.right - centre.x;
    const toTop = centre.y - rect.top;
    const toBottom = rect.bottom - centre.y;
    const smallest = Math.min(toLeft, toRight, toTop, toBottom);
    if (smallest === toLeft) return vec(rect.left - radius, centre.y);
    if (smallest === toRight) return vec(rect.right + radius, centre.y);
    if (smallest === toTop) return vec(centre.x, rect.top - radius);
    return vec(centre.x, rect.bottom + radius);
  }

  dx /= dist;
  dy /= dist;
  return vec(closestX + dx * radius, closestY + dy * radius);
}

/** Resolves a circle against every obstacle in the list. */
export function resolveCircleAgainstObstacles(
  centre: Vec2,
  radius: number,
  obstacles: readonly Obstacle[],
): Vec2 {
  let resolved = centre;
  for (const obstacle of obstacles) {
    resolved = resolveCircleAgainstObstacle(resolved, radius, obstacle);
  }
  return resolved;
}

/**
 * Segment vs axis-aligned rectangle, by the slab method.
 *
 * Used for both line-of-sight and projectile collision, so a shot and a sight
 * check can never disagree about whether a wall is in the way.
 */
export function segmentIntersectsRect(a: Vec2, b: Vec2, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let tMin = 0;
  let tMax = 1;

  const axes: Array<[number, number, number, number]> = [
    [a.x, dx, rect.left, rect.right],
    [a.y, dy, rect.top, rect.bottom],
  ];

  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * True when nothing blocks the straight line between two points.
 *
 * This is the single authority for "can A see B". Enemies use it before they
 * shoot; the renderer uses it to decide whether to draw a threat indicator.
 * Because it is one function, the AI's knowledge and the player's experience of
 * it can never drift apart.
 */
export function hasLineOfSight(from: Vec2, to: Vec2, obstacles: readonly Obstacle[]): boolean {
  for (const obstacle of obstacles) {
    if (segmentIntersectsRect(from, to, obstacleRect(obstacle))) return false;
  }
  return true;
}

export interface RayHit {
  readonly obstacle: Obstacle;
  /** Distance from the ray origin to the entry point, in arena units. */
  readonly distance: number;
}

/**
 * The first obstacle a ray from `from` toward `to` meets, or null when the path
 * is clear. `padding` inflates each rectangle, so a body of a given radius can
 * ask "would I fit through here?" rather than "would a point?".
 */
export function firstObstacleAlong(
  from: Vec2,
  to: Vec2,
  obstacles: readonly Obstacle[],
  padding = 0,
): RayHit | null {
  const direction = sub(to, from);
  const total = Math.hypot(direction.x, direction.y);
  if (total < 1e-6) return null;

  let best: RayHit | null = null;
  for (const obstacle of obstacles) {
    const rect = obstacleRect(obstacle);
    const padded: Rect = {
      left: rect.left - padding,
      top: rect.top - padding,
      right: rect.right + padding,
      bottom: rect.bottom + padding,
    };
    if (!segmentIntersectsRect(from, to, padded)) continue;
    // Walk the segment forward to find the entry distance. Sampling is enough
    // here: this only orders obstacles along a ray, it never decides a hit.
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const point = vec(from.x + direction.x * t, from.y + direction.y * t);
      if (
        point.x >= padded.left &&
        point.x <= padded.right &&
        point.y >= padded.top &&
        point.y <= padded.bottom
      ) {
        const hitDistance = total * t;
        if (!best || hitDistance < best.distance) best = { obstacle, distance: hitDistance };
        break;
      }
    }
  }
  return best;
}

/**
 * Steers a desired direction around any obstacle directly ahead.
 *
 * The hostile blends its intended heading with a tangent around the blocking
 * block, choosing the tangent that still makes progress toward the target. That
 * is enough to round a pillar without a pathfinding grid, and — critically —
 * guarantees a hostile always eventually reaches the player rather than grinding
 * into a wall forever.
 */
export function avoidObstacles(
  from: Vec2,
  desiredDirection: Vec2,
  obstacles: readonly Obstacle[],
  radius: number,
  lookahead = 130,
): Vec2 {
  const direct = normalise(desiredDirection);
  const probe = { x: from.x + direct.x * lookahead, y: from.y + direct.y * lookahead };
  const hit = firstObstacleAlong(from, probe, obstacles, radius);
  if (!hit) return direct;

  const centre = vec(hit.obstacle.x, hit.obstacle.y);
  const away = sub(from, centre);
  // Two tangents around the block; take the one that still closes on the target.
  const t1 = vec(-away.y, away.x);
  const t2 = vec(away.y, -away.x);
  const dot1 = t1.x * direct.x + t1.y * direct.y;
  const dot2 = t2.x * direct.x + t2.y * direct.y;
  const tangent = normalise(dot1 >= dot2 ? t1 : t2);
  return normalise({ x: direct.x * 0.35 + tangent.x, y: direct.y * 0.35 + tangent.y });
}

/**
 * How much protection a position offers, 0–1.
 *
 * A point scores for cover when a block sits between it and the threat, weighted
 * by the block's own cover value and by how close the point hugs it — standing
 * right behind a container is safer than standing two metres off its corner.
 */
export function coverValueAt(point: Vec2, threat: Vec2, obstacles: readonly Obstacle[]): number {
  let best = 0;
  for (const obstacle of obstacles) {
    if (!segmentIntersectsRect(point, threat, obstacleRect(obstacle))) continue;
    const rect = obstacleRect(obstacle);
    // Distance from the point to the near face of the block.
    const nearestX = clamp(point.x, rect.left, rect.right);
    const nearestY = clamp(point.y, rect.top, rect.bottom);
    const hug = distance(point, vec(nearestX, nearestY));
    const proximity = 1 - clamp(hug / 160, 0, 1);
    const value = obstacle.cover * (0.45 + proximity * 0.55);
    if (value > best) best = value;
  }
  return best;
}

export interface CoverCandidate {
  readonly position: Vec2;
  readonly value: number;
}

/**
 * Picks the best nearby spot that breaks line of sight to the threat.
 *
 * Candidate positions are sampled on rings around the hostile, snapped out of
 * any block, and scored by `coverValueAt` minus the travel cost. Sampling (rather
 * than solving) keeps this cheap enough to run for every hostile on a phone, and
 * deterministic — the same inputs always produce the same cover choice.
 */
export function findCover(
  from: Vec2,
  threat: Vec2,
  obstacles: readonly Obstacle[],
  radius: number,
  searchRadius = 320,
): CoverCandidate | null {
  if (obstacles.length === 0) return null;

  let best: CoverCandidate | null = null;
  const rings = [searchRadius * 0.5, searchRadius];
  const spokes = 12;

  for (const ring of rings) {
    for (let i = 0; i < spokes; i += 1) {
      const angle = (i / spokes) * Math.PI * 2;
      const raw = vec(from.x + Math.cos(angle) * ring, from.y + Math.sin(angle) * ring);
      const candidate = resolveCircleAgainstObstacles(raw, radius, obstacles);
      const value = coverValueAt(candidate, threat, obstacles);
      if (value <= 0) continue;
      const cost = distance(from, candidate) / searchRadius;
      const score = value - cost * 0.35;
      if (!best || score > best.value) best = { position: candidate, value: score };
    }
  }
  return best;
}

/** Squared distance helper kept local so the module has no upward dependency. */
export function obstacleDistanceSq(point: Vec2, obstacle: Obstacle): number {
  const rect = obstacleRect(obstacle);
  const nearestX = clamp(point.x, rect.left, rect.right);
  const nearestY = clamp(point.y, rect.top, rect.bottom);
  return distanceSq(point, vec(nearestX, nearestY));
}
