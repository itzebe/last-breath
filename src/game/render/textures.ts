/**
 * Procedural art.
 *
 * Every sprite in LAST BREATH is generated at runtime into a canvas texture. Two
 * reasons: the game ships no binary assets (the whole arena is a few kilobytes of
 * code), and the visual language stays consistent because shapes, palette and
 * edge treatment all come from the same token set.
 *
 * Palette mirrors `src/styles/tokens.css`. A colour means a state.
 */

export const PALETTE = {
  void: 0x04060a,
  abyss: 0x070b11,
  hull: 0x0c1219,
  plate: 0x121a24,
  ridge: 0x1b2634,
  edge: 0x2a3a4c,
  edgeStrong: 0x3d5468,
  ink: 0xe9f0f7,
  ink2: 0xa8bccd,
  ink3: 0x6d8598,
  signal: 0xff6a1f,
  telemetry: 0x2fd8c6,
  vital: 0x7bf0a0,
  ammo: 0xffc247,
  xp: 0xa06bff,
  hostile: 0xff3d4d,
} as const;

export type EnemyShape = 'diamond' | 'chevron' | 'hexagon' | 'square' | 'triangulate' | 'boss';

export interface EnemyTextureSpec {
  id: string;
  bodyColor: number;
  accentColor: number;
  radius: number;
  shape: EnemyShape;
}

/** Enemy textures are keyed by archetype id + colour so each reads distinctly. */
export function enemyTextureKeys(id: string, bodyColor: number): { body: string; accent: string } {
  const suffix = `${id}-${bodyColor.toString(16)}`;
  return { body: `enemy-${suffix}`, accent: `enemy-accent-${suffix}` };
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — the arena cannot render.');
  return { canvas, ctx };
}

function hex(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Draws a polygon path from a flat list of points. */
function polygon(ctx: Ctx, points: ReadonlyArray<readonly [number, number]>): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function regularPolygon(radius: number, sides: number, offset = 0): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides + offset;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

function drawPlayerTexture(size = 44, flash = false): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;
  const body = flash ? PALETTE.ink : PALETTE.hull;
  const edge = flash ? 0xffffff : PALETTE.telemetry;

  ctx.save();
  ctx.translate(c, c);
  const outer = size * 0.44;

  // Outer armour plate: a hexagonal chassis.
  polygon(ctx, regularPolygon(outer, 6, Math.PI / 6));
  ctx.fillStyle = hex(body);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hex(edge, flash ? 1 : 0.9);
  ctx.stroke();

  // Directional wedge: shows facing without rotating the sprite.
  polygon(ctx, [
    [outer * 0.95, 0],
    [-outer * 0.25, -outer * 0.5],
    [-outer * 0.25, outer * 0.5],
  ]);
  ctx.fillStyle = hex(flash ? 0xffffff : PALETTE.telemetry, 0.85);
  ctx.fill();

  // Core: the "breath" indicator.
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = hex(flash ? 0xffffff : PALETTE.ink);
  ctx.fill();
  ctx.restore();

  return canvas;
}

function drawProjectileTexture(color: number, radius: number): HTMLCanvasElement {
  const size = Math.max(8, radius * 6);
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;

  // Outer glow then a hot core. The glow is what makes tracers readable against
  // a dark arena without needing additive blending.
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  gradient.addColorStop(0, hex(color, 1));
  gradient.addColorStop(0.45, hex(color, 0.55));
  gradient.addColorStop(1, hex(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  return canvas;
}

function drawPickupTexture(kind: 'health' | 'ammo'): HTMLCanvasElement {
  const size = 40;
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;
  const color = kind === 'health' ? PALETTE.vital : PALETTE.ammo;

  ctx.save();
  ctx.translate(c, c);
  const r = size * 0.42;

  // Chamfered plate, matching the application's panel treatment.
  polygon(ctx, [
    [-r + 7, -r],
    [r, -r],
    [r, r - 7],
    [r - 7, r],
    [-r, r],
    [-r, -r + 7],
  ]);
  ctx.fillStyle = hex(PALETTE.hull, 0.94);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hex(color, 0.95);
  ctx.stroke();

  ctx.lineWidth = 3.2;
  ctx.strokeStyle = hex(color, 1);
  ctx.lineCap = 'square';
  if (kind === 'health') {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.48);
    ctx.lineTo(0, r * 0.48);
    ctx.moveTo(-r * 0.48, 0);
    ctx.lineTo(r * 0.48, 0);
    ctx.stroke();
  } else {
    // Two stacked rounds read as ammunition rather than as a cross.
    for (const offset of [-r * 0.22, r * 0.22]) {
      ctx.beginPath();
      ctx.moveTo(offset, -r * 0.46);
      ctx.lineTo(offset, r * 0.46);
      ctx.stroke();
    }
  }
  ctx.restore();

  return canvas;
}

function drawEnemyTexture(shape: EnemyShape, bodyColor: number, radius: number): HTMLCanvasElement {
  const size = radius * 3;
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;
  const r = radius * 0.95;

  ctx.save();
  ctx.translate(c, c);

  const outline = (): void => {
    switch (shape) {
      case 'diamond':
        polygon(ctx, [
          [0, -r],
          [r, 0],
          [0, r],
          [-r, 0],
        ]);
        break;
      case 'chevron':
        polygon(ctx, [
          [r, 0],
          [-r * 0.55, -r * 0.9],
          [-r * 0.15, 0],
          [-r * 0.55, r * 0.9],
        ]);
        break;
      case 'hexagon':
        polygon(ctx, regularPolygon(r, 6, -Math.PI / 6));
        break;
      case 'square':
        polygon(ctx, [
          [-r * 0.85, -r * 0.85],
          [r * 0.85, -r * 0.85],
          [r * 0.85, r * 0.85],
          [-r * 0.85, r * 0.85],
        ]);
        break;
      case 'triangulate':
        polygon(ctx, [
          [r, 0],
          [-r * 0.7, -r * 0.8],
          [-r * 0.7, r * 0.8],
        ]);
        break;
      case 'boss':
        // The Executor reads as machinery rather than as a creature: a heavy
        // octagonal frame with internal bracing.
        polygon(ctx, regularPolygon(r, 8, Math.PI / 8));
        break;
    }
  };

  outline();
  ctx.fillStyle = hex(PALETTE.hull, 0.96);
  ctx.fill();
  ctx.lineWidth = shape === 'boss' ? 4 : 2;
  ctx.strokeStyle = hex(bodyColor, 1);
  ctx.stroke();

  // Interior detail: an inset shape in the body colour, which gives the
  // silhouette a sense of thickness without a second sprite.
  ctx.save();
  ctx.scale(0.5, 0.5);
  if (shape === 'boss' || shape === 'square') {
    outline();
    ctx.fillStyle = hex(bodyColor, shape === 'boss' ? 0.5 : 0.32);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = hex(bodyColor, 0.32);
    ctx.fill();
  }
  ctx.restore();

  if (shape === 'boss') {
    // Two "eyes" so the boss has a readable front.
    for (const x of [-r * 0.3, r * 0.3]) {
      ctx.beginPath();
      ctx.arc(x, 0, r * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = hex(0xffe08a, 1);
      ctx.fill();
    }
  }

  ctx.restore();
  return canvas;
}

function drawAccentTexture(accentColor: number, radius: number): HTMLCanvasElement {
  const size = Math.max(6, radius * 2);
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = hex(accentColor, 0.9);
  ctx.fill();
  return canvas;
}

function drawSpark(): HTMLCanvasElement {
  const size = 16;
  const { canvas, ctx } = makeCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, hex(PALETTE.ink, 1));
  gradient.addColorStop(0.4, hex(PALETTE.signal, 0.7));
  gradient.addColorStop(1, hex(PALETTE.signal, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function drawMuzzle(): HTMLCanvasElement {
  const size = 40;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  // A four-point star, so the flash reads as a discharge rather than as a blob.
  polygon(ctx, [
    [0, -size * 0.5],
    [size * 0.11, -size * 0.1],
    [size * 0.5, 0],
    [size * 0.11, size * 0.1],
    [0, size * 0.5],
    [-size * 0.11, size * 0.1],
    [-size * 0.5, 0],
    [-size * 0.11, -size * 0.1],
  ]);
  ctx.fillStyle = hex(PALETTE.ammo, 0.95);
  ctx.fill();
  ctx.restore();
  return canvas;
}

function drawGridTile(): HTMLCanvasElement {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = hex(PALETTE.abyss, 1);
  ctx.fillRect(0, 0, size, size);

  // Engineering grid: a fine mesh with a heavier major line on the tile edge.
  ctx.strokeStyle = hex(PALETTE.telemetry, 0.055);
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  ctx.strokeStyle = hex(PALETTE.telemetry, 0.1);
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, size);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(size, 0.5);
  ctx.stroke();

  return canvas;
}

export interface TextureEntry {
  key: string;
  canvas: HTMLCanvasElement;
}

/**
 * Builds every texture the arena needs. Called once, before the scene starts.
 * Returns plain canvases so this module has no Phaser dependency and can be
 * exercised in a test.
 */
export function buildTextures(enemies: readonly EnemyTextureSpec[]): TextureEntry[] {
  const entries: TextureEntry[] = [
    { key: 'player', canvas: drawPlayerTexture(44, false) },
    { key: 'player-flash', canvas: drawPlayerTexture(44, true) },
    { key: 'projectile-player', canvas: drawProjectileTexture(PALETTE.ammo, 3) },
    { key: 'projectile-enemy', canvas: drawProjectileTexture(0xff7a6a, 4) },
    { key: 'projectile-boss', canvas: drawProjectileTexture(0xffb347, 6) },
    { key: 'pickup-health', canvas: drawPickupTexture('health') },
    { key: 'pickup-ammo', canvas: drawPickupTexture('ammo') },
    { key: 'spark', canvas: drawSpark() },
    { key: 'muzzle', canvas: drawMuzzle() },
    { key: 'grid-tile', canvas: drawGridTile() },
  ];

  for (const enemy of enemies) {
    const keys = enemyTextureKeys(enemy.id, enemy.bodyColor);
    entries.push({ key: keys.body, canvas: drawEnemyTexture(enemy.shape, enemy.bodyColor, enemy.radius) });
    entries.push({ key: keys.accent, canvas: drawAccentTexture(enemy.accentColor, enemy.radius) });
  }

  return entries;
}
