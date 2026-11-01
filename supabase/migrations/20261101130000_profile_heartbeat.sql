-- ============================================================================
-- LAST BREATH — 06: profile activity heartbeat
-- ----------------------------------------------------------------------------
-- Why this migration exists
--
-- `profiles.last_seen_at` is written by the client after sign-in so the column
-- tracks activity. Migration 03 deliberately grants the owner UPDATE on exactly
-- two columns — `username` and `display_name` — and revokes every other write,
-- because `id` links the row to `auth.users` and the rest of the row is server
-- owned. `last_seen_at` is therefore *not* writable by `authenticated`, and the
-- client's direct `update({ last_seen_at })` has always failed with 42501
-- (permission denied for table profiles). The failure is swallowed by the
-- best-effort caller, so it surfaced only as a 403 in the browser console on
-- every authenticated page load.
--
-- The fix keeps the narrow-grant model rather than widening it. Instead of
-- granting the client write access to a server-owned column (which would let a
-- client backdate or postdate its own activity), a SECURITY DEFINER function
-- stamps the timestamp server-side for the *calling* user only. The client can
-- ask to be marked active; it cannot choose the value or the row.
--
-- Forward-only and additive: no existing column, grant, policy, or function is
-- changed. `last_seen_at` already exists (migration 01) with `default now()`.
-- ============================================================================

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set last_seen_at = now()
   where id = (select auth.uid());
$$;

comment on function public.touch_last_seen() is
  'Stamps profiles.last_seen_at = now() for the calling user. Server-side so the owner needs no UPDATE grant on a server-owned column.';

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;
