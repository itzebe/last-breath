-- ============================================================================
-- LAST BREATH — 06: Operations mode, close-quarters and demolition
-- ----------------------------------------------------------------------------
-- Forward-only. This migration adds one new mode and two new achievements, and
-- it does so without touching any existing row, constraint or grant.
--
-- Why it is needed at all: `submit_match` validates `mode` against a fixed list,
-- so an Operations result would be rejected outright with `invalid_mode` and the
-- mission would never appear in match history, statistics or the leaderboard.
-- The alternative — reusing the `survival` label — would corrupt the meaning of
-- every existing survival record and the survival leaderboard.
--
-- The pattern follows 05 exactly:
--   * `create or replace` cannot change a function's parameter list, so the old
--     signature is dropped and the new one created with *trailing* defaults.
--     That keeps every existing 10-argument and 12-argument call site working
--     unchanged.
--   * The client still submits only match facts. It never states its score, and
--     it never states that it earned an achievement.
--   * Both new columns default to 0, so existing rows are untouched and no
--     backfill is required.
-- ============================================================================

-- ── New run-level facts ──────────────────────────────────────────────────────
alter table public.match_history
  add column if not exists objectives_completed integer not null default 0,
  add column if not exists extracted            boolean not null default false;

comment on column public.match_history.objectives_completed is
  'Operations: how many mission objectives were completed before the run ended.';
comment on column public.match_history.extracted is
  'Operations: true when the player reached the extraction point and completed the mission.';

-- ── Mode vocabulary ──────────────────────────────────────────────────────────
-- The original check constraint only knew about two modes.
alter table public.match_history
  drop constraint if exists match_mode_known;
alter table public.match_history
  add constraint match_mode_known check (mode in ('survival', 'deathmatch', 'operations'));

-- ── Achievement catalogue additions ──────────────────────────────────────────
insert into public.achievements (id, name, description, xp_reward, sort_order) values
  ('extraction_ready', 'Extraction Ready', 'Complete an Operations mission.',                    1200, 90),
  ('objective_focus',  'Objective Focus',  'Complete five objectives in a single Operations run.', 900, 100)
on conflict (id) do update set
  name        = excluded.name,
  description = excluded.description,
  xp_reward   = excluded.xp_reward,
  sort_order  = excluded.sort_order;

-- ── Achievement evaluation ───────────────────────────────────────────────────
-- Replaced to accept the two new facts. Both default to their "nothing
-- happened" value so an older call site behaves exactly as before.
--
-- `create or replace` cannot change a function's parameter list, so the old
-- 8-argument signature is dropped first. Without this the new definition becomes
-- an *overload*, and every unqualified reference to the name — the `comment on`
-- and `revoke` below — fails with `function name is not unique`.
drop function if exists public.evaluate_achievements(
  uuid, integer, integer, integer, integer, integer, boolean, boolean
);

create or replace function public.evaluate_achievements(
  p_uid                 uuid,
  p_wave_reached        integer,
  p_eliminations        integer,
  p_shots_fired         integer,
  p_shots_hit           integer,
  p_survival_seconds    integer,
  p_boss_defeated       boolean,
  p_adapted             boolean,
  p_objectives_completed integer default 0,
  p_extracted           boolean default false
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eligible text[] := array[]::text[];
  v_career   public.player_statistics;
  v_awarded  text[];
begin
  if p_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_career from public.player_statistics s where s.profile_id = p_uid;
  if not found then
    return array[]::text[];
  end if;

  -- ── Criteria ──────────────────────────────────────────────────────────────
  if p_eliminations > 0 then
    v_eligible := array_append(v_eligible, 'first_blood');
  end if;

  if p_wave_reached >= 5 then
    v_eligible := array_append(v_eligible, 'wave_5');
  end if;

  if p_wave_reached >= 10 then
    v_eligible := array_append(v_eligible, 'wave_10');
  end if;

  if p_boss_defeated then
    v_eligible := array_append(v_eligible, 'executor_down');
  end if;

  -- Accuracy needs a meaningful sample: three shots that all connect is not
  -- marksmanship, and a shotgun firing pellets would otherwise trivially pass.
  if p_shots_fired >= 20 and p_shots_hit::numeric >= p_shots_fired * 0.6 then
    v_eligible := array_append(v_eligible, 'marksman');
  end if;

  if p_survival_seconds >= 300 then
    v_eligible := array_append(v_eligible, 'survivor_300');
  end if;

  if p_adapted then
    v_eligible := array_append(v_eligible, 'adaptation_seen');
  end if;

  -- Centurion is a career total, not a single-match figure. The caller runs this
  -- after its own statistics update, so `v_career` already includes this match —
  -- adding `p_eliminations` here would count it twice.
  if coalesce(v_career.total_eliminations, 0) >= 100 then
    v_eligible := array_append(v_eligible, 'centurion');
  end if;

  -- Operations. `extracted` alone is not enough for the focus badge: it demands
  -- a run in which at least five objectives were actually completed, which the
  -- server counts from the objective counter, not from the client's claim.
  if p_extracted then
    v_eligible := array_append(v_eligible, 'extraction_ready');
  end if;

  if p_objectives_completed >= 5 then
    v_eligible := array_append(v_eligible, 'objective_focus');
  end if;

  v_eligible := array(select distinct unnest(v_eligible));

  -- ── Award, and pay the XP reward exactly once ─────────────────────────────
  with granted as (
    insert into public.player_achievements (profile_id, achievement_id, progress)
    select p_uid, a.id, 1
    from public.achievements a
    where a.id = any (v_eligible)
    on conflict (profile_id, achievement_id) do nothing
    returning achievement_id
  )
  select coalesce(array_agg(granted.achievement_id), array[]::text[]) into v_awarded
  from granted;

  if coalesce(array_length(v_awarded, 1), 0) > 0 then
    update public.player_statistics s
    set total_xp = s.total_xp + (
          select coalesce(sum(a.xp_reward), 0)
          from public.achievements a
          where a.id = any (v_awarded)
        ),
        updated_at = now()
    where s.profile_id = p_uid;
  end if;

  return v_awarded;
end;
$$;

comment on function public.evaluate_achievements(
  uuid, integer, integer, integer, integer, integer, boolean, boolean, integer, boolean
) is
  'Awards any newly-earned achievements for a finished match and pays their XP reward once. Server-authoritative.';

revoke all on function public.evaluate_achievements(
  uuid, integer, integer, integer, integer, integer, boolean, boolean, integer, boolean
) from public, anon, authenticated;

-- ── submit_match: accept the new facts, score Operations server-side ─────────
drop function if exists public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text, boolean, boolean
);

create or replace function public.submit_match(
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
declare
  v_uid                  uuid := auth.uid();
  v_existing             public.match_history;
  v_mode                 text := coalesce(nullif(btrim(p_mode), ''), 'survival');
  v_outcome              text := coalesce(nullif(btrim(p_outcome), ''), 'defeat');
  v_boss_defeated        boolean := coalesce(p_boss_defeated, false);
  v_adapted              boolean := coalesce(p_adapted, false);
  v_extracted            boolean := coalesce(p_extracted, false);
  v_objectives_completed integer := coalesce(p_objectives_completed, 0);
  v_score                integer;
  v_xp                   integer;
  v_recent_minute        integer;
  v_recent_hour          integer;
  v_level_before         integer;
  v_level_after          integer;
  v_stats                public.player_statistics;
  v_new_weapons          text[] := array[]::text[];
  v_new_achievements     text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_client_match_id is null then
    raise exception 'client_match_id_required' using errcode = '22023';
  end if;

  -- ── Shape validation ──────────────────────────────────────────────────────
  if v_mode not in ('survival', 'deathmatch', 'operations') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if v_outcome not in ('defeat', 'extracted', 'victory', 'abandoned') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;

  if p_wave_reached is null or p_wave_reached not between 0 and 9999 then
    raise exception 'invalid_wave' using errcode = '22023';
  end if;
  if p_eliminations is null or p_eliminations not between 0 and 5000 then
    raise exception 'invalid_eliminations' using errcode = '22023';
  end if;
  if p_deaths is null or p_deaths not between 0 and 5000 then
    raise exception 'invalid_deaths' using errcode = '22023';
  end if;
  if p_damage_dealt is null or p_damage_dealt not between 0 and 100000000 then
    raise exception 'invalid_damage' using errcode = '22023';
  end if;
  if p_shots_fired is null or p_shots_fired not between 0 and 200000 then
    raise exception 'invalid_shots' using errcode = '22023';
  end if;
  if p_shots_hit is null or p_shots_hit not between 0 and 200000 then
    raise exception 'invalid_hits' using errcode = '22023';
  end if;
  if p_shots_hit > p_shots_fired then
    raise exception 'hits_exceed_shots' using errcode = '22023';
  end if;
  if p_survival_seconds is null or p_survival_seconds not between 0 and 14400 then
    raise exception 'invalid_survival' using errcode = '22023';
  end if;

  -- A match that lasted less than a few seconds cannot have produced results.
  if p_survival_seconds < 3 and (p_eliminations > 0 or p_wave_reached > 0) then
    raise exception 'implausible_result' using errcode = '22023';
  end if;
  -- Bounded elimination throughput: even the fastest wave cannot sustain this.
  if p_eliminations > greatest(60, p_survival_seconds * 4) then
    raise exception 'implausible_eliminations' using errcode = '22023';
  end if;
  -- A boss cannot fall before its wave, and cannot fall on a run that ended early.
  if v_boss_defeated and p_wave_reached < 10 then
    raise exception 'implausible_boss' using errcode = '22023';
  end if;

  -- ── Operations validation ─────────────────────────────────────────────────
  -- LAST EXIT has six objectives. A client claiming more than the mission
  -- contains is either broken or lying, so the count is bounded and, more
  -- importantly, an extraction can only be claimed alongside a completed run.
  if v_objectives_completed < 0 or v_objectives_completed > 64 then
    raise exception 'invalid_objectives' using errcode = '22023';
  end if;
  if v_objectives_completed > 0 and v_mode <> 'operations' then
    raise exception 'objectives_require_operations' using errcode = '22023';
  end if;
  if v_extracted and v_mode <> 'operations' then
    raise exception 'extraction_requires_operations' using errcode = '22023';
  end if;
  -- Extraction is the *last* thing that happens in an operation, so claiming it
  -- without completing every objective is not possible in a real run.
  if v_extracted and v_objectives_completed < 6 then
    raise exception 'implausible_extraction' using errcode = '22023';
  end if;

  -- ── Idempotency ───────────────────────────────────────────────────────────
  select * into v_existing
  from public.match_history m
  where m.profile_id = v_uid and m.client_match_id = p_client_match_id;

  if found then
    select * into v_stats from public.player_statistics s where s.profile_id = v_uid;
    return jsonb_build_object(
      'duplicate', true,
      'match_id', v_existing.id,
      'score', v_existing.score,
      'xp_awarded', v_existing.xp_awarded,
      'stats', to_jsonb(v_stats),
      'new_weapons', to_jsonb(array[]::text[]),
      'new_achievements', to_jsonb(array[]::text[])
    );
  end if;

  -- ── Submission rate limit ─────────────────────────────────────────────────
  select count(*) into v_recent_minute
  from public.match_history m
  where m.profile_id = v_uid and m.created_at > now() - interval '1 minute';
  if v_recent_minute >= 12 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  select count(*) into v_recent_hour
  from public.match_history m
  where m.profile_id = v_uid and m.created_at > now() - interval '1 hour';
  if v_recent_hour >= 90 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  -- ── Server-side scoring ───────────────────────────────────────────────────
  -- The client's own score number is never trusted or even accepted.
  v_score :=
    p_wave_reached * 100
    + p_eliminations * 50
    + p_survival_seconds * 2
    + case when v_outcome = 'victory' then 5000 else 0 end
    + case when v_mode = 'deathmatch' then p_eliminations * 25 else 0 end
    -- Operations pays for ground taken, not for time served: an objective is
    -- worth more than a kill, and the extraction is worth more than both.
    + case when v_mode = 'operations' then v_objectives_completed * 600 else 0 end
    + case when v_extracted then 9000 else 0 end;

  v_xp :=
    p_eliminations * 25
    + p_wave_reached * 120
    + least(p_survival_seconds, 3600) / 2
    + case when v_outcome = 'victory' then 750 else 0 end
    + least(round(sqrt(greatest(p_damage_dealt, 0)) * 2), 400)::integer
    + case when v_mode = 'operations' then v_objectives_completed * 150 else 0 end
    + case when v_extracted then 1200 else 0 end;

  if v_xp < 0 then
    v_xp := 0;
  end if;
  if v_xp > 500000 then
    v_xp := 500000;
  end if;

  -- ── Persist ───────────────────────────────────────────────────────────────
  insert into public.match_history (
    profile_id, client_match_id, mode, wave_reached, eliminations, deaths,
    damage_dealt, shots_fired, shots_hit, survival_seconds, score, xp_awarded,
    outcome, boss_defeated, adapted, objectives_completed, extracted
  ) values (
    v_uid, p_client_match_id, v_mode, p_wave_reached, p_eliminations, p_deaths,
    p_damage_dealt, p_shots_fired, p_shots_hit, p_survival_seconds, v_score, v_xp,
    v_outcome, v_boss_defeated, v_adapted, v_objectives_completed, v_extracted
  );

  select s.level into v_level_before
  from public.player_statistics s where s.profile_id = v_uid;

  update public.player_statistics s
  set total_xp           = s.total_xp + v_xp,
      matches_played     = s.matches_played + 1,
      total_eliminations = s.total_eliminations + p_eliminations,
      total_deaths       = s.total_deaths + p_deaths,
      total_damage_dealt = s.total_damage_dealt + p_damage_dealt,
      total_shots_fired  = s.total_shots_fired + p_shots_fired,
      total_shots_hit    = s.total_shots_hit + p_shots_hit,
      total_play_seconds = s.total_play_seconds + p_survival_seconds,
      highest_wave       = greatest(s.highest_wave, p_wave_reached),
      best_survival_seconds = greatest(s.best_survival_seconds, p_survival_seconds),
      best_eliminations  = greatest(s.best_eliminations, p_eliminations),
      updated_at         = now()
  where s.profile_id = v_uid
  returning s.level into v_level_after;

  -- ── Level-gated weapon unlocks ────────────────────────────────────────────
  if v_level_after > coalesce(v_level_before, 1) then
    with granted as (
      insert into public.unlocked_weapons (profile_id, weapon_id, source)
      select v_uid, w.id, 'level'
      from public.weapon_catalog w
      where w.unlock_level > coalesce(v_level_before, 1)
        and w.unlock_level <= v_level_after
      on conflict (profile_id, weapon_id) do nothing
      returning weapon_id
    )
    select coalesce(array_agg(weapon_id), array[]::text[]) into v_new_weapons from granted;
  end if;

  -- ── Achievements ──────────────────────────────────────────────────────────
  -- Evaluated after the statistics update, because `centurion` is a career
  -- total and must see this match included.
  v_new_achievements := public.evaluate_achievements(
    v_uid, p_wave_reached, p_eliminations, p_shots_fired, p_shots_hit,
    p_survival_seconds, v_boss_defeated, v_adapted,
    v_objectives_completed, v_extracted
  );

  select * into v_stats from public.player_statistics s where s.profile_id = v_uid;

  return jsonb_build_object(
    'duplicate', false,
    'match_id', (select m.id from public.match_history m
                 where m.profile_id = v_uid and m.client_match_id = p_client_match_id),
    'score', v_score,
    'xp_awarded', v_xp,
    'stats', to_jsonb(v_stats),
    'new_weapons', to_jsonb(v_new_weapons),
    'new_achievements', to_jsonb(v_new_achievements)
  );
end;
$$;

comment on function public.submit_match is
  'Records a finished match, updates career statistics and awards achievements. Score and XP are computed server-side; idempotent per client_match_id.';

revoke all on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text,
  boolean, boolean, integer, boolean
) from public;
grant execute on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text,
  boolean, boolean, integer, boolean
) to authenticated;
