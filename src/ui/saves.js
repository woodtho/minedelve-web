// LocalStorage save system. The engine state is plain JSON, so saving is just
// stringify/parse. One autosave slot (written after every action) plus three
// manual slots, plus export/import for moving runs between machines.

import { serialize, deserialize, SAVE_VERSION } from "../engine/engine.js";

const AUTO_KEY = "minedelve.autosave";
const SLOT_KEY = (n) => `minedelve.slot.${n}`;
const META_KEY = "minedelve.meta";

function safeParse(json) {
  try {
    return deserialize(json);
  } catch {
    return null;
  }
}

export const autosave = (state) => {
  try { localStorage.setItem(AUTO_KEY, serialize(state)); } catch { /* full/blocked */ }
};
export const loadAutosave = () => {
  const raw = localStorage.getItem(AUTO_KEY);
  return raw ? safeParse(raw) : null;
};
export const clearAutosave = () => localStorage.removeItem(AUTO_KEY);

export const saveSlot = (n, state) => localStorage.setItem(SLOT_KEY(n), serialize(state));
export const loadSlot = (n) => {
  const raw = localStorage.getItem(SLOT_KEY(n));
  return raw ? safeParse(raw) : null;
};
export const clearSlot = (n) => localStorage.removeItem(SLOT_KEY(n));

export const slotSummary = (n) => {
  const s = loadSlot(n);
  if (!s) return null;
  return { classId: s.classId, floor: s.floor, hp: s.hp, maxHp: s.maxHp, gold: s.gold, phase: s.phase };
};

export const exportSave = (state) => serialize(state);
export const importSave = (json) => deserialize(json); // throws with a message on bad input

export const loadMeta = () => {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY)) ?? {};
    return { bestDepth: 0, unlocks: {}, ...m };
  } catch {
    return { bestDepth: 0, unlocks: {} };
  }
};
export const saveMeta = (meta) => localStorage.setItem(META_KEY, JSON.stringify(meta));

export { SAVE_VERSION };
