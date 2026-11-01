# LAST BREATH

**Survive the adaptation.**

A mobile-friendly, top-down 360° survival shooter where the arena studies how you fight. There is no fixed strategy — only the one the enemy has not learned yet.

Built for the **Loadout AI Game Competition**.

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

`npm run test` also runs `src/services/dataService.integration.test.ts` and `src/features/arena/operationsFlow.integration.test.ts`. Both sign throwaway operators up against the live local Supabase and submit real matches through the real RPC — the Operations one plays the real `CombatSimulation` to a completed extraction first. They **skip themselves** when no Supabase is reachable, so the suite passes in a bare environment; run `npm run db:start` to include them.

### Server integrity

The client is untrusted, so the database has to enforce its own rules. The pgTAP suites in `supabase/tests/` call the real RPCs as the real roles and prove that it does: server-side scoring, submission validation, idempotency, rate limiting, achievement awards, level-gated weapon unlocks, and row-level-security isolation between players.

```bash
npm run db:start        # once, if the stack is not already up
npm run verify:server   # resets the DB, runs pgTAP, then the live integration tests
```

`npm run verify:server` resets the database first, which also proves every migration still applies cleanly in order. CI runs it as a separate job (`Server integrity`).

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

**Desktop** — WASD or arrow keys to move, mouse to aim, left click to fire, **Shift** to dodge roll, **G** to throw a grenade, R to reload, Q to cycle weapons, Esc to pause.

**Mobile (Android)** — left thumbstick to move, right thumbstick to aim and fire, on-screen reload / weapon / dodge / grenade / pause buttons. Gameplay is landscape; a prompt appears if you hold the device upright.

---

## Game modes

**Survival** — the primary mode. Progressive waves, increasing pressure, health and ammunition pickups, and a boss every tenth wave. This is what the arena scores.

**Deathmatch** — a single-player match against AI-controlled opponents, with a timer, an elimination target and a results screen. Opponents are clearly labelled as AI; this is not online multiplayer and does not claim to be.

**Operations** — a scripted mission mode. **LAST EXIT** chains six objectives (clear, reach, hold, clear, reach, extract) across five escalating encounters; between encounters the arena freezes to offer a roguelite upgrade choice. Reaching the extraction pad and holding it completes the mission. An Operations run is recorded as `extracted` and scored on ground taken, not time served.

Seven enemy doctrines populate the arena: **rusher**, **flanker**, **sniper**, **tank**, **hunter**, **commander** (elects itself squad leader and calls reinforcements) and **medic** (revives downed allies) — plus **THE EXECUTOR** boss.

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

Part 3 turns the arena into a cinematic tactical survival game: articulated character rendering and animation, a tactical AI layer (squad election, cover, suppression, flanking, commander reinforcements, medic revives — seven doctrines in all), player **dodge roll** and **grenades**, a roguelite **upgrade** draft between fights, and the scripted **Operations** mission mode with server-authoritative scoring.

Part 4 hardens the server: a pgTAP integrity suite that calls the real RPCs as the real roles, an end-to-end test that plays a real mission through the real client and database, a CI job that runs both against a genuine local stack, and a fix for a silent progression bug where a level reached through achievement XP did not unlock the weapon gated at that level.

The build is Vercel-ready (`npm run build` → static `dist/`). Deployment requires the Supabase project URL and anon key as Vercel environment variables, plus running the migrations against the project database.
