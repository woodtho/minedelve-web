// =============================================================================
// ITEM & RELIC REGISTRY
// -----------------------------------------------------------------------------
// To add a consumable item: add an entry with kind:"item" and a `use` function.
//   use(state, H, target) -> bool   (return true if the item was consumed)
//   `H` is the engine helper API (see engine.js makeHelpers) — note, gainGold,
//   probeAt, blastAt, healPlayer, damageAllAwakeEnemies, revealRandomSafe, ...
//   `target` is {r, c} for targeted items (set `target: true`), else null.
//
// To add a relic: add an entry with kind:"relic" and optional `hooks`:
//   onAcquire(state, H)                  — fired when gained
//   afterPlacement(state, H, count)      — after mines are placed each floor
//   floorStart(state, H, count)          — at the start of each floor
//   onMineHit(state, H, count) -> bool   — return true to absorb the hit
//   onLethal(state, H, count) -> bool    — return true to survive at 1 hp
//   onEnemyAttack(state, H, count, enemy)— after an enemy damages the player
//   modGold(state, count, amount) -> n   — modify any gold gain
//   modChestGold(state, count, n) -> n   — modify gold found in chests
//   modAbilityCharges(state, count, n)   — modify per-floor ability charges
//   modEnemyCooldown(state, count, cd)   — modify enemy attack cooldowns
// Relics with unique:true can only be owned once; others stack (count > 1).
// =============================================================================

export const ITEMS = {
  // ---- consumables ----------------------------------------------------------
  probe: {
    id: "probe", name: "Probe", icon: "🔍", price: 8, kind: "item", target: true,
    desc: "Safely reveal one tile. A mine is flagged, not triggered.",
    use: (state, H, t) => H.probeAt(state, t.r, t.c, "🔍 Probe:"),
  },
  blast: {
    id: "blast", name: "Blast Charge", icon: "💥", price: 16, kind: "item", target: true,
    desc: "Clear a 3×3 area. Mines are flagged, enemies caught take 2 damage.",
    use: (state, H, t) => H.blastAt(state, t.r, t.c, "💥 Blast:", 2),
  },
  medkit: {
    id: "medkit", name: "Med-Kit", icon: "➕", price: 10, kind: "item", target: false,
    desc: "Restore one heart.",
    use: (state, H) => H.healPlayer(state, 1, "➕ Med-Kit:"),
  },
  tonic: {
    id: "tonic", name: "Miner's Tonic", icon: "🧪", price: 15, kind: "item", target: false,
    desc: "Restore two hearts.",
    use: (state, H) => H.healPlayer(state, 2, "🧪 Tonic:"),
  },
  bomb: {
    id: "bomb", name: "Powder Bomb", icon: "🧨", price: 20, kind: "item", target: false,
    desc: "Deal 3 damage to every awake enemy on the floor.",
    use: (state, H) => H.damageAllAwakeEnemies(state, 3, "🧨 Powder Bomb"),
  },
  snare: {
    id: "snare", name: "Snare Trap", icon: "🪤", price: 12, kind: "item", target: true,
    desc: "Stun an awake enemy for 3 turns.",
    use: (state, H, t) => H.stunEnemyAt(state, t.r, t.c, 3, "🪤 Snare:"),
  },
  scroll: {
    id: "scroll", name: "Miner's Map", icon: "🗺️", price: 18, kind: "item", target: false,
    desc: "Reveal 4 random safe tiles anywhere on the floor.",
    use: (state, H) => H.revealRandomSafe(state, 4, "🗺️ The map reveals"),
  },

  // ---- relics ---------------------------------------------------------------
  iron_heart: {
    id: "iron_heart", name: "Iron Heart", icon: "🛡️", price: 24, kind: "relic", unique: false,
    desc: "+1 max heart, and heal 1. Stacks.",
    hooks: {
      onAcquire: (state, H) => { state.maxHp += 1; state.hp += 1; },
    },
  },
  dowsing: {
    id: "dowsing", name: "Dowsing Rod", icon: "📡", price: 22, kind: "relic", unique: false,
    desc: "Each floor, one mine is auto-flagged. Stacks.",
    hooks: {
      afterPlacement: (state, H, count) => H.autoFlagMines(state, count, "📡 Dowsing"),
    },
  },
  whetstone: {
    id: "whetstone", name: "Whetstone", icon: "🗡️", price: 26, kind: "relic", unique: false,
    desc: "+1 attack damage against enemies. Stacks.",
    // Passive: read by computeAttack() in the engine.
  },
  lucky: {
    id: "lucky", name: "Lucky Charm", icon: "🍀", price: 30, kind: "relic", unique: true,
    desc: "Ignore the first mine you hit on each floor.",
    hooks: {
      onMineHit: (state, H) => {
        if (state.charmUsed) return false;
        state.charmUsed = true;
        H.note(state, "🍀 Lucky Charm absorbed a mine!");
        return true;
      },
    },
  },
  vein: {
    id: "vein", name: "Vein of Gold", icon: "🪙", price: 34, kind: "relic", unique: true,
    desc: "+50% gold from every source.",
    hooks: { modGold: (state, count, amount) => amount * 1.5 },
  },
  thornmail: {
    id: "thornmail", name: "Thornmail", icon: "🌵", price: 28, kind: "relic", unique: true,
    desc: "Enemies that strike you take 1 damage back.",
    hooks: {
      onEnemyAttack: (state, H, count, enemy) => H.damageEnemy(state, enemy, 1, "🌵 Thornmail"),
    },
  },
  hourglass: {
    id: "hourglass", name: "Leaden Hourglass", icon: "⏳", price: 30, kind: "relic", unique: true,
    desc: "Enemies attack one turn slower.",
    hooks: { modEnemyCooldown: (state, count, cd) => cd + 1 },
  },
  golden_key: {
    id: "golden_key", name: "Golden Key", icon: "🗝️", price: 26, kind: "relic", unique: true,
    desc: "Chests contain double gold.",
    hooks: { modChestGold: (state, count, n) => n * 2 },
  },
  banner: {
    id: "banner", name: "War Banner", icon: "🚩", price: 32, kind: "relic", unique: true,
    desc: "+1 ability charge each floor.",
    hooks: { modAbilityCharges: (state, count, n) => n + 1 },
  },
  guardian: {
    id: "guardian", name: "Guardian Angel", icon: "😇", price: 55, kind: "relic", unique: true,
    desc: "Once per run, survive a hit that would end you.",
    hooks: {
      onLethal: (state, H) => {
        if (state.guardianUsed) return false;
        state.guardianUsed = true;
        H.note(state, "😇 Guardian Angel pulled you back from the brink!");
        return true;
      },
    },
  },
};

export const RELIC_IDS = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === "relic");
export const CONSUMABLE_IDS = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === "item");
