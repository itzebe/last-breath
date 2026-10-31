# LAST BREATH

**Survive the adaptation.**

A mobile-friendly, top-down 360° survival shooter where the arena studies how you fight. There is no fixed strategy — only the one the enemy has not learned yet.

Built for the **Loadout AI Game Competition**. Part 2 of two.

---

## What this is

You drop into a dark industrial arena. Waves of hostiles escalate. Every tenth wave sends **THE EXECUTOR**. Between waves, the game watches *how* you play — how far you keep your enemies, how often you move, how predictably you circle — and re-arms the opposition against that specific habit.

The adaptation is not flavour text. It is a measurable behaviour-scoring system whose output changes enemy stances, preferred engagement ranges and spawn composition mid-run. A debug overlay makes the reading visible.

---

## Stack

| Layer | Choice |
| --- | --- |
| Interface | React 18 + TypeScript |
| Engine | Phaser 3 (rendering and input only) |
| Build | Vite 6 |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL with Row Level Security |
| Tests | Vitest |
| Deploy | Vercel-compatible static build |

### Architecture

The important boundary is between **the simulation** and **everything else**.

```
src/
  game/
    logic/        pure TypeScript — no Phaser, no DOM, no clock
      simulation.ts       the arena: steps by explicit dt
      tacticalDirector.ts adaptive AI decisions
      behaviour.ts        player-behaviour observation
      enemies.ts          archetypes and wave scaling
      waves.ts            wave planning
      weapons.ts player.ts vec.ts
    scenes/
      ArenaScene.ts       Phaser renders snapshots, forwards input
    audio/                procedural Web Audio
  features/               pages: landing, auth, dashboard, arena, leaderboard
  services/               the only place that talks to Supabase
  components/ui/          design-system primitives
  styles/                 tokens, base, components, app
supabase/migrations/      the schema, in order
```

`CombatSimulation` advances only when `step(dt)` is called. That is what makes combat, wave pacing and — most importantly — the adaptive AI testable in a headless test run, and it is why the AI can be *proven* to change behaviour rather than merely asserted to.

---

## Running it locally

### 1. Install

```bash
npm install
```

### 2. Start Supabase

```bash
npm run db:start     # starts the local stack and applies migrations
```

This prints a local API URL and anon key. Copy `.env.example` to `.env.local` and fill in:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the local anon key>
```

`.env.local` is gitignored. Never commit real keys. The anon key is a *publishable* key: it grants no data access on its own, because every table is guarded by RLS.

### 3. Run

```bash
npm run dev
```

Open the printed URL, register an operator, and hit **Play survival**.

---

## Verification

```bash
npm run verify     # typecheck + lint + tests + production build
```

Individually:

```bash
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint .
npm run test       # vitest run
npm run build      # tsc -b && vite build
```

`npm run test` also runs `src/services/dataService.integration.test.ts`, which signs a throwaway operator up against the live local Supabase and submits real matches through the real RPC. It **skips itself** when no Supabase is reachable, so the suite passes in a bare environment; run `npm run db:start` to include it.

---

## Security model

Writes to anything that feeds progression never go through the table.

The `authenticated` role has no `INSERT`/`UPDATE` on `player_statistics`, `match_history`, `unlocked_weapons` or `player_achievements`. Those rows are produced only by `SECURITY DEFINER` functions that **recompute** score and XP from raw match facts.

A tampered client can therefore lie about its match, but it cannot choose its own XP, its own level, its own rank, or its own achievements.

- **Score and XP are derived server-side.** The client submits facts; the client's own score number is never sent or accepted.
- **Submissions are idempotent** on a client-generated UUID, so a retry after a dropped response cannot double-count a match.
- **Rate limits** bound how fast matches can be submitted, which makes XP farming through fabricated rapid submissions impractical.
- **Plausibility checks** reject results that could not physically have happened (hits exceeding shots, implausible elimination throughput, a boss killed before its wave).
- **The service-role key never reaches the browser.** Only `VITE_`-prefixed values are bundled.

---

## Controls

**Desktop** — WASD or arrow keys to move, mouse to aim, left click to fire, R to reload, Q to cycle weapons, Esc to pause.

**Mobile (Android)** — left thumbstick to move, right thumbstick to aim and fire, on-screen reload / weapon / pause buttons. Gameplay is landscape; a prompt appears if you hold the device upright.

---

## Game modes

**Survival** — the primary mode. Progressive waves, increasing pressure, health and ammunition pickups, and a boss every tenth wave. This is what the arena scores.

**Deathmatch** — a single-player match against AI-controlled opponents, with a timer, an elimination target and a results screen. Opponents are clearly labelled as AI; this is not online multiplayer and does not claim to be.

---

## Weapons

Four weapons with genuinely different behaviour: a balanced **pistol**, an automatic **assault rifle**, a multi-pellet **shotgun** and a high-precision **sniper rifle**. Each has its own damage, fire rate, reload duration, magazine capacity, projectile behaviour and visual feedback. Weapons unlock by level and by pickups in the arena.

---

## Environment variables

| Variable | Scope | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | client | yes |
| `VITE_SUPABASE_ANON_KEY` | client | yes |
| `VITE_SITE_URL` | client | no — defaults to `window.location.origin` |
| `SUPABASE_SERVICE_ROLE_KEY` | local tooling only | no |
| `DATABASE_URL` | local tooling only | no |

---

## Status

Part 1 established the foundation: landing page, real Supabase authentication, player dashboard, and a fully functional combat arena with adaptive enemies.

Part 2 completes the experience: a deep adaptive-AI behaviour model with five enemy archetypes, the **THE EXECUTOR** boss with three phases and telegraphed attacks, survival as a scored progression mode, a single-player **deathmatch** against clearly-labelled AI opponents, XP/levels/unlocks/achievements, a global leaderboard, procedural audio, and a visual-polish pass.

The build is Vercel-ready (`npm run build` → static `dist/`). Deployment requires the Supabase project URL and anon key as Vercel environment variables, plus running the migrations against the project database.
