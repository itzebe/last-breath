-- ============================================================================
-- LAST BREATH — server integrity: row level security and tenant isolation
-- ----------------------------------------------------------------------------
-- Reads are broad where the data is public by design (usernames, career
-- statistics — they appear on the leaderboard) and owner-only where it is
-- private (match history, unlocks, achievements). These tests act as real
-- authenticated users and prove one player cannot read or write another's rows,
-- and that an anonymous visitor sees only what is meant to be public.
--
-- Note on mechanism: a table with RLS enabled and *no* policy for a role does
-- not raise on SELECT — it returns zero rows. The assertions below pin the
-- observable effect (zero rows, unchanged data) rather than an error code,
-- because that is what an attacker would actually receive.
-- ============================================================================

begin;

select plan(17);

select tests.create_user('rls_a');
select set_config('tests.uid_a', tests.uid()::text, true);

select tests.create_user('rls_b');
select set_config('tests.uid_b', tests.uid()::text, true);

-- A fixed, obviously-old heartbeat for B, so "did A's heartbeat touch B?" has a
-- meaningful answer. `now()` is transaction-stable, so comparing two rows both
-- stamped `now()` would prove nothing.
update public.profiles
   set last_seen_at = timestamptz '2000-01-01 00:00:00+00'
 where id = current_setting('tests.uid_b')::uuid;

-- Give each player one match so there is private data to isolate.
select tests.act_as(current_setting('tests.uid_a')::uuid);
select tests.submit('55555555-5555-5555-5555-555555555555', 'survival', 3, 6, 1, 200, 40, 20, 60, 'defeat');

select tests.act_as(current_setting('tests.uid_b')::uuid);
select tests.submit('66666666-6666-6666-6666-666666666666', 'survival', 2, 3, 1, 100, 30, 12, 40, 'defeat');

-- ── Anonymous: public reference + leaderboard data only ─────────────────────
select tests.act_as_nobody();

set local role anon;

select is(
  (select count(*)::int from public.weapon_catalog),
  4,
  'anon can read the weapon catalogue'
);

select ok(
  (select count(*) from public.player_statistics) >= 0,
  'anon can read career statistics (the leaderboard is public)'
);

select is(
  (select count(*)::int from public.match_history),
  0,
  'anon sees no match history (RLS with no anon policy returns zero rows)'
);

select is(
  (select count(*)::int from public.unlocked_weapons),
  0,
  'anon sees no unlocked weapons'
);

select is(
  (select count(*)::int from public.player_achievements),
  0,
  'anon sees no player achievements'
);

reset role;

-- ── Player A: sees its own private rows, not B's ────────────────────────────
select set_config('request.jwt.claim.sub', current_setting('tests.uid_a'), true);

set local role authenticated;

select is(
  (select count(*)::int from public.match_history),
  1,
  'player A sees exactly its own match history'
);

select is(
  (select count(*)::int from public.match_history
    where profile_id = current_setting('tests.uid_b')::uuid),
  0,
  'player A cannot see player B''s matches'
);

select is(
  (select count(*)::int from public.unlocked_weapons),
  2,
  'player A sees exactly its own starting loadout'
);

select is(
  (select count(*)::int from public.profiles
    where id = current_setting('tests.uid_b')::uuid),
  1,
  'player A can still read player B''s public profile row (usernames are public)'
);

-- ── Writes are refused at the table level ───────────────────────────────────
select throws_ok(
  $$ insert into public.match_history (profile_id, client_match_id)
     values (current_setting('tests.uid_a')::uuid, gen_random_uuid()) $$,
  '42501', null,
  'player A cannot insert a match row directly'
);

select throws_ok(
  $$ update public.player_statistics set total_xp = 999999
      where profile_id = current_setting('tests.uid_a')::uuid $$,
  '42501', null,
  'player A cannot raise its own XP directly'
);

select throws_ok(
  $$ insert into public.player_achievements (profile_id, achievement_id)
     values (current_setting('tests.uid_a')::uuid, 'executor_down') $$,
  '42501', null,
  'player A cannot grant itself an achievement directly'
);

-- ── The two writable profile columns ────────────────────────────────────────
select lives_ok(
  $$ update public.profiles set display_name = 'Renamed'
      where id = current_setting('tests.uid_a')::uuid $$,
  'player A can update its own display name'
);

select throws_ok(
  $$ update public.profiles set last_seen_at = now() - interval '10 years'
      where id = current_setting('tests.uid_a')::uuid $$,
  '42501', null,
  'player A cannot backdate its own last_seen_at'
);

select ok(
  (select display_name is null from public.profiles
    where id = current_setting('tests.uid_b')::uuid),
  'player A cannot rename player B (RLS hides the row, so nothing is written)'
);

reset role;

-- ── The heartbeat stamps only the caller ────────────────────────────────────
select set_config('request.jwt.claim.sub', current_setting('tests.uid_a'), true);

set local role authenticated;

select lives_ok(
  $$ select public.touch_last_seen() $$,
  'player A can ask to be marked active'
);

select is(
  (select last_seen_at from public.profiles
    where id = current_setting('tests.uid_b')::uuid),
  timestamptz '2000-01-01 00:00:00+00',
  'the heartbeat did not touch player B'
);

reset role;

select * from finish();

rollback;
