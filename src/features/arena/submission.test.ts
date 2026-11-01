import { describe, expect, it } from 'vitest';
import { toMatchSubmission } from '@/features/arena/submission';
import { createUuid, matchSubmissionSchema } from '@/lib/validation';
import type { SimulationSnapshot } from '@/game/logic/simulation';

type Mission = NonNullable<SimulationSnapshot['mission']>;

/**
 * The submitted payload is the security-relevant surface: the server scores and
 * pays achievements from these facts, so the mapping from the run snapshot to
 * the payload must be exact. These tests pin it — above all the completed
 * objective count, which is easy to conflate with the 1-based display index.
 */
function snapshot(overrides: Partial<SimulationSnapshot> = {}): SimulationSnapshot {
  return {
    mode: 'survival',
    outcome: 'defeat',
    waveNumber: 7,
    eliminations: 12,
    damageDealt: 3456.7,
    shotsFired: 40,
    shotsHit: 25,
    elapsedMs: 91_500,
    bossDefeated: false,
    adapted: true,
    deathmatch: null,
    mission: null,
    ...overrides,
  } as unknown as SimulationSnapshot;
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'last_exit',
    codename: 'LAST EXIT',
    name: 'Operation: Last Exit',
    briefing: '',
    phase: 'failed',
    objectiveIndex: 3,
    objectivesCompleted: 2,
    objectiveTotal: 6,
    objectiveLabel: 'Hold the relay',
    objectiveDetail: '',
    objectiveInstruction: '',
    objectiveProgress: 0.4,
    objectivePosition: null,
    objectiveRadius: null,
    extractionRemainingMs: 30_000,
    inExtractionZone: false,
    encounterIntro: null,
    holdingPosition: true,
    ...overrides,
  };
}

describe('toMatchSubmission', () => {
  it('submits the completed objective count, not the 1-based display index', () => {
    const payload = toMatchSubmission(snapshot({ mode: 'operations', mission: mission() }), createUuid());
    // Display says "objective 3"; only 2 are actually finished.
    expect(payload.objectivesCompleted).toBe(2);
    expect(payload.objectivesCompleted).not.toBe(3);
  });

  it('reports no completed objectives outside Operations', () => {
    expect(toMatchSubmission(snapshot({ mode: 'survival' }), createUuid()).objectivesCompleted).toBe(0);
    expect(
      toMatchSubmission(snapshot({ mode: 'deathmatch', deathmatch: null }), createUuid()).objectivesCompleted,
    ).toBe(0);
  });

  it('marks a completed mission as extracted and reports all six objectives', () => {
    const payload = toMatchSubmission(
      snapshot({
        mode: 'operations',
        outcome: 'victory',
        mission: mission({ phase: 'complete', objectiveIndex: 6, objectivesCompleted: 6 }),
      }),
      createUuid(),
    );
    expect(payload.extracted).toBe(true);
    expect(payload.objectivesCompleted).toBe(6);
    // Operations is recorded as a mission result, not a generic victory.
    expect(payload.outcome).toBe('extracted');
  });

  it('does not claim extraction for a failed mission, even at the final objective', () => {
    const payload = toMatchSubmission(
      snapshot({
        mode: 'operations',
        outcome: 'defeat',
        // Display index is clamped to 6 on a finished mission; the phase is what
        // distinguishes a real extraction from a death on the extraction pad.
        mission: mission({ phase: 'failed', objectiveIndex: 6, objectivesCompleted: 5 }),
      }),
      createUuid(),
    );
    expect(payload.extracted).toBe(false);
    expect(payload.outcome).toBe('defeat');
    expect(payload.objectivesCompleted).toBe(5);
  });

  it('zeroes the wave for modes without survival waves, preserving highest_wave', () => {
    expect(toMatchSubmission(snapshot({ mode: 'survival', waveNumber: 7 }), createUuid()).waveReached).toBe(7);
    expect(
      toMatchSubmission(snapshot({ mode: 'deathmatch', deathmatch: null, waveNumber: 7 }), createUuid()).waveReached,
    ).toBe(0);
    expect(
      toMatchSubmission(snapshot({ mode: 'operations', mission: mission(), waveNumber: 7 }), createUuid()).waveReached,
    ).toBe(0);
  });

  it('records a deathmatch death count and a survival death flag', () => {
    const dm = toMatchSubmission(
      snapshot({ mode: 'deathmatch', deathmatch: { playerDeaths: 4 } as never }),
      createUuid(),
    );
    expect(dm.deaths).toBe(4);

    const survived = toMatchSubmission(snapshot({ mode: 'survival', outcome: 'victory' }), createUuid());
    expect(survived.deaths).toBe(0);
    const died = toMatchSubmission(snapshot({ mode: 'survival', outcome: 'defeat' }), createUuid());
    expect(died.deaths).toBe(1);
  });

  it('rounds damage and floors elapsed time to whole seconds', () => {
    const payload = toMatchSubmission(snapshot({ damageDealt: 3456.7, elapsedMs: 91_999 }), createUuid());
    expect(payload.damageDealt).toBe(3457);
    expect(payload.survivalSeconds).toBe(91);
  });

  it('produces a payload that passes the client-side submission schema', () => {
    const payload = toMatchSubmission(
      snapshot({ mode: 'operations', mission: mission({ phase: 'complete', objectivesCompleted: 6 }) }),
      createUuid(),
    );
    const parsed = matchSubmissionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('requires a real UUID for the idempotency key', () => {
    // A composed string would fail the Postgres uuid cast, so createUuid must be
    // used. The schema is the guard that keeps that honest.
    const good = toMatchSubmission(snapshot(), createUuid());
    expect(matchSubmissionSchema.safeParse(good).success).toBe(true);
    const bad = toMatchSubmission(snapshot(), 'match-123-abc');
    expect(matchSubmissionSchema.safeParse(bad).success).toBe(false);
  });
});
