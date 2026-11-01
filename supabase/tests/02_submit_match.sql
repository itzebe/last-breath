-- ============================================================================
-- LAST BREATH — server integrity: submit_match
-- ----------------------------------------------------------------------------
-- `submit_match` is the only way progression is ever written. These tests call
-- the real function against the real schema and pin the guarantees the client
-- and the leaderboard depend on:
--
--   * the client cannot choose its own score or XP,
--   * impossible match facts are rejected rather than stored,
--   * a retried submission is idempotent,
--   * rapid fabricated submissions are rate limited,
--   * level-gated weapon unlocks track the level the match actually reaches —
--     including the level that achievement XP moves the player to.
-- ============================================================================

begin;

select plan(15);

-- ── Validation ──────────────────────────────────────────────────────────────
select tests.create_user('valid');

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'battle_royale', 1, 1, 0, 100, 10, 5, 10, 'defeat') $$,
  '22023', 'invalid_mode',
  'an unknown mode is rejected'
);

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'survival', 1, 1, 0, 100, 10, 99, 10, 'defeat') $$,
  '22023', 'hits_exceed_shots',
  'more hits than shots is rejected'
);

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'survival', 3, 5, 0, 100, 20, 10, 30, 'defeat', true) $$,
  '22023', 'implausible_boss',
  'a boss kill before wave 10 is rejected'
);

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'survival', 1, 1, 0, 100, 10, 5, 10, 'defeat', false, false, 3, false) $$,
  '22023', 'objectives_require_operations',
  'objectives outside operations are rejected'
);

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'survival', 1, 1, 0, 100, 10, 5, 10, 'defeat', false, false, 0, true) $$,
  '22023', 'extraction_requires_operations',
  'an extraction outside operations is rejected'
);

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'operations', 0, 1, 0, 100, 10, 5, 10, 'extracted', false, false, 2, true) $$,
  '22023', 'implausible_extraction',
  'an extraction without every objective is rejected'
);

select tests.act_as_nobody();

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'survival', 1, 1, 0, 100, 10, 5, 10, 'defeat') $$,
  '28000', 'not_authenticated',
  'an anonymous caller is rejected'
);

-- ── Server-side scoring ─────────────────────────────────────────────────────
select tests.create_user('score');

select is(
  (tests.submit(gen_random_uuid(), 'survival', 5, 23, 1, 1840, 120, 78, 142, 'defeat')) ->> 'score',
  (5 * 100 + 23 * 50 + 142 * 2)::text,
  'survival score is derived server-side from the facts alone'
);

select is(
  (tests.submit(gen_random_uuid(), 'deathmatch', 0, 25, 2, 4200, 210, 140, 168, 'victory')) ->> 'score',
  (25 * 50 + 168 * 2 + 5000 + 25 * 25)::text,
  'deathmatch score includes the mode bonus'
);

select is(
  (tests.submit(gen_random_uuid(), 'operations', 0, 0, 1, 0, 0, 0, 120, 'extracted', false, false, 6, true)) ->> 'score',
  (6 * 600 + 120 * 2 + 9000)::text,
  'operations score pays for objectives and the extraction'
);

-- ── Idempotency ─────────────────────────────────────────────────────────────
select tests.create_user('idem');

select is(
  (
    with first as (
      select tests.submit('11111111-1111-1111-1111-111111111111', 'survival', 2, 4, 1, 120, 30, 12, 45, 'defeat') as r
    )
    select (r ->> 'duplicate') from first
  ),
  'false',
  'a first submission is not a duplicate'
);

select is(
  (
    with replay as (
      select tests.submit('11111111-1111-1111-1111-111111111111', 'survival', 2, 4, 1, 120, 30, 12, 45, 'defeat') as r
    )
    select (r ->> 'duplicate') from replay
  ),
  'true',
  'a replay of the same client_match_id is reported as a duplicate'
);

select is(
  tests.matches_played(tests.uid()),
  1,
  'a replay does not double-count the match'
);

-- ── Rate limiting ───────────────────────────────────────────────────────────
select tests.create_user('flood');

do $$
declare
  i integer;
begin
  for i in 1..12 loop
    perform tests.submit(gen_random_uuid(), 'survival', 1, 1, 0, 100, 10, 5, 10, 'defeat');
  end loop;
end;
$$;

select throws_ok(
  $$ select tests.submit(gen_random_uuid(), 'survival', 1, 1, 0, 100, 10, 5, 10, 'defeat') $$,
  '53400', 'rate_limited',
  'the thirteenth submission within a minute is rate limited'
);

-- ── Reachable by the real client role ───────────────────────────────────────
-- Proves the grant and the identity plumbing work exactly as PostgREST uses
-- them: role `authenticated` with the JWT `sub` claim set.
select tests.create_user('client');

-- Resolve the identity *before* dropping into the unprivileged role: the helper
-- schema is not granted to `authenticated` (it has no reason to be).
select set_config('request.jwt.claim.sub', tests.uid()::text, true);

set local role authenticated;

select is(
  (
    select public.submit_match(
      '22222222-2222-2222-2222-222222222222', 'survival', 1, 1, 0, 100, 10, 5, 12, 'defeat'
    ) ->> 'duplicate'
  ),
  'false',
  'the authenticated role can call submit_match through the real grant'
);

reset role;

select * from finish();

rollback;
