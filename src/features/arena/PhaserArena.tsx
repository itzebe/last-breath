import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { ArenaScene, type ArenaOptions } from '@/game/scenes/ArenaScene';
import { ARENA_HEIGHT, ARENA_WIDTH } from '@/game/logic/simulation';
import type { WeaponId } from '@/game/logic/weapons';
import type { SimulationSnapshot } from '@/game/logic/simulation';

export interface PhaserArenaProps {
  loadout: WeaponId[];
  adaptationEnabled: boolean;
  maxWaves?: number;
  seed?: number;
  paused: boolean;
  onSnapshot: (snapshot: SimulationSnapshot) => void;
  onRunEnded: (snapshot: SimulationSnapshot) => void;
  /** Receives the live scene so the HUD can forward touch input to it. */
  onSceneReady: (scene: ArenaScene | null) => void;
}

/**
 * Mounts the Phaser game into a div and keeps its lifecycle tied to React.
 *
 * Phaser owns its own render loop and input handling, so React must not
 * re-render it. The effect runs exactly once; everything that needs to change
 * afterwards is pushed in through imperative scene methods rather than by
 * recreating the game.
 */
export function PhaserArena({
  loadout,
  adaptationEnabled,
  maxWaves,
  seed,
  paused,
  onSnapshot,
  onRunEnded,
  onSceneReady,
}: PhaserArenaProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  // Latest callbacks, read by the scene without forcing the effect to re-run.
  const callbacksRef = useRef({ onSnapshot, onRunEnded, onSceneReady });
  callbacksRef.current = { onSnapshot, onRunEnded, onSceneReady };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Seed the scene with the initial configuration. Later changes are applied
    // through the scene handle, not by rebuilding the game.
    const initial: Omit<ArenaOptions, 'callbacks'> = {
      loadout,
      adaptationEnabled,
      seed,
      ...(maxWaves === undefined ? {} : { maxWaves }),
    };

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: host.clientWidth || window.innerWidth,
      height: host.clientHeight || window.innerHeight,
      backgroundColor: '#04060a',
      // Crisp edges suit the angular, industrial art far better than smoothing.
      pixelArt: false,
      antialias: true,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        // Movement and collision are resolved inside the simulation, so Arcade
        // physics is only used for nothing here — it is omitted deliberately.
        default: undefined,
      },
      // React owns the DOM; Phaser must not steal focus or swallow keys globally.
      input: { keyboard: true, mouse: true, touch: true, gamepad: false },
      scene: [],
      audio: { noAudio: true },
    });

    gameRef.current = game;

    const scene = new ArenaScene();
    game.scene.add(ArenaScene.KEY, scene, true, {
      ...initial,
      callbacks: {
        onSnapshot: (snapshot) => callbacksRef.current.onSnapshot(snapshot),
        onRunEnded: (snapshot) => callbacksRef.current.onRunEnded(snapshot),
      },
    } satisfies ArenaOptions);

    // The scene may not have finished `create()` on this tick; wait for the
    // first frame before handing it out.
    game.events.once(Phaser.Core.Events.READY, () => callbacksRef.current.onSceneReady(scene));
    const readyTimer = window.setTimeout(() => {
      if (gameRef.current) callbacksRef.current.onSceneReady(scene);
    }, 60);

    // Pause the arena when the tab is hidden: an unattended run should not
    // accumulate damage or burn the player's time budget.
    const handleVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) {
        game.loop.sleep();
      } else {
        game.loop.wake();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Tell Phaser about container resizes; the RESIZE scale mode reads this.
    const observer = new ResizeObserver(() => {
      game.scale.resize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    });
    observer.observe(host);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      observer.disconnect();
      window.clearTimeout(readyTimer);
      callbacksRef.current.onSceneReady(null);
      game.destroy(true);
      gameRef.current = null;
    };
    // Intentionally runs once. `loadout`, `adaptationEnabled`, `maxWaves` and
    // `seed` are the run's starting configuration and must not restart the game
    // mid-match; adaptation changes are pushed through the scene handle instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pausing is a live concern, so it is pushed to the scene rather than baked in.
  useEffect(() => {
    const scene = gameRef.current?.scene.getScene(ArenaScene.KEY) as ArenaScene | undefined;
    scene?.setPaused(paused);
  }, [paused]);

  return (
    <div
      ref={hostRef}
      className="arena-canvas"
      data-arena-width={ARENA_WIDTH}
      data-arena-height={ARENA_HEIGHT}
      aria-hidden="true"
    />
  );
}
