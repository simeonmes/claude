"use strict";
// Input: keyboard (one or two players), gamepads, and Sideswipe-style touch controls
// (virtual stick on the left, Jump and Boost buttons on the right). Every source is
// reduced to the same per-player frame: { sx, sy, jump, boost, rollL, rollR }.
// Air roll is a held double-tap on the stick direction, like the mobile game; keyboard
// and gamepad players also get dedicated roll keys.

const DOUBLE_TAP_MS = 260;

const KEYMAPS = {
  solo: {
    up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
    jump: ["Space", "KeyK", "KeyZ"], boost: ["ShiftLeft", "ShiftRight", "KeyJ", "KeyX"], rollL: ["KeyQ"], rollR: ["KeyE"],
  },
  p1: {
    up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"],
    jump: ["Space"], boost: ["ShiftLeft"], rollL: ["KeyQ"], rollR: ["KeyE"],
  },
  p2: {
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
    jump: ["Enter", "Period", "Numpad0"], boost: ["ShiftRight", "Slash", "NumpadDecimal"], rollL: ["Comma"], rollR: ["Semicolon"],
  },
};

const Input = (() => {
  const down = new Set();
  const tapped = new Set(); // fresh keydowns not yet seen by a physics step (catches very short taps)
  const lastTap = {};   // code -> timestamp of last fresh keydown
  const rollLatch = {}; // code -> true while a double-tapped direction key stays held
  const BLOCK = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Slash", "Period", "Enter"]);

  window.addEventListener("keydown", (e) => {
    if (BLOCK.has(e.code) && Input.captureKeys) e.preventDefault();
    if (!e.repeat) {
      const now = performance.now();
      if (lastTap[e.code] && now - lastTap[e.code] < DOUBLE_TAP_MS) rollLatch[e.code] = true;
      lastTap[e.code] = now;
      tapped.add(e.code);
    }
    down.add(e.code);
  });
  window.addEventListener("keyup", (e) => {
    down.delete(e.code);
    rollLatch[e.code] = false;
  });
  window.addEventListener("blur", () => {
    down.clear();
    for (const k in rollLatch) rollLatch[k] = false;
  });

  const any = (codes) => codes.some((c) => down.has(c));
  const anyLatched = (codes) => codes.some((c) => rollLatch[c] && down.has(c));
  const consumeTap = (codes) => {
    let hit = false;
    for (const c of codes) if (tapped.delete(c)) hit = true;
    return hit;
  };

  function fromKeys(map) {
    let sx = (any(map.right) ? 1 : 0) - (any(map.left) ? 1 : 0);
    let sy = (any(map.down) ? 1 : 0) - (any(map.up) ? 1 : 0);
    if (sx && sy) { sx *= Math.SQRT1_2; sy *= Math.SQRT1_2; }
    return {
      sx, sy,
      jump: consumeTap(map.jump) || any(map.jump),
      boost: any(map.boost),
      rollL: any(map.rollL) || anyLatched(map.left),
      rollR: any(map.rollR) || anyLatched(map.right),
    };
  }

  // --- Gamepads ---------------------------------------------------------------
  const padTap = {}; // per pad: last time stick crossed into a horizontal direction, and latch
  function fromPad(index) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && pads[index];
    if (!p || !p.connected) return null;
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    let sx = p.axes[0] || 0, sy = p.axes[1] || 0;
    if (b(14)) sx = -1; if (b(15)) sx = 1; if (b(12)) sy = -1; if (b(13)) sy = 1;
    const mag = Math.hypot(sx, sy);
    if (mag < 0.25) { sx = 0; sy = 0; } else if (mag > 1) { sx /= mag; sy /= mag; }

    const st = padTap[index] || (padTap[index] = { dir: 0, t: 0, latch: 0 });
    const dir = sx > 0.6 ? 1 : sx < -0.6 ? -1 : 0;
    const now = performance.now();
    if (dir !== 0 && st.dir === 0) {
      st.latch = st.lastDir === dir && now - st.t < DOUBLE_TAP_MS ? dir : 0;
      st.t = now; st.lastDir = dir;
    }
    if (dir === 0) st.latch = 0;
    st.dir = dir;

    return {
      sx, sy,
      jump: b(0),
      boost: b(1) || b(7) || b(5),
      rollL: b(4) || (b(2) && sx < 0) || st.latch < 0,
      rollR: (b(2) && sx >= 0) || st.latch > 0,
      any: b(0) || b(1) || b(2) || b(9) || mag > 0.5,
      start: b(9),
    };
  }

  // --- Touch -----------------------------------------------------------------
  const touch = {
    enabled: false,
    stickId: null, baseX: 0, baseY: 0, knobX: 0, knobY: 0, sx: 0, sy: 0,
    jumpId: null, boostId: null,
    lastRelease: 0, lastReleaseDir: 0, pendingRoll: false, roll: 0,
    radius: 60,
  };

  function layoutButtons(w, h) {
    const m = Math.min(w, h);
    const r = Math.max(34, Math.min(62, m * 0.11));
    touch.radius = Math.max(46, Math.min(80, m * 0.15));
    touch.jumpBtn = { x: w - r * 1.55, y: h - r * 1.55, r: r * 1.12 };
    touch.boostBtn = { x: w - r * 3.85, y: h - r * 1.15, r: r * 0.95 };
    touch.pauseBtn = { x: 34, y: 34, r: 22 };
  }

  function inCircle(btn, x, y, pad = 1.25) {
    return btn && Math.hypot(x - btn.x, y - btn.y) < btn.r * pad;
  }

  function attachTouch(el, onPause) {
    const opts = { passive: false };
    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      touch.enabled = true;
      Input.onFirstTouch && Input.onFirstTouch();
      const rect = el.getBoundingClientRect();
      for (const t of e.changedTouches) {
        const x = t.clientX - rect.left, y = t.clientY - rect.top;
        if (inCircle(touch.pauseBtn, x, y, 1.6)) { onPause && onPause(); continue; }
        if (touch.jumpId === null && inCircle(touch.jumpBtn, x, y)) { touch.jumpId = t.identifier; touch.jumpTap = true; continue; }
        if (touch.boostId === null && inCircle(touch.boostBtn, x, y)) { touch.boostId = t.identifier; continue; }
        if (touch.stickId === null && x < rect.width * 0.5) {
          touch.stickId = t.identifier;
          touch.baseX = touch.knobX = x;
          touch.baseY = touch.knobY = y;
          touch.sx = touch.sy = 0;
          touch.pendingRoll = performance.now() - touch.lastRelease < DOUBLE_TAP_MS + 60;
          touch.roll = 0;
        } else if (touch.jumpId === null && x >= rect.width * 0.5) {
          // Anywhere else on the right half counts as jump, so thumbs don't need precision.
          touch.jumpId = t.identifier;
          touch.jumpTap = true;
        }
      }
    }, opts);

    el.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      for (const t of e.changedTouches) {
        if (t.identifier !== touch.stickId) continue;
        const x = t.clientX - rect.left, y = t.clientY - rect.top;
        let dx = x - touch.baseX, dy = y - touch.baseY;
        const d = Math.hypot(dx, dy), R = touch.radius;
        if (d > R) {
          // Let the base trail the finger so the stick never "runs out".
          touch.baseX += (dx / d) * (d - R);
          touch.baseY += (dy / d) * (d - R);
          dx = x - touch.baseX; dy = y - touch.baseY;
        }
        touch.knobX = x; touch.knobY = y;
        const m = Math.hypot(dx, dy) / R;
        if (m < 0.22) { touch.sx = 0; touch.sy = 0; } else { touch.sx = dx / R; touch.sy = dy / R; }
        if (touch.pendingRoll && Math.abs(touch.sx) > 0.5) {
          const dir = Math.sign(touch.sx);
          if (dir === touch.lastReleaseDir) touch.roll = dir;
          touch.pendingRoll = false;
        }
      }
    }, opts);

    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === touch.stickId) {
          touch.lastRelease = performance.now();
          touch.lastReleaseDir = Math.abs(touch.sx) > 0.4 ? Math.sign(touch.sx) : 0;
          touch.stickId = null; touch.sx = touch.sy = 0; touch.roll = 0; touch.pendingRoll = false;
        }
        if (t.identifier === touch.jumpId) touch.jumpId = null;
        if (t.identifier === touch.boostId) touch.boostId = null;
      }
    };
    el.addEventListener("touchend", end, opts);
    el.addEventListener("touchcancel", end, opts);
  }

  function fromTouch() {
    if (!touch.enabled) return null;
    const m = Math.hypot(touch.sx, touch.sy);
    const k = m > 1 ? 1 / m : 1;
    const tap = touch.jumpTap;
    touch.jumpTap = false;
    return {
      sx: touch.sx * k, sy: touch.sy * k,
      jump: tap || touch.jumpId !== null,
      boost: touch.boostId !== null,
      rollL: touch.roll < 0, rollR: touch.roll > 0,
    };
  }

  function merge(a, b) {
    if (!b) return a;
    const useB = Math.hypot(b.sx, b.sy) > Math.hypot(a.sx, a.sy);
    return {
      sx: useB ? b.sx : a.sx, sy: useB ? b.sy : a.sy,
      jump: a.jump || b.jump, boost: a.boost || b.boost,
      rollL: a.rollL || b.rollL, rollR: a.rollR || b.rollR,
    };
  }

  // Player 0 is the local main player; player 1 is the second local player in 2P mode.
  function read(playerIndex, twoPlayer) {
    if (!twoPlayer) {
      let inp = fromKeys(KEYMAPS.solo);
      inp = merge(inp, fromTouch());
      inp = merge(inp, fromPad(0));
      return inp;
    }
    if (playerIndex === 0) return merge(fromKeys(KEYMAPS.p1), fromPad(1));
    return merge(fromKeys(KEYMAPS.p2), fromPad(0));
  }

  return {
    captureKeys: false,
    touch,
    read,
    attachTouch,
    layoutButtons,
    isDown: (code) => down.has(code),
    clearTaps: () => { tapped.clear(); touch.jumpTap = false; },
    pad: fromPad,
    onFirstTouch: null,
  };
})();
