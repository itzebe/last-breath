import {
  getArchetype,
  pickArchetype,
  scaleForWave,
  type EnemyArchetypeId,
  type EnemyStance,
} from './enemies';
import { BehaviourObserver, type BehaviourTraits } from './behaviour';
import {
  applyDirective,
  neutralDirective,
  TacticalDirector,
  type TacticalDirective,
} from './tacticalDirector';
import {
  beginReload,
  canFire,
  createPlayerState,
  currentWeaponSpec,
  damagePlayer,
  fire,
  grantAmmo,
  healPlayer,
  switchWeapon,
  updatePlayer,
  type PlayerState,
} from './player';
import {
  damageAtDistance,
  nextWeapon,
  previousWeapon,
  type WeaponId,
} from './weapons';
import { pickupChance, planWave, waveClearReward, type WavePlan } from './waves';
import {
  add,
  angleOf,
  clamp,
  clampMagnitude,
  distance,
  distanceSq,
  fromAngle,
  normalise,
  scale,
  sub,
  vec,
  type Vec2,
} from './vec';

/* ── World constants ──────────────────────────────────────────────────────── */

export const ARENA_WIDTH = 2200;
export const ARENA_HEIGHT = 1600;
export const WALL_MARGIN = 44;

/** Hostiles may not spawn within this radius of the player. */
const SPAWN_SAFE_RADIUS = 380;
/** Player collision radius. */
export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 235;
/** Acceleration factor toward the desired velocity, per second. */
const PLAYER_ACCELERATION = 14;
/** Milliseconds of invulnerability after taking a hit. */
const PLAYER_IFRAME_MS = 550;

const PROJECTILE_LIFETIME_MS = 2400;
const PICKUP_RADIUS = 18;
const HEALTH_PICKUP_AMOUNT = 28;
/** Reach of a contact attack, measured centre to centre. */
const CONTACT_REACH = 6;

/* ── Entity shapes ────────────────────────────────────────────────────────── */

export interface Enemy {
  id: number;
  archetype: EnemyArchetypeId;
  position: Vec2;
  velocity: Vec2;
  health: number;
  maxHealth: number;
  radius: number;
  speed: number;
  contactDamage: number;
  rangedDamage: number;
  stance: EnemyStance;
  /** Milliseconds until this hostile may attack again. */
  attackCooldownMs: number;
  /** Offset applied to the approach angle so a group spreads out. */
  approachOffset: number;
  /** Persistent personal engagement range after directive application. */
  preferredRange: number;
  /** Damage flash timer, for the renderer. */
  hitFlashMs: number;
  /** True once the death animation has begun. */
  dying: boolean;
  deathMs: number;
  /** Set for the boss: current phase, 1–3. */
  phase?: 1 | 2 | 3;
  isBoss: boolean;
  xpValue: number;
  scoreValue: number;
  /** Last known heading, used for rendering orientation. */
  facing: number;
}

export interface Projectile {
  id: number;
  owner: 'player' | 'enemy';
  position: Vec2;
  velocity: Vec2;
  damage: number;
  radius: number;
  /** Distance already travelled, for falloff. */
  travelled: number;
  lifetimeMs: number;
  /** Total distance after which damage is at its minimum. */
  effectiveRange: number;
  color: number;
  piercing: boolean;
  /** Ids already hit, so a piercing round cannot hit the same body twice. */
  hits: Set<number>;
}

export type PickupKind = 'health' | 'ammo';

export interface Pickup {
  id: number;
  kind: PickupKind;
  position: Vec2;
  /** Milliseconds the pickup remains before it is reclaimed. */
  ttlMs: number;
}

/* ── Events ───────────────────────────────────────────────────────────────── */

export type SimulationEvent =
  | { type: 'shot'; weapon: WeaponId; at: Vec2; angle: number; pellets: number }
  | { type: 'enemy_spawned'; enemyId: number; archetype: EnemyArchetypeId; at: Vec2; isBoss: boolean }
  | { type: 'enemy_hit'; enemyId: number; damage: number; at: Vec2; lethal: boolean }
  | { type: 'enemy_died'; enemyId: number; archetype: EnemyArchetypeId; at: Vec2; xp: number; score: number }
  | { type: 'player_hit'; damage: number; health: number }
  | { type: 'player_died' }
  | { type: 'reload_started'; weapon: WeaponId; durationMs: number }
  | { type: 'reload_finished'; weapon: WeaponId }
  | { type: 'weapon_switched'; weapon: WeaponId }
  | { type: 'pickup_collected'; kind: PickupKind; at: Vec2 }
  | { type: 'wave_started'; wave: number; label: string; isBossWave: boolean }
  | { type: 'wave_cleared'; wave: number; xp: number; score: number }
  | { type: 'adaptation_changed'; profile: string; profileName: string; confidence: number; reason: string }
  | { type: 'boss_phase'; phase: 1 | 2 | 3 }
  | { type: 'run_ended'; outcome: 'defeat' | 'victory'; wave: number };

export type SimulationEventListener = (event: SimulationEvent) => void;

export interface SimulationInput {
  /** Desired movement direction, already normalised to magnitude ≤ 1. */
  move: Vec2;
  /** Where the player is aiming, in world coordinates. */
  aim: Vec2 | null;
  /** True while the fire control is held. */
  firing: boolean;
}

export interface SimulationSnapshot {
  player: PlayerState;
  enemies: readonly Enemy[];
  projectiles: readonly Projectile[];
  pickups: readonly Pickup[];
  wave: WavePlan;
  waveNumber: number;
  enemiesRemaining: number;
  enemiesAlive: number;
  score: number;
  waveXp: number;
  waveScore: number;
  /** Milliseconds remaining in the intermission, or 0 while a wave is live. */
  intermissionRemainingMs: number;
  state: 'intermission' | 'active' | 'ended';
  outcome: 'defeat' | 'victory' | null;
  traits: BehaviourTraits;
  directive: TacticalDirective;
  adaptationEnabled: boolean;
  bossHealth: number | null;
  bossMaxHealth: number | null;
  bossPhase: 1 | 2 | 3 | null;
  /** Wall-clock-free elapsed run time in milliseconds. */
  elapsedMs: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  /** Total hostiles destroyed this run. */
  eliminations: number;
  /** True when THE EXECUTOR was destroyed this run. */
  bossDefeated: boolean;
  /** True when the adaptive director committed at least one tactical change. */
  adapted: boolean;
  /** Time in milliseconds the player has spent stationary. */
  idleMs: number;
}

export interface SimulationOptions {
  loadout: WeaponId[];
  seed?: number;
  adaptationEnabled?: boolean;
  /** Waves are configurable so tests can drive short runs. */
  maxWaves?: number;
}

/* ── Simulation ───────────────────────────────────────────────────────────── */

/**
 * The arena simulation.
 *
 * Deliberately free of Phaser, the DOM and the clock: it advances only by
 * explicit `step(dt)` calls. Phaser renders the snapshot and forwards input.
 * That separation is what makes combat, wave pacing and — most importantly —
 * the adaptive AI testable in a headless test run, and it is why the AI can be
 * proven to change behaviour rather than merely asserted to.
 */
export class CombatSimulation {
  readonly player: PlayerState;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private listeners = new Set<SimulationEventListener>();

  private readonly observer = new BehaviourObserver();
  private readonly director: TacticalDirector;
  private readonly rng: () => number;
  private readonly maxWaves: number;

  private waveNumber = 1;
  private wave: WavePlan;
  private spawnQueue: EnemyArchetypeId[] = [];
  private spawnTimerMs = 0;
  private intermissionRemainingMs = 0;
  private state: 'intermission' | 'active' | 'ended' = 'intermission';
  private outcome: 'defeat' | 'victory' | null = null;

  private score = 0;
  private waveXp = 0;
  private waveScore = 0;
  private elapsedMs = 0;
  private idleMs = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private damageDealt = 0;
  private eliminations = 0;
  /** Run-level facts the database cannot derive from counters alone. */
  private bossDefeated = false;
  private adapted = false;
  private iframeMs = 0;

  private nextId = 1;
  private adaptationTimerMs = 0;
  private traits: BehaviourTraits;

  constructor(options: SimulationOptions) {
    this.player = createPlayerState(options.loadout);
    this.director = new TacticalDirector(options.adaptationEnabled ?? true);
    this.maxWaves = options.maxWaves ?? Number.POSITIVE_INFINITY;
    this.rng = createSeededRandom(options.seed ?? Date.now());
    this.traits = this.observer.snapshot();
    this.wave = planWave(1);
    this.beginIntermission(1600);
  }

  /* ── Subscriptions ─────────────────────────────────────────────────────── */

  subscribe(listener: SimulationEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SimulationEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /* ── Wave control ──────────────────────────────────────────────────────── */

  private beginIntermission(durationMs: number): void {
    this.intermissionRemainingMs = Math.max(0, durationMs);
    this.state = this.intermissionRemainingMs > 0 ? 'intermission' : 'active';
    if (this.intermissionRemainingMs <= 0) this.startWave();
  }

  private startWave(): void {
    this.wave = planWave(this.waveNumber);
    this.spawnQueue = this.buildSpawnQueue(this.wave);
    this.spawnTimerMs = 0;
    this.state = 'active';
    this.emit({
      type: 'wave_started',
      wave: this.wave.wave,
      label: this.wave.label,
      isBossWave: this.wave.isBossWave,
    });
    if (this.wave.isBossWave) this.spawnBoss();
  }

  private buildSpawnQueue(plan: WavePlan): EnemyArchetypeId[] {
    const queue: EnemyArchetypeId[] = [];
    const directive = this.director.directive;
    for (let i = 0; i < plan.totalEnemies; i += 1) {
      queue.push(pickArchetype(plan.wave, this.rng, plan.allowedArchetypes));
    }
    // Apply the director's spawn bias by duplicating favoured archetypes, which
    // shifts the composition without ever removing a threat class entirely.
    const biased: EnemyArchetypeId[] = [];
    for (const id of queue) {
      const bias = directive.spawnBias[id] ?? 1;
      biased.push(id);
      if (bias > 1.15 && this.rng() < bias - 1) biased.push(id);
    }
    // Shuffle so a wave does not arrive in archetype order.
    for (let i = biased.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      [biased[i], biased[j]] = [biased[j]!, biased[i]!];
    }
    return biased;
  }

  /** Total hostiles still to defeat in the current wave (queued + alive). */
  private get remainingInWave(): number {
    const alive = this.enemies.filter((e) => !e.dying).length;
    return this.spawnQueue.length + alive;
  }

  /* ── Spawning ──────────────────────────────────────────────────────────── */

  private aliveEnemyCount(): number {
    return this.enemies.reduce((count, enemy) => (enemy.dying ? count : count + 1), 0);
  }

  private pickSpawnPosition(): Vec2 {
    // Rejection sampling: pick points on the arena perimeter until one is far
    // enough from the player. Never spawns on top of the player.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const edge = Math.floor(this.rng() * 4);
      const t = 0.08 + this.rng() * 0.84;
      let candidate: Vec2;
      switch (edge) {
        case 0:
          candidate = vec(t * ARENA_WIDTH, WALL_MARGIN);
          break;
        case 1:
          candidate = vec(t * ARENA_WIDTH, ARENA_HEIGHT - WALL_MARGIN);
          break;
        case 2:
          candidate = vec(WALL_MARGIN, t * ARENA_HEIGHT);
          break;
        default:
          candidate = vec(ARENA_WIDTH - WALL_MARGIN, t * ARENA_HEIGHT);
      }
      if (distance(candidate, this.playerPosition()) >= SPAWN_SAFE_RADIUS) return candidate;
    }
    // Deterministic fallback so spawning can never fail.
    return vec(WALL_MARGIN, WALL_MARGIN);
  }

  /** The player's authoritative world position. The simulation owns it; the
   * renderer only reads it. */
  private playerPositionRef: Vec2 = vec(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);

  private playerPosition(): Vec2 {
    return this.playerPositionRef;
  }

  setPlayerPosition(position: Vec2): void {
    this.playerPositionRef = { ...position };
  }

  private spawnEnemy(archetypeId: EnemyArchetypeId, position: Vec2, isBoss = false): Enemy {
    const archetype = getArchetype(archetypeId);
    const scaled = scaleForWave(archetype, this.waveNumber);
    const applied = applyDirective(archetypeId, this.director.directive);

    const enemy: Enemy = {
      id: this.nextId++,
      archetype: archetypeId,
      position: { ...position },
      velocity: vec(),
      health: isBoss ? archetype.maxHealth : scaled.health,
      maxHealth: isBoss ? archetype.maxHealth : scaled.health,
      radius: archetype.radius,
      speed: isBoss ? archetype.speed : scaled.speed,
      contactDamage: isBoss ? archetype.contactDamage : scaled.contactDamage,
      rangedDamage: isBoss ? archetype.rangedDamage : scaled.rangedDamage,
      stance: applied.stance,
      attackCooldownMs: isBoss ? 1200 : Math.floor(this.rng() * archetype.attackCooldownMs),
      approachOffset: this.rng() * Math.PI * 2,
      preferredRange: applied.preferredRange,
      hitFlashMs: 0,
      dying: false,
      deathMs: 0,
      isBoss,
      xpValue: archetype.xpValue,
      scoreValue: archetype.scoreValue,
      facing: 0,
      ...(isBoss ? { phase: 1 as const } : {}),
    };
    this.enemies.push(enemy);
    this.emit({
      type: 'enemy_spawned',
      enemyId: enemy.id,
      archetype: archetypeId,
      at: { ...position },
      isBoss,
    });
    return enemy;
  }

  private spawnBoss(): void {
    // The boss enters from the far edge so its arrival is visible.
    const position = vec(ARENA_WIDTH / 2, WALL_MARGIN + 120);
    this.spawnEnemy('executor', position, true);
  }

  /* ── Main step ─────────────────────────────────────────────────────────── */

  step(dtMs: number, input: SimulationInput): void {
    const dt = Math.min(dtMs, 100) / 1000;
    if (this.state === 'ended') return;

    this.elapsedMs += dtMs;
    if (this.iframeMs > 0) this.iframeMs = Math.max(0, this.iframeMs - dtMs);

    this.updatePlayerMovement(dt, input);
    this.updateAimingAndFiring(dt, dtMs, input);
    updatePlayer(this.player, dtMs);

    if (!this.player.alive) {
      this.endRun('defeat');
      return;
    }

    this.updateWaveState(dtMs);
    this.updateEnemies(dt, dtMs);
    this.updateProjectiles(dt, dtMs);
    this.updatePickups(dtMs);
    this.observePlayer(dtMs, input);
    this.updateAdaptation(dtMs);

    this.enemies = this.enemies.filter((enemy) => !enemy.dying || enemy.deathMs < 900);
    for (const enemy of this.enemies) {
      if (enemy.hitFlashMs > 0) enemy.hitFlashMs = Math.max(0, enemy.hitFlashMs - dtMs);
      if (enemy.dying) enemy.deathMs += dtMs;
    }
  }

  /* ── Player ────────────────────────────────────────────────────────────── */

  /** Current player velocity, integrated from input. Kept separate from the
   * position so acceleration is frame-rate independent and the movement feel is
   * consistent across refresh rates. */
  private playerVelocity: Vec2 = vec();

  private updatePlayerMovement(dt: number, input: SimulationInput): void {
    const desired = clampMagnitude(input.move, 1);
    const target = scale(desired, PLAYER_SPEED);
    const position = this.playerPositionRef;

    // Exponential approach: the fraction of the remaining gap closed this frame
    // depends only on elapsed time, so 30fps and 144fps feel identical.
    const blend = 1 - Math.exp(-PLAYER_ACCELERATION * dt);
    this.playerVelocity = {
      x: this.playerVelocity.x + (target.x - this.playerVelocity.x) * blend,
      y: this.playerVelocity.y + (target.y - this.playerVelocity.y) * blend,
    };

    const next = {
      x: position.x + this.playerVelocity.x * dt,
      y: position.y + this.playerVelocity.y * dt,
    };

    const clampedX = clamp(next.x, WALL_MARGIN + PLAYER_RADIUS, ARENA_WIDTH - WALL_MARGIN - PLAYER_RADIUS);
    const clampedY = clamp(next.y, WALL_MARGIN + PLAYER_RADIUS, ARENA_HEIGHT - WALL_MARGIN - PLAYER_RADIUS);
    this.playerPositionRef = vec(clampedX, clampedY);
  }

  private playerFacing = 0;

  private updateAimingAndFiring(_dt: number, _dtMs: number, input: SimulationInput): void {
    const position = this.playerPositionRef;

    if (input.aim) {
      this.playerFacing = angleOf(sub(input.aim, position));
    } else if (Math.hypot(input.move.x, input.move.y) > 0.05) {
      // No aim input (keyboard player not moving the mouse, or a touch player
      // holding only the movement stick): face the direction of travel.
      this.playerFacing = angleOf(input.move);
    }

    if (!input.firing) return;
    const spec = currentWeaponSpec(this.player);
    if (!canFire(this.player)) return;

    const result = fire(this.player);
    if (!result.fired) return;

    this.shotsFired += 1;
    this.firedThisFrame = true;
    this.emit({
      type: 'shot',
      weapon: spec.id,
      at: { ...position },
      angle: this.playerFacing,
      pellets: result.pellets,
    });

    // Spread is applied per pellet; a single-pellet weapon still gets its
    // nominal spread so accuracy is never perfect.
    const totalSpread = (spec.spreadDeg * Math.PI) / 180;
    for (let i = 0; i < result.pellets; i += 1) {
      const offset =
        result.pellets === 1
          ? (this.rng() - 0.5) * totalSpread
          : totalSpread * (i / (result.pellets - 1) - 0.5) + (this.rng() - 0.5) * totalSpread * 0.18;
      const angle = this.playerFacing + offset;
      this.projectiles.push({
        id: this.nextId++,
        owner: 'player',
        position: add(position, fromAngle(angle, PLAYER_RADIUS + 6)),
        velocity: fromAngle(angle, spec.projectileSpeed),
        damage: spec.damage,
        radius: spec.projectileRadius,
        travelled: 0,
        lifetimeMs: PROJECTILE_LIFETIME_MS,
        effectiveRange: spec.rangePx,
        color: spec.tracerColor,
        piercing: spec.id === 'sniper',
        hits: new Set<number>(),
      });
    }
  }

  private observePlayer(dtMs: number, input: SimulationInput): void {
    const speed = Math.hypot(input.move.x, input.move.y) * PLAYER_SPEED;
    const nearest = this.nearestEnemyDistance();
    if (speed < 12) this.idleMs += dtMs;

    this.traits = this.observer.observe({
      dtMs,
      speed,
      nearestEnemyDistance: nearest,
      didFire: this.firedThisFrame,
      didReload: this.reloadStartedThisFrame,
      heading: this.playerFacing,
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
    });
    this.firedThisFrame = false;
    this.reloadStartedThisFrame = false;
  }

  private firedThisFrame = false;
  private reloadStartedThisFrame = false;

  private nearestEnemyDistance(): number {
    let best = Number.POSITIVE_INFINITY;
    const position = this.playerPositionRef;
    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      const d = distance(position, enemy.position);
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : 600;
  }

  /* ── Adaptation ────────────────────────────────────────────────────────── */

  private updateAdaptation(dtMs: number): void {
    // Reassess roughly once per second: adaptation should be observable, not
    // reactive to individual frames.
    this.adaptationTimerMs += dtMs;
    if (this.adaptationTimerMs < 1000) return;
    this.adaptationTimerMs = 0;

    const before = this.director.directive.profile.id;
    const directive = this.director.update(this.traits, this.elapsedMs);
    if (directive.profile.id !== before) {
      this.adapted = true;
      const last = this.director.adaptationHistory[this.director.adaptationHistory.length - 1];
      this.emit({
        type: 'adaptation_changed',
        profile: directive.profile.id,
        profileName: directive.profile.name,
        confidence: directive.profile.confidence,
        reason: last?.reason ?? '',
      });
    }
    this.applyDirectiveToEnemies();
  }

  /** Re-derives each living hostile's tactics from the current directive. */
  private applyDirectiveToEnemies(): void {
    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      const applied = applyDirective(enemy.archetype, this.director.directive);
      enemy.stance = applied.stance;
      // Boss phases own their own stance, so adaptation never overrides them.
      if (enemy.isBoss) enemy.stance = this.bossStanceForPhase(enemy.phase ?? 1);
      enemy.preferredRange = enemy.isBoss
        ? getArchetype(enemy.archetype).preferredRange
        : applied.preferredRange;
    }
  }

  /* ── Waves ─────────────────────────────────────────────────────────────── */

  private updateWaveState(dtMs: number): void {
    if (this.state === 'intermission') {
      this.intermissionRemainingMs -= dtMs;
      if (this.intermissionRemainingMs <= 0) {
        this.intermissionRemainingMs = 0;
        if (this.waveNumber > this.maxWaves) {
          this.endRun('victory');
          return;
        }
        this.startWave();
      }
      return;
    }

    // Spawn while the queue has entries and concurrency allows it.
    if (this.spawnQueue.length > 0) {
      this.spawnTimerMs -= dtMs;
      if (this.spawnTimerMs <= 0 && this.aliveEnemyCount() < this.wave.maxConcurrent) {
        const archetypeId = this.spawnQueue.shift();
        if (archetypeId) this.spawnEnemy(archetypeId, this.pickSpawnPosition());
        this.spawnTimerMs = this.wave.spawnIntervalMs;
      }
    }

    // Wave complete when nothing is queued and nothing lives.
    if (this.spawnQueue.length === 0 && this.aliveEnemyCount() === 0) {
      const reward = waveClearReward(this.waveNumber);
      this.waveXp += reward.xp;
      this.waveScore += reward.score;
      this.score += reward.score;
      this.emit({ type: 'wave_cleared', wave: this.waveNumber, xp: reward.xp, score: reward.score });

      this.waveNumber += 1;
      if (this.waveNumber > this.maxWaves) {
        this.endRun('victory');
        return;
      }
      this.beginIntermission(planWave(this.waveNumber).intermissionMs);
    }
  }

  private endRun(outcome: 'defeat' | 'victory'): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.outcome = outcome;
    if (outcome === 'defeat') this.emit({ type: 'player_died' });
    this.emit({ type: 'run_ended', outcome, wave: Math.max(1, this.waveNumber) });
  }

  /* ── Enemy AI ──────────────────────────────────────────────────────────── */

  private bossStanceForPhase(phase: 1 | 2 | 3): EnemyStance {
    switch (phase) {
      case 1:
        return 'hold';
      case 2:
        return 'approach';
      default:
        return 'reposition';
    }
  }

  private updateEnemies(dt: number, dtMs: number): void {
    const playerPos = this.playerPositionRef;

    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      if (enemy.attackCooldownMs > 0) enemy.attackCooldownMs -= dtMs;

      if (enemy.isBoss) {
        this.updateBoss(enemy, dt, playerPos);
        continue;
      }

      const toPlayer = sub(playerPos, enemy.position);
      const dist = Math.max(1, Math.hypot(toPlayer.x, toPlayer.y));
      const direction = scale(toPlayer, 1 / dist);
      enemy.facing = angleOf(toPlayer);

      // `encircle` uses approachOffset so a group spreads into an arc rather
      // than stacking into a single-file queue.
      let desired: Vec2 = vec();

      switch (enemy.stance) {
        case 'approach':
          desired = direction;
          break;
        case 'hold': {
          const error = dist - enemy.preferredRange;
          if (Math.abs(error) > 24) desired = scale(direction, Math.sign(error));
          break;
        }
        case 'retreat':
          desired = scale(direction, -1);
          break;
        case 'reposition': {
          // Strafe perpendicular, correcting range gently.
          const perpendicular = vec(-direction.y, direction.x);
          const error = dist - enemy.preferredRange;
          desired = add(scale(perpendicular, 1), scale(direction, clamp(error / 200, -1, 1)));
          break;
        }
        case 'encircle': {
          // Approach along an arc offset, tightening as the distance closes.
          const arc = enemy.approachOffset;
          const tangent = vec(-direction.y, direction.x);
          const inward = clamp((dist - enemy.preferredRange) / 260, -0.4, 1);
          desired = add(scale(direction, inward), scale(tangent, Math.sin(arc) * 0.9));
          break;
        }
      }

      const speed = enemy.speed * (1 + this.director.directive.pressure * 0.15);
      const desiredVelocity = scale(normalise(desired), speed);
      const blend = 1 - Math.exp(-9 * dt);
      enemy.velocity = {
        x: enemy.velocity.x + (desiredVelocity.x - enemy.velocity.x) * blend,
        y: enemy.velocity.y + (desiredVelocity.y - enemy.velocity.y) * blend,
      };

      enemy.position = vec(
        clamp(enemy.position.x + enemy.velocity.x * dt, WALL_MARGIN, ARENA_WIDTH - WALL_MARGIN),
        clamp(enemy.position.y + enemy.velocity.y * dt, WALL_MARGIN, ARENA_HEIGHT - WALL_MARGIN),
      );

      this.resolveEnemySeparation(enemy);
      this.enemyAttack(enemy, dist);
    }
  }

  /** Keeps hostiles from stacking into a single point. */
  private resolveEnemySeparation(enemy: Enemy): void {
    for (const other of this.enemies) {
      if (other === enemy || other.dying) continue;
      const dx = other.position.x - enemy.position.x;
      const dy = other.position.y - enemy.position.y;
      const minDistance = enemy.radius + other.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistance * minDistance || distSq === 0) continue;
      const dist = Math.sqrt(distSq);
      const push = (minDistance - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;
      enemy.position = vec(enemy.position.x - nx * push, enemy.position.y - ny * push);
      other.position = vec(other.position.x + nx * push, other.position.y + ny * push);
    }
  }

  private enemyAttack(enemy: Enemy, dist: number): void {
    if (enemy.attackCooldownMs > 0) return;
    const archetype = getArchetype(enemy.archetype);

    // Melee: only when genuinely touching the player.
    if (dist <= enemy.radius + PLAYER_RADIUS + CONTACT_REACH) {
      this.damagePlayer(enemy.contactDamage);
      enemy.attackCooldownMs = archetype.attackCooldownMs;
      return;
    }

    // Ranged: only inside the archetype's ranged envelope, and only when the
    // hostile is not mid-approach (so shots read as deliberate).
    if (archetype.rangedDamage > 0 && dist <= archetype.rangedRange && dist > 80) {
      const direction = normalise(sub(this.playerPositionRef, enemy.position));
      const spread = (2.4 * Math.PI) / 180;
      const angle = angleOf(direction) + (this.rng() - 0.5) * spread;
      this.projectiles.push({
        id: this.nextId++,
        owner: 'enemy',
        position: add(enemy.position, fromAngle(angle, enemy.radius + 4)),
        velocity: fromAngle(angle, archetype.rangedSpeed),
        damage: enemy.rangedDamage,
        radius: 4,
        travelled: 0,
        lifetimeMs: PROJECTILE_LIFETIME_MS,
        effectiveRange: archetype.rangedRange * 1.3,
        color: 0xff7a6a,
        piercing: false,
        hits: new Set<number>(),
      });
      enemy.attackCooldownMs = archetype.attackCooldownMs;
    }
  }

  private damagePlayer(amount: number): void {
    if (this.iframeMs > 0 || !this.player.alive) return;
    const lethal = damagePlayer(this.player, amount);
    this.iframeMs = PLAYER_IFRAME_MS;
    this.emit({ type: 'player_hit', damage: amount, health: this.player.health });
    if (lethal) this.emit({ type: 'player_died' });
  }

  /* ── Boss ──────────────────────────────────────────────────────────────── */

  private updateBoss(enemy: Enemy, dt: number, playerPos: Vec2): void {
    const ratio = enemy.health / enemy.maxHealth;
    const nextPhase: 1 | 2 | 3 = ratio > 0.62 ? 1 : ratio > 0.3 ? 2 : 3;
    if (nextPhase !== enemy.phase) {
      enemy.phase = nextPhase;
      enemy.stance = this.bossStanceForPhase(nextPhase);
      enemy.attackCooldownMs = 400;
      this.emit({ type: 'boss_phase', phase: nextPhase });
    }

    const toPlayer = sub(playerPos, enemy.position);
    const dist = Math.max(1, Math.hypot(toPlayer.x, toPlayer.y));
    const direction = scale(toPlayer, 1 / dist);
    enemy.facing = angleOf(toPlayer);

    const phase = enemy.phase ?? 1;
    // Phase 1 keeps its distance and fires; phase 2 pursues relentlessly;
    // phase 3 closes, fires area bursts and repositions between them.
    const preferred = phase === 1 ? 320 : phase === 2 ? 90 : 200;
    const speedMultiplier = phase === 1 ? 0.8 : phase === 2 ? 1.25 : 1;

    const error = dist - preferred;
    const radial = Math.abs(error) > 30 ? scale(direction, Math.sign(error)) : vec();
    const tangent = phase === 3 ? scale(vec(-direction.y, direction.x), 0.7) : vec();
    const desired = normalise(add(radial, tangent));

    const speed = enemy.speed * speedMultiplier;
    const desiredVelocity = scale(desired, speed);
    const blend = 1 - Math.exp(-6 * dt);
    enemy.velocity = {
      x: enemy.velocity.x + (desiredVelocity.x - enemy.velocity.x) * blend,
      y: enemy.velocity.y + (desiredVelocity.y - enemy.velocity.y) * blend,
    };
    enemy.position = vec(
      clamp(enemy.position.x + enemy.velocity.x * dt, WALL_MARGIN, ARENA_WIDTH - WALL_MARGIN),
      clamp(enemy.position.y + enemy.velocity.y * dt, WALL_MARGIN, ARENA_HEIGHT - WALL_MARGIN),
    );

    if (enemy.attackCooldownMs > 0) return;

    if (phase === 1) {
      // Three-round volley.
      for (let i = -1; i <= 1; i += 1) {
        const angle = angleOf(direction) + i * 0.16;
        this.spawnBossProjectile(enemy, angle, enemy.rangedDamage, 640);
      }
      enemy.attackCooldownMs = 1250;
    } else if (phase === 2) {
      if (dist <= enemy.radius + PLAYER_RADIUS + 16) {
        this.damagePlayer(enemy.contactDamage);
        enemy.attackCooldownMs = 800;
      } else {
        this.spawnBossProjectile(enemy, angleOf(direction), enemy.rangedDamage * 0.8, 700);
        enemy.attackCooldownMs = 900;
      }
    } else {
      // Radial burst: the area attack. Deliberately telegraphed by the cooldown.
      const count = 14;
      const base = angleOf(direction);
      for (let i = 0; i < count; i += 1) {
        const angle = base + (i / count) * Math.PI * 2;
        this.spawnBossProjectile(enemy, angle, enemy.rangedDamage * 0.7, 480);
      }
      enemy.attackCooldownMs = 2100;
    }
  }

  private spawnBossProjectile(enemy: Enemy, angle: number, damage: number, speed: number): void {
    this.projectiles.push({
      id: this.nextId++,
      owner: 'enemy',
      position: add(enemy.position, fromAngle(angle, enemy.radius + 6)),
      velocity: fromAngle(angle, speed),
      damage,
      radius: 6,
      travelled: 0,
      lifetimeMs: PROJECTILE_LIFETIME_MS,
      effectiveRange: 900,
      color: 0xffb347,
      piercing: false,
      hits: new Set<number>(),
    });
  }

  /* ── Projectiles ───────────────────────────────────────────────────────── */

  private updateProjectiles(dt: number, dtMs: number): void {
    const survivors: Projectile[] = [];

    for (const projectile of this.projectiles) {
      projectile.lifetimeMs -= dtMs;
      const step = scale(projectile.velocity, dt);
      projectile.position = add(projectile.position, step);
      projectile.travelled += Math.hypot(step.x, step.y);

      const expired =
        projectile.lifetimeMs <= 0 ||
        projectile.travelled > projectile.effectiveRange * 1.5 ||
        projectile.position.x < WALL_MARGIN ||
        projectile.position.x > ARENA_WIDTH - WALL_MARGIN ||
        projectile.position.y < WALL_MARGIN ||
        projectile.position.y > ARENA_HEIGHT - WALL_MARGIN;

      if (expired) continue;

      if (projectile.owner === 'player') {
        if (this.resolvePlayerProjectile(projectile)) continue;
      } else if (this.resolveEnemyProjectile(projectile)) {
        continue;
      }

      survivors.push(projectile);
    }

    this.projectiles = survivors;
  }

  /** Returns true when the projectile should be removed. */
  private resolvePlayerProjectile(projectile: Projectile): boolean {
    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      if (projectile.hits.has(enemy.id)) continue;
      const reach = enemy.radius + projectile.radius;
      if (distanceSq(projectile.position, enemy.position) > reach * reach) continue;

      const damage = damageAtDistance(
        { ...currentWeaponSpec(this.player), damage: projectile.damage },
        projectile.travelled,
      );
      const lethal = this.damageEnemy(enemy, damage, projectile.position);
      projectile.hits.add(enemy.id);
      if (!projectile.piercing) return true;
      if (lethal) continue;
    }
    return false;
  }

  /** Returns true when the projectile should be removed. */
  private resolveEnemyProjectile(projectile: Projectile): boolean {
    const reach = PLAYER_RADIUS + projectile.radius;
    if (distanceSq(projectile.position, this.playerPositionRef) > reach * reach) return false;
    this.damagePlayer(projectile.damage);
    return true;
  }

  private damageEnemy(enemy: Enemy, damage: number, at: Vec2): boolean {
    if (enemy.dying) return false;
    enemy.health = Math.max(0, enemy.health - damage);
    enemy.hitFlashMs = 90;
    this.damageDealt += damage;
    this.shotsHit += 1;

    const lethal = enemy.health === 0;
    this.emit({ type: 'enemy_hit', enemyId: enemy.id, damage, at: { ...at }, lethal });

    if (lethal) {
      enemy.dying = true;
      enemy.deathMs = 0;
      this.eliminations += 1;
      this.score += enemy.scoreValue;
      this.waveScore += enemy.scoreValue;
      this.waveXp += enemy.xpValue;
      this.emit({
        type: 'enemy_died',
        enemyId: enemy.id,
        archetype: enemy.archetype,
        at: { ...enemy.position },
        xp: enemy.xpValue,
        score: enemy.scoreValue,
      });
      if (enemy.isBoss) {
        this.bossDefeated = true;
        this.pickups.push({
          id: this.nextId++,
          kind: 'health',
          position: { ...enemy.position },
          ttlMs: 30000,
        });
      } else {
        this.maybeDropPickup(enemy.position);
      }
    }
    return lethal;
  }

  private maybeDropPickup(position: Vec2): void {
    if (this.rng() < pickupChance(this.waveNumber, 'health')) {
      this.pickups.push({ id: this.nextId++, kind: 'health', position: { ...position }, ttlMs: 22000 });
      return;
    }
    if (this.rng() < pickupChance(this.waveNumber, 'ammo')) {
      this.pickups.push({ id: this.nextId++, kind: 'ammo', position: { ...position }, ttlMs: 22000 });
    }
  }

  /* ── Pickups ───────────────────────────────────────────────────────────── */

  private updatePickups(dtMs: number): void {
    const survivors: Pickup[] = [];
    for (const pickup of this.pickups) {
      pickup.ttlMs -= dtMs;
      if (pickup.ttlMs <= 0) continue;
      const reach = PLAYER_RADIUS + PICKUP_RADIUS;
      if (distanceSq(pickup.position, this.playerPositionRef) <= reach * reach) {
        if (pickup.kind === 'health') healPlayer(this.player, HEALTH_PICKUP_AMOUNT);
        else grantAmmo(this.player);
        this.emit({ type: 'pickup_collected', kind: pickup.kind, at: { ...pickup.position } });
        continue;
      }
      survivors.push(pickup);
    }
    this.pickups = survivors;
  }

  /* ── Public control surface ────────────────────────────────────────────── */

  requestReload(): boolean {
    if (!this.player.alive) return false;
    // Imported lazily to keep the module graph flat.
    const outcome = beginReload(this.player);
    if (outcome.started) {
      this.reloadStartedThisFrame = true;
      this.emit({ type: 'reload_started', weapon: this.player.weapon, durationMs: outcome.durationMs });
    }
    return outcome.started;
  }

  switchTo(weapon: WeaponId): boolean {
    const changed = switchWeapon(this.player, weapon);
    if (changed) this.emit({ type: 'weapon_switched', weapon });
    return changed;
  }

  cycleWeapon(direction: 1 | -1 = 1): void {
    const available = this.player.loadout;
    const next =
      direction === 1
        ? nextWeapon(this.player.weapon, available)
        : previousWeapon(this.player.weapon, available);
    this.switchTo(next);
  }

  setAdaptationEnabled(enabled: boolean): void {
    this.director.setEnabled(enabled, this.elapsedMs);
    this.applyDirectiveToEnemies();
  }

  get adaptationEnabled(): boolean {
    return this.director.isEnabled;
  }

  /** Notifies the simulation that a reload finished, so the observer can see it. */
  notifyReloadFinished(): void {
    this.emit({ type: 'reload_finished', weapon: this.player.weapon });
  }

  get isEnded(): boolean {
    return this.state === 'ended';
  }

  snapshot(): SimulationSnapshot {
    const boss = this.enemies.find((enemy) => enemy.isBoss && !enemy.dying);
    return {
      player: this.player,
      enemies: this.enemies,
      projectiles: this.projectiles,
      pickups: this.pickups,
      wave: this.wave,
      waveNumber: this.waveNumber,
      enemiesRemaining: this.remainingInWave,
      enemiesAlive: this.aliveEnemyCount(),
      score: this.score,
      waveXp: this.waveXp,
      waveScore: this.waveScore,
      intermissionRemainingMs: this.intermissionRemainingMs,
      state: this.state,
      outcome: this.outcome,
      traits: this.traits,
      directive: this.director.directive,
      adaptationEnabled: this.director.isEnabled,
      bossHealth: boss?.health ?? null,
      bossMaxHealth: boss?.maxHealth ?? null,
      bossPhase: boss ? (boss.phase ?? 1) : null,
      elapsedMs: this.elapsedMs,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      damageDealt: this.damageDealt,
      eliminations: this.eliminations,
      bossDefeated: this.bossDefeated,
      adapted: this.adapted,
      idleMs: this.idleMs,
    };
  }

  /** The player's world position, for the renderer. */
  get playerPos(): Vec2 {
    return { ...this.playerPositionRef };
  }

  get facing(): number {
    return this.playerFacing;
  }

  get directorRef(): TacticalDirector {
    return this.director;
  }

  get observerRef(): BehaviourObserver {
    return this.observer;
  }
}

/** Seeded xorshift PRNG so a run can be reproduced exactly in a test. */
export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export { neutralDirective };
