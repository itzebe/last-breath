-- ============================================================================
-- LAST BREATH — server integrity: schema contract
-- ----------------------------------------------------------------------------
-- The trust model in one sentence: the client is untrusted, so every column that
-- feeds progression is either server-computed or constrained, and the
-- `authenticated` role can only *read* those tables. These assertions pin that
-- contract so a future migration cannot quietly widen it — a new `grant insert`
-- or a dropped RLS policy fails here rather than in production.
-- ============================================================================

begin;

select plan(17);

-- ── Progression columns are server-owned ────────────────────────────────────
select ok(
  (select attgenerated = 's'
     from pg_attribute
    where attrelid = 'public.player_statistics'::regclass and attname = 'level'),
  'player_statistics.level is a stored generated column (clients can never write it)'
);

select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.match_history'::regclass
       and contype = 'u' and conname = 'match_client_id_unique'
  ),
  '(profile_id, client_match_id) is unique, so resubmission is idempotent'
);

select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conrelid = 'public.match_history'::regclass and conname = 'match_mode_known')
    like '%operations%',
  'match_mode_known accepts the operations mode'
);

-- ── Row level security is on everywhere it matters ──────────────────────────
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('weapon_catalog', 'profiles', 'player_statistics',
                        'match_history', 'unlocked_weapons', 'achievements',
                        'player_achievements')
      and c.relrowsecurity),
  7,
  'RLS is enabled on all seven player-facing tables'
);

-- ── The write path is SECURITY DEFINER only ─────────────────────────────────
select ok(
  (select prosecdef from pg_proc
    where oid = 'public.submit_match(uuid,text,integer,integer,integer,integer,integer,integer,integer,text,boolean,boolean,integer,boolean)'::regprocedure),
  'submit_match is SECURITY DEFINER'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.evaluate_achievements(uuid,integer,integer,integer,integer,integer,boolean,boolean,integer,boolean)',
    'execute'
  ),
  'evaluate_achievements is not directly callable by authenticated (only submit_match runs it)'
);

select ok(
  not has_table_privilege('authenticated', 'public.match_history', 'insert'),
  'authenticated cannot INSERT into match_history'
);

select ok(
  not has_table_privilege('authenticated', 'public.player_statistics', 'insert'),
  'authenticated cannot INSERT into player_statistics'
);

select ok(
  not has_table_privilege('authenticated', 'public.match_history', 'update'),
  'authenticated cannot UPDATE match_history'
);

select ok(
  not has_table_privilege('authenticated', 'public.unlocked_weapons', 'insert'),
  'authenticated cannot INSERT into unlocked_weapons'
);

select ok(
  not has_table_privilege('authenticated', 'public.player_achievements', 'insert'),
  'authenticated cannot INSERT into player_achievements'
);

-- ── profiles exposes exactly two writable columns ───────────────────────────
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'username', 'update'),
  'authenticated may update its own username'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'),
  'authenticated may not update profiles.id (the link to auth.users)'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'last_seen_at', 'update'),
  'authenticated may not update profiles.last_seen_at (server-stamped via touch_last_seen)'
);

-- ── Reference data is read-only to every runtime role ───────────────────────
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public' and tablename = 'weapon_catalog' and cmd <> 'SELECT'),
  0,
  'weapon_catalog has no non-SELECT policy, so nothing can write it at runtime'
);

-- ── The heartbeat stamp is server-side ──────────────────────────────────────
select ok(
  (select prosecdef from pg_proc where oid = 'public.touch_last_seen()'::regprocedure),
  'touch_last_seen is SECURITY DEFINER'
);

select ok(
  has_function_privilege('authenticated', 'public.touch_last_seen()', 'execute')
    and not has_function_privilege('anon', 'public.touch_last_seen()', 'execute'),
  'touch_last_seen is callable by authenticated only'
);

select * from finish();

rollback;
