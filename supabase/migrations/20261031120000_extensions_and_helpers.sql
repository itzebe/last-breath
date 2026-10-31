-- ============================================================================
-- LAST BREATH — 01: extensions, domain helpers, generic triggers
-- ============================================================================

create extension if not exists citext;

-- Case-insensitive usernames: "Vega" and "vega" are the same operator.
comment on extension citext is 'Case-insensitive text, used for public usernames.';

-- ── Progression curve ───────────────────────────────────────────────────────
-- Level is a pure function of XP so it can never drift from the XP total, and
-- so it can be a GENERATED column (clients can never write it directly).
--
--   xp_for_level(L) = (L - 1)^2 * 250
--   1→0   2→250   3→1,000   4→2,250   5→4,000   6→6,250   10→20,250
create or replace function public.level_for_xp(p_xp bigint)
returns integer
language sql
immutable
parallel safe
as $$
  select greatest(1, 1 + floor(sqrt(greatest(coalesce(p_xp, 0), 0)::numeric / 250))::int);
$$;

comment on function public.level_for_xp(bigint) is
  'Player level derived from total XP. Pure + immutable so it can back a generated column.';

create or replace function public.xp_for_level(p_level integer)
returns bigint
language sql
immutable
parallel safe
as $$
  select (greatest(coalesce(p_level, 1), 1) - 1)::bigint ^ 2 * 250;
$$;

comment on function public.xp_for_level(integer) is
  'Inverse of level_for_xp: total XP required to reach a level.';

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
