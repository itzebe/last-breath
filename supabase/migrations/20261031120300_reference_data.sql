-- ============================================================================
-- LAST BREATH — 04: reference data (weapons + achievements)
-- ----------------------------------------------------------------------------
-- Migrations carry reference data so a fresh production database is immediately
-- functional. These rows are the authority for weapon behaviour; the client
-- mirrors them for simulation but cannot change them.
-- ============================================================================

insert into public.weapon_catalog (
  id, name, role, description, damage, fire_rate_ms, reload_ms, magazine,
  pellets, spread_deg, projectile_speed, range_px, is_default, unlock_level, sort_order
) values
  (
    'pistol', 'SIDEARM MK-IV', 'Balanced',
    'Standard-issue semi-automatic. Reliable, quick to reload, no clear weakness.',
    24, 260, 1150, 14, 1, 1.8, 780, 720, true, 1, 10
  ),
  (
    'rifle', 'VULCAN AR-9', 'Automatic',
    'Full-auto assault platform. High sustained output, traded for per-shot impact.',
    17, 95, 1750, 32, 1, 4.2, 900, 780, true, 1, 20
  ),
  (
    'shotgun', 'BREACHER 12', 'Close quarters',
    'Eight-pellet spread. Devastating inside its envelope, near-useless beyond it.',
    15, 780, 2600, 6, 8, 13.5, 640, 320, false, 3, 30
  ),
  (
    'sniper', 'LONGSHOT .50', 'Precision',
    'Single high-velocity round. Punishing damage, punishing cycle time.',
    105, 1350, 2400, 5, 1, 0.3, 1700, 1500, false, 5, 40
  )
on conflict (id) do update set
  name             = excluded.name,
  role             = excluded.role,
  description      = excluded.description,
  damage           = excluded.damage,
  fire_rate_ms     = excluded.fire_rate_ms,
  reload_ms        = excluded.reload_ms,
  magazine         = excluded.magazine,
  pellets          = excluded.pellets,
  spread_deg       = excluded.spread_deg,
  projectile_speed = excluded.projectile_speed,
  range_px         = excluded.range_px,
  is_default       = excluded.is_default,
  unlock_level     = excluded.unlock_level,
  sort_order       = excluded.sort_order;

insert into public.achievements (id, name, description, xp_reward, sort_order) values
  ('first_blood',      'First Blood',        'Eliminate your first hostile.',                     50,   10),
  ('wave_5',           'Holding Ground',     'Reach wave 5 in Survival.',                         250,  20),
  ('wave_10',          'Deep Run',           'Reach wave 10 in Survival.',                        750,  30),
  ('executor_down',    'Executor Down',      'Defeat THE EXECUTOR.',                              2500, 40),
  ('marksman',         'Marksman',           'Finish a match with at least 60% accuracy.',        400,  50),
  ('survivor_300',     'Long Haul',          'Survive five minutes in a single run.',             600,  60),
  ('centurion',        'Centurion',          'Eliminate 100 hostiles across all matches.',        1000, 70),
  ('adaptation_seen',  'Adaptation Observed', 'Reach a match where the AI has fully adapted.',    800,  80)
on conflict (id) do update set
  name        = excluded.name,
  description = excluded.description,
  xp_reward   = excluded.xp_reward,
  sort_order  = excluded.sort_order;
