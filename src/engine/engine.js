// =============================================================================
// MINEDELVE ENGINE — pure, deterministic, JSON in / JSON out.
// -----------------------------------------------------------------------------
// The whole game is:   state = createRun(classId, seed)
//                      { state, error } = applyAction(state, action)
// State is a plain JSON object (safe to stringify/parse for saves), and the
// RNG lives inside it, so identical (state, action) always produce identical
// results. No DOM, no globals — the React UI and the CLI both sit on top.
//
// Actions (all plain JSON):
//   { type:"reveal", r, c }        { type:"flag", r, c }
//   { type:"attack", r, c }        { type:"useItem", id, r?, c? }
//   { type:"useAbility", r?, c? }  { type:"descend" }
//   { type:"buy", slot }           { type:"reroll" }
//   { type:"rest" }                { type:"altar" }
//   { type:"choosePath", index }   { type:"continueEndless" }
// =============================================================================

import { seedToRng, nextFloat, randInt, pick, sampleN, shuffle } from "./rng.js";
import { CLASSES } from "../content/classes.js";
import { ITEMS, RELIC_IDS } from "../content/items.js";
import { ENEMIES, BOSSES, MIMIC, enemyPoolForFloor } from "../content/enemies.js";
import {
  FLOOR_TYPES, PATH_CANDIDATES, isBossFloor, baseFloorCfg, applyFloorType,
} from "../content/floors.js";

export const FINAL_FLOOR = 10;
export const SAVE_VERSION = 3;
export { CLASSES, ITEMS, ENEMIES, BOSSES, FLOOR_TYPES };

// ---- vault economy ----------------------------------------------------------
// Healing and rerolls get pricier the more you lean on them, and the increases
// stick for the whole run — the vault is a lifeline, not a farm.
export const REST_LIMIT_PER_VAULT = 2; // hearts purchasable per vault stop
export const REST_COST_STEP = 3;       // rest price grows by this per rest, forever
export const REST_COST_BASE = 10;
export const REROLL_BASE = 5;
export const REROLL_STEP = 5;          // reroll price grows by this per reroll, forever

/** The vault (shop) only opens every couple of floors; landings between them
 *  still offer the path choice. Bosses are always preceded by a vault. */
export function vaultHasShop(nextFloor) {
  return isBossFloor(nextFloor) || nextFloor % 2 === 1;
}

// Once the stairs open, the mine starts waking things: after STIR_GRACE more
// turns on the floor, something claws out of the ground every STIR_INTERVAL
// turns (worth no bounty — pressure, not a farm).
export const STIR_GRACE = 6;
export const STIR_INTERVAL = 4;
// Even before the stairs open, the mine wakes slowly: every WAKE_INTERVAL
// turns, one sleeping lurker surfaces on its own.
export const WAKE_INTERVAL = 14;
// At most this many non-boss enemies press the attack at once; the rest lurk
// frozen until a slot opens. Bosses always act.
export const MAX_ATTACKERS = 2;

/** Uids of enemies currently pressing the attack (bosses + first free slots). */
export function attackerUids(state) {
  const ids = new Set();
  let slots = MAX_ATTACKERS;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !e.awake || e.stun > 0) continue;
    if (e.boss) { ids.add(e.uid); continue; }
    if (slots > 0) { ids.add(e.uid); slots -= 1; }
  }
  return ids;
}

/** Endless-mode escalation: +1 tier every 5 floors past the final boss. */
export function corruptionTier(floor) {
  return floor <= FINAL_FLOOR ? 0 : Math.ceil((floor - FINAL_FLOOR) / 5);
}

/** Shop prices drift upward with depth. */
export function priceOf(state, id) {
  return Math.round(ITEMS[id].price * (1 + 0.06 * Math.max(0, state.floor - 1)));
}

// ---- small utilities --------------------------------------------------------

const idx = (b, r, c) => r * b.cols + c;
const inBounds = (b, r, c) => r >= 0 && r < b.rows && c >= 0 && c < b.cols;

function neighborIdx(b, r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr, cc = c + dc;
      if (inBounds(b, rr, cc)) out.push(idx(b, rr, cc));
    }
  return out;
}

export function enemyAt(state, r, c) {
  return state.enemies.find((e) => e.hp > 0 && e.r === r && e.c === c) || null;
}

export function revealedSafeCount(b) {
  let n = 0;
  for (let i = 0; i < b.revealed.length; i++) if (b.revealed[i] && !b.mine[i]) n++;
  return n;
}

export function quotaMet(state) {
  return revealedSafeCount(state.board) >= state.board.quota;
}

export function bossAlive(state) {
  return state.enemies.some((e) => e.boss && e.hp > 0);
}

export function canDescend(state) {
  return state.phase === "play" && quotaMet(state) && !bossAlive(state);
}

export function computeAttack(state) {
  return state.baseAttack + (state.relics.whetstone || 0);
}

// ---- relic hooks ------------------------------------------------------------

function runHook(state, name, ...args) {
  // Fire hook `name` on every owned relic; returns true if any hook returned true.
  let handled = false;
  for (const id of Object.keys(state.relics)) {
    const count = state.relics[id];
    if (count <= 0) continue;
    const hook = ITEMS[id]?.hooks?.[name];
    if (hook && hook(state, H, count, ...args) === true) handled = true;
  }
  return handled;
}

function runModHook(state, name, value) {
  let v = value;
  for (const id of Object.keys(state.relics)) {
    const count = state.relics[id];
    if (count <= 0) continue;
    const hook = ITEMS[id]?.hooks?.[name];
    if (hook) v = hook(state, count, v);
  }
  return v;
}

// ---- helper API (H) — passed to content effect functions --------------------

function note(state, text) {
  state.msg = state.msg ? `${state.msg} ${text}` : text;
  state.log.push(text);
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

function gainGold(state, n, { chest = false } = {}) {
  let amount = n * state.floorGold * state.goldMult;
  amount = runModHook(state, "modGold", amount);
  if (chest) amount = runModHook(state, "modChestGold", amount);
  const g = Math.max(0, Math.round(amount));
  state.gold += g;
  state.stats.goldEarned += g;
  return g;
}

function giveItem(state, id, n = 1) {
  state.items[id] = (state.items[id] || 0) + n;
}

function giveRelic(state, id) {
  const meta = ITEMS[id];
  if (meta.unique && (state.relics[id] || 0) > 0) {
    const g = gainGold(state, 20);
    note(state, `Duplicate ${meta.name} — turned to ${g} gold.`);
    return false;
  }
  state.relics[id] = (state.relics[id] || 0) + 1;
  meta.hooks?.onAcquire?.(state, H);
  return true;
}

function giveRandomRelic(state, prefix) {
  const notOwned = RELIC_IDS.filter(
    (id) => !(ITEMS[id].unique && (state.relics[id] || 0) > 0)
  );
  const id = notOwned.length ? pick(state, notOwned) : pick(state, RELIC_IDS);
  if (giveRelic(state, id)) note(state, `${prefix} ${ITEMS[id].icon} ${ITEMS[id].name}!`);
}

function healPlayer(state, n, src, quiet = false) {
  if (state.hp >= state.maxHp) {
    if (!quiet) note(state, "Already at full hearts.");
    return false;
  }
  const healed = Math.min(n, state.maxHp - state.hp);
  state.hp += healed;
  note(state, `${src} +${healed} heart${healed === 1 ? "" : "s"}.`);
  return true;
}

function die(state) {
  const b = state.board;
  for (let i = 0; i < b.mine.length; i++) if (b.mine[i]) b.revealed[i] = true;
  state.bestDepth = Math.max(state.bestDepth, state.floor);
  state.phase = "dead";
}

/** Damage the player from any source. Returns true if the run ended. */
function damagePlayer(state, dmg, srcText) {
  if (state.shieldCharges > 0) {
    state.shieldCharges -= 1;
    note(state, `🧱 Your shield absorbed ${srcText}!`);
    return false;
  }
  state.hp -= dmg;
  note(state, `${srcText} −${dmg} heart${dmg === 1 ? "" : "s"}.`);
  if (state.hp <= 0) {
    if (runHook(state, "onLethal")) {
      state.hp = 1;
      return false;
    }
    die(state);
    return true;
  }
  return false;
}

function damageEnemy(state, enemy, dmg, srcText) {
  if (enemy.hp <= 0) return false;
  const dealt = enemy.traits.armored ? Math.min(dmg, 1) : dmg;
  enemy.hp -= dealt;
  if (enemy.hp <= 0) {
    state.stats.enemiesSlain += 1;
    if (enemy.boss) state.stats.bossesSlain += 1;
    if (enemy.bounty > 0) {
      const g = gainGold(state, enemy.bounty);
      note(state, `${srcText} slew the ${enemy.name}! +${g} gold.`);
    } else {
      note(state, `${srcText} slew the ${enemy.name}!`);
    }
    runHook(state, "onKill", enemy);
  } else {
    note(state, `${srcText} hit the ${enemy.name} for ${dealt} (${enemy.hp}/${enemy.maxHp}).`);
    if (enemy.winding && !enemy.boss) {
      enemy.winding = false;
      enemy.cd = runModHook(state, "modEnemyCooldown", enemy.cdMax);
      note(state, `${enemy.icon} The ${enemy.name}'s attack is interrupted!`);
    }
    if (enemy.boss && !enemy.enraged && enemy.hp <= Math.ceil(enemy.maxHp / 2)) {
      enemy.enraged = true;
      BOSSES[enemy.id]?.onEnrage?.(state, H, enemy);
    }
  }
  return true;
}

/** Re-bury n random revealed safe tiles (boss roars, cave-ins). */
function rehideRandomRevealed(state, n, src) {
  const b = state.board;
  const cands = [];
  for (let i = 0; i < b.mine.length; i++) {
    if (b.revealed[i] && !b.mine[i] &&
        !enemyAt(state, Math.floor(i / b.cols), i % b.cols)) cands.push(i);
  }
  const picks = sampleN(state, cands, Math.min(n, cands.length));
  for (const i of picks) b.revealed[i] = 0;
  if (picks.length)
    note(state, `${src} ${picks.length} tile${picks.length === 1 ? "" : "s"} cave back in!`);
  return picks.length;
}

/** Spawn `count` enemies of a template on hidden safe tiles. Returns spawned. */
function spawnFromDark(state, templateId, count, opts = {}) {
  const b = state.board;
  const template = ENEMIES[templateId] ?? MIMIC;
  let spawned = 0;
  for (let k = 0; k < count; k++) {
    const spots = [];
    for (let i = 0; i < b.mine.length; i++) {
      if (!b.mine[i] && !b.revealed[i] && !b.chest[i] &&
          !enemyAt(state, Math.floor(i / b.cols), i % b.cols)) spots.push(i);
    }
    if (!spots.length) break;
    spawnEnemy(state, template, pick(state, spots), opts);
    spawned++;
  }
  return spawned;
}

function damageAllAwakeEnemies(state, dmg, srcText) {
  const targets = state.enemies.filter((e) => e.hp > 0 && e.awake);
  if (!targets.length) {
    note(state, `${srcText} finds no awake enemies.`);
    return false;
  }
  for (const e of targets) damageEnemy(state, e, dmg, srcText);
  return true;
}

function stunEnemyAt(state, r, c, turns, srcText) {
  const e = enemyAt(state, r, c);
  if (!e || !e.awake) {
    note(state, "No awake enemy there.");
    return false;
  }
  e.stun = Math.max(e.stun, turns);
  e.winding = false; // a snare interrupts a wind-up entirely
  note(state, `${srcText} the ${e.name} is stunned for ${turns} turns.`);
  return true;
}

function wakeEnemy(state, e) {
  if (e.awake || e.hp <= 0) return;
  e.awake = true;
  e.justWoke = true; // grace: no countdown progress on the turn it wakes
  e.cd = runModHook(state, "modEnemyCooldown", e.cdMax);
  note(state, `${e.icon} A ${e.name} wakes up!`);
}

function recomputeAdj(b) {
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++) {
      let n = 0;
      for (const ni of neighborIdx(b, r, c)) if (b.mine[ni]) n++;
      b.adj[idx(b, r, c)] = n;
    }
}

// ---- board reveal mechanics -------------------------------------------------

function openChest(state, i) {
  const b = state.board;
  if (nextFloat(state) < 0.1) {
    // It's teeth. The tile stays revealed; the mimic stands on it, awake.
    b.chest[i] = 0;
    spawnEnemy(state, MIMIC, i, { awake: true });
    note(state, "📦 The chest snaps open — it's a Mimic!");
    return;
  }
  b.chestOpen[i] = 1;
  state.stats.chestsOpened += 1;
  // With vaults only every couple of floors, chests are the main supply line —
  // weighted toward gear over raw gold.
  const roll = nextFloat(state);
  if (roll < 0.32) {
    const g = gainGold(state, randInt(state, 15, 40), { chest: true });
    note(state, `📦 Chest: +${g} gold!`);
  } else if (roll < 0.54) {
    giveItem(state, "medkit");
    note(state, "📦 Chest: a Med-Kit!");
  } else if (roll < 0.73) {
    giveItem(state, "probe");
    note(state, "📦 Chest: a Probe!");
  } else if (roll < 0.87) {
    const extras = ["bomb", "snare", "scroll", "tonic", "flare", "wardstone", "coffee"];
    const id = pick(state, extras);
    giveItem(state, id);
    note(state, `📦 Chest: a ${ITEMS[id].name}!`);
  } else if (roll < 0.94) {
    state.hp = Math.min(state.maxHp, state.hp + 1);
    note(state, "📦 Chest: +1 heart!");
  } else {
    giveRandomRelic(state, "📦 Chest: relic —");
  }
}

/**
 * Flood-reveal from (r, c). Reveals connected zero-tiles; stops at numbers and
 * at enemy tiles (the enemy wakes but blocks further expansion). Returns the
 * number of newly revealed tiles. Awards gold and opens chests.
 */
function floodReveal(state, r, c) {
  const b = state.board;
  const stack = [[r, c]];
  let revealed = 0;
  while (stack.length) {
    const [cr, cc] = stack.pop();
    const i = idx(b, cr, cc);
    if (b.revealed[i] || b.flagged[i] || b.mine[i]) continue;
    b.revealed[i] = 1;
    revealed++;
    if (b.chest[i] && !b.chestOpen[i]) openChest(state, i);
    const e = enemyAt(state, cr, cc);
    if (e) {
      wakeEnemy(state, e);
      continue; // enemies block the flood
    }
    if (b.adj[i] === 0) {
      for (const ni of neighborIdx(b, cr, cc)) {
        if (!b.revealed[ni] && !b.flagged[ni] && !b.mine[ni]) {
          stack.push([Math.floor(ni / b.cols), ni % b.cols]);
        }
      }
    }
  }
  if (revealed > 0) {
    state.stats.tilesRevealed += revealed;
    const g = gainGold(state, 2 * revealed);
    note(state, `Revealed ${revealed} tile${revealed === 1 ? "" : "s"} (+${g} gold).`);
  }
  return revealed;
}

// ---- mine / chest / enemy placement (first dig of each floor) ---------------

function placeAll(state, sr, sc) {
  const b = state.board;
  const total = b.rows * b.cols;
  const safeZone = new Set([idx(b, sr, sc), ...neighborIdx(b, sr, sc)]);
  const pool = [];
  for (let i = 0; i < total; i++) if (!safeZone.has(i)) pool.push(i);

  for (const i of sampleN(state, pool, Math.min(b.mines, pool.length))) b.mine[i] = 1;
  recomputeAdj(b);

  const safePool = [];
  for (let i = 0; i < total; i++) if (!b.mine[i] && !safeZone.has(i)) safePool.push(i);

  const chestSpots = sampleN(state, safePool, Math.min(b.nChests, safePool.length));
  for (const i of chestSpots) b.chest[i] = 1;

  const enemySpots = sampleN(
    state,
    safePool.filter((i) => !b.chest[i]),
    Math.min(b.nEnemies + (state.pendingBoss ? 1 : 0), safePool.length)
  );

  const templates = [];
  if (state.pendingBoss) templates.push({ ...BOSSES[state.pendingBoss], isBoss: true });
  const floorPool = enemyPoolForFloor(state.floor);
  while (templates.length < enemySpots.length) templates.push(pick(state, floorPool));

  for (let k = 0; k < enemySpots.length; k++) {
    spawnEnemy(state, templates[k], enemySpots[k], { isBoss: !!templates[k].isBoss });
  }
  state.pendingBoss = null;
  b.started = 1;

  // Post-placement passives: dowsing rods, seer visions, etc.
  runHook(state, "afterPlacement");
  CLASSES[state.classId].afterPlacement?.(state, H);
}

function spawnEnemy(state, template, tileIdx, opts = {}) {
  const { isBoss = false, awake = false, bounty = null } = opts;
  const b = state.board;
  // Bosses gain hp with depth; regular enemies toughen slowly (faster in
  // corrupted endless floors).
  const hpBonus = isBoss
    ? Math.floor(state.floor * 0.4)
    : Math.floor((state.floor - 1) / 6) + corruptionTier(state.floor);
  const hp = template.hp + hpBonus;
  const e = {
    uid: state.nextUid++,
    id: template.id,
    name: template.name,
    icon: template.icon,
    r: Math.floor(tileIdx / b.cols),
    c: tileIdx % b.cols,
    hp,
    maxHp: hp,
    dmg: template.dmg,
    cdMax: template.cd,
    cd: template.cd,
    bounty: bounty ?? template.bounty + 2 * (state.floor - 1),
    traits: { ...template.traits },
    boss: !!isBoss,
    enraged: false,
    awake: false,
    winding: false,
    justWoke: false,
    stun: 0,
  };
  state.enemies.push(e);
  if (awake) {
    e.awake = true;
    e.justWoke = true;
    e.cd = runModHook(state, "modEnemyCooldown", e.cdMax);
  }
  return e;
}

function ensureStarted(state, r, c) {
  if (!state.board.started) placeAll(state, r, c);
}

/**
 * Called after the first dig of a floor resolves: rebase the quota on what's
 * still hidden, so a lucky opening cascade can't trivialize the floor. You
 * always owe qfrac of the *remaining* safe tiles.
 */
function finalizeQuota(state) {
  const b = state.board;
  const totalSafe = b.mine.length - b.mine.reduce((a, x) => a + x, 0);
  const revealed = revealedSafeCount(b);
  b.quota = Math.max(1, Math.min(
    revealed + Math.ceil(b.qfrac * (totalSafe - revealed)),
    totalSafe
  ));
}

// ---- enemy turns ------------------------------------------------------------

function enemyStrike(state, e) {
  const hadShield = state.shieldCharges > 0;
  const ended = damagePlayer(state, e.dmg, `${e.icon} The ${e.name} strikes you!`);
  if (!ended && !hadShield) runHook(state, "onEnemyAttack", e);
  return ended;
}

function enemyAct(state, e) {
  if (e.traits.healer) {
    const ally = state.enemies
      .filter((a) => a !== e && a.hp > 0 && a.awake && a.hp < a.maxHp)
      .sort((a, z) => a.hp - z.hp)[0];
    if (ally) {
      ally.hp = Math.min(ally.maxHp, ally.hp + 1);
      note(state, `${e.icon} The ${e.name} mends the ${ally.name} (+1).`);
      return false;
    }
    return enemyStrike(state, e);
  }
  if (e.traits.steal) {
    if (state.gold > 0) {
      const take = Math.min(state.gold, randInt(state, 3, 5 + Math.ceil(state.floor / 2)));
      state.gold -= take;
      e.bounty += take;
      note(state, `${e.icon} The ${e.name} pilfers ${take} gold. Kill it to win it back!`);
      return false;
    }
    return enemyStrike(state, e);
  }
  if (e.traits.spawner) {
    if (nextFloat(state) < 0.6 && spawnFromDark(state, e.traits.spawner, 1) > 0) {
      note(state, `${e.icon} The ${e.name} calls something out of the dark...`);
      return false;
    }
    return enemyStrike(state, e);
  }
  if (e.traits.burrow) {
    const b = state.board;
    const around = neighborIdx(b, e.r, e.c).filter((i) =>
      b.revealed[i] && !b.mine[i] &&
      !enemyAt(state, Math.floor(i / b.cols), i % b.cols));
    if (around.length) {
      const picks = sampleN(state, around, Math.min(e.traits.burrow, around.length));
      for (const i of picks) b.revealed[i] = 0;
      note(state, `${e.icon} The ${e.name} re-buries ${picks.length} tile${picks.length === 1 ? "" : "s"}!`);
      return false;
    }
    return enemyStrike(state, e);
  }
  if (e.traits.planter) {
    const b = state.board;
    const cands = [];
    for (let i = 0; i < b.mine.length; i++) {
      const r = Math.floor(i / b.cols), c = i % b.cols;
      if (b.revealed[i] && !b.mine[i] && !b.chest[i] &&
          Math.max(Math.abs(r - e.r), Math.abs(c - e.c)) <= 2 &&
          !enemyAt(state, r, c)) cands.push(i);
    }
    if (cands.length) {
      const i = pick(state, cands);
      b.revealed[i] = 0;
      b.flagged[i] = 1;
      b.mine[i] = 1;
      b.mines += 1;
      recomputeAdj(b);
      const totalSafe = b.mine.length - b.mine.reduce((a, x) => a + x, 0);
      b.quota = Math.min(b.quota, totalSafe);
      note(state, `${e.icon} The ${e.name} plants a marked powder charge!`);
      return false;
    }
    return enemyStrike(state, e);
  }
  return enemyStrike(state, e);
}

/**
 * Time pressure, in two regimes. Before the stairs open: every WAKE_INTERVAL
 * turns a sleeping enemy surfaces (its tile is revealed and it wakes). After
 * the stairs open: the stir — fresh bounty-less enemies claw out of the
 * ground every few turns. Either way, the clock is never meaningless.
 */
function worldPressure(state) {
  if (!quotaMet(state) || bossAlive(state)) {
    // The stir only punishes lingering when the player is *free* to descend.
    // While the quota is unmet — or a boss holds the stairs shut — the mine
    // only wakes slowly: one sleeper surfaces every WAKE_INTERVAL turns.
    if (!state.board.started) return;
    if (state.turn > 0 && state.turn % WAKE_INTERVAL === 0) {
      const sleeper = state.enemies.find((e) => e.hp > 0 && !e.awake);
      if (sleeper) {
        const b = state.board;
        b.revealed[sleeper.r * b.cols + sleeper.c] = 1;
        note(state, "🕯️ Something surfaces from the dark!");
        wakeEnemy(state, sleeper);
      }
    }
    return;
  }
  state.stir += 1;
  if (state.stir < STIR_GRACE || (state.stir - STIR_GRACE) % STIR_INTERVAL !== 0) return;
  const b = state.board;
  const spots = [];
  for (let i = 0; i < b.mine.length; i++) {
    if (!b.mine[i] && !b.revealed[i] && !b.chest[i] &&
        !enemyAt(state, Math.floor(i / b.cols), i % b.cols)) spots.push(i);
  }
  if (spots.length) {
    const i = pick(state, spots);
    b.revealed[i] = 1; // it bursts up through the floor
    const t = pick(state, enemyPoolForFloor(state.floor));
    const e = spawnEnemy(state, t, i, { awake: true, bounty: 0 });
    note(state, `⚠️ The mine stirs — a ${e.name} claws out of the ground!`);
  } else {
    const sleeper = state.enemies.find((s) => s.hp > 0 && !s.awake);
    if (sleeper) {
      b.revealed[sleeper.r * b.cols + sleeper.c] = 1;
      wakeEnemy(state, sleeper);
    }
  }
}

/**
 * One game turn passes. Enemies fight on a telegraph cycle: count down, then
 * spend one full turn winding up (visible to the player — kill, stun, or
 * shield in that window), and only then act. At most MAX_ATTACKERS non-boss
 * enemies advance their cycle at once; the rest lurk frozen.
 */
function tickEnemies(state) {
  if (state.phase !== "play") return;
  state.turn += 1;
  let slots = MAX_ATTACKERS;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !e.awake) continue;
    if (e.justWoke) {
      // Grace turn: an enemy revealed this turn doesn't start its countdown
      // until the player has had one turn to react.
      e.justWoke = false;
      continue;
    }
    if (e.stun > 0) {
      e.stun -= 1;
      continue;
    }
    if (!e.boss) {
      if (slots <= 0) continue; // lurking — no countdown progress
      slots -= 1;
    }
    if (e.winding) {
      e.winding = false;
      e.cd = runModHook(state, "modEnemyCooldown", e.cdMax);
      if (enemyAct(state, e)) return; // player died
    } else {
      e.cd -= 1;
      if (e.cd <= 0) {
        e.winding = true;
        note(state, `${e.icon} The ${e.name} rears back to strike!`);
      }
    }
  }
  worldPressure(state);
}

// ---- targeted effects shared by items & abilities ---------------------------

function probeAt(state, r, c, src) {
  const first = !state.board.started;
  ensureStarted(state, r, c);
  const b = state.board;
  const i = idx(b, r, c);
  if (b.revealed[i] || b.flagged[i]) {
    note(state, "That tile is already dealt with.");
    return false;
  }
  if (b.mine[i]) {
    b.flagged[i] = 1;
    note(state, `${src} a mine — flagged it safely.`);
  } else {
    floodReveal(state, r, c);
  }
  if (first) finalizeQuota(state);
  return true;
}

function blastAt(state, r, c, src, enemyDmg) {
  const first = !state.board.started;
  ensureStarted(state, r, c);
  const b = state.board;
  const area = [idx(b, r, c), ...neighborIdx(b, r, c)];
  let cleared = 0;
  for (const i of area) {
    const rr = Math.floor(i / b.cols), cc = i % b.cols;
    const e = enemyAt(state, rr, cc);
    if (e && e.awake) damageEnemy(state, e, enemyDmg, src);
    if (b.mine[i]) {
      if (!b.flagged[i]) b.flagged[i] = 1;
    } else if (!b.revealed[i] && !b.flagged[i]) {
      cleared += floodReveal(state, rr, cc);
    }
  }
  note(state, `${src} cleared ${cleared} tile${cleared === 1 ? "" : "s"}.`);
  if (first) finalizeQuota(state);
  return true;
}

function dowseAt(state, r, c, maxFlags) {
  const b = state.board;
  if (!b.started) {
    note(state, "🔧 Dig first — nothing to dowse yet.");
    return false;
  }
  const area = [idx(b, r, c), ...neighborIdx(b, r, c)];
  const mines = area.filter((i) => b.mine[i] && !b.flagged[i] && !b.revealed[i]);
  if (!mines.length) {
    note(state, "📡 Dowse: no hidden mines nearby.");
    return false;
  }
  const picked = mines.slice(0, maxFlags);
  for (const i of picked) b.flagged[i] = 1;
  note(state, `📡 Dowse flagged ${picked.length} mine${picked.length === 1 ? "" : "s"}.`);
  return true;
}

function defuseAt(state, r, c, goldValue) {
  const b = state.board;
  if (!b.started) {
    note(state, "✨ Nothing to transmute yet.");
    return false;
  }
  const i = idx(b, r, c);
  if (!b.flagged[i]) {
    note(state, "✨ Transmute needs a flagged tile.");
    return false;
  }
  if (!b.mine[i]) {
    note(state, "✨ The flag lied — no mine there. The flag burns away.");
    b.flagged[i] = 0;
    return true;
  }
  b.mine[i] = 0;
  b.flagged[i] = 0;
  recomputeAdj(b);
  floodReveal(state, r, c);
  const g = gainGold(state, goldValue);
  note(state, `✨ Transmuted a mine into ${g} gold!`);
  return true;
}

function revealRandomSafe(state, n, src) {
  const b = state.board;
  if (!b.started) {
    note(state, "Dig first — the floor is still dark.");
    return false;
  }
  let revealed = 0;
  for (let k = 0; k < n; k++) {
    const hidden = [];
    for (let i = 0; i < b.mine.length; i++)
      if (!b.mine[i] && !b.revealed[i] && !b.flagged[i]) hidden.push(i);
    if (!hidden.length) break;
    const i = pick(state, hidden);
    revealed += floodReveal(state, Math.floor(i / b.cols), i % b.cols);
  }
  if (revealed === 0) {
    note(state, `${src} nothing — the floor is bare.`);
    return false;
  }
  return true;
}

function autoFlagMines(state, n, src) {
  const b = state.board;
  const hidden = [];
  for (let i = 0; i < b.mine.length; i++)
    if (b.mine[i] && !b.flagged[i] && !b.revealed[i]) hidden.push(i);
  if (!hidden.length) return;
  const picked = sampleN(state, hidden, Math.min(n, hidden.length));
  for (const i of picked) b.flagged[i] = 1;
  note(state, `${src} flagged ${picked.length} mine${picked.length === 1 ? "" : "s"}.`);
}

// The helper API handed to all content-defined effect functions.
const H = {
  note, gainGold, giveItem, giveRelic, giveRandomRelic, healPlayer, damagePlayer,
  damageEnemy, damageAllAwakeEnemies, stunEnemyAt, wakeEnemy, probeAt, blastAt,
  dowseAt, defuseAt, revealRandomSafe, autoFlagMines, enemyAt,
  spawnFromDark, rehideRandomRevealed,
};

// ---- floor & run lifecycle --------------------------------------------------

function startFloor(state, floor, typeKey) {
  const ft = FLOOR_TYPES[typeKey];
  const cfg = applyFloorType(baseFloorCfg(floor), typeKey, floor);
  const tier = corruptionTier(floor);
  cfg.nEnemies += tier; // corrupted endless floors crawl with extra lurkers
  state.floor = floor;
  state.floorType = typeKey;
  state.floorGold = ft.gold;
  state.floorDmg = ft.dmg + (tier >= 2 ? 1 : 0) + (tier >= 4 ? 1 : 0);
  state.board = {
    rows: cfg.rows, cols: cfg.cols, mines: cfg.mines, quota: cfg.quota,
    qfrac: cfg.qfrac,
    nChests: cfg.nChests, nEnemies: cfg.nEnemies, started: 0,
    mine: new Array(cfg.rows * cfg.cols).fill(0),
    adj: new Array(cfg.rows * cfg.cols).fill(0),
    revealed: new Array(cfg.rows * cfg.cols).fill(0),
    flagged: new Array(cfg.rows * cfg.cols).fill(0),
    exploded: new Array(cfg.rows * cfg.cols).fill(0),
    chest: new Array(cfg.rows * cfg.cols).fill(0),
    chestOpen: new Array(cfg.rows * cfg.cols).fill(0),
  };
  state.enemies = [];
  state.pendingBoss = typeKey === "boss"
    ? pick(state, Object.keys(BOSSES))
    : null;
  state.charmUsed = false;
  state.shieldCharges = 0;
  state.stir = 0;
  state.abilityCharges = runModHook(
    state, "modAbilityCharges", CLASSES[state.classId].ability.charges
  );
  state.bestDepth = Math.max(state.bestDepth, floor);
  state.runMap.push({ floor, type: typeKey });
  if (state.runMap.length > 60) state.runMap.splice(0, state.runMap.length - 60);
  state.msg = "";
  state.phase = "play";
  note(
    state,
    `${ft.icon} ${ft.name} — floor ${floor} · ${cfg.rows}×${cfg.cols} · ` +
    `${cfg.mines} mines · ${cfg.nEnemies + (state.pendingBoss ? 1 : 0)} lurkers. ` +
    `Clear ${cfg.quota} tiles to open the stairs.`
  );
  if (tier > 0) note(state, `☠️ Corruption ${tier} — the mine grows hungrier.`);
  runHook(state, "floorStart");
  CLASSES[state.classId].onFloorStart?.(state, H);
}

function genShop(state) {
  const purchasable = Object.keys(ITEMS).filter((id) => {
    const m = ITEMS[id];
    return !(m.kind === "relic" && m.unique && (state.relics[id] || 0) > 0);
  });
  // Vaults are rare stops now, so each one stocks a wider shelf.
  return sampleN(state, purchasable, Math.min(4, purchasable.length));
}

function genPaths(state, nextFloor) {
  if (isBossFloor(nextFloor)) return ["boss"];
  const extras = sampleN(state, PATH_CANDIDATES, randInt(state, 1, 2));
  return shuffle(state, ["normal", ...extras]);
}

function openVault(state, nextFloor) {
  state.paths = genPaths(state, nextFloor);
  state.vaultShop = vaultHasShop(nextFloor);
  if (state.vaultShop) {
    state.shop = genShop(state);
    state.altarUsed = false;
    state.restsThisVault = 0;
    // Banked gold earns interest at each vault — spending everything has a cost.
    const interest = Math.min(Math.floor(state.gold * 0.1), 30);
    if (interest > 0) {
      state.gold += interest;
      state.stats.goldEarned += interest;
      note(state, `🏦 Interest on ${state.gold - interest} banked gold: +${interest}.`);
    }
  } else {
    // A bare landing between vaults: nothing for sale, but you catch your
    // breath — a free heart, since the vault's bunk is floors away.
    state.shop = [];
    state.altarUsed = true;
    note(state, "⛺ A bare landing — the vault lies deeper. Choose your descent.");
    healPlayer(state, 2, "⛺ You catch your breath:", true);
  }
  state.phase = "shop";
}

/** Reroll price escalates for the whole run — rerolling is never reset. */
export function rerollCost(state) {
  return REROLL_BASE + REROLL_STEP * (state.rerollCount || 0);
}

/** Replace only the unsold slots with fresh stock; sold slots stay sold. */
function rerollUnsold(state) {
  const fresh = genShop(state);
  let k = 0;
  state.shop = state.shop.map((id) => (id === null ? null : fresh[k++ % fresh.length]));
}

export function createRun(classId, seed = Date.now()) {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`Unknown class: ${classId}`);
  const state = {
    version: SAVE_VERSION,
    seed,
    rng: seedToRng(seed),
    phase: "play",
    classId,
    floor: 1,
    floorType: "normal",
    hp: cls.hp,
    maxHp: cls.hp,
    baseAttack: cls.attack,
    gold: cls.gold,
    goldMult: cls.goldMult ?? 1,
    floorGold: 1,
    floorDmg: 1,
    items: { ...cls.items },
    relics: {},
    abilityCharges: 0,
    shieldCharges: 0,
    charmUsed: false,
    guardianUsed: false,
    board: null,
    enemies: [],
    pendingBoss: null,
    nextUid: 1,
    turn: 0,
    stir: 0,
    shop: [],
    paths: [],
    altarUsed: false,
    rerollCount: 0,        // run-wide: reroll price never resets
    restCost: REST_COST_BASE, // run-wide: each rest raises the next one's price
    restsThisVault: 0,
    vaultShop: false,
    runMap: [],            // [{floor, type}] — the journey so far
    endless: false,
    won: false,
    bestDepth: 0,
    msg: "",
    log: [],
    stats: { tilesRevealed: 0, minesHit: 0, enemiesSlain: 0, bossesSlain: 0, chestsOpened: 0, goldEarned: 0 },
  };
  for (const [id, n] of Object.entries(cls.relics)) {
    for (let k = 0; k < n; k++) giveRelic(state, id);
  }
  startFloor(state, 1, "normal");
  return state;
}

// ---- action handlers --------------------------------------------------------

function doReveal(state, r, c) {
  const b = state.board;
  const i = idx(b, r, c);
  if (b.revealed[i] || b.flagged[i]) return "Tile already revealed or flagged.";
  state.msg = "";
  const first = !b.started;
  ensureStarted(state, r, c);

  if (b.mine[i]) {
    if (state.shieldCharges > 0) {
      state.shieldCharges -= 1;
      b.flagged[i] = 1;
      note(state, "🧱 Your shield absorbed the mine!");
    } else if (runHook(state, "onMineHit")) {
      b.flagged[i] = 1; // absorbed (e.g. Lucky Charm)
    } else {
      b.revealed[i] = 1;
      b.exploded[i] = 1;
      state.stats.minesHit += 1;
      state.hp -= state.floorDmg;
      if (state.hp <= 0) {
        if (runHook(state, "onLethal")) state.hp = 1;
        else { die(state); return null; }
      } else {
        note(state, `💥 Mine! −${state.floorDmg} heart${state.floorDmg === 1 ? "" : "s"}.`);
      }
    }
  } else {
    floodReveal(state, r, c);
  }
  if (first && state.phase === "play") finalizeQuota(state);
  tickEnemies(state);
  return null;
}

function doAttack(state, r, c) {
  const e = enemyAt(state, r, c);
  if (!e || !state.board.revealed[idx(state.board, r, c)]) return "No enemy there.";
  if (!e.awake) wakeEnemy(state, e);
  state.msg = "";
  damageEnemy(state, e, computeAttack(state), "⚔️ You");
  tickEnemies(state);
  return null;
}

function doUseItem(state, action) {
  const id = action.id;
  const meta = ITEMS[id];
  if (!meta || meta.kind !== "item") return `Unknown item: ${id}`;
  if ((state.items[id] || 0) <= 0) return `No ${meta.name} left.`;
  if (meta.target && (action.r == null || action.c == null))
    return `${meta.name} needs a target: include r and c.`;
  state.msg = "";
  const target = meta.target ? { r: action.r, c: action.c } : null;
  const consumed = meta.use(state, H, target);
  if (consumed) {
    state.items[id] -= 1;
    tickEnemies(state);
  }
  return null;
}

function doUseAbility(state, action) {
  const ab = CLASSES[state.classId].ability;
  if (state.abilityCharges <= 0) return "No ability charges left this floor.";
  if (ab.target && (action.r == null || action.c == null))
    return `${ab.name} needs a target: include r and c.`;
  state.msg = "";
  const target = ab.target ? { r: action.r, c: action.c } : null;
  const consumed = ab.use(state, H, target);
  if (consumed) {
    state.abilityCharges -= 1;
    tickEnemies(state);
  }
  return null;
}

function doDescend(state) {
  if (!quotaMet(state)) return "The stairs are shut — clear more safe tiles.";
  if (bossAlive(state)) return "The boss still lives — the stairs stay shut.";
  const g = gainGold(state, 10 * state.floor);
  state.msg = "";
  note(state, `⏬ Descended from floor ${state.floor} (+${g} gold).`);
  if (isBossFloor(state.floor)) {
    giveRandomRelic(state, "👑 Boss relic —");
    gainGold(state, 25);
    if (state.floor >= FINAL_FLOOR && !state.endless) {
      state.won = true;
      state.bestDepth = Math.max(state.bestDepth, state.floor);
      state.phase = "won";
      return null;
    }
  }
  openVault(state, state.floor + 1);
  return null;
}

function doBuy(state, slot) {
  if (slot < 0 || slot >= state.shop.length) return "Bad shop slot.";
  const id = state.shop[slot];
  if (!id) return "That slot is sold out.";
  const m = ITEMS[id];
  if (m.kind === "relic" && m.unique && (state.relics[id] || 0) > 0) return "Already owned.";
  const price = priceOf(state, id);
  if (state.gold < price) return "Not enough gold.";
  state.gold -= price;
  if (m.kind === "item") giveItem(state, id);
  else giveRelic(state, id);
  state.shop[slot] = null;
  state.msg = "";
  note(state, `Bought ${m.icon} ${m.name}.`);
  return null;
}

const VALID_PHASE = {
  reveal: "play", flag: "play", attack: "play", useItem: "play",
  useAbility: "play", descend: "play", tick: "play",
  buy: "shop", reroll: "shop", rest: "shop", altar: "shop", choosePath: "shop",
  continueEndless: "won",
};

/**
 * Apply an action to a state. Returns { state, error } — `state` is a new
 * object (the input is never mutated); on error the state is unchanged.
 */
export function applyAction(prevState, action) {
  if (!action || typeof action.type !== "string")
    return { state: prevState, error: "Action must be an object with a `type`." };

  const need = VALID_PHASE[action.type];
  if (!need) return { state: prevState, error: `Unknown action type: ${action.type}` };
  if (prevState.phase !== need)
    return { state: prevState, error: `Action ${action.type} is only valid in phase "${need}" (current: "${prevState.phase}").` };

  const state = structuredClone(prevState);
  let error = null;

  if (["reveal", "flag", "attack"].includes(action.type)) {
    const { r, c } = action;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !inBounds(state.board, r, c))
      return { state: prevState, error: "r/c out of bounds." };
  }

  switch (action.type) {
    case "reveal": error = doReveal(state, action.r, action.c); break;
    case "flag": {
      const b = state.board;
      const i = idx(b, action.r, action.c);
      if (!b.started) error = "Dig somewhere first.";
      else if (b.revealed[i]) error = "Tile already revealed.";
      else b.flagged[i] = b.flagged[i] ? 0 : 1;
      break;
    }
    case "attack": error = doAttack(state, action.r, action.c); break;
    case "tick": {
      // Time passes without the player moving: enemies count down and act.
      // The browser UI sends this on a real-time heartbeat; headless players
      // may send it (or not) to simulate time pressure.
      const prevMsg = state.msg;
      state.msg = "";
      tickEnemies(state);
      if (!state.msg) state.msg = prevMsg; // quiet tick: keep the last message
      break;
    }
    case "useItem": error = doUseItem(state, action); break;
    case "useAbility": error = doUseAbility(state, action); break;
    case "descend": error = doDescend(state); break;
    case "buy": error = doBuy(state, action.slot ?? -1); break;
    case "reroll": {
      const cost = rerollCost(state);
      if (!state.vaultShop) error = "No vault on this landing.";
      else if (!state.shop.some((id) => id !== null))
        error = "Every slot is sold — nothing left to reroll.";
      else if (state.gold < cost) error = `Not enough gold to reroll (${cost}g).`;
      else {
        state.gold -= cost;
        state.rerollCount = (state.rerollCount || 0) + 1;
        rerollUnsold(state);
        note(state, `🎲 Rerolled the unsold stock (next reroll: ${rerollCost(state)}g).`);
      }
      break;
    }
    case "rest":
      if (!state.vaultShop) error = "No vault on this landing.";
      else if (state.restsThisVault >= REST_LIMIT_PER_VAULT)
        error = "The bunk is spent — no more resting at this vault.";
      else if (state.hp >= state.maxHp) error = "Already at full hearts.";
      else if (state.gold < state.restCost) error = "Not enough gold.";
      else {
        state.gold -= state.restCost;
        state.hp += 1;
        state.restsThisVault += 1;
        state.restCost += REST_COST_STEP;
        note(state, `➕ Rested. +1 heart (next rest: ${state.restCost}g).`);
      }
      break;
    case "altar":
      if (!state.vaultShop) error = "No vault on this landing.";
      else if (state.altarUsed) error = "The altar is spent.";
      else if (state.hp < 2) error = "Too weak to bleed for the altar.";
      else {
        state.hp -= 1;
        state.altarUsed = true;
        state.msg = "";
        giveRandomRelic(state, "🩸 The altar drinks your blood and grants");
      }
      break;
    case "choosePath": {
      const i = action.index ?? -1;
      if (i < 0 || i >= state.paths.length) error = "Bad path index.";
      else startFloor(state, state.floor + 1, state.paths[i]);
      break;
    }
    case "continueEndless":
      state.endless = true;
      openVault(state, state.floor + 1);
      break;
  }

  if (error) return { state: prevState, error };
  return { state, error: null };
}

// ---- save / load ------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(json) {
  const state = typeof json === "string" ? JSON.parse(json) : json;
  if (state.version !== SAVE_VERSION)
    throw new Error(`Save version mismatch (got ${state.version}, need ${SAVE_VERSION}).`);
  return state;
}
