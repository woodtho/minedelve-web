// =============================================================================
// SOUND — synthesized with WebAudio, no audio files. Every effect is a short
// oscillator/noise gesture, so the game stays a single self-contained bundle.
// The AudioContext is created lazily on the first user gesture (autoplay
// policy); mute preference persists in localStorage.
// =============================================================================

import { CLASSES } from "../content/classes.js";

const MKEY = "minedelve.muted";
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem(MKEY) === "1"; } catch { /* ignore */ }

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem(MKEY, m ? "1" : "0"); } catch { /* ignore */ }
}

/** Call from any user gesture to satisfy browser autoplay rules. */
export function unlockAudio() { ensure(); }

function ensure() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function env(g, t0, attack, dur, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
}

function tone({ f0, f1 = null, type = "sine", dur = 0.15, gain = 0.3, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  env(g, t0, 0.005, dur, gain);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.12, cutoff = 800, gain = 0.25, delay = 0, type = "lowpass" }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = cutoff;
  const g = c.createGain();
  env(g, t0, 0.003, dur, gain);
  src.connect(fl); fl.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

export const SFX = {
  dig:     () => { noise({ dur: .07, cutoff: 600, gain: .22 }); tone({ f0: 170, f1: 110, dur: .08, gain: .15, type: "triangle" }); },
  flag:    () => tone({ f0: 660, dur: .05, gain: .12, type: "square" }),
  denied:  () => { tone({ f0: 120, dur: .09, gain: .14, type: "square" }); tone({ f0: 100, dur: .09, gain: .14, type: "square", delay: .1 }); },
  mine:    () => { noise({ dur: .35, cutoff: 300, gain: .5 }); tone({ f0: 150, f1: 40, dur: .4, gain: .5 }); },
  hurt:    () => { noise({ dur: .15, cutoff: 400, gain: .3 }); tone({ f0: 200, f1: 80, dur: .2, gain: .3 }); },
  block:   () => { noise({ dur: .06, cutoff: 2500, gain: .16, type: "highpass" }); tone({ f0: 520, f1: 400, dur: .08, gain: .15, type: "triangle" }); },
  attack:  () => { noise({ dur: .05, cutoff: 2600, gain: .2, type: "highpass" }); tone({ f0: 240, f1: 180, dur: .07, gain: .22, type: "square" }); },
  kill:    () => { tone({ f0: 330, f1: 150, dur: .12, gain: .25, type: "sawtooth" }); noise({ dur: .12, cutoff: 900, gain: .2, delay: .03 }); },
  coin:    () => { tone({ f0: 880, dur: .06, gain: .14 }); tone({ f0: 1320, dur: .09, gain: .14, delay: .06 }); },
  chest:   () => [660, 880, 1100].forEach((f, i) => tone({ f0: f, dur: .09, gain: .15, delay: i * .07 })),
  heal:    () => tone({ f0: 440, f1: 880, dur: .25, gain: .16, type: "triangle" }),
  wake:    () => { tone({ f0: 95, f1: 70, dur: .3, gain: .28, type: "sawtooth" }); noise({ dur: .25, cutoff: 200, gain: .2 }); },
  stir:    () => { noise({ dur: .5, cutoff: 130, gain: .32 }); tone({ f0: 60, f1: 45, dur: .5, gain: .28 }); },
  enrage:  () => { tone({ f0: 130, f1: 60, dur: .45, gain: .38, type: "sawtooth" }); noise({ dur: .4, cutoff: 350, gain: .28 }); },
  descend: () => { tone({ f0: 300, f1: 80, dur: .5, gain: .28 }); noise({ dur: .45, cutoff: 200, gain: .22, delay: .05 }); },
  buy:     () => { SFX.coin(); noise({ dur: .04, cutoff: 1500, gain: .1, delay: .12 }); },
  reroll:  () => { noise({ dur: .05, cutoff: 1200, gain: .14 }); noise({ dur: .05, cutoff: 1400, gain: .14, delay: .08 }); },
  win:     () => [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: .18, gain: .2, delay: i * .13 })),
  dead:    () => [330, 262, 196, 131].forEach((f, i) => tone({ f0: f, dur: .3, gain: .2, delay: i * .18, type: "triangle" })),
  // A controlled blast (blast charge, bomb, detonate) — punchy, not lethal.
  boom:    () => { noise({ dur: .2, cutoff: 500, gain: .35 }); tone({ f0: 200, f1: 60, dur: .25, gain: .35 }); },
  // An enemy rearing back — a rising snarl of warning.
  windup:  () => { tone({ f0: 140, f1: 280, dur: .22, gain: .22, type: "sawtooth" }); noise({ dur: .15, cutoff: 500, gain: .12, delay: .05 }); },
  // A snare snapping shut.
  trap:    () => { noise({ dur: .03, cutoff: 3000, gain: .18, type: "highpass" }); tone({ f0: 320, dur: .04, gain: .18, type: "square" }); tone({ f0: 240, dur: .05, gain: .16, type: "square", delay: .07 }); },
  // Mystic reveal (seer's glimpse, miner's map).
  glimpse: () => { tone({ f0: 520, dur: .35, gain: .1 }); tone({ f0: 524, dur: .35, gain: .1 }); tone({ f0: 1560, dur: .1, gain: .1, delay: .18 }); },
  // Blood for a boon: a dark drop, then a bright answer.
  altar:   () => { tone({ f0: 110, f1: 70, dur: .3, gain: .3, type: "sawtooth" }); tone({ f0: 660, dur: .14, gain: .16, delay: .3 }); },
  // The stairs open into the vault: an ascending welcome.
  vault:   () => { tone({ f0: 392, dur: .12, gain: .18 }); tone({ f0: 523, dur: .16, gain: .18, delay: .11 }); tone({ f0: 880, dur: .07, gain: .12, delay: .24 }); },
};

// What each deliberate act sounds like. Results (mines, kills, chests) layer
// on top from the log; these fire even when the result is quiet.
const ITEM_SOUND = {
  probe: "dig", blast: "boom", bomb: "boom", snare: "trap",
  scroll: "glimpse", medkit: "heal", tonic: "heal",
};
const ABILITY_SOUND = {
  scout: "dig", detonate: "boom", bulwark: "block", cleave: "attack",
  dowse: "flag", transmute: "coin", glimpse: "glimpse", meditate: "heal",
};

export const playError = () => SFX.denied();

/**
 * Choose sounds for a successful state transition, layered cause-then-effect:
 *   1. the deliberate act (dig, a specific item, a specific ability, ...)
 *   2. its consequences, read from hp deltas and fresh log lines
 *   3. phase changes (vault opens, victory, death)
 * Quiet transitions (an uneventful tick) stay silent. Max 3 sounds, staggered.
 */
export function playTransition(prevSnap, next, action) {
  if (muted) return;
  chooseSounds(prevSnap, next, action)
    .forEach((s, i) => setTimeout(() => SFX[s](), i * 45));
}

/** Pure sound-selection logic, exported for testing. */
export function chooseSounds(prevSnap, next, action) {
  const newLogs = next.log.slice(prevSnap.logLen);
  const has = (s) => newLogs.some((l) => l.includes(s));
  const sounds = [];

  // 1. the act itself
  switch (action?.type) {
    case "reveal": if (!has("Mine!")) sounds.push("dig"); break; // boom covers mine digs
    case "flag": sounds.push("flag"); break;
    case "attack": sounds.push("attack"); break;
    case "useItem": sounds.push(ITEM_SOUND[action.id] ?? "dig"); break;
    case "useAbility":
      sounds.push(ABILITY_SOUND[CLASSES[next.classId]?.ability.id] ?? "dig");
      break;
    case "buy": sounds.push("buy"); break;
    case "reroll": sounds.push("reroll"); break;
    case "rest": sounds.push("heal"); break;
    case "altar": sounds.push("altar"); break;
    case "choosePath": case "continueEndless": sounds.push("descend"); break;
    default: break; // ticks and descend get their sounds from what happened
  }

  // 2. what happened as a result
  if (has("Mine!")) sounds.push("mine");
  else if (next.hp < prevSnap.hp && action?.type !== "altar") sounds.push("hurt");
  if (has("absorbed")) sounds.push("block");
  if (has("slew")) sounds.push("kill");
  if (has("Chest:")) sounds.push("chest");
  if (has("Mimic") || has("wakes up") || has("surfaces")) sounds.push("wake");
  if (has("rears back")) sounds.push("windup");
  if (has("mine stirs")) sounds.push("stir");
  if (has("shrieks") || has("roars") || has("Cracks spread")) sounds.push("enrage");
  if (has("Transmuted") || has("Interest") || has("Descended")) sounds.push("coin");
  if (next.hp > prevSnap.hp && !sounds.includes("heal")) sounds.push("heal");

  // 3. where you ended up
  if (next.phase === "dead" && prevSnap.phase !== "dead") sounds.push("dead");
  else if (next.phase === "won" && prevSnap.phase !== "won") sounds.push("win");
  else if (next.phase === "shop" && prevSnap.phase === "play") sounds.push("vault");

  return [...new Set(sounds)].slice(0, 3);
}
