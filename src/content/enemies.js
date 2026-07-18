// =============================================================================
// ENEMY REGISTRY
// -----------------------------------------------------------------------------
// Enemies sleep on safe tiles. Revealing their tile wakes them; awake enemies
// act every `cd` player turns (reveals, attacks, and item/ability uses all
// count as a turn — flagging doesn't). Click a revealed enemy to attack it.
//
// To add an enemy, add an entry:
//   hp, dmg, cd    — health, hearts of damage per strike, turns between strikes
//   bounty         — gold on kill (scaled by floor gold multipliers)
//   floors         — [min, max] floor range where it can spawn
//   traits (optional, engine-interpreted):
//     steal:  true — steals gold instead of dealing damage (attacks if broke)
//     healer: true — heals its most wounded awake ally instead of attacking
//     armored:true — takes at most 1 damage per hit
//     spawner:"id" — periodically wakes a new <id> on a hidden tile
//     burrow: n    — re-buries up to n adjacent revealed tiles (attacks quota!)
//     planter:true — plants a fresh mine under a nearby revealed tile
// Bosses live in BOSSES; hp scales with floor. One guards every 5th floor —
// the stairs stay shut until it dies. Bosses may define onEnrage(state, H, e),
// fired once when they drop to half health.
// =============================================================================

export const ENEMIES = {
  rat: {
    id: "rat", name: "Tunnel Rat", icon: "🐀", hp: 1, dmg: 1, cd: 2, bounty: 6,
    floors: [1, 4], traits: {},
    desc: "Weak but persistent. Squish it before it nibbles.",
  },
  bat: {
    id: "bat", name: "Shriekbat", icon: "🦇", hp: 1, dmg: 1, cd: 1, bounty: 8,
    floors: [2, 6], traits: {},
    desc: "Fragile, but strikes every single turn. Kill it fast.",
  },
  goblin: {
    id: "goblin", name: "Gob Cutpurse", icon: "👺", hp: 2, dmg: 1, cd: 2, bounty: 14,
    floors: [2, 7], traits: { steal: true },
    desc: "Steals your gold instead of your blood. Mostly.",
  },
  skeleton: {
    id: "skeleton", name: "Skeleton Miner", icon: "💀", hp: 3, dmg: 1, cd: 2, bounty: 12,
    floors: [3, 8], traits: {},
    desc: "Still swinging a pickaxe after all these years.",
  },
  shaman: {
    id: "shaman", name: "Mold Shaman", icon: "🍄", hp: 2, dmg: 1, cd: 2, bounty: 16,
    floors: [4, 9], traits: { healer: true },
    desc: "Mends its allies with glowing spores. Kill it first.",
  },
  wraith: {
    id: "wraith", name: "Pit Wraith", icon: "👻", hp: 2, dmg: 2, cd: 3, bounty: 18,
    floors: [5, 12], traits: {},
    desc: "Slow to gather itself, then hits like a cave-in.",
  },
  imp: {
    id: "imp", name: "Cinder Imp", icon: "🔥", hp: 2, dmg: 1, cd: 2, bounty: 10,
    floors: [4, 99], traits: {},
    desc: "A skittering ember with a grudge.",
  },
  golem: {
    id: "golem", name: "Ore Golem", icon: "🗿", hp: 5, dmg: 2, cd: 4, bounty: 25,
    floors: [6, 99], traits: { armored: true },
    desc: "Armored: takes at most 1 damage per hit. Bring patience.",
  },
  mole: {
    id: "mole", name: "Barrow Mole", icon: "🦡", hp: 2, dmg: 1, cd: 2, bounty: 14,
    floors: [3, 99], traits: { burrow: 2 },
    desc: "Doesn't want your blood — it re-buries your hard-dug tiles.",
  },
  gremlin: {
    id: "gremlin", name: "Powder Gremlin", icon: "👹", hp: 2, dmg: 1, cd: 3, bounty: 20,
    floors: [5, 99], traits: { planter: true },
    desc: "Plants fresh mines under cleared ground. Kill it before it re-sows the field.",
  },
};

// Not in any floor pool — roughly 1 in 10 chests is one of these instead.
export const MIMIC = {
  id: "mimic", name: "Chest Mimic", icon: "📦", hp: 3, dmg: 2, cd: 2, bounty: 35,
  floors: [0, 0], traits: {},
  desc: "Some chests are teeth. Pays well when put down.",
};

export const BOSSES = {
  broodmother: {
    id: "broodmother", name: "The Broodmother", icon: "🕷️", hp: 8, dmg: 2, cd: 3, bounty: 60,
    traits: { spawner: "rat" }, boss: true,
    desc: "Every few turns, more of the brood wakes somewhere in the dark.",
    onEnrage: (state, H) => {
      const n = H.spawnFromDark(state, "rat", 2);
      H.note(state, n
        ? "🕷️ The Broodmother shrieks — the brood scurries in the dark!"
        : "🕷️ The Broodmother shrieks!");
    },
  },
  gilded_golem: {
    id: "gilded_golem", name: "The Gilded Golem", icon: "🌟", hp: 8, dmg: 2, cd: 5, bounty: 90,
    traits: { armored: true }, boss: true,
    desc: "Armored in solid gold — at most 1 damage per hit, but slow as sediment.",
    onEnrage: (state, H, e) => {
      e.cdMax = Math.max(2, e.cdMax - 2);
      e.cd = Math.min(e.cd, e.cdMax);
      H.note(state, "🌟 Cracks spread across the gold — the Golem speeds up!");
    },
  },
  deep_warden: {
    id: "deep_warden", name: "The Deep Warden", icon: "🐲", hp: 9, dmg: 3, cd: 4, bounty: 75,
    traits: {}, boss: true,
    desc: "The mine's jailer. Hits for three hearts. Do not get comfortable.",
    onEnrage: (state, H) => {
      H.rehideRandomRevealed(state, 3, "🐲 The Warden's roar shakes the mine —");
    },
  },
};

/** Enemy templates that may spawn on a given (non-boss) floor. */
export function enemyPoolForFloor(floor) {
  const pool = Object.values(ENEMIES).filter(
    (e) => floor >= e.floors[0] && floor <= e.floors[1]
  );
  return pool.length ? pool : [ENEMIES.rat];
}
