import { describe, expect, it } from 'vitest';
import {
  LAST_EXIT,
  MISSIONS,
  completedObjectives,
  createMissionState,
  currentEncounter,
  currentObjective,
  failMission,
  isInsideObjective,
  missionCompletionBonus,
  objectiveInstruction,
  objectiveProgress,
  tickMission,
  type Mission,
  type MissionState,
} from '@/game/logic/operations';

/** Runs the mission forward with the player parked at a fixed position. */
function advance(
  mission: Mission,
  state: MissionState,
  seconds: number,
  options: { position: { x: number; y: number }; killsPerSecond?: number; encounterCleared?: boolean },
): void {
  const stepMs = 100;
  const frames = Math.round((seconds * 1000) / stepMs);
  const killsPerFrame = options.killsPerSecond ? options.killsPerSecond / (1000 / stepMs) : 0;
  let killCarry = 0;
  for (let i = 0; i < frames; i += 1) {
    killCarry += killsPerFrame;
    const kills = Math.floor(killCarry);
    killCarry -= kills;
    const result = tickMission(mission, state, {
      dtMs: stepMs,
      killsThisFrame: kills,
      playerPosition: options.position,
      encounterCleared: options.encounterCleared ?? false,
    });
    if (result.extracted || result.failed) return;
  }
}

const AT_ENTRY = { x: 300, y: 300 };
const AT_RELAY = { x: 1750, y: 320 };
const AT_PAD = { x: 460, y: 1280 };

describe('OPERATION: LAST EXIT — mission definition', () => {
  it('is registered in the mission catalogue', () => {
    expect(MISSIONS[LAST_EXIT.id]).toBe(LAST_EXIT);
  });

  it('has a briefing and a codename', () => {
    expect(LAST_EXIT.codename).toBe('LAST EXIT');
    expect(LAST_EXIT.briefing.length).toBeGreaterThan(80);
  });

  it('includes a clear, a reach, an interaction and an extraction objective', () => {
    const kinds = LAST_EXIT.objectives.map((objective) => objective.kind);
    expect(kinds).toContain('clear');
    expect(kinds).toContain('reach');
    expect(kinds).toContain('interact');
    expect(kinds).toContain('extract');
  });

  it('gives every positional objective a radius and a position', () => {
    for (const objective of LAST_EXIT.objectives) {
      if (objective.kind === 'reach' || objective.kind === 'interact' || objective.kind === 'extract') {
        expect(objective.position).toBeDefined();
        expect(objective.radius).toBeGreaterThan(0);
      }
    }
  });

  it('gives every timed objective a positive duration', () => {
    for (const objective of LAST_EXIT.objectives) {
      if (objective.kind === 'interact' || objective.kind === 'hold' || objective.kind === 'survive') {
        expect(objective.durationMs).toBeGreaterThan(0);
      }
    }
  });

  it('only names archetypes that actually exist', () => {
    const known = new Set([
      'rusher',
      'flanker',
      'sniper',
      'tank',
      'hunter',
      'commander',
      'medic',
    ]);
    for (const encounter of LAST_EXIT.encounters) {
      expect(encounter.enemies.length).toBeGreaterThan(0);
      for (const id of encounter.enemies) expect(known).toContain(id);
    }
  });

  it('escalates: later encounters are never smaller than earlier ones', () => {
    for (let i = 1; i < LAST_EXIT.encounters.length; i += 1) {
      expect(LAST_EXIT.encounters[i]!.enemies.length).toBeGreaterThanOrEqual(
        LAST_EXIT.encounters[i - 1]!.enemies.length,
      );
    }
  });

  it('provides one encounter for each combat stage of the mission', () => {
    expect(LAST_EXIT.encounters.length).toBeGreaterThanOrEqual(4);
  });
});

describe('mission state machine', () => {
  it('starts in the briefing with the first objective', () => {
    const state = createMissionState(LAST_EXIT);
    expect(state.phase).toBe('briefing');
    expect(state.objectiveIndex).toBe(0);
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('clear');
  });

  it('leaves the briefing on the first tick and starts an encounter', () => {
    const state = createMissionState(LAST_EXIT);
    const result = tickMission(LAST_EXIT, state, {
      dtMs: 16,
      killsThisFrame: 0,
      playerPosition: AT_ENTRY,
      encounterCleared: false,
    });
    expect(state.phase).toBe('active');
    expect(result.encounterStarted).toBe(true);
    expect(currentEncounter(LAST_EXIT, state)?.id).toBe('enc-entry');
  });

  it('completes a clear objective only when the kill quota is met', () => {
    const state = createMissionState(LAST_EXIT);
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    const required = currentObjective(LAST_EXIT, state)!.requiredKills!;

    for (let i = 0; i < required - 1; i += 1) {
      tickMission(LAST_EXIT, state, {
        dtMs: 16,
        killsThisFrame: 1,
        playerPosition: AT_ENTRY,
        encounterCleared: false,
      });
    }
    expect(state.objectiveIndex).toBe(0);

    tickMission(LAST_EXIT, state, {
      dtMs: 16,
      killsThisFrame: 1,
      playerPosition: AT_ENTRY,
      encounterCleared: false,
    });
    expect(state.objectiveIndex).toBe(1);
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('reach');
  });

  it('completes a reach objective on arrival, not before', () => {
    const state = createMissionState(LAST_EXIT);
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    advance(LAST_EXIT, state, 4, { position: AT_ENTRY, killsPerSecond: 10 });
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('reach');

    // Still far away: no progress.
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('reach');

    // Arriving completes it.
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_RELAY, encounterCleared: false });
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('interact');
  });

  it('requires continuous presence for an interaction, and resets on leaving', () => {
    const state = createMissionState(LAST_EXIT);
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    advance(LAST_EXIT, state, 4, { position: AT_ENTRY, killsPerSecond: 10 });
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_RELAY, encounterCleared: false });
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('interact');

    // Hold for a while inside the zone.
    advance(LAST_EXIT, state, 5, { position: AT_RELAY });
    expect(state.objectiveProgressMs).toBeGreaterThan(3000);

    // Leave the zone: progress is lost, because the objective is to *hold*.
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    expect(state.objectiveProgressMs).toBe(0);
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('interact');
  });

  it('advances to the extraction once the relay hold completes', () => {
    const state = createMissionState(LAST_EXIT);
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    advance(LAST_EXIT, state, 4, { position: AT_ENTRY, killsPerSecond: 10 });
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_RELAY, encounterCleared: false });

    const holdMs = currentObjective(LAST_EXIT, state)!.durationMs!;
    advance(LAST_EXIT, state, holdMs / 1000 + 1, { position: AT_RELAY });
    // Next objective is the yard clear.
    expect(currentObjective(LAST_EXIT, state)?.kind).toBe('clear');
  });

  it('counts the extraction down only while the player is on the pad', () => {
    const mission = LAST_EXIT;
    const state = createMissionState(mission);
    // Fast-forward to the extraction objective directly for a focused assertion.
    state.phase = 'active';
    state.objectiveIndex = mission.objectives.length - 1;

    tickMission(mission, state, { dtMs: 1000, killsThisFrame: 0, playerPosition: AT_PAD, encounterCleared: false });
    const afterInside = state.extractionRemainingMs;
    expect(afterInside).toBeLessThan(mission.extractionMs);

    // Stepping off the pad does not reduce the timer further.
    tickMission(mission, state, { dtMs: 1000, killsThisFrame: 0, playerPosition: AT_ENTRY, encounterCleared: false });
    expect(state.extractionRemainingMs).toBe(afterInside);
    expect(state.extractionAwayMs).toBeGreaterThan(0);
  });

  it('succeeds when the extraction countdown reaches zero on the pad', () => {
    const mission = LAST_EXIT;
    const state = createMissionState(mission);
    state.phase = 'active';
    state.objectiveIndex = mission.objectives.length - 1;

    let extracted = false;
    for (let i = 0; i < 2000 && !extracted; i += 1) {
      const result = tickMission(mission, state, {
        dtMs: 100,
        killsThisFrame: 0,
        playerPosition: AT_PAD,
        encounterCleared: false,
      });
      extracted = result.extracted;
    }
    expect(extracted).toBe(true);
    expect(state.phase).toBe('complete');
  });

  it('fails when the player leaves the pad for longer than the grace period', () => {
    const mission = LAST_EXIT;
    const state = createMissionState(mission);
    state.phase = 'active';
    state.objectiveIndex = mission.objectives.length - 1;

    let failed = false;
    for (let i = 0; i < 200 && !failed; i += 1) {
      const result = tickMission(mission, state, {
        dtMs: 100,
        killsThisFrame: 0,
        playerPosition: AT_ENTRY,
        encounterCleared: false,
      });
      failed = result.failed;
    }
    expect(failed).toBe(true);
    expect(state.phase).toBe('failed');
  });

  it('never advances a finished mission', () => {
    const state = createMissionState(LAST_EXIT);
    state.phase = 'complete';
    const result = tickMission(LAST_EXIT, state, {
      dtMs: 16,
      killsThisFrame: 100,
      playerPosition: AT_PAD,
      encounterCleared: true,
    });
    expect(result.objectiveAdvanced).toBe(false);
    expect(state.objectiveIndex).toBe(0);
  });

  it('can be failed explicitly, e.g. when the player dies', () => {
    const state = createMissionState(LAST_EXIT);
    failMission(state);
    expect(state.phase).toBe('failed');
    // Idempotent.
    failMission(state);
    expect(state.phase).toBe('failed');
  });
});

describe('objective presentation', () => {
  it('reports progress in [0, 1] for every objective kind', () => {
    const state = createMissionState(LAST_EXIT);
    state.phase = 'active';
    for (let i = 0; i < LAST_EXIT.objectives.length; i += 1) {
      state.objectiveIndex = i;
      const progress = objectiveProgress(LAST_EXIT, state);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it('produces a non-empty instruction for every objective', () => {
    const state = createMissionState(LAST_EXIT);
    state.phase = 'active';
    for (let i = 0; i < LAST_EXIT.objectives.length; i += 1) {
      state.objectiveIndex = i;
      expect(objectiveInstruction(LAST_EXIT, state).length).toBeGreaterThan(4);
    }
  });

  it('detects when the player is inside a positional objective', () => {
    const relay = LAST_EXIT.objectives.find((objective) => objective.id === 'obj-reach-relay')!;
    expect(isInsideObjective(relay, AT_RELAY)).toBe(true);
    expect(isInsideObjective(relay, AT_ENTRY)).toBe(false);
  });

  it('treats a non-positional objective as never "inside"', () => {
    const clear = LAST_EXIT.objectives.find((objective) => objective.kind === 'clear')!;
    expect(isInsideObjective(clear, AT_ENTRY)).toBe(false);
  });
});

describe('mission completion reward', () => {
  it('rewards completion substantially more than failure', () => {
    const won = createMissionState(LAST_EXIT);
    won.phase = 'complete';
    const lost = createMissionState(LAST_EXIT);
    lost.phase = 'failed';
    expect(missionCompletionBonus(LAST_EXIT, won, 20, 200_000).score).toBeGreaterThan(
      missionCompletionBonus(LAST_EXIT, lost, 20, 200_000).score,
    );
  });

  it('never returns a negative bonus', () => {
    const state = createMissionState(LAST_EXIT);
    state.phase = 'failed';
    state.extractionRemainingMs = 0;
    const bonus = missionCompletionBonus(LAST_EXIT, state, 0, 0);
    expect(bonus.score).toBeGreaterThanOrEqual(0);
    expect(bonus.xp).toBeGreaterThanOrEqual(0);
  });

  it('rewards more kills with more score', () => {
    const state = createMissionState(LAST_EXIT);
    state.phase = 'complete';
    expect(missionCompletionBonus(LAST_EXIT, state, 30, 1000).score).toBeGreaterThan(
      missionCompletionBonus(LAST_EXIT, state, 10, 1000).score,
    );
  });
});

describe('LAST EXIT is winnable end to end', () => {
  it('can be completed by a player who fights through every stage', () => {
    const state = createMissionState(LAST_EXIT);
    // Stage 1: break out of the entry hall.
    advance(LAST_EXIT, state, 6, { position: AT_ENTRY, killsPerSecond: 8 });
    // Stage 2: reach the relay.
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_RELAY, encounterCleared: false });
    // Stage 3: hold the relay.
    advance(LAST_EXIT, state, 25, { position: AT_RELAY });
    // Stage 4: clear the yard.
    advance(LAST_EXIT, state, 8, { position: AT_RELAY, killsPerSecond: 8 });
    // Stage 5: reach the pad.
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_PAD, encounterCleared: false });
    // Stage 6: hold for extraction.
    advance(LAST_EXIT, state, 35, { position: AT_PAD });

    expect(state.phase).toBe('complete');
  });
});

describe('completed objective counting (submission contract)', () => {
  it('counts zero completed while the first objective is still in progress', () => {
    const state = createMissionState(LAST_EXIT);
    // Display index is 1 here; nothing has been finished yet.
    expect(state.objectiveIndex).toBe(0);
    expect(completedObjectives(LAST_EXIT, state)).toBe(0);
  });

  it('counts the objectives finished, not the objective being worked on', () => {
    const state = createMissionState(LAST_EXIT);
    // Park the player on the second objective without clearing the first.
    state.objectiveIndex = 2;
    expect(completedObjectives(LAST_EXIT, state)).toBe(2);
  });

  it('reports all six only once the mission is complete', () => {
    const state = createMissionState(LAST_EXIT);
    state.objectiveIndex = 5;
    // Five done, the sixth still in progress.
    expect(completedObjectives(LAST_EXIT, state)).toBe(5);

    state.objectiveIndex = LAST_EXIT.objectives.length;
    expect(completedObjectives(LAST_EXIT, state)).toBe(6);
  });

  it('never reports more objectives than the mission has', () => {
    const state = createMissionState(LAST_EXIT);
    state.objectiveIndex = LAST_EXIT.objectives.length + 3;
    expect(completedObjectives(LAST_EXIT, state)).toBe(LAST_EXIT.objectives.length);
  });

  it('never reports a negative count', () => {
    const state = createMissionState(LAST_EXIT);
    state.objectiveIndex = -4;
    expect(completedObjectives(LAST_EXIT, state)).toBe(0);
  });

  it('tracks a real run: the count rises only as objectives are cleared', () => {
    const state = createMissionState(LAST_EXIT);
    // Stage 1 clears the entry hall.
    advance(LAST_EXIT, state, 6, { position: AT_ENTRY, killsPerSecond: 8 });
    expect(completedObjectives(LAST_EXIT, state)).toBe(1);

    // Stage 2 reaches the relay: now two are done.
    tickMission(LAST_EXIT, state, { dtMs: 16, killsThisFrame: 0, playerPosition: AT_RELAY, encounterCleared: false });
    expect(completedObjectives(LAST_EXIT, state)).toBe(2);
  });
});
