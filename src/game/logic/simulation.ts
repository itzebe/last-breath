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
  setMagazineCapacity,
  switchWeapon,
  updatePlayer,
  type PlayerState,
} from './player';
import {
  damageAtDistance,
  getWeapon,
  nextWeapon,
  previousWeapon,
  type WeaponId,
} from './weapons';
import { eligibleArchetypes, pickupChance, planWave, waveClearReward, type WavePlan } from './waves';
import {
  BOSS_ATTACKS,
  BOSS_PHASE_TRANSITION_MS,
  bossStanceForPhase,
  chooseBossAttack,
  nextBossPhase,
  type BossAttackKind,
} from './boss';
import {
  DEATHMATCH_RULES,
  createDeathmatchState,
  recordPlayerDeath,
  recordPlayerElimination,
  tickDeathmatch,
  type DeathmatchRules,
  type DeathmatchState,
} from './deathmatch';
import {
  add,
  angleOf,
  clamp,
  clampMagnitude,
  distance,
  distanceSq,
  distanceToSegment,
  fromAngle,
  normalise,
  scale,
  sub,
  vec,
  type Vec2,
} from './vec';
import {
  ARENA_OBSTACLES,
  avoidObstacles,
  circleOverlapsObstacle,
  coverValueAt,
  findCover,
  firstObstacleAlong,
  hasLineOfSight,
  resolveCircleAgainstObstacles,
  type Obstacle,
} from './obstacles';
import {
  MEMORY_MS,
  REVIVE_CHANNEL_MS,
  REVIVE_HEALTH_FRACTION,
  ROLE_FOR_ARCHETYPE,
  SNIPER_CHARGE_MS,
  GUNFIRE_HEARING_RADIUS,
  SQUAD_MIN_SIZE,
  applySuppression,
  canBeginSniperCharge,
  canSeePlayer,
  COVER_COMMIT_THRESHOLD,
  clusterSquads,
  coarseHuntTarget,
  coverUrgency,
  createAwareness,
  electCommander,
  findReviveTarget,
  isSearching,
  movementForRole,
  shouldCallReinforcements,
  shouldReload,
  squadFocusAngles,
  squadTarget,
  updateAwareness,
  type Awareness,
  type SquadMember,
  type TacticalRole,
} from './tactics';
import {
  BASE_MODIFIERS,
  modifiersFor,
  rollUpgradeOffer,
  type RunModifiers,
  type UpgradeId,
} from './upgrades';
import {
  LAST_EXIT,
  MISSIONS,
  createMissionState,
  currentEncounter,
  currentObjective,
  failMission,
  objectiveInstruction,
  objectiveProgress,
  tickMission,
  type Mission,
  type MissionState,
} from './operations';

/* ── World constants ──────────────────────────────────────────────────────── */

/** Which arena ruleset is running. The services layer has its own identical
 * `MatchMode`; the game logic keeps a local copy so it never depends upward. */
export type ArenaMode = 'survival' | 'deathmatch' | 'operations';


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

/* ── Dodge ────────────────────────────────────────────────────────────────── */

/** Duration of a dodge roll, in milliseconds. */
export const DODGE_DURATION_MS = 340;
/** Milliseconds before another roll is permitted, before upgrade modifiers. */
export const DODGE_COOLDOWN_MS = 1500;
/** Distance covered by a full roll. */
export const DODGE_DISTANCE = 190;
/**
 * Damage is avoided for this fraction of the roll — the *start*, not the whole
 * roll. Rolling has to be a read, not a free pass: a player who rolls a beat too
 * early still gets hit, which is what keeps the mechanic skilful.
 */
export const DODGE_INVULN_FRACTION = 0.7;

/* ── Grenades ─────────────────────────────────────────────────────────────── */

/** Grenades carried per run, before any upgrade. */
export const GRENADE_COUNT = 3;
/** Milliseconds from throw to detonation. This is the whole fairness window. */
export const GRENADE_FUSE_MS = 1300;
/** Milliseconds before another grenade may be thrown. */
export const GRENADE_COOLDOWN_MS = 900;
/** Blast radius in arena units, before upgrade modifiers. */
export const GRENADE_RADIUS = 190;
/** Damage at the centre of the blast; falls linearly to zero at the edge. */
export const GRENADE_DAMAGE = 130;
/** Throw distance at a full charge. */
export const GRENADE_THROW_RANGE = 460;

/* ── Weak points ──────────────────────────────────────────────────────────── */

/** Base chance of a weak-point hit with no upgrade taken. */
export const BASE_CRIT_CHANCE = 0.05;
/** Damage multiplier applied on a weak-point hit. */
export const CRIT_DAMAGE_MULTIPLIER = 3;

/* ── Combo ────────────────────────────────────────────────────────────────── */

/** Milliseconds after a kill in which the next kill continues the streak. */
export const COMBO_WINDOW_MS = 3500;
/** Score multiplier added per combo step, capped. */
export const COMBO_SCORE_STEP = 0.12;
/** The highest score multiplier a streak can reach. */
export const MAX_COMBO_MULTIPLIER = 3;

const PROJECTILE_LIFETIME_MS = 2400;
const PICKUP_RADIUS = 18;
const HEALTH_PICKUP_AMOUNT = 28;
/** Reach of a contact attack, measured centre to centre. */
const CONTACT_REACH = 6;
/** Rounds a hostile carries before it must reload. Deliberately small so reload
 * windows are a real, exploitable part of every firefight. */
const ENEMY_MAGAZINE = 8;
/** Milliseconds a hostile spends reloading. */
const ENEMY_RELOAD_MS = 1500;
/** Damage a near miss does to a hostile's composure, in suppression terms. */
const SUPPRESSION_NEAR_MISS_RADIUS = 46;
/** How long a downed hostile stays revivable by a medic. */
const REVIVE_WINDOW_MS = 8000;

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
  /** Boss: milliseconds of wind-up remaining before the pending attack lands.
   * Zero means no attack is charging. This is the telegraph the player reads. */
  telegraphMs?: number;
  /** Boss: the attack currently winding up, or null when idle. */
  pendingAttack?: BossAttackKind | null;
  /** Boss: milliseconds remaining in the phase-transition break. */
  phaseTransitionMs?: number;
  /** Boss: rotates the pattern so consecutive attacks are not identical. */
  attackIndex?: number;
  /** Deathmatch: this hostile is an AI opponent, not a survival hostile. The
   * renderer labels them, and only opponents count toward the match score. */
  isOpponent?: boolean;
  isBoss: boolean;
  xpValue: number;
  scoreValue: number;
  /** Last known heading, used for rendering orientation. */
  facing: number;

  /* ── Tactical AI (Part 3) ─────────────────────────────────────────────── */

  /** What this hostile is trying to do, derived from its archetype. */
  role: TacticalRole;
  /** What it currently believes about the player. Never the true position
   * unless it can see them — see `tactics.ts`. */
  awareness: Awareness;
  /** Milliseconds of suppression remaining. Suppressed hostiles break for cover. */
  suppressionMs: number;
  /** Set when this hostile is the elected commander of its squad. */
  isCommander: boolean;
  /** The squad this hostile belongs to this frame, for coordination. */
  squadId: number;
  /** Milliseconds until this hostile may call reinforcements again. */
  reinforcementCooldownMs: number;
  /** How many times this commander has called reinforcements. */
  reinforcementsCalled: number;
  /** Where this hostile is moving to for cover, or null. */
  coverTarget: Vec2 | null;
  /** Milliseconds remaining on a sniper's visible aim charge, or 0. */
  chargeMs: number;
  /** The direction a charging sniper has locked in. Firing uses this, so moving
   * during the telegraph genuinely avoids the shot. */
  chargeDirection: number;
  /** Rounds left before this hostile must reload. */
  ammoInMagazine: number;
  /** Magazine capacity, copied from the archetype at spawn. */
  magazine: number;
  /** Milliseconds remaining in a hostile reload, or 0. */
  reloadRemainingMs: number;
  /** Id of the ally this medic is currently reviving, or null. */
  reviveTargetId: number | null;
  /** Milliseconds of revive channel accumulated on `reviveTargetId`. */
  reviveProgressMs: number;
  /** True once this hostile has been killed and is being revived. */
  downed?: boolean;
  /** Milliseconds a downed hostile remains revivable before it is gone for good. */
  downedMs?: number;
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
  /** True when this round was a weak-point strike. Drives the hit feedback. */
  critical?: boolean;
}

/** A thrown grenade, in flight or waiting out its fuse. */
export interface Grenade {
  id: number;
  position: Vec2;
  /** Velocity at the moment of the throw; decays to zero (it is thrown, not fired). */
  velocity: Vec2;
  /** Milliseconds until detonation. */
  fuseMs: number;
  /** Blast radius, already including upgrade modifiers. */
  radius: number;
  damage: number;
  /** True for a detonation triggered by a frag round rather than a throw. */
  fromFrag: boolean;
}

export type PickupKind = 'health' | 'ammo';

// The Executor's attack catalogue, phase thresholds and decision functions live
// in a pure module so they can be unit-tested without a live fight. Re-exported
// here so existing imports keep working.
export {
  BOSS_ATTACKS,
  BOSS_PHASE_THRESHOLDS,
  BOSS_PHASE_TRANSITION_MS,
  bossPhaseForHealth,
  bossStanceForPhase,
  chooseBossAttack,
  nextBossPhase,
} from './boss';
export type { BossAttackKind, BossAttackSpec, BossPhase } from './boss';

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
  | { type: 'boss_phase'; phase: 1 | 2 | 3; from: 1 | 2 | 3 }
  /** Fired the instant a boss attack leaves the telegraph and deals its damage. */
  | { type: 'boss_attack'; attack: BossAttackKind; at: Vec2 }
  /** Deathmatch: the match clock has started after the countdown. */
  | { type: 'match_started' }
  /** Deathmatch: an AI opponent was eliminated by the player. */
  | { type: 'opponent_eliminated'; total: number }
  /** Deathmatch: the player re-entered after being downed. */
  | { type: 'player_respawned' }
  /** The player began a dodge roll. */
  | { type: 'dodge'; at: Vec2; angle: number }
  /** A grenade was thrown. */
  | { type: 'grenade_thrown'; at: Vec2; target: Vec2 }
  /** A grenade detonated. `hits` is how many hostiles it damaged. */
  | { type: 'grenade_exploded'; at: Vec2; radius: number; hits: number }
  /** A weak-point strike landed. */
  | { type: 'critical_hit'; enemyId: number; at: Vec2; damage: number }
  /** The player's kill streak changed. `multiplier` is the current score bonus. */
  | { type: 'combo'; streak: number; multiplier: number }
  /** The streak ended without the next kill landing in time. */
  | { type: 'combo_ended'; streak: number }
  /** An enemy commander called in reinforcements. */
  | { type: 'reinforcements_called'; enemyId: number; at: Vec2; count: number }
  /** A medic finished reviving a downed ally. */
  | { type: 'ally_revived'; enemyId: number; medicId: number; at: Vec2 }
  /** A hostile lost sight of the player and began searching. */
  | { type: 'enemy_searching'; enemyId: number; at: Vec2 }
  /** Three upgrades are on offer between encounters. */
  | { type: 'upgrade_offer'; options: UpgradeId[] }
  /** An upgrade was taken. */
  | { type: 'upgrade_taken'; upgrade: UpgradeId }
  /** Operations: the mission briefing has been shown and the mission begins. */
  | { type: 'mission_started'; missionId: string; codename: string }
  /** Operations: the active objective changed. */
  | { type: 'objective_changed'; label: string; detail: string; index: number; total: number }
  /** Operations: the extraction countdown began. */
  | { type: 'extraction_started'; at: Vec2; durationMs: number }
  /** Operations: the player left the extraction zone and the clock is running down. */
  | { type: 'extraction_lost' }
  | { type: 'run_ended'; outcome: 'defeat' | 'victory'; wave: number };

export type SimulationEventListener = (event: SimulationEvent) => void;

export interface SimulationInput {
  /** Desired movement direction, already normalised to magnitude ≤ 1. */
  move: Vec2;
  /** Where the player is aiming, in world coordinates. */
  aim: Vec2 | null;
  /** True while the fire control is held. */
  firing: boolean;
  /** One-shot: true on the frame the dodge control is pressed. */
  dodge?: boolean;
  /** One-shot: true on the frame the grenade control is pressed. */
  grenade?: boolean;
  /** Where a thrown grenade should land. Falls back to the aim point. */
  grenadeTarget?: Vec2 | null;
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
  /** Milliseconds left in the boss's current wind-up, or 0 when it is not
   * charging an attack. The renderer draws the telegraph from this. */
  bossTelegraphMs: number;
  /** The attack being wound up, so the renderer can shape the telegraph. */
  bossTelegraphAttack: BossAttackKind | null;
  /** True while the boss is paused for a phase transition. */
  bossTransitioning: boolean;
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
  /** Which ruleset is running. */
  mode: ArenaMode;
  /** Deathmatch match state, or null in survival. */
  deathmatch: DeathmatchSnapshot | null;

  /* ── Combat mechanics (Part 3) ─────────────────────────────────────────── */

  /** Dodge state, for the HUD's cooldown ring. */
  dodge: DodgeSnapshot;
  /** Grenades remaining and the throw cooldown. */
  grenades: GrenadeSnapshot;
  /** The current kill streak and its score multiplier. */
  combo: ComboSnapshot;
  /** Run modifiers from upgrades taken so far. */
  modifiers: RunModifiers;
  /** Upgrade cards taken this run, in order. */
  upgrades: readonly UpgradeId[];
  /** Cards currently on offer, or empty when none are. */
  upgradeOffer: readonly UpgradeId[];
  /** True while an upgrade choice is pending — the arena is paused for it. */
  awaitingUpgrade: boolean;
  /** Operations mission state, or null outside that mode. */
  mission: MissionSnapshot | null;
  /** The obstacles the renderer should draw. */
  obstacles: readonly Obstacle[];
}

export interface DodgeSnapshot {
  /** True while the player is mid-roll. */
  rolling: boolean;
  /** Milliseconds until the next roll is permitted, or 0 when ready. */
  cooldownMs: number;
  /** Cooldown length after modifiers, so the HUD can draw a fraction. */
  cooldownTotalMs: number;
  /** True while the roll is actually avoiding damage. */
  invulnerable: boolean;
}

export interface GrenadeSnapshot {
  remaining: number;
  cooldownMs: number;
  /** Milliseconds until the next throw is permitted, or 0 when ready. */
  cooldownRemainingMs: number;
}

export interface ComboSnapshot {
  streak: number;
  multiplier: number;
  /** Milliseconds left to land the next kill before the streak resets. */
  windowRemainingMs: number;
}

export interface MissionSnapshot {
  id: string;
  codename: string;
  name: string;
  briefing: string;
  phase: MissionState['phase'];
  /** 1-based, for display. */
  objectiveIndex: number;
  objectiveTotal: number;
  objectiveLabel: string;
  objectiveDetail: string;
  objectiveInstruction: string;
  objectiveProgress: number;
  /** Where the objective is anchored, if positional. */
  objectivePosition: Vec2 | null;
  objectiveRadius: number | null;
  /** Milliseconds left on the extraction countdown, or 0. */
  extractionRemainingMs: number;
  inExtractionZone: boolean;
  encounterIntro: string | null;
  /** True while the player is standing in an interaction/extraction zone. */
  holdingPosition: boolean;
}

/** The deathmatch subset of a snapshot, for the HUD. */
export interface DeathmatchSnapshot {
  phase: 'countdown' | 'active' | 'finished';
  remainingMs: number;
  playerEliminations: number;
  playerDeaths: number;
  opponentEliminations: number;
  eliminationTarget: number;
  /** Milliseconds until the player re-enters, or 0 when on their feet. */
  playerRespawnMs: number;
  outcome: 'victory' | 'defeat' | null;
}

export interface SimulationOptions {
  loadout: WeaponId[];
  seed?: number;
  adaptationEnabled?: boolean;
  /** Waves are configurable so tests can drive short runs. */
  maxWaves?: number;
  /**
   * Begin the run at this wave instead of wave 1. Survival difficulty and the
   * boss schedule are all derived from the wave number, so this is the single
   * seam needed to test (or later, to let a player practise) a specific wave.
   */
  startWave?: number;
  /**
   * When true the player takes no damage. Intended for practice/tutorial runs
   * and for tests that assert enemy or boss behaviour without the run ending
   * early. It is never enabled in a scored match.
   */
  playerInvulnerable?: boolean;
  /** `survival` (default) runs waves; `deathmatch` runs a timed match against
   * AI opponents; `operations` runs a mission. All share every other system. */
  mode?: ArenaMode;
  /** Overrides the deathmatch tuning, so tests can run short matches. */
  deathmatchRules?: DeathmatchRules;
  /** Operations: which mission to run. Defaults to OPERATION: LAST EXIT. */
  missionId?: string;
  /**
   * When true the player starts with the three-choice upgrade offer between
   * encounters. Off by default so the scored survival mode keeps its exact
   * Part 2 balance; Operations turns it on.
   */
  upgradesEnabled?: boolean;
  /** Overrides the arena cover layout, so tests can use an open arena. */
  obstacles?: readonly Obstacle[];
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
  private readonly mode: ArenaMode;
  private readonly dmRules: DeathmatchRules;
  private dm: DeathmatchState;
  /** The cover layout this run is using. Tests can substitute an open arena. */
  private readonly obstacles: readonly Obstacle[];

  /* ── Combat mechanics (Part 3) ─────────────────────────────────────────── */

  private grenades: Grenade[] = [];
  private grenadesRemaining = GRENADE_COUNT;
  private grenadeCooldownMs = 0;
  /** Milliseconds remaining in the current roll, or 0. */
  private dodgeRemainingMs = 0;
  private dodgeCooldownMs = 0;
  /** Direction locked in at the start of the roll. */
  private dodgeDirection = vec(0, -1);
  /** Milliseconds of damage-avoidance remaining inside the current roll. */
  private dodgeInvulnMs = 0;
  /** Current kill streak and the clock left to extend it. */
  private comboStreak = 0;
  private comboWindowMs = 0;
  private readonly upgradeEnabled: boolean;
  private upgradesTaken: UpgradeId[] = [];
  private upgradeOffer: UpgradeId[] = [];
  /** How many times an upgrade has been offered, for rarity scaling. */
  private upgradeRolls = 0;
  private pendingUpgrade = false;
  private modifiers: RunModifiers = { ...BASE_MODIFIERS };

  /* ── Operations ────────────────────────────────────────────────────────── */

  private readonly mission: Mission | null;
  private missionState: MissionState | null;
  /** Ids of the mission encounter currently spawning, if any. */
  private missionSpawnQueue: string[] = [];
  private missionSpawnTimerMs = 0;
  /** True once the extraction countdown has been announced. */
  private extractionAnnounced = false;
  /** Kills accumulated in the run, mirrored from `eliminations` for clarity. */
  private lastMissionKills = 0;
  /** Hostiles revived by medics, so the results screen can report it. */
  private revives = 0;

  /** Milliseconds of *active* match time (excludes the countdown), used to scale
   * opponent difficulty. `dm.remainingMs` cannot serve this purpose during the
   * countdown, when it counts down from the countdown length instead. */
  private dmActiveElapsedMs = 0;
  /** Deathmatch opponents are enemies, but flagged so they can be told apart
   * from the player and from survival hostiles in the renderer and the HUD. */
  private opponentRespawnTimerMs = 0;

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
  private playerInvulnerable = false;

  private nextId = 1;
  private adaptationTimerMs = 0;
  private traits: BehaviourTraits;

  constructor(options: SimulationOptions) {
    this.player = createPlayerState(options.loadout);
    this.director = new TacticalDirector(options.adaptationEnabled ?? true);
    this.maxWaves = options.maxWaves ?? Number.POSITIVE_INFINITY;
    this.playerInvulnerable = options.playerInvulnerable ?? false;
    this.rng = createSeededRandom(options.seed ?? Date.now());
    this.traits = this.observer.snapshot();
    this.mode = options.mode ?? 'survival';
    this.dmRules = options.deathmatchRules ?? DEATHMATCH_RULES;
    this.dm = createDeathmatchState(this.dmRules);
    this.obstacles = options.obstacles ?? ARENA_OBSTACLES;
    this.upgradeEnabled = options.upgradesEnabled ?? false;
    this.mission = this.mode === 'operations' ? (MISSIONS[options.missionId ?? LAST_EXIT.id] ?? LAST_EXIT) : null;
    this.missionState = this.mission ? createMissionState(this.mission) : null;
    this.waveNumber = Math.max(1, Math.floor(options.startWave ?? 1));
    this.wave = planWave(this.waveNumber);
    if (this.mode === 'deathmatch') {
      // Deathmatch has no waves: the match clock in `dm` drives the mode, and
      // opponents are topped up by the deathmatch tick rather than a wave queue.
      this.state = 'active';
      this.intermissionRemainingMs = 0;
      this.seedDeathmatchArena();
    } else if (this.mode === 'operations') {
      // Operations drives its own encounter schedule; the wave machinery is idle.
      this.state = 'active';
      this.intermissionRemainingMs = 0;
      this.emit({
        type: 'mission_started',
        missionId: this.mission!.id,
        codename: this.mission!.codename,
      });
    } else {
      // Survival opens with a short breather before wave 1.
      this.beginIntermission(1600);
    }
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

  /* ── Deathmatch ────────────────────────────────────────────────────────── */

  /** Fills the arena with the opening set of AI opponents. */
  private seedDeathmatchArena(): void {
    for (let i = 0; i < this.dmRules.opponentCount; i += 1) {
      this.spawnOpponent();
    }
  }

  /** Spawns one AI opponent, chosen from the archetypes eligible at the
   * current difficulty and placed away from the player. */
  private spawnOpponent(): void {
    // Deathmatch opponents get tougher as the match progresses, mirroring the
    // survival difficulty curve so the mode is not a flat fight.
    const progress = Math.min(1, this.dmActiveElapsedMs / Math.max(1, this.dmRules.durationMs));
    const difficultyWave = 1 + Math.floor(progress * 12);
    this.waveNumber = difficultyWave;
    const eligible = eligibleArchetypes(difficultyWave);
    const archetypeId = pickArchetype(difficultyWave, this.rng, eligible);
    this.spawnEnemy(archetypeId, this.pickSpawnPosition(), false, true);
  }

  private aliveOpponentCount(): number {
    return this.enemies.reduce(
      (count, enemy) => (enemy.isOpponent && !enemy.dying ? count + 1 : count),
      0,
    );
  }

  /**
   * Advances the deathmatch clock and reacts to it. Returns true when the match
   * has ended, so `step` can stop processing the rest of the frame.
   */
  private updateDeathmatch(dtMs: number): void {
    const tick = tickDeathmatch(this.dm, dtMs, this.dmRules, this.aliveOpponentCount());

    if (tick.started) {
      this.emit({ type: 'match_started' });
    }
    // Only active match time counts toward difficulty scaling.
    if (this.dm.phase === 'active') this.dmActiveElapsedMs += dtMs;

    // Keep the arena populated. A single shared respawn timer paces arrivals so
    // opponents trickle in rather than appearing as a wall.
    this.opponentRespawnTimerMs -= dtMs;
    if (tick.needsOpponent && this.opponentRespawnTimerMs <= 0) {
      this.spawnOpponent();
      this.opponentRespawnTimerMs = this.dmRules.respawnDelayMs;
    }

    // Re-entry after a death: the player is restored and placed safely.
    if (this.dm.playerRespawnMs === 0 && !this.player.alive && this.dm.phase !== 'finished') {
      this.respawnPlayer();
    }

    if (tick.finished) {
      this.endRun(this.dm.outcome === 'victory' ? 'victory' : 'defeat');
    }
  }

  /** Brings the player back after a deathmatch death. */
  private respawnPlayer(): void {
    this.player.alive = true;
    this.player.health = this.player.maxHealth;
    this.iframeMs = PLAYER_IFRAME_MS * 1.5;
    // Re-enter at the arena centre, far from wherever the opponents are.
    this.setPlayerPosition(vec(ARENA_WIDTH / 2, ARENA_HEIGHT / 2));
    this.emit({ type: 'player_respawned' });
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

  private spawnEnemy(
    archetypeId: EnemyArchetypeId,
    position: Vec2,
    isBoss = false,
    isOpponent = false,
  ): Enemy {
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
      // ── Tactical AI ───────────────────────────────────────────────────────
      role: ROLE_FOR_ARCHETYPE[archetypeId],
      awareness: createAwareness(),
      suppressionMs: 0,
      isCommander: false,
      squadId: -1,
      reinforcementCooldownMs: 0,
      reinforcementsCalled: 0,
      coverTarget: null,
      chargeMs: 0,
      chargeDirection: 0,
      ammoInMagazine: ENEMY_MAGAZINE,
      magazine: ENEMY_MAGAZINE,
      reloadRemainingMs: 0,
      reviveTargetId: null,
      reviveProgressMs: 0,
      ...(isOpponent ? { isOpponent: true } : {}),
      ...(isBoss
        ? {
            phase: 1 as const,
            telegraphMs: 0,
            pendingAttack: null,
            phaseTransitionMs: 0,
            attackIndex: 0,
          }
        : {}),
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

    // An upgrade choice freezes the arena. The simulation still *exists* — the
    // snapshot is readable — but nothing advances, so the player cannot be shot
    // while reading the cards and cannot bank the pause as a tactical advantage.
    if (this.pendingUpgrade) return;

    this.elapsedMs += dtMs;
    if (this.iframeMs > 0) this.iframeMs = Math.max(0, this.iframeMs - dtMs);

    // Deathmatch countdown: the arena is live (the player can look around) but
    // frozen — no movement, no combat — so the match starts fair and the
    // countdown cannot be used to reposition.
    if (this.mode === 'deathmatch' && this.dm.phase === 'countdown') {
      this.updateDeathmatch(dtMs);
      this.observePlayer(dtMs, input);
      return;
    }

    this.handlePlayerAbilities(dt, dtMs, input);
    this.updatePlayerMovement(dt, input);
    this.updateAimingAndFiring(dt, dtMs, input);
    updatePlayer(this.player, dtMs);
    this.updateGrenades(dtMs);
    this.updateCombo(dtMs);

    if (!this.player.alive) {
      if (this.mode === 'deathmatch') {
        // In deathmatch a death is a setback, not the end of the match: count it
        // and let the deathmatch tick schedule the re-entry. The run only ends
        // when the clock expires or the elimination target is reached.
        if (this.dm.playerRespawnMs <= 0) {
          recordPlayerDeath(this.dm, this.dmRules);
          this.emit({ type: 'player_died' });
        }
      } else {
        this.endRun('defeat');
        return;
      }
    }

    if (this.mode === 'deathmatch') {
      this.updateDeathmatch(dtMs);
      if (this.isEnded) return;
    } else if (this.mode === 'operations') {
      this.updateMission(dtMs);
      if (this.isEnded) return;
    } else {
      this.updateWaveState(dtMs);
    }
    this.updateEnemies(dt, dtMs);
    this.updateProjectiles(dt, dtMs);
    this.updatePickups(dtMs);
    this.observePlayer(dtMs, input);
    this.updateAdaptation(dtMs);

    this.enemies = this.enemies.filter((enemy) => !enemy.dying || enemy.deathMs < 900);
    for (const enemy of this.enemies) {
      if (enemy.hitFlashMs > 0) enemy.hitFlashMs = Math.max(0, enemy.hitFlashMs - dtMs);
      if (enemy.dying) enemy.deathMs += dtMs;
      // A downed hostile is retired once the revive window lapses, so a medic
      // that never arrives does not leave a permanent body on the floor.
      if (enemy.downed) {
        enemy.downedMs = Math.max(0, (enemy.downedMs ?? 0) - dtMs);
        if (enemy.downedMs === 0) {
          enemy.downed = false;
          enemy.dying = true;
          enemy.deathMs = 0;
        }
      }
    }
  }

  /* ── Player abilities (dodge and grenade) ──────────────────────────────── */

  private handlePlayerAbilities(dt: number, dtMs: number, input: SimulationInput): void {
    if (this.dodgeCooldownMs > 0) this.dodgeCooldownMs = Math.max(0, this.dodgeCooldownMs - dtMs);
    if (this.dodgeRemainingMs > 0) {
      this.dodgeRemainingMs = Math.max(0, this.dodgeRemainingMs - dtMs);
      this.dodgeInvulnMs = Math.max(0, this.dodgeInvulnMs - dtMs);
    }
    // A grenade throw is its own one-shot input; it is resolved here so the
    // cooldown and the ammo count are advanced in the same place as the roll's.
    if (input.grenade && this.player.alive) {
      const target = input.grenadeTarget ?? input.aim;
      if (target) this.throwGrenade(target);
    }
    void dt;

    if (!input.dodge || !this.player.alive) return;
    if (this.dodgeRemainingMs > 0 || this.dodgeCooldownMs > 0) return;

    // The roll goes in the direction the player is *steering*, falling back to
    // the aim direction and then to the facing, so a roll always goes somewhere
    // the player intended.
    const steer = clampMagnitude(input.move, 1);
    const direction =
      Math.hypot(steer.x, steer.y) > 0.15
        ? normalise(steer)
        : input.aim
          ? normalise(sub(input.aim, this.playerPositionRef))
          : fromAngle(this.playerFacing, 1);

    this.dodgeDirection = direction;
    this.dodgeRemainingMs = DODGE_DURATION_MS;
    this.dodgeInvulnMs = DODGE_DURATION_MS * DODGE_INVULN_FRACTION;
    this.dodgeCooldownMs = DODGE_COOLDOWN_MS * this.modifiers.dodgeCooldownMultiplier;
    this.emit({ type: 'dodge', at: { ...this.playerPositionRef }, angle: angleOf(direction) });
  }

  /* ── Operations ────────────────────────────────────────────────────────── */

  /**
   * Advances the mission and drives its encounter spawner.
   *
   * The spawner is deliberately *additive*: the mission tells the arena which
   * hostiles to send and how fast, but every hostile is created through the same
   * `spawnEnemy` path the other modes use. There is no second enemy system.
   */
  private updateMission(dtMs: number): void {
    const mission = this.mission;
    const state = this.missionState;
    if (!mission || !state) return;

    // ── Spawn the active encounter ──────────────────────────────────────────
    const encounter = currentEncounter(mission, state);
    if (encounter) {
      const alive = this.aliveEnemyCount();
      this.missionSpawnTimerMs -= dtMs;
      if (
        this.missionSpawnQueue.length > 0 &&
        this.missionSpawnTimerMs <= 0 &&
        alive < encounter.maxConcurrent
      ) {
        const archetype = this.missionSpawnQueue.shift()!;
        const position = this.pickSpawnPosition();
        this.spawnEnemy(archetype as EnemyArchetypeId, position);
        state.spawned += 1;
        this.missionSpawnTimerMs = encounter.spawnIntervalMs;
      }
    }

    // ── Tick the objective state machine ────────────────────────────────────
    const result = tickMission(mission, state, {
      dtMs,
      killsThisFrame: this.eliminations - this.lastMissionKills,
      playerPosition: this.playerPositionRef,
      encounterCleared: this.missionSpawnQueue.length === 0 && this.aliveEnemyCount() === 0,
    });
    this.lastMissionKills = this.eliminations;

    if (result.encounterStarted) {
      const next = currentEncounter(mission, state);
      if (next) {
        // Scale the encounter by the player's own progress so a fast run is not
        // punished with a weak finish and a slow one is not overwhelmed.
        this.missionSpawnQueue = [...next.enemies];
        this.missionSpawnTimerMs = 0;
        this.emit({
          type: 'wave_started',
          wave: state.encounterIndex + 1,
          label: next.intro,
          isBossWave: false,
        });
        // Between encounters, Operations offers a field upgrade. The offer
        // freezes the arena (see `step`), so it is a genuine decision made
        // between fights rather than a card read mid-firefight. The first
        // encounter offers too, which gives the player a build choice up front.
        if (this.upgradeEnabled && !this.pendingUpgrade) this.offerUpgrades();
      }
    }

    if (result.objectiveAdvanced) {
      const objective = currentObjective(mission, state);
      if (objective) {
        this.emit({
          type: 'objective_changed',
          label: objective.label,
          detail: objective.detail ?? '',
          index: state.objectiveIndex + 1,
          total: mission.objectives.length,
        });
      }
      if (objective?.kind === 'extract') {
        this.extractionAnnounced = true;
        this.emit({
          type: 'extraction_started',
          at: objective.position ?? this.playerPositionRef,
          durationMs: mission.extractionMs,
        });
      }
    }

    // Extraction left: warn once so the HUD can flash.
    if (this.extractionAnnounced && state.phase === 'extraction' && state.extractionAwayMs > 0) {
      this.extractionAnnounced = false;
      this.emit({ type: 'extraction_lost' });
    }

    if (result.failed) {
      failMission(state);
      this.endRun('defeat');
      return;
    }
    if (result.extracted) {
      this.endRun('victory');
    }
  }

  /* ── Upgrades ──────────────────────────────────────────────────────────── */

  /**
   * Offers three upgrades. Called by the arena between encounters when the
   * `upgradesEnabled` option is on. Returns the cards on offer.
   */
  offerUpgrades(): UpgradeId[] {
    if (!this.upgradeEnabled) return [];
    this.upgradeRolls += 1;
    this.upgradeOffer = rollUpgradeOffer(this.upgradesTaken, this.upgradeRolls, this.rng);
    this.pendingUpgrade = this.upgradeOffer.length > 0;
    if (this.pendingUpgrade) this.emit({ type: 'upgrade_offer', options: [...this.upgradeOffer] });
    return [...this.upgradeOffer];
  }

  /**
   * Takes one of the offered upgrades.
   *
   * Refuses any card that was not actually on offer, so the client cannot inject
   * an arbitrary upgrade — the same principle as never trusting a submitted
   * score.
   */
  chooseUpgrade(id: UpgradeId): boolean {
    if (!this.pendingUpgrade) return false;
    if (!this.upgradeOffer.includes(id)) return false;

    this.upgradesTaken.push(id);
    this.modifiers = modifiersFor(this.upgradesTaken);
    this.applyModifiersToLoadout();
    this.pendingUpgrade = false;
    this.upgradeOffer = [];
    this.emit({ type: 'upgrade_taken', upgrade: id });
    return true;
  }

  /** Pushes the current modifier set onto the things that read it at spawn time. */
  private applyModifiersToLoadout(): void {
    for (const weapon of this.player.loadout) {
      const base = getWeapon(weapon);
      setMagazineCapacity(this.player, weapon, base.magazine * this.modifiers.magazineMultiplier);
    }
  }

  /** True when a dodge roll can be started right now (not rolling, off cooldown). */
  get canDodge(): boolean {
    return this.dodgeRemainingMs <= 0 && this.dodgeCooldownMs <= 0 && this.player.alive && !this.pendingUpgrade;
  }

  /** True when a grenade can be thrown right now. */
  get canThrowGrenade(): boolean {
    return this.grenadesRemaining > 0 && this.grenadeCooldownMs <= 0 && this.player.alive && !this.pendingUpgrade;
  }

  get upgrades(): readonly UpgradeId[] {
    return this.upgradesTaken;
  }

  get upgradeOptions(): readonly UpgradeId[] {
    return this.upgradeOffer;
  }

  get isAwaitingUpgrade(): boolean {
    return this.pendingUpgrade;
  }

  /* ── Player ────────────────────────────────────────────────────────────── */

  /** Current player velocity, integrated from input. Kept separate from the
   * position so acceleration is frame-rate independent and the movement feel is
   * consistent across refresh rates. */
  private playerVelocityRef: Vec2 = vec();

  private updatePlayerMovement(dt: number, input: SimulationInput): void {
    // A downed player (deathmatch respawn window) does not move.
    if (!this.player.alive) {
      this.playerVelocityRef = vec();
      return;
    }

    // ── Dodge roll ──────────────────────────────────────────────────────────
    // A roll overrides normal movement completely: the player travels a fixed
    // distance in the direction locked in at the start, and cannot steer. That
    // commitment is what makes the mechanic a decision rather than a teleport.
    if (this.dodgeRemainingMs > 0) {
      const progress = 1 - this.dodgeRemainingMs / DODGE_DURATION_MS;
      // Ease-out: fast at the start, settling at the end.
      const speed = (DODGE_DISTANCE / (DODGE_DURATION_MS / 1000)) * (1.6 - progress);
      this.playerVelocityRef = scale(this.dodgeDirection, speed);
      const next = add(this.playerPositionRef, scale(this.playerVelocityRef, dt));
      this.playerPositionRef = this.clampPlayerPosition(this.resolvePlayerCollisions(next));
      this.playerFacing = angleOf(this.dodgeDirection);
      return;
    }

    const desired = clampMagnitude(input.move, 1);
    const target = scale(desired, PLAYER_SPEED * this.modifiers.speedMultiplier);
    const position = this.playerPositionRef;

    // Exponential approach: the fraction of the remaining gap closed this frame
    // depends only on elapsed time, so 30fps and 144fps feel identical.
    const blend = 1 - Math.exp(-PLAYER_ACCELERATION * dt);
    this.playerVelocityRef = {
      x: this.playerVelocityRef.x + (target.x - this.playerVelocityRef.x) * blend,
      y: this.playerVelocityRef.y + (target.y - this.playerVelocityRef.y) * blend,
    };

    const next = {
      x: position.x + this.playerVelocityRef.x * dt,
      y: position.y + this.playerVelocityRef.y * dt,
    };

    this.playerPositionRef = this.clampPlayerPosition(this.resolvePlayerCollisions(next));
  }

  /** Keeps the player inside the arena walls. */
  private clampPlayerPosition(position: Vec2): Vec2 {
    return vec(
      clamp(position.x, WALL_MARGIN + PLAYER_RADIUS, ARENA_WIDTH - WALL_MARGIN - PLAYER_RADIUS),
      clamp(position.y, WALL_MARGIN + PLAYER_RADIUS, ARENA_HEIGHT - WALL_MARGIN - PLAYER_RADIUS),
    );
  }

  /** Slides the player out of any cover they have walked into. */
  private resolvePlayerCollisions(position: Vec2): Vec2 {
    if (this.obstacles.length === 0) return position;
    return resolveCircleAgainstObstacles(position, PLAYER_RADIUS, this.obstacles);
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

    // Gunfire is loud. Hostiles within earshot learn the player's *sector* —
    // never a precise fix — which is enough to start converging on a player who
    // is holding a corridor, and keeps a shootout from happening in a vacuum.
    // This is deliberately coarser than sight: hearing cannot be aimed with, and
    // it still has to be confirmed visually before a hostile can fire.
    for (const enemy of this.enemies) {
      if (enemy.dying || enemy.isBoss) continue;
      if (distance(enemy.position, position) > GUNFIRE_HEARING_RADIUS) continue;
      if (enemy.awareness.lastKnown) continue;
      enemy.awareness = {
        lastKnown: coarseHuntTarget(position),
        msSinceSeen: MEMORY_MS,
        everSeen: enemy.awareness.everSeen,
      };
    }

    // Spread is applied per pellet; a single-pellet weapon still gets its
    // nominal spread so accuracy is never perfect.
    const totalSpread = (spec.spreadDeg * Math.PI) / 180;
    // Upgrades that widen or tighten the gun are applied here so the projectile
    // carries the modified damage rather than the caller having to remember.
    const damage = spec.damage * this.modifiers.damageMultiplier;
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
        damage,
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
      if (enemy.isBoss) enemy.stance = bossStanceForPhase(enemy.phase ?? 1);
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


  private updateEnemies(dt: number, dtMs: number): void {
    const playerPos = this.playerPositionRef;

    // ── Squad coordination ───────────────────────────────────────────────────
    // Rebuilt every frame from the *current* positions, so a squad is a
    // situational fact: hostiles that drift apart stop coordinating and
    // hostiles that converge start. The commander's memory is shared with its
    // squad, which is what makes a squad search one place instead of scattering.
    const squads = this.buildSquads();

    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      if (enemy.attackCooldownMs > 0) enemy.attackCooldownMs -= dtMs;
      if (enemy.reinforcementCooldownMs > 0) enemy.reinforcementCooldownMs -= dtMs;
      if (enemy.suppressionMs > 0) enemy.suppressionMs = Math.max(0, enemy.suppressionMs - dtMs);

      if (enemy.isBoss) {
        this.updateBoss(enemy, dt, playerPos);
        continue;
      }

      this.updateTacticalEnemy(enemy, dt, dtMs, playerPos, squads);
    }
  }

  /** Groups living hostiles into squads and elects a commander for each. */
  private buildSquads(): Map<number, { members: Enemy[]; commander: Enemy | null }> {
    const living = this.enemies.filter((enemy) => !enemy.dying && !enemy.isBoss);
    const squadMembers: SquadMember[] = living.map((enemy) => ({
      id: enemy.id,
      position: enemy.position,
      role: enemy.role,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
    }));
    const clusters = clusterSquads(squadMembers);

    const result = new Map<number, { members: Enemy[]; commander: Enemy | null }>();
    const byId = new Map(living.map((enemy) => [enemy.id, enemy]));

    clusters.forEach((ids, index) => {
      const members = ids.map((id) => byId.get(id)).filter((enemy): enemy is Enemy => Boolean(enemy));
      // A squad needs the minimum size before a commander is elected, so a lone
      // hostile never pretends to be coordinating with anybody.
      const commanderId = members.length >= SQUAD_MIN_SIZE ? electCommander(members.map((m) => ({
        id: m.id,
        position: m.position,
        role: m.role,
        health: m.health,
        maxHealth: m.maxHealth,
      }))) : null;
      const commander = commanderId !== null ? (byId.get(commanderId) ?? null) : null;
      for (const member of members) member.squadId = index;
      if (commander) commander.isCommander = true;
      result.set(index, { members, commander });
    });

    // Clear the flag on anyone who is no longer a commander, so a squad that
    // loses its leader does not keep the previous one's aura.
    for (const enemy of living) {
      if (!result.get(enemy.squadId)?.commander || result.get(enemy.squadId)!.commander!.id !== enemy.id) {
        enemy.isCommander = false;
      }
    }
    return result;
  }

  /**
   * One frame of tactical behaviour for a single hostile.
   *
   * The order is deliberate and mirrors how a soldier actually works:
   * perceive → decide → move → act. Perception is resolved first because every
   * later decision depends on it, and it is the only place the player's true
   * position may enter the AI at all.
   */
  private updateTacticalEnemy(
    enemy: Enemy,
    dt: number,
    dtMs: number,
    playerPos: Vec2,
    squads: Map<number, { members: Enemy[]; commander: Enemy | null }>,
  ): void {
    const distToPlayer = Math.max(1, distance(enemy.position, playerPos));

    // ── 1. Perceive ──────────────────────────────────────────────────────────
    // `canSee` is the ONLY source of truth about the player's location. A
    // hostile that cannot see the player acts on `awareness.lastKnown`, which
    // expires — so it genuinely searches rather than tracking.
    const canSee =
      !this.player.alive
        ? false
        : canSeePlayer(enemy.position, playerPos, enemy.archetype, this.obstacles);
    const wasSearching = isSearching(enemy.awareness, MEMORY_MS);
    enemy.awareness = updateAwareness(enemy.awareness, dtMs, canSee, playerPos, MEMORY_MS);
    if (!wasSearching && isSearching(enemy.awareness, MEMORY_MS)) {
      this.emit({ type: 'enemy_searching', enemyId: enemy.id, at: { ...enemy.position } });
    }

    const squad = squads.get(enemy.squadId);
    const commanderMemory = squad?.commander && squad.commander.id !== enemy.id ? squad.commander.awareness.lastKnown : null;
    // With no sight and no memory, a hostile still advances on the sector the
    // player occupies — it does not stand in a corner waiting to be found. This
    // is a coarse fallback, not knowledge: it cannot be aimed with, and it is
    // superseded the moment a real sighting occurs.
    const hunt = canSee || enemy.awareness.lastKnown ? null : coarseHuntTarget(playerPos);
    const target = squadTarget(enemy.awareness.lastKnown, commanderMemory, canSee, playerPos) ?? hunt;
    // A hostile that is closing on a sector rather than a sighting should not be
    // treated as having line of sight for movement purposes.
    const hasContact = canSee || enemy.awareness.lastKnown !== null;

    // ── 2. Reload ────────────────────────────────────────────────────────────
    if (enemy.reloadRemainingMs > 0) {
      enemy.reloadRemainingMs = Math.max(0, enemy.reloadRemainingMs - dtMs);
      if (enemy.reloadRemainingMs === 0) enemy.ammoInMagazine = enemy.magazine;
    } else if (shouldReload(enemy.ammoInMagazine, enemy.magazine, canSee, enemy.reloadRemainingMs)) {
      enemy.reloadRemainingMs = ENEMY_RELOAD_MS;
    }

    // ── 3. Medic revive ──────────────────────────────────────────────────────
    let reviveTarget: Vec2 | null = null;
    if (enemy.role === 'medic') {
      const downed = this.enemies.filter(
        (other) => other !== enemy && other.downed && (other.downedMs ?? 0) > 0,
      );
      const pick = findReviveTarget(
        enemy.position,
        downed.map((ally) => ({ id: ally.id, position: ally.position })),
      );
      if (pick) {
        reviveTarget = pick.position;
        if (enemy.reviveTargetId === pick.id) {
          enemy.reviveProgressMs += dtMs;
          if (enemy.reviveProgressMs >= REVIVE_CHANNEL_MS) {
            this.reviveAlly(pick.id, enemy);
            enemy.reviveTargetId = null;
            enemy.reviveProgressMs = 0;
          }
        } else {
          enemy.reviveTargetId = pick.id;
          enemy.reviveProgressMs = 0;
        }
      } else {
        enemy.reviveTargetId = null;
        enemy.reviveProgressMs = 0;
      }
    }

    // ── 4. Commander reinforcement call ──────────────────────────────────────
    if (enemy.isCommander && target) {
      const squadSize = squad?.members.filter((m) => !m.dying).length ?? 0;
      if (shouldCallReinforcements(squadSize, enemy.reinforcementCooldownMs, enemy.reinforcementsCalled)) {
        enemy.reinforcementsCalled += 1;
        enemy.reinforcementCooldownMs = 14_000;
        this.callReinforcements(enemy, target);
      }
    }

    // ── 5. Cover decision ────────────────────────────────────────────────────
    const underPressure = distToPlayer < 260;
    const urgency = coverUrgency(enemy.role, {
      suppressed: enemy.suppressionMs > 0,
      reloading: enemy.reloadRemainingMs > 0,
      healthFraction: enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1,
      underPressure,
    });
    // Only look for cover when it matters, and only re-evaluate periodically —
    // cover seeking is expensive, so it is throttled rather than run per frame.
    if (target && urgency >= COVER_COMMIT_THRESHOLD) {
      if (!enemy.coverTarget) {
        const cover = findCover(enemy.position, target, this.obstacles, enemy.radius, 320);
        enemy.coverTarget = cover && cover.value > 0.25 ? cover.position : null;
      } else if (coverValueAt(enemy.coverTarget, target, this.obstacles) <= 0.05) {
        // The cover stopped working (the player moved); drop it.
        enemy.coverTarget = null;
      }
    } else {
      enemy.coverTarget = null;
    }

    // ── 6. Movement ──────────────────────────────────────────────────────────
    const facingTarget = target ?? this.lastKnownOrFacing(enemy);
    const toTarget = sub(facingTarget, enemy.position);
    const distToTarget = Math.max(1, Math.hypot(toTarget.x, toTarget.y));
    enemy.facing = angleOf(toTarget);

    const intent = movementForRole(enemy.role, {
      position: enemy.position,
      target: facingTarget,
      // A hostile with a live sighting or a memory is acting on real knowledge;
      // one that has neither is following the coarse sector fallback. Both move,
      // but only the former is "on target" for the role doctrines that need it.
      hasSight: hasContact,
      distanceToTarget: distToTarget,
      preferredRange: enemy.preferredRange,
      approachOffset: enemy.approachOffset + this.squadAngleOffset(enemy, squad),
      coverPosition: enemy.coverTarget,
      reviveTarget,
    });

    // Steer around cover rather than into it. The avoidance blend is applied to
    // the *desired* direction, so a hostile rounds a pillar smoothly.
    let desiredDirection = intent.desiredDirection;
    if (intent.moving && Math.hypot(desiredDirection.x, desiredDirection.y) > 0.01) {
      desiredDirection = avoidObstacles(enemy.position, desiredDirection, this.obstacles, enemy.radius);
    }

    const speed = intent.moving ? enemy.speed * (1 + this.director.directive.pressure * 0.15) : 0;
    const desiredVelocity = scale(desiredDirection, speed);
    const blend = 1 - Math.exp(-9 * dt);
    enemy.velocity = {
      x: enemy.velocity.x + (desiredVelocity.x - enemy.velocity.x) * blend,
      y: enemy.velocity.y + (desiredVelocity.y - enemy.velocity.y) * blend,
    };

    const moved = vec(
      enemy.position.x + enemy.velocity.x * dt,
      enemy.position.y + enemy.velocity.y * dt,
    );
    const clampedMove = vec(
      clamp(moved.x, WALL_MARGIN + enemy.radius, ARENA_WIDTH - WALL_MARGIN - enemy.radius),
      clamp(moved.y, WALL_MARGIN + enemy.radius, ARENA_HEIGHT - WALL_MARGIN - enemy.radius),
    );
    enemy.position = resolveCircleAgainstObstacles(clampedMove, enemy.radius, this.obstacles);

    this.resolveEnemySeparation(enemy);

    // ── 7. Act ───────────────────────────────────────────────────────────────
    this.enemyAttack(enemy, distToPlayer, canSee, playerPos);
  }

  /** The shared squad focus offset for this hostile, so a squad fans out. */
  private squadAngleOffset(enemy: Enemy, squad: { members: Enemy[]; commander: Enemy | null } | undefined): number {
    if (!squad || squad.members.length < 2 || !squad.commander) return 0;
    const index = squad.members.findIndex((member) => member.id === enemy.id);
    if (index < 0) return 0;
    const angles = squadFocusAngles(squad.members.length);
    return angles[index] ?? 0;
  }

  /** The fallback facing when a hostile has no target at all. */
  private lastKnownOrFacing(enemy: Enemy): Vec2 {
    return enemy.awareness.lastKnown ?? add(enemy.position, fromAngle(enemy.facing, 100));
  }

  /** A commander's call: spawn a small escort around the squad. */
  private callReinforcements(enemy: Enemy, target: Vec2): void {
    const count = 2;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const spawnAt = this.findFreeSpawn(add(enemy.position, fromAngle(angle, 140)), 20);
      // Reinforcements are always basic infantry: a commander extends a fight,
      // it does not escalate it into an unwinnable one.
      const id = this.rng() < 0.5 ? 'rusher' : 'flanker';
      this.spawnEnemy(id, spawnAt);
    }
    this.emit({ type: 'reinforcements_called', enemyId: enemy.id, at: { ...enemy.position }, count });
    void target;
  }

  /** Brings a downed hostile back at partial health. */
  private reviveAlly(id: number, medic: Enemy): void {
    const ally = this.enemies.find((other) => other.id === id);
    if (!ally || !ally.downed) return;
    ally.downed = false;
    ally.downedMs = 0;
    ally.dying = false;
    ally.deathMs = 0;
    ally.health = Math.max(1, Math.round(ally.maxHealth * REVIVE_HEALTH_FRACTION));
    ally.awareness = createAwareness();
    this.revives += 1;
    this.emit({ type: 'ally_revived', enemyId: id, medicId: medic.id, at: { ...ally.position } });
  }

  /** Picks a spawn point near `around` that is not inside cover. */
  private findFreeSpawn(around: Vec2, radius: number): Vec2 {
    let candidate = this.clampToArena(around, radius);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const blocked = this.obstacles.some((obstacle) => circleOverlapsObstacle(candidate, radius, obstacle));
      if (!blocked) return candidate;
      candidate = this.clampToArena(add(candidate, fromAngle(this.rng() * Math.PI * 2, 70)), radius);
    }
    return candidate;
  }

  private clampToArena(position: Vec2, radius: number): Vec2 {
    return vec(
      clamp(position.x, WALL_MARGIN + radius, ARENA_WIDTH - WALL_MARGIN - radius),
      clamp(position.y, WALL_MARGIN + radius, ARENA_HEIGHT - WALL_MARGIN - radius),
    );
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

  /**
   * A hostile's attack decision.
   *
   * Three rules make this fair rather than punishing:
   *  - **It must be able to see the player.** A shot through a wall is the
   *    single most obvious way an AI cheats, so `canSee` gates every branch.
   *  - **It must have a round.** Reloading is a real, exploitable window.
   *  - **Dangerous shots telegraph.** The marksman charges visibly before firing
   *    and the charge direction is locked in, so moving genuinely avoids it.
   */
  private enemyAttack(enemy: Enemy, dist: number, canSee: boolean, playerPos: Vec2): void {
    const archetype = getArchetype(enemy.archetype);

    // ── A charging sniper: resolve the charge, whether or not it still sees ──
    if (enemy.chargeMs > 0) {
      enemy.chargeMs = Math.max(0, enemy.chargeMs - 1000 / 60);
      // Aiming continues while the player is visible, so a stationary target is
      // punished but a moving one can break the line.
      if (canSee) enemy.chargeDirection = angleOf(sub(playerPos, enemy.position));
      if (enemy.chargeMs === 0) {
        this.fireEnemyRound(enemy, archetype, enemy.chargeDirection);
      }
      return;
    }

    if (enemy.reloadRemainingMs > 0) return;
    if (!canSee) return;
    if (enemy.attackCooldownMs > 0) return;

    // Melee: only when genuinely touching the player. This is checked before any
    // range gate, because a melee-only archetype has a ranged range of zero and
    // a range gate would reject its only attack at every distance.
    if (dist <= enemy.radius + PLAYER_RADIUS + CONTACT_REACH) {
      this.damagePlayer(enemy.contactDamage);
      enemy.attackCooldownMs = archetype.attackCooldownMs;
      return;
    }

    // Ranged: only inside the archetype's envelope, and only when the hostile is
    // not mid-approach (so shots read as deliberate).
    if (archetype.rangedDamage > 0 && dist <= archetype.rangedRange && dist > 80) {
      if (enemy.ammoInMagazine <= 0) {
        enemy.reloadRemainingMs = ENEMY_RELOAD_MS;
        return;
      }

      // The marksman charges: this is the telegraph the player reads.
      if (enemy.role === 'sniper' && canBeginSniperCharge(canSee, dist, enemy.attackCooldownMs)) {
        enemy.chargeMs = SNIPER_CHARGE_MS;
        enemy.chargeDirection = angleOf(sub(playerPos, enemy.position));
        return;
      }

      const direction = normalise(sub(playerPos, enemy.position));
      const spread = (2.4 * Math.PI) / 180;
      const angle = angleOf(direction) + (this.rng() - 0.5) * spread;
      this.fireEnemyRound(enemy, archetype, angle);
    }
  }

  /** Spawns one enemy round and charges the hostile's ammunition. */
  private fireEnemyRound(enemy: Enemy, archetype: ReturnType<typeof getArchetype>, angle: number): void {
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
    enemy.ammoInMagazine = Math.max(0, enemy.ammoInMagazine - 1);
    enemy.attackCooldownMs = archetype.attackCooldownMs;
  }

  private damagePlayer(amount: number): void {
    if (this.playerInvulnerable) return;
    if (!this.player.alive) return;
    // A dodge roll avoids damage for the early part of the roll. The window is
    // bounded deliberately: rolling early still gets you hit, so the mechanic
    // rewards reading the attack rather than spamming the button.
    if (this.dodgeInvulnMs > 0) return;
    if (this.iframeMs > 0) return;

    const reduced = amount * this.modifiers.damageTakenMultiplier;
    const lethal = damagePlayer(this.player, reduced);
    this.iframeMs = PLAYER_IFRAME_MS;
    this.emit({ type: 'player_hit', damage: reduced, health: this.player.health });
    if (lethal) this.emit({ type: 'player_died' });
  }

  /* ── Boss ──────────────────────────────────────────────────────────────── */

  private updateBoss(enemy: Enemy, dt: number, playerPos: Vec2): void {
    const ratio = enemy.health / enemy.maxHealth;
    const transition = nextBossPhase(enemy.phase ?? 1, ratio);

    if (transition) {
      const nextPhase = transition.to;
      enemy.phase = nextPhase;
      enemy.stance = bossStanceForPhase(nextPhase);
      // A phase change is a *readable event*: the boss stops attacking, stops
      // moving and winds up visibly, so the player registers the escalation
      // instead of being killed by a pattern that silently changed underneath
      // them. Attacks already in flight are left alone.
      enemy.telegraphMs = 0;
      enemy.pendingAttack = null;
      enemy.phaseTransitionMs = BOSS_PHASE_TRANSITION_MS;
      enemy.attackCooldownMs = BOSS_PHASE_TRANSITION_MS;
      this.emit({ type: 'boss_phase', phase: nextPhase, from: transition.from });
      return;
    }

    const toPlayer = sub(playerPos, enemy.position);
    const dist = Math.max(1, Math.hypot(toPlayer.x, toPlayer.y));
    const direction = scale(toPlayer, 1 / dist);
    enemy.facing = angleOf(toPlayer);

    const phase = enemy.phase ?? 1;

    // ── Phase transition: hold position, ignore the player, telegraph loudly ──
    if ((enemy.phaseTransitionMs ?? 0) > 0) {
      enemy.phaseTransitionMs = Math.max(0, (enemy.phaseTransitionMs ?? 0) - dt * 1000);
      enemy.velocity = vec();
      return;
    }

    // ── Wind-up: freeze and charge the pending attack ────────────────────────
    if ((enemy.telegraphMs ?? 0) > 0) {
      enemy.telegraphMs = Math.max(0, (enemy.telegraphMs ?? 0) - dt * 1000);
      // Movement halts during the wind-up so the telegraph is unmistakable and
      // the attack is aimed at where the player *is*, not where they were.
      enemy.velocity = vec();
      if (enemy.telegraphMs === 0) {
        this.executeBossAttack(enemy, playerPos);
      }
      return;
    }

    // ── Movement ─────────────────────────────────────────────────────────────
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

    // ── Choose the next attack ───────────────────────────────────────────────
    // Phase 2 additionally has a contact attack when it catches the player, which
    // is a pursuit punish rather than a projectile.
    if (phase === 2 && dist <= enemy.radius + PLAYER_RADIUS + 16) {
      this.damagePlayer(enemy.contactDamage);
      enemy.attackCooldownMs = 800;
      return;
    }

    const kind = chooseBossAttack(phase, dist, enemy.attackIndex ?? 0);
    enemy.attackIndex = (enemy.attackIndex ?? 0) + 1;
    enemy.pendingAttack = kind;
    enemy.telegraphMs = BOSS_ATTACKS[kind].telegraphMs;
    // The cooldown is set when the attack fires, so the telegraph itself is not
    // counted against the player's recovery window.
  }

  /** Fires the attack that was winding up. Damage values are unchanged per
   * phase — only the *pattern* escalates, so the boss never becomes unfair. */
  private executeBossAttack(enemy: Enemy, playerPos: Vec2): void {
    const kind = enemy.pendingAttack ?? 'volley';
    const spec = BOSS_ATTACKS[kind];
    enemy.pendingAttack = null;
    enemy.attackCooldownMs = spec.cooldownMs;

    const toPlayer = sub(playerPos, enemy.position);
    const direction = normalise(toPlayer);
    const base = angleOf(direction);

    switch (kind) {
      case 'volley': {
        // Three-round spread: readable, dodgeable, and it rewards lateral movement.
        for (let i = -1; i <= 1; i += 1) {
          this.spawnBossProjectile(enemy, base + i * 0.16, enemy.rangedDamage, 640);
        }
        break;
      }
      case 'lance': {
        // A fast, tight single shot during the pursuit.
        this.spawnBossProjectile(enemy, base, enemy.rangedDamage * 0.8, 700);
        break;
      }
      case 'burst': {
        // Radial: every direction at once, so the answer is to be far away or
        // behind cover, not to strafe.
        const count = 14;
        for (let i = 0; i < count; i += 1) {
          this.spawnBossProjectile(enemy, base + (i / count) * Math.PI * 2, enemy.rangedDamage * 0.7, 480);
        }
        break;
      }
      case 'spiral': {
        // A rotating pair of arms. Two shots per step, offset by pi, so the
        // sweep is symmetric and the safe gap rotates predictably.
        const arms = 2;
        const steps = 18;
        for (let i = 0; i < steps; i += 1) {
          for (let arm = 0; arm < arms; arm += 1) {
            const angle = base + (i / steps) * Math.PI * 1.5 + (arm / arms) * Math.PI;
            this.spawnBossProjectile(enemy, angle, enemy.rangedDamage * 0.55, 430);
          }
        }
        break;
      }
      case 'slam': {
        // A radial shockwave plus a persistent warning ring. This is the area
        // attack: it reaches further than the burst and hits harder, but only
        // when the player has stayed inside its radius.
        const count = 22;
        for (let i = 0; i < count; i += 1) {
          this.spawnBossProjectile(enemy, (i / count) * Math.PI * 2, enemy.rangedDamage * 0.85, 520);
        }
        break;
      }
    }

    this.emit({ type: 'boss_attack', attack: kind, at: { ...enemy.position } });
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
      const previous = projectile.position;
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

      // Cover stops rounds. This is checked against the segment travelled, so a
      // fast round cannot tunnel through a wall, and it is the same geometry the
      // line-of-sight check uses — a hostile that cannot see through a crate
      // also cannot shoot through it.
      if (this.projectileHitsCover(previous, projectile.position)) continue;

      if (projectile.owner === 'player') {
        // A round that passes close to a hostile rattles it. This is what
        // suppression *is* — volume of fire making the enemy keep its head down,
        // which is why it is caused by player fire and not by other hostiles'.
        this.applyNearMissSuppression(previous, projectile.position);
        // Sweep from the player's centre: the muzzle sits a few pixels ahead of
        // the body, which is far enough to skip a small hostile at contact
        // range. Starting the segment at the centre guarantees a point-blank
        // shot connects.
        if (this.resolvePlayerProjectile(projectile, this.playerPositionRef)) continue;
      } else if (this.resolveEnemyProjectile(projectile, previous)) {
        continue;
      }

      survivors.push(projectile);
    }

    this.projectiles = survivors;
  }

  /** True when the segment a projectile travelled this frame crosses cover. */
  private projectileHitsCover(from: Vec2, to: Vec2): boolean {
    return firstObstacleAlong(from, to, this.obstacles, 0) !== null;
  }

  /** Suppresses hostiles a player round passed close to. */
  private applyNearMissSuppression(from: Vec2, to: Vec2): void {
    for (const enemy of this.enemies) {
      if (enemy.dying || enemy.isBoss) continue;
      if (distanceToSegment(enemy.position, from, to) > enemy.radius + SUPPRESSION_NEAR_MISS_RADIUS) continue;
      enemy.suppressionMs = applySuppression(enemy.suppressionMs, true);
    }
  }

  /** Returns true when the projectile should be removed. */
  private resolvePlayerProjectile(projectile: Projectile, from: Vec2): boolean {
    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      if (projectile.hits.has(enemy.id)) continue;
      const reach = enemy.radius + projectile.radius;
      // Swept test against the segment the projectile travelled this frame, so a
      // shot fired point-blank or a fast round cannot skip past a target.
      if (distanceToSegment(enemy.position, from, projectile.position) > reach) continue;

      const base = damageAtDistance(
        { ...currentWeaponSpec(this.player), damage: projectile.damage },
        projectile.travelled,
      );

      // Weak-point strike. The chance comes from upgrades; with none taken there
      // is still a small base chance, so the mechanic exists from the first run.
      const critChance = BASE_CRIT_CHANCE + this.modifiers.critChance;
      const critical = this.rng() < critChance;
      const damage = critical ? base * this.modifiers.critMultiplier : base;

      const lethal = this.damageEnemy(enemy, damage, projectile.position);
      projectile.hits.add(enemy.id);
      if (critical) {
        projectile.critical = true;
        this.emit({ type: 'critical_hit', enemyId: enemy.id, at: { ...projectile.position }, damage });
      }
      if (!projectile.piercing) return true;
      if (lethal) continue;
    }
    return false;
  }

  /** Returns true when the projectile should be removed. */
  private resolveEnemyProjectile(projectile: Projectile, from: Vec2): boolean {
    const reach = PLAYER_RADIUS + projectile.radius;
    if (distanceToSegment(this.playerPositionRef, from, projectile.position) > reach) return false;
    this.damagePlayer(projectile.damage);
    return true;
  }

  private damageEnemy(enemy: Enemy, damage: number, at: Vec2): boolean {
    if (enemy.dying) return false;
    enemy.health = Math.max(0, enemy.health - damage);
    enemy.hitFlashMs = 90;
    enemy.suppressionMs = applySuppression(enemy.suppressionMs, true);
    this.damageDealt += damage;
    this.shotsHit += 1;

    const lethal = enemy.health === 0;
    this.emit({ type: 'enemy_hit', enemyId: enemy.id, damage, at: { ...at }, lethal });

    if (lethal) {
      this.eliminations += 1;
      const streakMultiplier = this.registerKill();
      const score = Math.round(enemy.scoreValue * streakMultiplier);
      this.score += score;
      this.waveScore += score;
      this.waveXp += enemy.xpValue;

      // A medic can bring an ally back, so a killed hostile is not removed
      // immediately: it is `downed` and revivable for a window. The renderer
      // draws it as a casualty; the removal pass retires it once that expires.
      const revivable = !enemy.isBoss && this.canBeRevived(enemy);
      if (revivable) {
        enemy.downed = true;
        enemy.downedMs = REVIVE_WINDOW_MS;
        enemy.health = 0;
        enemy.velocity = vec();
        enemy.chargeMs = 0;
      } else {
        enemy.dying = true;
        enemy.deathMs = 0;
      }

      this.emit({
        type: 'enemy_died',
        enemyId: enemy.id,
        archetype: enemy.archetype,
        at: { ...enemy.position },
        xp: enemy.xpValue,
        score,
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

      // Frag rounds: a kill has a chance to detonate in a small blast.
      if (!enemy.isBoss && this.modifiers.fragChance > 0 && this.rng() < this.modifiers.fragChance) {
        this.detonate(
          { ...enemy.position },
          GRENADE_RADIUS * 0.6 * this.modifiers.blastRadiusMultiplier,
          GRENADE_DAMAGE * 0.5,
          true,
        );
      }

      // Deathmatch: an opponent kill is the scoring event. Killing an opponent
      // may reach the target, which finishes the match immediately.
      if (this.mode === 'deathmatch' && enemy.isOpponent) {
        const finished = recordPlayerElimination(this.dm, this.dmRules);
        this.emit({ type: 'opponent_eliminated', total: this.dm.playerEliminations });
        if (finished) this.endRun('victory');
      }
    }
    return lethal;
  }

  /** True when this hostile may be left downed rather than removed outright. */
  private canBeRevived(enemy: Enemy): boolean {
    // Only when a living medic exists that could plausibly reach it, so an
    // unrevivable casualty does not linger and confuse the player.
    return this.enemies.some(
      (other) => other.id !== enemy.id && !other.dying && !other.downed && other.role === 'medic',
    );
  }

  /**
   * Records a kill and returns the score multiplier for it.
   *
   * The streak is a real scoring mechanic, not decoration: each kill inside the
   * window raises the multiplier, so sustained aggression is rewarded and a
   * passive run is not. The multiplier is capped so a lucky run cannot inflate
   * the score without bound.
   */
  private registerKill(): number {
    this.comboStreak += 1;
    this.comboWindowMs = COMBO_WINDOW_MS;
    const multiplier = Math.min(MAX_COMBO_MULTIPLIER, 1 + (this.comboStreak - 1) * COMBO_SCORE_STEP);
    if (this.comboStreak > 1) {
      this.emit({ type: 'combo', streak: this.comboStreak, multiplier });
    }
    return multiplier;
  }

  /** Ages the combo window and ends the streak when it lapses. */
  private updateCombo(dtMs: number): void {
    if (this.comboStreak === 0) return;
    this.comboWindowMs = Math.max(0, this.comboWindowMs - dtMs);
    if (this.comboWindowMs === 0) {
      if (this.comboStreak >= 3) this.emit({ type: 'combo_ended', streak: this.comboStreak });
      this.comboStreak = 0;
    }
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

  /* ── Grenades ──────────────────────────────────────────────────────────── */

  /** Throws a grenade at (or toward) a point. Returns false when it cannot. */
  private throwGrenade(target: Vec2): boolean {
    if (!this.player.alive) return false;
    if (this.grenadesRemaining <= 0 || this.grenadeCooldownMs > 0) return false;

    const from = this.playerPositionRef;
    // Clamp the throw to its range so a grenade can never be placed across the
    // arena, and snap the landing point out of any cover so it does not vanish
    // inside a crate.
    const toTarget = sub(target, from);
    const dist = Math.hypot(toTarget.x, toTarget.y);
    const clamped = dist > GRENADE_THROW_RANGE ? add(from, scale(normalise(toTarget), GRENADE_THROW_RANGE)) : target;
    const landing = resolveCircleAgainstObstacles(clamped, 6, this.obstacles);

    const travelMs = GRENADE_FUSE_MS * 0.45;
    this.grenades.push({
      id: this.nextId++,
      position: { ...from },
      velocity: scale(sub(landing, from), 1000 / travelMs),
      fuseMs: GRENADE_FUSE_MS,
      radius: GRENADE_RADIUS * this.modifiers.blastRadiusMultiplier,
      damage: GRENADE_DAMAGE * this.modifiers.damageMultiplier,
      fromFrag: false,
    });
    this.grenadesRemaining -= 1;
    this.grenadeCooldownMs = GRENADE_COOLDOWN_MS;
    this.emit({ type: 'grenade_thrown', at: { ...from }, target: { ...landing } });
    return true;
  }

  private updateGrenades(dtMs: number): void {
    if (this.grenadeCooldownMs > 0) this.grenadeCooldownMs = Math.max(0, this.grenadeCooldownMs - dtMs);
    if (this.grenades.length === 0) return;

    const survivors: Grenade[] = [];
    for (const grenade of this.grenades) {
      grenade.fuseMs -= dtMs;
      // Flight: the throw decays, so the grenade settles where it was aimed
      // rather than sliding, and a blast position is predictable.
      if (Math.hypot(grenade.velocity.x, grenade.velocity.y) > 1) {
        const dt = dtMs / 1000;
        const moved = add(grenade.position, scale(grenade.velocity, dt));
        grenade.position = this.clampToArena(moved, 6);
        grenade.velocity = scale(grenade.velocity, 1 - Math.min(1, dt * 6));
      }
      if (grenade.fuseMs <= 0) {
        this.detonate(grenade.position, grenade.radius, grenade.damage, grenade.fromFrag);
        continue;
      }
      survivors.push(grenade);
    }
    this.grenades = survivors;
  }

  /**
   * Resolves a blast.
   *
   * Damage falls linearly with distance so the edge of the radius is a real
   * gradient, not a cliff — that is what makes the drawn radius honest. Cover
   * does not stop a blast (it is an area effect), but a hostile on the far side
   * of a wall from the centre takes nothing, which is the one concession to
   * geometry and keeps the mechanic readable.
   */
  private detonate(at: Vec2, radius: number, damage: number, fromFrag: boolean): void {
    let hits = 0;
    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      const dist = distance(at, enemy.position);
      if (dist > radius + enemy.radius) continue;
      if (!hasLineOfSight(at, enemy.position, this.obstacles)) continue;
      const falloff = 1 - clamp((dist - enemy.radius) / radius, 0, 1);
      if (falloff <= 0) continue;
      this.damageEnemy(enemy, damage * falloff, { ...enemy.position });
      hits += 1;
    }
    // The player is not immune to their own grenade — standing on it hurts.
    const selfDist = distance(at, this.playerPositionRef);
    if (selfDist <= radius + PLAYER_RADIUS) {
      const falloff = 1 - clamp((selfDist - PLAYER_RADIUS) / radius, 0, 1);
      if (falloff > 0) this.damagePlayer(damage * falloff * 0.5);
    }
    this.emit({ type: 'grenade_exploded', at: { ...at }, radius, hits });
    void fromFrag;
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
    const outcome = beginReload(this.player);
    if (outcome.started) {
      // The `quick_hands` upgrade shortens the reload; applying it to the
      // in-flight timer (rather than to a spec) is what makes the card felt
      // immediately, including on a reload already under way when it is taken.
      if (this.modifiers.reloadMultiplier < 1) {
        const state = this.player.weapons[this.player.weapon];
        if (state) state.reloadRemainingMs *= this.modifiers.reloadMultiplier;
      }
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
      bossTelegraphMs: boss?.telegraphMs ?? 0,
      bossTelegraphAttack: boss?.pendingAttack ?? null,
      bossTransitioning: (boss?.phaseTransitionMs ?? 0) > 0,
      elapsedMs: this.elapsedMs,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      damageDealt: this.damageDealt,
      eliminations: this.eliminations,
      bossDefeated: this.bossDefeated,
      adapted: this.adapted,
      idleMs: this.idleMs,
      mode: this.mode,
      deathmatch:
        this.mode === 'deathmatch'
          ? {
              phase: this.dm.phase,
              remainingMs: this.dm.remainingMs,
              playerEliminations: this.dm.playerEliminations,
              playerDeaths: this.dm.playerDeaths,
              opponentEliminations: this.dm.opponentEliminations,
              eliminationTarget: this.dmRules.eliminationTarget,
              playerRespawnMs: this.dm.playerRespawnMs,
              outcome: this.dm.outcome,
            }
          : null,
      dodge: {
        rolling: this.dodgeRemainingMs > 0,
        cooldownMs: this.dodgeCooldownMs,
        cooldownTotalMs: DODGE_COOLDOWN_MS * this.modifiers.dodgeCooldownMultiplier,
        invulnerable: this.dodgeInvulnMs > 0,
      },
      grenades: {
        remaining: this.grenadesRemaining,
        cooldownMs: GRENADE_COOLDOWN_MS,
        cooldownRemainingMs: this.grenadeCooldownMs,
      },
      combo: {
        streak: this.comboStreak,
        multiplier: Math.min(MAX_COMBO_MULTIPLIER, 1 + Math.max(0, this.comboStreak - 1) * COMBO_SCORE_STEP),
        windowRemainingMs: this.comboWindowMs,
      },
      modifiers: { ...this.modifiers },
      upgrades: [...this.upgradesTaken],
      upgradeOffer: [...this.upgradeOffer],
      awaitingUpgrade: this.pendingUpgrade,
      mission: this.missionSnapshot(),
      obstacles: this.obstacles,
    };
  }

  /** The operations subset of a snapshot, or null outside that mode. */
  private missionSnapshot(): MissionSnapshot | null {
    const mission = this.mission;
    const state = this.missionState;
    if (!mission || !state) return null;

    const objective = currentObjective(mission, state);
    const encounter = currentEncounter(mission, state);
    return {
      id: mission.id,
      codename: mission.codename,
      name: mission.name,
      briefing: mission.briefing,
      phase: state.phase,
      objectiveIndex: Math.min(state.objectiveIndex + 1, mission.objectives.length),
      objectiveTotal: mission.objectives.length,
      objectiveLabel: objective?.label ?? 'Mission complete',
      objectiveDetail: objective?.detail ?? '',
      objectiveInstruction: objectiveInstruction(mission, state),
      objectiveProgress: objectiveProgress(mission, state),
      objectivePosition: objective?.position ? { ...objective.position } : null,
      objectiveRadius: objective?.radius ?? null,
      extractionRemainingMs: state.extractionRemainingMs,
      inExtractionZone: state.inExtractionZone,
      encounterIntro: encounter?.intro ?? null,
      holdingPosition: objective?.kind === 'extract' ? state.inExtractionZone : state.objectiveProgressMs > 0,
    };
  }

  /** The player's world position, for the renderer. */
  get playerPos(): Vec2 {
    return { ...this.playerPositionRef };
  }

  get facing(): number {
    return this.playerFacing;
  }

  /** The player's current velocity, for the renderer's locomotion animation.
   * Read-only: the simulation owns it, and nothing outside may steer with it. */
  get playerVelocity(): Vec2 {
    return { ...this.playerVelocityRef };
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
