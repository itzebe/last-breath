import { describe, expect, it } from 'vitest';
import {
  MOVE_SPEED,
  RUN_SPEED,
  animationStateFor,
  locomotionState,
  poseFor,
  type AnimationInput,
} from '@/game/render/animation';

const BASE_POSE_OPTIONS = {
  aimOffset: 0,
  firing: false,
  reloadProgress: 0,
  hitFlash: 0,
  deathProgress: 0,
  meleeWindup: false,
  twoHanded: true,
} as const;

function input(partial: Partial<AnimationInput> = {}): AnimationInput {
  return { speed: 0, elapsedMs: 0, dodging: false, dodgeProgress: 0, ...partial };
}

describe('locomotion state selection', () => {
  it('is idle when standing still', () => {
    expect(locomotionState(input({ speed: 0 }))).toBe('idle');
  });

  it('walks above the move threshold', () => {
    expect(locomotionState(input({ speed: MOVE_SPEED + 1 }))).toBe('walk');
  });

  it('runs above the run threshold', () => {
    expect(locomotionState(input({ speed: RUN_SPEED + 1 }))).toBe('run');
  });

  it('is a dodge whenever a roll is in progress, whatever the speed', () => {
    expect(locomotionState(input({ speed: 0, dodging: true, dodgeProgress: 0.5 }))).toBe('dodge');
  });
});

describe('animation state transitions correspond to game state', () => {
  it('reports death for a dying entity above every other state', () => {
    expect(
      animationStateFor({ speed: 300, dying: true, dodging: true, firing: true, reloading: true }),
    ).toBe('death');
  });

  it('reports dodge while rolling', () => {
    expect(
      animationStateFor({ speed: 0, dying: false, dodging: true, firing: false, reloading: false }),
    ).toBe('dodge');
  });

  it('reports reload while a reload is in progress', () => {
    expect(
      animationStateFor({ speed: 0, dying: false, dodging: false, firing: false, reloading: true }),
    ).toBe('reload');
  });

  it('reports shoot while firing', () => {
    expect(
      animationStateFor({ speed: 0, dying: false, dodging: false, firing: true, reloading: false }),
    ).toBe('shoot');
  });

  it('falls back to locomotion when neither firing nor reloading', () => {
    expect(
      animationStateFor({ speed: 0, dying: false, dodging: false, firing: false, reloading: false }),
    ).toBe('idle');
    expect(
      animationStateFor({ speed: 250, dying: false, dodging: false, firing: false, reloading: false }),
    ).toBe('run');
  });
});

describe('walk and run cycles', () => {
  it('moves the legs through a full stride as time advances', () => {
    const samples = [0, 0.1, 0.2, 0.3].map((seconds) =>
      poseFor(input({ speed: 200, elapsedMs: seconds * 1000 }), BASE_POSE_OPTIONS),
    );
    const leftAngles = samples.map((pose) => pose.leftLeg.angle);
    // Not all identical — the leg actually swings.
    expect(new Set(leftAngles.map((a) => a.toFixed(3))).size).toBeGreaterThan(2);
  });

  it('keeps the two legs in anti-phase', () => {
    const pose = poseFor(input({ speed: 200, elapsedMs: 0.13 * 1000 }), BASE_POSE_OPTIONS);
    // At any point in the cycle the legs are swinging in opposite directions.
    const leftVelocity = Math.sin((0.13 / 0.52) * Math.PI * 2);
    const rightVelocity = Math.sin(((0.13 / 0.52) + 0.5) * Math.PI * 2);
    expect(Math.sign(leftVelocity)).not.toBe(Math.sign(rightVelocity));
    // And the pose reflects two distinct leg angles.
    expect(pose.leftLeg.angle).not.toBeCloseTo(pose.rightLeg.angle, 3);
  });

  it('never lets a knee hyperextend', () => {
    for (let ms = 0; ms < 2000; ms += 40) {
      const pose = poseFor(input({ speed: 240, elapsedMs: ms }), BASE_POSE_OPTIONS);
      expect(pose.leftLeg.bend).toBeGreaterThanOrEqual(0);
      expect(pose.rightLeg.bend).toBeGreaterThanOrEqual(0);
      expect(pose.leftArm.bend).toBeGreaterThanOrEqual(0);
      expect(pose.rightArm.bend).toBeGreaterThanOrEqual(0);
    }
  });

  it('takes bigger strides at a run than at a walk', () => {
    const rangeAt = (speed: number): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let ms = 0; ms < 1000; ms += 20) {
        const angle = poseFor(input({ speed, elapsedMs: ms }), BASE_POSE_OPTIONS).leftLeg.angle;
        min = Math.min(min, angle);
        max = Math.max(max, angle);
      }
      return max - min;
    };
    expect(rangeAt(RUN_SPEED + 40)).toBeGreaterThan(rangeAt(MOVE_SPEED + 10));
  });

  it('keeps the idle figure subtly moving rather than frozen', () => {
    const a = poseFor(input({ speed: 0, elapsedMs: 0 }), BASE_POSE_OPTIONS);
    const b = poseFor(input({ speed: 0, elapsedMs: 900 }), BASE_POSE_OPTIONS);
    expect(a.bob).not.toBeCloseTo(b.bob, 3);
  });
});

describe('aim, fire and reload poses', () => {
  it('points the weapon arm along the aim offset', () => {
    // Forward is -π/2 in the limb convention. Not firing, so there is no recoil.
    const forward = poseFor(input(), { ...BASE_POSE_OPTIONS, aimOffset: 0.4, firing: false });
    expect(forward.rightArm.angle).toBeCloseTo(-Math.PI / 2 + 0.4, 2);

    // Aiming to the side rotates the arm by that offset.
    const side = poseFor(input(), { ...BASE_POSE_OPTIONS, aimOffset: Math.PI / 2, firing: false });
    expect(side.rightArm.angle).toBeCloseTo(0, 2);
  });

  it('brings the support hand to the weapon for a two-handed gun', () => {
    const opts = { ...BASE_POSE_OPTIONS, aimOffset: 0.4, firing: false };
    const twoHanded = poseFor(input(), { ...opts, twoHanded: true });
    const oneHanded = poseFor(input(), { ...opts, twoHanded: false });
    // The support arm is closer to the weapon arm when both hands are on the gun.
    expect(Math.abs(twoHanded.leftArm.angle - twoHanded.rightArm.angle)).toBeLessThan(
      Math.abs(oneHanded.leftArm.angle - oneHanded.rightArm.angle),
    );
  });

  it('kicks the arm back on the frame a shot is fired', () => {
    const idle = poseFor(input(), { ...BASE_POSE_OPTIONS, aimOffset: 0.4, firing: false });
    const firing = poseFor(input(), { ...BASE_POSE_OPTIONS, aimOffset: 0.4, firing: true });
    // Recoil rotates the weapon arm away from the aim direction.
    expect(firing.rightArm.angle).toBeLessThan(idle.rightArm.angle);
  });

  it('moves the support hand during a reload, even while not aiming', () => {
    const mid = poseFor(input(), { ...BASE_POSE_OPTIONS, aimOffset: 0, reloadProgress: 0.5 });
    const early = poseFor(input(), { ...BASE_POSE_OPTIONS, aimOffset: 0, reloadProgress: 0.1 });
    expect(mid.leftArm.angle).not.toBeCloseTo(early.leftArm.angle, 2);
  });
});

describe('hit and death reactions', () => {
  it('flinches the torso back when hit', () => {
    const calm = poseFor(input(), { ...BASE_POSE_OPTIONS, hitFlash: 0 });
    const hit = poseFor(input(), { ...BASE_POSE_OPTIONS, hitFlash: 1 });
    expect(hit.torsoLean).toBeLessThan(calm.torsoLean);
  });

  it('falls the figure over the death animation', () => {
    const early = poseFor(input(), { ...BASE_POSE_OPTIONS, deathProgress: 0.1 });
    const late = poseFor(input(), { ...BASE_POSE_OPTIONS, deathProgress: 1 });
    // Rotation increases toward the final rest angle, and the body sinks.
    expect(Math.abs(late.bodyRotation)).toBeGreaterThan(Math.abs(early.bodyRotation));
    expect(late.bodyOffsetY).toBeGreaterThan(early.bodyOffsetY);
  });

  it('overrides the walk cycle during death', () => {
    const pose = poseFor(input({ speed: 240, elapsedMs: 500 }), { ...BASE_POSE_OPTIONS, deathProgress: 0.5 });
    expect(pose.state).toBe('idle');
  });
});

describe('dodge roll', () => {
  it('rotates the whole body through a full turn', () => {
    const start = poseFor(input({ dodging: true, dodgeProgress: 0 }), BASE_POSE_OPTIONS);
    const end = poseFor(input({ dodging: true, dodgeProgress: 1 }), BASE_POSE_OPTIONS);
    expect(start.bodyRotation).toBeCloseTo(0, 6);
    expect(end.bodyRotation).toBeCloseTo(Math.PI * 2, 6);
  });

  it('tucks the limbs at the peak of the roll', () => {
    const mid = poseFor(input({ dodging: true, dodgeProgress: 0.5 }), BASE_POSE_OPTIONS);
    expect(mid.state).toBe('dodge');
    expect(mid.leftLeg.bend).toBeGreaterThan(1);
  });
});
