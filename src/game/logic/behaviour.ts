/**
 * Behaviour observation.
 *
 * The observer turns raw player telemetry into normalised, *smoothed* trait
 * scores in [0, 1]. Two properties matter and are deliberate:
 *
 *  1. It only uses information a hostile could plausibly have. Position and
 *     firing are sampled from events the arena already broadcasts (the player's
 *     visible position, visible muzzle flashes, audible reloads). Nothing here
 *     reads the player's input buffer, intent or hidden state. The AI observes
 *     behaviour, not inputs.
 *
 *  2. It is rate-limited and smoothed. A single frame of standing still does not
 *     make a player "camping"; the score moves toward the observation rather than
 *     snapping to it. This is what prevents the unstable, jittery behaviour that
 *     makes adaptive enemies feel broken rather than clever.
 */

export interface PlayerTelemetrySample {
  /** Milliseconds since the previous sample. */
  dtMs: number;
  /** Player speed this frame, in arena units per second. */
  speed: number;
  /** Distance to the nearest hostile. */
  nearestEnemyDistance: number;
  /** True if a shot was fired during this sample window. */
  didFire: boolean;
  /** True if a reload started during this sample window. */
  didReload: boolean;
  /** Player heading in radians; used to detect circling. */
  heading: number;
  /** Arena width/height, for normalising distance. */
  arenaWidth: number;
  arenaHeight: number;
}

export interface BehaviourTraits {
  /** 1 = never stops moving. */
  mobility: number;
  /** 1 = finds a spot and holds it. */
  stationarity: number;
  /** 1 = engages from far away. */
  rangedPreference: number;
  /** 1 = fires constantly. */
  fireVolume: number;
  /** 1 = repeats the same movement direction (circling one way). */
  predictability: number;
  /** 1 = reloads often relative to firing (a habit that can be punished). */
  reloadFrequency: number;
  /** 1 = pushes toward hostiles. */
  aggression: number;
  /** 1 = keeps hostiles at arm's length. */
  defensiveness: number;
  /** Total observation time, in seconds. */
  observedSeconds: number;
}

export const NEUTRAL_TRAITS: Readonly<BehaviourTraits> = Object.freeze({
  mobility: 0.5,
  stationarity: 0.5,
  rangedPreference: 0.5,
  fireVolume: 0.5,
  predictability: 0.5,
  reloadFrequency: 0.5,
  aggression: 0.5,
  defensiveness: 0.5,
  observedSeconds: 0,
});

/** How fast each trait moves toward a new observation, per second of play.
 * Higher = more responsive but noisier. Tuned so a decisive change takes
 * roughly 4–8 seconds to register. */
const RESPONSIVENESS = 0.22;

/** A player must be observed this long before adaptation is allowed to engage. */
export const MIN_OBSERVATION_SECONDS = 6;

/** Distance below which an engagement counts as "close", in arena units. */
const CLOSE_ENGAGEMENT = 150;
/** Distance above which an engagement counts as "long range". */
const LONG_ENGAGEMENT = 400;

function approach(current: number, target: number, rate: number, dtSeconds: number): number {
  const clamped = Math.min(Math.max(target, 0), 1);
  const delta = clamped - current;
  const step = rate * dtSeconds;
  if (Math.abs(delta) <= step) return clamped;
  return current + Math.sign(delta) * step;
}

/**
 * Accumulates player telemetry into behaviour traits. One instance per match.
 */
export class BehaviourObserver {
  private traits: BehaviourTraits = { ...NEUTRAL_TRAITS };
  private lastHeading: number | null = null;
  /** Rolling turn-direction tally; a strong imbalance means circling. */
  private turnBalance = 0;
  private totalSamples = 0;
  private firedSamples = 0;
  private reloadSamples = 0;
  private stationaryMs = 0;
  private totalMs = 0;
  private distanceSum = 0;

  /** Feeds one sample and returns the updated traits. */
  observe(sample: PlayerTelemetrySample): BehaviourTraits {
    const dtSeconds = Math.max(sample.dtMs, 0) / 1000;
    if (dtSeconds <= 0) return this.snapshot();

    this.totalSamples += 1;
    this.totalMs += sample.dtMs;
    this.distanceSum += sample.nearestEnemyDistance;
    if (sample.didFire) this.firedSamples += 1;
    if (sample.didReload) this.reloadSamples += 1;

    const isMoving = sample.speed > 12;
    if (!isMoving) this.stationaryMs += sample.dtMs;

    // ── Heading repeatability ────────────────────────────────────────────────
    if (this.lastHeading !== null) {
      let delta = sample.heading - this.lastHeading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (isMoving && Math.abs(delta) > 0.004) {
        this.turnBalance += Math.sign(delta);
      }
    }
    this.lastHeading = sample.heading;

    const t = this.traits;
    const observedSeconds = this.totalMs / 1000;

    // Mobility and stationarity are complements derived from the same fact, so
    // they can never both read "high" and contradict each other.
    const mobilityTarget = isMoving ? 1 : 0;
    t.mobility = approach(t.mobility, mobilityTarget, RESPONSIVENESS, dtSeconds);
    t.stationarity = 1 - t.mobility;

    // Engagement distance: close pushes rangedPreference down, long pushes it up.
    const rangedTarget =
      sample.nearestEnemyDistance <= CLOSE_ENGAGEMENT
        ? 0.15
        : sample.nearestEnemyDistance >= LONG_ENGAGEMENT
          ? 0.9
          : 0.15 + 0.75 * ((sample.nearestEnemyDistance - CLOSE_ENGAGEMENT) / (LONG_ENGAGEMENT - CLOSE_ENGAGEMENT));
    t.rangedPreference = approach(t.rangedPreference, rangedTarget, RESPONSIVENESS * 0.8, dtSeconds);

    // Fire volume: smoothed ratio of firing frames, scaled so ~1 shot/frame = 1.
    const fireRatio = this.totalSamples > 0 ? this.firedSamples / this.totalSamples : 0;
    t.fireVolume = approach(t.fireVolume, Math.min(fireRatio * 2.2, 1), RESPONSIVENESS * 0.7, dtSeconds);

    // Predictability: consistent turn direction. Normalised against elapsed time.
    const turnsPerSecond = observedSeconds > 0 ? Math.abs(this.turnBalance) / observedSeconds : 0;
    t.predictability = approach(t.predictability, Math.min(turnsPerSecond / 1.6, 1), RESPONSIVENESS * 0.6, dtSeconds);

    // Reload frequency relative to firing; a player who fires little but reloads
    // often is burning cycles, which is exploitable.
    const reloadRatio = this.totalSamples > 0 ? this.reloadSamples / this.totalSamples : 0;
    t.reloadFrequency = approach(t.reloadFrequency, Math.min(reloadRatio * 6, 1), RESPONSIVENESS * 0.5, dtSeconds);

    // Aggression / defensiveness: closing distance while firing reads aggressive.
    const aggressionTarget = isMoving && sample.nearestEnemyDistance < LONG_ENGAGEMENT ? 0.85 : 0.25;
    t.aggression = approach(t.aggression, aggressionTarget, RESPONSIVENESS * 0.75, dtSeconds);
    t.defensiveness = 1 - t.aggression;

    t.observedSeconds = observedSeconds;
    return this.snapshot();
  }

  snapshot(): BehaviourTraits {
    return { ...this.traits };
  }

  /** True once enough behaviour has been seen for adaptation to be meaningful. */
  isReady(): boolean {
    return this.traits.observedSeconds >= MIN_OBSERVATION_SECONDS;
  }

  reset(): void {
    this.traits = { ...NEUTRAL_TRAITS };
    this.lastHeading = null;
    this.turnBalance = 0;
    this.totalSamples = 0;
    this.firedSamples = 0;
    this.reloadSamples = 0;
    this.stationaryMs = 0;
    this.totalMs = 0;
    this.distanceSum = 0;
  }

  /** Diagnostics for the debug overlay. */
  stats(): { averageDistance: number; stationaryFraction: number; observedSeconds: number } {
    return {
      averageDistance: this.totalSamples > 0 ? this.distanceSum / this.totalSamples : 0,
      stationaryFraction: this.totalMs > 0 ? this.stationaryMs / this.totalMs : 0,
      observedSeconds: this.traits.observedSeconds,
    };
  }
}
