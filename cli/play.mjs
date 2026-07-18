#!/usr/bin/env node
// =============================================================================
// MINEDELVE CLI — play the full game over line-delimited JSON (stdin/stdout).
// Designed so an LLM (or any program) can play and optimize the game without
// a browser. Every response is a single JSON line.
//
//   npm run play          (or: node cli/play.mjs)
//
// Commands (one JSON object per line):
//   {"cmd":"new","classId":"delver","seed":42}   start a run (seed optional)
//   {"cmd":"act","action":{"type":"reveal","r":4,"c":5}}   play an action
//   {"cmd":"observe"}                            current observation
//   {"cmd":"legal"}                              currently legal actions
//   {"cmd":"save"}                               full state JSON (a save file)
//   {"cmd":"load","state":{...}}                 restore a saved state
//   {"cmd":"content"}                            list classes/items/enemies
//   {"cmd":"quit"}
//
// See docs/LLM_PLAY.md for the full protocol and action reference.
// =============================================================================

import readline from "node:readline";
import {
  createRun, applyAction, serialize, deserialize,
  CLASSES, ITEMS, ENEMIES, BOSSES, FLOOR_TYPES,
} from "../src/engine/engine.js";
import { observe, legalActions } from "../src/engine/observe.js";

let state = null;

const print = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

function requireState() {
  if (!state) {
    print({ error: 'No run in progress. Send {"cmd":"new","classId":"delver"} first.' });
    return false;
  }
  return true;
}

function handle(line) {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return print({ error: "Invalid JSON." });
  }

  switch (cmd.cmd) {
    case "new": {
      const classId = cmd.classId ?? "delver";
      if (!CLASSES[classId])
        return print({ error: `Unknown classId. One of: ${Object.keys(CLASSES).join(", ")}` });
      state = createRun(classId, cmd.seed ?? Date.now());
      return print({ ok: true, observation: observe(state), legal: legalActions(state) });
    }
    case "act": {
      if (!requireState()) return;
      const { state: next, error } = applyAction(state, cmd.action);
      state = next;
      return print({
        ok: !error,
        ...(error ? { error } : {}),
        observation: observe(state),
        legal: legalActions(state),
      });
    }
    case "observe":
      if (!requireState()) return;
      return print({ ok: true, observation: observe(state) });
    case "legal":
      if (!requireState()) return;
      return print({ ok: true, legal: legalActions(state) });
    case "save":
      if (!requireState()) return;
      return print({ ok: true, state: JSON.parse(serialize(state)) });
    case "load":
      try {
        state = deserialize(cmd.state);
        return print({ ok: true, observation: observe(state), legal: legalActions(state) });
      } catch (e) {
        return print({ error: `Load failed: ${e.message}` });
      }
    case "content":
      return print({
        ok: true,
        classes: Object.values(CLASSES).map(({ id, name, hp, gold, attack, blurb, ability }) => ({
          id, name, hp, gold, attack, blurb,
          ability: { id: ability.id, name: ability.name, desc: ability.desc },
        })),
        items: Object.values(ITEMS).map(({ id, name, kind, price, unique, desc }) => ({
          id, name, kind, price, unique: !!unique, desc,
        })),
        enemies: Object.values(ENEMIES),
        bosses: Object.values(BOSSES),
        floorTypes: Object.values(FLOOR_TYPES).map(({ key, name, desc, gold, dmg }) => ({
          key, name, desc, goldMult: gold, mineDamage: dmg,
        })),
      });
    case "quit":
      print({ ok: true, bye: true });
      return process.exit(0);
    default:
      return print({ error: `Unknown cmd: ${cmd.cmd}` });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (line.trim()) handle(line.trim());
});
print({ ok: true, hello: "minedelve", hint: 'Send {"cmd":"new","classId":"delver","seed":42} to begin. {"cmd":"content"} lists everything.' });
