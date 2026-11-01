/**
 * End-to-end test for the Operations result path.
 *
 * This is the only test that exercises the whole chain at once: the real
 * `CombatSimulation` is played to completion, its final snapshot is projected by
 * the real `toMatchSubmission` mapper, that payload is sent through the real
 * `submitMatch` service, and the result is read back from the real database. The
 * pieces are individually covered elsewhere; what this proves is that they agree
 * — that a mission the *game* can actually produce is a mission the *server*
 * accepts, scores and rewards.
 *
 * It skips itself unless a local Supabase stack is reachable, so a plain
 * `npm test` in an environment without the stack still passes. Bring the stack
 * up with `npm run db:start` (and `npm run db:reset` once) to include it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSupabaseClient, resetSupabaseClient } from '@/services/supabase';
import { fetchUnlockedWeapons, submitMatch } from '@/services/dataService';
import { env } from '@/lib/env';
import { createUuid } from '@/lib/validation';
import { toMatchSubmission } from '@/features/arena/submission';
import { CombatSimulation, type SimulationSnapshot } from '@/game/logic/simulation';
import { LAST_EXIT } from '@/game/logic/operations';
import { distance, vec } from '@/game/logic/vec';
import type { SupabaseClient } from '@supabase/supabase-js';

const FRAME_MS = 1000 / 60;

function isLocalSupabase(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

async function supabaseReachable(): Promise<boolean> {
  if (!env.isConfigured || !isLocalSupabase(env.supabaseUrl)) return false;
  try {
    const response = await Promise.race([
      fetch(`${env.supabaseUrl}/auth/v1/health`, { headers: { apikey: env.supabaseAnonKey } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('health check timed out')), 2500),
      ),
    ]);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Plays OPERATION: LAST EXIT to completion with a deterministic bot.
 *
 * The bot walks to the current objective, fires at the nearest live hostile and
 * reloads when the magazine empties — the minimum competence needed to finish.
 * `playerInvulnerable` is a test-only seam: it keeps the run deterministic
 * instead of ending it early on an unlucky hit. It is never set for a scored
 * match in the game itself.
 */
function playOperation(seed: number): SimulationSnapshot {
  const sim = new CombatSimulation({
    loadout: ['rifle'],
    seed,
    mode: 'operations',
    missionId: LAST_EXIT.id,
    upgradesEnabled: true,
    playerInvulnerable: true,
  });

  const maxFrames = 60 * 60 * 10;
  for (let frame = 0; frame < maxFrames && !sim.isEnded; frame += 1) {
    const snap = sim.snapshot();

    if (snap.awaitingUpgrade) {
      sim.chooseUpgrade(snap.upgradeOffer[0]!);
      continue;
    }

    const weapon = snap.player.weapons[snap.player.weapon];
    if (weapon && weapon.ammoInMagazine === 0) {
      sim.requestReload();
      sim.step(FRAME_MS, { move: vec(), aim: null, firing: false });
      continue;
    }

    const me = sim.playerPos;
    const target = snap.mission?.objectivePosition ?? me;
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    const span = Math.hypot(dx, dy);
    const move = span > 40 ? vec(dx / span, dy / span) : vec();

    let aim: { x: number; y: number } | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const enemy of snap.enemies) {
      if (enemy.dying) continue;
      const d = distance(me, enemy.position);
      if (d < nearest) {
        nearest = d;
        aim = enemy.position;
      }
    }

    sim.step(FRAME_MS, { move, aim, firing: aim !== null });
  }

  return sim.snapshot();
}

const reachable = await supabaseReachable();

describe.skipIf(!reachable)('operations end-to-end (live Supabase)', () => {
  let client: SupabaseClient;
  let userId: string;
  let final: SimulationSnapshot;

  beforeAll(async () => {
    resetSupabaseClient();
    client = getSupabaseClient();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

    const { data, error } = await client.auth.signUp({
      email: `operations.${stamp}@example.com`,
      password: 'orbital-decay-7',
      options: { data: { username: `Ops_${stamp.slice(-10)}` } },
    });
    expect(error).toBeNull();
    userId = data.user!.id;

    final = playOperation(4242);
  }, 60000);

  afterAll(async () => {
    await client?.auth.signOut();
  });

  it('plays OPERATION: LAST EXIT to a completed extraction', () => {
    expect(final.mode).toBe('operations');
    expect(final.mission?.phase).toBe('complete');
    expect(final.mission?.objectivesCompleted).toBe(LAST_EXIT.objectives.length);
    expect(final.mission?.objectivesCompleted).toBe(6);
  });

  it('records the real mission result and derives score, XP and achievements', async () => {
    const submission = toMatchSubmission(final, createUuid());
    expect(submission.outcome).toBe('extracted');
    expect(submission.extracted).toBe(true);
    expect(submission.objectivesCompleted).toBe(6);

    const result = await submitMatch(submission);

    expect(result.duplicate).toBe(false);
    expect(result.matchId).toMatch(/^[0-9a-f-]{36}$/);

    // The exact score the SQL formula produces for these facts. If the client
    // and server formulas ever drift, this is where it shows up.
    const objectives = submission.objectivesCompleted ?? 0;
    const expectedScore =
      submission.eliminations * 50 +
      submission.survivalSeconds * 2 +
      objectives * 600 +
      9000;
    expect(result.score).toBe(expectedScore);
    expect(result.xpAwarded).toBeGreaterThan(0);

    expect(result.stats.matches_played).toBe(1);
    // Operations reports wave 0 and must not touch the survival wave record.
    expect(result.stats.highest_wave).toBe(0);
    expect(result.stats.total_eliminations).toBe(submission.eliminations);
    expect(result.stats.best_survival_seconds).toBe(submission.survivalSeconds);

    // A completed extraction earns the two Operations badges.
    expect(result.newAchievements).toContain('extraction_ready');
    expect(result.newAchievements).toContain('objective_focus');
  }, 60000);

  it('unlocks every weapon the reached level promises', async () => {
    // Read the level the server computed, then check the loadout against the
    // catalogue's gates. This is the invariant the weapon-unlock ordering bug
    // used to violate: a level reached with achievement XP must still unlock
    // every weapon at or below it.
    const { data: stats } = await client
      .from('player_statistics')
      .select('level')
      .eq('profile_id', userId)
      .single();
    const level = (stats as { level: number } | null)?.level ?? 1;
    expect(level).toBeGreaterThanOrEqual(1);

    const { data: catalog } = await client
      .from('weapon_catalog')
      .select('id, unlock_level')
      .order('unlock_level', { ascending: true });
    const expected = (catalog ?? [])
      .filter((weapon) => (weapon as { unlock_level: number }).unlock_level <= level)
      .map((weapon) => (weapon as { id: string }).id);

    const unlocked = (await fetchUnlockedWeapons(userId)).map((row) => row.weapon_id);
    for (const weaponId of expected) {
      expect(unlocked).toContain(weaponId);
    }
    // The starting loadout is always present.
    expect(unlocked).toContain('pistol');
    expect(unlocked).toContain('rifle');
  }, 30000);

  it('treats a replay of the same client match id as a duplicate', async () => {
    const submission = toMatchSubmission(final, createUuid());

    const first = await submitMatch(submission);
    const replay = await submitMatch(submission);

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.matchId).toBe(first.matchId);
    expect(replay.stats.matches_played).toBe(first.stats.matches_played);
    expect(replay.stats.total_xp).toBe(first.stats.total_xp);
    expect(replay.newAchievements).toEqual([]);
  }, 60000);
});
