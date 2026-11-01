import { getArchetype, type EnemyArchetypeId } from './enemies';
import { hasLineOfSight, type Obstacle } from './obstacles';
import { add, clamp, distance, normalise, scale, sub, vec, type Vec2 } from './vec';

/**
 * Tactical enemy behaviour.
 *
 * Part 2 gave every hostile one arena-wide directive from the adaptive
 * director. Part 3 adds the layer underneath it: each hostile now *perceives*
 * (line of sight, memory of where the player was), *coordinates* (squads,
 * a commander, focus angles) and *commits* (reload, take cover, suppress,
 * revive). The director still sets the mood; this module decides what an
 * individual soldier does about it.
 *
 * Three rules are non-negotiable, because they are what separate tactics from
 * cheating:
 *
 *  1. **No impossible knowledge.** A hostile can only act on the player's
 *     position while it can actually see them, or for a bounded memory window
 *     afterwards. When the memory expires the hostile genuinely does not know,
 *     and it searches. Every function here takes sight as an input; nothing
 *     reads the player's true position behind the AI's back.
 *  2. **Every dangerous attack telegraphs.** A sniper's shot is preceded by a
 *     visible aim charge, the commander's reinforcement call by a visible
 *     signal. The player always gets a window to react.
 *  3. **Determinism.** No randomness: the same world state always produces the
 *     same decision, so every rule here can be pinned by a unit test.
 */

export type TacticalRole =
  | 'assault'
  | 'flanker'
  | 'sniper'
  | 'heavy'
  | 'hunter'
  | 'commander'
  | 'medic';

/** The role a hostile falls back to when nothing else applies. */
export const ROLE_FOR_ARCHETYPE: Readonly<Record<EnemyArchetypeId, TacticalRole>> = Object.freeze({
  rusher: 'assault',
  flanker: 'flanker',
  sniper: 'sniper',
  tank: 'heavy',
  hunter: 'hunter',
  commander: 'commander',
  medic: 'medic',
  executor: 'heavy',
});

/* ── Perception ───────────────────────────────────────────────────────────── */

/** How far each archetype can see, in arena units. */
export function sightRangeFor(archetypeId: EnemyArchetypeId): number {
  switch (archetypeId) {
    case 'sniper':
      return 980;
    case 'commander':
      return 820;
    case 'hunter':
      return 780;
    case 'medic':
      return 620;
    case 'flanker':
      return 720;
    case 'executor':
      return 1000;
    default:
      return 660;
  }
}

/** How long a hostile remembers the player after losing sight, in ms. */
export const MEMORY_MS = 5200;
/** Once memory has this little left, the hostile is actively searching. */
export const SEARCH_THRESHOLD_MS = 1400;

/**
 * The side of one sector of the facility's coarse threat tracking, in pixels.
 *
 * Hostiles that have never made contact with the player, or that have lost them
 * entirely, still know *roughly* which part of the arena they are in. The grid
 * is deliberately coarse — 260px, comfortably inside the shortest sight range —
 * so it can only ever start an encounter, never win one: a hostile still has to
 * close to visual range and pass a line-of-sight check before it can shoot.
 */
export const HUNT_GRID = 260;

/**
 * The centre of the sector the player is currently in.
 *
 * This is the fallback a hostile moves toward when it has no memory and no
 * sight. It is a *sector*, not a position: it cannot be used for aiming, and
 * because the grid is smaller than every archetype's sight range, a hostile
 * that arrives at the sector centre will acquire the player legitimately.
 */
export function coarseHuntTarget(playerPosition: Vec2, grid = HUNT_GRID): Vec2 {
  return vec(
    (Math.floor(playerPosition.x / grid) + 0.5) * grid,
    (Math.floor(playerPosition.y / grid) + 0.5) * grid,
  );
}

/** How far a gunshot carries in the arena, in pixels. */
export const GUNFIRE_HEARING_RADIUS = 1500;

export interface Awareness {
  /** The last position the hostile actually saw the player at, or null. */
  lastKnown: Vec2 | null;
  /** Milliseconds since the player was last visible. */
  msSinceSeen: number;
  /** True once the player has ever been seen, so a hostile that has never had
   * contact does not "remember" a position it never had. */
  everSeen: boolean;
}

export function createAwareness(): Awareness {
  return { lastKnown: null, msSinceSeen: Number.POSITIVE_INFINITY, everSeen: false };
}

/**
 * Advances one hostile's knowledge of the player.
 *
 * Visible → the position is refreshed and the memory clock resets. Not visible →
 * the memory ages, and past `memoryMs` the hostile genuinely forgets (the
 * position is dropped, not kept stale forever). This is the whole anti-cheat:
 * there is no path by which a hostile learns a position it could not see.
 */
export function updateAwareness(
  awareness: Awareness,
  dtMs: number,
  visible: boolean,
  playerPosition: Vec2,
  memoryMs = MEMORY_MS,
): Awareness {
  if (visible) {
    return { lastKnown: { ...playerPosition }, msSinceSeen: 0, everSeen: true };
  }
  const msSinceSeen = awareness.msSinceSeen + dtMs;
  if (awareness.lastKnown && msSinceSeen > memoryMs) {
    return { lastKnown: null, msSinceSeen, everSeen: awareness.everSeen };
  }
  return { lastKnown: awareness.lastKnown, msSinceSeen, everSeen: awareness.everSeen };
}

/** True while the hostile believes it knows where the player is. */
export function isAlerted(awareness: Awareness): boolean {
  return awareness.lastKnown !== null;
}

/**
 * True while the hostile has lost sight but still remembers — the state in
 * which a HUNTER sweeps toward the last-known position rather than idling.
 */
export function isSearching(awareness: Awareness, memoryMs = MEMORY_MS): boolean {
  return awareness.lastKnown !== null && awareness.msSinceSeen > SEARCH_THRESHOLD_MS && awareness.msSinceSeen <= memoryMs;
}

/** Whether a hostile with this archetype can currently see the player. */
export function canSeePlayer(
  from: Vec2,
  playerPosition: Vec2,
  archetypeId: EnemyArchetypeId,
  obstacles: readonly Obstacle[],
  sightMultiplier = 1,
): boolean {
  const range = sightRangeFor(archetypeId) * sightMultiplier;
  if (distance(from, playerPosition) > range) return false;
  return hasLineOfSight(from, playerPosition, obstacles);
}

/* ── Squad coordination ───────────────────────────────────────────────────── */

export interface SquadMember {
  readonly id: number;
  readonly position: Vec2;
  readonly role: TacticalRole;
  readonly health: number;
  readonly maxHealth: number;
}

/** Hostiles within this distance of each other are treated as one squad. */
export const SQUAD_RADIUS = 420;
/** A squad needs at least this many members before it can elect a commander. */
export const SQUAD_MIN_SIZE = 3;

/**
 * Groups hostiles into squads by single-linkage proximity.
 *
 * Clustering (rather than a fixed grid) means a squad is a *situational* fact:
 * hostiles that drift apart stop coordinating, and hostiles that converge start.
 * That is what makes the coordination read as tactics rather than as a global
 * difficulty dial. Deterministic: members are processed in id order.
 */
export function clusterSquads(members: readonly SquadMember[], radius = SQUAD_RADIUS): number[][] {
  const sorted = [...members].sort((a, b) => a.id - b.id);
  const assigned = new Map<number, number>();
  const clusters: number[][] = [];

  for (const member of sorted) {
    if (assigned.has(member.id)) continue;
    const clusterIndex = clusters.length;
    const cluster: number[] = [member.id];
    assigned.set(member.id, clusterIndex);
    // Breadth-first expansion: pull in every member within `radius` of any
    // member already in the cluster.
    const queue = [member];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const candidate of sorted) {
        if (assigned.has(candidate.id)) continue;
        if (distance(current.position, candidate.position) <= radius) {
          assigned.set(candidate.id, clusterIndex);
          cluster.push(candidate.id);
          queue.push(candidate);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * Chooses the acting commander of a squad.
 *
 * A dedicated COMMANDER archetype always wins; otherwise the healthiest member
 * leads. Electing from the existing squad (rather than requiring a commander to
 * spawn) is what lets coordination appear in every mode, and it is deterministic
 * so a test can predict exactly who leads.
 */
export function electCommander(members: readonly SquadMember[]): number | null {
  if (members.length < SQUAD_MIN_SIZE) return null;
  let best: SquadMember | null = null;
  for (const member of members) {
    if (!best) {
      best = member;
      continue;
    }
    const bestIsCommander = best.role === 'commander';
    const candidateIsCommander = member.role === 'commander';
    if (candidateIsCommander && !bestIsCommander) {
      best = member;
      continue;
    }
    if (candidateIsCommander === bestIsCommander) {
      // Compare by health fraction, then by id for a stable tie-break.
      const bestFraction = best.maxHealth > 0 ? best.health / best.maxHealth : 0;
      const candidateFraction = member.maxHealth > 0 ? member.health / member.maxHealth : 0;
      if (
        candidateFraction > bestFraction ||
        (candidateFraction === bestFraction && member.id < best.id)
      ) {
        best = member;
      }
    }
  }
  return best?.id ?? null;
}

/**
 * The approach angles a squad should fan out across, in radians relative to the
 * direction from the squad centre to the target.
 *
 * A commander pushes its squad into a pincer rather than a conga line: each
 * member gets its own offset so they converge from different bearings. With one
 * member the offset is zero (no fake coordination for a lone hostile).
 */
export function squadFocusAngles(memberCount: number, spreadRadians = Math.PI * 0.9): number[] {
  if (memberCount <= 0) return [];
  if (memberCount === 1) return [0];
  const step = spreadRadians / (memberCount - 1);
  return Array.from({ length: memberCount }, (_, i) => -spreadRadians / 2 + i * step);
}

/* ── Cover ────────────────────────────────────────────────────────────────── */

export interface CoverDecision {
  /** Where to move to, or null when no useful cover exists. */
  readonly position: Vec2 | null;
  /** The cover value at that position, 0–1. */
  readonly value: number;
}

/**
 * The highest cover urgency each role can reach.
 *
 *
 * This is doctrine, not a tuning knob. A rusher's identity is that it advances
 * through fire — if suppression could make it camp behind a crate, the player
 * would simply hold a lane and the arena would stall. So the assault roles are
 * capped *below* the cover-seeking threshold: they still feel suppressed (their
 * accuracy and speed suffer), but they never stop coming. Only the roles whose
 * doctrine is to hold ground — the marksman, the commander and the medic — can
 * reach the threshold and actually take cover.
 */
const COVER_CEILING: Readonly<Record<TacticalRole, number>> = Object.freeze({
  assault: 0.4,
  flanker: 0.42,
  hunter: 0.42,
  heavy: 0.44,
  medic: 0.85,
  commander: 0.95,
  sniper: 1,
});

/** Urgency at or above which a hostile will commit to a piece of cover. */
export const COVER_COMMIT_THRESHOLD = 0.45;

export function coverUrgency(
  role: TacticalRole,
  context: { suppressed: boolean; reloading: boolean; healthFraction: number; underPressure: boolean },
): number {
  const base: Record<TacticalRole, number> = {
    assault: 0.15,
    flanker: 0.35,
    sniper: 0.7,
    heavy: 0.3,
    hunter: 0.45,
    commander: 0.6,
    medic: 0.5,
  };
  let urgency = base[role];
  if (context.suppressed) urgency += 0.4;
  if (context.reloading) urgency += 0.25;
  if (context.healthFraction < 0.4) urgency += 0.25;
  if (context.underPressure) urgency += 0.2;
  return clamp(urgency, 0, COVER_CEILING[role]);
}

/* ── Reload decisions ─────────────────────────────────────────────────────── */

/**
 * Whether a hostile should reload now.
 *
 * Reloading is a *decision with a cost*, not an automatic refill: a hostile
 * reloads when its magazine is dry (always), or when it has a quiet moment —
 * no line of sight to the player — and is below half. A hostile with sight and
 * a partly-full magazine keeps firing, which is what makes the reload windows
 * the player can punish feel earned rather than scripted.
 */
export function shouldReload(
  ammoInMagazine: number,
  magazineSize: number,
  hasSight: boolean,
  reloadRemainingMs: number,
): boolean {
  if (reloadRemainingMs > 0) return false;
  if (ammoInMagazine <= 0) return true;
  const fraction = magazineSize > 0 ? ammoInMagazine / magazineSize : 0;
  return !hasSight && fraction < 0.5;
}

/* ── Medic ────────────────────────────────────────────────────────────────── */

export interface ReviveTarget {
  readonly id: number;
  readonly position: Vec2;
  readonly distance: number;
}

/**
 * Picks the nearest downed ally a medic should move to revive.
 *
 * Returns null when nothing is down or nothing is close enough, so a medic with
 * no patient simply fights like everyone else rather than hovering.
 */
export function findReviveTarget(
  medicPosition: Vec2,
  downed: readonly { id: number; position: Vec2 }[],
  maxDistance = 460,
): ReviveTarget | null {
  let best: ReviveTarget | null = null;
  for (const ally of downed) {
    const d = distance(medicPosition, ally.position);
    if (d > maxDistance) continue;
    if (!best || d < best.distance) best = { id: ally.id, position: { ...ally.position }, distance: d };
  }
  return best;
}

/** How long a medic must stay on a downed ally before it is revived, in ms. */
export const REVIVE_CHANNEL_MS = 2200;
/** Health a revived ally comes back with, as a fraction of its maximum. */
export const REVIVE_HEALTH_FRACTION = 0.4;

/* ── Suppression ──────────────────────────────────────────────────────────── */

/** Milliseconds a hostile stays suppressed after a near miss or a hit. */
export const SUPPRESSION_MS = 1600;

/** Records incoming fire near a hostile and returns the new suppression timer. */
export function applySuppression(currentMs: number, incoming: boolean): number {
  return incoming ? SUPPRESSION_MS : Math.max(0, currentMs);
}

/* ── Commander reinforcement call ─────────────────────────────────────────── */

/** Minimum milliseconds between two reinforcement calls by the same commander. */
export const REINFORCEMENT_COOLDOWN_MS = 14_000;
/** A commander calls reinforcements only when its squad has been thinned below this. */
export const REINFORCEMENT_SQUAD_THRESHOLD = 2;
/** Never let a commander call for more than this many reinforcements in a run. */
export const MAX_REINFORCEMENTS_PER_COMMANDER = 3;

/**
 * Whether a commander should call in reinforcements this frame.
 *
 * The call is deliberately conservative — a squad must be nearly wiped out, the
 * cooldown must have elapsed, and there is a hard per-commander cap — so a
 * commander extends a fight rather than making it unwinnable.
 */
export function shouldCallReinforcements(
  squadSize: number,
  cooldownRemainingMs: number,
  callsMade: number,
): boolean {
  return (
    squadSize <= REINFORCEMENT_SQUAD_THRESHOLD &&
    cooldownRemainingMs <= 0 &&
    callsMade < MAX_REINFORCEMENTS_PER_COMMANDER
  );
}

/* ── Sniper telegraph ─────────────────────────────────────────────────────── */

/** Milliseconds a sniper spends visibly aiming before a shot is released. */
export const SNIPER_CHARGE_MS = 780;

/**
 * Whether a sniper may begin charging a shot. It needs sight, range, and a
 * settled aim — which is what turns "the marksman is dangerous" into a readable
 * laser line the player can break by moving out of it.
 */
export function canBeginSniperCharge(hasSight: boolean, dist: number, cooldownRemainingMs: number): boolean {
  const archetype = getArchetype('sniper');
  return hasSight && dist <= archetype.rangedRange && cooldownRemainingMs <= 0;
}

/* ── Movement intent ──────────────────────────────────────────────────────── */

export interface MovementIntent {
  readonly desiredDirection: Vec2;
  /** True when the hostile wants to be moving this frame. */
  readonly moving: boolean;
}

function toward(from: Vec2, to: Vec2): Vec2 {
  return normalise(sub(to, from));
}

/**
 * The desired movement direction for a role, given the situation.
 *
 * Each branch is one doctrine. They share `lastKnown` (never the live player
 * position unless the hostile can see them), which is the mechanism that makes
 * a hostile that has lost sight visibly search instead of tracking.
 */
export function movementForRole(
  role: TacticalRole,
  context: {
    position: Vec2;
    /** Where the hostile believes the player is. */
    target: Vec2;
    /** True when the hostile can actually see the player. */
    hasSight: boolean;
    distanceToTarget: number;
    preferredRange: number;
    approachOffset: number;
    coverPosition: Vec2 | null;
    reviveTarget: Vec2 | null;
  },
): MovementIntent {
  const { position, target, hasSight, distanceToTarget, preferredRange, approachOffset, coverPosition, reviveTarget } =
    context;
  const direction = toward(position, target);

  // A medic with a patient drops everything and goes to them.
  if (role === 'medic' && reviveTarget) {
    return { desiredDirection: toward(position, reviveTarget), moving: true };
  }

  // Cover always wins when it has been chosen: the whole point of cover is that
  // it interrupts what the hostile was doing.
  if (coverPosition) {
    return { desiredDirection: toward(position, coverPosition), moving: true };
  }

  // Lost contact: sweep toward the last-known position and stop there.
  if (!hasSight) {
    if (distanceToTarget <= 60) return { desiredDirection: vec(), moving: false };
    return { desiredDirection: direction, moving: true };
  }

  switch (role) {
    case 'assault': {
      // Straight in, no patience.
      return { desiredDirection: direction, moving: true };
    }
    case 'flanker': {
      // Approach along an arc so the front line is never where it arrives.
      const tangent = vec(-direction.y, direction.x);
      const inward = clamp((distanceToTarget - preferredRange) / 260, -0.3, 1);
      return {
        desiredDirection: normalise(add(scale(direction, inward), scale(tangent, Math.sin(approachOffset) * 0.95))),
        moving: true,
      };
    }
    case 'hunter': {
      // Cut the corner: aim at where the player will be, not where they are.
      const tangent = vec(-direction.y, direction.x);
      const lead = clamp(distanceToTarget / 420, 0, 1);
      return {
        desiredDirection: normalise(add(scale(direction, 0.75), scale(tangent, Math.sin(approachOffset) * lead))),
        moving: true,
      };
    }
    case 'sniper': {
      // Hold the long line. Back off when crowded, settle when in the band.
      const error = distanceToTarget - preferredRange;
      if (Math.abs(error) <= 90) return { desiredDirection: vec(), moving: false };
      return { desiredDirection: scale(direction, Math.sign(error)), moving: true };
    }
    case 'heavy': {
      // Advance, slowly, ignoring fire.
      return { desiredDirection: direction, moving: true };
    }
    case 'commander': {
      // Stay at the back of the squad and keep the squad between itself and the
      // player: a commander that leads from the front stops being a commander.
      const error = distanceToTarget - Math.max(preferredRange, 320);
      if (Math.abs(error) <= 60) return { desiredDirection: vec(), moving: false };
      return { desiredDirection: scale(direction, Math.sign(error)), moving: true };
    }
    default:
      return { desiredDirection: direction, moving: true };
  }
}

/**
 * The focus point a squad member should converge on.
 *
 * The commander shares its own last-known position with the squad, so a squad
 * that has lost sight of the player searches the *same* place instead of
 * scattering. With no commander the member uses its own memory.
 */
export function squadTarget(ownMemory: Vec2 | null, commanderMemory: Vec2 | null, hasSight: boolean, playerPosition: Vec2): Vec2 | null {
  if (hasSight) return { ...playerPosition };
  return commanderMemory ?? ownMemory;
}
