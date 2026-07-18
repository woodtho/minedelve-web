// =============================================================================
// FLOOR TYPE REGISTRY
// -----------------------------------------------------------------------------
// To add a floor type, add an entry:
//   dens      — mine density multiplier
//   chests    — extra chests (+/-)
//   qfrac     — quota fraction modifier (+/- share of safe tiles to clear)
//   gold      — gold multiplier while on the floor
//   dmg       — hearts lost per mine hit
//   enemyMult — enemy count multiplier
//   relic     — clearing the floor grants a relic (boss floors)
// Then add its key to genPath candidates below (non-boss types only).
// =============================================================================

export const FLOOR_TYPES = {
  normal: {
    key: "normal", name: "Deep Tunnels", icon: "🕳️", accent: "#9a8b78",
    dens: 1.0, chests: 0, qfrac: 0.0, gold: 1.0, dmg: 1, enemyMult: 1, relic: false,
    desc: "A standard minefield. Steady footing.",
  },
  treasure: {
    key: "treasure", name: "Glittering Vein", icon: "💎", accent: "#ffd166",
    dens: 0.6, chests: 2, qfrac: -0.05, gold: 1.25, dmg: 1, enemyMult: 0.5, relic: false,
    desc: "Fewer mines, extra chests. Grab the loot and go.",
  },
  quiet: {
    key: "quiet", name: "Silent Gallery", icon: "🕯️", accent: "#8fd3ff",
    dens: 0.75, chests: 0, qfrac: 0.12, gold: 0.9, dmg: 1, enemyMult: 0.25, relic: false,
    desc: "Sparse danger, but a longer clear. Good when you need breathing room.",
  },
  unstable: {
    key: "unstable", name: "Cracked Span", icon: "⚡", accent: "#ff9e80",
    dens: 1.35, chests: -1, qfrac: -0.1, gold: 1.6, dmg: 1, enemyMult: 0.75, relic: false,
    desc: "A short, volatile floor: fewer tiles owed, more mines, richer seams.",
  },
  cursed: {
    key: "cursed", name: "The Gauntlet", icon: "🔥", accent: "#e05a4a",
    dens: 1.2, chests: 1, qfrac: 0.05, gold: 1.75, dmg: 2, enemyMult: 1, relic: false,
    desc: "Dense field, and mines bite for 2 hearts — but the gold is rich.",
  },
  armory: {
    key: "armory", name: "Buried Armory", icon: "⚔️", accent: "#c0d6a8",
    dens: 0.95, chests: 2, qfrac: 0.04, gold: 1.15, dmg: 1, enemyMult: 1.4, relic: false,
    desc: "More guarded caches. Expect fights, but the supply crates are real.",
  },
  infested: {
    key: "infested", name: "The Broodnest", icon: "🕸️", accent: "#7ec06a",
    dens: 0.85, chests: 1, qfrac: 0.0, gold: 1.5, dmg: 1, enemyMult: 2.5, relic: false,
    desc: "Crawling with things that bite back — and their hoarded gold.",
  },
  vault: {
    key: "vault", name: "Sunken Vault", icon: "🗝️", accent: "#f0c36a",
    dens: 1.05, chests: 3, qfrac: 0.08, gold: 1.05, dmg: 1, enemyMult: 1.2, relic: false,
    desc: "A deep cache with extra chests. More work, more chances to stock up.",
  },
  boss: {
    key: "boss", name: "The Warren's Heart", icon: "👑", accent: "#c792ea",
    dens: 1.25, chests: 1, qfrac: 0.08, gold: 2.0, dmg: 1, enemyMult: 0.5, relic: true,
    desc: "A brutal floor ruled by a boss. Kill it and clear the field for a relic.",
  },
};

// Non-boss floor types offered as descent paths.
export const PATH_CANDIDATES = [
  "treasure", "quiet", "unstable", "cursed", "armory", "infested", "vault",
];

export const isBossFloor = (f) => f % 5 === 0;

/** Base difficulty curve before floor-type modifiers. */
export function baseFloorCfg(floor) {
  const rows = Math.min(8 + Math.floor((floor - 1) / 2), 13);
  const cols = Math.min(10 + Math.floor((floor - 1) / 2), 16);
  const density = Math.min(0.12 + 0.012 * (floor - 1), 0.23);
  let mines = Math.max(Math.round(rows * cols * density), 6 + floor);
  mines = Math.min(mines, rows * cols - 12);
  const qfrac = Math.min(0.5 + 0.02 * (floor - 1), 0.7);
  const nChests = Math.min(1 + Math.floor((floor - 1) / 3), 3);
  return { rows, cols, mines, qfrac, nChests };
}

/** Apply a floor type's modifiers to the base config. */
export function applyFloorType(cfg, typeKey, floor) {
  const ft = FLOOR_TYPES[typeKey];
  const total = cfg.rows * cfg.cols;
  const mines = Math.max(6, Math.min(Math.round(cfg.mines * ft.dens), total - 12));
  const safe = total - mines;
  const qf = Math.min(Math.max(cfg.qfrac + ft.qfrac, 0.3), 0.85);
  const quota = Math.max(1, Math.min(Math.ceil(safe * qf), safe));
  const nChests = Math.max(0, cfg.nChests + ft.chests);
  const baseEnemies = Math.min(1 + Math.floor((floor - 1) / 2), 6);
  const nEnemies = Math.max(0, Math.round(baseEnemies * ft.enemyMult));
  return { rows: cfg.rows, cols: cfg.cols, mines, quota, qfrac: qf, nChests, nEnemies };
}
