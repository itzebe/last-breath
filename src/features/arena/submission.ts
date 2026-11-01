import type { MatchOutcome, MatchSubmission } from '@/services/types';
import type { SimulationSnapshot } from '@/game/logic/simulation';

/**
 * Projects a finished run into the facts submitted to the server. Pure, so the
 * mapping — in particular the completed-objective count — is unit-testable
 * without mounting the arena. `clientMatchId` is the idempotency key and must be
 * a real UUID: the column is `uuid`, so a composed string fails the Postgres cast.
 */
export function toMatchSubmission(final: SimulationSnapshot, clientMatchId: string): MatchSubmission {
  const isDeathmatch = final.mode === 'deathmatch';
  const isOperations = final.mode === 'operations';
  const extracted = isOperations && final.mission?.phase === 'complete';
  // Operations reports `extracted` rather than `victory`, so the database records
  // a mission result as a mission result.
  const outcome: MatchOutcome = extracted ? 'extracted' : final.outcome === 'victory' ? 'victory' : 'defeat';

  return {
    clientMatchId,
    mode: final.mode,
    // Deathmatch and Operations have no survival waves: reporting the
    // difficulty-derived wave number would corrupt `highest_wave`.
    waveReached: isDeathmatch || isOperations ? 0 : final.waveNumber,
    eliminations: final.eliminations,
    deaths: isDeathmatch ? (final.deathmatch?.playerDeaths ?? 0) : final.outcome === 'victory' ? 0 : 1,
    damageDealt: Math.round(final.damageDealt),
    shotsFired: final.shotsFired,
    shotsHit: final.shotsHit,
    survivalSeconds: Math.floor(final.elapsedMs / 1000),
    outcome,
    bossDefeated: final.bossDefeated,
    adapted: final.adapted,
    // The snapshot's `objectiveIndex` is 1-based for display; the count of
    // objectives actually finished is `objectivesCompleted`.
    objectivesCompleted: isOperations ? (final.mission?.objectivesCompleted ?? 0) : 0,
    extracted,
  };
}
