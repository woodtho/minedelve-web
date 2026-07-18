// Meta-progression: class unlocks, checked against the live run state after
// every action. The engine itself is never gated (the CLI can always play any
// class); this is a UI-layer progression system stored in localStorage meta.
//
// To add an unlock, add an entry: { desc, test(state) -> bool }.

export const BASE_CLASSES = ["delver", "warden", "prospector", "sapper"];

export const UNLOCKS = {
  knight: { desc: "Slay a boss", test: (s) => s.stats.bossesSlain >= 1 },
  alchemist: { desc: "Hold 200 gold at once", test: (s) => s.gold >= 200 },
  seer: { desc: "Open 8 chests in one run", test: (s) => s.stats.chestsOpened >= 8 },
  monk: { desc: "Reach floor 6", test: (s) => s.floor >= 6 },
};

export const isUnlocked = (meta, classId) =>
  BASE_CLASSES.includes(classId) || !!meta.unlocks?.[classId];

/** Returns ids newly unlocked by this state (not yet in meta). */
export function checkUnlocks(meta, state) {
  const fresh = [];
  for (const [id, u] of Object.entries(UNLOCKS)) {
    if (!meta.unlocks?.[id] && u.test(state)) fresh.push(id);
  }
  return fresh;
}

/** Seed for today's daily delve — same for everyone, changes at midnight. */
export function dailySeed(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}
