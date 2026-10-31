/**
 * Integration test for the match-submission path.
 *
 * Unlike the unit tests, this exercises the real `submitMatch` service against a
 * running Supabase instance: it signs a throwaway operator up through the real
 * client, submits real match facts through the real RPC, and reads the result
 * back. That is the only way to prove the pieces agree — the Zod schema, the
 * argument names, the SQL types, the server-side scoring and the achievement
 * evaluation all have to line up for a single call to succeed.
 *
 * It skips itself when no local Supabase is reachable, so a plain `npm test` in
 * an environment without the stack still passes. Bring the stack up with
 * `npm run db:start` to include it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSupabaseClient, resetSupabaseClient } from '@/services/supabase';
import { submitMatch } from '@/services/dataService';
import { env } from '@/lib/env';
import { createUuid } from '@/lib/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * jsdom's `AbortSignal` is not an instance of the one Node's `fetch` expects, so
 * `AbortSignal.timeout` throws here. A raced timeout keeps the check portable.
 */
async function supabaseReachable(): Promise<boolean> {
  if (!env.isConfigured) return false;
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

const reachable = await supabaseReachable();

describe.skipIf(!reachable)('match submission (live Supabase)', () => {
  let client: SupabaseClient;
  let email: string;
  let password: string;

  beforeAll(async () => {
    resetSupabaseClient();
    client = getSupabaseClient();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    email = `integration.${stamp}@example.com`;
    password = 'orbital-decay-7';

    const { error } = await client.auth.signUp({
      email,
      password,
      options: { data: { username: `Int_${stamp.slice(-10)}` } },
    });
    expect(error).toBeNull();
  }, 30000);

  afterAll(async () => {
    await client?.auth.signOut();
  });

  it('records a match, derives the score server-side and reports achievements', async () => {
    const result = await submitMatch({
      clientMatchId: createUuid(),
      mode: 'survival',
      waveReached: 5,
      eliminations: 23,
      deaths: 1,
      damageDealt: 1840,
      shotsFired: 120,
      shotsHit: 78,
      survivalSeconds: 142,
      outcome: 'defeat',
      bossDefeated: false,
      adapted: false,
    });

    expect(result.duplicate).toBe(false);
    // The exact score the SQL formula produces for these facts. If the client
    // and server formulas ever drift, this is where it shows up.
    expect(result.score).toBe(5 * 100 + 23 * 50 + 142 * 2);
    expect(result.xpAwarded).toBeGreaterThan(0);
    expect(result.matchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.stats.matches_played).toBe(1);
    expect(result.stats.highest_wave).toBe(5);
    expect(result.stats.total_eliminations).toBe(23);
    // A first kill earns First Blood; reaching wave 5 earns Holding Ground.
    expect(result.newAchievements).toContain('first_blood');
    expect(result.newAchievements).toContain('wave_5');
    expect(result.newAchievements).not.toContain('wave_10');
  }, 30000);

  it('rejects a replayed idempotency key without double-counting', async () => {
    const clientMatchId = createUuid();
    const facts = {
      clientMatchId,
      mode: 'survival' as const,
      waveReached: 2,
      eliminations: 4,
      deaths: 1,
      damageDealt: 120,
      shotsFired: 30,
      shotsHit: 12,
      survivalSeconds: 45,
      outcome: 'defeat' as const,
      bossDefeated: false,
      adapted: false,
    };

    const first = await submitMatch(facts);
    const replay = await submitMatch(facts);

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.matchId).toBe(first.matchId);
    expect(replay.stats.matches_played).toBe(first.stats.matches_played);
    expect(replay.stats.total_xp).toBe(first.stats.total_xp);
    expect(replay.newAchievements).toEqual([]);
  }, 30000);

  it('records a deathmatch without corrupting the survival wave statistic', async () => {
    // A deathmatch reports waveReached 0, because it has no waves. If that were
    // not so, a deathmatch would silently overwrite `highest_wave`. Earlier
    // tests in this file may already have set that record, so capture the value
    // first and assert it is left alone rather than assuming a fresh account.
    const { data: before } = await client
      .from('player_statistics')
      .select('highest_wave')
      .eq('profile_id', (await client.auth.getUser()).data.user!.id)
      .single();
    const highestWaveBefore = (before as { highest_wave: number } | null)?.highest_wave ?? 0;

    const result = await submitMatch({
      clientMatchId: createUuid(),
      mode: 'deathmatch',
      waveReached: 0,
      eliminations: 25,
      deaths: 2,
      damageDealt: 4200,
      shotsFired: 210,
      shotsHit: 140,
      survivalSeconds: 168,
      outcome: 'victory',
      bossDefeated: false,
      adapted: true,
    });

    expect(result.duplicate).toBe(false);
    // score = kills*50 + seconds*2 + victory*5000 + deathmatch kills*25
    expect(result.score).toBe(25 * 50 + 168 * 2 + 5000 + 25 * 25);
    expect(result.xpAwarded).toBeGreaterThan(0);
    // The deathmatch must not have moved the survival wave record.
    expect(result.stats.highest_wave).toBe(highestWaveBefore);
    expect(result.stats.total_eliminations).toBeGreaterThanOrEqual(25);
  }, 30000);

  it('refuses a payload the database would reject, before the round trip', async () => {
    await expect(
      submitMatch({
        clientMatchId: 'not-a-uuid',
        mode: 'survival',
        waveReached: 1,
        eliminations: 1,
        deaths: 1,
        damageDealt: 10,
        shotsFired: 5,
        shotsHit: 2,
        survivalSeconds: 10,
        outcome: 'defeat',
        bossDefeated: false,
        adapted: false,
      }),
    ).rejects.toThrow(/rejected/i);
  });

  it('refuses a boss kill that could not have happened on the reported wave', async () => {
    await expect(
      submitMatch({
        clientMatchId: createUuid(),
        mode: 'survival',
        waveReached: 3,
        eliminations: 5,
        deaths: 1,
        damageDealt: 100,
        shotsFired: 20,
        shotsHit: 10,
        survivalSeconds: 30,
        outcome: 'defeat',
        bossDefeated: true,
        adapted: false,
      }),
    ).rejects.toThrow();
  }, 30000);
});
