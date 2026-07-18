# MINEDELVE

A Minesweeper roguelite, rebuilt from the original single-file Shiny app
(`../app.R`) as a full JavaScript/React game with a pure, JSON-driven engine.

Descend through a cursed mine. Every floor is a minefield — but mines cost
hearts, not your run. Enemies sleep beneath the tiles and wake when you dig
them up. Pick one of eight classes, fight, loot, shop, choose your path down,
kill the boss guarding every 5th floor, escape on floor 10 — then keep delving
endlessly.

## Run it

```bash
npm install
npm run dev        # play in the browser (Vite dev server)
npm run build      # production build -> dist/
npm run play       # headless JSON CLI (for LLMs / bots — see docs/LLM_PLAY.md)
npm run bot        # watch the example bot play a run
```

## Features

- **Endless runs** — clearing the floor-10 boss wins, then endless mode keeps
  scaling forever, with **corruption tiers** every 5 floors past the end
  (extra lurkers, tougher enemies, meaner mines).
- **A loop with teeth** — the floor quota is set *after* your opening dig (a
  lucky cascade can't trivialize a floor), and once the stairs open, lingering
  wakes the mine: every few turns something bounty-less claws out of the
  ground. Grab the last chest or get out.
- **8 classes** — Delver, Warden, Prospector, Sapper, Knight, Alchemist, Seer,
  Monk. Each has its own stats, kit, once-per-floor ability, and (for some)
  passives.
- **Enemies** — 10 monster types plus 3 bosses, with traits (thieves, healers,
  armored, spawners — and board attackers: the Barrow Mole re-buries your
  cleared tiles, the Powder Gremlin plants fresh mines, and ~1 in 10 chests is
  a Mimic). Bosses **enrage** at half health with a signature move. They wake
  when revealed and strike on visible timers; click a revealed enemy to fight
  back.
- **17 items & relics** — consumables (bombs, snares, maps, tonics...) and
  stacking or unique relics with real hooks into the engine (gold multipliers,
  auto-flags, thorns, slower enemies, extra ability charges...).
- **Economy with decisions** — shop prices drift up with depth, banked gold
  earns interest at each vault (capped), and shop rerolls get pricier within
  a visit.
- **Meta-progression** — four classes start locked behind feats (slay a boss,
  hold 200 gold, open 8 chests in a run, reach floor 6), plus a **Daily
  delve**: one shared seed per day, same mine for everyone.
- **Save states** — autosave after every action, 3 manual slots, and plain-JSON
  export/import (a save is just the engine state).
- **Playable by JSON alone** — the engine is pure (`state + action -> state`),
  deterministic (seeded RNG lives inside the state), and ships with a
  line-delimited JSON CLI plus an observation layer that hides mine data.
  An LLM can play the entire game without a browser. See `docs/LLM_PLAY.md`.

## Architecture

```
src/
  engine/
    rng.js       seeded RNG (mulberry32) — determinism & replays
    engine.js    the whole game: createRun / applyAction / serialize
    observe.js   observe(state) + legalActions(state) — the player-visible view
  content/       ← add new content here, no engine changes needed
    classes.js   class registry (stats, kits, abilities, passives)
    items.js     item & relic registry (effects + relic hooks)
    enemies.js   enemy & boss registry (stats + traits)
    floors.js    floor types, difficulty curve, path generation
  ui/
    App.jsx      React UI (screens, board, shop, saves modal)
    saves.js     localStorage autosave/slots/export-import
cli/
  play.mjs       stdin/stdout JSON protocol for headless play
  example_bot.mjs  baseline agent using only the public observation
docs/
  LLM_PLAY.md    full protocol + action reference for agents
```

The React UI and the CLI are both thin shells over the same engine. Every
mutation goes through `applyAction(state, action)`, which returns a fresh
state and never mutates its input — so undo, replays, save states, and
headless play all come for free.

## Extending the game

Everything is registry-driven; the engine reads the registries at runtime:

- **New item**: add an entry to `src/content/items.js` with a `use(state, H,
  target)` function. `H` is the helper API (reveal, damage, heal, gold, ...).
- **New relic**: same file, `kind: "relic"`, plus optional `hooks` (e.g.
  `modGold`, `onMineHit`, `floorStart`, `onEnemyAttack`).
- **New class**: add to `src/content/classes.js` — stats, kit, an `ability`
  with a `use` function, optional `onFloorStart`/`afterPlacement` passives.
- **New enemy/boss**: add to `src/content/enemies.js` with stats, a floor
  range, and traits (`steal`, `healer`, `armored`, `spawner`).
- **New floor type**: add to `src/content/floors.js` and list it in
  `PATH_CANDIDATES`.

New entries automatically appear in shops, chests, class selection, path
choices, the CLI `content` listing, and the UI — they're all driven by the
same registries.
