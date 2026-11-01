import { describe, expect, it } from 'vitest';
import {
  ARENA_OBSTACLES,
  avoidObstacles,
  circleOverlapsObstacle,
  coverValueAt,
  findCover,
  firstObstacleAlong,
  hasLineOfSight,
  obstacleRect,
  resolveCircleAgainstObstacle,
  resolveCircleAgainstObstacles,
  segmentIntersectsRect,
  type Obstacle,
} from '@/game/logic/obstacles';
import { vec } from '@/game/logic/vec';

/** A single wall between (0,0) and (200,0), for isolated assertions. */
const WALL: Obstacle = { id: 'w', x: 100, y: 0, width: 40, height: 40, cover: 0.8, kind: 'pillar' };

describe('obstacle geometry', () => {
  it('computes a rectangle around an obstacle centre', () => {
    const rect = obstacleRect(WALL);
    expect(rect.left).toBe(80);
    expect(rect.right).toBe(120);
    expect(rect.top).toBe(-20);
    expect(rect.bottom).toBe(20);
  });

  it('detects circle overlap with the rectangle, including at a corner', () => {
    // Just outside the right face.
    expect(circleOverlapsObstacle(vec(121, 0), 4, WALL)).toBe(true);
    expect(circleOverlapsObstacle(vec(130, 0), 4, WALL)).toBe(false);
    // Diagonally off the corner: distance is sqrt(10^2+10^2) ≈ 14.1, so a
    // radius of 15 catches it and 10 does not.
    expect(circleOverlapsObstacle(vec(130, 30), 15, WALL)).toBe(true);
    expect(circleOverlapsObstacle(vec(130, 30), 10, WALL)).toBe(false);
  });

  it('pushes a circle out along the shallowest axis', () => {
    const resolved = resolveCircleAgainstObstacle(vec(115, 0), 10, WALL);
    // Ejected past the right face by its radius.
    expect(resolved.x).toBeGreaterThanOrEqual(130 - 1e-6);
    expect(resolved.y).toBeCloseTo(0, 6);
  });

  it('ejects a circle whose centre is inside the rectangle', () => {
    const resolved = resolveCircleAgainstObstacle(vec(105, 0), 6, WALL);
    // Nearest face is the right face (20 away) — no, left is 25, right is 15.
    expect(resolved.x).toBeGreaterThan(120);
  });

  it('leaves a circle that is already clear untouched', () => {
    const resolved = resolveCircleAgainstObstacle(vec(400, 400), 12, WALL);
    expect(resolved).toEqual(vec(400, 400));
  });

  it('resolves against every obstacle in a list', () => {
    const second: Obstacle = { id: 'w2', x: 200, y: 0, width: 40, height: 40, cover: 0.5, kind: 'crate' };
    const resolved = resolveCircleAgainstObstacles(vec(115, 0), 10, [WALL, second]);
    expect(resolved.x).toBeGreaterThan(120);
  });
});

describe('line of sight', () => {
  it('reports no sight through a blocking wall', () => {
    expect(hasLineOfSight(vec(-100, 0), vec(100, 0), [WALL])).toBe(false);
  });

  it('reports sight when the wall is not on the segment', () => {
    expect(hasLineOfSight(vec(-100, 200), vec(100, 200), [WALL])).toBe(true);
  });

  it('reports sight in an empty arena', () => {
    expect(hasLineOfSight(vec(0, 0), vec(1000, 1000), [])).toBe(true);
  });

  it('agrees with the segment test it is built on', () => {
    const a = vec(0, 0);
    const b = vec(300, 300);
    expect(hasLineOfSight(a, b, [WALL])).toBe(!segmentIntersectsRect(a, b, obstacleRect(WALL)));
  });

  it('finds the first obstacle along a ray', () => {
    const near: Obstacle = { id: 'near', x: 50, y: 0, width: 20, height: 20, cover: 0.4, kind: 'crate' };
    const far: Obstacle = { id: 'far', x: 150, y: 0, width: 20, height: 20, cover: 0.4, kind: 'crate' };
    const hit = firstObstacleAlong(vec(0, 0), vec(200, 0), [far, near]);
    expect(hit?.obstacle.id).toBe('near');
    expect(hit!.distance).toBeLessThan(60);
  });

  it('returns null when nothing is in the way', () => {
    expect(firstObstacleAlong(vec(0, 0), vec(200, 0), [])).toBeNull();
  });
});

describe('obstacle avoidance', () => {
  it('leaves the direction unchanged when the path is clear', () => {
    const direction = avoidObstacles(vec(0, 0), vec(1, 0), [], 12);
    expect(direction.x).toBeCloseTo(1, 6);
    expect(direction.y).toBeCloseTo(0, 6);
  });

  it('steers around a block directly ahead', () => {
    const direction = avoidObstacles(vec(-60, 0), vec(1, 0), [WALL], 12);
    // The result must no longer point straight at the block.
    expect(Math.abs(direction.y)).toBeGreaterThan(0.1);
  });

  it('always returns a unit vector so a hostile never stalls', () => {
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      const d = avoidObstacles(vec(-60, 0), vec(Math.cos(angle), Math.sin(angle)), [WALL], 12);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 6);
    }
  });
});

describe('cover evaluation', () => {
  it('scores a position with a wall between it and the threat', () => {
    // Standing just left of the wall, with the threat to the right.
    const value = coverValueAt(vec(70, 0), vec(400, 0), [WALL]);
    expect(value).toBeGreaterThan(0);
  });

  it('scores zero when nothing is between the position and the threat', () => {
    // Threat is to the *left* of the wall; a position on the left as well has an
    // unobstructed line, so the wall offers it nothing.
    expect(coverValueAt(vec(-200, 0), vec(-400, 0), [WALL])).toBe(0);
  });

  it('rewards hugging the cover over standing off it', () => {
    const hugging = coverValueAt(vec(70, 0), vec(400, 0), [WALL]);
    const standingOff = coverValueAt(vec(10, 0), vec(400, 0), [WALL]);
    expect(hugging).toBeGreaterThan(standingOff);
  });

  it('finds a nearby cover position that breaks line of sight', () => {
    const cover = findCover(vec(140, 0), vec(400, 0), [WALL], 12, 320);
    expect(cover).not.toBeNull();
    // The chosen spot must actually break sight to the threat.
    expect(hasLineOfSight(cover!.position, vec(400, 0), [WALL])).toBe(false);
  });

  it('returns null when the arena offers no cover', () => {
    expect(findCover(vec(0, 0), vec(400, 0), [], 12)).toBeNull();
  });
});

describe('the LAST EXIT arena layout', () => {
  it('keeps every block clear of the perimeter spawn ring', () => {
    for (const obstacle of ARENA_OBSTACLES) {
      const rect = obstacleRect(obstacle);
      expect(rect.left).toBeGreaterThan(200);
      expect(rect.right).toBeLessThan(2200 - 200);
      expect(rect.top).toBeGreaterThan(200);
      expect(rect.bottom).toBeLessThan(1600 - 200);
    }
  });

  it('leaves the arena centre lane clear so the boss arrival lane is open', () => {
    // No block may straddle the vertical centre corridor (x ≈ 1100).
    for (const obstacle of ARENA_OBSTACLES) {
      const rect = obstacleRect(obstacle);
      const straddlesCentre = rect.left < 1100 && rect.right > 1100;
      expect(straddlesCentre).toBe(false);
    }
  });

  it('never places two blocks so close that a body cannot pass between them', () => {
    // Every block must be at least a body-diameter apart from every other.
    for (let i = 0; i < ARENA_OBSTACLES.length; i += 1) {
      for (let j = i + 1; j < ARENA_OBSTACLES.length; j += 1) {
        const a = obstacleRect(ARENA_OBSTACLES[i]!);
        const b = obstacleRect(ARENA_OBSTACLES[j]!);
        const gapX = Math.max(b.left - a.right, a.left - b.right);
        const gapY = Math.max(b.top - a.bottom, a.top - b.bottom);
        // Either they are separated on at least one axis by 80px, or they do not
        // overlap at all.
        const separated = gapX > 80 || gapY > 80;
        expect(separated, `${ARENA_OBSTACLES[i]!.id} vs ${ARENA_OBSTACLES[j]!.id}`).toBe(true);
      }
    }
  });

  it('gives every block a sane cover value', () => {
    for (const obstacle of ARENA_OBSTACLES) {
      expect(obstacle.cover).toBeGreaterThan(0);
      expect(obstacle.cover).toBeLessThanOrEqual(1);
      expect(obstacle.width).toBeGreaterThan(0);
      expect(obstacle.height).toBeGreaterThan(0);
    }
  });
});
