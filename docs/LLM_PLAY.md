# Playing Minedelve as a program (or LLM)

The engine is pure JSON: `state + action -> state`, with the RNG inside the
state, so play is fully deterministic and resumable from any save. You never
need the browser.

## Quick start

```bash
npm run play
```

Then speak line-delimited JSON on stdin; every reply is one JSON line.

```jsonc
{"cmd":"new","classId":"delver","seed":42}
{"cmd":"act","action":{"type":"reveal","r":4,"c":5}}
{"cmd":"act","action":{"type":"flag","r":2,"c":3}}
{"cmd":"observe"}
{"cmd":"legal"}
{"cmd":"save"}                        // -> {"state":{...}} (a complete save)
{"cmd":"load","state":{ ... }}        // resume any save
{"cmd":"content"}                     // all classes/items/enemies/floor types
{"cmd":"quit"}
```

`act` replies include `observation` and `legal`; on an illegal action you get
`ok:false` plus an `error` string and the state is unchanged.

You can also import the engine directly (see `cli/example_bot.mjs`):

```js
import { createRun, applyAction } from "../src/engine/engine.js";
import { observe, legalActions } from "../src/engine/observe.js";
```

## The observation

`observe(state)` is everything a fair player may know. Hidden tiles never leak
mines, chests, or sleeping enemies.

Key fields:

| field | meaning |
|---|---|
| `phase` | `play`, `shop`, `won` (choose endless), `dead` |
| `hp`, `maxHp`, `gold`, `attack` | your stats; `attack` is damage per hit vs enemies |
| `items`, `relics`, `ability` | consumable counts, relic counts, ability charges |
| `board.grid` | rows of tokens (below) |
| `board.quota` | `{revealed, required}` — reach `required` to open the stairs |
| `board.totalMines`, `board.flagsPlaced` | mine accounting |
| `board.adjacency` | `"r,c" -> number` for revealed enemy/chest tiles (their mine count) |
| `enemies` | revealed, living enemies: `uid, name, r, c, hp, dmg, attacksIn, stunned, boss, traits` |
| `canDescend`, `bossAlive` | stairs state (boss floors need the boss dead) |
| `stir` | `{active, nextStirIn}` — once the quota is met, the mine spawns a bounty-less enemy every few turns; `nextStirIn` counts down |
| `corruption` | endless-mode tier (0 through floor 10); each tier adds lurkers and toughness, tiers 2/4 add mine damage |
| `mineDamage` | hearts lost per mine on this floor |
| `msg`, `log` | recent event text |
| `shop`, `paths` | present in `shop` phase: purchasables and descent choices |

Grid tokens: `#` hidden · `F` your flag · `0`-`8` revealed mine-count ·
`C` opened chest tile · `E<uid>` a living enemy (details in `enemies`) ·
`*` exploded mine · `M` mine (death reveal only).

## Actions

Phase `play`:

| action | notes |
|---|---|
| `{"type":"reveal","r":R,"c":C}` | dig a hidden tile. First dig of a floor is always safe (3×3). Mines cost `mineDamage` hearts |
| `{"type":"flag","r":R,"c":C}` | toggle a flag (does NOT pass a turn) |
| `{"type":"attack","r":R,"c":C}` | hit a revealed enemy for `attack` damage |
| `{"type":"useItem","id":"probe","r":R,"c":C}` | `r,c` only for targeted items |
| `{"type":"useAbility","r":R,"c":C}` | `r,c` only if `ability.needsTarget` |
| `{"type":"descend"}` | when `canDescend` — banks gold, ends the floor |
| `{"type":"tick"}` | time passes with no move: awake enemies count down and act. The browser UI fires this every 3 real-time seconds; in headless play, send it yourself to simulate time pressure (or omit it for pure turn-based play) |

Phase `shop`: `{"type":"buy","slot":N}`, `{"type":"reroll"}` (price escalates
per visit), `{"type":"rest"}` (12g, +1 heart), `{"type":"altar"}` (1 heart →
random relic, once per vault), `{"type":"choosePath","index":N}`. Shop prices
scale ~6% per floor (the observation's `price` field is already scaled), and
10% interest (capped at 30) is paid on banked gold when each vault opens.

Phase `won`: `{"type":"continueEndless"}` — or start a new run with `new`.

## Turn economy (important for strategy)

Every reveal, attack, consumed item/ability use, and `tick` passes one turn;
flags are free. Enemies fight on a **telegraph cycle**: an awake enemy counts
down (`attacksIn`), then spends one full turn **winding up** (`winding: true`,
`attacksIn: 0`) before acting — damage, gold theft (`steal`), ally healing
(`healer`), or spawning (`spawner`). A winding enemy WILL act on the next turn
unless you kill it, stun it, or absorb the hit with a shield. Additionally, at
most **2 non-boss enemies press the attack at once** (bosses always act);
extras show `lurking: true` and their countdowns are frozen until an attacker
dies or is stunned. Target priority follows from this: winding enemies first,
then active attackers; lurkers can wait.

In the browser the world also ticks every 3 real seconds (idling is not safe).
Headless play is real-time-free by default — the engine only advances on the
actions you send — so agents can think as long as they like, or self-impose
pressure by sending `tick` on their own schedule.

Other rules that matter:

- Numbers are honest minesweeper counts (enemy/chest tiles have counts too —
  see `board.adjacency`). They stay honest even when a Powder Gremlin plants
  a new mine — the numbers update.
- Flood fill stops at numbered tiles and at enemies.
- The quota is finalized after your first dig: you always owe a fraction of
  the safe tiles *remaining* after the opening cascade.
- The floor ends only via `descend`; clearing the quota just opens the stairs.
  Boss floors also require the boss dead. Once the stairs open, watch `stir`:
  lingering spawns awake, bounty-less enemies — full-clearing has a price.
- `armored` enemies take max 1 damage per hit — item/ability burst is capped;
  plan hit counts, not damage.
- Watch traits: `burrow` re-buries revealed tiles (can re-close the stairs!),
  `planter` adds mines, and roughly 1 in 10 chests is a Mimic. Bosses enrage
  once at half health (`enraged` in the enemy listing).
- Death is permanent for the run (`phase:"dead"`), but any earlier `save`
  snapshot can be `load`ed — useful for search/optimization.
- Same seed + same action sequence = identical outcome. Use this for A/B
  testing strategies and regression-testing balance changes.

## Optimizing / evaluating

`cli/example_bot.mjs` is a baseline agent (basic minesweeper deduction +
simple combat/shop policy) that prints a JSON result line — seed, result,
floor reached, gold, stats. Run it across seeds to benchmark a policy:

```bash
node cli/example_bot.mjs 42 delver
node cli/example_bot.mjs 42 knight
```

To evaluate balance changes, edit `src/content/*.js`, then re-run a fixed set
of seeds and compare floor/gold distributions.
