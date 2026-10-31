import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Bar, Button, EmptyState, LoadingScreen, Panel, Skeleton, Stat } from '@/components/ui';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { useAuth } from '@/app/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import {
  fetchAchievements,
  fetchPlayerAchievements,
  fetchRecentMatches,
  fetchUnlockedWeapons,
} from '@/services/dataService';
import { fetchPlayerOverview } from '@/services/profileService';
import { xpForLevel, levelProgress } from '@/services/progression';
import { formatDate, formatDuration, formatNumber, formatPercent, formatXp, initialsFrom } from '@/lib/format';
import { WEAPONS, isWeaponId, type WeaponId } from '@/game/logic/weapons';
import type { PlayerStatistics } from '@/services/types';

/** Career stats + loadout + recent matches, loaded as one dashboard payload. */
interface DashboardData {
  profile: Awaited<ReturnType<typeof fetchPlayerOverview>>['profile'];
  statistics: PlayerStatistics;
  unlocked: WeaponId[];
  recentMatches: Awaited<ReturnType<typeof fetchRecentMatches>>;
  achievements: Awaited<ReturnType<typeof fetchAchievements>>;
  earned: Awaited<ReturnType<typeof fetchPlayerAchievements>>;
}

async function loadDashboard(userId: string): Promise<DashboardData> {
  const [overview, unlockedRows, recentMatches, achievements, earned] = await Promise.all([
    fetchPlayerOverview(userId),
    fetchUnlockedWeapons(userId),
    fetchRecentMatches(userId, 8),
    fetchAchievements(),
    fetchPlayerAchievements(userId),
  ]);

  // Only weapons the catalogue still recognises, so a retired weapon cannot
  // leave a broken entry in the loadout.
  const unlocked = unlockedRows
    .map((row) => row.weapon_id)
    .filter((id): id is WeaponId => isWeaponId(id));

  return {
    profile: overview.profile,
    statistics: overview.statistics,
    unlocked,
    recentMatches,
    achievements,
    earned,
  };
}

/* ── Operator header ──────────────────────────────────────────────────────── */

function OperatorHeader({ username, createdAt }: { username: string; createdAt: string }) {
  return (
    <div className="operator">
      <div className="operator__sigil" aria-hidden="true">
        {initialsFrom(username)}
      </div>
      <div>
        <h1 className="operator__name">{username}</h1>
        <p className="operator__level">Operator since {formatDate(createdAt)}</p>
      </div>
    </div>
  );
}

/* ── Progression panel ────────────────────────────────────────────────────── */

function ProgressionPanel({ statistics }: { statistics: PlayerStatistics }) {
  const progress = levelProgress(statistics.total_xp);
  const nextLevelXp = xpForLevel(statistics.level + 1);

  return (
    <Panel title="Progression" tone="signal">
      <div className="stat-grid" style={{ marginBottom: 'var(--sp-5)' }}>
        <Stat label="Level" value={statistics.level} tone="xp" />
        <Stat label="Total XP" value={formatNumber(statistics.total_xp)} tone="xp" meta={formatXp(statistics.total_xp)} />
        <Stat
          label="To next level"
          value={formatNumber(progress.remaining)}
          meta={`at ${formatNumber(nextLevelXp)} XP`}
        />
      </div>
      <Bar
        label={`Level ${statistics.level} progress`}
        value={progress.fraction}
        tone="xp"
        tall
        suffix={`${formatNumber(progress.into)} / ${formatNumber(progress.span)}`}
      />
    </Panel>
  );
}

/* ── Career stats ─────────────────────────────────────────────────────────── */

function CareerStats({ statistics }: { statistics: PlayerStatistics }) {
  const accuracy =
    statistics.total_shots_fired > 0 ? statistics.total_shots_hit / statistics.total_shots_fired : null;
  const kd =
    statistics.total_deaths > 0
      ? statistics.total_eliminations / statistics.total_deaths
      : statistics.total_eliminations > 0
        ? statistics.total_eliminations
        : null;

  const isNew = statistics.matches_played === 0;

  return (
    <Panel title="Career record">
      {isNew ? (
        <Alert tone="info">
          <p>
            No matches recorded yet. Your first run will populate every figure below — play a match
            and return here.
          </p>
        </Alert>
      ) : null}

      <div className="stat-grid" style={{ marginTop: isNew ? 'var(--sp-5)' : 0 }}>
        <Stat
          label="Matches played"
          value={formatNumber(statistics.matches_played)}
          tone="telemetry"
        />
        <Stat
          label="Eliminations"
          value={formatNumber(statistics.total_eliminations)}
          tone="hostile"
        />
        <Stat label="Deaths" value={formatNumber(statistics.total_deaths)} />
        <Stat
          label="K/D ratio"
          value={kd === null ? '—' : kd.toFixed(2)}
          meta={kd === null ? 'no deaths recorded' : undefined}
        />
        <Stat
          label="Highest wave"
          value={formatNumber(statistics.highest_wave)}
          tone="signal"
          meta={statistics.highest_wave === 0 ? 'not yet set' : undefined}
        />
        <Stat
          label="Best survival"
          value={
            statistics.best_survival_seconds > 0
              ? formatDuration(statistics.best_survival_seconds)
              : '—'
          }
          meta={statistics.best_survival_seconds === 0 ? 'no completed run' : undefined}
        />
        <Stat
          label="Best eliminations"
          value={formatNumber(statistics.best_eliminations)}
          meta="single match"
        />
        <Stat
          label="Accuracy"
          value={accuracy === null ? '—' : formatPercent(accuracy, 1)}
          meta={
            statistics.total_shots_fired > 0
              ? `${formatNumber(statistics.total_shots_hit)} / ${formatNumber(statistics.total_shots_fired)} shots`
              : 'no shots fired'
          }
        />
        <Stat
          label="Damage dealt"
          value={formatNumber(statistics.total_damage_dealt)}
          tone="ammo"
        />
        <Stat
          label="Time in arena"
          value={formatDuration(statistics.total_play_seconds)}
          tone="vital"
        />
      </div>
    </Panel>
  );
}

/* ── Loadout ──────────────────────────────────────────────────────────────── */

function LoadoutPanel({ unlocked, level }: { unlocked: WeaponId[]; level: number }) {
  const catalog = useMemo(() => Object.values(WEAPONS), []);

  return (
    <Panel title="Loadout" action={<Badge tone="ammo">{unlocked.length} of {catalog.length}</Badge>}>
      <div className="loadout">
        {catalog.map((weapon) => {
          const isUnlocked = unlocked.includes(weapon.id);
          return (
            <div className="loadout__item" key={weapon.id} data-locked={!isUnlocked}>
              <div className="grow">
                <p className="loadout__name">{weapon.name}</p>
                <p className="loadout__meta">
                  {weapon.damage} dmg · {(weapon.reloadMs / 1000).toFixed(2)}s reload ·{' '}
                  {weapon.magazine} rnds
                  {weapon.pellets > 1 ? ` · ${weapon.pellets} pellets` : ''}
                </p>
              </div>
              {isUnlocked ? (
                <Badge tone="vital">Ready</Badge>
              ) : (
                <Badge tone="xp" locked>
                  Level {weapon.unlockLevel}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
      {unlocked.length < catalog.length ? (
        <p className="text-3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-4)' }}>
          Weapons unlock automatically when you reach their level. You are level {level}.
        </p>
      ) : null}
    </Panel>
  );
}

/* ── Achievements ─────────────────────────────────────────────────────────── */

function AchievementsPanel({
  achievements,
  earnedIds,
}: {
  achievements: DashboardData['achievements'];
  earnedIds: Set<string>;
}) {
  if (achievements.length === 0) {
    return (
      <Panel title="Achievements">
        <EmptyState title="No achievements defined" body="The achievement catalogue is empty." />
      </Panel>
    );
  }

  return (
    <Panel
      title="Achievements"
      action={
        <Badge tone="vital">
          {earnedIds.size} / {achievements.length}
        </Badge>
      }
    >
      <ul className="loadout" style={{ listStyle: 'none', padding: 0 }}>
        {achievements.map((achievement) => {
          const earned = earnedIds.has(achievement.id);
          return (
            <li className="loadout__item" key={achievement.id} data-locked={!earned}>
              <div className="grow">
                <p className="loadout__name">{achievement.name}</p>
                <p className="loadout__meta">{achievement.description}</p>
              </div>
              {earned ? <Badge tone="vital">Earned</Badge> : <Badge locked>Locked</Badge>}
            </li>
          );
        })}
      </ul>
      <p className="text-3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-4)' }}>
        Achievements are recorded as you play and are stored against your account.
      </p>
    </Panel>
  );
}

/* ── Match history ────────────────────────────────────────────────────────── */

function MatchHistoryPanel({ matches }: { matches: DashboardData['recentMatches'] }) {
  return (
    <Panel title="Recent matches">
      {matches.length === 0 ? (
        <EmptyState
          title="No matches recorded"
          body="Complete a run in the arena and it will appear here with its wave, eliminations and score."
        />
      ) : (
        <div className="scroll-x">
          <table className="data-table" style={{ minWidth: 620 }}>
            <caption>Most recent {matches.length} matches, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Mode</th>
                <th scope="col" className="num">
                  Wave
                </th>
                <th scope="col" className="num">
                  Kills
                </th>
                <th scope="col" className="num">
                  Time
                </th>
                <th scope="col" className="num">
                  Score
                </th>
                <th scope="col" className="num">
                  XP
                </th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.id}>
                  <td className="mono" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                    {formatDate(match.created_at)}
                  </td>
                  <td>
                    <Badge tone={match.mode === 'survival' ? 'signal' : 'telemetry'}>{match.mode}</Badge>
                  </td>
                  <td className="num">{match.wave_reached}</td>
                  <td className="num">{match.eliminations}</td>
                  <td className="num mono">{formatDuration(match.survival_seconds)}</td>
                  <td className="num">{formatNumber(match.score)}</td>
                  <td className="num" style={{ color: 'var(--xp)' }}>
                    +{formatNumber(match.xp_awarded)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function DashboardPage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const userId = user?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (userId ? loadDashboard(userId) : Promise.reject(new Error('Not signed in.'))),
    [userId],
  );

  const earnedIds = useMemo(
    () => new Set((data?.earned ?? []).map((row) => row.achievement_id)),
    [data],
  );

  if (loading && !data) {
    return (
      <SiteLayout>
        <div className="shell">
          <LoadingScreen message="Loading operator record" />
        </div>
      </SiteLayout>
    );
  }

  if (error || !data) {
    return (
      <SiteLayout>
        <div className="shell shell--narrow" style={{ paddingBlock: 'var(--sp-9)' }}>
          <Panel tone="hostile" title="Could not load your record">
            <Alert tone="error">{error?.userMessage ?? 'Your dashboard data is unavailable.'}</Alert>
            <div className="cluster gap-3" style={{ marginTop: 'var(--sp-5)' }}>
              <Button variant="primary" onClick={reload}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => navigate('/')}>
                Back to overview
              </Button>
            </div>
          </Panel>
        </div>
      </SiteLayout>
    );
  }

  const { statistics } = data;
  const username = data.profile.username;
  const createdAt = data.profile.created_at;

  return (
    <SiteLayout>
      <div className="shell">
        <div className="page-head">
          <OperatorHeader username={username} createdAt={createdAt} />
          <div className="page-head__meta">
            <Badge tone="xp">Level {statistics.level}</Badge>
            <Badge tone="telemetry">{formatXp(statistics.total_xp)}</Badge>
            <Badge tone="vital">{data.unlocked.length} weapons</Badge>
          </div>
        </div>

        <div className="dash-grid">
          <div className="stack gap-6">
            <ProgressionPanel statistics={statistics} />
            <CareerStats statistics={statistics} />
            <MatchHistoryPanel matches={data.recentMatches} />
          </div>

          <div className="stack gap-6">
            <div className="play-block">
              <div>
                <p className="eyebrow eyebrow--signal">Survival</p>
                <h2 className="section-title" style={{ marginTop: 'var(--sp-2)' }}>
                  Enter the arena
                </h2>
              </div>
              <p className="text-2" style={{ fontSize: 'var(--fs-sm)' }}>
                Endless waves that escalate. The opposition observes how you fight and adapts. Every
                tenth wave sends The Executor.
              </p>
              <Button variant="primary" size="lg" block onClick={() => navigate('/arena')}>
                ▶ Play survival
              </Button>
              <p className="play-block__hint">
                Your result is recorded automatically: score and XP are computed by the database from
                the match facts, not by the browser.
              </p>
            </div>

            <div className="play-block">
              <div>
                <p className="eyebrow eyebrow--telemetry">Deathmatch</p>
                <h2 className="section-title" style={{ marginTop: 'var(--sp-2)' }}>
                  Timed elimination
                </h2>
              </div>
              <p className="text-2" style={{ fontSize: 'var(--fs-sm)' }}>
                A timed match against AI-controlled opponents. Reach the elimination target before the
                clock runs out. Opponents are AI — this is not online multiplayer.
              </p>
              <Button
                variant="telemetry"
                size="lg"
                block
                onClick={() => navigate('/arena?mode=deathmatch')}
              >
                ▶ Play deathmatch
              </Button>
              <p className="play-block__hint">
                Same arena, same adaptive AI, same weapon handling — a different objective.
              </p>
            </div>

            <LoadoutPanel unlocked={data.unlocked} level={statistics.level} />
            <AchievementsPanel achievements={data.achievements} earnedIds={earnedIds} />

            <Panel title="Account">
              <dl className="loadout" style={{ gap: 'var(--sp-3)' }}>
                <div className="between">
                  <dt className="loadout__meta">Callsign</dt>
                  <dd className="mono" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
                    {username}
                  </dd>
                </div>
                <div className="between">
                  <dt className="loadout__meta">Email</dt>
                  <dd className="mono" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
                    {user?.email ?? '—'}
                  </dd>
                </div>
                <div className="between">
                  <dt className="loadout__meta">Member since</dt>
                  <dd className="mono" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
                    {formatDate(createdAt)}
                  </dd>
                </div>
              </dl>
              <div className="cluster gap-3" style={{ marginTop: 'var(--sp-5)' }}>
                <Button variant="ghost" onClick={() => navigate('/leaderboard')}>
                  View leaderboard
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await refreshProfile();
                    reload();
                  }}
                >
                  Refresh
                </Button>
              </div>
            </Panel>
          </div>
        </div>

        {loading ? <Skeleton height={40} /> : null}
      </div>
    </SiteLayout>
  );
}
