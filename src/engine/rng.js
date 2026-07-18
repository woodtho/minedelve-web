// Deterministic RNG (mulberry32). The generator state is a single uint32 kept
// inside the game state (`state.rng`), so every run is reproducible from its
// seed and replayable from any save file.

export function seedToRng(seed) {
  const s = Math.floor(Number(seed)) >>> 0;
  return s === 0 ? 0x9e3779b9 : s;
}

/** Advance state.rng and return a float in [0, 1). */
export function nextFloat(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [lo, hi] inclusive. */
export function randInt(state, lo, hi) {
  return lo + Math.floor(nextFloat(state) * (hi - lo + 1));
}

/** One element of arr. */
export function pick(state, arr) {
  return arr[Math.floor(nextFloat(state) * arr.length)];
}

/** n distinct elements of arr (n clamped to arr.length). */
export function sampleN(state, arr, n) {
  const pool = arr.slice();
  const out = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    out.push(pool.splice(Math.floor(nextFloat(state) * pool.length), 1)[0]);
  }
  return out;
}

/** In-place Fisher-Yates shuffle; returns arr. */
export function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
