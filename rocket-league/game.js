"use strict";
/*
 * Sideswipe Soccar - a from-scratch arcade recreation of Rocket League Sideswipe.
 * Cars drive around the inside of an enclosed rounded-rectangle arena (floor,
 * walls and ceiling all count as "ground"), jump/double-jump into the air,
 * boost, and knock a bouncy ball into either end's goal gap.
 */

// ---------------------------------------------------------------------------
// Canvas / constants
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const CW = canvas.width;
const CH = canvas.height;

const ARENA = {
  cx: CW / 2,
  cy: CH / 2 + 15,
  w: 380,   // half width
  h: 195,   // half height
  r: 70,    // corner radius
  goalHalf: 82, // half-height of the goal opening on the end walls
};

const Lt = 2 * (ARENA.w - ARENA.r);
const Le = 2 * (ARENA.h - ARENA.r);
const Lc = (ARENA.r * Math.PI) / 2;
const PERIM = 2 * Lt + 4 * Lc + 2 * Le;
const OFF = {
  top: 0,
  trCorner: Lt,
  right: Lt + Lc,
  brCorner: Lt + Lc + Le,
  bottom: Lt + 2 * Lc + Le,
  blCorner: 2 * Lt + 2 * Lc + Le,
  left: 2 * Lt + 3 * Lc + Le,
  tlCorner: 2 * Lt + 3 * Lc + 2 * Le,
};

const GRAVITY = 1500;
const DRIVE_ACCEL = 2600;
const MAX_DRIVE_SPEED = 560;
const SURFACE_DRAG = 0.35; // fractional velocity bleed per second when coasting
const AIR_ROTATE_SPEED = 6.2;
const AIR_DRAG = 0.06;
const JUMP_SPEED = 640;
const DOUBLE_JUMP_SPEED = 560;
const BOOST_ACCEL = 2500;
const BOOST_MAX = 100;
const BOOST_DRAIN = 34;
const BOOST_REGEN = 3;
const PAD_AMOUNT = 100;
const PAD_COOLDOWN = 5;
const CAR_RADIUS = 21;
const BALL_RADIUS = 15;
const BALL_RESTITUTION = 0.82;
const BALL_DRAG = 0.12;
const KICK_TRANSFER = 0.7;
const KICK_IMPULSE = 420;
const CAR_BUMP_IMPULSE = 260;
const DEMO_SPEED_MARGIN = 90;
const MATCH_SECONDS = 120;

const FIXED_DT = 1 / 120;

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------
function len(x, y) { return Math.sqrt(x * x + y * y); }
function norm(x, y) {
  const l = len(x, y) || 1e-6;
  return [x / l, y / l];
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Arena geometry: arc-length parametrisation of the rounded-rect boundary.
// s runs clockwise starting at the left end of the top (ceiling) edge.
// Returns world-space point, outward normal, and forward tangent (direction
// of travel for increasing s).
// ---------------------------------------------------------------------------
function surfaceAt(s) {
  s = ((s % PERIM) + PERIM) % PERIM;
  const { w, h, r, cx, cy } = ARENA;
  let x, y, nx, ny, tx, ty;

  if (s < OFF.trCorner) {
    const u = s - OFF.top;
    x = -(w - r) + u; y = -h;
    nx = 0; ny = -1; tx = 1; ty = 0;
  } else if (s < OFF.right) {
    const u = s - OFF.trCorner;
    const th = -Math.PI / 2 + (u / Lc) * (Math.PI / 2);
    x = (w - r) + r * Math.cos(th); y = -(h - r) + r * Math.sin(th);
    nx = Math.cos(th); ny = Math.sin(th); tx = -Math.sin(th); ty = Math.cos(th);
  } else if (s < OFF.brCorner) {
    const u = s - OFF.right;
    x = w; y = -(h - r) + u;
    nx = 1; ny = 0; tx = 0; ty = 1;
  } else if (s < OFF.bottom) {
    const u = s - OFF.brCorner;
    const th = 0 + (u / Lc) * (Math.PI / 2);
    x = (w - r) + r * Math.cos(th); y = (h - r) + r * Math.sin(th);
    nx = Math.cos(th); ny = Math.sin(th); tx = -Math.sin(th); ty = Math.cos(th);
  } else if (s < OFF.blCorner) {
    const u = s - OFF.bottom;
    x = (w - r) - u; y = h;
    nx = 0; ny = 1; tx = -1; ty = 0;
  } else if (s < OFF.left) {
    const u = s - OFF.blCorner;
    const th = Math.PI / 2 + (u / Lc) * (Math.PI / 2);
    x = -(w - r) + r * Math.cos(th); y = (h - r) + r * Math.sin(th);
    nx = Math.cos(th); ny = Math.sin(th); tx = -Math.sin(th); ty = Math.cos(th);
  } else if (s < OFF.tlCorner) {
    const u = s - OFF.left;
    x = -w; y = (h - r) - u;
    nx = -1; ny = 0; tx = 0; ty = -1;
  } else {
    const u = s - OFF.tlCorner;
    const th = Math.PI + (u / Lc) * (Math.PI / 2);
    x = -(w - r) + r * Math.cos(th); y = -(h - r) + r * Math.sin(th);
    nx = Math.cos(th); ny = Math.sin(th); tx = -Math.sin(th); ty = Math.cos(th);
  }
  return { x: x + cx, y: y + cy, nx, ny, tx, ty };
}

// Nearest point on the rounded-rect boundary to world point (px,py), plus its
// signed distance (negative = inside) and arc-length parameter.
function nearestBoundary(px, py) {
  const { w, h, r, cx, cy } = ARENA;
  const x = px - cx, y = py - cy;
  const ax = Math.abs(x), ay = Math.abs(y);
  const qx = ax - (w - r), qy = ay - (h - r);
  const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;

  let nx, ny, s;
  if (qx > 0 && qy > 0) {
    const ccx = Math.sign(x) * (w - r);
    const ccy = Math.sign(y) * (h - r);
    [nx, ny] = norm(x - ccx, y - ccy);
    let th = Math.atan2(ny, nx);
    if (Math.sign(x) > 0 && Math.sign(y) < 0) {
      s = OFF.trCorner + ((th + Math.PI / 2) / (Math.PI / 2)) * Lc;
    } else if (Math.sign(x) > 0 && Math.sign(y) > 0) {
      s = OFF.brCorner + (th / (Math.PI / 2)) * Lc;
    } else if (Math.sign(x) < 0 && Math.sign(y) > 0) {
      s = OFF.blCorner + ((th - Math.PI / 2) / (Math.PI / 2)) * Lc;
    } else {
      const th360 = th < 0 ? th + 2 * Math.PI : th;
      s = OFF.tlCorner + ((th360 - Math.PI) / (Math.PI / 2)) * Lc;
    }
  } else if (qx > qy) {
    nx = Math.sign(x) || 1; ny = 0;
    if (nx > 0) s = OFF.right + clamp(y + (h - r), 0, Le);
    else s = OFF.left + clamp((h - r) - y, 0, Le);
  } else {
    nx = 0; ny = Math.sign(y) || -1;
    if (ny < 0) s = OFF.top + clamp(x + (w - r), 0, Lt);
    else s = OFF.bottom + clamp((w - r) - x, 0, Lt);
  }
  return { sdf, nx, ny, s: ((s % PERIM) + PERIM) % PERIM };
}

function inGoalGap(ny_or_point) {
  // point relative to arena center; true if within the vertical goal opening
  return Math.abs(ny_or_point) < ARENA.goalHalf;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
  if (e.key === "Escape") togglePause();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

function readInput(scheme) {
  return {
    left: keys.has(scheme.left),
    right: keys.has(scheme.right),
    jump: keys.has(scheme.jump),
    boost: keys.has(scheme.boost),
  };
}
const SCHEME_P1 = { left: "a", right: "d", jump: "w", boost: "s" };
const SCHEME_P2 = { left: "arrowleft", right: "arrowright", jump: "arrowup", boost: "arrowdown" };

// ---------------------------------------------------------------------------
// Simple synthesised sound effects (no external assets)
// ---------------------------------------------------------------------------
const SFX = (() => {
  let actx = null;
  function ensure() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    return actx;
  }
  function beep(freq, dur, type, gain, when = 0) {
    const ac = ensure();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(ac.destination);
    const t0 = ac.currentTime + when;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  return {
    jump: () => beep(520, 0.12, "square", 0.05),
    doubleJump: () => beep(760, 0.14, "square", 0.06),
    boost: () => beep(160, 0.08, "sawtooth", 0.02),
    bump: () => beep(90, 0.15, "square", 0.08),
    demo: () => { beep(60, 0.3, "sawtooth", 0.12); beep(40, 0.35, "square", 0.1, 0.05); },
    hit: () => beep(340, 0.07, "triangle", 0.05),
    goal: () => { beep(660, 0.15, "sine", 0.08); beep(880, 0.2, "sine", 0.08, 0.12); beep(1100, 0.3, "sine", 0.08, 0.24); },
    pad: () => beep(980, 0.09, "sine", 0.05),
  };
})();

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
const particles = [];
function spawnParticles(x, y, count, color, opts = {}) {
  const speed = opts.speed ?? 140;
  const life = opts.life ?? 0.5;
  const size = opts.size ?? 3;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.3 + Math.random() * 0.9);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp + (opts.vx || 0),
      vy: Math.sin(a) * sp + (opts.vy || 0),
      life: life * (0.6 + Math.random() * 0.6),
      maxLife: life,
      color,
      size: size * (0.6 + Math.random() * 0.8),
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 2 * dt;
    p.vy *= 1 - 2 * dt;
  }
}
function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.maxLife;
    ctx.globalAlpha = clamp(t, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Boost pads: fixed positions around the perimeter
// ---------------------------------------------------------------------------
function makePads() {
  // Three pads along the floor, mirrored along the ceiling.
  const list = [];
  const floorPositions = [0.18, 0.5, 0.82];
  for (const f of floorPositions) list.push({ s: OFF.bottom + Lt * f });
  for (const f of floorPositions) list.push({ s: OFF.top + Lt * f });
  return list.map((p) => ({ s: p.s, cooldown: 0 }));
}
let pads = makePads();

// ---------------------------------------------------------------------------
// Car
// ---------------------------------------------------------------------------
class Car {
  constructor(team, scheme, color, spawnSide) {
    this.team = team; // "blue" | "orange"
    this.scheme = scheme;
    this.color = color;
    this.spawnSide = spawnSide; // -1 left, 1 right
    this.reset();
  }

  reset() {
    this.mode = "surface"; // "surface" | "air"
    // Along the bottom edge, s increases from the right end toward the left end.
    this.s = OFF.bottom + Lt * (this.spawnSide < 0 ? 0.72 : 0.28);
    this.ds = 0;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.boost = BOOST_MAX;
    this.jumpsUsed = 0;
    this.jumpHeld = false;
    this.airTime = 0;
    this.facing = this.spawnSide < 0 ? 1 : -1;
    this.demoTimer = 0;
    this.lastInput = { left: false, right: false, jump: false, boost: false };
    this.syncFromSurface();
  }

  syncFromSurface() {
    const surf = surfaceAt(this.s);
    this.x = surf.x - surf.nx * CAR_RADIUS * 0.55;
    this.y = surf.y - surf.ny * CAR_RADIUS * 0.55;
    this.upx = -surf.nx; this.upy = -surf.ny;
    this.angle = Math.atan2(surf.ty, surf.tx) + (this.ds < 0 ? Math.PI : 0);
    this.vx = surf.tx * this.ds;
    this.vy = surf.ty * this.ds;
  }

  get speed() { return this.mode === "surface" ? Math.abs(this.ds) : len(this.vx, this.vy); }

  update(dt, input) {
    this.lastInput = input;
    if (this.demoTimer > 0) {
      this.demoTimer -= dt;
      if (this.demoTimer <= 0) this.respawn();
      return;
    }

    const wantLeft = input.left, wantRight = input.right;
    const jumpNow = input.jump && !this.jumpHeld;
    this.jumpHeld = input.jump;

    if (this.mode === "surface") {
      let accel = 0;
      if (wantRight) accel += DRIVE_ACCEL;
      if (wantLeft) accel -= DRIVE_ACCEL;
      this.ds += accel * dt;

      // coast drag when no input
      if (!wantLeft && !wantRight) {
        const drag = SURFACE_DRAG * dt * 4;
        this.ds *= Math.max(0, 1 - drag);
      }

      if (input.boost && this.boost > 0) {
        const dir = this.ds >= 0 ? 1 : -1;
        this.ds += BOOST_ACCEL * dt * (dir || 1);
        this.boost = Math.max(0, this.boost - BOOST_DRAIN * dt);
        if (Math.random() < 0.6) {
          const surf = surfaceAt(this.s);
          spawnParticles(surf.x - surf.nx * 10, surf.y - surf.ny * 10, 1, this.color, { speed: 60, life: 0.3, size: 3 });
        }
      } else {
        this.boost = Math.min(BOOST_MAX, this.boost + BOOST_REGEN * dt);
      }

      this.ds = clamp(this.ds, -MAX_DRIVE_SPEED * 1.6, MAX_DRIVE_SPEED * 1.6);
      // gravity's tangential pull (slower going "uphill" toward ceiling)
      const surf0 = surfaceAt(this.s);
      // gravity is (0, +GRAVITY); its component along the tangent is tangent.y * GRAVITY,
      // which speeds the car up heading toward the floor and slows it heading toward the ceiling.
      this.ds += surf0.ty * GRAVITY * 0.55 * dt;

      this.s += this.ds * dt;
      this.syncFromSurface();
      if (Math.abs(this.ds) > 4) this.facing = this.ds >= 0 ? 1 : -1;

      if (jumpNow) {
        this.jumpsUsed = 1;
        this.mode = "air";
        const surf = surfaceAt(this.s);
        this.vx = surf.tx * this.ds - surf.nx * JUMP_SPEED;
        this.vy = surf.ty * this.ds - surf.ny * JUMP_SPEED;
        this.x = surf.x - surf.nx * CAR_RADIUS;
        this.y = surf.y - surf.ny * CAR_RADIUS;
        this.airTime = 0;
        SFX.jump();
      }
    } else {
      // Airborne physics
      this.airTime += dt;
      this.vy += GRAVITY * dt;

      let rot = 0;
      if (wantRight) rot += 1;
      if (wantLeft) rot -= 1;
      this.angle += rot * AIR_ROTATE_SPEED * dt;

      if (input.boost && this.boost > 0) {
        this.vx += Math.cos(this.angle) * BOOST_ACCEL * dt;
        this.vy += Math.sin(this.angle) * BOOST_ACCEL * dt;
        this.boost = Math.max(0, this.boost - BOOST_DRAIN * dt);
        spawnParticles(this.x - Math.cos(this.angle) * 20, this.y - Math.sin(this.angle) * 20, 1, this.color, { speed: 40, life: 0.3, size: 3 });
      } else {
        this.boost = Math.min(BOOST_MAX, this.boost + BOOST_REGEN * dt);
      }

      this.vx *= 1 - AIR_DRAG * dt;
      this.vy *= 1 - AIR_DRAG * dt * 0.4;

      if (jumpNow && this.jumpsUsed < 2) {
        this.jumpsUsed = 2;
        this.vx += Math.cos(this.angle) * DOUBLE_JUMP_SPEED * 0.35;
        this.vy = -DOUBLE_JUMP_SPEED;
        spawnParticles(this.x, this.y, 10, "#ffffff", { speed: 160, life: 0.35, size: 2.5 });
        SFX.doubleJump();
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      const nb = nearestBoundary(this.x, this.y);
      if (nb.sdf >= -CAR_RADIUS) {
        // Landed: snap to surface, keep tangential speed, discard normal component.
        const surf = surfaceAt(nb.s);
        this.s = nb.s;
        this.mode = "surface";
        this.jumpsUsed = 0;
        const vt = this.vx * surf.tx + this.vy * surf.ty;
        this.ds = vt;
        this.syncFromSurface();
        const impactSpeed = len(this.vx, this.vy);
        if (impactSpeed > 260) spawnParticles(surf.x, surf.y, 6, "#ffffff", { speed: 90, life: 0.3, size: 2 });
      }
    }
  }

  respawn() {
    this.mode = "surface";
    this.s = OFF.bottom + Lt * (this.spawnSide < 0 ? 0.72 : 0.28);
    this.ds = 0;
    this.jumpsUsed = 0;
    this.boost = clamp(this.boost, 40, BOOST_MAX);
    this.syncFromSurface();
  }
}

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------
class Ball {
  constructor() { this.reset(); }
  reset(side = 0) {
    this.x = ARENA.cx + side * 120;
    this.y = ARENA.cy - 40;
    this.vx = 0; this.vy = 0;
    this.spin = 0;
    this.angle = 0;
  }
  update(dt) {
    this.vy += GRAVITY * 0.7 * dt;
    this.vx *= 1 - BALL_DRAG * dt;
    this.vy *= 1 - BALL_DRAG * dt * 0.3;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += (this.vx / BALL_RADIUS) * dt;

    const nb = nearestBoundary(this.x, this.y);
    const relY = this.y - ARENA.cy;
    const onEndWall = Math.abs(nb.nx) === 1 && nb.ny === 0;
    if (onEndWall && inGoalGap(relY)) {
      return; // open goal mouth - let it fly through
    }
    if (nb.sdf >= -BALL_RADIUS) {
      const into = this.vx * nb.nx + this.vy * nb.ny;
      if (into > 0) {
        const push = nb.sdf + BALL_RADIUS;
        this.x -= nb.nx * push;
        this.y -= nb.ny * push;
        this.vx -= (1 + BALL_RESTITUTION) * into * nb.nx;
        this.vy -= (1 + BALL_RESTITUTION) * into * nb.ny;
        if (into > 120) { spawnParticles(this.x, this.y, 4, "#ffffff", { speed: 70, life: 0.25, size: 2 }); SFX.hit(); }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Car <-> Ball and Car <-> Car collisions
// ---------------------------------------------------------------------------
function resolveCarBall(car, ball) {
  const dx = ball.x - car.x, dy = ball.y - car.y;
  const d = len(dx, dy);
  const minD = CAR_RADIUS + BALL_RADIUS;
  if (d >= minD || d < 1e-6) return;
  const [nx, ny] = [dx / d, dy / d];
  const overlap = minD - d;
  ball.x += nx * overlap; ball.y += ny * overlap;

  const relSpeed = len(car.vx - ball.vx, car.vy - ball.vy);

  ball.vx = ball.vx * (1 - KICK_TRANSFER) + car.vx * KICK_TRANSFER + nx * (KICK_IMPULSE + relSpeed * 0.4);
  ball.vy = ball.vy * (1 - KICK_TRANSFER) + car.vy * KICK_TRANSFER + ny * (KICK_IMPULSE + relSpeed * 0.4);

  spawnParticles(ball.x - nx * BALL_RADIUS, ball.y - ny * BALL_RADIUS, 5, "#e8ecf5", { speed: 120, life: 0.3, size: 2.5 });
  SFX.hit();
}

function resolveCarCar(a, b) {
  if (a.demoTimer > 0 || b.demoTimer > 0) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = len(dx, dy);
  const minD = CAR_RADIUS * 1.9;
  if (d >= minD || d < 1e-6) return;
  const [nx, ny] = [dx / d, dy / d];
  const overlap = minD - d;
  a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;

  const aSpeed = len(a.vx, a.vy);
  const bSpeed = len(b.vx, b.vy);
  const aBoosting = a.lastInput.boost && a.boost > 0 && aSpeed > bSpeed + DEMO_SPEED_MARGIN;
  const bBoosting = b.lastInput.boost && b.boost > 0 && bSpeed > aSpeed + DEMO_SPEED_MARGIN;

  if (aBoosting && !bBoosting) { demolish(b, a); return; }
  if (bBoosting && !aBoosting) { demolish(a, b); return; }

  // simple elastic-ish bump
  if (a.mode === "air") { a.vx -= nx * CAR_BUMP_IMPULSE; a.vy -= ny * CAR_BUMP_IMPULSE; }
  else { a.ds -= (a.ds >= 0 ? 1 : -1) * 60; }
  if (b.mode === "air") { b.vx += nx * CAR_BUMP_IMPULSE; b.vy += ny * CAR_BUMP_IMPULSE; }
  else { b.ds += (b.ds >= 0 ? 1 : -1) * 60; }
  SFX.bump();
}

function demolish(victim, attacker) {
  spawnParticles(victim.x, victim.y, 26, victim.color, { speed: 260, life: 0.6, size: 3.5 });
  spawnParticles(victim.x, victim.y, 16, "#ffffff", { speed: 200, life: 0.5, size: 2.5 });
  victim.demoTimer = 1.6;
  victim.mode = "air";
  SFX.demo();
}

// ---------------------------------------------------------------------------
// Simple AI (drives the orange car in 1P mode)
// ---------------------------------------------------------------------------
function aiInput(car, ball, ownGoalSide) {
  const nb = nearestBoundary(ball.x, ball.y);
  let targetS = nb.s;

  // Bias: when ball is deep in AI's defensive half and slow, hang back a bit
  // toward goal instead of always crashing forward, for slightly less chaotic play.
  const ballAhead = ownGoalSide > 0 ? ball.x < ARENA.cx - 40 : ball.x > ARENA.cx + 40;
  if (ballAhead && Math.abs(ball.vx) < 60) {
    const guardS = OFF.bottom + Lt * (ownGoalSide < 0 ? 0.78 : 0.22);
    targetS = lerp(targetS, guardS, 0.35);
  }

  let diff = targetS - car.s;
  diff = ((diff + PERIM / 2) % PERIM + PERIM) % PERIM - PERIM / 2; // shortest signed distance on the loop

  const input = { left: false, right: false, jump: false, boost: false };
  const deadzone = 8;
  if (car.mode === "surface") {
    if (diff > deadzone) input.right = true;
    else if (diff < -deadzone) input.left = true;

    if (Math.abs(diff) > 140 && car.boost > 15) input.boost = true;

    // Jump to intercept a ball that's up off the surface and nearby
    const carSurf = surfaceAt(car.s);
    const distToBall = len(ball.x - car.x, ball.y - car.y);
    const ballHeightAbove = (ball.x - carSurf.x) * (-carSurf.nx) + (ball.y - carSurf.y) * (-carSurf.ny);
    if (distToBall < 130 && ballHeightAbove > 22 && ballHeightAbove < 190 && Math.abs(diff) < 90) {
      input.jump = true;
    }
  } else {
    // airborne: steer facing toward the ball, use second jump near it
    const toBallX = ball.x - car.x, toBallY = ball.y - car.y;
    const wantAngle = Math.atan2(toBallY, toBallX);
    let da = wantAngle - car.angle;
    da = ((da + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    if (da > 0.1) input.right = true;
    else if (da < -0.1) input.left = true;
    if (len(toBallX, toBallY) < 70 && car.jumpsUsed < 2) input.jump = true;
    if (len(toBallX, toBallY) > 120 && car.boost > 10) input.boost = true;
  }
  return input;
}

// ---------------------------------------------------------------------------
// Game state machine
// ---------------------------------------------------------------------------
const els = {
  menu: document.getElementById("menu"),
  pause: document.getElementById("pause"),
  gameover: document.getElementById("gameover"),
  scoreBlue: document.getElementById("scoreBlue"),
  scoreOrange: document.getElementById("scoreOrange"),
  clock: document.getElementById("clock"),
  banner: document.getElementById("banner"),
  goTitle: document.getElementById("goTitle"),
  goSub: document.getElementById("goSub"),
};

const game = {
  state: "menu", // menu | playing | paused | goal | over
  mode: "ai",    // ai | 2p
  scoreBlue: 0,
  scoreOrange: 0,
  timeLeft: MATCH_SECONDS,
  overtime: false,
  goalFreeze: 0,
  bannerTimer: 0,
};

const carBlue = new Car("blue", SCHEME_P1, "#4da3ff", -1);
const carOrange = new Car("orange", SCHEME_P2, "#ff9a3c", 1);
const ball = new Ball();

function showBanner(text, ms = 1400) {
  els.banner.textContent = text;
  els.banner.classList.add("show");
  game.bannerTimer = ms / 1000;
}

function startMatch(mode) {
  game.mode = mode;
  game.scoreBlue = 0;
  game.scoreOrange = 0;
  game.timeLeft = MATCH_SECONDS;
  game.overtime = false;
  game.state = "playing";
  pads = makePads();
  particles.length = 0;
  carBlue.reset();
  carOrange.reset();
  ball.reset();
  els.menu.classList.add("hidden");
  els.gameover.classList.add("hidden");
  els.pause.classList.add("hidden");
  updateHud();
}

function togglePause() {
  if (game.state === "playing") { game.state = "paused"; els.pause.classList.remove("hidden"); }
  else if (game.state === "paused") { game.state = "playing"; els.pause.classList.add("hidden"); }
}

function afterGoal(scorer) {
  if (scorer === "blue") game.scoreBlue++; else game.scoreOrange++;
  SFX.goal();
  spawnParticles(ball.x, ball.y, 40, scorer === "blue" ? "#4da3ff" : "#ff9a3c", { speed: 300, life: 0.8, size: 4 });
  updateHud();
  showBanner((scorer === "blue" ? "BLUE" : "ORANGE") + " SCORES!", 1600);
  game.state = "goal";
  game.goalFreeze = 1.7;
}

function updateHud() {
  els.scoreBlue.textContent = game.scoreBlue;
  els.scoreOrange.textContent = game.scoreOrange;
  const t = Math.max(0, game.timeLeft);
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  els.clock.textContent = game.overtime ? "OT" : `${m}:${sec.toString().padStart(2, "0")}`;
}

function endMatch() {
  game.state = "over";
  const blue = game.scoreBlue, orange = game.scoreOrange;
  let title, sub;
  if (blue === orange) { title = "DRAW"; sub = `${blue} - ${orange}`; }
  else {
    const winner = blue > orange ? "BLUE" : "ORANGE";
    title = winner + " WINS!";
    sub = `${blue} - ${orange}`;
  }
  els.goTitle.textContent = title;
  els.goSub.textContent = sub;
  els.gameover.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Main update / render
// ---------------------------------------------------------------------------
function stepPhysics(dt) {
  const inputBlue = readInput(SCHEME_P1);
  const inputOrange = game.mode === "ai" ? aiInput(carOrange, ball, 1) : readInput(SCHEME_P2);

  carBlue.update(dt, inputBlue);
  carOrange.update(dt, inputOrange);
  ball.update(dt);

  if (carBlue.demoTimer <= 0) resolveCarBall(carBlue, ball);
  if (carOrange.demoTimer <= 0) resolveCarBall(carOrange, ball);
  resolveCarCar(carBlue, carOrange);

  for (const pad of pads) {
    if (pad.cooldown > 0) { pad.cooldown -= dt; continue; }
    const surf = surfaceAt(pad.s);
    for (const car of [carBlue, carOrange]) {
      if (car.demoTimer > 0) continue;
      if (len(car.x - surf.x, car.y - surf.y) < 30 && car.boost < BOOST_MAX) {
        car.boost = BOOST_MAX;
        pad.cooldown = PAD_COOLDOWN;
        spawnParticles(surf.x, surf.y, 14, "#8fffb0", { speed: 130, life: 0.4, size: 3 });
        SFX.pad();
      }
    }
  }

  if (ball.x - BALL_RADIUS > ARENA.cx + ARENA.w) afterGoal("blue");
  else if (ball.x + BALL_RADIUS < ARENA.cx - ARENA.w) afterGoal("orange");
}

let acc = 0;
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  dt = Math.min(dt, 0.05);

  if (game.bannerTimer > 0) {
    game.bannerTimer -= dt;
    if (game.bannerTimer <= 0) els.banner.classList.remove("show");
  }

  if (game.state === "playing") {
    if (!game.overtime) {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0) {
        game.timeLeft = 0;
        if (game.scoreBlue === game.scoreOrange) { game.overtime = true; showBanner("OVERTIME!", 1600); }
        else { endMatch(); }
      }
      updateHud();
    }
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 8) {
      stepPhysics(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
  } else if (game.state === "goal") {
    game.goalFreeze -= dt;
    if (game.goalFreeze <= 0) {
      if (game.overtime) { endMatch(); }
      else {
        carBlue.reset();
        carOrange.reset();
        ball.reset(0);
        game.state = "playing";
      }
    }
  }

  updateParticles(dt);
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function roundedRectPath() {
  const { cx, cy, w, h, r } = ARENA;
  const p = new Path2D();
  p.moveTo(cx - (w - r), cy - h);
  p.lineTo(cx + (w - r), cy - h);
  p.arcTo(cx + w, cy - h, cx + w, cy - (h - r), r);
  p.lineTo(cx + w, cy + (h - r));
  p.arcTo(cx + w, cy + h, cx + (w - r), cy + h, r);
  p.lineTo(cx - (w - r), cy + h);
  p.arcTo(cx - w, cy + h, cx - w, cy + (h - r), r);
  p.lineTo(cx - w, cy - (h - r));
  p.arcTo(cx - w, cy - h, cx - (w - r), cy - h, r);
  p.closePath();
  return p;
}

function drawArena() {
  const { cx, cy, w, h, r, goalHalf } = ARENA;

  ctx.save();
  ctx.fillStyle = "#0e1626";
  ctx.fillRect(0, 0, CW, CH);

  // subtle crowd/stadium glow behind arena
  const grad = ctx.createRadialGradient(cx, cy, 60, cx, cy, 520);
  grad.addColorStop(0, "rgba(40,60,110,0.35)");
  grad.addColorStop(1, "rgba(5,7,13,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CW, CH);

  const path = roundedRectPath();
  ctx.save();
  ctx.clip(path);
  const floorGrad = ctx.createLinearGradient(0, cy - h, 0, cy + h);
  floorGrad.addColorStop(0, "#182338");
  floorGrad.addColorStop(0.5, "#0f1830");
  floorGrad.addColorStop(1, "#182338");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(cx - w, cy - h, w * 2, h * 2);

  // center line + circle
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx, cy + h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // goal nets (drawn before the boundary stroke so the stroke sits on top of the posts)
  for (const side of [-1, 1]) {
    const gx = cx + side * w;
    const depth = 26 * -side;
    ctx.fillStyle = side < 0 ? "rgba(77,163,255,0.16)" : "rgba(255,154,60,0.16)";
    ctx.fillRect(Math.min(gx, gx + depth), cy - goalHalf, Math.abs(depth), goalHalf * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let yy = cy - goalHalf; yy <= cy + goalHalf; yy += 8) {
      ctx.moveTo(gx, yy); ctx.lineTo(gx + depth, yy);
    }
    for (let xx = 0; xx <= Math.abs(depth); xx += 8) {
      ctx.moveTo(gx + side * xx, cy - goalHalf); ctx.lineTo(gx + side * xx, cy + goalHalf);
    }
    ctx.stroke();
  }

  // boundary stroke
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#2c3e63";
  ctx.stroke(path);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(180,200,255,0.5)";
  ctx.stroke(path);

  // goal posts highlight
  for (const side of [-1, 1]) {
    const gx = cx + side * w;
    ctx.strokeStyle = side < 0 ? "#4da3ff" : "#ff9a3c";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(gx, cy - goalHalf);
    ctx.lineTo(gx, cy + goalHalf);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPads() {
  for (const pad of pads) {
    const surf = surfaceAt(pad.s);
    const active = pad.cooldown <= 0;
    ctx.save();
    ctx.translate(surf.x - surf.nx * 4, surf.y - surf.ny * 4);
    ctx.rotate(Math.atan2(surf.ty, surf.tx));
    ctx.fillStyle = active ? "#8fffb0" : "rgba(120,140,120,0.25)";
    ctx.shadowColor = active ? "#8fffb0" : "transparent";
    ctx.shadowBlur = active ? 12 : 0;
    ctx.beginPath();
    ctx.moveTo(-10, 0); ctx.lineTo(0, -7); ctx.lineTo(10, 0); ctx.lineTo(0, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawCar(car) {
  if (car.demoTimer > 0) return;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const wBody = 44, hBody = 24;

  if (car.lastInput.boost && car.boost > 0) {
    ctx.save();
    ctx.rotate(Math.PI);
    const grad = ctx.createLinearGradient(0, 0, 30, 0);
    grad.addColorStop(0, car.color);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(wBody / 2 - 2, -6);
    ctx.lineTo(wBody / 2 - 2 + 22, 0);
    ctx.lineTo(wBody / 2 - 2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = car.color;
  roundRect(ctx, -wBody / 2, -hBody / 2, wBody, hBody, 8);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(10,14,22,0.85)";
  roundRect(ctx, -wBody / 2 + 10, -hBody / 2 + 3, wBody - 20, hBody - 12, 5);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(wBody / 2 - 3, -hBody / 2 + 4, 2.4, 0, Math.PI * 2);
  ctx.arc(wBody / 2 - 3, hBody / 2 - 4, 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1a1f2b";
  ctx.beginPath();
  ctx.arc(-wBody / 2 + 8, -hBody / 2 - 1, 5, 0, Math.PI * 2);
  ctx.arc(-wBody / 2 + 8, hBody / 2 + 1, 5, 0, Math.PI * 2);
  ctx.arc(wBody / 2 - 10, -hBody / 2 - 1, 5, 0, Math.PI * 2);
  ctx.arc(wBody / 2 - 10, hBody / 2 + 1, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // boost bar under car
  ctx.save();
  const bw = 34;
  ctx.translate(car.x - bw / 2, car.y + 26);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, bw, 5);
  ctx.fillStyle = car.boost > 20 ? "#ffe066" : "#ff5c5c";
  ctx.fillRect(0, 0, bw * (car.boost / BOOST_MAX), 5);
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawBall() {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.angle);
  const grad = ctx.createRadialGradient(-5, -5, 2, 0, 0, BALL_RADIUS);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#c7ccd8");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a90a3";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS - 2, (i * Math.PI * 2) / 3, (i * Math.PI * 2) / 3 + 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  drawArena();
  drawPads();
  drawParticles();
  if (game.state !== "menu") {
    drawBall();
    drawCar(carBlue);
    drawCar(carOrange);
  }
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
document.getElementById("btnAI").addEventListener("click", () => startMatch("ai"));
document.getElementById("btn2P").addEventListener("click", () => startMatch("2p"));
document.getElementById("btnResume").addEventListener("click", togglePause);
document.getElementById("btnQuit").addEventListener("click", () => {
  game.state = "menu";
  els.pause.classList.add("hidden");
  els.menu.classList.remove("hidden");
});
document.getElementById("btnRematch").addEventListener("click", () => startMatch(game.mode));
document.getElementById("btnMenu").addEventListener("click", () => {
  els.gameover.classList.add("hidden");
  els.menu.classList.remove("hidden");
  game.state = "menu";
});

requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });
render();
