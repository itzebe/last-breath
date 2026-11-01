import Phaser from 'phaser';
import type { CharacterBuild, CharacterHelmet, EnemyArchetypeId } from '@/game/logic/enemies';
import {
  buildCharacterParts,
  drawShadow,
  drawWeapon,
  PLAYER_PALETTE,
  shade,
  skeletonFor,
  type CharacterPartTextures,
  type Skeleton,
} from './characters';

/**
 * The character texture registry.
 *
 * Builds and registers every part texture the arena needs — one articulated
 * figure per archetype plus the player — into the Phaser texture manager, and
 * hands out the keys. Splitting this from `CharacterView` means the expensive
 * canvas work happens once, up front, and a view is then just images.
 *
 * Key naming: `<specId>__<part>`. A spec id is the archetype id, or `player`.
 */

export type CharacterPartName = 'torso' | 'head' | 'upperArm' | 'foreArm' | 'thigh' | 'shin';

export interface CharacterSpecInput {
  readonly id: string;
  readonly build: CharacterBuild;
  readonly helmet: CharacterHelmet;
  readonly uniformColor: number;
  readonly bodyColor: number;
  readonly accentColor: number;
  readonly skin: number;
}

export interface CharacterTextureSet {
  readonly id: string;
  readonly skeleton: Skeleton;
  readonly keys: Readonly<Record<CharacterPartName, string>>;
  readonly weaponKey: string;
  readonly shadowKey: string;
  readonly scale: number;
}

/** The weapon each archetype carries, which is part of its silhouette. */
export const WEAPON_FOR_ARCHETYPE: Readonly<Record<EnemyArchetypeId, 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'smg'>> =
  Object.freeze({
    rusher: 'smg',
    flanker: 'smg',
    sniper: 'sniper',
    tank: 'shotgun',
    hunter: 'rifle',
    commander: 'rifle',
    medic: 'pistol',
    executor: 'rifle',
  });

export const PLAYER_WEAPONS: Readonly<Record<string, 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'smg'>> =
  Object.freeze({ pistol: 'pistol', rifle: 'rifle', shotgun: 'shotgun', sniper: 'sniper' });

function partKey(id: string, part: CharacterPartName): string {
  return `char-${id}-${part}`;
}

/**
 * Registers every character texture. Idempotent: re-registering the same spec id
 * removes and rebuilds its textures, so a hot reload cannot leave a stale part.
 */
export class CharacterTextures {
  private readonly registry = new Map<string, CharacterTextureSet>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Builds (or rebuilds) one figure's textures. Returns its key set. */
  register(input: CharacterSpecInput, scale = 1): CharacterTextureSet {
    const parts: CharacterPartTextures = buildCharacterParts({
      build: input.build,
      helmet: input.helmet,
      palette: {
        uniform: input.uniformColor,
        trim: shade(input.uniformColor, 0.35),
        accent: input.accentColor,
        skin: input.skin,
      },
      scale,
    });

    const keys: Record<CharacterPartName, string> = {
      torso: partKey(input.id, 'torso'),
      head: partKey(input.id, 'head'),
      upperArm: partKey(input.id, 'upperArm'),
      foreArm: partKey(input.id, 'foreArm'),
      thigh: partKey(input.id, 'thigh'),
      shin: partKey(input.id, 'shin'),
    };

    const canvases: Array<[string, HTMLCanvasElement]> = [
      [keys.torso, parts.torso],
      [keys.head, parts.head],
      [keys.upperArm, parts.upperArm.canvas],
      [keys.foreArm, parts.foreArm.canvas],
      [keys.thigh, parts.thigh.canvas],
      [keys.shin, parts.shin.canvas],
    ];

    // The hit-flash torso is a whitened copy, so a hit is a single texture swap
    // rather than a per-part tint pass.
    const flashTorso = this.whiten(parts.torso);

    for (const [key, canvas] of canvases) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      this.scene.textures.addCanvas(key, canvas);
    }
    if (this.scene.textures.exists(keys.torso + '-flash')) this.scene.textures.remove(keys.torso + '-flash');
    this.scene.textures.addCanvas(keys.torso + '-flash', flashTorso);

    const weaponKey = `char-${input.id}-weapon`;
    if (this.scene.textures.exists(weaponKey)) this.scene.textures.remove(weaponKey);
    this.scene.textures.addCanvas(weaponKey, drawWeapon(WEAPON_FOR_ARCHETYPE[input.id as EnemyArchetypeId] ?? 'rifle'));

    const shadowKey = 'char-shadow';
    if (!this.scene.textures.exists(shadowKey)) {
      this.scene.textures.addCanvas(shadowKey, drawShadow(18));
    }

    const textures: CharacterTextureSet = {
      id: input.id,
      skeleton: skeletonFor(input.build),
      keys,
      weaponKey,
      shadowKey,
      scale,
    };
    this.registry.set(input.id, textures);
    return textures;
  }

  get(id: string): CharacterTextureSet | undefined {
    return this.registry.get(id);
  }

  private whiten(source: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }
}

export { PLAYER_PALETTE };
