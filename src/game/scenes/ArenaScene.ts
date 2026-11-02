import Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOSS_ATTACKS,
  CombatSimulation,
  PLAYER_RADIUS,
  WALL_MARGIN,
  type Enemy,
  type SimulationEvent,
  type SimulationInput,
  type SimulationSnapshot,
  type ArenaMode,
} from '@/game/logic/simulation';
import { ENEMY_ARCHETYPES, type EnemyArchetypeId } from '@/game/logic/enemies';
import { buildTextures, enemyTextureKeys, PALETTE } from '@/game/render/textures';
import { CharacterTextures } from '@/game/render/CharacterTextures';
import { CharacterView } from '@/game/render/CharacterView';
import { poseFor, type PoseOptions } from '@/game/render/animation';
import { SKIN_TONES } from '@/game/render/characters';
import { ARENA_OBSTACLES, obstacleRect, type Obstacle } from '@/game/logic/obstacles';
import { getWeapon, type WeaponId } from '@/game/logic/weapons';
import type { UpgradeId } from '@/game/logic/upgrades';
import type { TacticalDirector } from '@/game/logic/tacticalDirector';
import { getAudioEngine, weaponSound } from '@/game/audio';
import { angleDelta, angleOf, sub, type Vec2 } from '@/game/logic/vec';

/**
 * The arena renderer.
 *
 * Division of labour, deliberately strict:
 *   - `CombatSimulation` owns all game state and decides everything.
 *   - This scene *renders* the simulation and *forwards* input. It never mutates
 *     game state, and it never makes a gameplay decision.
 *
 * The consequence is that the whole game is testable headlessly, and the visual
 * layer can be replaced without touching a single rule.
 */

export interface ArenaCallbacks {
  /** Called every frame with a fresh snapshot, for the React HUD. */
  onSnapshot: (snapshot: SimulationSnapshot) => void;
  /** Called once when the run ends, with the final snapshot. */
  onRunEnded: (snapshot: SimulationSnapshot) => void;
}

export interface ArenaOptions {
  loadout: WeaponId[];
  adaptationEnabled: boolean;
  seed?: number;
  /** Maximum waves before the run is won. Omit for endless survival. */
  maxWaves?: number;
  /** `survival` (default), `deathmatch` or `operations`. */
  mode?: ArenaMode;
  /** Operations: which mission to run. Defaults to OPERATION: LAST EXIT. */
  missionId?: string;
  callbacks: ArenaCallbacks;
}

/** Persistent display objects, keyed by entity id, reused across frames. */
interface EnemyView {
  container: Phaser.GameObjects.Container;
  /** The articulated human figure. The primitive body/accent sprites are kept
   * as a flat underlay so the silhouette reads even if a part texture fails. */
  character: CharacterView;
  body: Phaser.GameObjects.Image;
  accent: Phaser.GameObjects.Image;
  healthBar: Phaser.GameObjects.Rectangle;
  healthBarBg: Phaser.GameObjects.Rectangle;
  archetype: EnemyArchetypeId;
  isBoss: boolean;
  /** Animation clock, advanced per frame so walk cycles are smooth. */
  animMs: number;
  /** "AI" marker shown only for deathmatch opponents, so they are never
   * mistaken for human players. */
  aiTag?: Phaser.GameObjects.Text;
}

export class ArenaScene extends Phaser.Scene {
  static readonly KEY = 'arena';

  private options!: ArenaOptions;
  private sim!: CombatSimulation;

  private playerImage!: Phaser.GameObjects.Image;
  private playerRing!: Phaser.GameObjects.Arc;
  /** Articulated human figure for the player. The primitive `playerImage` is
   * retained as a flat underlay/hitbox ring anchor. */
  private playerCharacter!: CharacterView;
  private playerAnimMs = 0;
  /** Milliseconds since the player last fired, for the shooting pose. */
  private playerFiredMs = 999;
  /** Milliseconds since the player was last hit, for the flinch. */
  private playerHitMs = 999;
  /** Milliseconds since the player died, for the death fall. */
  private playerDeathMs = 0;
  /** Last frame's delta, so the renderer can advance animation clocks. */
  private lastDtMs = 16;
  /** One-shot ability requests, latched by React/touch and consumed on the next
   * simulation step. A latch rather than a flag so a tap between frames is never
   * dropped. */
  private pendingDodge = false;
  private pendingGrenade = false;
  /** Keys sampled for the dodge and grenade actions. */

  /** Builds and caches every articulated figure's part textures once. */
  private characterTextures!: CharacterTextures;
  private aimReticle!: Phaser.GameObjects.Graphics;
  private bossBar!: Phaser.GameObjects.Graphics;
  /** Draws the boss attack telegraph on the ground, under the entities. */
  private bossTelegraph!: Phaser.GameObjects.Graphics;
  /** Draws the Operations objective ring on the ground. */
  private objectiveMarker!: Phaser.GameObjects.Graphics;
  private waveBanner!: Phaser.GameObjects.Container;

  private enemyViews = new Map<number, EnemyView>();
  private projectileImages = new Map<number, Phaser.GameObjects.Image>();
  private pickupImages = new Map<number, Phaser.GameObjects.Image>();

  /** Input state, written by React and by the scene's own key handlers. */
  private moveVector: Vec2 = { x: 0, y: 0 };
  private aimVector: Vec2 | null = null;
  private firing = false;

  private keys!: Record<
    'up' | 'down' | 'left' | 'right' | 'reload' | 'swap' | 'pause' | 'fire' | 'dodge' | 'grenade',
    Phaser.Input.Keyboard.Key
  >;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private unsubscribe: (() => void) | null = null;
  private ended = false;
  private paused = false;
  private hitStopMs = 0;

  constructor() {
    super({ key: ArenaScene.KEY });
  }

  init(options: ArenaOptions): void {
    this.options = options;
    this.ended = false;
    this.paused = false;
  }

  create(): void {
    this.registerTextures();

    this.sim = new CombatSimulation({
      loadout: this.options.loadout,
      adaptationEnabled: this.options.adaptationEnabled,
      seed: this.options.seed ?? Date.now(),
      ...(this.options.maxWaves === undefined ? {} : { maxWaves: this.options.maxWaves }),
      ...(this.options.mode === undefined ? {} : { mode: this.options.mode }),
      ...(this.options.missionId === undefined ? {} : { missionId: this.options.missionId }),
      // Operations runs the roguelite upgrade loop; the other modes keep Part 2's
      // balance, where upgrades are not offered.
      upgradesEnabled: this.options.mode === 'operations',
    });

    this.buildArena();
    this.buildInput();
    this.subscribeToSimulation();

    // Camera: follow the player, but keep the arena visible on small screens by
    // never zooming out so far that hostiles become unreadable.
    const camera = this.cameras.main;
    camera.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    camera.setBackgroundColor(PALETTE.void);
    camera.startFollow(this.playerImage, true, 0.12, 0.12);

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    this.sim.setPlayerPosition({ x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 });
    this.playerImage.setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
  }

  /* ── Construction ──────────────────────────────────────────────────────── */

  private registerTextures(): void {
    const specs = Object.values(ENEMY_ARCHETYPES).map((archetype) => ({
      id: archetype.id,
      bodyColor: archetype.bodyColor,
      accentColor: archetype.accentColor,
      radius: archetype.radius,
      shape: archetype.shape,
    }));

    for (const { key, canvas } of buildTextures(specs)) {
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, canvas);
    }

    // Articulated human figures, one per archetype plus the player. Built here,
    // once, so a frame only sets positions and rotations.
    this.characterTextures = new CharacterTextures(this);
    const archetypes = Object.values(ENEMY_ARCHETYPES);
    archetypes.forEach((archetype, index) => {
      this.characterTextures.register({
        id: archetype.id,
        build: archetype.build,
        helmet: archetype.helmet,
        uniformColor: archetype.uniformColor,
        bodyColor: archetype.bodyColor,
        accentColor: archetype.accentColor,
        // A stable per-archetype skin so a squad does not look cloned.
        skin: SKIN_TONES[index % SKIN_TONES.length]!,
      });
    });
    this.characterTextures.register({
      id: 'player',
      build: 'standard',
      helmet: 'cap',
      uniformColor: 0x22303c,
      bodyColor: 0x2fd8c6,
      accentColor: 0xff6a1f,
      skin: SKIN_TONES[1]!,
    });
  }

  private buildArena(): void {
    // Floor: a tiled engineering grid, drawn as a TileSprite so it costs one
    // draw call regardless of arena size.
    this.add
      .tileSprite(0, 0, ARENA_WIDTH, ARENA_HEIGHT, 'grid-tile')
      .setOrigin(0)
      .setDepth(-100);

    // Perimeter wall: a band with hazard hatching, so the boundary reads as
    // deliberate architecture rather than as an invisible limit.
    const walls = this.add.graphics().setDepth(-90);
    walls.fillStyle(PALETTE.hull, 1);
    walls.fillRect(0, 0, ARENA_WIDTH, WALL_MARGIN);
    walls.fillRect(0, ARENA_HEIGHT - WALL_MARGIN, ARENA_WIDTH, WALL_MARGIN);
    walls.fillRect(0, 0, WALL_MARGIN, ARENA_HEIGHT);
    walls.fillRect(ARENA_WIDTH - WALL_MARGIN, 0, WALL_MARGIN, ARENA_HEIGHT);
    walls.lineStyle(2, PALETTE.edgeStrong, 0.85);
    walls.strokeRect(WALL_MARGIN, WALL_MARGIN, ARENA_WIDTH - WALL_MARGIN * 2, ARENA_HEIGHT - WALL_MARGIN * 2);

    // Corner markers, drawn once: gives the arena a sense of scale and orientation.
    const markers = this.add.graphics().setDepth(-88);
    markers.lineStyle(2, PALETTE.telemetry, 0.35);
    const cornerLength = 90;
    const corners: Array<[number, number, number, number]> = [
      [WALL_MARGIN + 18, WALL_MARGIN + 18, 1, 1],
      [ARENA_WIDTH - WALL_MARGIN - 18, WALL_MARGIN + 18, -1, 1],
      [WALL_MARGIN + 18, ARENA_HEIGHT - WALL_MARGIN - 18, 1, -1],
      [ARENA_WIDTH - WALL_MARGIN - 18, ARENA_HEIGHT - WALL_MARGIN - 18, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      markers.beginPath();
      markers.moveTo(x, y + sy * cornerLength);
      markers.lineTo(x, y);
      markers.lineTo(x + sx * cornerLength, y);
      markers.strokePath();
    }

    // Player: a chassis sprite plus a rotation-independent ring.
    this.playerRing = this.add
      .circle(0, 0, PLAYER_RADIUS + 8)
      .setStrokeStyle(1.5, PALETTE.telemetry, 0.55)
      .setDepth(9);
    this.playerImage = this.add.image(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 'player').setDepth(10);

    this.aimReticle = this.add.graphics().setDepth(11);
    this.bossBar = this.add.graphics().setDepth(60).setScrollFactor(0);
    // Telegraphs render under the entities so they read as ground markings.
    this.bossTelegraph = this.add.graphics().setDepth(6);
    this.objectiveMarker = this.add.graphics().setDepth(5);

    this.buildObstacles(ARENA_OBSTACLES);

    // The player's articulated figure, drawn above the primitive underlay.
    const playerTextures = this.characterTextures.get('player');
    if (playerTextures) {
      this.playerCharacter = new CharacterView(this, { textures: playerTextures, scale: 1 });
      this.playerCharacter.setDepth(11);
    }

    this.waveBanner = this.createWaveBanner();
  }

  /**
   * Draws the arena's cover.
   *
   * These blocks are real geometry: they block movement, stop projectiles and
   * break line of sight. Drawing them is not decoration — an invisible wall is a
   * bug the player experiences as a ghost hitbox, so the art has to match the
   * collision exactly.
   */
  private buildObstacles(obstacles: readonly Obstacle[]): void {
    const graphics = this.add.graphics().setDepth(-80);
    for (const obstacle of obstacles) {
      const rect = obstacleRect(obstacle);
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;

      // A short drop shadow to the south-east lifts the block off the floor.
      graphics.fillStyle(PALETTE.void, 0.5);
      graphics.fillRect(rect.left + 6, rect.top + 8, width, height);

      graphics.fillStyle(obstacle.kind === 'pillar' ? PALETTE.plate : PALETTE.hull, 1);
      graphics.fillRect(rect.left, rect.top, width, height);

      // A lighter cap reads as a top face in the plan view.
      graphics.fillStyle(PALETTE.ridge, 1);
      graphics.fillRect(rect.left + 5, rect.top + 5, width - 10, height - 10);

      graphics.lineStyle(2, PALETTE.edgeStrong, 0.9);
      graphics.strokeRect(rect.left, rect.top, width, height);

      // Cover value is legible as a hazard stripe: a block that stops more
      // bullets is a block worth running to.
      graphics.fillStyle(obstacle.cover >= 0.7 ? PALETTE.telemetry : PALETTE.edge, 0.7);
      graphics.fillRect(rect.left, rect.top, width, 3);
    }
  }

  private createWaveBanner(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0).setDepth(70).setScrollFactor(0).setAlpha(0);
    const background = this.add.rectangle(0, 0, 560, 96, PALETTE.void, 0.92);
    background.setStrokeStyle(2, PALETTE.signal, 0.9);
    const label = this.add
      .text(0, -14, '', {
        fontFamily: 'Chakra Petch, Bahnschrift, Arial Narrow, sans-serif',
        fontSize: '34px',
        color: '#e9f0f7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    label.setName('label');
    const sub = this.add
      .text(0, 24, '', {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '14px',
        color: '#a8bccd',
      })
      .setOrigin(0.5);
    sub.setName('sub');
    container.add([background, label, sub]);
    return container;
  }

  private buildInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    this.cursors = keyboard.createCursorKeys();
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      reload: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      swap: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      pause: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      fire: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      // Shift rolls, G lobs a grenade: both are one-shot actions read with
      // JustDown, never held.
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      grenade: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G),
    };

    // Right-click must not open the browser menu mid-firefight.
    this.input.mouse?.disableContextMenu();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.firing = true;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.firing = false;
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.aimVector = { x: world.x, y: world.y };
    });
  }

  private subscribeToSimulation(): void {
    this.unsubscribe = this.sim.subscribe((event) => this.handleEvent(event));
  }

  /* ── Input from React (touch controls) ─────────────────────────────────── */

  /** Movement vector, magnitude 0–1, from the left virtual stick. */
  setMoveVector(vector: Vec2): void {
    this.moveVector = vector;
  }

  /** Absolute aim point in world coordinates, from the right stick. */
  setAimPoint(point: Vec2 | null): void {
    this.aimVector = point;
  }

  setFiring(firing: boolean): void {
    this.firing = firing;
  }

  requestReload(): void {
    this.sim.requestReload();
  }

  requestWeaponSwitch(weapon: WeaponId): void {
    this.sim.switchTo(weapon);
  }

  cycleWeapon(direction: 1 | -1): void {
    this.sim.cycleWeapon(direction);
  }

  setAdaptationEnabled(enabled: boolean): void {
    this.sim.setAdaptationEnabled(enabled);
  }

  /** One-shot: begins a dodge roll. Ignored if the roll is on cooldown. */
  requestDodge(): void {
    this.pendingDodge = true;
  }

  /** One-shot: throws a grenade toward the current aim point. */
  requestGrenade(): void {
    this.pendingGrenade = true;
  }

  /** Resolves a three-choice upgrade card. Returns false if none is pending. */
  chooseUpgrade(id: UpgradeId): boolean {
    return this.sim.chooseUpgrade(id);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) getAudioEngine().suspend();
    else getAudioEngine().resume();
  }

  get snapshot(): SimulationSnapshot {
    return this.sim.snapshot();
  }

  /** The player's authoritative world position. Read-only for the renderer and
   * the touch controls, which need it to convert a stick deflection into an
   * absolute aim point. */
  get playerPos(): Vec2 {
    return this.sim.playerPos;
  }

  /** The tactical director, exposed so the debug overlay can read the full
   * adaptation history rather than just the latest decision. */
  get directorRef(): TacticalDirector {
    return this.sim.directorRef;
  }

  /* ── Update loop ───────────────────────────────────────────────────────── */

  override update(_time: number, delta: number): void {
    if (this.ended) return;

    // Clamp delta so a tab that was backgrounded does not fast-forward the arena.
    const dtMs = Math.min(delta, 50);
    this.lastDtMs = dtMs;
    if (!this.paused) {
      this.hitStopMs = Math.max(0, this.hitStopMs - dtMs);
      // Hit-stop: a brief slow-down on a kill, which gives impacts weight.
      const scale = this.hitStopMs > 0 ? 0.35 : 1;
      this.sim.step(dtMs * scale, this.collectInput());
    }

    this.render();
  }

  private collectInput(): SimulationInput {
    const keyboardMove = this.readKeyboardMove();
    // Keyboard wins while keys are held, so a plugged-in keyboard always works;
    // otherwise the touch stick drives movement.
    const magnitude = Math.hypot(keyboardMove.x, keyboardMove.y);
    const move = magnitude > 0.01 ? keyboardMove : this.moveVector;

    const aim = this.aimVector;

    // One-shot abilities are latched: a tap between two frames is remembered and
    // cleared here, so input is never silently dropped at a low frame rate.
    const dodge = this.pendingDodge || Phaser.Input.Keyboard.JustDown(this.keys.dodge);
    const grenade = this.pendingGrenade || Phaser.Input.Keyboard.JustDown(this.keys.grenade);
    this.pendingDodge = false;
    this.pendingGrenade = false;

    return {
      move,
      aim,
      firing: this.firing || this.keys?.fire?.isDown === true,
      ...(dodge ? { dodge: true } : {}),
      ...(grenade ? { grenade: true, grenadeTarget: aim } : {}),
    };
  }

  private readKeyboardMove(): Vec2 {
    let x = 0;
    let y = 0;
    if (!this.keys) return { x, y };
    if (this.keys.left.isDown || this.cursors?.left?.isDown) x -= 1;
    if (this.keys.right.isDown || this.cursors?.right?.isDown) x += 1;
    if (this.keys.up.isDown || this.cursors?.up?.isDown) y -= 1;
    if (this.keys.down.isDown || this.cursors?.down?.isDown) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  /* ── Events → feedback ─────────────────────────────────────────────────── */

  private handleEvent(event: SimulationEvent): void {
    const audio = getAudioEngine();
    switch (event.type) {
      case 'shot':
        audio.play(weaponSound(event.weapon));
        this.playerFiredMs = 0;
        this.spawnMuzzleFlash(event.at, event.angle);
        this.cameras.main.shake(70, getWeapon(event.weapon).recoil);
        break;
      case 'enemy_hit':
        audio.play('enemy_hit');
        this.spawnHitSpark(event.at, PALETTE.hostile);
        break;
      case 'enemy_died':
        audio.play(event.archetype === 'tank' || event.archetype === 'executor' ? 'explosion' : 'enemy_die');
        this.spawnDeathBurst(event.at, ENEMY_ARCHETYPES[event.archetype].bodyColor);
        this.hitStopMs = 55;
        break;
      case 'player_hit':
        audio.play('player_hit');
        this.playerHitMs = 0;
        this.cameras.main.shake(180, 0.008);
        this.cameras.main.flash(90, 120, 20, 30);
        break;
      case 'reload_started':
        audio.play('reload');
        break;
      case 'reload_finished':
        audio.play('reload_complete');
        this.sim.notifyReloadFinished();
        break;
      case 'weapon_switched':
        audio.play('reload_complete');
        break;
      case 'pickup_collected':
        audio.play(event.kind === 'health' ? 'pickup_health' : 'pickup_ammo');
        this.spawnPickupFlash(event.at);
        break;
      case 'wave_started':
        audio.play('wave_start');
        this.showWaveBanner(event.label, event.isBossWave ? 'THREAT LEVEL: CRITICAL' : `HOSTILES: ${event.hostiles}`);
        break;
      case 'wave_cleared':
        audio.play('wave_clear');
        this.showWaveBanner('WAVE CLEARED', `+${event.xp} XP   +${event.score} SCORE`);
        break;
      case 'boss_phase':
        audio.play('boss_phase');
        this.cameras.main.shake(600, 0.012);
        this.cameras.main.flash(200, 120, 20, 30);
        this.showWaveBanner(`EXECUTOR — PHASE ${event.phase}`, event.phase === 2 ? 'AGGRESSIVE PURSUIT' : event.phase === 3 ? 'FINAL PROTOCOL' : 'RANGED ASSAULT');
        break;
      case 'boss_attack':
        audio.play('boss_attack');
        this.spawnTelegraphBurst(event.at);
        break;
      case 'match_started':
        audio.play('match_start');
        this.showWaveBanner('DEATHMATCH', 'FIRST TO ' + this.sim.snapshot().deathmatch?.eliminationTarget);
        break;
      case 'opponent_eliminated':
        audio.play('kill_confirm');
        break;
      case 'player_respawned':
        audio.play('reload_complete');
        this.playerDeathMs = 0;
        this.playerHitMs = 999;
        this.cameras.main.flash(160, 40, 90, 140);
        break;
      case 'dodge':
        audio.play('dodge');
        break;
      case 'grenade_thrown':
        audio.play('grenade_throw');
        break;
      case 'grenade_exploded':
        audio.play('explosion');
        this.spawnExplosion(event.at, event.radius);
        this.cameras.main.shake(260, 0.014);
        break;
      case 'critical_hit':
        audio.play('critical_hit');
        this.spawnHitSpark(event.at, PALETTE.ammo);
        break;
      case 'combo':
        if (event.streak >= 3) this.showWaveBanner(`${event.streak} STREAK`, `x${event.multiplier.toFixed(1)} SCORE`);
        break;
      case 'reinforcements_called':
        audio.play('enemy_alert');
        this.showWaveBanner('REINFORCEMENTS', 'COMMANDER CALLED SUPPORT');
        break;
      case 'ally_revived':
        audio.play('enemy_alert');
        this.spawnPickupFlash(event.at);
        break;
      case 'enemy_searching':
        audio.play('enemy_alert');
        break;
      case 'mission_started':
        audio.play('mission_start');
        this.showWaveBanner(event.codename, 'OPERATION START');
        break;
      case 'objective_changed':
        audio.play('objective');
        this.showWaveBanner(event.label, `${event.index + 1} / ${event.total}`);
        break;
      case 'extraction_started':
        audio.play('extraction');
        this.showWaveBanner('EXTRACTION', `HOLD FOR ${Math.round(event.durationMs / 1000)}s`);
        break;
      case 'extraction_lost':
        audio.play('enemy_alert');
        this.showWaveBanner('EXTRACTION LOST', 'RETURN TO THE ZONE');
        break;
      case 'upgrade_offer':
        audio.play('upgrade');
        break;
      case 'upgrade_taken':
        audio.play('upgrade');
        break;
      case 'adaptation_changed':
        audio.play('adaptation');
        this.showWaveBanner('HOSTILES ADAPTING', event.profileName);
        break;
      case 'run_ended':
        this.ended = true;
        audio.play(event.outcome === 'victory' ? 'victory' : 'defeat');
        this.options.callbacks.onRunEnded(this.sim.snapshot());
        break;
      default:
        break;
    }
  }

  private spawnMuzzleFlash(at: Vec2, angle: number): void {
    const flash = this.add
      .image(at.x + Math.cos(angle) * (PLAYER_RADIUS + 8), at.y + Math.sin(angle) * (PLAYER_RADIUS + 8), 'muzzle')
      .setDepth(12)
      .setRotation(angle)
      .setScale(0.7 + Math.random() * 0.3);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 0.3,
      duration: 90,
      onComplete: () => flash.destroy(),
    });
  }

  private spawnHitSpark(at: Vec2, color: number): void {
    const spark = this.add.image(at.x, at.y, 'spark').setDepth(13).setTint(color).setScale(0.9);
    this.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 1.8,
      duration: 140,
      onComplete: () => spark.destroy(),
    });
  }

  private spawnDeathBurst(at: Vec2, color: number): void {
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const spark = this.add.image(at.x, at.y, 'spark').setDepth(13).setTint(color).setScale(1.1);
      this.tweens.add({
        targets: spark,
        x: at.x + Math.cos(angle) * (40 + Math.random() * 30),
        y: at.y + Math.sin(angle) * (40 + Math.random() * 30),
        alpha: 0,
        scale: 0.2,
        duration: 320,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private spawnPickupFlash(at: Vec2): void {
    const ring = this.add.circle(at.x, at.y, 12).setStrokeStyle(2, PALETTE.vital, 0.9).setDepth(13);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 320,
      onComplete: () => ring.destroy(),
    });
  }

  /** A grenade detonation: a hot core, an expanding shock ring, and debris. */
  private spawnExplosion(at: Vec2, radius: number): void {
    const core = this.add.circle(at.x, at.y, radius * 0.35, PALETTE.signal, 0.5).setDepth(12);
    this.tweens.add({ targets: core, scale: 1.8, alpha: 0, duration: 320, onComplete: () => core.destroy() });

    const ring = this.add.circle(at.x, at.y, radius * 0.3).setStrokeStyle(3, PALETTE.ammo, 0.9).setDepth(13);
    this.tweens.add({
      targets: ring,
      scale: (radius * 1.05) / (radius * 0.3),
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
      const spark = this.add.image(at.x, at.y, 'spark').setDepth(13).setTint(PALETTE.signal).setScale(1.3);
      this.tweens.add({
        targets: spark,
        x: at.x + Math.cos(angle) * radius * 0.9,
        y: at.y + Math.sin(angle) * radius * 0.9,
        alpha: 0,
        scale: 0.2,
        duration: 420,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  /** The visual "release" when a boss attack leaves its telegraph. */
  private spawnTelegraphBurst(at: Vec2): void {
    const ring = this.add.circle(at.x, at.y, 20).setStrokeStyle(3, PALETTE.hostile, 0.9).setDepth(13);
    this.tweens.add({
      targets: ring,
      scale: 5,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
    this.cameras.main.shake(220, 0.01);
  }

  private showWaveBanner(label: string, sub: string): void {
    const labelText = this.waveBanner.getByName('label') as Phaser.GameObjects.Text | null;
    const subText = this.waveBanner.getByName('sub') as Phaser.GameObjects.Text | null;
    labelText?.setText(label);
    subText?.setText(sub);

    const camera = this.cameras.main;
    this.waveBanner.setPosition(camera.width / 2, camera.height * 0.22);
    this.tweens.killTweensOf(this.waveBanner);
    this.waveBanner.setAlpha(0).setScale(0.94);
    this.tweens.add({ targets: this.waveBanner, alpha: 1, scale: 1, duration: 200, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.waveBanner, alpha: 0, delay: 1500, duration: 320 });
  }

  /* ── Rendering ─────────────────────────────────────────────────────────── */

  private render(): void {
    const snapshot = this.sim.snapshot();

    this.renderPlayer(snapshot);
    this.renderEnemies(snapshot);
    this.renderProjectiles(snapshot);
    this.renderPickups(snapshot);
    this.renderBossTelegraph(snapshot);
    this.renderBossBar(snapshot);
    this.renderReticle(snapshot);
    this.renderObjectiveMarker(snapshot);

    // The HUD is React's job; hand it a snapshot every frame.
    this.options.callbacks.onSnapshot(snapshot);
  }

  private renderPlayer(snapshot: SimulationSnapshot): void {
    const position = this.sim.playerPos;
    // The primitive sprite is now only the underlay/hitbox anchor: it stays put
    // and stays faint, so the articulated figure is what the player reads.
    this.playerImage.setPosition(position.x, position.y);
    this.playerImage.setRotation(this.sim.facing);
    this.playerImage.setAlpha(0.18);
    this.playerRing.setPosition(position.x, position.y);

    // Health is signalled through the ring's colour and its arc, so the player
    // never has to look away from the arena to check it.
    const fraction = snapshot.player.health / snapshot.player.maxHealth;
    const color = fraction > 0.6 ? PALETTE.vital : fraction > 0.3 ? PALETTE.ammo : PALETTE.hostile;
    this.playerRing.setStrokeStyle(1.5, color, 0.4 + fraction * 0.4);
    this.playerRing.setAlpha(snapshot.player.alive ? 1 : 0.35);

    // Advance the pose timers. These are wall-clock-free: they are driven by the
    // frame delta, exactly like the simulation, so the animation corresponds to
    // the state the simulation is actually in.
    const dt = this.lastDtMs;
    this.playerAnimMs += dt;
    this.playerFiredMs += dt;
    this.playerHitMs += dt;
    if (!snapshot.player.alive) this.playerDeathMs += dt;

    const view = this.playerCharacter;
    if (!view) return;
    view.advance(dt);

    const weapon = getWeapon(snapshot.player.weapon);
    const weaponState = snapshot.player.weapons[snapshot.player.weapon];
    const reloading = weaponState.reloadRemainingMs > 0;
    const reloadProgress = reloading ? 1 - weaponState.reloadRemainingMs / weapon.reloadMs : 0;

    const speed = Math.hypot(this.sim.playerVelocity.x, this.sim.playerVelocity.y);
    const dodging = snapshot.dodge.rolling;
    const dodgeProgress = dodging ? 1 - snapshot.dodge.cooldownMs / Math.max(1, snapshot.dodge.cooldownTotalMs) : 0;

    // Aim is relative to the facing direction: 0 is straight ahead, ±π is behind.
    const aimOffset = this.aimVector
      ? angleDelta(this.sim.facing, angleOf(sub(this.aimVector, position)))
      : 0;

    const poseOptions: PoseOptions = {
      aimOffset,
      firing: this.playerFiredMs < 110,
      reloadProgress,
      hitFlash: this.playerHitMs < 260 ? 1 - this.playerHitMs / 260 : 0,
      deathProgress: snapshot.player.alive ? 0 : Math.min(1, this.playerDeathMs / 900),
      meleeWindup: false,
      twoHanded: snapshot.player.weapon !== 'pistol',
    };

    const pose = poseFor(
      { speed, elapsedMs: this.playerAnimMs, dodging, dodgeProgress },
      poseOptions,
    );

    const tint = this.playerHitMs < 160 ? 0xffffff : null;
    view.apply(position.x, position.y, this.sim.facing, pose, {
      alpha: snapshot.player.alive ? 1 : 0.7,
      tint,
      weaponVisible: true,
      flashing: this.playerHitMs < 160,
    });
  }

  private renderEnemies(snapshot: SimulationSnapshot): void {
    const seen = new Set<number>();

    for (const enemy of snapshot.enemies) {
      seen.add(enemy.id);
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = this.createEnemyView(enemy);
        this.enemyViews.set(enemy.id, view);
      }
      this.updateEnemyView(view, enemy);
    }

    // Retire views for enemies that no longer exist.
    for (const [id, view] of this.enemyViews) {
      if (seen.has(id)) continue;
      view.container.destroy(true);
      this.enemyViews.delete(id);
    }
  }

  private createEnemyView(enemy: Enemy): EnemyView {
    const archetype = ENEMY_ARCHETYPES[enemy.archetype];
    const keys = enemyTextureKeys(archetype.id, archetype.bodyColor);

    // A faint primitive underlay keeps the archetype's colour on the ground even
    // under the articulated figure, and doubles as the "this is a hostile" read
    // at the edge of the screen.
    const body = this.add.image(0, 0, keys.body).setAlpha(0.25);
    const accent = this.add.image(0, 0, keys.accent).setScale(0.4).setAlpha(0.5);

    // The articulated human figure, scaled to the archetype's build so a heavy
    // genuinely reads larger than a rusher.
    const characterTextures = this.characterTextures.get(archetype.id);
    const character = new CharacterView(this, {
      textures: characterTextures ?? this.characterTextures.get('player')!,
      scale: enemy.isBoss ? 1.6 : archetype.build === 'heavy' ? 1.15 : 1,
    });

    const barWidth = enemy.isBoss ? 0 : Math.max(20, enemy.radius * 2);
    const healthBarBg = this.add.rectangle(0, -enemy.radius - 10, barWidth, 3, PALETTE.void, 0.85);
    const healthBar = this.add
      .rectangle(0, -enemy.radius - 10, barWidth, 3, PALETTE.hostile, 1)
      .setOrigin(0, 0.5);
    healthBar.x = -barWidth / 2;

    const children: Phaser.GameObjects.GameObject[] = [accent, body, healthBarBg, healthBar];

    // Deathmatch opponents carry an explicit AI tag. This is the visual contract
    // that the mode is single-player: no opponent is ever presented as a human.
    let aiTag: Phaser.GameObjects.Text | undefined;
    if (enemy.isOpponent) {
      aiTag = this.add
        .text(0, enemy.radius + 12, 'AI', {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '11px',
          color: '#7fd4ff',
        })
        .setOrigin(0.5);
      children.push(aiTag);
    }

    const container = this.add.container(enemy.position.x, enemy.position.y, children);
    container.setDepth(enemy.isBoss ? 8 : 7);
    // The figure rides inside the entity container, so it inherits the entity's
    // world position for free and only has to be posed locally each frame.
    container.add(character.container);
    character.container.setPosition(0, 0);

    return {
      container,
      character,
      body,
      accent,
      healthBar,
      healthBarBg,
      archetype: enemy.archetype,
      isBoss: enemy.isBoss,
      animMs: Math.random() * 1000,
      aiTag,
    };
  }

  private updateEnemyView(view: EnemyView, enemy: Enemy): void {
    view.container.setPosition(enemy.position.x, enemy.position.y);
    view.body.setRotation(enemy.facing);

    const dt = this.lastDtMs;
    view.animMs += dt;
    view.character.advance(dt);

    // Speed comes from the real velocity the simulation integrated, so a hostile
    // walking and a hostile sprinting animate differently for a reason.
    const speed = Math.hypot(enemy.velocity.x, enemy.velocity.y);
    const archetype = ENEMY_ARCHETYPES[enemy.archetype];
    const reloading = enemy.reloadRemainingMs > 0;
    const firing = enemy.attackCooldownMs > archetype.attackCooldownMs * 0.72;

    const pose = poseFor(
      {
        speed,
        elapsedMs: view.animMs,
        dodging: false,
        dodgeProgress: 0,
      },
      {
        aimOffset: 0,
        firing,
        reloadProgress: reloading ? 1 - enemy.reloadRemainingMs / 1500 : 0,
        hitFlash: enemy.hitFlashMs > 0 ? Math.min(1, enemy.hitFlashMs / 120) : 0,
        deathProgress: enemy.dying ? Math.min(1, enemy.deathMs / 900) : 0,
        meleeWindup: enemy.role === 'assault' && enemy.attackCooldownMs < archetype.attackCooldownMs * 0.35,
        twoHanded: archetype.rangedDamage > 0,
      },
    );

    // Posed in the container's local frame: the parent already carries the world
    // position, so passing world coordinates here would double the offset.
    view.character.apply(0, 0, enemy.facing, pose, {
      alpha: enemy.dying ? Math.max(0, 1 - enemy.deathMs / 900) : 1,
      tint: enemy.hitFlashMs > 0 ? 0xffffff : null,
      weaponVisible: true,
      flashing: enemy.hitFlashMs > 0,
    });

    if (enemy.dying) {
      // Death animation: the figure falls, then the whole view fades and the
      // caller retires it.
      const progress = Math.min(1, enemy.deathMs / 900);
      view.container.setScale(1 + progress * 0.3);
      view.container.setAlpha(1 - progress);
      view.healthBar.setVisible(false);
      view.healthBarBg.setVisible(false);
      view.aiTag?.setVisible(false);
      return;
    }

    const fraction = enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1;
    view.healthBar.setVisible(!enemy.isBoss && fraction < 1);
    view.healthBarBg.setVisible(!enemy.isBoss && fraction < 1);
    const width = Math.max(20, enemy.radius * 2);
    view.healthBar.width = width * Math.max(0, fraction);
    view.healthBar.x = -width / 2;
    view.healthBar.fillColor = fraction > 0.5 ? PALETTE.hostile : PALETTE.signal;

    // Hit flash: whiten the body briefly.
    view.body.setAlpha(enemy.hitFlashMs > 0 ? 0.4 : 0.25);
    if (enemy.hitFlashMs > 0) view.body.setTintFill(0xffffff);
    else view.body.clearTint();

    // Stance is legible without the debug overlay: the accent ring's alpha and
    // scale encode how committed a hostile is to closing distance.
    const stanceScale =
      enemy.stance === 'approach' ? 0.5 : enemy.stance === 'hold' ? 0.32 : enemy.stance === 'retreat' ? 0.2 : 0.4;
    view.accent.setScale(stanceScale);
    view.accent.setAlpha(enemy.stance === 'encircle' ? 0.95 : 0.7);

    if (enemy.isBoss) {
      view.container.setScale(1);
      view.container.setAlpha(1);
    }
  }

  /**
   * Draws the world-space marker for the current Operations objective.
   *
   * An objective the player cannot locate is not an objective, it is a scavenger
   * hunt, so the marker is a ground ring whose fill tracks the objective's
   * progress and a pip that pulses while the player is holding the zone.
   */
  private renderObjectiveMarker(snapshot: SimulationSnapshot): void {
    const mission = snapshot.mission;
    const marker = this.objectiveMarker;
    if (!mission || !mission.objectivePosition || mission.phase === 'complete' || mission.phase === 'failed') {
      marker.clear();
      marker.setVisible(false);
      return;
    }
    marker.setVisible(true);

    const { x, y } = mission.objectivePosition;
    const radius = mission.objectiveRadius ?? 70;
    const extracting = mission.phase === 'extraction';
    const colour = extracting ? PALETTE.ammo : PALETTE.telemetry;

    marker.clear();
    marker.lineStyle(3, colour, 0.85);
    marker.strokeCircle(x, y, radius);

    const progress = Math.max(0, Math.min(1, mission.objectiveProgress));
    if (progress > 0) {
      marker.fillStyle(colour, 0.18 + (mission.holdingPosition ? 0.22 : 0));
      marker.slice(x, y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, false);
      marker.fillPath();
    }

    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 220);
    marker.fillStyle(colour, 0.35 + pulse * 0.4);
    marker.fillCircle(x, y, 6 + pulse * 3);
  }

  private renderProjectiles(snapshot: SimulationSnapshot): void {
    const seen = new Set<number>();

    for (const projectile of snapshot.projectiles) {
      seen.add(projectile.id);
      let image = this.projectileImages.get(projectile.id);
      if (!image) {
        const key = projectile.owner === 'player' ? 'projectile-player' : 'projectile-boss';
        image = this.add.image(projectile.position.x, projectile.position.y, key).setDepth(11);
        image.setTint(projectile.color);
        image.setRotation(Math.atan2(projectile.velocity.y, projectile.velocity.x));
        // Stretch tracers along their travel direction: reads as velocity.
        image.setScale(1.6, 0.7);
        this.projectileImages.set(projectile.id, image);
      }
      image.setPosition(projectile.position.x, projectile.position.y);
    }

    for (const [id, image] of this.projectileImages) {
      if (seen.has(id)) continue;
      image.destroy();
      this.projectileImages.delete(id);
    }
  }

  private renderPickups(snapshot: SimulationSnapshot): void {
    const seen = new Set<number>();
    for (const pickup of snapshot.pickups) {
      seen.add(pickup.id);
      let image = this.pickupImages.get(pickup.id);
      if (!image) {
        image = this.add
          .image(pickup.position.x, pickup.position.y, pickup.kind === 'health' ? 'pickup-health' : 'pickup-ammo')
          .setDepth(6);
        this.pickupImages.set(pickup.id, image);
        // A gentle bob makes pickups noticeable without a HUD marker.
        this.tweens.add({
          targets: image,
          y: pickup.position.y - 5,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
    for (const [id, image] of this.pickupImages) {
      if (seen.has(id)) continue;
      this.tweens.killTweensOf(image);
      image.destroy();
      this.pickupImages.delete(id);
    }
  }

  private renderReticle(snapshot: SimulationSnapshot): void {
    this.aimReticle.clear();
    const aim = this.aimVector;
    if (!aim || !snapshot.player.alive) return;

    const spec = getWeapon(snapshot.player.weapon);
    // The reticle's spread reflects the weapon's actual accuracy, so the shotgun
    // reads as wide and the sniper as precise.
    const radius = 10 + spec.spreadDeg * 1.6;
    this.aimReticle.lineStyle(1.5, PALETTE.ammo, 0.85);
    this.aimReticle.strokeCircle(aim.x, aim.y, radius);
    this.aimReticle.lineStyle(1.5, PALETTE.ammo, 0.5);
    this.aimReticle.beginPath();
    this.aimReticle.moveTo(aim.x - radius - 8, aim.y);
    this.aimReticle.lineTo(aim.x - radius + 2, aim.y);
    this.aimReticle.moveTo(aim.x + radius - 2, aim.y);
    this.aimReticle.lineTo(aim.x + radius + 8, aim.y);
    this.aimReticle.moveTo(aim.x, aim.y - radius - 8);
    this.aimReticle.lineTo(aim.x, aim.y - radius + 2);
    this.aimReticle.moveTo(aim.x, aim.y + radius - 2);
    this.aimReticle.lineTo(aim.x, aim.y + radius + 8);
    this.aimReticle.strokePath();
  }

  /**
   * Draws the boss attack telegraph.
   *
   * The telegraph is the fairness mechanism for the whole boss fight: it shows
   * the player *which* attack is coming and *how much time* is left to react,
   * using a shrinking ring plus an attack-specific shape. Nothing here affects
   * gameplay — the simulation decides everything; this only makes the decision
   * legible.
   */
  private renderBossTelegraph(snapshot: SimulationSnapshot): void {
    this.bossTelegraph.clear();
    if (snapshot.bossTelegraphMs <= 0 || !snapshot.bossTelegraphAttack) return;

    const boss = snapshot.enemies.find((enemy) => enemy.isBoss && !enemy.dying);
    if (!boss) return;

    const kind = snapshot.bossTelegraphAttack;
    const spec = BOSS_ATTACKS[kind];
    const progress = 1 - snapshot.bossTelegraphMs / spec.telegraphMs; // 0 → 1
    const color = kind === 'slam' ? PALETTE.hostile : kind === 'burst' || kind === 'spiral' ? PALETTE.ammo : PALETTE.signal;

    // A ring that shrinks toward the boss as the attack charges, so the player
    // can read the remaining time at a glance without looking at a number.
    const ringRadius = boss.radius + 30 + (1 - progress) * 70;
    this.bossTelegraph.lineStyle(3, color, 0.5 + progress * 0.5);
    this.bossTelegraph.strokeCircle(boss.position.x, boss.position.y, ringRadius);

    // Attack-specific shape.
    if (kind === 'volley' || kind === 'lance') {
      // A lane pointing at the player's last-known direction.
      const aim = this.sim.playerPos;
      const angle = Math.atan2(aim.y - boss.position.y, aim.x - boss.position.x);
      const length = kind === 'lance' ? 520 : 380;
      this.bossTelegraph.lineStyle(6, color, 0.25 + progress * 0.4);
      this.bossTelegraph.beginPath();
      this.bossTelegraph.moveTo(boss.position.x, boss.position.y);
      this.bossTelegraph.lineTo(
        boss.position.x + Math.cos(angle) * length,
        boss.position.y + Math.sin(angle) * length,
      );
      this.bossTelegraph.strokePath();
    } else if (kind === 'slam') {
      // The area of effect: the whole radius the shockwave will cover.
      this.bossTelegraph.lineStyle(4, color, 0.3 + progress * 0.5);
      this.bossTelegraph.strokeCircle(boss.position.x, boss.position.y, 220);
      this.bossTelegraph.fillStyle(color, 0.06 + progress * 0.1);
      this.bossTelegraph.fillCircle(boss.position.x, boss.position.y, 220);
    } else {
      // Radial attacks: spokes that grow as the attack charges.
      const spokes = kind === 'spiral' ? 2 : 14;
      const reach = 80 + progress * 160;
      this.bossTelegraph.lineStyle(3, color, 0.25 + progress * 0.4);
      for (let i = 0; i < spokes; i += 1) {
        const angle = (i / spokes) * Math.PI * 2 + (kind === 'spiral' ? progress * 1.5 : 0);
        this.bossTelegraph.beginPath();
        this.bossTelegraph.moveTo(boss.position.x, boss.position.y);
        this.bossTelegraph.lineTo(
          boss.position.x + Math.cos(angle) * reach,
          boss.position.y + Math.sin(angle) * reach,
        );
        this.bossTelegraph.strokePath();
      }
    }
  }

  private renderBossBar(snapshot: SimulationSnapshot): void {
    this.bossBar.clear();
    if (snapshot.bossHealth === null || snapshot.bossMaxHealth === null) return;

    const camera = this.cameras.main;
    const width = Math.min(camera.width - 80, 720);
    const x = (camera.width - width) / 2;
    const y = 26;
    const fraction = Math.max(0, snapshot.bossHealth / snapshot.bossMaxHealth);

    this.bossBar.fillStyle(PALETTE.void, 0.85);
    this.bossBar.fillRect(x - 2, y - 2, width + 4, 18);
    this.bossBar.lineStyle(1.5, PALETTE.hostile, 0.9);
    this.bossBar.strokeRect(x - 2, y - 2, width + 4, 18);

    const phaseColor = snapshot.bossPhase === 1 ? PALETTE.hostile : snapshot.bossPhase === 2 ? PALETTE.signal : PALETTE.ammo;
    this.bossBar.fillStyle(phaseColor, 0.95);
    this.bossBar.fillRect(x, y, width * fraction, 14);

    // Phase divisions: the player can see where the next escalation begins.
    this.bossBar.lineStyle(1, PALETTE.void, 0.7);
    for (const threshold of [0.62, 0.3]) {
      const markerX = x + width * threshold;
      this.bossBar.beginPath();
      this.bossBar.moveTo(markerX, y);
      this.bossBar.lineTo(markerX, y + 14);
      this.bossBar.strokePath();
    }
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  private handleResize(): void {
    const camera = this.cameras.main;
    this.waveBanner.setPosition(camera.width / 2, camera.height * 0.22);
  }

  private teardown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.scale.off('resize', this.handleResize, this);
    for (const view of this.enemyViews.values()) view.container.destroy(true);
    this.enemyViews.clear();
    this.playerCharacter?.destroy();
    for (const image of this.projectileImages.values()) image.destroy();
    this.projectileImages.clear();
    for (const image of this.pickupImages.values()) image.destroy();
    this.pickupImages.clear();
  }
}
