import type { SimulationSnapshot } from '@/game/logic/simulation';

/**
 * The Operations mission panel.
 *
 * Operations is a different game contract from Survival: the player is being
 * told what to do and where, so the objective is stated in words and the
 * extraction clock is given its own prominent readout rather than being folded
 * into the wave banner.
 */

export interface MissionPanelProps {
  mission: NonNullable<SimulationSnapshot['mission']>;
}

export function MissionPanel({ mission }: MissionPanelProps) {
  const extracting = mission.phase === 'extraction';
  const done = mission.phase === 'complete';
  const failed = mission.phase === 'failed';

  return (
    <div className="mission-panel hud__panel" data-phase={mission.phase} aria-live="polite">
      <p className="hud__label">
        {mission.codename} · objective {mission.objectiveIndex}/{mission.objectiveTotal}
      </p>
      <p className="hud__value hud__value--signal" style={{ fontSize: 'var(--fs-md)' }}>
        {done ? 'Mission complete' : failed ? 'Mission failed' : mission.objectiveLabel}
      </p>

      {!done && !failed ? (
        <>
          <p className="hud__label" style={{ marginTop: 4 }}>
            {mission.objectiveInstruction}
          </p>
          <div className="mission-panel__track" aria-hidden="true">
            <span
              className="mission-panel__fill"
              style={{ width: `${Math.round(Math.max(0, Math.min(1, mission.objectiveProgress)) * 100)}%` }}
            />
          </div>
        </>
      ) : null}

      {extracting ? (
        <p className="mission-panel__clock" role="timer">
          Extraction in {Math.ceil(mission.extractionRemainingMs / 1000)}s
          {mission.inExtractionZone ? ' · holding' : ' · leave the zone and it resets'}
        </p>
      ) : null}
    </div>
  );
}
