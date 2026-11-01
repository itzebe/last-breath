import { describe, expect, it } from 'vitest';
import {
  burstDamage,
  damageAtDistance,
  getWeapon,
  isWeaponId,
  MIN_DAMAGE_MULTIPLIER,
  nextWeapon,
  previousWeapon,
  roundsPerSecond,
  sustainedDps,
  WEAPONS,
  WEAPON_IDS,
} from '@/game/logic/weapons';
import {
  createPlayerState,
  beginReload,
  canFire,
  cancelReload,
  createWeaponState,
  currentWeaponSpec,
  damagePlayer,
  fire,
  grantAmmo,
  healPlayer,
  isLowAmmo,
  isReloading,
  magazineFraction,
  PLAYER_MAX_HEALTH,
  switchWeapon,
  updatePlayer,
} from '@/game/logic/player';

describe('weapon catalogue', () => {
  it('defines exactly four weapons', () => {
    expect(Object.keys(WEAPONS)).toHaveLength(4);
    expect(WEAPON_IDS).toEqual(['pistol', 'rifle', 'shotgun', 'sniper']);
  });

  it('guards weapon ids correctly', () => {
    expect(isWeaponId('pistol')).toBe(true);
    expect(isWeaponId('railgun')).toBe(false);
    expect(isWeaponId('')).toBe(false);
  });

  it('gives every weapon a complete, sane specification', () => {
    for (const id of WEAPON_IDS) {
      const spec = WEAPONS[id];
      expect(spec.id).toBe(id);
      expect(spec.damage).toBeGreaterThan(0);
      expect(spec.fireRateMs).toBeGreaterThan(0);
      expect(spec.reloadMs).toBeGreaterThan(0);
      expect(spec.magazine).toBeGreaterThan(0);
      expect(spec.pellets).toBeGreaterThanOrEqual(1);
      expect(spec.spreadDeg).toBeGreaterThanOrEqual(0);
      expect(spec.projectileSpeed).toBeGreaterThan(0);
      expect(spec.rangePx).toBeGreaterThan(0);
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.role.length).toBeGreaterThan(0);
    }
  });

  it('makes the four weapons genuinely different, not reskins', () => {
    // Every weapon must differ from every other in at least two of the four
    // defining characteristics, or the choice is cosmetic.
    const keys = ['damage', 'fireRateMs', 'magazine', 'reloadMs'] as const;
    for (let i = 0; i < WEAPON_IDS.length; i += 1) {
      for (let j = i + 1; j < WEAPON_IDS.length; j += 1) {
        const a = WEAPONS[WEAPON_IDS[i]!];
        const b = WEAPONS[WEAPON_IDS[j]!];
        const differing = keys.filter((key) => a[key] !== b[key]).length;
        expect(differing, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('fires the shotgun as multiple pellets and the sniper as one', () => {
    expect(WEAPONS.shotgun.pellets).toBeGreaterThan(1);
    expect(WEAPONS.sniper.pellets).toBe(1);
  });

  it('makes the sniper the hardest-hitting single round and the slowest to fire', () => {
    expect(WEAPONS.sniper.damage).toBeGreaterThan(WEAPONS.rifle.damage);
    expect(WEAPONS.sniper.damage).toBeGreaterThan(WEAPONS.pistol.damage);
    expect(WEAPONS.sniper.fireRateMs).toBeGreaterThan(WEAPONS.rifle.fireRateMs);
  });

  it('makes the rifle the fastest sustained output', () => {
    const rifleDps = sustainedDps(WEAPONS.rifle);
    expect(rifleDps).toBeGreaterThan(sustainedDps(WEAPONS.pistol));
    expect(rifleDps).toBeGreaterThan(sustainedDps(WEAPONS.sniper));
  });

  it('gives the shotgun the highest burst but the smallest magazine', () => {
    expect(burstDamage(WEAPONS.shotgun)).toBeGreaterThan(burstDamage(WEAPONS.rifle));
    expect(WEAPONS.shotgun.magazine).toBeLessThan(WEAPONS.rifle.magazine);
  });

  it('computes rounds per second from the fire rate', () => {
    expect(roundsPerSecond(WEAPONS.rifle)).toBeCloseTo(1000 / WEAPONS.rifle.fireRateMs, 6);
    expect(roundsPerSecond(WEAPONS.pistol)).toBeGreaterThan(3);
    expect(roundsPerSecond(WEAPONS.pistol)).toBeLessThan(5);
  });

  it('deals full damage inside the weapon envelope, with no falloff at all', () => {
    const spec = WEAPONS.pistol;
    expect(damageAtDistance(spec, 0)).toBe(spec.damage);
    expect(damageAtDistance(spec, spec.rangePx * 0.5)).toBe(spec.damage);
    expect(damageAtDistance(spec, spec.rangePx)).toBe(spec.damage);
  });

  it('tapers damage past the envelope, down to the floor and no further', () => {
    const spec = WEAPONS.pistol;
    const quarter = damageAtDistance(spec, spec.rangePx * 1.25);
    const half = damageAtDistance(spec, spec.rangePx * 1.5);

    expect(quarter).toBeLessThan(spec.damage);
    expect(half).toBeLessThan(quarter);
    expect(half).toBeGreaterThan(spec.damage * MIN_DAMAGE_MULTIPLIER);

    // The taper completes at twice the envelope and then holds.
    expect(damageAtDistance(spec, spec.rangePx * 2)).toBeCloseTo(
      spec.damage * MIN_DAMAGE_MULTIPLIER,
      5,
    );
    expect(damageAtDistance(spec, spec.rangePx * 20)).toBeCloseTo(
      spec.damage * MIN_DAMAGE_MULTIPLIER,
      5,
    );
  });

  it('gives the shotgun a shorter effective envelope than the sniper', () => {
    expect(WEAPONS.shotgun.rangePx).toBeLessThan(WEAPONS.sniper.rangePx);
  });

  it('returns the weapon spec by id and throws on an unknown id', () => {
    expect(getWeapon('rifle').id).toBe('rifle');
    expect(() => getWeapon('nope' as never)).toThrow();
  });

  it('cycles forward and wraps', () => {
    const available = WEAPON_IDS;
    expect(nextWeapon('pistol', available)).toBe('rifle');
    expect(nextWeapon('sniper', available)).toBe('pistol');
  });

  it('cycles backward and wraps', () => {
    expect(previousWeapon('pistol', WEAPON_IDS)).toBe('sniper');
    expect(previousWeapon('rifle', WEAPON_IDS)).toBe('pistol');
  });

  it('cycles only within the available subset', () => {
    expect(nextWeapon('pistol', ['pistol', 'shotgun'])).toBe('shotgun');
    expect(nextWeapon('shotgun', ['pistol', 'shotgun'])).toBe('pistol');
  });

  it('handles a single-weapon loadout without looping forever', () => {
    expect(nextWeapon('pistol', ['pistol'])).toBe('pistol');
    expect(previousWeapon('pistol', ['pistol'])).toBe('pistol');
  });

  it('returns the current weapon when it is not in the available list', () => {
    expect(nextWeapon('rifle', ['pistol'])).toBe('pistol');
  });
});

describe('player state', () => {
  it('starts at full health with the chosen weapon equipped', () => {
    const player = createPlayerState(['pistol', 'rifle'], 'rifle');
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.maxHealth).toBe(PLAYER_MAX_HEALTH);
    expect(player.alive).toBe(true);
    expect(player.weapon).toBe('rifle');
    expect(player.loadout).toEqual(['pistol', 'rifle']);
  });

  it('fills the magazine and leaves the reserve unlimited by default', () => {
    const player = createPlayerState(['pistol']);
    expect(player.weapons.pistol.ammoInMagazine).toBe(WEAPONS.pistol.magazine);
    expect(player.weapons.pistol.reserveAmmo).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports the current weapon spec and magazine fraction', () => {
    const player = createPlayerState(['shotgun']);
    expect(currentWeaponSpec(player).id).toBe('shotgun');
    expect(magazineFraction(player)).toBe(1);
    player.weapons.shotgun.ammoInMagazine = Math.ceil(WEAPONS.shotgun.magazine / 2);
    expect(magazineFraction(player)).toBeCloseTo(0.5, 1);
  });

  it('allows firing when loaded and not reloading', () => {
    const player = createPlayerState(['pistol']);
    expect(canFire(player)).toBe(true);
  });

  it('consumes one round per shot and reports the pellet count', () => {
    const player = createPlayerState(['shotgun']);
    const result = fire(player);
    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error('expected the shotgun to fire');
    expect(result.pellets).toBe(WEAPONS.shotgun.pellets);
    expect(player.weapons.shotgun.ammoInMagazine).toBe(WEAPONS.shotgun.magazine - 1);
  });

  it('enforces the fire rate through the cooldown, not a wall clock', () => {
    const player = createPlayerState(['rifle']);
    expect(fire(player).fired).toBe(true);
    // Immediately again: blocked by the cooldown the first shot started.
    expect(fire(player).fired).toBe(false);

    // Part-way through the interval: still blocked.
    updatePlayer(player, WEAPONS.rifle.fireRateMs - 5);
    expect(fire(player).fired).toBe(false);

    // Past the interval: allowed again.
    updatePlayer(player, 10);
    expect(fire(player).fired).toBe(true);
  });

  it('refuses to fire an empty magazine', () => {
    const player = createPlayerState(['pistol']);
    player.weapons.pistol.ammoInMagazine = 0;
    const result = fire(player);
    expect(result.fired).toBe(false);
    if (result.fired) throw new Error('expected the pistol to be blocked');
    expect(result.reason).toBe('empty');
    expect(canFire(player)).toBe(false);
  });

  it('reloads to a full magazine over the weapon reload time', () => {
    const player = createPlayerState(['pistol']);
    player.weapons.pistol.ammoInMagazine = 2;

    const started = beginReload(player);
    expect(started.started).toBe(true);
    expect(isReloading(player)).toBe(true);

    // Halfway: not yet finished.
    updatePlayer(player, WEAPONS.pistol.reloadMs / 2);
    expect(isReloading(player)).toBe(true);

    updatePlayer(player, WEAPONS.pistol.reloadMs / 2 + 20);
    expect(isReloading(player)).toBe(false);
    expect(player.weapons.pistol.ammoInMagazine).toBe(WEAPONS.pistol.magazine);
  });

  it('refuses to reload a full magazine', () => {
    const player = createPlayerState(['pistol']);
    expect(beginReload(player).started).toBe(false);
  });

  it('refuses to reload while already reloading', () => {
    const player = createPlayerState(['pistol']);
    player.weapons.pistol.ammoInMagazine = 1;
    expect(beginReload(player).started).toBe(true);
    expect(beginReload(player).started).toBe(false);
  });

  it('does not fire while reloading', () => {
    const player = createPlayerState(['pistol']);
    player.weapons.pistol.ammoInMagazine = 1;
    beginReload(player);
    expect(canFire(player)).toBe(false);
    expect(fire(player).fired).toBe(false);
  });

  it('cancels a reload on demand', () => {
    const player = createPlayerState(['pistol']);
    player.weapons.pistol.ammoInMagazine = 1;
    beginReload(player);
    cancelReload(player);
    expect(isReloading(player)).toBe(false);
    expect(player.weapons.pistol.ammoInMagazine).toBe(1);
  });

  it('aborts an in-flight reload when switching weapons', () => {
    const player = createPlayerState(['pistol', 'rifle']);
    player.weapons.pistol.ammoInMagazine = 1;
    beginReload(player);
    expect(switchWeapon(player, 'rifle')).toBe(true);
    expect(player.weapon).toBe('rifle');
    expect(isReloading(player)).toBe(false);
  });

  it('refuses to switch to a weapon outside the loadout', () => {
    const player = createPlayerState(['pistol']);
    expect(switchWeapon(player, 'sniper')).toBe(false);
    expect(player.weapon).toBe('pistol');
  });

  it('reports no change when switching to the equipped weapon', () => {
    const player = createPlayerState(['pistol', 'rifle']);
    expect(switchWeapon(player, 'pistol')).toBe(false);
  });

  it('takes damage, clamps at zero, and reports death exactly once', () => {
    const player = createPlayerState(['pistol']);
    expect(damagePlayer(player, 30)).toBe(false);
    expect(player.health).toBe(70);
    expect(damagePlayer(player, 30)).toBe(false);
    expect(player.health).toBe(40);
    // Lethal.
    expect(damagePlayer(player, 100)).toBe(true);
    expect(player.health).toBe(0);
    expect(player.alive).toBe(false);
    // Already dead: no second death event.
    expect(damagePlayer(player, 50)).toBe(false);
    expect(player.health).toBe(0);
  });

  it('ignores zero and negative damage', () => {
    const player = createPlayerState(['pistol']);
    expect(damagePlayer(player, 0)).toBe(false);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it('heals but never past maximum', () => {
    const player = createPlayerState(['pistol']);
    damagePlayer(player, 50);
    const healed = healPlayer(player, 20);
    expect(healed).toBe(20);
    expect(player.health).toBe(70);
    healPlayer(player, 999);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it('does not heal a dead player', () => {
    const player = createPlayerState(['pistol']);
    damagePlayer(player, 999);
    expect(healPlayer(player, 50)).toBe(0);
    expect(player.health).toBe(0);
  });

  it('grants ammunition from a pickup, capped by the reserve limit', () => {
    const player = createPlayerState(['rifle']);
    player.weapons.rifle.reserveAmmo = 0;
    player.weapons.rifle.ammoInMagazine = 0;
    const granted = grantAmmo(player, 0.5);
    expect(granted).toBeGreaterThan(0);
    expect(player.weapons.rifle.reserveAmmo).toBe(granted);
  });

  it('refills the magazine from an ammo pickup when the reserve is unlimited', () => {
    // The default loadout runs an unlimited reserve, so a pickup must still be
    // worth collecting: it tops the magazine back up.
    const player = createPlayerState(['pistol']);
    player.weapons.pistol.ammoInMagazine = 2;
    const granted = grantAmmo(player);
    expect(granted).toBe(WEAPONS.pistol.magazine - 2);
    expect(player.weapons.pistol.ammoInMagazine).toBe(WEAPONS.pistol.magazine);
    expect(player.weapons.pistol.reserveAmmo).toBe(Number.POSITIVE_INFINITY);
  });

  it('flags low ammunition correctly', () => {
    const player = createPlayerState(['pistol']);
    expect(isLowAmmo(player)).toBe(false);
    player.weapons.pistol.ammoInMagazine = 1;
    expect(isLowAmmo(player)).toBe(true);
  });

  it('exposes a weapon state factory that respects a finite reserve', () => {
    const state = createWeaponState('rifle', 100);
    expect(state.ammoInMagazine).toBe(WEAPONS.rifle.magazine);
    expect(state.reserveAmmo).toBe(100);
    expect(state.reloadRemainingMs).toBe(0);
  });
});
