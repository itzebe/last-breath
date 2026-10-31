import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Panel, Stat } from '@/components/ui';
import { formatClock, formatDuration, formatNumber } from '@/lib/format';
import type { SimulationSnapshot } from '@/game/logic/simulation';
import { matchScore, matchXp, type MatchFacts } from '@/services/progression';

/**
 * End-of-run summary.
 *
 * The figures shown here are the client's *provisional* calculation from the
 * match facts. The authoritative score and XP are computed by the database when
 * the match is submitted, and the panel says so rather than implying the numbers
 * on screen are final.
 */

export interface RunResultsProps {
  snapshot: SimulationSnapshot;
  /** Server-confirmed result, once the submission resolves. */
  submission: {
    status: 'pending' | 'saved' | 'failed' | 'duplicate';
    score?: number;
    xp?: number;
    level?: number;
    levelUp?: boolean;
    /** Achievement ids the server confirmed for this run. */
    achievements?: string[];
    message?: string;
  };
  onPlayAgain: () => void;
}

/** Display names for the achievement ids the database returns. */
const ACHIEVEMENT_LABELS: Record<string, string> = {
  first_blood: 'First Blood',
  wave_5: 'Holding Ground',
  wave_10: 'Deep Run',
  executor_down: 'Executor Down',
  marksman: 'Marksman',
  survivor_300: 'Long Haul',
  centurion: 'Centurion',
  adaptation_seen: 'Adaptation Observed',
};

function achievementLabel(id: string): string {
  return ACHIEVEMENT_LABELS[id] ?? id;
}

export function RunResults({ snapshot, submission, onPlayAgain }: RunResultsProps) {
  const navigate = useNavigate();
  const victory = snapshot.outcome === 'victory';
  const deathmatch = snapshot.deathmatch;
  const isDeathmatch = snapshot.mode === 'deathmatch';

  const facts: MatchFacts = {
    mode: snapshot.mode,
    wave: isDeathmatch ? 0 : snapshot.waveNumber,
    eliminations: snapshot.eliminations,
    survivalSeconds: Math.floor(snapshot.elapsedMs / 1000),
    damageDealt: Math.round(snapshot.damageDealt),
    outcome: victory ? 'victory' : 'defeat',
  };

  const provisionalScore = matchScore(facts);
  const provisionalXp = matchXp(facts);
  const accuracy =
    snapshot.shotsFired > 0 ? Math.round((snapshot.shotsHit / snapshot.shotsFired) * 100) : 0;

  const showServerNumbers = submission.status === 'saved' && submission.score !== undefined;

  return (
    <div className="results" role="dialog" aria-modal="true" aria-label="Match results">
      <div className="results__card">
        <Panel tone={victory ? 'telemetry' : 'hostile'}>
          <p className="eyebrow eyebrow--signal">
            {victory ? (isDeathmatch ? 'Target reached' : 'Arena cleared') : 'Operator down'}
          </p>
          <h2 className={`results__verdict results__verdict--${victory ? 'victory' : 'defeat'}`}>
            {victory ? (isDeathmatch ? 'Match won' : 'Extracted') : 'Killed in action'}
          </h2>
          <p className="text-2" style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
            {isDeathmatch
              ? victory
                ? `You reached the elimination target with ${deathmatch?.playerEliminations ?? 0} kills.`
                : `The clock beat you. ${deathmatch?.playerEliminations ?? 0} of ${deathmatch?.eliminationTarget ?? 0} eliminations recorded.`
              : victory
                ? `You survived all ${snapshot.waveNumber} waves and put down the Executor.`
                : `The arena held. You reached wave ${snapshot.waveNumber}.`}
          </p>

          <div className="results__grid" style={{ marginTop: 'var(--sp-6)' }}>
            {isDeathmatch ? (
              <>
                <Stat
                  label="Target progress"
                  value={`${deathmatch?.playerEliminations ?? 0}/${deathmatch?.eliminationTarget ?? 0}`}
                  tone="hostile"
                />
                <Stat label="Deaths" value={deathmatch?.playerDeaths ?? 0} tone="signal" />
              </>
            ) : (
              <Stat label="Wave reached" value={snapshot.waveNumber} tone="signal" />
            )}
            <Stat label="Eliminations" value={formatNumber(snapshot.eliminations)} tone="hostile" />
            <Stat label="Survival time" value={formatClock(snapshot.elapsedMs)} />
            <Stat
              label="Damage dealt"
              value={formatNumber(Math.round(snapshot.damageDealt))}
              tone="ammo"
            />
            <Stat label="Accuracy" value={`${accuracy}%`} meta={`${snapshot.shotsHit} / ${snapshot.shotsFired}`} />
            <Stat
              label="Score"
              value={formatNumber(showServerNumbers ? submission.score! : provisionalScore)}
              tone="telemetry"
              meta={showServerNumbers ? 'confirmed' : 'provisional'}
            />
          </div>

          {/* ── Submission status ─────────────────────────────────────────── */}
          <div style={{ marginTop: 'var(--sp-6)' }}>
            {submission.status === 'pending' ? (
              <Alert tone="info">Recording your result…</Alert>
            ) : null}

            {submission.status === 'saved' ? (
              <Alert tone="success">
                <p>
                  Match recorded. <strong>+{formatNumber(submission.xp ?? provisionalXp)} XP</strong> added
                  to your operator record.
                  {submission.levelUp ? ` You are now level ${submission.level}.` : ''}
                </p>
              </Alert>
            ) : null}

            {submission.status === 'saved' && (submission.achievements?.length ?? 0) > 0 ? (
              <Alert tone="info">
                <p>
                  Achievement{(submission.achievements?.length ?? 0) > 1 ? 's' : ''} unlocked:{' '}
                  <strong>{submission.achievements!.map(achievementLabel).join(', ')}</strong>
                </p>
              </Alert>
            ) : null}

            {submission.status === 'duplicate' ? (
              <Alert tone="info">
                <p>This match was already recorded, so no XP was awarded twice.</p>
              </Alert>
            ) : null}

            {submission.status === 'failed' ? (
              <Alert tone="warn">
                <p>
                  {submission.message ??
                    'Your result could not be recorded, so no XP was awarded. The match still counted locally.'}
                </p>
              </Alert>
            ) : null}
          </div>

          {!showServerNumbers && submission.status !== 'failed' ? (
            <p className="text-3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-4)' }}>
              Score and XP are recalculated by the database from the match facts — the values above are
              the client's estimate.
            </p>
          ) : null}

          <div className="results__actions">
            <Button variant="primary" size="lg" onClick={onPlayAgain}>
              Play again
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/dashboard')}>
              Dashboard
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/leaderboard')}>
              Leaderboard
            </Button>
          </div>

          <p className="text-3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-5)' }}>
            Survival time on record: {formatDuration(facts.survivalSeconds)} ·{' '}
            <Badge tone="telemetry">single-player</Badge>{' '}
            <Badge tone="xp">adaptive AI</Badge>
          </p>
        </Panel>
      </div>
    </div>
  );
}
