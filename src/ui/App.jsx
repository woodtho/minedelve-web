import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createRun, applyAction, computeAttack, enemyAt,
  revealedSafeCount, rerollCost, priceOf, corruptionTier, attackerUids,
  STIR_GRACE, STIR_INTERVAL, WAKE_INTERVAL,
  CLASSES, ITEMS, FLOOR_TYPES,
} from "../engine/engine.js";
import {
  autosave, loadAutosave, clearAutosave,
  saveSlot, loadSlot, clearSlot, slotSummary,
  exportSave, importSave, loadMeta, saveMeta,
} from "./saves.js";
import { UNLOCKS, isUnlocked, checkUnlocks, dailySeed } from "./unlocks.js";
import { playTransition, playError, isMuted, setMuted, unlockAudio } from "./sfx.js";
import { BUILD_VERSION } from "../version.js";

const NUM_COLORS = ["", "#5aa9ff", "#5cd65c", "#ff6b6b", "#c792ea",
  "#ffd166", "#4dd0e1", "#ff9e80", "#d8d8d8"];

// Real-time heartbeat: one world turn passes every TICK_MS even if you idle.
const TICK_MS = 5000;

const hearts = (hp, maxHp) =>
  "❤️".repeat(Math.max(0, hp)) + "🖤".repeat(Math.max(0, maxHp - hp));

// =============================================================================

export default function App() {
  const [state, setState] = useState(null);
  const [screen, setScreen] = useState("title"); // title | class | game
  const [pending, setPending] = useState(null);  // {kind:"item"|"ability", id, name}
  const [uiError, setUiError] = useState("");
  const [showSaves, setShowSaves] = useState(false);
  const [meta, setMeta] = useState(loadMeta);
  const [toast, setToast] = useState("");
  const [daily, setDaily] = useState(false);
  const hasAutosave = useMemo(() => !!loadAutosave(), [screen, state]);

  const [hurtN, setHurtN] = useState(0);

  const dispatch = useCallback((action) => {
    setUiError("");
    setState((prev) => {
      const { state: next, error } = applyAction(prev, action);
      if (error) {
        setUiError(error);
        if (action.type !== "tick") playError();
        return prev;
      }
      playTransition({ phase: prev.phase, hp: prev.hp, logLen: prev.log.length }, next, action);
      if (next.hp < prev.hp) setHurtN((h) => h + 1);
      autosave(next);
      setMeta((m) => {
        let changed = false;
        let out = m;
        if (next.bestDepth > (m.bestDepth || 0)) {
          out = { ...out, bestDepth: next.bestDepth };
          changed = true;
        }
        const fresh = checkUnlocks(out, next);
        if (fresh.length) {
          out = { ...out, unlocks: { ...out.unlocks } };
          for (const id of fresh) out.unlocks[id] = true;
          setToast(`🔓 Class unlocked: ${fresh.map((id) => CLASSES[id].name).join(", ")}!`);
          changed = true;
        }
        if (changed) saveMeta(out);
        return out;
      });
      return next;
    });
  }, []);

  const newRun = (classId) => {
    const seed = daily ? dailySeed() : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const s = createRun(classId, seed);
    autosave(s);
    setState(s);
    setPending(null);
    setDaily(false);
    setScreen("game");
  };

  const continueRun = () => {
    const s = loadAutosave();
    if (s) { setState(s); setPending(null); setScreen("game"); }
  };

  // Keyboard: Escape cancels aiming.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setPending(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Browsers require a user gesture before audio can play.
  useEffect(() => {
    const un = () => unlockAudio();
    window.addEventListener("pointerdown", un, { once: true });
    return () => window.removeEventListener("pointerdown", un);
  }, []);

  // Real-time pressure: while a floor is active, the world ticks every 3s —
  // awake enemies count down and strike whether or not you move. Paused while
  // the saves menu is open.
  const [tickN, setTickN] = useState(0);
  const playing = screen === "game" && state?.phase === "play" && !showSaves;
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      dispatch({ type: "tick" });
      setTickN((n) => n + 1);
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [playing, dispatch]);

  return (
    <div className="wrap">
      {hurtN > 0 && <div className="hurtflash" key={hurtN} />}
      {toast && (
        <div className="aim toast" onClick={() => setToast("")}>{toast} (click to dismiss)</div>
      )}
      {screen === "title" && (
        <TitleScreen
          bestDepth={meta.bestDepth || 0}
          hasAutosave={hasAutosave}
          onContinue={continueRun}
          onNew={() => { setDaily(false); setScreen("class"); }}
          onDaily={() => { setDaily(true); setScreen("class"); }}
          onSaves={() => setShowSaves(true)}
        />
      )}
      {screen === "class" && (
        <ClassScreen meta={meta} daily={daily} onChoose={newRun}
          onBack={() => { setDaily(false); setScreen("title"); }} />
      )}
      {screen === "game" && state && (
        <GameScreen
          state={state}
          dispatch={dispatch}
          pending={pending}
          setPending={setPending}
          tickN={tickN}
          hurtN={hurtN}
          uiError={uiError}
          bestDepth={Math.max(meta.bestDepth || 0, state.bestDepth)}
          onNewRun={() => { clearAutosave(); setScreen("class"); }}
          onSaves={() => setShowSaves(true)}
        />
      )}
      {showSaves && (
        <SavesModal
          state={state}
          onLoad={(s) => { setState(s); autosave(s); setPending(null); setScreen("game"); setShowSaves(false); }}
          onClose={() => setShowSaves(false)}
        />
      )}
    </div>
  );
}

// ---- title / class ----------------------------------------------------------

function TitleScreen({ bestDepth, hasAutosave, onContinue, onNew, onDaily, onSaves }) {
  return (
    <div className="panel">
      <div className="title">MINEDELVE</div>
      <div className="subtitle">a minesweeper roguelite</div>
      <div className="build">build {BUILD_VERSION}</div>
      <p>
        Descend through a cursed mine. Every floor is a minefield — but mines cost
        hearts, not your run. Pick a class, fight what wakes in the dark, choose
        your path down, survive the boss floors, and escape the deep.
      </p>
      <div className="how">
        <p>• <b>Classes</b> — eight delvers, each with a kit and a once-per-floor ability.</p>
        <p>• <b>Dig</b> safe tiles for gold; numbers count adjacent mines.</p>
        <p>• <b>Mines</b> cost hearts. Lose them all and the run ends.</p>
        <p>• <b>Enemies</b> sleep under the tiles. Revealed, they wake — and strike on a timer. Click them to fight back.</p>
        <p>• <b>Chests</b> hide in the rubble — gold, items, even relics.</p>
        <p>• <b>Paths</b> — choose each descent: safe tunnels, rich veins, broodnests, or deadly gauntlets.</p>
        <p>• <b>Bosses</b> guard every 5th floor and must die before you can descend. Clear floor 10 to escape — then delve endlessly.</p>
      </div>
      {bestDepth > 0 && <p>Deepest run so far: floor {bestDepth}.</p>}
      <div className="shop-actions">
        {hasAutosave && <button className="big" onClick={onContinue}>⏬ Continue run</button>}
        <button className={hasAutosave ? "btn" : "big"} onClick={onNew}>Enter the mine</button>
        <button className="btn" onClick={onDaily} title="A fixed seed shared by everyone today — compare runs!">
          📅 Daily delve
        </button>
        <button className="btn" onClick={onSaves}>💾 Saves</button>
        <MuteBtn />
      </div>
    </div>
  );
}

function ClassScreen({ meta, daily, onChoose, onBack }) {
  return (
    <div className="panel wide">
      <div className="title">CHOOSE YOUR DELVER</div>
      <div className="subtitle">
        each class changes the whole run — stats, starting kit, and a once-per-floor ability
      </div>
      {daily && (
        <div className="aim">📅 Daily delve — everyone gets the same mine today (seed #{dailySeed()}).</div>
      )}
      <div className="cards">
        {Object.values(CLASSES).map((cm) => {
          const unlocked = isUnlocked(meta, cm.id);
          const kit = [];
          if (cm.gold > 0) kit.push(`${cm.gold}g`);
          for (const [id, n] of Object.entries(cm.items)) if (n > 0) kit.push(`${n}× ${ITEMS[id].name}`);
          for (const [id, n] of Object.entries(cm.relics)) if (n > 0) kit.push(ITEMS[id].name);
          return (
            <div className={`card classcard${unlocked ? "" : " dim"}`} key={cm.id}>
              <div className="card-ic">{unlocked ? cm.icon : "🔒"}</div>
              <div className="card-nm">{cm.name}</div>
              <div className="stat-tag">
                ❤️ ×{cm.hp} · ⚔️ {cm.attack} · {kit.length ? kit.join(" · ") : "bare hands"}
              </div>
              <div className="card-ds tall">{cm.blurb}</div>
              <div className="card-ds">
                <b>{cm.ability.icon} {cm.ability.name}</b> — {cm.ability.desc}
              </div>
              {unlocked ? (
                <button className="buy" onClick={() => onChoose(cm.id)}>Choose</button>
              ) : (
                <div className="card-ds locked">🔒 {UNLOCKS[cm.id]?.desc}</div>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn" onClick={onBack}>← Back</button>
    </div>
  );
}

// ---- main game screen -------------------------------------------------------

function GameScreen(props) {
  const { state } = props;
  switch (state.phase) {
    case "play": return <PlayScreen {...props} />;
    case "shop": return <ShopScreen {...props} />;
    case "dead": return <EndScreen {...props} won={false} />;
    case "won": return <EndScreen {...props} won={true} />;
    default: return null;
  }
}

function MuteBtn() {
  const [m, setM] = useState(isMuted());
  return (
    <button
      className="btn" title={m ? "Sound off — click to unmute" : "Sound on — click to mute"}
      onClick={() => { setMuted(!m); setM(!m); if (m) unlockAudio(); }}
    >
      {m ? "🔇" : "🔊"}
    </button>
  );
}

// Gold readout with floating "+N" popups on gains.
function GoldStat({ gold }) {
  const prev = React.useRef(gold);
  const [floats, setFloats] = useState([]);
  useEffect(() => {
    const d = gold - prev.current;
    prev.current = gold;
    if (d > 0) {
      const id = Math.random();
      setFloats((f) => [...f, { id, d }]);
      const t = setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 950);
      return () => clearTimeout(t);
    }
  }, [gold]);
  return (
    <div className="stat goldstat">
      🪙 <b>{gold}</b>
      {floats.map((f) => <span className="goldfloat" key={f.id}>+{f.d}</span>)}
    </div>
  );
}

function Hud({ state, bestDepth }) {
  const b = state.board;
  const ft = FLOOR_TYPES[state.floorType];
  const cls = CLASSES[state.classId];
  const minesLeft = b.mines - b.flagged.reduce((a, x) => a + x, 0);
  const rs = revealedSafeCount(b);
  return (
    <>
      <div className="title">MINEDELVE</div>
      <div className="subtitle">
        {cls.icon} {cls.name} · deepest run: floor {bestDepth} · build {BUILD_VERSION}
      </div>
      <div className="hud">
        <div className="stat" style={{ borderColor: ft.accent }}>
          <span>{ft.icon}</span> <b>{ft.name}</b>
        </div>
        <div className="stat">Floor <b>{state.floor}</b></div>
        <div className="stat"><span className="hearts">{hearts(state.hp, state.maxHp)}</span></div>
        <GoldStat gold={state.gold} />
        <div className="stat">⚔️ <b>{computeAttack(state)}</b></div>
        <div className="stat">💣 <b>{minesLeft}</b></div>
        <div className="stat">Stairs <b>{rs} / {b.quota}</b></div>
        {corruptionTier(state.floor) > 0 && (
          <div className="stat" style={{ borderColor: "#8a4a5a" }}
            title="Endless corruption: more enemies, tougher lurkers, meaner mines.">
            ☠️ <b>{corruptionTier(state.floor)}</b>
          </div>
        )}
      </div>
    </>
  );
}

function PlayScreen({ state, dispatch, pending, setPending, tickN, hurtN, uiError, bestDepth, onSaves }) {
  const b = state.board;
  const cls = CLASSES[state.classId];
  const rs = revealedSafeCount(b);
  const need = Math.max(0, b.quota - rs);
  const bossUp = state.enemies.some((e) => e.boss && e.hp > 0);
  // Touch devices have no shift/right-click: a sticky dig/flag mode toggle.
  const [flagMode, setFlagMode] = useState(false);
  const [info, setInfo] = useState("");

  const clickCell = (e, r, c) => {
    e.preventDefault();
    setInfo("");
    const flagGesture = e.type === "contextmenu" || e.shiftKey;
    if (pending) {
      if (flagGesture) { setPending(null); return; }
      if (pending.kind === "item") dispatch({ type: "useItem", id: pending.id, r, c });
      else dispatch({ type: "useAbility", r, c });
      setPending(null);
      return;
    }
    const i = r * b.cols + c;
    if (b.revealed[i]) {
      if (enemyAt(state, r, c)) dispatch({ type: "attack", r, c });
      return;
    }
    dispatch({ type: flagGesture || flagMode ? "flag" : "reveal", r, c });
  };

  const useItem = (id) => {
    const m = ITEMS[id];
    if (m.target) setPending({ kind: "item", id, name: m.name });
    else dispatch({ type: "useItem", id });
  };
  const useAbility = () => {
    if (cls.ability.target) setPending({ kind: "ability", id: cls.ability.id, name: cls.ability.name });
    else dispatch({ type: "useAbility" });
  };

  const ownedRelics = Object.entries(state.relics).filter(([, n]) => n > 0);

  const revealedEnemies = state.enemies.filter(
    (e) => e.hp > 0 && b.revealed[e.r * b.cols + e.c]
  );

  return (
    <>
      <Hud state={state} bestDepth={bestDepth} />
      <div className="tickrow" title="The mine advances on its own — each time the bar empties, one turn passes even if you don't move.">
        <div className="tickbar">
          <div className="tickfill" key={tickN} style={{ animationDuration: `${TICK_MS}ms` }} />
        </div>
        <span className="ticklabel">
          {need === 0
            ? `⚠️ stirs in ${state.stir < STIR_GRACE
                ? STIR_GRACE - state.stir
                : STIR_INTERVAL - ((state.stir - STIR_GRACE) % STIR_INTERVAL)}`
            : `🕯️ wakes in ${WAKE_INTERVAL - (state.turn % WAKE_INTERVAL)}`}
        </span>
      </div>
      <div className="items">
        <button
          className={`item-btn mode${flagMode ? " active" : ""}`}
          title="Toggle between digging and flagging (or shift/right-click to flag)"
          onClick={() => setFlagMode((f) => !f)}
        >
          {flagMode ? "🚩 Flagging" : "⛏️ Digging"}
        </button>
        {pending && (
          <button className="btn" onClick={() => setPending(null)}>✖ Cancel aim</button>
        )}
        <MuteBtn />
        <button className="btn" onClick={onSaves}>💾</button>
      </div>
      <ItemHand state={state} onUseItem={useItem} onUseAbility={useAbility} />
      <div className="relics">
        {ownedRelics.map(([id, n]) => (
          <span
            className="relic" key={id} title={`${ITEMS[id].name} — ${ITEMS[id].desc}`}
            onClick={() => setInfo(`${ITEMS[id].icon} ${ITEMS[id].name} — ${ITEMS[id].desc}`)}
          >
            {ITEMS[id].icon}{n > 1 ? ` ×${n}` : ""}
          </span>
        ))}
        {state.shieldCharges > 0 && <span className="relic shield">🧱 shield ×{state.shieldCharges}</span>}
      </div>
      {info && <div className="msg info" onClick={() => setInfo("")}>{info}</div>}
      {revealedEnemies.length > 0 && (
        <div className="enemy-strip">
          {(() => {
            const active = attackerUids(state);
            return revealedEnemies.map((e) => {
              const status = e.stun > 0 ? `💫 stunned ${e.stun}`
                : e.winding ? "⚡ STRIKES NEXT"
                : !active.has(e.uid) ? "… lurking"
                : `hits ${e.dmg} in ${e.cd + 1}`;
              return (
                <button
                  className={`foe${e.boss ? " boss" : ""}${e.winding ? " windup" : ""}`}
                  key={e.uid}
                  title={e.winding && !e.boss
                    ? `Attack to interrupt the ${e.name}'s strike`
                    : `Attack the ${e.name} for ${computeAttack(state)} damage`}
                  onClick={() => dispatch({ type: "attack", r: e.r, c: e.c })}
                >
                  ⚔️ {e.icon} {e.name} {e.hp}/{e.maxHp} · {status}
                  {e.enraged ? " 😤" : ""}
                </button>
              );
            });
          })()}
        </div>
      )}
      {pending && (
        <div className="aim">Aiming {pending.name} — click a tile (right-click or Esc to cancel).</div>
      )}
      <div className="msg">{uiError || state.msg}</div>
      <div
        className="board-frame"
        style={hurtN ? { animation: `${hurtN % 2 ? "shakeA" : "shakeB"} 0.35s` } : undefined}
      >
        <div
          className="grid"
          style={{ "--cols": b.cols, gridTemplateColumns: `repeat(${b.cols}, var(--cell))` }}
>
          {Array.from({ length: b.rows * b.cols }, (_, i) => {
            const r = Math.floor(i / b.cols), c = i % b.cols;
            return <Cell key={i} state={state} r={r} c={c} onClick={clickCell} />;
          })}
        </div>
      </div>
      <div className="legend">
        Tap to dig (toggle 🚩 to flag) · Shift/right-click also flags ·
        Attack via the ⚔️ buttons or by tapping an enemy tile
      </div>
      {need === 0 ? (
        <>
          {bossUp ? (
            <div className="need">👑 The stairs are open, but the boss still lives. Kill it to descend.</div>
          ) : (
            <div className="descend-row">
              <button className="descend" onClick={() => dispatch({ type: "descend" })}>⏬ Descend</button>
            </div>
          )}
          <div className="need stir">⚠️ The mine stirs — linger and more will wake.</div>
        </>
      ) : (
        <div className="need">Clear {need} more safe tile{need === 1 ? "" : "s"} to open the stairs.</div>
      )}
      <LogPanel log={state.log} />
    </>
  );
}

// Items and the class ability as a fanned hand of cards. Browse by arrows,
// tapping a side card, mouse wheel, or touch swipe; the centered card can be
// used (unless readOnly, e.g. when reviewing your hand in the vault).
function ItemHand({ state, onUseItem, onUseAbility, readOnly = false }) {
  const cls = CLASSES[state.classId];
  const itemIds = Object.keys(ITEMS).filter(
    (id) => ITEMS[id].kind === "item" && (state.items[id] || 0) > 0
  );
  const cards = [
    {
      key: "ability", kind: "ability", icon: cls.ability.icon, name: cls.ability.name,
      count: readOnly ? cls.ability.charges : state.abilityCharges, desc: cls.ability.desc,
    },
    ...itemIds.map((id) => ({
      key: `item-${id}`, kind: "item", id, icon: ITEMS[id].icon, name: ITEMS[id].name,
      count: state.items[id], desc: ITEMS[id].desc,
    })),
  ];
  const [act, setAct] = useState(0);
  useEffect(() => {
    if (act >= cards.length) setAct(Math.max(0, cards.length - 1));
  }, [cards.length, act]);
  const cycle = (d) => setAct((a) => (a + d + cards.length) % cards.length);

  // Side-scroll the hand: mouse wheel (throttled) and touch/drag swipe.
  const lastWheel = React.useRef(0);
  const swipe = React.useRef({ x: null, moved: false });
  const onWheel = (e) => {
    const now = Date.now();
    if (now - lastWheel.current < 160) return;
    lastWheel.current = now;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (d !== 0) cycle(d > 0 ? 1 : -1);
  };
  const onPointerDown = (e) => { swipe.current = { x: e.clientX, moved: false }; };
  const onPointerUp = (e) => {
    const s = swipe.current;
    if (s.x == null) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 30) {
      swipe.current.moved = true;
      cycle(dx < 0 ? 1 : -1);
    }
    swipe.current.x = null;
  };

  return (
    <div
      className="hand"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {cards.length > 1 && (
        <button className="hand-arrow left" onClick={() => cycle(-1)}>‹</button>
      )}
      {cards.map((c, i) => {
        const off = i - act;
        const hidden = Math.abs(off) > 3;
        return (
          <div
            key={c.key}
            className={
              `hand-card${i === act ? " active" : ""}` +
              `${c.kind === "ability" ? " abilitycard" : ""}` +
              `${c.count <= 0 ? " spent" : ""}`
            }
            style={{
              transform: `translateX(${off * 74}px) rotate(${off * 4}deg) scale(${i === act ? 1 : 0.82})`,
              zIndex: 20 - Math.abs(off),
              opacity: hidden ? 0 : 1,
              pointerEvents: hidden ? "none" : "auto",
            }}
            onClick={() => {
              if (swipe.current.moved) { swipe.current.moved = false; return; }
              if (i !== act) setAct(i);
            }}
          >
            <div className="hc-ic">{c.icon}</div>
            <div className="hc-nm">{c.name}</div>
            <div className="hc-ct">×{c.count}</div>
            <div className="hc-ds">{c.desc}</div>
            {i === act && !readOnly && (
              <button
                className="buy hc-use" disabled={c.count <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (swipe.current.moved) { swipe.current.moved = false; return; }
                  if (c.kind === "ability") onUseAbility();
                  else onUseItem(c.id);
                }}
              >
                Use
              </button>
            )}
          </div>
        );
      })}
      {cards.length > 1 && (
        <button className="hand-arrow right" onClick={() => cycle(1)}>›</button>
      )}
    </div>
  );
}

function Cell({ state, r, c, onClick }) {
  const b = state.board;
  const i = r * b.cols + c;
  let cls = "cell";
  let content = " ";
  let style = {};
  const enemy = b.revealed[i] ? enemyAt(state, r, c) : null;

  if (enemy) {
    cls += enemy.boss ? " enemy boss" : " enemy";
    if (enemy.winding) cls += " windup";
    content = (
      <span className="enemy-wrap" title={`${enemy.name} — ${enemy.hp}/${enemy.maxHp} hp, hits for ${enemy.dmg}.${enemy.winding ? " Winding up — strikes next turn!" : ""}`}>
        <span className="enemy-ic">{enemy.icon}</span>
        <span className="enemy-hp">{enemy.hp}</span>
        {enemy.stun > 0 && <span className="enemy-stun">💫</span>}
        {enemy.winding && <span className="enemy-warn">⚡</span>}
      </span>
    );
  } else if (b.revealed[i]) {
    if (b.mine[i]) {
      cls += b.exploded[i] ? " boom" : " minecell";
      content = "💣";
    } else {
      cls += " open";
      if (b.chestOpen[i]) cls += " chest";
      if (b.adj[i] > 0) {
        content = String(b.adj[i]);
        style = { color: NUM_COLORS[b.adj[i]] };
      }
    }
  } else if (b.flagged[i]) {
    cls += " flag";
    content = "🚩";
  }

  return (
    <button
      className={cls}
      style={style}
      onClick={(e) => onClick(e, r, c)}
      onContextMenu={(e) => onClick(e, r, c)}
    >
      {content}
    </button>
  );
}

function LogPanel({ log }) {
  return (
    <div className="logpanel">
      {log.slice(-6).map((line, i) => <div key={i} className="logline">{line}</div>)}
    </div>
  );
}

// ---- shop -------------------------------------------------------------------

function ShopScreen({ state, dispatch, uiError, bestDepth, onSaves }) {
  return (
    <div className="panel wide">
      <h2>THE VAULT</h2>
      <p>
        Floor {state.floor} cleared. You carry {hearts(state.hp, state.maxHp)} and {state.gold} gold.
      </p>
      <div className="msg">{uiError || state.msg}</div>
      <div className="cards">
        {state.shop.map((id, slot) => {
          if (!id) return <div className="card sold" key={slot}>Sold</div>;
          const m = ITEMS[id];
          const price = priceOf(state, id);
          const owned = m.kind === "relic" && m.unique && (state.relics[id] || 0) > 0;
          const afford = state.gold >= price && !owned;
          return (
            <div className={`card${afford ? "" : " dim"}`} key={slot}>
              <div className="card-ic">{m.icon}</div>
              <div className="card-nm">{m.name}</div>
              <div className="card-ds tall">{m.desc}</div>
              <div className="card-pr">{price}g</div>
              <button className="buy" disabled={!afford} onClick={() => dispatch({ type: "buy", slot })}>
                {owned ? "Owned" : "Buy"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="shop-actions">
        <button className="btn" disabled={state.hp >= state.maxHp}
          onClick={() => dispatch({ type: "rest" })}>➕ Rest — heal 1 (12g)</button>
        <button className="btn" onClick={() => dispatch({ type: "reroll" })}>
          🎲 Reroll shop ({rerollCost(state)}g)
        </button>
        <button className="btn" disabled={state.altarUsed || state.hp < 2}
          onClick={() => dispatch({ type: "altar" })}>
          {state.altarUsed ? "🩸 Altar spent" : "🩸 Blood Altar — 1 heart → relic"}
        </button>
        <MuteBtn />
        <button className="btn" onClick={onSaves}>💾 Saves</button>
      </div>
      <div className="vdiv" />
      <div className="section">Your hand</div>
      <ItemHand state={state} readOnly />
      <div className="vdiv" />
      <div className="section">Choose your descent</div>
      <div className="paths">
        {state.paths.map((key, index) => {
          const ft = FLOOR_TYPES[key];
          return (
            <button className="path" key={index} style={{ borderLeftColor: ft.accent }}
              onClick={() => dispatch({ type: "choosePath", index })}>
              <div className="pn">{ft.icon} {ft.name}</div>
              <div className="pd">{ft.desc}</div>
              <div>
                {ft.gold > 1 && <span className="tag gold">+{Math.round((ft.gold - 1) * 100)}% gold</span>}
                {ft.dmg > 1 && <span className="tag danger">mines hit for {ft.dmg}</span>}
                {ft.enemyMult > 1 && <span className="tag danger">crawling with enemies</span>}
                {ft.relic && <span className="tag relic">relic reward</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- end screens ------------------------------------------------------------

function EndScreen({ state, dispatch, won, bestDepth, onNewRun }) {
  const cls = CLASSES[state.classId];
  const ownedRelics = Object.entries(state.relics).filter(([, n]) => n > 0);
  const st = state.stats;
  return (
    <div className="panel">
      <h2>{won ? "🏆 YOU ESCAPED THE MINE" : "YOU FELL"}</h2>
      <p>
        {won
          ? `The ${cls.name} conquered the Warren's Heart on floor ${state.floor} and climbed back to daylight.`
          : `The mine claimed the ${cls.name} on floor ${state.floor}.`}
      </p>
      <p>Gold: {state.gold} · Deepest run: floor {bestDepth}</p>
      <p className="statline">
        {st.tilesRevealed} tiles dug · {st.enemiesSlain} enemies slain · {st.minesHit} mines hit ·{" "}
        {st.chestsOpened} chests · {st.goldEarned} gold earned
      </p>
      <p>
        Relics carried:<br />
        {ownedRelics.length
          ? ownedRelics.map(([id, n]) => `${ITEMS[id].icon} ${ITEMS[id].name}${n > 1 ? ` ×${n}` : ""}`).join("   ")
          : "— none —"}
      </p>
      <div className="shop-actions">
        {won && (
          <button className="btn" onClick={() => dispatch({ type: "continueEndless" })}>
            ⏬ Keep delving (endless)
          </button>
        )}
        <button className="big" onClick={onNewRun}>{won ? "New run" : "Delve again"}</button>
      </div>
    </div>
  );
}

// ---- save modal -------------------------------------------------------------

function SavesModal({ state, onLoad, onClose }) {
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const [exportText, setExportText] = useState("");

  const doLoad = (n) => {
    const s = loadSlot(n);
    if (s) onLoad(s);
    else setMsg("That slot is empty or incompatible.");
  };
  const doImport = () => {
    try {
      onLoad(importSave(importText));
    } catch (e) {
      setMsg(`Import failed: ${e.message}`);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>💾 SAVES</h2>
        <div className="msg">{msg}</div>
        {[1, 2, 3].map((n) => {
          const sum = slotSummary(n);
          return (
            <div className="slot-row" key={n}>
              <span className="slot-desc">
                Slot {n}:{" "}
                {sum
                  ? `${CLASSES[sum.classId]?.icon ?? "?"} floor ${sum.floor} · ${sum.hp}/${sum.maxHp} hp · ${sum.gold}g (${sum.phase})`
                  : "— empty —"}
              </span>
              <span className="slot-btns">
                <button className="btn" disabled={!state} onClick={() => { saveSlot(n, state); setMsg(`Saved to slot ${n}.`); }}>Save</button>
                <button className="btn" disabled={!sum} onClick={() => doLoad(n)}>Load</button>
                <button className="btn" disabled={!sum} onClick={() => { clearSlot(n); setMsg(`Cleared slot ${n}.`); }}>✕</button>
              </span>
            </div>
          );
        })}
        <div className="vdiv" />
        <div className="section">Export / import (runs are plain JSON)</div>
        <div className="shop-actions">
          <button className="btn" disabled={!state} onClick={() => setExportText(exportSave(state))}>
            Export current run
          </button>
          {exportText && (
            <button className="btn" onClick={() => navigator.clipboard?.writeText(exportText).then(() => setMsg("Copied."))}>
              Copy to clipboard
            </button>
          )}
        </div>
        {exportText && <textarea className="savebox" readOnly value={exportText} />}
        <textarea
          className="savebox" placeholder="Paste a save JSON here to import..."
          value={importText} onChange={(e) => setImportText(e.target.value)}
        />
        <div className="shop-actions">
          <button className="btn" disabled={!importText.trim()} onClick={doImport}>Import</button>
          <button className="big" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
