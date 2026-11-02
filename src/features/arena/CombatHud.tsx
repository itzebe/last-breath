import { Bar } from '@/components/ui';
import { formatClock, formatNumber, formatReserve } from '@/lib/format';
import type { SimulationSnapshot } from '@/game/logic/simulation';
import { getWeapon } from '@/game/logic/weapons';

/**
 * The combat HUD.
 *
 * Layout rule: vital information sits in the corners the player's eyes already
 * visit. Health bottom-left (above the movement thumb), ammunition bottom-right
 * (above the aim thumb), wave and score top-centre, run statistics top-right.
 *
 * Everything is pointer-events-none except the pause control, so the HUD never
 * swallows a shot.
 */

export interface CombatHudProps {
  snapshot: SimulationSnapshot;
  onPause: () => void;
  onToggleDebug: () => void;
  /** One-shot ability triggers, for the pointer users who prefer buttons. */
  onDodge?: () => void;
  onGrenade?: () => void;
  debugOpen: boolean;
}

export function CombatHud({ snapshot, onPause, onToggleDebug, onDodge, onGrenade, debugOpen }: CombatHudProps) {
  const { player, wave, waveNumber, enemiesRemaining, enemiesAlive, score, deathmatch, mission, dodge, grenades, combo } =
    snapshot;
  const weapon = getWeapon(player.weapon);
  const state = player.weapons[player.weapon];

  const healthFraction = player.maxHealth > 0 ? player.health / player.maxHealth : 0;
  const ammoFraction = weapon.magazine > 0 ? state.ammoInMagazine / weapon.magazine : 0;
  const reloading = state.reloadRemainingMs > 0;
  const lowHealth = healthFraction <= 0.3;
  const lowAmmo = state.ammoInMagazine <= Math.ceil(weapon.magazine * 0.2);

  return (
    <div className="hud" aria-live="off">
      {/* ── Top row ─────────────────────────────────────────────────────── */}
      <div className="hud__row">
        {deathmatch ? (
          <div className="hud__panel" style={{ minWidth: 168 }}>
            <p className="hud__label">
              {deathmatch.phase === 'countdown'
                ? 'Deathmatch — starting'
                : deathmatch.phase === 'finished'
                  ? 'Match over'
                  : 'Deathmatch'}
            </p>
            <p className="hud__value hud__value--signal">
              {formatClock(deathmatch.remainingMs)}
            </p>
            <p className="hud__label" style={{ marginTop: 2 }}>
              {deathmatch.playerEliminations}/{deathmatch.eliminationTarget} eliminations
              {deathmatch.playerRespawnMs > 0
                ? ` · re-entering in ${Math.ceil(deathmatch.playerRespawnMs / 1000)}s`
                : ''}
            </p>
          </div>
        ) : mission ? (
          // Operations has no waves, so the survival panel would read
          // "Wave 1 · 0 remaining" for the whole mission. This panel reports the
          // objective instead, which is what the mode is actually about.
          <div className="hud__panel" style={{ minWidth: 168 }}>
            <p className="hud__label">{mission.codename}</p>
            <p className="hud__value hud__value--signal" style={{ fontSize: 'var(--fs-md)' }}>
              {mission.phase === 'complete'
                ? 'Exfil'
                : mission.phase === 'failed'
                  ? 'Failed'
                  : `Objective ${mission.objectiveIndex}/${mission.objectiveTotal}`}
            </p>
            <p className="hud__label" style={{ marginTop: 2 }}>
              {enemiesAlive} hostiles in the field
            </p>
          </div>
        ) : (
          <div className="hud__panel" style={{ minWidth: 148 }}>
            <p className="hud__label">Wave {waveNumber}</p>
            <p className="hud__value hud__value--signal">{wave.label}</p>
            <p className="hud__label" style={{ marginTop: 2 }}>
              {enemiesRemaining} remaining
              {wave.isBossWave ? ' · boss' : ''}
            </p>
          </div>
        )}

        <div className="hud__panel center" style={{ minWidth: 120 }}>
          <p className="hud__label">{deathmatch ? 'Kills' : 'Score'}</p>
          <p className="hud__value">
            {deathmatch ? formatNumber(deathmatch.playerEliminations) : formatNumber(score)}
          </p>
        </div>

        <div className="hud__panel" style={{ minWidth: 132 }}>
          <p className="hud__label">Run time</p>
          <p className="hud__value">{formatClock(snapshot.elapsedMs)}</p>
          <p className="hud__label" style={{ marginTop: 2 }}>
            {snapshot.shotsFired > 0
              ? `${Math.round((snapshot.shotsHit / snapshot.shotsFired) * 100)}% acc`
              : 'no shots fired'}
          </p>
        </div>
      </div>

      {/* ── Middle: wave transition banner is drawn by Phaser; this row is
             intentionally empty so the arena stays visible. ──────────────── */}

      {/* ── Bottom row ──────────────────────────────────────────────────── */}
      <div className="hud__row" style={{ alignItems: 'flex-end' }}>
        <div className="stack gap-2" style={{ pointerEvents: 'auto' }}>
          <div className="hud__panel hud__health">
            <div className="between" style={{ marginBottom: 6 }}>
              <span className="hud__label">Integrity</span>
              <span className={`hud__value ${lowHealth ? 'hud__value--hostile' : 'hud__value--vital'}`} style={{ fontSize: 'var(--fs-md)' }}>
                {Math.max(0, Math.round(player.health))}
                <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-xs)' }}>/{player.maxHealth}</span>
              </span>
            </div>
            <Bar
              label="Player health"
              value={healthFraction}
              tone={lowHealth ? 'hostile' : 'vital'}
            />
            {lowHealth && player.alive ? (
              <p className="hud__label" style={{ marginTop: 6, color: 'var(--hostile)' }}>
                Critical — find cover
              </p>
            ) : null}
          </div>

          {/* ── Ability readout: dodge charge and grenade count ─────────── */}
          <div className="hud__panel hud__abilities" style={{ minWidth: 168 }}>
            <div className="between">
              <span className="hud__label">Dodge</span>
              <span className="hud__value" style={{ fontSize: 'var(--fs-sm)' }}>
                {dodge.rolling
                  ? 'rolling'
                  : dodge.cooldownMs > 0
                    ? `${(dodge.cooldownMs / 1000).toFixed(1)}s`
                    : dodge.invulnerable
                      ? 'invulnerable'
                      : 'ready'}
              </span>
            </div>
            <div className="between" style={{ marginTop: 4 }}>
              <span className="hud__label">Grenades</span>
              <span className="hud__value hud__value--ammo" style={{ fontSize: 'var(--fs-sm)' }}>
                {grenades.remaining}
                {grenades.cooldownRemainingMs > 0
                  ? ` · ${(grenades.cooldownRemainingMs / 1000).toFixed(1)}s`
                  : ''}
              </span>
            </div>
            {combo.streak >= 2 ? (
              <p className="hud__combo" aria-live="polite">
                {combo.streak} streak · x{combo.multiplier.toFixed(1)}
              </p>
            ) : null}

            {/* Pointer users get on-screen ability buttons in the same panel;
                keyboard users have Shift and G and can ignore these. */}
            {onDodge || onGrenade ? (
              <div className="hud__cluster" style={{ marginTop: 6 }}>
                {onDodge ? (
                  <button
                    type="button"
                    className="touch-btn"
                    onClick={onDodge}
                    disabled={dodge.rolling || dodge.cooldownMs > 0 || !player.alive}
                    aria-label="Dodge roll"
                  >
                    <span className="touch-btn__glyph" aria-hidden="true">
                      ↯
                    </span>
                    <span>Dodge</span>
                  </button>
                ) : null}
                {onGrenade ? (
                  <button
                    type="button"
                    className="touch-btn"
                    onClick={onGrenade}
                    disabled={grenades.remaining <= 0 || grenades.cooldownRemainingMs > 0 || !player.alive}
                    aria-label={`Throw grenade, ${grenades.remaining} remaining`}
                  >
                    <span className="touch-btn__glyph" aria-hidden="true">
                      ◉
                    </span>
                    <span>Grenade</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="stack gap-2" style={{ alignItems: 'flex-end' }}>
          <div className="hud__panel" style={{ minWidth: 180 }}>
            <div className="between" style={{ marginBottom: 6 }}>
              <span className="hud__label">{weapon.name}</span>
              <span className={`hud__value ${lowAmmo && !reloading ? 'hud__value--hostile' : 'hud__value--ammo'}`} style={{ fontSize: 'var(--fs-md)' }}>
                {reloading ? '—' : state.ammoInMagazine}
                <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-xs)' }}>/{formatReserve(state.reserveAmmo)}</span>
              </span>
            </div>
            <Bar
              label="Magazine"
              value={reloading ? state.reloadRemainingMs > 0 ? 1 - state.reloadRemainingMs / weapon.reloadMs : 0 : ammoFraction}
              tone={reloading ? 'ammo' : lowAmmo ? 'hostile' : 'ammo'}
            />
            <p className="hud__label" style={{ marginTop: 6 }}>
              {reloading
                ? `Reloading… ${(state.reloadRemainingMs / 1000).toFixed(1)}s`
                : `${weapon.magazine} round magazine · reserve ${formatReserve(state.reserveAmmo)}`}
            </p>
          </div>

          <div className="hud__cluster" style={{ pointerEvents: 'auto' }}>
            <button type="button" className="touch-btn" onClick={onPause} aria-label="Pause match">
              <span className="touch-btn__glyph" aria-hidden="true">
                ❙❙
              </span>
              <span>Pause</span>
            </button>
            <button
              type="button"
              className="touch-btn"
              onClick={onToggleDebug}
              aria-pressed={debugOpen}
              aria-label="Toggle adaptive AI debug overlay"
              style={debugOpen ? { borderColor: 'var(--telemetry)', color: 'var(--telemetry)' } : undefined}
            >
              <span className="touch-btn__glyph" aria-hidden="true">
                ⌁
              </span>
              <span>AI</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
