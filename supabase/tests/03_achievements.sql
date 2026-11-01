-- ============================================================================
-- LAST BREATH — server integrity: achievements and weapon unlocks
-- ----------------------------------------------------------------------------
-- The achievement catalogue advertises ten badges and the weapon catalogue
-- advertises four weapons gated at levels 1/1/3/5. These tests prove the server
-- actually grants what it advertises, and they pin the ordering that used to be
-- wrong:
--
--   achievement XP is awarded *before* the level is read for weapon gates.
--
-- Under the old ordering a player whose level was pushed past a gate by
-- achievement XP never received that weapon, and never would on any later match
-- either, because the next match's lower bound was already above the gate. The
-- first test below is the regression guard for that bug.
-- ============================================================================

begin;

select plan(13);

-- ── REGRESSION: a level reached via achievement XP still unlocks its weapon ──
-- One survival match whose own XP lands at level 4 (shotgun's gate) but whose
-- achievements pay enough to reach level 6. `sniper` is gated at level 5 and
-- must be unlocked by this single match.
select tests.create_user('unlock');

select lives_ok(
  $$ select tests.submit(
       '33333333-3333-3333-3333-333333333333', 'survival', 10, 40, 0, 10000, 100, 70, 600,
       'victory', true, true
     ) $$,
  'a high-scoring match is accepted'
);

select is(
  tests.level_of(tests.uid()),
  6,
  'the match plus its achievement XP reaches level 6'
);

select ok(
  'sniper' = any (tests.weapons(tests.uid())),
  'sniper (gate level 5) is unlocked even though only achievement XP crossed the gate'
);

select ok(
  'shotgun' = any (tests.weapons(tests.uid())),
  'shotgun (gate level 3) is unlocked too'
);

select ok(
  'pistol' = any (tests.weapons(tests.uid()))
    and 'rifle' = any (tests.weapons(tests.uid())),
  'the default loadout is preserved'
);

-- ── Achievement catalogue behaviour ─────────────────────────────────────────
select tests.create_user('awards');

select is(
  (
    select array(
      select jsonb_array_elements_text(
        tests.submit(gen_random_uuid(), 'survival', 5, 23, 1, 1840, 120, 78, 142, 'defeat')
          -> 'new_achievements'
      ) order by 1
    )
  ),
  array['first_blood', 'marksman', 'wave_5'],
  'the first match awards first_blood, wave_5 and marksman (65% accuracy over 120 shots)'
);

select is(
  (
    select array(
      select jsonb_array_elements_text(
        tests.submit(gen_random_uuid(), 'survival', 10, 60, 1, 9000, 200, 140, 620, 'victory', true, true)
          -> 'new_achievements'
      ) order by 1
    )
  ),
  array['adaptation_seen', 'executor_down', 'survivor_300', 'wave_10'],
  'a strong second match adds wave_10, executor_down, survivor_300 and adaptation_seen'
);

select ok(
  (select 'survivor_300' = any (tests.achievements(tests.uid()))),
  'survivor_300 is awarded for a five-minute run'
);

select ok(
  (select 'adaptation_seen' = any (tests.achievements(tests.uid()))),
  'adaptation_seen is awarded when the director adapted'
);

select ok(
  (select 'wave_10' = any (tests.achievements(tests.uid()))),
  'wave_10 is awarded at wave 10'
);

-- ── Achievement XP is paid exactly once ─────────────────────────────────────
select tests.create_user('once');

select lives_ok(
  $$ select tests.submit('44444444-4444-4444-4444-444444444444', 'survival', 5, 20, 1, 1000, 100, 50, 200, 'defeat') $$,
  'the first submission runs'
);

select is(
  (
    with replay as (
      select tests.submit('44444444-4444-4444-4444-444444444444', 'survival', 5, 20, 1, 1000, 100, 50, 200, 'defeat') as r
    )
    select (r -> 'new_achievements') from replay
  ),
  '[]'::jsonb,
  'a replayed submission awards no achievements a second time'
);

select is(
  tests.total_xp(tests.uid()),
  (
    -- The match XP for those facts (50% accuracy, so no marksman badge), plus
    -- first_blood (50) + wave_5 (250), awarded once. A second payment would
    -- show up here as a higher total.
    (20 * 25 + 5 * 120 + 200 / 2 + least(round(sqrt(1000) * 2), 400)::int) + 300
  )::bigint,
  'achievement XP is paid exactly once across the match and its replay'
);

select * from finish();

rollback;
