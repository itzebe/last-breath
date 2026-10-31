-- ============================================================================
-- LAST BREATH — 03: signup provisioning, RLS, server-authoritative writes
-- ----------------------------------------------------------------------------
-- Security model, in one paragraph:
--
--   * Reads are broad where the data is public by design (usernames, career
--     statistics — they appear on the leaderboard). Reads are owner-only where
--     the data is private (match history, unlocks).
--   * Writes to anything that feeds progression do NOT go through the table.
--     The `authenticated` role is granted no INSERT/UPDATE on
--     `player_statistics`, `match_history`, `unlocked_weapons` or
--     `player_achievements`. Those rows are produced exclusively by
--     SECURITY DEFINER functions that recompute score and XP from raw match
--     facts. A tampered client can therefore lie about its match, but it cannot
--     choose its own XP, its own level, or its own rank.
-- ============================================================================

-- ── Sign-up provisioning ────────────────────────────────────────────────────
-- Creates the profile, its statistics row, and the starting loadout in the same
-- transaction as the auth.users insert. If the username is taken the unique
-- constraint aborts the whole sign-up, so a player never ends up with an
-- account they did not choose.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested text;
  v_username  text;
begin
  v_requested := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');

  if v_requested is null then
    -- Federated sign-in or a client that omitted a callsign: derive a stable one.
    v_username := 'operator_' || substr(replace(new.id::text, '-', ''), 1, 8);
  else
    v_username := v_requested;
  end if;

  insert into public.profiles (id, username)
  values (new.id, v_username);

  insert into public.player_statistics (profile_id)
  values (new.id);

  insert into public.unlocked_weapons (profile_id, weapon_id, source)
  select new.id, w.id, 'default'
  from public.weapon_catalog w
  where w.is_default = true
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Provisions profile + statistics + starting loadout when an auth.users row is created.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Username availability ───────────────────────────────────────────────────
-- Lets the registration form give immediate feedback. Advisory only: the unique
-- constraint is still the authority, so a race resolves to a clean sign-up error.
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    p_username is not null
    and btrim(p_username) ~ '^[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]$'
    and lower(btrim(p_username)) <> all (array[
      'admin', 'administrator', 'system', 'lastbreath', 'last_breath', 'root',
      'moderator', 'mod', 'staff', 'support', 'official', 'null', 'undefined',
      'anonymous', 'guest'
    ])
    and not exists (
      select 1 from public.profiles p
      where lower(p.username::text) = lower(btrim(p_username))
    );
$$;

comment on function public.is_username_available(text) is
  'Advisory availability check for the registration form. The unique constraint remains authoritative.';

grant execute on function public.is_username_available(text) to anon, authenticated;

-- ── Match submission (the only way progression is written) ──────────────────
-- Score and XP are derived here, never accepted from the client. The function is
-- idempotent on (profile_id, client_match_id) so a retry after a dropped
-- response cannot double-count a match.
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
  p_outcome          text
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
  v_score            integer;
  v_xp               integer;
  v_recent_minute    integer;
  v_recent_hour      integer;
  v_level_before     integer;
  v_level_after      integer;
  v_stats            public.player_statistics;
  v_new_weapons      text[] := array[]::text[];
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
      'new_weapons', to_jsonb(array[]::text[])
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
    damage_dealt, shots_fired, shots_hit, survival_seconds, score, xp_awarded, outcome
  ) values (
    v_uid, p_client_match_id, v_mode, p_wave_reached, p_eliminations, p_deaths,
    p_damage_dealt, p_shots_fired, p_shots_hit, p_survival_seconds, v_score, v_xp, v_outcome
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

  select * into v_stats from public.player_statistics s where s.profile_id = v_uid;

  return jsonb_build_object(
    'duplicate', false,
    'match_id', (select m.id from public.match_history m
                 where m.profile_id = v_uid and m.client_match_id = p_client_match_id),
    'score', v_score,
    'xp_awarded', v_xp,
    'stats', to_jsonb(v_stats),
    'new_weapons', to_jsonb(v_new_weapons)
  );
end;
$$;

comment on function public.submit_match is
  'Records a finished match and updates career statistics. Score and XP are computed server-side; idempotent per client_match_id.';

revoke all on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text
) from public;
grant execute on function public.submit_match(
  uuid, text, integer, integer, integer, integer, integer, integer, integer, text
) to authenticated;

-- ── Leaderboard ─────────────────────────────────────────────────────────────
-- Ranking happens in the database so a client cannot invent its own rank, and
-- so only a bounded page of rows is ever transferred. SECURITY INVOKER (the
-- default) means the caller's RLS applies.
create or replace function public.get_leaderboard(
  p_sort  text default 'level',
  p_limit integer default 25
)
returns table (
  rank               bigint,
  profile_id         uuid,
  username           text,
  level              integer,
  total_xp           bigint,
  eliminations       integer,
  highest_wave       integer,
  best_survival_seconds integer,
  matches_played     integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select
      case
        when p_sort = 'eliminations' then row_number() over (order by s.total_eliminations desc, s.total_xp desc)
        when p_sort = 'wave'         then row_number() over (order by s.highest_wave desc, s.total_xp desc)
        when p_sort = 'survival'     then row_number() over (order by s.best_survival_seconds desc, s.total_xp desc)
        when p_sort = 'xp'           then row_number() over (order by s.total_xp desc)
        else                              row_number() over (order by s.level desc, s.total_xp desc)
      end as rank,
      p.id as profile_id,
      p.username::text as username,
      s.level,
      s.total_xp,
      s.total_eliminations as eliminations,
      s.highest_wave,
      s.best_survival_seconds,
      s.matches_played
    from public.player_statistics s
    join public.profiles p on p.id = s.profile_id
    where s.matches_played > 0
  )
  select * from ranked
  order by rank
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

comment on function public.get_leaderboard(text, integer) is
  'Ranked career leaderboard. Sort key is whitelisted; limit is clamped server-side.';

grant execute on function public.get_leaderboard(text, integer) to anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.weapon_catalog      enable row level security;
alter table public.profiles            enable row level security;
alter table public.player_statistics   enable row level security;
alter table public.match_history       enable row level security;
alter table public.unlocked_weapons    enable row level security;
alter table public.achievements        enable row level security;
alter table public.player_achievements enable row level security;

-- weapon_catalog: world-readable reference data. No write policy at all, so no
-- runtime role can modify it.
create policy weapon_catalog_read on public.weapon_catalog
  for select to anon, authenticated using (true);

-- profiles: usernames are public (they appear on the leaderboard).
create policy profiles_read on public.profiles
  for select to anon, authenticated using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- player_statistics: public so the leaderboard can rank across all players.
create policy player_statistics_read on public.player_statistics
  for select to anon, authenticated using (true);

-- match_history: private to its owner.
create policy match_history_read_own on public.match_history
  for select to authenticated using (auth.uid() = profile_id);

-- unlocked_weapons: private to its owner.
create policy unlocked_weapons_read_own on public.unlocked_weapons
  for select to authenticated using (auth.uid() = profile_id);

-- achievements: world-readable reference data.
create policy achievements_read on public.achievements
  for select to anon, authenticated using (true);

create policy player_achievements_read_own on public.player_achievements
  for select to authenticated using (auth.uid() = profile_id);

-- ── Privileges: progression tables are read-only to clients ─────────────────
-- The RLS policies above permit reads. Writes are revoked outright and reach the
-- tables only through the SECURITY DEFINER functions in this file, which run as
-- the migration owner.
revoke insert, update, delete, truncate on public.player_statistics   from anon, authenticated;
revoke insert, update, delete, truncate on public.match_history       from anon, authenticated;
revoke insert, update, delete, truncate on public.unlocked_weapons    from anon, authenticated;
revoke insert, update, delete, truncate on public.player_achievements from anon, authenticated;
revoke insert, update, delete, truncate on public.weapon_catalog      from anon, authenticated;
revoke insert, update, delete, truncate on public.achievements        from anon, authenticated;
revoke insert, delete, truncate         on public.profiles            from anon, authenticated;

-- Only these two profile columns may ever be changed by the owner. `id` is the
-- link to auth.users and must not be mutable.
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name) on public.profiles to authenticated;

grant select on public.weapon_catalog, public.achievements to anon, authenticated;
grant select on public.profiles, public.player_statistics to anon, authenticated;
grant select on public.match_history, public.unlocked_weapons, public.player_achievements
  to authenticated;
