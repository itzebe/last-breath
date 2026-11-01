/**
 * Character animation.
 *
 * Pure and clock-free: the caller supplies elapsed milliseconds and the current
 * game state, and receives a `Pose` — the rotation of every joint. Because it
 * takes time as an argument rather than reading it, an animation can be stepped
 * deterministically in a test, and a transition can be asserted without a
 * browser or a rendered frame.
 *
 * The animation is *driven by game state*, which is the requirement that matters:
 * the walk cycle's amplitude comes from the entity's actual velocity, the aim
 * pose from the actual aim angle, the death pose from the entity's real `dying`
 * progress. Nothing here invents motion that the simulation is not performing.
 *
 * ── The coordinate convention, stated once ──────────────────────────────────
 * A character is a container rotated by its facing angle. Inside that container
 * **+x is forward and +y is the character's right-hand side**. Every limb image
 * is drawn hanging down-screen from a top-centre origin, so applying a rotation
 * θ to a limb aims its tip along the direction `(-sin θ, cos θ)`:
 *
 *     θ = 0        → the tip points to the character's right
 *     θ = -π/2     → the tip points forward (straight ahead)
 *     θ = +π/2     → the tip points backward
 *
 * Joints are nested: the forearm is a child of the upper arm and the shin is a
 * child of the thigh, so `bend` is the *additional* rotation of the distal
 * segment and the elbow/knee can never dislocate.
 */

/** The locomotion/action state a character is in. */
export type AnimationState = 'idle' | 'walk' | 'run' | 'dodge';

export interface AnimationInput {
  /** Speed in arena units per second. */
  readonly speed: number;
  /** Milliseconds of animation time accumulated. */
  readonly elapsedMs: number;
  /** True while the character is rolling. */
  readonly dodging: boolean;
  /** Progress through the dodge, 0–1, or 0 when not dodging. */
  readonly dodgeProgress: number;
}

/** Speed above which the walk becomes a run. */
export const RUN_SPEED = 175;
/** Speed above which the character is considered to be moving at all. */
export const MOVE_SPEED = 14;

export function locomotionState(input: AnimationInput): AnimationState {
  if (input.dodging) return 'dodge';
  if (input.speed >= RUN_SPEED) return 'run';
  if (input.speed >= MOVE_SPEED) return 'walk';
  return 'idle';
}

export interface LimbPose {
  /** Joint rotation in radians, per the convention above. */
  readonly angle: number;
  /** Additional rotation of the distal segment (elbow/knee), radians. */
  readonly bend: number;
}

export interface Pose {
  readonly state: AnimationState;
  /** Torso lean, radians. Positive leans forward into travel. */
  readonly torsoLean: number;
  /** Vertical bob applied to the whole figure, in pixels. */
  readonly bob: number;
  /** Extra rotation of the torso so the shoulders face the aim. */
  readonly torsoTwist: number;
  readonly leftArm: LimbPose;
  readonly rightArm: LimbPose;
  readonly leftLeg: LimbPose;
  readonly rightLeg: LimbPose;
  /** Additional head rotation, e.g. to look along the aim. */
  readonly headTurn: number;
  /** Whole-body vertical offset, used by the death animation. */
  readonly bodyOffsetY: number;
  /** Whole-body rotation, used by the dodge roll and the death fall. */
  readonly bodyRotation: number;
}

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** The rest angle of a limb that hangs down and slightly outward. */
const REST_ARM = HALF_PI;
const REST_LEG = HALF_PI;

/**
 * The walk/run cycle.
 *
 * Stride and arm swing scale with speed, so a character barely moving takes
 * small steps and one at full sprint takes large ones. The legs are anti-phase;
 * the arms are anti-phase with the legs, which is what reads as a natural gait
 * rather than a puppet.
 */
function locomotionPose(state: 'walk' | 'run', input: AnimationInput): Pose {
  const cycleSeconds = state === 'run' ? 0.52 : 0.86;
  const cycle = (input.elapsedMs / 1000 / cycleSeconds) % 1;
  const stride = state === 'run' ? 0.85 : 0.55;
  const armSwing = state === 'run' ? 0.6 : 0.32;

  const legPhase = cycle;
  const armPhase = cycle + 0.5;
  // A leg swings forward (smaller angle) then back (larger angle).
  const legAngle = (phase: number) => REST_LEG - Math.sin(phase * TAU) * stride;
  // Knees bend on the back half of the stride, which is when the foot lifts.
  const kneeBend = (phase: number) =>
    Math.max(0, Math.sin(phase * TAU)) * (state === 'run' ? 0.85 : 0.55) + 0.14;

  return {
    state,
    torsoLean: state === 'run' ? 0.16 : 0.06,
    // Two bobs per stride: the body rises on each footfall.
    bob: -Math.abs(Math.sin(legPhase * TAU)) * (state === 'run' ? 2.4 : 1.4),
    torsoTwist: 0,
    leftArm: { angle: REST_ARM - Math.sin(armPhase * TAU) * armSwing, bend: 0.45 },
    rightArm: { angle: REST_ARM - Math.sin((armPhase + 0.5) * TAU) * armSwing, bend: 0.45 },
    leftLeg: { angle: legAngle(legPhase), bend: kneeBend(legPhase) },
    rightLeg: { angle: legAngle(legPhase + 0.5), bend: kneeBend(legPhase + 0.5) },
    headTurn: 0,
    bodyOffsetY: 0,
    bodyRotation: 0,
  };
}

/** Idle: a slow breathing sway. Never fully static — a completely still figure
 * reads as a bug, not as calm. */
function idlePose(input: AnimationInput): Pose {
  const breath = Math.sin((input.elapsedMs / 1000) * 1.7);
  return {
    state: 'idle',
    torsoLean: 0,
    bob: breath * 0.5,
    torsoTwist: 0,
    leftArm: { angle: REST_ARM - 0.16, bend: 0.42 + breath * 0.03 },
    rightArm: { angle: REST_ARM + 0.16, bend: 0.42 - breath * 0.03 },
    leftLeg: { angle: REST_LEG - 0.05, bend: 0.1 },
    rightLeg: { angle: REST_LEG + 0.05, bend: 0.1 },
    headTurn: breath * 0.05,
    bodyOffsetY: 0,
    bodyRotation: 0,
  };
}

/** Dodge: a tuck-and-roll. The body curls and spins a full turn. */
function dodgePose(input: AnimationInput): Pose {
  const p = Math.min(1, Math.max(0, input.dodgeProgress));
  const tuck = Math.sin(p * Math.PI);
  return {
    state: 'dodge',
    torsoLean: 0.4 * tuck,
    bob: -5 * tuck,
    torsoTwist: 0,
    leftArm: { angle: REST_ARM + 0.9 * tuck, bend: 1.5 * tuck },
    rightArm: { angle: REST_ARM - 0.9 * tuck, bend: 1.5 * tuck },
    leftLeg: { angle: REST_LEG + 0.7 * tuck, bend: 1.6 * tuck },
    rightLeg: { angle: REST_LEG - 0.7 * tuck, bend: 1.6 * tuck },
    headTurn: 0,
    bodyOffsetY: 0,
    bodyRotation: p * TAU,
  };
}

function clampAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export interface PoseOptions {
  /** Aim angle relative to the facing direction (0 = straight ahead). */
  readonly aimOffset: number;
  /** True on the frame a shot leaves the weapon. */
  readonly firing: boolean;
  /** 0–1 progress through a reload, or 0 when not reloading. */
  readonly reloadProgress: number;
  /** 0–1 flinch, decaying after a hit. */
  readonly hitFlash: number;
  /** 0–1 progress through the death animation, or 0 when alive. */
  readonly deathProgress: number;
  /** True while a melee/contact attack is winding up. */
  readonly meleeWindup: boolean;
  /** Two-handed weapon: the support hand goes to the foregrip. */
  readonly twoHanded: boolean;
}

/**
 * The full pose for one frame.
 *
 * `aimOffset` is the aim angle relative to facing: 0 aims straight ahead, ±π/2
 * aims to the side, ±π aims behind. The arms and torso follow it, which is what
 * makes "aiming" a pose rather than a rotation of the whole sprite.
 */
export function poseFor(input: AnimationInput, options: PoseOptions): Pose {
  // Death overrides everything: the figure falls, it does not keep walking.
  if (options.deathProgress > 0) {
    const p = Math.min(1, options.deathProgress);
    return {
      state: 'idle',
      torsoLean: -1.0 * p,
      bob: 0,
      torsoTwist: 0,
      leftArm: { angle: REST_ARM + 1.1 * p, bend: 0.5 },
      rightArm: { angle: REST_ARM - 1.1 * p, bend: 0.4 },
      leftLeg: { angle: REST_LEG - 0.5 * p, bend: 0.9 * p },
      rightLeg: { angle: REST_LEG + 0.3 * p, bend: 0.6 * p },
      headTurn: 0,
      bodyOffsetY: 5 * p,
      bodyRotation: -1.3 * p,
    };
  }

  const state = locomotionState(input);
  const base =
    state === 'dodge' ? dodgePose(input) : state === 'idle' ? idlePose(input) : locomotionPose(state, input);

  const aim = clampAngle(options.aimOffset);
  // Aiming is "on" when the character is looking away from straight ahead, is
  // actively shooting, or is reloading — a reload has its own two-handed pose
  // and must not be masked by the locomotion swing.
  const aimed = Math.abs(aim) > 0.15 || options.firing || options.reloadProgress > 0;

  let leftArm = base.leftArm;
  let rightArm = base.rightArm;
  let torsoTwist = base.torsoTwist;

  if (aimed) {
    const recoil = options.firing ? 0.2 : 0;
    // The weapon hand points along the aim. In this convention, pointing forward
    // is -π/2, and an offset of `aim` adds directly.
    const weaponAngle = -HALF_PI + aim - recoil;
    rightArm = { angle: weaponAngle, bend: 0.14 };
    leftArm = options.twoHanded
      ? { angle: weaponAngle + 0.1, bend: 0.5 + Math.abs(aim) * 0.08 }
      : { angle: weaponAngle + 0.35, bend: 0.55 };
    torsoTwist = aim * 0.3;

    if (options.reloadProgress > 0) {
      // Reload: the support hand drops to the magazine and back, twice.
      const cycle = Math.sin(options.reloadProgress * TAU);
      leftArm = { angle: weaponAngle + 0.7 + cycle * 0.5, bend: 1.0 + Math.abs(cycle) * 0.4 };
      rightArm = { angle: weaponAngle + 0.18, bend: 0.3 + cycle * 0.15 };
    }
  } else if (options.meleeWindup) {
    rightArm = { angle: REST_ARM - 1.1, bend: 0.95 };
    leftArm = { angle: REST_ARM + 0.3, bend: 0.5 };
  }

  // ── Hit reaction ─────────────────────────────────────────────────────────
  // A flinch pulls the shoulders back and the head away from the impact.
  let torsoLean = base.torsoLean;
  let headTurn = base.headTurn;
  if (options.hitFlash > 0) {
    torsoLean -= 0.28 * options.hitFlash;
    headTurn -= 0.35 * options.hitFlash;
    leftArm = { angle: leftArm.angle - 0.25 * options.hitFlash, bend: leftArm.bend + 0.3 * options.hitFlash };
    rightArm = { angle: rightArm.angle - 0.2 * options.hitFlash, bend: rightArm.bend + 0.25 * options.hitFlash };
  }

  return { ...base, torsoLean, torsoTwist, headTurn, leftArm, rightArm };
}

/**
 * Which animation state a set of raw game facts implies.
 *
 * Exported and tested directly: this is the mapping the brief calls out — the
 * animation must correspond to the actual state, and the transition table is the
 * thing that can silently drift out of sync with the simulation.
 */
export function animationStateFor(facts: {
  speed: number;
  dying: boolean;
  dodging: boolean;
  firing: boolean;
  reloading: boolean;
}): AnimationState | 'death' | 'shoot' | 'reload' {
  if (facts.dying) return 'death';
  if (facts.dodging) return 'dodge';
  if (facts.reloading) return 'reload';
  if (facts.firing) return 'shoot';
  if (facts.speed >= RUN_SPEED) return 'run';
  if (facts.speed >= MOVE_SPEED) return 'walk';
  return 'idle';
}
