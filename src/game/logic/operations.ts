import { clamp } from './vec';

/**
 * OPERATIONS — mission-based mode.
 *
 * Survival is an endurance test and Deathmatch is a clock. Operations is a
 * *route*: a briefing, a sequence of encounters, at least one objective that is
 * interacted with rather than shot, and an extraction that has to be held. It is
 * a third ruleset over the same arena, the same enemies and the same weapons —
 * nothing about combat changes, only what the player is asked to do with it.
 *
 * Everything here is pure and clock-free so the mission can be advanced
 * deterministically in a test, and so the mission script is data rather than
 * control flow buried in the simulation.
 */

export type ObjectiveKind =
  | 'clear'
  | 'reach'
  | 'interact'
  | 'hold'
  | 'survive'
  | 'extract';

export interface Objective {
  readonly id: string;
  readonly kind: ObjectiveKind;
  /** Shown in the HUD objective tracker. */
  readonly label: string;
  /** Optional sub-line, e.g. "Hold for 30s". */
  readonly detail?: string;
  /** Where the objective is anchored, if it is positional. */
  readonly position?: { readonly x: number; readonly y: number };
  /** Radius for `reach`/`interact`/`extract` objectives. */
  readonly radius?: number;
  /** Duration in ms for `hold`/`survive`. */
  readonly durationMs?: number;
  /** For `clear`: how many hostiles must be eliminated during the encounter. */
  readonly requiredKills?: number;
}

export interface Encounter {
  readonly id: string;
  /** Hostiles in this encounter. Scaled by the mission's difficulty. */
  readonly enemies: readonly string[];
  /** Milliseconds between spawn batches. */
  readonly spawnIntervalMs: number;
  /** How many may be alive at once. */
  readonly maxConcurrent: number;
  /** Banner shown when the encounter begins. */
  readonly intro: string;
}

export interface Mission {
  readonly id: string;
  readonly codename: string;
  readonly name: string;
  /** One-paragraph briefing shown before the mission starts. */
  readonly briefing: string;
  readonly objectives: readonly Objective[];
  readonly encounters: readonly Encounter[];
  /** How long the extraction countdown runs once the player is inside. */
  readonly extractionMs: number;
  /** Grace period before the extraction timer starts. */
  readonly extractionGraceMs: number;
}

/**
 * OPERATION: LAST EXIT — the vertical slice.
 *
 * The route: fight out of the entry hall, reach the relay and hold it while it
 * uploads, then fight through the yard to the extraction pad and hold it until
 * the transport arrives. The relay is the interaction objective; the pad is the
 * extraction. Both are positional, so the player is always being asked to *go
 * somewhere and do something*, which is what makes this a mission rather than a
 * wave list.
 */
const LAST_EXIT_OBJECTIVES: readonly Objective[] = [
  {
    id: 'obj-clear-entry',
      kind: 'clear',
      label: 'Break out of the entry hall',
      detail: 'Eliminate the reception force',
      requiredKills: 6,
    },
    {
      id: 'obj-reach-relay',
      kind: 'reach',
      label: 'Reach the relay',
      detail: 'Move to the marked terminal',
      position: { x: 1750, y: 320 },
      radius: 90,
    },
    {
      id: 'obj-hold-relay',
      kind: 'interact',
      label: 'Hold the relay',
      detail: 'Defend the terminal while it uploads',
      position: { x: 1750, y: 320 },
      radius: 170,
      durationMs: 22_000,
    },
    {
      id: 'obj-clear-yard',
      kind: 'clear',
      label: 'Clear the yard',
      detail: 'Break the cordon',
      requiredKills: 10,
    },
    {
      id: 'obj-reach-pad',
      kind: 'reach',
      label: 'Reach the extraction pad',
      detail: 'Move to the marked landing zone',
      position: { x: 460, y: 1280 },
      radius: 100,
    },
    {
      id: 'obj-extract',
      kind: 'extract',
      label: 'Hold for extraction',
      detail: 'Survive until the transport lands',
      position: { x: 460, y: 1280 },
      radius: 140,
      durationMs: 30_000,
    },
];

const LAST_EXIT_ENCOUNTERS: readonly Encounter[] = [
  {
    id: 'enc-entry',
      enemies: ['rusher', 'rusher', 'rusher', 'rusher', 'flanker', 'flanker', 'rusher', 'rusher'],
      spawnIntervalMs: 900,
      maxConcurrent: 5,
      intro: 'ENTRY HALL — RECEPTION FORCE',
    },
    {
      id: 'enc-corridor',
      enemies: ['rusher', 'flanker', 'sniper', 'rusher', 'hunter', 'flanker', 'sniper', 'rusher'],
      spawnIntervalMs: 820,
      maxConcurrent: 6,
      intro: 'SERVICE CORRIDOR — CONTACT',
    },
    {
      id: 'enc-relay-defence',
      enemies: ['rusher', 'flanker', 'hunter', 'tank', 'sniper', 'commander', 'rusher', 'medic', 'flanker', 'hunter'],
      spawnIntervalMs: 760,
      maxConcurrent: 7,
      intro: 'RELAY UNDER ATTACK — HOLD POSITION',
    },
    {
      id: 'enc-yard',
      enemies: ['hunter', 'tank', 'sniper', 'commander', 'flanker', 'medic', 'rusher', 'hunter', 'tank', 'flanker', 'sniper', 'rusher'],
      spawnIntervalMs: 700,
      maxConcurrent: 8,
      intro: 'YARD — HEAVY RESISTANCE',
    },
    {
      id: 'enc-extraction',
      enemies: ['hunter', 'tank', 'commander', 'hunter', 'sniper', 'medic', 'flanker', 'rusher', 'tank', 'hunter', 'flanker', 'sniper', 'rusher', 'commander'],
      spawnIntervalMs: 620,
      maxConcurrent: 9,
      intro: 'EXTRACTION PAD — FINAL ASSAULT',
    },
];

export const LAST_EXIT: Mission = Object.freeze({
  id: 'last_exit',
  codename: 'LAST EXIT',
  name: 'Operation: Last Exit',
  briefing:
    'The arena is overrun and the perimeter is closing. Get to the relay, hold it while the extraction request uploads, then fight your way to the pad and survive until the transport arrives. Nobody is coming to help.',
  objectives: LAST_EXIT_OBJECTIVES,
  encounters: LAST_EXIT_ENCOUNTERS,
  extractionMs: 30_000,
  extractionGraceMs: 2_500,
});

export const MISSIONS: Readonly<Record<string, Mission>> = Object.freeze({
  [LAST_EXIT.id]: LAST_EXIT,
});

/** How far the mission has got. */
export type MissionPhase = 'briefing' | 'active' | 'extraction' | 'complete' | 'failed';

export interface MissionState {
  phase: MissionPhase;
  /** Index into `mission.objectives`. */
  objectiveIndex: number;
  /** Index into `mission.encounters`. */
  encounterIndex: number;
  /** Milliseconds accumulated toward a `hold`/`interact`/`survive` objective. */
  objectiveProgressMs: number;
  /** Kills recorded during the current `clear` objective. */
  objectiveKills: number;
  /** Milliseconds left on the extraction countdown. */
  extractionRemainingMs: number;
  /** Milliseconds the player has been *outside* the extraction zone. */
  extractionAwayMs: number;
  /** True while the player is inside the extraction zone. */
  inExtractionZone: boolean;
  /** Total hostiles spawned across the mission, for the results screen. */
  spawned: number;
}

export function createMissionState(mission: Mission): MissionState {
  return {
    phase: 'briefing',
    objectiveIndex: 0,
    encounterIndex: 0,
    objectiveProgressMs: 0,
    objectiveKills: 0,
    extractionRemainingMs: mission.extractionMs,
    extractionAwayMs: 0,
    inExtractionZone: false,
    spawned: 0,
  };
}

export function currentObjective(mission: Mission, state: MissionState): Objective | null {
  return mission.objectives[state.objectiveIndex] ?? null;
}

export function currentEncounter(mission: Mission, state: MissionState): Encounter | null {
  return mission.encounters[state.encounterIndex] ?? null;
}

/** True when an objective is positional and the player is inside its radius. */
export function isInsideObjective(
  objective: Objective | null,
  playerPosition: { x: number; y: number },
): boolean {
  if (!objective?.position || objective.radius === undefined) return false;
  const dx = playerPosition.x - objective.position.x;
  const dy = playerPosition.y - objective.position.y;
  return Math.hypot(dx, dy) <= objective.radius;
}

export interface MissionTickInput {
  readonly dtMs: number;
  /** Kills recorded this frame (usually 0 or 1). */
  readonly killsThisFrame: number;
  readonly playerPosition: { x: number; y: number };
  /** True when the encounter's spawn queue and live hostiles are both empty. */
  readonly encounterCleared: boolean;
}

export interface MissionTickResult {
  /** True when the objective changed this frame (HUD should announce it). */
  objectiveAdvanced: boolean;
  /** True when a new encounter should begin spawning. */
  encounterStarted: boolean;
  /** True when the extraction countdown has finished successfully. */
  extracted: boolean;
  /** True when the mission failed this frame. */
  failed: boolean;
  /** The objective that was just completed, for the banner. */
  completedObjective: Objective | null;
}

/**
 * Advances the mission by one frame.
 *
 * The ordering inside is the mission's own logic and is deliberately explicit:
 * a `clear` objective completes on kills; a `reach` objective completes on
 * arrival; an `interact`/`hold` objective requires *continuous* presence inside
 * its radius and resets its progress when the player leaves — which is what
 * makes "hold the relay" a fight rather than a walk. The extraction behaves the
 * same way, but running out of its window while outside the zone fails the
 * mission.
 */
export function tickMission(
  mission: Mission,
  state: MissionState,
  input: MissionTickInput,
): MissionTickResult {
  const result: MissionTickResult = {
    objectiveAdvanced: false,
    encounterStarted: false,
    extracted: false,
    failed: false,
    completedObjective: null,
  };

  if (state.phase === 'complete' || state.phase === 'failed') return result;

  // ── Briefing → active ─────────────────────────────────────────────────────
  if (state.phase === 'briefing') {
    state.phase = 'active';
    result.encounterStarted = true;
  }

  const objective = currentObjective(mission, state);
  if (!objective) {
    // No objectives left: the mission is over.
    state.phase = 'complete';
    result.extracted = true;
    return result;
  }

  // Track kills for `clear` objectives regardless of the player's position.
  if (objective.kind === 'clear') {
    state.objectiveKills += input.killsThisFrame;
  }

  const inside = isInsideObjective(objective, input.playerPosition);
  state.inExtractionZone = objective.kind === 'extract' ? inside : state.inExtractionZone;

  let complete = false;
  switch (objective.kind) {
    case 'clear':
      complete = state.objectiveKills >= (objective.requiredKills ?? 0);
      break;
    case 'reach':
      complete = inside;
      break;
    case 'interact':
    case 'hold':
      // Continuous presence: leaving the zone loses the progress made so far.
      if (inside) state.objectiveProgressMs += input.dtMs;
      else state.objectiveProgressMs = 0;
      complete = state.objectiveProgressMs >= (objective.durationMs ?? 0);
      break;
    case 'survive':
      state.objectiveProgressMs += input.dtMs;
      complete = state.objectiveProgressMs >= (objective.durationMs ?? 0);
      break;
    case 'extract': {
      state.phase = 'extraction';
      if (inside) {
        state.extractionRemainingMs = Math.max(0, state.extractionRemainingMs - input.dtMs);
        state.extractionAwayMs = 0;
      } else {
        // The player has left the pad: the transport will not wait forever.
        state.extractionAwayMs += input.dtMs;
      }
      complete = state.extractionRemainingMs <= 0;
      if (!complete && state.extractionAwayMs >= mission.extractionGraceMs) {
        state.phase = 'failed';
        result.failed = true;
        return result;
      }
      break;
    }
  }

  if (!complete) return result;

  // ── Objective completed ───────────────────────────────────────────────────
  result.completedObjective = objective;
  result.objectiveAdvanced = true;
  state.objectiveIndex += 1;
  state.objectiveProgressMs = 0;
  state.objectiveKills = 0;

  const next = currentObjective(mission, state);
  if (!next) {
    state.phase = 'complete';
    result.extracted = true;
    return result;
  }

  // A `clear` objective is the marker for "the next encounter begins"; so is the
  // first objective after an interaction. That keeps encounters and objectives
  // in step without a separate schedule.
  if (next.kind === 'clear' || next.kind === 'hold' || next.kind === 'interact') {
    const nextEncounterIndex = state.encounterIndex + 1;
    if (nextEncounterIndex < mission.encounters.length) {
      state.encounterIndex = nextEncounterIndex;
      result.encounterStarted = true;
    }
  }
  return result;
}

/** Marks the mission as failed (e.g. the player died). */
export function failMission(state: MissionState): void {
  if (state.phase === 'complete' || state.phase === 'failed') return;
  state.phase = 'failed';
}

/** 0–1 progress for the current objective, for the HUD progress bar. */
export function objectiveProgress(mission: Mission, state: MissionState): number {
  const objective = currentObjective(mission, state);
  if (!objective) return 1;
  switch (objective.kind) {
    case 'clear':
      return clamp(state.objectiveKills / Math.max(1, objective.requiredKills ?? 1), 0, 1);
    case 'interact':
    case 'hold':
    case 'survive':
      return clamp(state.objectiveProgressMs / Math.max(1, objective.durationMs ?? 1), 0, 1);
    case 'extract':
      return clamp(1 - state.extractionRemainingMs / Math.max(1, mission.extractionMs), 0, 1);
    default:
      return 0;
  }
}

/** A short, unambiguous instruction for the HUD. */
export function objectiveInstruction(mission: Mission, state: MissionState): string {
  const objective = currentObjective(mission, state);
  if (!objective) return 'Mission complete';
  switch (objective.kind) {
    case 'clear':
      return `${objective.label} — ${Math.max(0, (objective.requiredKills ?? 0) - state.objectiveKills)} remaining`;
    case 'reach':
      return `${objective.label} — ${objective.detail ?? 'move to the marker'}`;
    case 'interact':
    case 'hold':
      return state.objectiveProgressMs > 0
        ? `${objective.label} — ${((objective.durationMs ?? 0) - state.objectiveProgressMs) / 1000 < 0 ? 0 : Math.ceil(((objective.durationMs ?? 0) - state.objectiveProgressMs) / 1000)}s`
        : `${objective.label} — enter the zone`;
    case 'extract':
      return `Extraction in ${Math.ceil(state.extractionRemainingMs / 1000)}s of ${Math.round(
        mission.extractionMs / 1000,
      )}s`;
    default:
      return objective.label;
  }
}

/**
 * Score bonus for a completed operation.
 *
 * Operations rewards finishing, not grinding: a flat completion bonus plus a
 * bonus for remaining time on the clock and for hostiles put down. It mirrors
 * the *shape* of the survival score so the database's formula stays the single
 * authority — the client never sends these numbers.
 */
export function missionCompletionBonus(
  mission: Mission,
  state: MissionState,
  eliminations: number,
  elapsedMs: number,
): { score: number; xp: number } {
  const finished = state.phase === 'complete';
  const remainingSeconds = Math.max(0, Math.ceil(state.extractionRemainingMs / 1000));
  // Longer operations pay a larger completion bonus, so the harder mission is
  // worth more than a shorter one at the same efficiency.
  const scale = mission.extractionMs / 30_000;
  return {
    score: (finished ? 8000 : 0) + remainingSeconds * 12 + eliminations * 20,
    xp: Math.round(((finished ? 1500 : 0) + Math.round(elapsedMs / 1000) * 4 + eliminations * 10) * scale),
  };
}
