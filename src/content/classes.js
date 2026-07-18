// =============================================================================
// CLASS REGISTRY
// -----------------------------------------------------------------------------
// To add a class, add an entry:
//   hp, gold, attack     — starting stats (attack is damage vs enemies)
//   goldMult             — multiplier on all gold earned (default 1)
//   items                — starting consumables, e.g. { probe: 2 }
//   relics               — starting relics, e.g. { vein: 1 }
//   ability: { id, name, icon, target, charges, desc, use(state, H, target) }
//       use returns true if the charge should be consumed. `target` is {r,c}
//       when ability.target is true, else null.
//   passives (all optional):
//       onFloorStart(state, H)      — before the board exists (heals etc.)
//       afterPlacement(state, H)    — after mines are placed on first dig
// =============================================================================

export const CLASSES = {
  delver: {
    id: "delver", name: "Delver", icon: "⛏️", hp: 3, gold: 0, attack: 1, goldMult: 1,
    items: { probe: 2 }, relics: {},
    ability: {
      id: "scout", name: "Scout", icon: "🔦", target: true, charges: 1,
      desc: "Safely reveal one tile. Once per floor.",
      use: (state, H, t) => H.probeAt(state, t.r, t.c, "🔦 Scout:"),
    },
    blurb: "Balanced and forgiving. Starts with spare probes — a good first delve.",
  },

  warden: {
    id: "warden", name: "Warden", icon: "🛡️", hp: 5, gold: 0, attack: 1, goldMult: 0.8,
    items: { medkit: 1 }, relics: {},
    ability: {
      id: "bulwark", name: "Bulwark", icon: "🧱", target: false, charges: 1,
      desc: "Raise a shield that blocks the next hit — mine or monster. Once per floor.",
      use: (state, H) => {
        state.shieldCharges += 1;
        H.note(state, "🧱 Bulwark raised — the next hit is blocked.");
        return true;
      },
    },
    blurb: "Five hearts of armor, but earns 20% less gold. Walks into danger and shrugs.",
  },

  prospector: {
    id: "prospector", name: "Prospector", icon: "💰", hp: 2, gold: 15, attack: 1, goldMult: 1,
    items: { probe: 1 }, relics: { vein: 1 },
    ability: {
      id: "dowse", name: "Dowse", icon: "📡", target: true, charges: 1,
      desc: "Flag up to 2 mines around a chosen tile. Once per floor.",
      use: (state, H, t) => H.dowseAt(state, t.r, t.c, 2),
    },
    blurb: "Only two hearts, but +50% gold and 15 to start. Buy your way to safety.",
  },

  sapper: {
    id: "sapper", name: "Sapper", icon: "💣", hp: 3, gold: 0, attack: 1, goldMult: 1,
    items: { blast: 1 }, relics: {},
    ability: {
      id: "detonate", name: "Detonate", icon: "🧨", target: true, charges: 1,
      desc: "Safely clear a 3×3 area, hitting enemies inside for 2. Once per floor.",
      use: (state, H, t) => H.blastAt(state, t.r, t.c, "🧨 Detonate:", 2),
    },
    blurb: "Aggressive board control. Opens with a Blast Charge and cracks fields wide open.",
  },

  knight: {
    id: "knight", name: "Knight", icon: "⚔️", hp: 4, gold: 0, attack: 2, goldMult: 1,
    items: { tonic: 1 }, relics: {},
    ability: {
      id: "cleave", name: "Cleave", icon: "🌀", target: false, charges: 1,
      desc: "Strike every awake enemy for 2 damage. Once per floor.",
      use: (state, H) => H.damageAllAwakeEnemies(state, 2, "🌀 Cleave"),
    },
    blurb: "Hits monsters twice as hard and shrugs off brawls. The mine still bites, though.",
  },

  alchemist: {
    id: "alchemist", name: "Alchemist", icon: "⚗️", hp: 3, gold: 5, attack: 1, goldMult: 1,
    items: { medkit: 1 }, relics: {},
    ability: {
      id: "transmute", name: "Transmute", icon: "✨", target: true, charges: 1,
      desc: "Turn a flagged mine into 12 gold — the mine is destroyed. Once per floor.",
      use: (state, H, t) => H.defuseAt(state, t.r, t.c, 12),
    },
    blurb: "Flags aren't warnings — they're ore. Turns marked mines into pure profit.",
  },

  seer: {
    id: "seer", name: "Seer", icon: "🔮", hp: 3, gold: 0, attack: 1, goldMult: 1,
    items: { scroll: 1 }, relics: {},
    ability: {
      id: "glimpse", name: "Glimpse", icon: "👁️", target: false, charges: 1,
      desc: "Reveal 3 random safe tiles. Once per floor.",
      use: (state, H) => H.revealRandomSafe(state, 3, "👁️ Glimpse reveals"),
    },
    afterPlacement: (state, H) => H.revealRandomSafe(state, 1, "🔮 A vision reveals"),
    blurb: "The mine whispers its secrets. Every floor begins with a free vision.",
  },

  monk: {
    id: "monk", name: "Monk", icon: "🧘", hp: 4, gold: 0, attack: 1, goldMult: 1,
    items: {}, relics: {},
    ability: {
      id: "meditate", name: "Meditate", icon: "🕉️", target: false, charges: 1,
      desc: "Restore 2 hearts. Once per floor.",
      use: (state, H) => H.healPlayer(state, 2, "🕉️ Meditation:"),
    },
    onFloorStart: (state, H) => H.healPlayer(state, 1, "🧘 Inner peace:", true),
    blurb: "Owns nothing, needs nothing. Regenerates a heart on every new floor.",
  },
};
