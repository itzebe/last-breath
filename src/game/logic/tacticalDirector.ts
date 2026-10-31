import { getArchetype, type EnemyArchetypeId, type EnemyStance } from './enemies';
import { MIN_OBSERVATION_SECONDS, type BehaviourTraits } from './behaviour';

/**
 * The tactical director.
 *
 * The observer reports *what the player does*. The director decides *what that
 * means* and issues a single, arena-wide directive that every hostile obeys,
 * scaled by its own archetype weights. That separation is the point: adaptation
 * lives in one auditable place rather than being smeared across enemy update
 * code, and its decisions can be replayed in a test.
 *
 * Stability rules (these are what stop adaptive enemies feeling broken):
 *   - A directive must be committed for `MIN_COMMIT_MS` before it can change.
 *   - A new assessment must beat the incumbent by `SWITCH_MARGIN` confidence.
 *   - Trait scores are already smoothed by the observer, so a directive cannot
 *     flip on a single frame of noise.
 */

export type PlayerProfileId =
  | 'unknown'
  | 'aggressor'
  | 'camper'
  | 'skirmisher'
  | 'marksman'
  | 'predictable'
  | 'attritional';

export interface PlayerProfile {
  readonly id: PlayerProfileId;
  readonly name: string;
  /** One-line, plain-language description. Shown in the debug overlay. */
  readonly reading: string;
  /** 0–1 confidence in this reading. */
  readonly confidence: number;
}

/**
 * A directive is a set of multipliers, not commands. Each hostile applies them
 * through its own archetype weights, so a Rusher and a Marksman respond to the
 * same order in visibly different ways — which is what makes the adaptation
 * read as tactics rather than as a difficulty slider.
 */
export interface TacticalDirective {
  readonly profile: PlayerProfile;
  /** Multiplies each hostile's preferred engagement range. */
  readonly rangeMultiplier: number;
  /** Multiplies movement speed. Kept near 1: adaptation changes *tactics*, not
   * the physics, so the player never feels cheated. */
  readonly speedMultiplier: number;
  /** Pushes hostiles toward or away from the player. */
  readonly pressure: number;
  /** 0–1. How strongly hostiles coordinate (pincer, surround, focus fire). */
  readonly coordination: number;
  /** Preferred stance overrides, keyed by archetype. */
  readonly stanceOverrides: Partial<Record<EnemyArchetypeId, EnemyStance>>;
  /** Relative spawn weights for the next wave, if any are overridden. */
  readonly spawnBias: Partial<Record<EnemyArchetypeId, number>>;
  /** Commit timestamp, for the stability window. */
  readonly committedAtMs: number;
}

export interface AdaptationLogEntry {
  readonly atMs: number;
  readonly profile: PlayerProfileId;
  readonly profileName: string;
  readonly confidence: number;
  readonly reason: string;
}

/** A directive must hold this long before it may be replaced. */
export const MIN_COMMIT_MS = 5000;
/** How much more confident a challenger must be to displace the incumbent. */
export const SWITCH_MARGIN = 0.12;

interface Candidate {
  readonly profile: PlayerProfile;
  /** Uncapped score. The director compares these; the profile's `confidence` is
   * the same number normalised into [0, 1] for display. Comparing capped values
   * would let two strong readings tie at 1.0 and defeat the switch margin. */
  readonly strength: number;
  readonly reason: string;
  readonly rangeMultiplier: number;
  readonly speedMultiplier: number;
  readonly pressure: number;
  readonly coordination: number;
  readonly stanceOverrides: Partial<Record<EnemyArchetypeId, EnemyStance>>;
  readonly spawnBias: Partial<Record<EnemyArchetypeId, number>>;
}

/** Weighted score of a trait, relative to its neutral 0.5 midpoint. */
function intensity(value: number, weight: number): number {
  return Math.max(0, (value - 0.5) * 2) * weight;
}

/**
 * Scores every candidate reading against the observed traits and returns the
 * best-supported one. Exported so tests can assert on the ranking directly.
 */
export function scoreProfiles(traits: BehaviourTraits): Candidate[] {
  const candidates: Omit<Candidate, 'strength'>[] = [];

  // ── AGGRESSOR ─────────────────────────────────────────────────────────────
  // Player closes distance and fires a lot. Counter: give ground, spread out,
  // punish the over-extension with coordinated crossfire.
  candidates.push({
    profile: {
      id: 'aggressor',
      name: 'AGGRESSOR',
      reading: 'Player closes distance and maintains heavy fire. Hostiles will refuse the frontal fight and set crossfires.',
      confidence: 0,
    },
    reason: 'High mobility + high aggression + high fire volume',
    rangeMultiplier: 1.45,
    speedMultiplier: 1.06,
    pressure: -0.35,
    coordination: 0.85,
    stanceOverrides: { rusher: 'hold', flanker: 'encircle', hunter: 'encircle', tank: 'hold' },
    spawnBias: { sniper: 1.5, flanker: 1.35, rusher: 0.7 },
  });

  // ── CAMPER ────────────────────────────────────────────────────────────────
  // Player holds ground. Counter: converge from multiple angles so no single
  // firing lane is safe.
  candidates.push({
    profile: {
      id: 'camper',
      name: 'CAMPER',
      reading: 'Player holds a fixed position. Hostiles will converge from multiple angles to deny a safe lane.',
      confidence: 0,
    },
    reason: 'High stationarity + low mobility',
    rangeMultiplier: 0.6,
    speedMultiplier: 1.1,
    pressure: 0.7,
    coordination: 0.9,
    stanceOverrides: { rusher: 'approach', flanker: 'encircle', sniper: 'reposition', hunter: 'approach' },
    spawnBias: { rusher: 1.5, flanker: 1.4, tank: 1.25, sniper: 0.6 },
  });

  // ── MARKSMAN ──────────────────────────────────────────────────────────────
  // Player fights from range. Counter: close the gap, deny sightlines.
  candidates.push({
    profile: {
      id: 'marksman',
      name: 'MARKSMAN',
      reading: 'Player engages from long range. Hostiles will close the distance and break sightlines.',
      confidence: 0,
    },
    reason: 'High ranged preference + moderate fire volume',
    rangeMultiplier: 0.55,
    speedMultiplier: 1.12,
    pressure: 0.6,
    coordination: 0.65,
    stanceOverrides: { rusher: 'approach', flanker: 'approach', sniper: 'reposition', tank: 'approach' },
    spawnBias: { rusher: 1.45, tank: 1.3, flanker: 1.2, sniper: 0.5 },
  });

  // ── PREDICTABLE ───────────────────────────────────────────────────────────
  // Player circles the same way. Counter: intercept the arc instead of chasing.
  candidates.push({
    profile: {
      id: 'predictable',
      name: 'PREDICTABLE ORBIT',
      reading: 'Player repeats the same movement arc. Hostiles will stop chasing and intercept the path ahead.',
      confidence: 0,
    },
    reason: 'High turn-direction consistency',
    rangeMultiplier: 1.1,
    speedMultiplier: 1.08,
    pressure: 0.25,
    coordination: 1,
    stanceOverrides: { flanker: 'encircle', hunter: 'encircle', rusher: 'reposition', tank: 'reposition' },
    spawnBias: { hunter: 1.6, flanker: 1.35 },
  });

  // ── ATTRITIONAL ───────────────────────────────────────────────────────────
  // Player trades fire and leans on reloads. Counter: escalate pressure during
  // the reload window, which the hunter archetype is built to exploit.
  candidates.push({
    profile: {
      id: 'attritional',
      name: 'ATTRITIONAL',
      reading: 'Player cycles through magazines at a high rate. Hostiles will escalate pressure during reload windows.',
      confidence: 0,
    },
    reason: 'High reload frequency relative to fire volume',
    rangeMultiplier: 0.85,
    speedMultiplier: 1.05,
    pressure: 0.5,
    coordination: 0.8,
    stanceOverrides: { hunter: 'approach', rusher: 'approach', flanker: 'approach', sniper: 'hold' },
    spawnBias: { hunter: 1.7, rusher: 1.3 },
  });

  // ── SKIRMISHER ────────────────────────────────────────────────────────────
  // Balanced, mobile, mid-range. Counter: contest the middle ground and rotate.
  candidates.push({
    profile: {
      id: 'skirmisher',
      name: 'SKIRMISHER',
      reading: 'Player fights at mid-range while moving. Hostiles will contest the middle ground and rotate positions.',
      confidence: 0,
    },
    reason: 'Balanced traits across the board',
    rangeMultiplier: 1,
    speedMultiplier: 1.04,
    pressure: 0.1,
    coordination: 0.6,
    stanceOverrides: { flanker: 'encircle', hunter: 'reposition' },
    spawnBias: {},
  });

  const traitsReady = traits.observedSeconds > 0;

  return candidates.map((candidate) => {
    let raw: number;
    switch (candidate.profile.id) {
      case 'aggressor':
        raw = intensity(traits.aggression, 1.3) + intensity(traits.mobility, 1.0) + intensity(traits.fireVolume, 0.9);
        break;
      case 'camper':
        raw = intensity(traits.stationarity, 1.5) + intensity(traits.defensiveness, 0.6);
        break;
      case 'marksman':
        raw = intensity(traits.rangedPreference, 1.6) + intensity(traits.defensiveness, 0.5);
        break;
      case 'predictable':
        raw = intensity(traits.predictability, 1.7) + intensity(traits.mobility, 0.5);
        break;
      case 'attritional':
        raw = intensity(traits.reloadFrequency, 1.5) + intensity(traits.fireVolume, 0.4);
        break;
      default:
        // SKIRMISHER is the reading of "no strong directional signal": it scores
        // high when every directional trait sits near neutral and collapses as
        // soon as any one of them stands out.
        raw = 0.6 * (1 - Math.max(
          intensity(traits.aggression, 1),
          intensity(traits.stationarity, 1),
          intensity(traits.rangedPreference, 1),
          intensity(traits.predictability, 1),
          intensity(traits.reloadFrequency, 1),
        ));
        break;
    }
    const strength = traitsReady ? Math.max(raw, 0) : 0;
    const confidence = Math.min(strength, 1);
    return { ...candidate, strength, profile: { ...candidate.profile, confidence } };
  });
}

export function rankProfiles(traits: BehaviourTraits): Candidate[] {
  return [...scoreProfiles(traits)].sort((a, b) => b.profile.confidence - a.profile.confidence);
}

/** The directive used before enough behaviour has been observed. It changes
 * nothing: hostiles behave exactly as their archetype prescribes. */
export function neutralDirective(committedAtMs = 0): TacticalDirective {
  return {
    profile: {
      id: 'unknown',
      name: 'BASELINE',
      reading: 'Insufficient observation. Hostiles are operating on doctrine alone.',
      confidence: 0,
    },
    rangeMultiplier: 1,
    speedMultiplier: 1,
    pressure: 0,
    coordination: 0.25,
    stanceOverrides: {},
    spawnBias: {},
    committedAtMs,
  };
}

/**
 * The director. Holds the current directive and decides when to replace it.
 * One instance per match.
 */
export class TacticalDirector {
  private current: TacticalDirective;
  private readonly history: AdaptationLogEntry[] = [];
  private lastChangeAtMs = Number.NEGATIVE_INFINITY;
  /** Set false to freeze adaptation (used by tests and by the "doctrine only" toggle). */
  private enabled: boolean;

  constructor(enabled = true) {
    this.current = neutralDirective(0);
    this.enabled = enabled;
  }

  get directive(): TacticalDirective {
    return this.current;
  }

  get adaptationHistory(): readonly AdaptationLogEntry[] {
    return this.history;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean, nowMs: number): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.current = neutralDirective(nowMs);
      this.pushLog(nowMs, this.current, 'Adaptation disabled — reverted to doctrine');
    } else {
      // Allow an immediate re-assessment after being switched back on.
      this.lastChangeAtMs = Number.NEGATIVE_INFINITY;
    }
  }

  /**
   * Feeds current traits and returns the directive to use. Called on a slow
   * cadence (roughly once per second), not per frame.
   */
  update(traits: BehaviourTraits, nowMs: number): TacticalDirective {
    if (!this.enabled) return this.current;

    const ranked = rankProfiles(traits);
    const best = ranked[0];
    if (!best) return this.current;

    // Until enough behaviour has been seen there is no honest reading to make,
    // so hostiles operate on doctrine alone.
    if (traits.observedSeconds < MIN_OBSERVATION_SECONDS) return this.current;

    if (best.profile.id === this.current.profile.id) {
      // Same reading; refresh confidence so the overlay shows it climbing.
      this.current = { ...this.current, profile: best.profile };
      return this.current;
    }

    // Stability gate: honour the commit window, then require a clear margin.
    const held = nowMs - this.lastChangeAtMs;
    if (held < MIN_COMMIT_MS) return this.current;

    // The incumbent is re-scored against the *current* traits rather than
    // reusing the confidence it held when it was committed. Without this, a
    // reading adopted during a strong signal would keep that confidence forever
    // and freeze adaptation — the margin would become an absolute bar the
    // incumbent never has to clear again.
    const incumbentNow = ranked.find((c) => c.profile.id === this.current.profile.id);
    const incumbentStrength = incumbentNow?.strength ?? 0;

    if (best.strength < incumbentStrength + SWITCH_MARGIN) {
      return this.current;
    }

    this.current = {
      profile: best.profile,
      rangeMultiplier: best.rangeMultiplier,
      speedMultiplier: best.speedMultiplier,
      pressure: best.pressure,
      coordination: best.coordination,
      stanceOverrides: best.stanceOverrides,
      spawnBias: best.spawnBias,
      committedAtMs: nowMs,
    };
    this.lastChangeAtMs = nowMs;
    this.pushLog(nowMs, this.current, best.reason);
    return this.current;
  }

  /** Forces a directive immediately. Used on wave boundaries and in tests. */
  commit(profileId: PlayerProfileId, traits: BehaviourTraits, nowMs: number): TacticalDirective {
    const match = scoreProfiles(traits).find((c) => c.profile.id === profileId);
    if (!match) return this.current;
    this.current = {
      profile: match.profile,
      rangeMultiplier: match.rangeMultiplier,
      speedMultiplier: match.speedMultiplier,
      pressure: match.pressure,
      coordination: match.coordination,
      stanceOverrides: match.stanceOverrides,
      spawnBias: match.spawnBias,
      committedAtMs: nowMs,
    };
    this.lastChangeAtMs = nowMs;
    this.pushLog(nowMs, this.current, `Manual commit: ${match.reason}`);
    return this.current;
  }

  reset(): void {
    this.current = neutralDirective(0);
    this.history.length = 0;
    this.lastChangeAtMs = Number.NEGATIVE_INFINITY;
  }

  private pushLog(nowMs: number, directive: TacticalDirective, reason: string): void {
    this.history.push({
      atMs: Math.round(nowMs),
      profile: directive.profile.id,
      profileName: directive.profile.name,
      confidence: Number(directive.profile.confidence.toFixed(3)),
      reason,
    });
    // Bound the log: the overlay shows recent history, and a long run should not
    // accumulate unbounded memory.
    if (this.history.length > 40) this.history.splice(0, this.history.length - 40);
  }
}

/**
 * Applies a directive to one archetype, returning the tactical parameters that
 * hostile should use. This is the only place archetype weights meet directive
 * values, so the blend is testable in isolation.
 */
export function applyDirective(
  archetypeId: EnemyArchetypeId,
  directive: TacticalDirective,
): {
  preferredRange: number;
  speedMultiplier: number;
  stance: EnemyStance;
  coordination: number;
  /** Extra pressure applied to this archetype specifically. */
  pressure: number;
} {
  const archetype = getArchetype(archetypeId);

  // High-caution archetypes resist being pushed into the player's face; the
  // stance override is honoured but the range is blended rather than replaced.
  const cautionFactor = 1 - archetype.caution * 0.35;
  const effectiveRangeMultiplier = 1 + (directive.rangeMultiplier - 1) * cautionFactor;

  const stance = directive.stanceOverrides[archetypeId] ?? archetype.defaultStance;

  // Coordination is strongest for archetypes that are built to coordinate.
  const coordination = directive.coordination * archetype.coordination;

  return {
    preferredRange: Math.max(20, archetype.preferredRange * effectiveRangeMultiplier),
    speedMultiplier: 1 + (directive.speedMultiplier - 1) * archetype.aggression,
    stance,
    coordination,
    pressure: directive.pressure * archetype.aggression,
  };
}

/** Human-readable summary used by the debug overlay header. */
export function describeDirective(directive: TacticalDirective): string {
  const range = directive.rangeMultiplier > 1.05 ? 'hold range' : directive.rangeMultiplier < 0.95 ? 'close in' : 'maintain range';
  const push = directive.pressure > 0.2 ? 'escalating pressure' : directive.pressure < -0.2 ? 'giving ground' : 'steady pressure';
  return `${directive.profile.name} — ${range}, ${push}, coordination ${Math.round(directive.coordination * 100)}%`;
}
