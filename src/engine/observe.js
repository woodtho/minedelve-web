// =============================================================================
// OBSERVATION LAYER — what a player (human, bot, or LLM) is allowed to see.
// -----------------------------------------------------------------------------
// observe(state) returns plain JSON with all hidden information stripped:
// unrevealed tiles never leak whether they hold a mine, chest, or sleeping
// enemy. legalActions(state) lists what can be done right now.
//
// Grid tokens:
//   "#"      hidden            "F"   flagged by the player
//   "0".."8" revealed number   "*"   exploded mine (you hit it)
//   "M"      mine shown on death reveal
//   "C"      revealed, opened-chest tile (its number is in `adjacency`)
//   "E<uid>" revealed tile occupied by a living enemy (see `enemies` list)
// =============================================================================

import {
  CLASSES, ITEMS, FLOOR_TYPES,
  enemyAt, revealedSafeCount, quotaMet, bossAlive, canDescend, computeAttack,
  rerollCost, priceOf, corruptionTier, attackerUids,
  STIR_GRACE, STIR_INTERVAL, WAKE_INTERVAL, REST_LIMIT_PER_VAULT,
} from "./engine.js";

export function observe(state) {
  const cls = CLASSES[state.classId];
  const base = {
    phase: state.phase,
    class: { id: state.classId, name: cls.name },
    floor: state.floor,
    floorType: state.floorType,
    floorName: FLOOR_TYPES[state.floorType].name,
    mineDamage: state.floorDmg,
    hp: state.hp,
    maxHp: state.maxHp,
    attack: computeAttack(state),
    gold: state.gold,
    shieldCharges: state.shieldCharges,
    turn: state.turn,
    endless: state.endless,
    corruption: corruptionTier(state.floor),
    bestDepth: state.bestDepth,
    items: Object.fromEntries(
      Object.entries(state.items).filter(([, n]) => n > 0)
    ),
    relics: { ...state.relics },
    ability: {
      id: cls.ability.id,
      name: cls.ability.name,
      charges: state.abilityCharges,
      needsTarget: !!cls.ability.target,
      desc: cls.ability.desc,
    },
    msg: state.msg,
    log: state.log.slice(-8),
    stats: { ...state.stats },
    // The journey so far: one entry per floor entered, in order.
    runMap: state.runMap.map((m) => ({
      floor: m.floor, type: m.type, name: FLOOR_TYPES[m.type].name,
    })),
  };

  if (state.phase === "play" || state.phase === "dead") {
    const b = state.board;
    const grid = [];
    for (let r = 0; r < b.rows; r++) {
      const row = [];
      for (let c = 0; c < b.cols; c++) {
        const i = r * b.cols + c;
        if (!b.revealed[i]) {
          row.push(b.flagged[i] ? "F" : "#");
        } else if (b.mine[i]) {
          row.push(b.exploded[i] ? "*" : "M");
        } else {
          const e = enemyAt(state, r, c);
          if (e) row.push(`E${e.uid}`);
          else if (b.chestOpen[i]) row.push("C");
          else row.push(String(b.adj[i]));
        }
      }
      grid.push(row);
    }
    // Adjacency for special revealed tiles (enemy/chest tiles still have numbers).
    const adjacency = {};
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++) {
        const i = r * b.cols + c;
        if (b.revealed[i] && !b.mine[i] && (enemyAt(state, r, c) || b.chestOpen[i]))
          adjacency[`${r},${c}`] = b.adj[i];
      }

    Object.assign(base, {
      board: {
        rows: b.rows,
        cols: b.cols,
        totalMines: b.mines,
        flagsPlaced: b.flagged.reduce((a, x) => a + x, 0),
        started: !!b.started,
        quota: { revealed: revealedSafeCount(b), required: b.quota },
        grid,
        adjacency,
      },
      enemies: (() => {
        const active = attackerUids(state);
        return state.enemies
          .filter((e) => e.hp > 0 && b.revealed[e.r * b.cols + e.c])
          .map((e) => ({
            uid: e.uid, id: e.id, name: e.name, r: e.r, c: e.c,
            hp: e.hp, maxHp: e.maxHp, dmg: e.dmg,
            // winding: it acts on the very next turn unless killed/stunned.
            winding: !!e.winding,
            // lurking: awake but out of attacker slots — its countdown is frozen.
            lurking: e.awake && e.stun <= 0 && !active.has(e.uid),
            attacksIn: e.winding ? 0
              : (e.stun > 0 ? e.cd + e.stun + 1 : e.cd + 1) + (e.justWoke ? 1 : 0),
            stunned: e.stun, boss: e.boss, enraged: !!e.enraged, traits: e.traits,
          }));
      })(),
      bossAlive: bossAlive(state),
      canDescend: canDescend(state),
      // Lingering after the stairs open wakes the mine. nextStirIn counts the
      // turns until something new claws out of the ground. While a boss holds
      // the stairs shut, the stir is paused — fighting it is not lingering.
      stir: quotaMet(state) && !bossAlive(state)
        ? {
            active: true,
            nextStirIn: state.stir < STIR_GRACE
              ? STIR_GRACE - state.stir
              : STIR_INTERVAL - ((state.stir - STIR_GRACE) % STIR_INTERVAL),
          }
        : {
            active: false,
            // Turns until a sleeping enemy surfaces on its own.
            nextWakeIn: WAKE_INTERVAL - (state.turn % WAKE_INTERVAL),
          },
    });
  }

  if (state.phase === "shop") {
    base.shop = {
      // hasShop: vaults only open every couple of floors; on a bare landing
      // the only action is choosing a path.
      hasShop: !!state.vaultShop,
      slots: state.shop.map((id, slot) => {
        if (!id) return { slot, soldOut: true };
        const m = ITEMS[id];
        const price = priceOf(state, id);
        return {
          slot, id, name: m.name, kind: m.kind, price,
          desc: m.desc, affordable: state.gold >= price,
        };
      }),
      // Reroll replaces only unsold slots; its price grows for the whole run.
      rerollCost: rerollCost(state),
      // Rest price grows permanently with each rest, max 2 rests per vault.
      restCost: state.restCost,
      restsLeft: Math.max(0, REST_LIMIT_PER_VAULT - (state.restsThisVault || 0)),
      altarAvailable: !!state.vaultShop && !state.altarUsed && state.hp >= 2,
    };
    base.paths = state.paths.map((key, index) => {
      const ft = FLOOR_TYPES[key];
      return {
        index, key, name: ft.name, desc: ft.desc,
        goldMult: ft.gold, mineDamage: ft.dmg, enemyMult: ft.enemyMult,
        relicReward: !!ft.relic,
      };
    });
  }

  return base;
}

/** Action templates that are currently legal (targets left to the player). */
export function legalActions(state) {
  const out = [];
  const cls = CLASSES[state.classId];
  if (state.phase === "play") {
    out.push({ type: "reveal", params: "r, c — any '#' tile" });
    if (state.board.started) out.push({ type: "flag", params: "r, c — toggle on any '#'/'F' tile" });
    const anyEnemy = state.enemies.some(
      (e) => e.hp > 0 && state.board.revealed[e.r * state.board.cols + e.c]
    );
    if (anyEnemy) out.push({ type: "attack", params: "r, c — a revealed enemy tile" });
    for (const [id, n] of Object.entries(state.items)) {
      if (n > 0) out.push({
        type: "useItem", id,
        params: ITEMS[id].target ? "r, c required" : "no target",
      });
    }
    if (state.abilityCharges > 0) out.push({
      type: "useAbility",
      params: cls.ability.target ? "r, c required" : "no target",
    });
    if (canDescend(state)) out.push({ type: "descend" });
    out.push({ type: "tick", params: "no target — time passes, enemies act (the UI fires this on a heartbeat)" });
  } else if (state.phase === "shop") {
    if (state.vaultShop) {
      state.shop.forEach((id, slot) => {
        if (id && state.gold >= priceOf(state, id)) out.push({ type: "buy", slot });
      });
      if (state.gold >= rerollCost(state) && state.shop.some((id) => id !== null))
        out.push({ type: "reroll" });
      if (state.gold >= state.restCost && state.hp < state.maxHp &&
          (state.restsThisVault || 0) < REST_LIMIT_PER_VAULT)
        out.push({ type: "rest" });
      if (!state.altarUsed && state.hp >= 2) out.push({ type: "altar" });
    }
    state.paths.forEach((key, index) =>
      out.push({ type: "choosePath", index, floorType: key })
    );
  } else if (state.phase === "won") {
    out.push({ type: "continueEndless" });
  }
  return out;
}
