#!/usr/bin/env node
// =============================================================================
// EXAMPLE BOT — a tiny baseline agent that plays Minedelve through the same
// observation/action JSON an LLM would use. It only sees observe(state); it
// never touches hidden mine data. Use it as a template for smarter agents.
//
//   npm run bot                 one run with a random seed
//   node cli/example_bot.mjs 42 delver     (seed, classId)
//
// Strategy (deliberately simple):
//   1. Kill any revealed enemy (they snowball if ignored).
//   2. Descend as soon as the stairs open.
//   3. Basic minesweeper deduction: if a number already touches that many
//      flags, its other hidden neighbors are safe; if its hidden neighbors
//      all must be mines, flag them.
//   4. Otherwise reveal the hidden tile least likely to be a mine (global
//      density estimate). In the shop: rest when hurt, buy what it can, take
//      the treasure path when available.
// =============================================================================

import { createRun, applyAction } from "../src/engine/engine.js";
import { observe, legalActions } from "../src/engine/observe.js";

const seed = Number(process.argv[2]) || Math.floor(Math.random() * 1e9);
const classId = process.argv[3] || "delver";

let state = createRun(classId, seed);

const isHidden = (t) => t === "#";
const isNum = (t) => /^[0-8]$/.test(t);

function neighborsOf(r, c, rows, cols) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push([rr, cc]);
    }
  return out;
}

function pickPlayAction(ob) {
  // 1. Fight what's awake.
  if (ob.enemies.length) {
    const target = ob.enemies.sort((a, b) => a.hp - b.hp)[0];
    return { type: "attack", r: target.r, c: target.c };
  }
  // 2. Take the stairs.
  if (ob.canDescend) return { type: "descend" };

  const { grid, rows, cols } = { grid: ob.board.grid, rows: ob.board.rows, cols: ob.board.cols };

  // 3. Deduction pass over revealed numbers.
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = grid[r][c];
      const n = isNum(t) ? Number(t) : ob.board.adjacency[`${r},${c}`];
      if (n == null) continue;
      const nbs = neighborsOf(r, c, rows, cols);
      const hidden = nbs.filter(([rr, cc]) => isHidden(grid[rr][cc]));
      const flags = nbs.filter(([rr, cc]) => grid[rr][cc] === "F").length;
      if (!hidden.length) continue;
      if (flags >= n) {
        const [rr, cc] = hidden[0];
        return { type: "reveal", r: rr, c: cc }; // provably safe
      }
      if (hidden.length + flags === n) {
        const [rr, cc] = hidden[0];
        return { type: "flag", r: rr, c: cc }; // provably a mine
      }
    }

  // 4. Guess: prefer hidden tiles far from any number (frontier is riskier
  //    than the unexplored interior at typical densities).
  const hiddenTiles = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (isHidden(grid[r][c])) {
        const nearNumber = neighborsOf(r, c, rows, cols)
          .some(([rr, cc]) => isNum(grid[rr][cc]));
        hiddenTiles.push({ r, c, nearNumber });
      }
  if (!hiddenTiles.length) return null;
  const interior = hiddenTiles.filter((t) => !t.nearNumber);
  const pool = interior.length ? interior : hiddenTiles;
  const pickIdx = Math.floor(Math.random() * pool.length);
  const { r, c } = pool[pickIdx];
  // Spend a probe/ability on guesses when we have one — free safety.
  if (ob.items.probe > 0) return { type: "useItem", id: "probe", r, c };
  if (ob.ability.charges > 0 && ob.ability.id === "scout") return { type: "useAbility", r, c };
  return { type: "reveal", r, c };
}

function pickShopAction(ob) {
  if (ob.hp < ob.maxHp && ob.gold >= 12) return { type: "rest" };
  const buyable = ob.shop.slots.filter((s) => !s.soldOut && s.affordable);
  if (buyable.length) return { type: "buy", slot: buyable[0].slot };
  const treasure = ob.paths.find((p) => p.key === "treasure");
  return { type: "choosePath", index: (treasure ?? ob.paths[0]).index };
}

let steps = 0;
while (steps++ < 5000) {
  const ob = observe(state);
  if (ob.phase === "dead") break;
  let action;
  if (ob.phase === "won") action = { type: "continueEndless" };
  else if (ob.phase === "shop") action = pickShopAction(ob);
  else action = pickPlayAction(ob);
  if (!action) break;
  const res = applyAction(state, action);
  if (res.error) {
    // Fall back to any legal action rather than crash on a bad deduction.
    const legal = legalActions(state);
    if (!legal.length) break;
    console.error(`  [bot] ${JSON.stringify(action)} -> ${res.error}`);
    break;
  }
  state = res.state;
}

const ob = observe(state);
console.log(JSON.stringify({
  seed, classId, steps,
  result: ob.phase,
  floor: ob.floor,
  bestDepth: ob.bestDepth,
  gold: ob.gold,
  stats: ob.stats,
}, null, 2));
