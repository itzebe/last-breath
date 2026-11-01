import { getWeapon, type WeaponId, type WeaponSpec } from './weapons';

/**
 * Player combat state.
 *
 * This module is pure: it advances by explicit `dt` milliseconds and never reads
 * a clock, the DOM or Phaser. That is what makes reload timing, fire-rate gating
 * and ammo accounting unit-testable without a browser.
 */

export interface WeaponState {
  readonly id: WeaponId;
  /** Rounds currently in the magazine. */
  ammoInMagazine: number;
  /** Rounds held in reserve. `Infinity` means unlimited reserve. */
  reserveAmmo: number;
  /** Milliseconds remaining in an active reload, or 0. */
  reloadRemainingMs: number;
  /** Milliseconds until the next shot is permitted, or 0. */
  cooldownRemainingMs: number;
  /**
   * Rounds this magazine holds. Normally the weapon spec's magazine size, but
   * raised by the `twin_mag` run upgrade. Kept on the state rather than read
   * from the spec so an upgrade can enlarge a magazine without mutating the
   * shared, frozen weapon catalogue.
   */
  capacity: number;
}

export interface PlayerState {
  health: number;
  maxHealth: number;
  weapon: WeaponId;
  /** Every weapon the player may select. */
  loadout: WeaponId[];
  weapons: Record<WeaponId, WeaponState>;
  alive: boolean;
  /** Milliseconds since the run began. */
  elapsedMs: number;
}

export const PLAYER_MAX_HEALTH = 100;
/** Reserve rounds granted by an ammo pickup, per weapon type. */
export const AMMO_PICKUP_FRACTION = 0.35;
export const MAX_RESERVE_MULTIPLIER = 4;

export function createWeaponState(id: WeaponId, reserveAmmo = Number.POSITIVE_INFINITY): WeaponState {
  const spec = getWeapon(id);
  return {
    id,
    ammoInMagazine: spec.magazine,
    reserveAmmo,
    reloadRemainingMs: 0,
    cooldownRemainingMs: 0,
    capacity: spec.magazine,
  };
}

export function createPlayerState(loadout: WeaponId[], startWith: WeaponId = 'pistol'): PlayerState {
  const weapons = {} as Record<WeaponId, WeaponState>;
  for (const id of loadout) weapons[id] = createWeaponState(id);
  const start = loadout.includes(startWith) ? startWith : (loadout[0] ?? 'pistol');
  return {
    health: PLAYER_MAX_HEALTH,
    maxHealth: PLAYER_MAX_HEALTH,
    weapon: start,
    loadout: [...loadout],
    weapons,
    alive: true,
    elapsedMs: 0,
  };
}

export function currentWeaponState(player: PlayerState): WeaponState {
  return player.weapons[player.weapon];
}

export function currentWeaponSpec(player: PlayerState): WeaponSpec {
  return getWeapon(player.weapon);
}

export function isReloading(player: PlayerState): boolean {
  return currentWeaponState(player).reloadRemainingMs > 0;
}

export function magazineFraction(player: PlayerState): number {
  const state = currentWeaponState(player);
  return state.capacity > 0 ? state.ammoInMagazine / state.capacity : 0;
}

/**
 * Raises a weapon's magazine capacity to `capacity` rounds and immediately
 * fills the difference, so an upgrade that enlarges a magazine is felt on the
 * next shot rather than only after the next reload.
 */
export function setMagazineCapacity(player: PlayerState, id: WeaponId, capacity: number): void {
  const state = player.weapons[id];
  if (!state) return;
  const spec = getWeapon(id);
  const next = Math.max(spec.magazine, Math.round(capacity));
  const delta = Math.max(0, next - state.capacity);
  state.capacity = Math.max(state.capacity, next);
  state.ammoInMagazine = Math.min(state.capacity, state.ammoInMagazine + delta);
}

/** True when the weapon can fire right now. */
export function canFire(player: PlayerState): boolean {
  if (!player.alive) return false;
  const state = currentWeaponState(player);
  return state.reloadRemainingMs <= 0 && state.cooldownRemainingMs <= 0 && state.ammoInMagazine > 0;
}

export type FireOutcome =
  | { fired: true; pellets: number; spec: WeaponSpec }
  | { fired: false; reason: 'dead' | 'cooldown' | 'reloading' | 'empty' };

/**
 * Consumes one trigger pull. Mutates the player state and reports what happened
 * so the caller can spawn projectiles and play feedback.
 *
 * The rate limit is a *duration* on the weapon state, decremented by
 * `updatePlayer`, rather than a comparison against a wall clock. That keeps the
 * fire rate identical whether the arena is running at 30, 60 or 144 frames per
 * second, and keeps this function pure with respect to time.
 */
export function fire(player: PlayerState): FireOutcome {
  if (!player.alive) return { fired: false, reason: 'dead' };
  const state = currentWeaponState(player);
  const spec = getWeapon(state.id);

  if (state.reloadRemainingMs > 0) return { fired: false, reason: 'reloading' };
  if (state.cooldownRemainingMs > 0) return { fired: false, reason: 'cooldown' };
  if (state.ammoInMagazine <= 0) return { fired: false, reason: 'empty' };

  state.ammoInMagazine -= 1;
  state.cooldownRemainingMs = spec.fireRateMs;
  return { fired: true, pellets: spec.pellets, spec };
}

export type ReloadOutcome =
  | { started: true; durationMs: number }
  | { started: false; reason: 'dead' | 'already' | 'full' | 'no_reserve' };

export function beginReload(player: PlayerState): ReloadOutcome {
  if (!player.alive) return { started: false, reason: 'dead' };
  const state = currentWeaponState(player);
  const spec = getWeapon(state.id);

  if (state.reloadRemainingMs > 0) return { started: false, reason: 'already' };
  if (state.ammoInMagazine >= state.capacity) return { started: false, reason: 'full' };
  if (state.reserveAmmo <= 0) return { started: false, reason: 'no_reserve' };

  state.reloadRemainingMs = spec.reloadMs;
  return { started: true, durationMs: spec.reloadMs };
}

/** Cancels an in-flight reload (e.g. the player switched weapons). */
export function cancelReload(player: PlayerState): void {
  currentWeaponState(player).reloadRemainingMs = 0;
}

function completeReload(state: WeaponState): void {
  const needed = state.capacity - state.ammoInMagazine;
  const available = Number.isFinite(state.reserveAmmo) ? state.reserveAmmo : needed;
  const loaded = Math.min(needed, available);
  state.ammoInMagazine += loaded;
  if (Number.isFinite(state.reserveAmmo)) {
    state.reserveAmmo = Math.max(0, state.reserveAmmo - loaded);
  }
}

export function switchWeapon(player: PlayerState, id: WeaponId): boolean {
  if (!player.alive) return false;
  if (!player.loadout.includes(id)) return false;
  if (player.weapon === id) return false;
  // Switching aborts a reload — this is a real tactical cost, not a formality.
  cancelReload(player);
  player.weapon = id;
  return true;
}

/** Ticks cooldowns and reloads, and retires the player if health is gone. */
export function updatePlayer(player: PlayerState, dtMs: number): void {
  if (!player.alive) return;
  player.elapsedMs += dtMs;

  for (const id of player.loadout) {
    const state = player.weapons[id];
    if (!state) continue;
    if (state.cooldownRemainingMs > 0) {
      state.cooldownRemainingMs = Math.max(0, state.cooldownRemainingMs - dtMs);
    }
    if (state.reloadRemainingMs > 0) {
      state.reloadRemainingMs -= dtMs;
      if (state.reloadRemainingMs <= 0) {
        state.reloadRemainingMs = 0;
        completeReload(state);
      }
    }
  }

  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
  }
}

/** Applies damage. Returns true when this hit was the killing blow. */
export function damagePlayer(player: PlayerState, amount: number): boolean {
  if (!player.alive || amount <= 0) return false;
  player.health = Math.max(0, player.health - amount);
  if (player.health === 0) {
    player.alive = false;
    return true;
  }
  return false;
}

export function healPlayer(player: PlayerState, amount: number): number {
  if (!player.alive || amount <= 0) return 0;
  const before = player.health;
  player.health = Math.min(player.maxHealth, player.health + amount);
  return player.health - before;
}

/** Refills reserve ammo for the whole loadout. Returns rounds granted. */
export function grantAmmo(player: PlayerState, fraction = AMMO_PICKUP_FRACTION): number {
  let granted = 0;
  for (const id of player.loadout) {
    const state = player.weapons[id];
    if (!state || !Number.isFinite(state.reserveAmmo)) continue;
    const spec = getWeapon(id);
    const cap = spec.magazine * MAX_RESERVE_MULTIPLIER;
    const amount = Math.max(1, Math.round(spec.magazine * fraction));
    const next = Math.min(cap, state.reserveAmmo + amount);
    granted += next - state.reserveAmmo;
    state.reserveAmmo = next;
  }
  return granted;
}

/** Convenience predicate used by the HUD to decide whether to nudge the player. */
export function isLowAmmo(player: PlayerState): boolean {
  const state = currentWeaponState(player);
  return state.capacity > 0 ? state.ammoInMagazine / state.capacity <= 0.25 : true;
}
