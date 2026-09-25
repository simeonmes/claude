"use strict";
// Keyboard + mouse, touch (move stick on the left, attack and super buttons on the
// right: drag to aim and release to fire, or tap to quick-fire), and gamepads.

const Input = {
  keys: new Set(),
  pressed: new Set(),        // keys pressed since the last frame
  mouse: { x: 0, y: 0, left: false, right: false, rightPressed: false, lastMove: -99 },
  touchMode: false,
  move: null,                // { id, ox, oy, x, y }
  aimTouch: { atk: null, sup: null },
  releases: [],              // { kind: "atk" | "sup", auto, ang, frac }
  padPrev: {},
  onPause: null,

  init(canvas) {
    const gameKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyE", "KeyQ"]);
    addEventListener("keydown", (e) => {
      if (G.state === "play" && !G.demo && gameKeys.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    canvas.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.lastMove = performance.now();
    });
    canvas.addEventListener("mousedown", (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.lastMove = performance.now();
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      this.touchMode = false;
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    const opt = { passive: false };
    canvas.addEventListener("touchstart", (e) => { e.preventDefault(); this.touchMode = true; for (const t of e.changedTouches) this.touchStart(t); }, opt);
    canvas.addEventListener("touchmove", (e) => { e.preventDefault(); for (const t of e.changedTouches) this.touchMove(t); }, opt);
    canvas.addEventListener("touchend", (e) => { e.preventDefault(); for (const t of e.changedTouches) this.touchEnd(t, false); }, opt);
    canvas.addEventListener("touchcancel", (e) => { for (const t of e.changedTouches) this.touchEnd(t, true); }, opt);
  },

  touchStart(t) {
    const L = touchLayout(innerWidth, innerHeight);
    const x = t.clientX, y = t.clientY;
    if (Math.hypot(x - L.pause.x, y - L.pause.y) < L.pause.r * 1.6) { if (this.onPause) this.onPause(); return; }
    const start = { id: t.identifier, ox: x, oy: y, x, y, maxLen: 0 };
    if (Math.hypot(x - L.sup.x, y - L.sup.y) < L.sup.r * 1.5 && !this.aimTouch.sup) {
      start.ox = L.sup.x; start.oy = L.sup.y;
      this.aimTouch.sup = start;
    } else if (x > innerWidth * 0.5 && !this.aimTouch.atk) {
      start.ox = L.atk.x; start.oy = L.atk.y;
      // Touching far from the button: aim relative to where the thumb landed.
      if (Math.hypot(x - L.atk.x, y - L.atk.y) > L.atk.r * 1.6) { start.ox = x; start.oy = y; }
      this.aimTouch.atk = start;
    } else if (!this.move) {
      this.move = start;
    }
  },

  touchMove(t) {
    const L = touchLayout(innerWidth, innerHeight);
    for (const s of [this.move, this.aimTouch.atk, this.aimTouch.sup]) {
      if (s && s.id === t.identifier) {
        s.x = t.clientX; s.y = t.clientY;
        s.maxLen = Math.max(s.maxLen, Math.hypot(s.x - s.ox, s.y - s.oy) / L.maxDrag);
      }
    }
  },

  touchEnd(t, cancel) {
    const L = touchLayout(innerWidth, innerHeight);
    if (this.move && this.move.id === t.identifier) this.move = null;
    for (const kind of ["atk", "sup"]) {
      const s = this.aimTouch[kind];
      if (!s || s.id !== t.identifier) continue;
      this.aimTouch[kind] = null;
      if (cancel) continue;
      const dx = s.x - s.ox, dy = s.y - s.oy, len = Math.hypot(dx, dy) / L.maxDrag;
      if (s.maxLen < 0.22) this.releases.push({ kind, auto: true });
      else if (len >= 0.22) this.releases.push({ kind, auto: false, ang: Math.atan2(dy, dx), frac: Math.min(1, len) });
      // Dragged out and back to the middle: cancelled.
    }
  },

  // Current aim drag for the indicator: { kind, ang, frac } or null.
  touchAim() {
    const L = touchLayout(innerWidth, innerHeight);
    for (const kind of ["sup", "atk"]) {
      const s = this.aimTouch[kind];
      if (!s) continue;
      const dx = s.x - s.ox, dy = s.y - s.oy, len = Math.hypot(dx, dy) / L.maxDrag;
      if (len >= 0.22) return { kind, ang: Math.atan2(dy, dx), frac: Math.min(1, len) };
    }
    return null;
  },

  moveVector() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    if (this.move) {
      const L = touchLayout(innerWidth, innerHeight);
      const dx = (this.move.x - this.move.ox) / (L.maxDrag * 0.8), dy = (this.move.y - this.move.oy) / (L.maxDrag * 0.8);
      const m = Math.hypot(dx, dy);
      if (m > 0.15) { x += dx / Math.max(m, 1); y += dy / Math.max(m, 1); }
    }
    const p = this.pad();
    if (p && Math.hypot(p.lx, p.ly) > 0.2) { x += p.lx; y += p.ly; }
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  },

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const btn = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
      return {
        lx: p.axes[0] || 0, ly: p.axes[1] || 0, rx: p.axes[2] || 0, ry: p.axes[3] || 0,
        fire: btn(7) || btn(5), super: btn(6) || btn(4), autoFire: btn(0), autoSuper: btn(1), start: btn(9),
      };
    }
    return null;
  },

  // Edge-triggered gamepad buttons.
  padEdge(p, name) {
    const now = !!(p && p[name]), was = !!this.padPrev[name];
    this.padPrev[name] = now;
    return now && !was;
  },

  endFrame() {
    this.pressed.clear();
    this.mouse.rightPressed = false;
    this.releases.length = 0;
  },
};

function touchLayout(W, H) {
  const u = Math.min(W, H);
  return {
    atk: { x: W - u * 0.2, y: H - u * 0.22, r: u * 0.1 },
    sup: { x: W - u * 0.43, y: H - u * 0.13, r: u * 0.075 },
    pause: { x: W - u * 0.07, y: u * 0.07, r: u * 0.045 },
    maxDrag: u * 0.14,
  };
}
