/**
 * Enemy archetypes.
 *
 * IMPORTANT — what this file is and is not.
 *
 * These archetypes define *capabilities*: how fast a hostile moves, how hard it
 * hits, how far it prefers to engage, and which stance it defaults to. In this
 * build each archetype runs a fixed script derived from those preferences.
 *
 * This is deliberately NOT adaptive AI. Nothing here observes the player. The
 * structure exists so that the adaptive layer can be added as a *directive*
 * source: `EnemyStance` is already the seam. A tactical director can override
 * `preferredRange`, `pressure` and `stance` at runtime without touching
 * movement, collision or combat code.
 */

export type EnemyArchetypeId = 'rusher' | 'flanker' | 'sniper' | 'tank' | 'hunter' | 'executor';

/** What a hostile is currently trying to do. The adaptive layer will steer this. */
export type EnemyStance = 'approach' | 'hold' | 'reposition' | 'retreat' | 'encircle';

export interface EnemyArchetype {
  readonly id: EnemyArchetypeId;
  readonly name: string;
  /** One-line description used in the codex and the debug overlay. */
  readonly doctrine: string;

  readonly maxHealth: number;
  readonly speed: number;
  /** Distance the hostile tries to maintain from the player. */
  readonly preferredRange: number;
  /** Tolerance around `preferredRange` before it repositions, in arena units. */
  readonly rangeTolerance: number;

  readonly contactDamage: number;
  /** Milliseconds between melee/ranged attacks. */
  readonly attackCooldownMs: number;
  readonly attackRange: number;
  /** 0 = melee only. */
  readonly rangedDamage: number;
  readonly rangedSpeed: number;
  readonly rangedRange: number;

  readonly radius: number;
  readonly xpValue: number;
  readonly scoreValue: number;

  /** How strongly this archetype leans on each behaviour. Weights, not switches:
   * the tactical director blends them when adaptation is enabled. */
  readonly aggression: number;
  readonly caution: number;
  readonly coordination: number;

  readonly defaultStance: EnemyStance;
  /** Visual identity. */
  readonly bodyColor: number;
  readonly accentColor: number;
  readonly shape: 'diamond' | 'chevron' | 'hexagon' | 'square' | 'triangulate' | 'boss';
  /** Minimum wave before this archetype can spawn. */
  readonly minWave: number;
  /** Relative spawn weight once eligible. */
  readonly spawnWeight: number;
}

export const ENEMY_ARCHETYPES: Readonly<Record<EnemyArchetypeId, EnemyArchetype>> = Object.freeze({
  rusher: {
    id: 'rusher',
    name: 'RUSHER',
    doctrine: 'Closes distance fast and accepts damage to land a hit.',
    maxHealth: 46,
    speed: 132,
    preferredRange: 26,
    rangeTolerance: 18,
    contactDamage: 11,
    attackCooldownMs: 720,
    attackRange: 30,
    rangedDamage: 0,
    rangedSpeed: 0,
    rangedRange: 0,
    radius: 15,
    xpValue: 12,
    scoreValue: 60,
    aggression: 1,
    caution: 0.1,
    coordination: 0.2,
    defaultStance: 'approach',
    bodyColor: 0xd8323f,
    accentColor: 0xff8a94,
    shape: 'chevron',
    minWave: 1,
    spawnWeight: 34,
  },
  flanker: {
    id: 'flanker',
    name: 'FLANKER',
    doctrine: 'Refuses the front line; arcs around to attack from an unguarded angle.',
    maxHealth: 40,
    speed: 150,
    preferredRange: 130,
    rangeTolerance: 60,
    contactDamage: 9,
    attackCooldownMs: 640,
    attackRange: 28,
    rangedDamage: 7,
    rangedSpeed: 420,
    rangedRange: 260,
    radius: 13,
    xpValue: 16,
    scoreValue: 85,
    aggression: 0.6,
    caution: 0.6,
    coordination: 0.8,
    defaultStance: 'encircle',
    bodyColor: 0xb03bd8,
    accentColor: 0xe4a0ff,
    shape: 'diamond',
    minWave: 2,
    spawnWeight: 22,
  },
  sniper: {
    id: 'sniper',
    name: 'MARKSMAN',
    doctrine: 'Holds long sightlines and punishes anyone standing in the open.',
    maxHealth: 34,
    speed: 78,
    preferredRange: 430,
    rangeTolerance: 120,
    contactDamage: 6,
    attackCooldownMs: 1900,
    attackRange: 34,
    rangedDamage: 16,
    rangedSpeed: 620,
    rangedRange: 620,
    radius: 14,
    xpValue: 20,
    scoreValue: 110,
    aggression: 0.3,
    caution: 0.95,
    coordination: 0.5,
    defaultStance: 'hold',
    bodyColor: 0x2f8fd8,
    accentColor: 0x9fd8ff,
    shape: 'hexagon',
    minWave: 3,
    spawnWeight: 16,
  },
  tank: {
    id: 'tank',
    name: 'BULWARK',
    doctrine: 'Absorbs punishment and advances relentlessly. Cannot be ignored.',
    maxHealth: 210,
    speed: 62,
    preferredRange: 40,
    rangeTolerance: 26,
    contactDamage: 22,
    attackCooldownMs: 1150,
    attackRange: 44,
    rangedDamage: 0,
    rangedSpeed: 0,
    rangedRange: 0,
    radius: 26,
    xpValue: 38,
    scoreValue: 220,
    aggression: 0.9,
    caution: 0.2,
    coordination: 0.3,
    defaultStance: 'approach',
    bodyColor: 0x8a6a2f,
    accentColor: 0xffd27a,
    shape: 'square',
    minWave: 4,
    spawnWeight: 14,
  },
  hunter: {
    id: 'hunter',
    name: 'TACTICAL HUNTER',
    doctrine: 'Tracks, cuts off escape routes and strikes when the player is reloading.',
    maxHealth: 96,
    speed: 122,
    preferredRange: 210,
    rangeTolerance: 80,
    contactDamage: 15,
    attackCooldownMs: 850,
    attackRange: 32,
    rangedDamage: 11,
    rangedSpeed: 520,
    rangedRange: 340,
    radius: 18,
    xpValue: 30,
    scoreValue: 175,
    aggression: 0.75,
    caution: 0.55,
    coordination: 1,
    defaultStance: 'reposition',
    bodyColor: 0x1f9c7a,
    accentColor: 0x8affd9,
    shape: 'triangulate',
    minWave: 5,
    spawnWeight: 18,
  },
  executor: {
    id: 'executor',
    name: 'THE EXECUTOR',
    doctrine: 'Arena overseer. Escalates through three distinct combat phases.',
    maxHealth: 4200,
    speed: 88,
    preferredRange: 300,
    rangeTolerance: 120,
    contactDamage: 34,
    attackCooldownMs: 1500,
    attackRange: 60,
    rangedDamage: 24,
    rangedSpeed: 640,
    rangedRange: 760,
    radius: 56,
    xpValue: 1200,
    scoreValue: 8000,
    aggression: 0.85,
    caution: 0.45,
    coordination: 1,
    defaultStance: 'hold',
    bodyColor: 0xff4a2f,
    accentColor: 0xffe08a,
    shape: 'boss',
    minWave: 99,
    spawnWeight: 0,
  },
});

export const SPAWNABLE_ARCHETYPES: readonly EnemyArchetypeId[] = [
  'rusher',
  'flanker',
  'sniper',
  'tank',
  'hunter',
];

/**
 * Looks up an archetype by id.
 *
 * Throws rather than returning `undefined`, matching `getWeapon`: an unknown id
 * here is a programming error, and a loud failure at the call site beats a
 * `Cannot read property 'maxHealth' of undefined` in the middle of a wave.
 */
export function getArchetype(id: EnemyArchetypeId): EnemyArchetype {
  const archetype = ENEMY_ARCHETYPES[id];
  if (!archetype) throw new Error(`Unknown enemy archetype: ${String(id)}`);
  return archetype;
}

/** Deterministic PRNG so spawn selection and tests are reproducible. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Chooses an archetype for a wave using the archetype weights, restricted to
 * what the wave has unlocked. Weights are relative, so this adapts automatically
 * as archetypes become eligible.
 */
export function pickArchetype(
  wave: number,
  random: () => number,
  allowed?: readonly EnemyArchetypeId[],
): EnemyArchetypeId {
  const pool = (allowed ?? SPAWNABLE_ARCHETYPES)
    .map(getArchetype)
    .filter((archetype) => archetype.minWave <= wave && archetype.spawnWeight > 0);

  if (pool.length === 0) return 'rusher';

  const total = pool.reduce((sum, archetype) => sum + archetype.spawnWeight, 0);
  let roll = random() * total;
  for (const archetype of pool) {
    roll -= archetype.spawnWeight;
    if (roll <= 0) return archetype.id;
  }
  return pool[pool.length - 1]!.id;
}

/** Scales archetype health and damage with wave depth, sub-linearly so late
 * waves are harder but never a wall. */
export function scaleForWave(
  archetype: EnemyArchetype,
  wave: number,
): { health: number; contactDamage: number; rangedDamage: number; speed: number } {
  const depth = Math.max(0, wave - 1);
  return {
    health: Math.round(archetype.maxHealth * (1 + depth * 0.17)),
    contactDamage: Math.round(archetype.contactDamage * (1 + depth * 0.075)),
    rangedDamage: Math.round(archetype.rangedDamage * (1 + depth * 0.07)),
    speed: Math.round(archetype.speed * (1 + Math.min(depth * 0.012, 0.3))),
  };
}
