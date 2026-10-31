-- ============================================================================
-- LAST BREATH — 02: core tables
-- ----------------------------------------------------------------------------
-- Ownership model: every player-owned row hangs off `profiles.id`, which is the
-- same uuid as `auth.users.id`. RLS policies therefore reduce to
-- `auth.uid() = <owner column>`.
--
-- Trust model: the client is untrusted. Every column that feeds progression
-- (xp, level, eliminations, bests) is either server-computed or constrained to a
-- physically plausible range, so a tampered client cannot mint absurd records.
-- ============================================================================

-- ── weapon_catalog ──────────────────────────────────────────────────────────
-- Reference data, not player data. The client mirrors these values for feel, but
-- this table is the authority for what exists and what may be unlocked.
create table public.weapon_catalog (
  id                text primary key,
  name              text not null,
  role              text not null,
  description       text not null,
  damage            numeric(6, 2) not null,
  fire_rate_ms      integer not null,
  reload_ms         integer not null,
  magazine          integer not null,
  pellets           integer not null default 1,
  spread_deg        numeric(5, 2) not null default 0,
  projectile_speed  integer not null,
  range_px          integer not null,
  is_default        boolean not null default false,
  unlock_level      integer not null default 1,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),

  constraint weapon_id_format check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint weapon_damage_positive check (damage > 0 and damage <= 1000),
  constraint weapon_fire_rate_positive check (fire_rate_ms between 20 and 5000),
  constraint weapon_reload_positive check (reload_ms between 100 and 20000),
  constraint weapon_magazine_positive check (magazine between 1 and 500),
  constraint weapon_pellets_positive check (pellets between 1 and 64),
  constraint weapon_spread_range check (spread_deg >= 0 and spread_deg <= 90),
  constraint weapon_speed_positive check (projectile_speed between 50 and 5000),
  constraint weapon_range_positive check (range_px between 50 and 5000),
  constraint weapon_unlock_level_positive check (unlock_level >= 1)
);

comment on table public.weapon_catalog is
  'Authoritative weapon definitions. Readable by everyone, writable by nobody at runtime.';

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      citext not null unique,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  -- Mirrors the client-side rule exactly: 3–20 chars, no leading/trailing "_".
  constraint profile_username_format
    check ((username::text) ~ '^[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]$'),
  constraint profile_username_reserved
    check (lower(username::text) <> all (array[
      'admin', 'administrator', 'system', 'lastbreath', 'last_breath', 'root',
      'moderator', 'mod', 'staff', 'support', 'official', 'null', 'undefined',
      'anonymous', 'guest'
    ])),
  constraint profile_display_name_len
    check (display_name is null or char_length(display_name) between 1 and 40)
);

comment on table public.profiles is
  'Public operator profile. One row per auth.users row, created automatically on sign-up.';

create index profiles_username_lower_idx on public.profiles (lower(username::text));
create index profiles_last_seen_idx on public.profiles (last_seen_at desc);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── player_statistics ───────────────────────────────────────────────────────
-- One row per player. `level` is a GENERATED column: it is a pure function of
-- total_xp, so it can never disagree with the XP total, and a client cannot
-- write it directly even by accident.
create table public.player_statistics (
  profile_id              uuid primary key references public.profiles (id) on delete cascade,

  total_xp                bigint not null default 0,
  level                   integer generated always as (public.level_for_xp(total_xp)) stored,

  matches_played          integer not null default 0,
  total_eliminations      integer not null default 0,
  total_deaths            integer not null default 0,
  total_damage_dealt      bigint not null default 0,
  total_shots_fired       bigint not null default 0,
  total_shots_hit         bigint not null default 0,
  total_play_seconds      bigint not null default 0,

  highest_wave            integer not null default 0,
  best_survival_seconds   integer not null default 0,
  best_eliminations       integer not null default 0,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint stats_non_negative check (
    total_xp >= 0 and matches_played >= 0 and total_eliminations >= 0
    and total_deaths >= 0 and total_damage_dealt >= 0 and total_shots_fired >= 0
    and total_shots_hit >= 0 and total_play_seconds >= 0 and highest_wave >= 0
    and best_survival_seconds >= 0 and best_eliminations >= 0
  ),
  -- Plausibility caps: a match cannot exceed these, so lifetime totals are
  -- bounded by a per-match limit multiplied by matches played. Blatant
  -- tampering is rejected by the database rather than stored and ranked.
  constraint stats_eliminations_plausible
    check (total_eliminations <= 5000 * greatest(matches_played, 1)),
  constraint stats_shots_plausible
    check (total_shots_hit <= total_shots_fired),
  constraint stats_wave_plausible
    check (highest_wave <= 9999),
  constraint stats_survival_plausible
    check (best_survival_seconds <= 14400),
  constraint stats_xp_plausible
    check (total_xp <= 500000 * greatest(matches_played, 1))
);

comment on table public.player_statistics is
  'Aggregate per-player career statistics. Publicly readable for the leaderboard, writable only by its owner.';

create index player_statistics_level_idx on public.player_statistics (level desc, total_xp desc);
create index player_statistics_wave_idx on public.player_statistics (highest_wave desc);
create index player_statistics_survival_idx on public.player_statistics (best_survival_seconds desc);
create index player_statistics_eliminations_idx on public.player_statistics (total_eliminations desc);

create trigger player_statistics_touch_updated_at
  before update on public.player_statistics
  for each row execute function public.touch_updated_at();

-- ── match_history ───────────────────────────────────────────────────────────
-- Append-only match ledger. `client_match_id` makes submission idempotent: a
-- retry after a dropped response cannot double-count a match.
create table public.match_history (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  client_match_id   uuid not null,

  mode              text not null default 'survival',
  wave_reached      integer not null default 0,
  eliminations      integer not null default 0,
  deaths            integer not null default 0,
  damage_dealt      integer not null default 0,
  shots_fired       integer not null default 0,
  shots_hit         integer not null default 0,
  survival_seconds  integer not null default 0,
  score             integer not null default 0,
  xp_awarded        integer not null default 0,
  outcome           text not null default 'defeat',

  created_at        timestamptz not null default now(),

  constraint match_mode_known check (mode in ('survival', 'deathmatch')),
  constraint match_outcome_known check (outcome in ('defeat', 'extracted', 'victory', 'abandoned')),
  constraint match_wave_range check (wave_reached between 0 and 9999),
  constraint match_eliminations_range check (eliminations between 0 and 5000),
  constraint match_deaths_range check (deaths between 0 and 5000),
  constraint match_damage_range check (damage_dealt between 0 and 100000000),
  constraint match_shots_range check (shots_fired between 0 and 200000),
  constraint match_hits_range check (shots_hit between 0 and 200000),
  constraint match_survival_range check (survival_seconds between 0 and 14400),
  constraint match_score_range check (score between 0 and 100000000),
  constraint match_xp_range check (xp_awarded between 0 and 500000),
  -- A match cannot report more hits than shots.
  constraint match_hits_not_above_shots check (shots_hit <= shots_fired),

  constraint match_client_id_unique unique (profile_id, client_match_id)
);

comment on table public.match_history is
  'Append-only record of completed matches. (profile_id, client_match_id) makes resubmission idempotent.';

create index match_history_profile_created_idx
  on public.match_history (profile_id, created_at desc);
create index match_history_mode_created_idx
  on public.match_history (mode, created_at desc);
create index match_history_score_idx
  on public.match_history (mode, score desc);

-- ── unlocked_weapons ────────────────────────────────────────────────────────
create table public.unlocked_weapons (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  weapon_id   text not null references public.weapon_catalog (id) on delete restrict,
  unlocked_at timestamptz not null default now(),
  source      text not null default 'default',

  primary key (profile_id, weapon_id),
  constraint unlocked_source_known check (source in ('default', 'level', 'achievement', 'grant'))
);

comment on table public.unlocked_weapons is
  'Weapons a player may select in the arena. Rows are granted by the server on level-up or sign-up.';

create index unlocked_weapons_weapon_idx on public.unlocked_weapons (weapon_id);

-- ── achievements (catalog) + player_achievements ────────────────────────────
-- Catalogue exists now so Part 2 adds rows, not tables.
create table public.achievements (
  id          text primary key,
  name        text not null,
  description text not null,
  xp_reward   integer not null default 0,
  sort_order  integer not null default 0,

  constraint achievement_id_format check (id ~ '^[a-z][a-z0-9_]{1,47}$'),
  constraint achievement_xp_positive check (xp_reward >= 0 and xp_reward <= 100000)
);

comment on table public.achievements is 'Achievement definitions. Reference data.';

create table public.player_achievements (
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  progress       integer not null default 0,

  primary key (profile_id, achievement_id),
  constraint player_achievement_progress_positive check (progress >= 0)
);

comment on table public.player_achievements is 'Achievements earned by a player.';
