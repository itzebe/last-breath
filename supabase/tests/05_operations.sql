-- ============================================================================
-- LAST BREATH — server integrity: Operations mode
-- ----------------------------------------------------------------------------
-- Operations is the mode most able to be gamed: it pays a large bonus for an
-- extraction the client claims. The server's defence is to make the claim
-- self-consistent — an extraction is only believable alongside a full objective
-- count, and both are counted from the submitted facts rather than trusted
-- outright. These tests pin the mode's scoring, its two achievements, and the
-- checks that stop an impossible extraction from being stored.
-- ============================================================================

begin;

select plan(9);

-- ── A complete run ──────────────────────────────────────────────────────────
-- Accuracy is kept below 60% so `marksman` does not muddy the achievement set;
-- the point here is the two Operations badges.
select tests.create_user('ops');
select set_config('tests.ops_uid', tests.uid()::text, true);

select is(
  (
    select array(
      select jsonb_array_elements_text(
        (select r from (select tests.submit(
           '77777777-7777-7777-7777-777777777777', 'operations', 0, 30, 1, 5000, 150, 80, 180,
           'extracted', false, false, 6, true
        ) as r) s) -> 'new_achievements'
      ) order by 1
    )
  ),
  array['extraction_ready', 'first_blood', 'objective_focus'],
  'a full six-objective extraction is accepted and awards both Operations badges'
);

select is(
  (
    select score from public.match_history
     where client_match_id = '77777777-7777-7777-7777-777777777777'
  ),
  30 * 50 + 180 * 2 + 6 * 600 + 9000,
  'operations score pays for objectives and the extraction, computed server-side'
);

select is(
  (
    select xp_awarded from public.match_history
     where client_match_id = '77777777-7777-7777-7777-777777777777'
  ),
  30 * 25 + 180 / 2 + least(round(sqrt(5000) * 2), 400)::int + 6 * 150 + 1200,
  'operations XP includes the objective and extraction rewards'
);

select ok(
  (
    select objectives_completed = 6 and extracted
      from public.match_history
     where client_match_id = '77777777-7777-7777-7777-777777777777'
  ),
  'the objective count and extraction flag are persisted on the match row'
);

select is(
  (
    select highest_wave from public.player_statistics
     where profile_id = current_setting('tests.ops_uid')::uuid
  ),
  0,
  'an operations run (wave 0) does not corrupt the survival wave record'
);

-- ── Impossible extractions ──────────────────────────────────────────────────
select tests.create_user('ops_bad');

select throws_ok(
  $$ select tests.submit(
       gen_random_uuid(), 'operations', 0, 10, 0, 500, 20, 10, 90, 'extracted', false, false, 5, true
     ) $$,
  '22023', 'implausible_extraction',
  'an extraction with only five objectives is rejected'
);

select throws_ok(
  $$ select tests.submit(
       gen_random_uuid(), 'operations', 0, 10, 0, 500, 20, 10, 90, 'defeat', false, false, 65, false
     ) $$,
  '22023', 'invalid_objectives',
  'an objective count beyond the mission cap is rejected'
);

-- ── A partial run still counts ──────────────────────────────────────────────
select is(
  (
    select array(
      select jsonb_array_elements_text(
        (select r from (select tests.submit(
           gen_random_uuid(), 'operations', 0, 8, 1, 400, 30, 15, 120, 'defeat', false, false, 3, false
        ) as r) s) -> 'new_achievements'
      ) order by 1
    )
  ),
  array['first_blood'],
  'a partial operations run earns no extraction badge, only what the facts support'
);

-- ── Replay of an operations result is idempotent ────────────────────────────
select tests.act_as(current_setting('tests.ops_uid')::uuid);

select is(
  (
    select (tests.submit(
       '77777777-7777-7777-7777-777777777777', 'operations', 0, 30, 1, 5000, 150, 80, 180,
       'extracted', false, false, 6, true
    ) ->> 'duplicate')
  ),
  'true',
  'resubmitting an operations result is reported as a duplicate'
);

select * from finish();

rollback;
