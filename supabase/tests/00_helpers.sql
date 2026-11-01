-- ============================================================================
-- LAST BREATH — server integrity suite: shared helpers
-- ----------------------------------------------------------------------------
-- This file is COMMITTED, unlike the test files that follow it. pg_prove runs
-- every file in its own session, so the helpers defined here have to outlive
-- this file's session to be visible to `01_…` onwards. Each test file therefore
-- opens its own transaction and rolls it back; this one does not.
--
-- Run with:  npm run test:db      (wraps `supabase test db supabase/tests`)
--
-- The helpers drive the *real* schema: real auth.users rows (so the real
-- provisioning trigger fires), the real `auth.uid()` claim, and the real
-- `public.submit_match` RPC. Nothing here reimplements application logic.
-- ============================================================================

create extension if not exists pgtap with schema extensions;

-- pgTAP installs into `extensions` (the default search path includes it), but
-- the RLS tests run as `authenticated`, which needs explicit grants to call
-- the assertion functions. Granting only pgTAP's own functions (rather than
-- "all functions in schema extensions") avoids noisy warnings about the
-- platform's unrelated helpers.
grant usage on schema extensions to authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_depend d
    join pg_extension e on e.oid = d.refobjid and d.deptype = 'e'
    join pg_proc p on p.oid = d.objid
    where e.extname = 'pgtap'
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

create schema if not exists tests;

comment on schema tests is
  'Helpers for the server-integrity suite. Test-only; never referenced by application code.';

-- ── Identity ────────────────────────────────────────────────────────────────
-- Creates a real auth.users row so the production provisioning trigger runs,
-- then points the PostgREST-style claim at it. Returns the new uuid.
create or replace function tests.create_user(p_prefix text default 'op')
returns uuid
language plpgsql
as $$
declare
  v_uid      uuid := gen_random_uuid();
  v_suffix   text := substr(md5(random()::text), 1, 10);
begin
  insert into auth.users (
    id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at
  ) values (
    v_uid,
    lower(p_prefix) || '.' || v_suffix || '@example.test',
    jsonb_build_object('username', upper(p_prefix) || '_' || v_suffix),
    'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000', now(), now()
  );

  perform set_config('tests.uid', v_uid::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  return v_uid;
end;
$$;

comment on function tests.create_user(text) is
  'Provisions a real user (trigger included) and acts as it. Test helper.';

-- Switches the acting identity, e.g. to prove one user cannot read another's rows.
create or replace function tests.act_as(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('tests.uid', p_uid::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end;
$$;

-- Clears the identity so `auth.uid()` is null (the anonymous case).
create or replace function tests.act_as_nobody()
returns void
language plpgsql
as $$
begin
  perform set_config('tests.uid', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

create or replace function tests.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('tests.uid', true), '')::uuid $$;

-- ── The RPC under test ──────────────────────────────────────────────────────
-- SECURITY DEFINER, mirroring how PostgREST calls `submit_match` as the table
-- owner after resolving the JWT. It sets the claim from the acting identity and
-- forwards every argument, so a test never has to remember the claim.
create or replace function tests.submit(
  p_client_match_id      uuid,
  p_mode                 text,
  p_wave_reached         integer,
  p_eliminations         integer,
  p_deaths               integer,
  p_damage_dealt         integer,
  p_shots_fired          integer,
  p_shots_hit            integer,
  p_survival_seconds     integer,
  p_outcome              text,
  p_boss_defeated        boolean default false,
  p_adapted              boolean default false,
  p_objectives_completed integer default 0,
  p_extracted            boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(current_setting('tests.uid', true), ''), true);
  return public.submit_match(
    p_client_match_id, p_mode, p_wave_reached, p_eliminations, p_deaths,
    p_damage_dealt, p_shots_fired, p_shots_hit, p_survival_seconds, p_outcome,
    p_boss_defeated, p_adapted, p_objectives_completed, p_extracted
  );
end;
$$;

-- ── Read-back conveniences ──────────────────────────────────────────────────
create or replace function tests.total_xp(p_uid uuid)
returns bigint language sql stable as $$
  select total_xp from public.player_statistics where profile_id = p_uid
$$;

create or replace function tests.level_of(p_uid uuid)
returns integer language sql stable as $$
  select level from public.player_statistics where profile_id = p_uid
$$;

create or replace function tests.matches_played(p_uid uuid)
returns integer language sql stable as $$
  select matches_played from public.player_statistics where profile_id = p_uid
$$;

create or replace function tests.weapons(p_uid uuid)
returns text[] language sql stable as $$
  select coalesce(array_agg(weapon_id order by weapon_id), array[]::text[])
  from public.unlocked_weapons where profile_id = p_uid
$$;

create or replace function tests.achievements(p_uid uuid)
returns text[] language sql stable as $$
  select coalesce(array_agg(achievement_id order by achievement_id), array[]::text[])
  from public.player_achievements where profile_id = p_uid
$$;

-- ── Self-check ──────────────────────────────────────────────────────────────
select plan(4);

select has_schema('tests', 'test helper schema exists');

select is(
  (select count(distinct p.proname)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tests' and p.proname in
      ('create_user', 'act_as', 'act_as_nobody', 'uid', 'submit',
       'total_xp', 'level_of', 'matches_played', 'weapons', 'achievements')),
  10,
  'all ten helpers are installed'
);

select is(
  (select count(*)::int from public.weapon_catalog),
  4,
  'reference data is present (four weapons)'
);

select is(
  (select count(*)::int from public.achievements),
  10,
  'reference data is present (ten achievements)'
);

select * from finish();
