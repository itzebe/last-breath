/**
 * Weapon model.
 *
 * The catalogue here mirrors `public.weapon_catalog` in the database, which is
 * the authority for what exists and what a player may unlock. The arena keeps
 * its own copy so simulation never waits on a network round trip; if the two
 * ever disagree, the database wins and the catalogue is refreshed on next load.
 */

export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'sniper';

export interface WeaponSpec {
  readonly id: WeaponId;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  /** Damage per projectile, before falloff. */
  readonly damage: number;
  /** Minimum milliseconds between shots. */
  readonly fireRateMs: number;
  readonly reloadMs: number;
  readonly magazine: number;
  /** Projectiles per trigger pull — >1 is what makes the shotgun a shotgun. */
  readonly pellets: number;
  /** Total cone width in degrees, split evenly across pellets. */
  readonly spreadDeg: number;
  readonly projectileSpeed: number;
  /** Distance past which damage falls to `MIN_DAMAGE_MULTIPLIER`. */
  readonly rangePx: number;
  readonly automatic: boolean;
  readonly unlockLevel: number;
  /** Camera shake intensity on fire. */
  readonly recoil: number;
  readonly tracerColor: number;
  readonly projectileRadius: number;
}

/** Damage retained at and beyond `rangePx`. */
export const MIN_DAMAGE_MULTIPLIER = 0.35;

export const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = Object.freeze({
  pistol: {
    id: 'pistol',
    name: 'SIDEARM MK-IV',
    role: 'Balanced',
    description: 'Standard-issue semi-automatic. Reliable, quick to reload, no clear weakness.',
    damage: 24,
    fireRateMs: 260,
    reloadMs: 1150,
    magazine: 14,
    pellets: 1,
    spreadDeg: 1.8,
    projectileSpeed: 780,
    rangePx: 720,
    automatic: false,
    unlockLevel: 1,
    recoil: 0.0016,
    tracerColor: 0xffd9a0,
    projectileRadius: 3,
  },
  rifle: {
    id: 'rifle',
    name: 'VULCAN AR-9',
    role: 'Automatic',
    description: 'Full-auto assault platform. High sustained output, traded for per-shot impact.',
    damage: 17,
    fireRateMs: 95,
    reloadMs: 1750,
    magazine: 32,
    pellets: 1,
    spreadDeg: 4.2,
    projectileSpeed: 900,
    rangePx: 780,
    automatic: true,
    unlockLevel: 1,
    recoil: 0.0011,
    tracerColor: 0x9fe6ff,
    projectileRadius: 2.5,
  },
  shotgun: {
    id: 'shotgun',
    name: 'BREACHER 12',
    role: 'Close quarters',
    description: 'Eight-pellet spread. Devastating inside its envelope, near-useless beyond it.',
    damage: 15,
    fireRateMs: 780,
    reloadMs: 2600,
    magazine: 6,
    pellets: 8,
    spreadDeg: 13.5,
    projectileSpeed: 640,
    rangePx: 320,
    automatic: false,
    unlockLevel: 3,
    recoil: 0.0062,
    tracerColor: 0xffb066,
    projectileRadius: 3.2,
  },
  sniper: {
    id: 'sniper',
    name: 'LONGSHOT .50',
    role: 'Precision',
    description: 'Single high-velocity round. Punishing damage, punishing cycle time.',
    damage: 105,
    fireRateMs: 1350,
    reloadMs: 2400,
    magazine: 5,
    pellets: 1,
    spreadDeg: 0.3,
    projectileSpeed: 1700,
    rangePx: 1500,
    automatic: false,
    unlockLevel: 5,
    recoil: 0.0092,
    tracerColor: 0xc9b4ff,
    projectileRadius: 3.8,
  },
});

export const WEAPON_IDS: readonly WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper'];

export function isWeaponId(value: string): value is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(value);
}

/**
 * Looks up a weapon by id.
 *
 * Throws rather than returning `undefined`: an unknown id reaching here is a
 * programming error, and failing loudly at the call site is far easier to
 * diagnose than a `Cannot read property 'damage' of undefined` several frames
 * later. Callers that hold untrusted data (a database row, a URL parameter)
 * must narrow it with `isWeaponId` first.
 */
export function getWeapon(id: WeaponId): WeaponSpec {
  const spec = WEAPONS[id];
  if (!spec) throw new Error(`Unknown weapon id: ${String(id)}`);
  return spec;
}

/** Cycle order for the weapon-switch control. */
export function nextWeapon(current: WeaponId, available: readonly WeaponId[]): WeaponId {
  const pool = available.length > 0 ? available : WEAPON_IDS;
  const index = pool.indexOf(current);
  return pool[(index + 1 + pool.length) % pool.length] ?? pool[0]!;
}

export function previousWeapon(current: WeaponId, available: readonly WeaponId[]): WeaponId {
  const pool = available.length > 0 ? available : WEAPON_IDS;
  const index = pool.indexOf(current);
  return pool[(index - 1 + pool.length) % pool.length] ?? pool[0]!;
}

/**
 * Damage falloff.
 *
 * Full damage inside the weapon's effective envelope (`rangePx`), then a linear
 * taper that reaches `MIN_DAMAGE_MULTIPLIER` at twice that distance and stays
 * there. Giving each weapon a hard envelope before any falloff is what makes the
 * sniper feel flat and the shotgun feel short: the shotgun's `rangePx` is small,
 * so its taper begins almost immediately.
 */
export function damageAtDistance(spec: WeaponSpec, distance: number): number {
  if (distance <= spec.rangePx) return spec.damage;
  const overshoot = distance - spec.rangePx;
  const taper = Math.min(overshoot / spec.rangePx, 1);
  const multiplier = 1 - taper * (1 - MIN_DAMAGE_MULTIPLIER);
  return spec.damage * multiplier;
}

/** Total theoretical damage of one trigger pull at point-blank range. */
export function burstDamage(spec: WeaponSpec): number {
  return spec.damage * spec.pellets;
}

/** Shots per second, used for the weapon comparison readout. */
export function roundsPerSecond(spec: WeaponSpec): number {
  return 1000 / spec.fireRateMs;
}

/** Sustained damage per second including reload downtime. */
export function sustainedDps(spec: WeaponSpec): number {
  const cycleSeconds = spec.fireRateMs / 1000;
  const shotsPerMagazine = spec.magazine / spec.pellets;
  const cycleTotal = shotsPerMagazine * cycleSeconds + spec.reloadMs / 1000;
  return (spec.damage * spec.magazine) / cycleTotal;
}
