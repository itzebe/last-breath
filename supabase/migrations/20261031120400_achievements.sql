-- ============================================================================
-- LAST BREATH — 05: achievement evaluation
-- ----------------------------------------------------------------------------
-- The `achievements` catalogue and `player_achievements` table shipped in 02/03,
-- but nothing ever wrote to `player_achievements` — the dashboard advertised
-- eight achievements that could never unlock. This migration closes that gap.
--
-- Design constraints, matching the rest of the schema:
--   * The client never states which achievements it earned. It submits match
--     facts (already the case) plus two run-level booleans that the server
--     cannot derive from those facts. The decision is made here.
--   * `authenticated` is granted no direct INSERT on `player_achievements`;
--     only this SECURITY DEFINER function writes rows, so a tampered client
--     cannot grant itself a badge.
--   * Awards are idempotent: `on conflict do nothing` plus a `returning` clause
--     means re-evaluating a match never double-counts the XP reward.
-- ============================================================================

-- ── Run-level facts that match history does not already carry ────────────────
alter table public.match_history
  add column if not exists boss_defeated boolean not null default false,
  add column if not exists adapted       boolean not null default false;

comment on column public.match_history.boss_defeated is
  'True when the player defeated THE EXECUTOR during this match.';
comment on column public.match_history.adapted is
  'True when the adaptive director committed at least one tactical change during this match.';

-- ── Achievement evaluation ───────────────────────────────────────────────────
-- Called by `submit_match` inside the same transaction, so a match and the
-- achievements it earns commit together or not at all.
create or replace function public.evaluate_achievements(
  p_uid              uuid,
  p_wave_reached     integer,
  p_eliminations     integer,
  p_shots_fired      integer,
  p_shots_hit        integer,
  p_survival_seconds integer,
  p_boss_defeated    boolean,
  p_adapted          boolean
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
  -- Each block states one rule. `distinct` keeps a single match from listing the
  -- same id twice if two rules happen to both hold.
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

comment on function public.evaluate_achievements is
  'Awards any newly-earned achievements for a finished match and pays their XP reward once. Server-authoritative.';

-- Only the definer-owned callers may run this; it is not a client entry point.
revoke all on function public.evaluate_achievements(
  uuid, integer, integer, integer, integer, integer, boolean, boolean
) from public, anon, authenticated;

-- ── submit_match: carry the new facts and evaluate achievements ──────────────
-- Adding trailing parameters with defaults keeps existing two-arg... call sites
-- working, so this is a compatible replace rather than a breaking signature
-- change. `create or replace` cannot add parameters to an existing function, so
-- the old signature is dropped first.
drop function if exists public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text
);

create or replace function public.submit_match(
  p_client_match_id  uuid,
  p_mode             text,
  p_wave_reached     integer,
  p_eliminations     integer,
  p_deaths           integer,
  p_damage_dealt     integer,
  p_shots_fired      integer,
  p_shots_hit        integer,
  p_survival_seconds integer,
  p_outcome          text,
  p_boss_defeated    boolean default false,
  p_adapted          boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid              uuid := auth.uid();
  v_existing         public.match_history;
  v_mode             text := coalesce(nullif(btrim(p_mode), ''), 'survival');
  v_outcome          text := coalesce(nullif(btrim(p_outcome), ''), 'defeat');
  v_boss_defeated    boolean := coalesce(p_boss_defeated, false);
  v_adapted          boolean := coalesce(p_adapted, false);
  v_score            integer;
  v_xp               integer;
  v_recent_minute    integer;
  v_recent_hour      integer;
  v_level_before     integer;
  v_level_after      integer;
  v_stats            public.player_statistics;
  v_new_weapons      text[] := array[]::text[];
  v_new_achievements text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_client_match_id is null then
    raise exception 'client_match_id_required' using errcode = '22023';
  end if;

  -- ── Shape validation ──────────────────────────────────────────────────────
  if v_mode not in ('survival', 'deathmatch') then
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
  -- A real match cannot be completed faster than this; the limit exists to make
  -- XP farming through fabricated rapid submissions impractical.
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
    + case when v_mode = 'deathmatch' then p_eliminations * 25 else 0 end;

  -- Diminishing returns for long, low-intensity sessions: the cube-root term
  -- keeps survival rewarding without making idling the optimal strategy.
  v_xp :=
    p_eliminations * 25
    + p_wave_reached * 120
    + least(p_survival_seconds, 3600) / 2
    + case when v_outcome = 'victory' then 750 else 0 end
    + least(round(sqrt(greatest(p_damage_dealt, 0)) * 2), 400)::integer;

  -- A match awards nothing unless something actually happened.
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
    outcome, boss_defeated, adapted
  ) values (
    v_uid, p_client_match_id, v_mode, p_wave_reached, p_eliminations, p_deaths,
    p_damage_dealt, p_shots_fired, p_shots_hit, p_survival_seconds, v_score, v_xp,
    v_outcome, v_boss_defeated, v_adapted
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
    p_survival_seconds, v_boss_defeated, v_adapted
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
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text, boolean, boolean
) from public;
grant execute on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text, boolean, boolean
) to authenticated;
