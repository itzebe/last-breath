import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Panel } from '@/components/ui';
import { PhaserArena } from './PhaserArena';
import { CombatHud } from './CombatHud';
import { MissionPanel } from './MissionPanel';
import { UpgradeChooser } from './UpgradeChooser';
import { RunResults } from './RunResults';
import { AiDebugOverlay } from './AiDebugOverlay';
import { ThumbStick, TouchActionButton } from './TouchControls';
import { useAuth } from '@/app/AuthContext';
import { useIsPortrait, useIsTouchDevice } from '@/hooks/useMediaQuery';
import { submitMatch } from '@/services/dataService';
import { levelForXp } from '@/services/progression';
import { fetchUnlockedWeapons } from '@/services/dataService';
import { isWeaponId, WEAPON_IDS, type WeaponId } from '@/game/logic/weapons';
import { getAudioEngine, loadAudioSettings } from '@/game/audio';
import type { ArenaScene } from '@/game/scenes/ArenaScene';
import type { ArenaMode, SimulationSnapshot } from '@/game/logic/simulation';
import type { UpgradeId } from '@/game/logic/upgrades';
import { toAppError } from '@/lib/errors';
import { formatClock } from '@/lib/format';
import { createUuid } from '@/lib/validation';
import type { MatchOutcome } from '@/services/types';

type RunState = 'loading' | 'active' | 'paused' | 'ended';

interface SubmissionState {
  status: 'pending' | 'saved' | 'failed' | 'duplicate';
  score?: number;
  xp?: number;
  level?: number;
  levelUp?: boolean;
  /** Achievement ids the server confirmed for this run. */
  achievements?: string[];
  message?: string;
}

/** Fallback loadout if the unlock query has not resolved yet: the two weapons
 * every account is guaranteed. Never more than the player has actually earned. */
const FALLBACK_LOADOUT: WeaponId[] = ['pistol'];

/** Waves before the run is won. Three boss encounters at 10, 20 and 30. */
const MAX_WAVES = 30;

function parseMode(value: string | null): ArenaMode {
  if (value === 'deathmatch') return 'deathmatch';
  if (value === 'operations') return 'operations';
  return 'survival';
}

export function ArenaPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = parseMode(searchParams.get('mode'));
  // Operations: which mission. Undefined falls back to the scene default.
  const missionId = mode === 'operations' ? (searchParams.get('mission') ?? undefined) : undefined;
  const { user } = useAuth();
  const isTouch = useIsTouchDevice();
  const isPortrait = useIsPortrait();

  const sceneRef = useRef<ArenaScene | null>(null);
  const [runState, setRunState] = useState<RunState>('loading');
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [loadout, setLoadout] = useState<WeaponId[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionState>({ status: 'pending' });
  const [debugOpen, setDebugOpen] = useState(false);
  const [adaptationEnabled, setAdaptationEnabled] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const [audioSettings, setAudioSettings] = useState(loadAudioSettings);

  // Latest snapshot in a ref: the submission handler must not re-bind on every
  // frame just to read the final values.
  const snapshotRef = useRef<SimulationSnapshot | null>(null);
  snapshotRef.current = snapshot;

  /* ── Load the player's actual loadout ───────────────────────────────────── */

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setLoadout(FALLBACK_LOADOUT);
      return;
    }
    let cancelled = false;
    fetchUnlockedWeapons(userId)
      .then((rows) => {
        if (cancelled) return;
        const unlocked = rows
          .map((row) => row.weapon_id)
          .filter((id): id is WeaponId => isWeaponId(id));
        // Order by the canonical catalogue so the weapon cycle is predictable.
        const ordered = WEAPON_IDS.filter((id) => unlocked.includes(id));
        setLoadout(ordered.length > 0 ? ordered : FALLBACK_LOADOUT);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(toAppError(error).userMessage);
        setLoadout(FALLBACK_LOADOUT);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /* ── Audio unlock on first gesture ──────────────────────────────────────── */

  useEffect(() => {
    const audio = getAudioEngine();
    const unlock = () => {
      audio.unlock();
      audio.startMusic();
    };
    // Any interaction counts, and the listener is removed after the first one.
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.stopMusic();
    };
  }, []);

  // Suspending on pause and on tab-hide keeps the drone from playing over a
  // paused game or a backgrounded tab.
  useEffect(() => {
    const audio = getAudioEngine();
    if (runState === 'paused') audio.suspend();
    else if (runState === 'active') audio.resume();
  }, [runState]);

  useEffect(() => {
    setAudioSettings(getAudioEngine().updateSettings({}));
  }, []);

  /* ── Pause on Escape ────────────────────────────────────────────────────── */

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setRunState((current) => {
        if (current === 'active') return 'paused';
        if (current === 'paused') return 'active';
        return current;
      });
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  /* ── Scene handle ───────────────────────────────────────────────────────── */

  const handleSceneReady = useCallback((scene: ArenaScene | null) => {
    sceneRef.current = scene;
    if (scene) setRunState((current) => (current === 'loading' ? 'active' : current));
  }, []);

  const handleSnapshot = useCallback((next: SimulationSnapshot) => {
    setSnapshot(next);
  }, []);

  /* ── Match submission ───────────────────────────────────────────────────── */

  const submitResult = useCallback(
    async (final: SimulationSnapshot) => {
      const userId = user?.id;
      if (!userId) {
        setSubmission({ status: 'failed', message: 'You are not signed in, so this run was not recorded.' });
        return;
      }

      const isDeathmatch = final.mode === 'deathmatch';
      const isOperations = final.mode === 'operations';
      const extracted = isOperations && final.mission?.phase === 'complete';
      // Operations reports `extracted` rather than `victory`, so the database
      // records a mission result as a mission result.
      const outcome: MatchOutcome = extracted
        ? 'extracted'
        : final.outcome === 'victory'
          ? 'victory'
          : 'defeat';
      // The client's own score is never sent. The database derives score and XP
      // from these facts, so a tampered payload can only misreport facts, not
      // fabricate a rank.
      //
      // `clientMatchId` is the idempotency key and the column is `uuid`, so it
      // must be a real UUID — a composed string fails the Postgres cast.
      const clientMatchId = createUuid();

      try {
        const result = await submitMatch({
          clientMatchId,
          mode: final.mode,
          // Deathmatch has no waves: reporting the difficulty-derived waveNumber
          // would corrupt `highest_wave`, so it is reported as 0.
          // Neither Deathmatch nor Operations has survival waves, and reporting
          // the difficulty-derived wave number would corrupt `highest_wave`.
          waveReached: isDeathmatch || isOperations ? 0 : final.waveNumber,
          eliminations: final.eliminations,
          deaths: isDeathmatch
            ? (final.deathmatch?.playerDeaths ?? 0)
            : final.outcome === 'victory'
              ? 0
              : 1,
          damageDealt: Math.round(final.damageDealt),
          shotsFired: final.shotsFired,
          shotsHit: final.shotsHit,
          survivalSeconds: Math.floor(final.elapsedMs / 1000),
          outcome,
          bossDefeated: final.bossDefeated,
          adapted: final.adapted,
          // The snapshot's `objectiveIndex` is 1-based for display; the count of
          // objectives actually finished is `objectivesCompleted`.
          objectivesCompleted: isOperations ? (final.mission?.objectivesCompleted ?? 0) : 0,
          extracted,
        });

        if (result.duplicate) {
          setSubmission({ status: 'duplicate' });
          return;
        }
        setSubmission({
          status: 'saved',
          score: result.score,
          xp: result.xpAwarded,
          level: result.stats.level,
          // The server returns the post-match totals, so the pre-match level is
          // simply the level the player held before this match's XP landed.
          levelUp:
            result.stats.level >
            levelForXp(result.stats.total_xp - result.xpAwarded),
          achievements: result.newAchievements,
        });
      } catch (error) {
        const appError = toAppError(error);
        setSubmission({ status: 'failed', message: appError.userMessage });
      }
    },
    [user?.id],
  );

  const handleRunEnded = useCallback(
    (final: SimulationSnapshot) => {
      setRunState('ended');
      setSubmission({ status: 'pending' });
      void submitResult(final);
    },
    [submitResult],
  );

  /* ── Controls forwarded to the scene ────────────────────────────────────── */

  const handleMove = useCallback((vector: { x: number; y: number }) => {
    sceneRef.current?.setMoveVector(vector);
  }, []);

  const handleAim = useCallback((vector: { x: number; y: number }) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const player = scene.playerPos;
    // A right-stick deflection becomes an absolute world aim point. A full
    // deflection aims at the weapon's effective range, so the reticle tracks the
    // stick rather than sitting at a fixed distance.
    const reach = 420;
    scene.setAimPoint({ x: player.x + vector.x * reach, y: player.y + vector.y * reach });
    scene.setFiring(Math.hypot(vector.x, vector.y) > 0.28);
  }, []);

  const handleAimRelease = useCallback(() => {
    sceneRef.current?.setFiring(false);
  }, []);

  const handleReload = useCallback(() => {
    sceneRef.current?.requestReload();
  }, []);

  const handleDodge = useCallback(() => {
    sceneRef.current?.requestDodge();
  }, []);

  const handleGrenade = useCallback(() => {
    sceneRef.current?.requestGrenade();
  }, []);

  const handleChooseUpgrade = useCallback((id: UpgradeId) => {
    sceneRef.current?.chooseUpgrade(id);
  }, []);

  const handleSwitch = useCallback(() => {
    sceneRef.current?.cycleWeapon(1);
  }, []);

  const handlePlayAgain = useCallback(() => {
    // A fresh key remounts the Phaser game, which is the cleanest way to start a
    // genuinely new run with new RNG state.
    setSnapshot(null);
    setSubmission({ status: 'pending' });
    setRunKey((key) => key + 1);
    setRunState('loading');
  }, []);

  const toggleAdaptation = useCallback(() => {
    setAdaptationEnabled((current) => {
      const next = !current;
      sceneRef.current?.setAdaptationEnabled(next);
      return next;
    });
  }, []);

  const handleVolume = useCallback((value: number) => {
    const engine = getAudioEngine();
    const next = engine.updateSettings({ masterVolume: value, muted: value === 0 });
    setAudioSettings(next);
  }, []);

  /* ── Guards ─────────────────────────────────────────────────────────────── */

  if (loadError && !loadout) {
    return (
      <div className="auth-shell">
        <Panel tone="hostile" className="auth-card" title="Could not start the arena">
          <Alert tone="error">{loadError}</Alert>
          <Button variant="primary" block onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </Button>
        </Panel>
      </div>
    );
  }

  if (!loadout) {
    return (
      <div className="auth-shell">
        <p className="eyebrow eyebrow--signal">Preparing arena…</p>
      </div>
    );
  }

  /* ── Landscape gate ─────────────────────────────────────────────────────── */

  // Only gate on touch devices: a narrow desktop window is not a reason to
  // interrupt play.
  if (isTouch && isPortrait) {
    return (
      <div className="orientation-gate" role="dialog" aria-label="Rotate your device">
        <div>
          <div className="orientation-gate__icon" aria-hidden="true" />
          <p className="eyebrow eyebrow--signal">Rotate to landscape</p>
          <h1 className="section-title" style={{ marginBlock: 'var(--sp-3)' }}>
            LAST BREATH needs a wider view
          </h1>
          <p className="text-2 lead" style={{ maxWidth: '46ch', marginInline: 'auto' }}>
            The arena is a 360-degree combat space. Turn your device sideways to see enough of it to
            fight in — the controls will appear at the edges of the screen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="arena-shell" data-theme="combat">
      <PhaserArena
        key={runKey}
        loadout={loadout}
        adaptationEnabled={adaptationEnabled}
        maxWaves={MAX_WAVES}
        mode={mode}
        missionId={missionId}
        paused={runState === 'paused'}
        onSnapshot={handleSnapshot}
        onRunEnded={handleRunEnded}
        onSceneReady={handleSceneReady}
      />

      {snapshot && runState !== 'ended' ? (
        <>
          <CombatHud
            snapshot={snapshot}
            debugOpen={debugOpen}
            onPause={() => setRunState((current) => (current === 'paused' ? 'active' : 'paused'))}
            onToggleDebug={() => setDebugOpen((open) => !open)}
            onDodge={handleDodge}
            onGrenade={handleGrenade}
          />
          {snapshot.mission ? <MissionPanel mission={snapshot.mission} /> : null}
        </>
      ) : null}

      {/* ── Roguelite upgrade choice: pauses the arena until a card is taken ── */}
      {snapshot?.awaitingUpgrade && snapshot.upgradeOffer.length > 0 && runState !== 'ended' ? (
        <UpgradeChooser
          options={snapshot.upgradeOffer}
          taken={snapshot.upgrades}
          onChoose={handleChooseUpgrade}
        />
      ) : null}

      {/* ── Touch controls: only on touch devices, never over the results ── */}
      {isTouch && runState !== 'ended' && runState !== 'paused' ? (
        <>
          <ThumbStick label="Move" variant="move" onChange={handleMove} disabled={runState !== 'active'} />
          <ThumbStick
            label="Aim · fire"
            variant="aim"
            onChange={handleAim}
            onRelease={handleAimRelease}
            disabled={runState !== 'active'}
          />
          <div className="touch-actions">
            <TouchActionButton
              label="Dodge"
              glyph="↯"
              onPress={handleDodge}
              disabled={runState !== 'active'}
            />
            <TouchActionButton
              label="Grenade"
              glyph="◉"
              onPress={handleGrenade}
              disabled={runState !== 'active'}
            />
            <TouchActionButton label="Reload" glyph="⟳" onPress={handleReload} disabled={runState !== 'active'} />
            <TouchActionButton
              label="Weapon"
              glyph="⇄"
              onPress={handleSwitch}
              disabled={runState !== 'active'}
            />
          </div>
        </>
      ) : null}

      {/* Desktop hint: keyboard users get a reminder of the binds. */}
      {!isTouch && runState === 'active' && snapshot && snapshot.elapsedMs < 9000 ? (
        <div
          className="hud__panel"
          style={{ position: 'absolute', bottom: 'var(--sp-6)', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}
        >
          <p className="hud__label center">
            <span className="kbd">W</span> <span className="kbd">A</span> <span className="kbd">S</span>{' '}
            <span className="kbd">D</span> move · mouse aim · <span className="kbd">click</span> or{' '}
            <span className="kbd">space</span> fire · <span className="kbd">R</span> reload ·{' '}
            <span className="kbd">Q</span> weapon · <span className="kbd">shift</span> dodge ·{' '}
            <span className="kbd">G</span> grenade · <span className="kbd">esc</span> pause
          </p>
        </div>
      ) : null}

      {/* ── AI debug overlay ─────────────────────────────────────────────── */}
      {debugOpen && snapshot ? (
        <AiDebugOverlay
          traits={snapshot.traits}
          directive={snapshot.directive}
          history={sceneRef.current?.directorRef.adaptationHistory ?? []}
          adaptationEnabled={snapshot.adaptationEnabled}
          onClose={() => setDebugOpen(false)}
        />
      ) : null}

      {/* ── Pause overlay ────────────────────────────────────────────────── */}
      {runState === 'paused' ? (
        <div className="pause-overlay" role="dialog" aria-modal="true" aria-label="Match paused">
          <div className="pause-overlay__card">
            <Panel title="Paused" tone="signal">
              <div className="stack gap-4">
                <div className="between">
                  <span className="stat__label">Adaptive AI</span>
                  <Button
                    variant={adaptationEnabled ? 'telemetry' : 'ghost'}
                    onClick={toggleAdaptation}
                    aria-pressed={adaptationEnabled}
                  >
                    {adaptationEnabled ? 'Adapting' : 'Frozen'}
                  </Button>
                </div>
                <p className="text-3" style={{ fontSize: 'var(--fs-xs)' }}>
                  Freezing adaptation makes the opposition fall back to its base doctrine. Useful for
                  seeing the difference the AI makes.
                </p>

                <div className="stack gap-2">
                  <span className="stat__label">Master volume</span>
                  <input
                    className="range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={audioSettings.muted ? 0 : audioSettings.masterVolume}
                    onChange={(event) => handleVolume(Number(event.target.value))}
                    aria-label="Master volume"
                  />
                </div>

                <div className="cluster gap-3">
                  <Button variant="primary" onClick={() => setRunState('active')}>
                    Resume
                  </Button>
                  <Button variant="ghost" onClick={() => setDebugOpen((open) => !open)}>
                    {debugOpen ? 'Hide' : 'Show'} AI debug
                  </Button>
                  <Button variant="danger" onClick={() => navigate('/dashboard')}>
                    Abandon run
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {runState === 'ended' && snapshot ? (
        <RunResults snapshot={snapshot} submission={submission} onPlayAgain={handlePlayAgain} />
      ) : null}

      {/* Screen-reader announcement of the run state, so the arena is not silent
          to assistive technology. */}
      <p className="sr-only" role="status" aria-live="polite">
        {snapshot
          ? snapshot.deathmatch
            ? `Deathmatch, ${formatClock(snapshot.deathmatch.remainingMs)} remaining, ${snapshot.deathmatch.playerEliminations} of ${snapshot.deathmatch.eliminationTarget} eliminations, health ${Math.round(snapshot.player.health)} of ${snapshot.player.maxHealth}.`
            : snapshot.mission
              ? `Operations ${snapshot.mission.codename}, objective ${snapshot.mission.objectiveIndex} of ${snapshot.mission.objectiveTotal}, ${snapshot.mission.objectiveLabel}, health ${Math.round(snapshot.player.health)} of ${snapshot.player.maxHealth}.`
              : `Wave ${snapshot.waveNumber}, ${snapshot.enemiesRemaining} hostiles remaining, health ${Math.round(snapshot.player.health)} of ${snapshot.player.maxHealth}, score ${snapshot.score}.`
          : 'Preparing arena.'}
      </p>
    </div>
  );
}
