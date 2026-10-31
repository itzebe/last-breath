import { useMemo, useState } from 'react';
import { Alert, Badge, Button, EmptyState, LoadingScreen, Panel, Stat } from '@/components/ui';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { useAuth } from '@/app/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchLeaderboard } from '@/services/dataService';
import { formatDuration, formatNumber, formatXp, initialsFrom } from '@/lib/format';
import type { LeaderboardSort } from '@/services/types';

/**
 * Global leaderboard.
 *
 * Ranks are read from a database view that derives them from the authoritative
 * statistics row — the client cannot write a rank, a score or an XP total. The
 * sort control changes the view's ordering only.
 */

const SORTS: Array<{ id: LeaderboardSort; label: string; description: string }> = [
  { id: 'level', label: 'Level', description: 'Highest operator level' },
  { id: 'xp', label: 'XP', description: 'Most total experience' },
  { id: 'eliminations', label: 'Eliminations', description: 'Most hostiles destroyed' },
  { id: 'wave', label: 'Wave', description: 'Highest survival wave reached' },
  { id: 'survival', label: 'Survival', description: 'Longest single survival time' },
];

export function LeaderboardPage() {
  const { user } = useAuth();
  const [sort, setSort] = useState<LeaderboardSort>('level');

  const { data, error, loading, reload } = useAsync(() => fetchLeaderboard(sort, 100), [sort]);

  const rows = useMemo(() => data ?? [], [data]);
  const myRow = useMemo(() => rows.find((row) => row.profile_id === user?.id) ?? null, [rows, user?.id]);
  const myRank = useMemo(() => rows.findIndex((row) => row.profile_id === user?.id), [rows, user?.id]);

  const activeSort = SORTS.find((entry) => entry.id === sort) ?? SORTS[0]!;

  return (
    <SiteLayout>
      <div className="shell">
        <div className="page-head">
          <div>
            <p className="eyebrow eyebrow--signal">Global ranking</p>
            <h1 style={{ marginTop: 'var(--sp-2)' }}>Leaderboard</h1>
            <p className="text-2" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-2)' }}>
              Every figure is read from the database. Ranks are computed server-side from recorded
              match results.
            </p>
          </div>
          <div className="page-head__meta">
            <Badge tone="telemetry">{rows.length} operators ranked</Badge>
            {myRank >= 0 ? <Badge tone="signal">You are #{myRank + 1}</Badge> : null}
          </div>
        </div>

        {/* The signed-in player's own standing, pinned above the table. */}
        {myRow ? (
          <div className="lb-you">
            <span className="operator__sigil" style={{ width: 44, height: 44, fontSize: 'var(--fs-md)' }} aria-hidden="true">
              {initialsFrom(myRow.username)}
            </span>
            <div className="grow">
              <p className="loadout__name">{myRow.username}</p>
              <p className="loadout__meta">
                Rank #{myRank + 1} · level {myRow.level} · {formatXp(myRow.total_xp)}
              </p>
            </div>
            <div className="hud__cluster">
              <Badge tone="hostile">{formatNumber(myRow.eliminations)} kills</Badge>
              <Badge tone="signal">wave {myRow.highest_wave}</Badge>
              <Badge tone="vital">{formatDuration(myRow.best_survival_seconds)}</Badge>
            </div>
          </div>
        ) : null}

        <div className="lb-sorts" role="tablist" aria-label="Sort leaderboard by">
          {SORTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={sort === entry.id}
              title={entry.description}
              onClick={() => setSort(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <Panel flush>
          {loading ? (
            <div style={{ padding: 'var(--sp-6)' }}>
              <LoadingScreen message="Loading ranking" />
            </div>
          ) : error ? (
            <div style={{ padding: 'var(--sp-6)' }}>
              <Alert tone="error">{error.userMessage}</Alert>
              <div style={{ marginTop: 'var(--sp-5)' }}>
                <Button variant="primary" onClick={reload}>
                  Try again
                </Button>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 'var(--sp-6)' }}>
              <EmptyState
                title="No operators ranked yet"
                body="The leaderboard fills as players complete matches. Be the first to record a survival run."
              />
            </div>
          ) : (
            <div className="scroll-x">
              <table className="data-table" style={{ minWidth: 780 }}>
                <caption>
                  Sorted by {activeSort.label.toLowerCase()} — {activeSort.description.toLowerCase()}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="rank">
                      #
                    </th>
                    <th scope="col">Operator</th>
                    <th scope="col" className="num">
                      Level
                    </th>
                    <th scope="col" className="num">
                      Total XP
                    </th>
                    <th scope="col" className="num">
                      Eliminations
                    </th>
                    <th scope="col" className="num">
                      Highest wave
                    </th>
                    <th scope="col" className="num">
                      Best survival
                    </th>
                    <th scope="col" className="num">
                      Matches
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const isMe = row.profile_id === user?.id;
                    return (
                      <tr key={row.profile_id} data-highlight={isMe}>
                        <td className="rank">{index + 1}</td>
                        <th
                          scope="row"
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'var(--fs-sm)',
                            color: isMe ? 'var(--signal)' : 'var(--ink)',
                            textTransform: 'none',
                          }}
                        >
                          {row.username}
                          {isMe ? (
                            <span className="badge badge--signal" style={{ marginLeft: 'var(--sp-3)' }}>
                              You
                            </span>
                          ) : null}
                        </th>
                        <td className="num">{row.level}</td>
                        <td className="num">{formatNumber(row.total_xp)}</td>
                        <td className="num">{formatNumber(row.eliminations)}</td>
                        <td className="num">{row.highest_wave}</td>
                        <td className="num mono">{formatDuration(row.best_survival_seconds)}</td>
                        <td className="num">{formatNumber(row.matches_played)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="stat-grid" style={{ marginTop: 'var(--gutter)' }}>
          <Stat
            label="Ranking is server-derived"
            value="Read-only"
            tone="telemetry"
            meta="Ranks come from a database view, not the browser"
          />
          <Stat
            label="Scores are recomputed"
            value="Server-side"
            tone="signal"
            meta="The client submits match facts, never a score"
          />
          <Stat
            label="Duplicate submissions"
            value="Rejected"
            tone="vital"
            meta="Each match carries a unique client id"
          />
        </div>
      </div>
    </SiteLayout>
  );
}
