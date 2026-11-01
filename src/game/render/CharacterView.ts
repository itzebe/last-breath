import Phaser from 'phaser';
import type { Pose } from './animation';
import type { CharacterTextureSet } from './CharacterTextures';

/**
 * A Phaser view of one articulated character.
 *
 * Owns a container of part images and applies a `Pose` to them each frame. The
 * division of labour is the same as everywhere else in this codebase: the
 * simulation owns state, `animation.ts` turns state into joint angles, and this
 * class only *places* those angles on Phaser objects. It makes no gameplay
 * decision and never reads the clock.
 *
 * Depth is faked cheaply and correctly: the far arm and far leg are drawn behind
 * the torso and the near arm and near leg in front of it. That single z-ordering
 * is what stops the figure looking like a paper cut-out.
 *
 * The coordinate convention matches `animation.ts`: inside the container +x is
 * forward and +y is the character's right. A limb image hangs down from its
 * top-centre origin, so a limb rotated by θ has its tip at
 * `(x - sin θ · L, y + cos θ · L)`.
 */

export interface CharacterViewOptions {
  readonly textures: CharacterTextureSet;
  readonly scale?: number;
}

interface Parts {
  shadow: Phaser.GameObjects.Image;
  /** Back-to-front draw order. */
  farArmUpper: Phaser.GameObjects.Image;
  farArmFore: Phaser.GameObjects.Image;
  farLegThigh: Phaser.GameObjects.Image;
  farLegShin: Phaser.GameObjects.Image;
  nearLegThigh: Phaser.GameObjects.Image;
  nearLegShin: Phaser.GameObjects.Image;
  torso: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  nearArmUpper: Phaser.GameObjects.Image;
  nearArmFore: Phaser.GameObjects.Image;
  weapon: Phaser.GameObjects.Image;
}

export class CharacterView {
  readonly container: Phaser.GameObjects.Container;
  private readonly textures: CharacterTextureSet;
  private readonly parts: Parts;
  private readonly images: Phaser.GameObjects.Image[];
  private elapsedMs = 0;
  private readonly baseScale: number;

  constructor(scene: Phaser.Scene, options: CharacterViewOptions) {
    this.textures = options.textures;
    this.baseScale = options.scale ?? 1;
    const { keys, weaponKey, shadowKey } = options.textures;

    const img = (key: string, originY = 0.06): Phaser.GameObjects.Image =>
      scene.add.image(0, 0, key).setOrigin(0.5, originY);

    const shadow = scene.add.image(0, 5, shadowKey).setOrigin(0.5, 0.5).setAlpha(0.75);
    const farArmUpper = img(keys.upperArm);
    const farArmFore = img(keys.foreArm);
    const farLegThigh = img(keys.thigh);
    const farLegShin = img(keys.shin);
    const nearLegThigh = img(keys.thigh);
    const nearLegShin = img(keys.shin);
    const torso = scene.add.image(0, 0, keys.torso).setOrigin(0.5, 0.42);
    const head = scene.add.image(0, 0, keys.head).setOrigin(0.5, 0.5);
    const nearArmUpper = img(keys.upperArm);
    const nearArmFore = img(keys.foreArm);
    const weapon = scene.add.image(0, 0, weaponKey).setOrigin(0.05, 0.5);

    this.images = [
      farArmUpper,
      farArmFore,
      farLegThigh,
      farLegShin,
      nearLegThigh,
      nearLegShin,
      torso,
      head,
      nearArmUpper,
      nearArmFore,
      weapon,
    ];

    this.parts = {
      shadow,
      farArmUpper,
      farArmFore,
      farLegThigh,
      farLegShin,
      nearLegThigh,
      nearLegShin,
      torso,
      head,
      nearArmUpper,
      nearArmFore,
      weapon,
    };

    this.container = scene.add.container(0, 0, [
      shadow,
      farArmUpper,
      farArmFore,
      farLegThigh,
      farLegShin,
      nearLegThigh,
      nearLegShin,
      torso,
      head,
      nearArmUpper,
      nearArmFore,
      weapon,
    ]);
    this.container.setScale(this.baseScale);
  }

  /** Advances the local animation clock. Called once per frame by the scene. */
  advance(dtMs: number): void {
    this.elapsedMs += dtMs;
  }

  get clock(): number {
    return this.elapsedMs;
  }

  /**
   * Places the figure for one frame.
   *
   * `facing` rotates the whole container; `pose` supplies every joint angle. The
   * shadow is counter-rotated so it stays a flat ellipse on the ground, which is
   * what sells the illusion that the figure stands on the floor rather than
   * floating above it.
   */
  apply(
    x: number,
    y: number,
    facing: number,
    pose: Pose,
    options: {
      alpha?: number;
      /** `null` clears any tint; a number tints every part (hit flash / death). */
      tint?: number | null;
      weaponVisible?: boolean;
      /** Overrides the torso texture with the whitened hit-flash copy. */
      flashing?: boolean;
    } = {},
  ): void {
    const { parts } = this;
    const { skeleton } = this.textures;
    const alpha = options.alpha ?? 1;

    this.container.setPosition(x, y + pose.bob + pose.bodyOffsetY);
    this.container.setRotation(facing + pose.bodyRotation);
    this.container.setAlpha(alpha);

    if (options.tint === null || options.tint === undefined) {
      for (const image of this.images) image.clearTint();
    } else {
      for (const image of this.images) image.setTint(options.tint);
    }

    // Shadow: keep it flat on the ground regardless of facing or roll.
    parts.shadow.setRotation(-this.container.rotation);
    parts.shadow.setAlpha(0.75 * alpha);

    // Torso and head.
    parts.torso.setTexture(options.flashing ? `${this.textures.keys.torso}-flash` : this.textures.keys.torso);
    parts.torso.setPosition(Math.cos(pose.torsoLean) * 2, Math.sin(pose.torsoLean) * 2);
    parts.torso.setRotation(pose.torsoLean + pose.torsoTwist);
    // The head sits at the shoulder line and turns independently of the body.
    parts.head.setPosition(
      skeleton.shoulderY * 0.15 + Math.sin(pose.torsoTwist) * 3,
      skeleton.shoulderY + Math.cos(pose.torsoTwist) * 1.5,
    );
    parts.head.setRotation(pose.headTurn + pose.torsoTwist * 0.4);

    // Legs. In a plan view the viewer's near side is the character's right (+y),
    // so the right limb draws in front and the left limb behind.
    const hipY = skeleton.hipY;
    this.placeLeg(parts.nearLegThigh, parts.nearLegShin, skeleton.hipOffset, hipY, pose.rightLeg.angle, pose.rightLeg.bend);
    this.placeLeg(parts.farLegThigh, parts.farLegShin, -skeleton.hipOffset, hipY, pose.leftLeg.angle, pose.leftLeg.bend);

    // Arms, from the shoulder line.
    const shoulderY = skeleton.shoulderY;
    this.placeArm(parts.nearArmUpper, parts.nearArmFore, skeleton.shoulderOffset, shoulderY, pose.rightArm.angle, pose.rightArm.bend);
    this.placeArm(parts.farArmUpper, parts.farArmFore, -skeleton.shoulderOffset, shoulderY, pose.leftArm.angle, pose.leftArm.bend);

    // Weapon: carried in the right hand, oriented along the arm.
    const visible = options.weaponVisible !== false;
    parts.weapon.setVisible(visible);
    if (visible) {
      const hand = this.limbTip(skeleton.shoulderOffset, shoulderY, pose.rightArm.angle, skeleton.upperArmLength);
      const foreTip = this.limbTip(hand.x, hand.y, pose.rightArm.angle + pose.rightArm.bend, skeleton.foreArmLength);
      parts.weapon.setPosition(foreTip.x, foreTip.y);
      parts.weapon.setRotation(pose.rightArm.angle + pose.rightArm.bend);
    }
  }

  private placeLeg(
    thigh: Phaser.GameObjects.Image,
    shin: Phaser.GameObjects.Image,
    jointX: number,
    jointY: number,
    angle: number,
    bend: number,
  ): void {
    thigh.setPosition(jointX, jointY);
    thigh.setRotation(angle);
    const knee = this.limbTip(jointX, jointY, angle, this.textures.skeleton.thighLength);
    shin.setPosition(knee.x, knee.y);
    shin.setRotation(angle + bend);
  }

  private placeArm(
    upper: Phaser.GameObjects.Image,
    fore: Phaser.GameObjects.Image,
    jointX: number,
    jointY: number,
    angle: number,
    bend: number,
  ): void {
    upper.setPosition(jointX, jointY);
    upper.setRotation(angle);
    const elbow = this.limbTip(jointX, jointY, angle, this.textures.skeleton.upperArmLength);
    fore.setPosition(elbow.x, elbow.y);
    fore.setRotation(angle + bend);
  }

  /** Where a limb's tip lands, given its joint and rotation. */
  private limbTip(x: number, y: number, angle: number, length: number): { x: number; y: number } {
    return { x: x - Math.sin(angle) * length, y: y + Math.cos(angle) * length };
  }

  setDepth(depth: number): this {
    this.container.setDepth(depth);
    return this;
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
