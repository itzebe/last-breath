-- ============================================================================
-- LAST BREATH — 07: weapon unlocks must see achievement XP
-- ----------------------------------------------------------------------------
-- Forward-only. No table, column, policy or grant changes: this replaces
-- `submit_match` and nothing else.
--
-- The bug
-- -------
-- `submit_match` computed level-gated weapon unlocks in this order:
--
--   1. update player_statistics with the match XP  → v_level_after
--   2. grant every weapon whose gate lies in (v_level_before, v_level_after]
--   3. award achievements, which pay XP and can raise the level again
--
-- Step 3 runs after step 2, so XP paid by achievements can push a player across
-- a weapon gate *after* the only pass that looks for newly-crossed gates. The
-- weapon is then never granted: on the next match `v_level_before` already sits
-- at or above the gate, so the `> v_level_before` lower bound is false forever.
-- The loss is permanent and silent — the loadout screen simply shows one fewer
-- weapon than the level promises.
--
-- Reproduction (verified against a real database): a single survival match that
-- earns wave_10 + executor_down + marksman + survivor_300 + adaptation_seen
-- reaches level 6, yet `unlocked_weapons` holds only pistol, rifle and shotgun —
-- `sniper`, gated at level 5, is missing.
--
-- The fix
-- -------
--   * Evaluate achievements *before* the unlock pass, so every XP source for the
--     match has already landed in `player_statistics`.
--   * Re-read the level after the award, because that award can move it.
--   * Grant every weapon the current level allows, not only those in the
--     (before, after] window. `on conflict do nothing` keeps this idempotent and
--     means `new_weapons` still reports only genuinely-new unlocks — while also
--     self-healing any account whose gate was missed by the old ordering.
-- ============================================================================

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
    -- Operations pays for ground taken, not for time served.
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
  where s.profile_id = v_uid;

  -- ── Achievements ──────────────────────────────────────────────────────────
  -- Evaluated before the unlock pass and after the statistics update: `centurion`
  -- is a career total and must see this match, and the XP the award pays must be
  -- in `total_xp` before the level is read for the weapon gates.
  v_new_achievements := public.evaluate_achievements(
    v_uid, p_wave_reached, p_eliminations, p_shots_fired, p_shots_hit,
    p_survival_seconds, v_boss_defeated, v_adapted,
    v_objectives_completed, v_extracted
  );

  -- Re-read: the achievement award may have moved the level past a gate.
  select s.level into v_level_after
  from public.player_statistics s where s.profile_id = v_uid;

  -- ── Level-gated weapon unlocks ────────────────────────────────────────────
  -- Every gate at or below the level now reached is (re-)asserted. Idempotent, so
  -- `new_weapons` reports only genuine unlocks, and any gate missed by the old
  -- ordering is repaired the next time a match is submitted.
  with granted as (
    insert into public.unlocked_weapons (profile_id, weapon_id, source)
    select v_uid, w.id, 'level'
    from public.weapon_catalog w
    where w.unlock_level > 1
      and w.unlock_level <= v_level_after
    on conflict (profile_id, weapon_id) do nothing
    returning weapon_id
  )
  select coalesce(array_agg(weapon_id), array[]::text[]) into v_new_weapons from granted;

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
  'Records a finished match, updates career statistics, awards achievements and syncs level-gated weapon unlocks. Score and XP are computed server-side; idempotent per client_match_id.';

revoke all on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text,
  boolean, boolean, integer, boolean
) from public;
grant execute on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text,
  boolean, boolean, integer, boolean
) to authenticated;
