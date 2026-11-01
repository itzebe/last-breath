import type { CharacterBuild, CharacterHelmet } from '@/game/logic/enemies';

/**
 * Procedural human characters.
 *
 * Part 2 rendered the player and every hostile as a single primitive polygon.
 * Part 3 replaces that with an articulated figure: head, torso, two arms and two
 * legs, each drawn into its own small canvas so the renderer can place and rotate
 * them independently. Nothing here is a static illustration pasted over a circle
 * — the limbs are separate objects the animation system rotates, so a walk cycle
 * is the legs actually swinging and an aim pose is the arm actually pointing at
 * the reticle.
 *
 * ── The view, and why it is what it is ──────────────────────────────────────
 * LAST BREATH is a 360-degree top-down shooter, so the figures are drawn the way
 * a real top-down game draws them: **plan view with shallow depth cues** —
 * looking down on a person from above. That is what makes a recognisable human
 * read at a glance from any angle: the head sits at the centre of the shoulders,
 * the arms are two jointed tubes either side, the legs are two jointed tubes
 * below, and the whole thing has a clear front (the shoulders are wider than the
 * hips and the head is offset toward the front).
 *
 * Each part is drawn *inside its own canvas* as a shaded, foreshortened solid so
 * the assembled figure reads as a body rather than as a stick diagram: a light
 * top edge, a dark underside, and a rim light on the leading edge. Because every
 * part is an independent image, the limb geometry stays correct at every facing.
 *
 * ── The convention, stated once ─────────────────────────────────────────────
 * A character is a container rotated by its facing angle. Inside that container
 * **+x is forward and +y is the character's right hand**. A limb image is drawn
 * hanging *down* from a top-centre joint, so applying a rotation θ aims its tip
 * along `(-sin θ, cos θ)`:
 *
 *     θ = 0      → tip points to the character's right
 *     θ = -π/2   → tip points forward
 *     θ = +π/2   → tip points backward
 *
 * Joints are nested: the forearm is a child of the upper arm and the shin is a
 * child of the thigh, so `bend` is the *additional* rotation of the distal
 * segment and the elbow/knee can never dislocate.
 *
 * Why per-part canvases rather than a sprite sheet: the game still ships no
 * binary assets; eight facings × several poses × nine uniforms would be a large
 * sheet to author and impossible to keep consistent; and a part can be tinted per
 * uniform at build time, so a new archetype costs a config line rather than an
 * art pass. Cost is bounded — every part is drawn once at boot, and each frame
 * only sets position/rotation on a handful of images per entity.
 */

export interface CharacterPalette {
  /** Torso, arms and legs. */
  readonly uniform: number;
  /** Trim: belt, straps, helmet band, weapon housing. */
  readonly trim: number;
  /** The archetype's identifying colour, used for the visor and shoulder mark. */
  readonly accent: number;
  readonly skin: number;
}

export interface CharacterSpec {
  readonly build: CharacterBuild;
  readonly helmet: CharacterHelmet;
  readonly palette: CharacterPalette;
  /** Overall scale so a heavy reads bigger than a slim at the same radius. */
  readonly scale: number;
}

/** Neutral, plausible skin tones — a small set so a crowd is not uniform. */
export const SKIN_TONES = [0xe8b48c, 0xd29a72, 0xa9714b, 0x7a4c2e, 0xf0c9a4] as const;

export const PLAYER_PALETTE: CharacterPalette = Object.freeze({
  uniform: 0x22303c,
  trim: 0x2fd8c6,
  accent: 0xff6a1f,
  skin: SKIN_TONES[1]!,
});

/**
 * Skeleton dimensions in pixels, in the unrotated frame.
 *
 * The figure is built around the origin so a container can rotate it to any
 * facing without re-deriving offsets. All numbers are pre-scale. Shoulders are
 * wider than hips, which is what gives the plan view a readable front.
 */
export interface Skeleton {
  readonly shoulderWidth: number;
  readonly hipWidth: number;
  readonly torsoLength: number;
  readonly headRadius: number;
  readonly upperArmLength: number;
  readonly upperArmWidth: number;
  readonly foreArmLength: number;
  readonly foreArmWidth: number;
  readonly thighLength: number;
  readonly thighWidth: number;
  readonly shinLength: number;
  readonly shinWidth: number;
  /** Half the shoulder separation, i.e. where the arm joints sit. */
  readonly shoulderOffset: number;
  /** Half the hip separation. */
  readonly hipOffset: number;
  /** Forward position of the shoulder line (negative = behind centre). */
  readonly shoulderY: number;
  readonly hipY: number;
}

const BUILDS: Readonly<Record<CharacterBuild, Skeleton>> = Object.freeze({
  slim: {
    shoulderWidth: 18,
    hipWidth: 12,
    torsoLength: 17,
    headRadius: 6,
    upperArmLength: 11,
    upperArmWidth: 4,
    foreArmLength: 10,
    foreArmWidth: 3.4,
    thighLength: 12,
    thighWidth: 5,
    shinLength: 11,
    shinWidth: 4,
    shoulderOffset: 9,
    hipOffset: 4,
    shoulderY: -4,
    hipY: 5,
  },
  standard: {
    shoulderWidth: 22,
    hipWidth: 15,
    torsoLength: 19,
    headRadius: 6.8,
    upperArmLength: 12,
    upperArmWidth: 4.8,
    foreArmLength: 11,
    foreArmWidth: 4,
    thighLength: 13,
    thighWidth: 6,
    shinLength: 12,
    shinWidth: 4.6,
    shoulderOffset: 11,
    hipOffset: 4.6,
    shoulderY: -4.5,
    hipY: 5.4,
  },
  heavy: {
    shoulderWidth: 28,
    hipWidth: 20,
    torsoLength: 23,
    headRadius: 7.4,
    upperArmLength: 13,
    upperArmWidth: 6.4,
    foreArmLength: 12,
    foreArmWidth: 5.6,
    thighLength: 14,
    thighWidth: 8,
    shinLength: 13,
    shinWidth: 6.2,
    shoulderOffset: 14,
    hipOffset: 5.8,
    shoulderY: -5,
    hipY: 6,
  },
});

export function skeletonFor(build: CharacterBuild): Skeleton {
  return BUILDS[build];
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(width));
  canvas.height = Math.max(2, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — characters cannot be built.');
  return { canvas, ctx };
}

function rgba(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shifts a packed colour toward black (amount < 0) or white (amount > 0). */
export function shade(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (channel: number): number => {
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    return Math.round(channel + (target - channel) * t);
  };
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** Rounded rectangle path — used for every limb so joints read as joints. */
function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Fills a path with a light-to-dark horizontal gradient, giving a tube volume. */
function fillTube(ctx: Ctx, color: number, x: number, width: number): void {
  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  gradient.addColorStop(0, rgba(shade(color, 0.2)));
  gradient.addColorStop(0.5, rgba(color));
  gradient.addColorStop(1, rgba(shade(color, -0.42)));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = rgba(shade(color, -0.58), 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * A limb texture.
 *
 * The limb hangs down from the top-centre of its canvas, because a limb rotates
 * about its top (the joint). The animation system then only has to place the
 * joint and set an angle — the same convention for arms and legs.
 */
export interface LimbTexture {
  canvas: HTMLCanvasElement;
  /** Length from the joint to the tip, in unrotated pixels. */
  length: number;
  /** Half the thickness, so callers can compute a tip position. */
  halfWidth: number;
}

function drawLimb(length: number, width: number, color: number, cuff: number | null): LimbTexture {
  const pad = 3;
  const { canvas, ctx } = makeCanvas(width + pad * 2, length + pad * 2);
  const cx = canvas.width / 2;

  roundedRect(ctx, cx - width / 2, pad, width, length, width / 2);
  fillTube(ctx, color, cx - width / 2, width);

  if (cuff !== null) {
    // A band near the joint: a cuff or a knee pad.
    ctx.fillStyle = rgba(cuff, 0.9);
    ctx.fillRect(cx - width / 2, pad + length * 0.3, width, Math.max(2, width * 0.26));
  }

  return { canvas, length, halfWidth: width / 2 };
}

/**
 * The torso, seen from above.
 *
 * Drawn facing right in the unrotated frame. The shape is a trapezoid: wide at
 * the shoulders, narrower at the hips, lit along the top edge and in shadow
 * along the bottom. A plate carrier with the archetype accent sits on the back,
 * which is the largest single colour block and therefore the fastest identity
 * read. The shoulders are the widest part, so the front is never ambiguous.
 */
function drawTorso(skeleton: Skeleton, palette: CharacterPalette, helmet: CharacterHelmet): HTMLCanvasElement {
  const width = skeleton.shoulderWidth + 10;
  const height = skeleton.torsoLength + skeleton.hipWidth + 12;
  const { canvas, ctx } = makeCanvas(width, height);
  const cx = canvas.width / 2;
  const top = 5;

  const halfShoulder = skeleton.shoulderWidth / 2;
  const halfHip = skeleton.hipWidth / 2;
  const bottom = top + skeleton.torsoLength + skeleton.hipWidth * 0.6;

  // Base torso: trapezoid, wider at the shoulders.
  ctx.beginPath();
  ctx.moveTo(cx - halfShoulder, top);
  ctx.lineTo(cx + halfShoulder, top);
  ctx.lineTo(cx + halfHip, bottom);
  ctx.lineTo(cx - halfHip, bottom);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, rgba(shade(palette.uniform, 0.24)));
  gradient.addColorStop(0.62, rgba(palette.uniform));
  gradient.addColorStop(1, rgba(shade(palette.uniform, -0.42)));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = rgba(shade(palette.uniform, -0.62), 0.95);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Plate carrier / webbing across the upper back in the trim colour.
  ctx.fillStyle = rgba(palette.trim, 0.82);
  roundedRect(ctx, cx - halfShoulder * 0.62, top + skeleton.torsoLength * 0.14, halfShoulder * 1.24, skeleton.torsoLength * 0.44, 2);
  ctx.fill();
  ctx.strokeStyle = rgba(shade(palette.trim, -0.5), 0.8);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Belt at the waist.
  ctx.fillStyle = rgba(shade(palette.trim, -0.42), 0.95);
  ctx.fillRect(cx - halfHip * 0.95, top + skeleton.torsoLength * 0.78, halfHip * 1.9, 3);

  // Shoulder marks: the fastest way to tell a COMMANDER from a rusher.
  ctx.fillStyle = rgba(palette.accent, 0.95);
  if (helmet === 'beret') {
    // An officer's epaulettes: a bar across each shoulder.
    ctx.fillRect(cx - halfShoulder - 1, top + 1, 6, 4);
    ctx.fillRect(cx + halfShoulder - 5, top + 1, 6, 4);
  } else {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * halfShoulder * 0.68, top + 3.6, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

/**
 * The head, seen from above with headgear.
 *
 * Headgear is what makes the silhouettes distinguishable at the zoom the arena
 * runs at: a cap, a wide visor, a hood, a heavy helmet and a beret all change
 * the outline, not just the colour. The forward edge is always the brightest
 * part so facing is unambiguous even when the head is only a few pixels across.
 */
function drawHead(skeleton: Skeleton, palette: CharacterPalette, helmet: CharacterHelmet): HTMLCanvasElement {
  const r = skeleton.headRadius;
  const size = r * 4;
  const { canvas, ctx } = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  // Neck stub, so the head does not float.
  ctx.fillStyle = rgba(shade(palette.skin, -0.3));
  ctx.fillRect(cx - r * 0.4, cy + r * 0.3, r * 0.8, r * 0.9);

  // Skull.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const skull = ctx.createRadialGradient(cx + r * 0.25, cy - r * 0.25, r * 0.2, cx, cy, r);
  skull.addColorStop(0, rgba(shade(palette.skin, 0.22)));
  skull.addColorStop(1, rgba(shade(palette.skin, -0.28)));
  ctx.fillStyle = skull;
  ctx.fill();
  ctx.strokeStyle = rgba(shade(palette.skin, -0.58), 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();

  switch (helmet) {
    case 'cap':
      // Low crown with a short brim over the eyes.
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.2, r * 1.02, Math.PI * 0.95, Math.PI * 2.05);
      ctx.closePath();
      ctx.fillStyle = rgba(palette.uniform);
      ctx.fill();
      ctx.fillStyle = rgba(shade(palette.uniform, -0.32));
      ctx.fillRect(cx + r * 0.15, cy - r * 0.36, r * 1.05, r * 0.36);
      break;
    case 'visor':
      // A wraparound visor in the accent colour: reads as optics at a distance.
      ctx.fillStyle = rgba(shade(palette.uniform, -0.1));
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.08, r * 1.04, Math.PI * 0.9, Math.PI * 2.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(palette.accent, 0.95);
      roundedRect(ctx, cx + r * 0.1, cy - r * 0.52, r * 1.0, r * 0.46, 1.5);
      ctx.fill();
      break;
    case 'hood':
      // A hood swallows the head; only a dark opening shows.
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.04, r * 1.3, 0, Math.PI * 2);
      ctx.fillStyle = rgba(palette.uniform);
      ctx.fill();
      ctx.strokeStyle = rgba(shade(palette.uniform, -0.5), 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.34, cy, r * 0.5, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgba(shade(palette.uniform, -0.64));
      ctx.fill();
      break;
    case 'heavy':
      // Full helmet with a faceplate and a crest.
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.26, 0, Math.PI * 2);
      ctx.fillStyle = rgba(shade(palette.uniform, 0.16));
      ctx.fill();
      ctx.strokeStyle = rgba(shade(palette.uniform, -0.5));
      ctx.stroke();
      ctx.fillStyle = rgba(shade(palette.uniform, -0.64));
      roundedRect(ctx, cx + r * 0.05, cy - r * 0.44, r * 1.05, r * 0.88, 1.5);
      ctx.fill();
      ctx.fillStyle = rgba(palette.accent, 0.85);
      ctx.fillRect(cx - r * 0.14, cy - r * 1.42, r * 0.34, r * 0.72);
      break;
    case 'beret':
      // Officer's beret, tilted, with an accent flash.
      ctx.beginPath();
      ctx.arc(cx - r * 0.1, cy - r * 0.36, r * 1.08, Math.PI * 0.86, Math.PI * 2.14);
      ctx.closePath();
      ctx.fillStyle = rgba(palette.uniform);
      ctx.fill();
      ctx.fillStyle = rgba(palette.accent, 0.95);
      ctx.beginPath();
      ctx.arc(cx + r * 0.42, cy - r * 0.62, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      break;
  }

  // Facing cue: a bright leading edge, drawn last so headgear never hides it.
  ctx.fillStyle = rgba(shade(palette.skin, 0.38), 0.85);
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.62, cy, r * 0.3, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/**
 * The weapon held in the firing hand.
 *
 * One texture per weapon class, drawn facing right from the grip so the aim pose
 * can rotate the whole arm-plus-weapon as a single unit.
 */
export function drawWeapon(kind: 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'smg'): HTMLCanvasElement {
  const sizes: Record<typeof kind, [number, number]> = {
    pistol: [13, 7],
    smg: [18, 8],
    rifle: [25, 8],
    shotgun: [27, 9],
    sniper: [34, 7],
  };
  const [length, thickness] = sizes[kind];
  const { canvas, ctx } = makeCanvas(length + 8, thickness + 10);
  const y = 4;
  const body = 0x1b2028;
  const metal = 0x3a4350;

  // Receiver.
  roundedRect(ctx, 3, y, length, thickness, 1.6);
  ctx.fillStyle = rgba(body);
  ctx.fill();
  ctx.strokeStyle = rgba(metal, 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Barrel / muzzle.
  ctx.fillStyle = rgba(metal);
  ctx.fillRect(3 + length * 0.72, y + thickness * 0.3, length * 0.42, thickness * 0.34);

  // Grip.
  ctx.fillStyle = rgba(shade(body, -0.25));
  ctx.fillRect(3 + length * 0.16, y + thickness, thickness * 0.5, thickness * 0.9);

  // Magazine — larger for the weapons that read as having one.
  if (kind !== 'pistol') {
    ctx.fillStyle = rgba(shade(body, -0.15));
    ctx.fillRect(3 + length * 0.38, y + thickness, thickness * 0.55, thickness * 1.1);
  }
  if (kind === 'sniper') {
    // Scope: the silhouette cue that says "this one shoots far".
    ctx.fillStyle = rgba(metal);
    ctx.fillRect(3 + length * 0.3, y - thickness * 0.7, length * 0.36, thickness * 0.6);
  }
  return canvas;
}

export interface CharacterPartTextures {
  torso: HTMLCanvasElement;
  head: HTMLCanvasElement;
  upperArm: LimbTexture;
  foreArm: LimbTexture;
  thigh: LimbTexture;
  shin: LimbTexture;
}

/**
 * Builds every part texture for one character spec.
 *
 * Called once per archetype (and once for the player) at scene start. The parts
 * are returned as raw canvases so this module stays free of any Phaser
 * dependency and can be exercised in a plain unit test.
 */
export function buildCharacterParts(spec: CharacterSpec): CharacterPartTextures {
  const skeleton = skeletonFor(spec.build);
  const { palette } = spec;
  return {
    torso: drawTorso(skeleton, palette, spec.helmet),
    head: drawHead(skeleton, palette, spec.helmet),
    upperArm: drawLimb(skeleton.upperArmLength, skeleton.upperArmWidth, palette.uniform, shade(palette.trim, -0.2)),
    foreArm: drawLimb(skeleton.foreArmLength, skeleton.foreArmWidth, palette.skin, null),
    thigh: drawLimb(skeleton.thighLength, skeleton.thighWidth, shade(palette.uniform, -0.14), null),
    shin: drawLimb(skeleton.shinLength, skeleton.shinWidth, shade(palette.uniform, -0.3), null),
  };
}

/** A soft elliptical drop shadow, drawn under every character for depth. */
export function drawShadow(radius: number): HTMLCanvasElement {
  const size = radius * 2.6;
  const { canvas, ctx } = makeCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.28)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size / 2, (size / 2) * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}
