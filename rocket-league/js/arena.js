"use strict";
// Arena geometry. The playable boundary is one closed, tangent-continuous path of
// line and arc segments, traversed clockwise on screen (y points down). Grounded cars
// ride this path by arc length `s`; the ball and airborne cars collide against it.
// The path includes both goal pockets, so cars can drive into (and out of) the nets.

const TAU = Math.PI * 2;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

const ARENAS = {
  shortstack: {
    id: "shortstack",
    name: "Shortstack",
    blurb: "Duel arena. Low, wide goals.",
    w: 760, h: 360, rTop: 140, rQuarter: 210,
    goalTop: -175, goalBottom: 120, goalDepth: 150, lip: 14, pocket: 35,
    theme: { sky0: "#0b1330", sky1: "#1d1140", field: "#101a33", lines: "#8fb8ff", glow: "#6ea8ff" },
  },
  scfield: {
    id: "scfield",
    name: "S.C. Field",
    blurb: "Ranked arena. Goals sit higher up the wall.",
    w: 760, h: 360, rTop: 130, rQuarter: 210,
    goalTop: -205, goalBottom: 25, goalDepth: 150, lip: 14, pocket: 35,
    theme: { sky0: "#07201f", sky1: "#12233f", field: "#0e2230", lines: "#9ff0dc", glow: "#5fe0c0" },
  },
};

function buildArena(cfg) {
  const W = cfg.w, H = cfg.h, Rt = cfg.rTop, Rq = cfg.rQuarter;
  const gT = cfg.goalTop, gB = cfg.goalBottom, D = cfg.goalDepth, rl = cfg.lip, rn = cfg.pocket;
  const PI = Math.PI, HP = PI / 2;
  const segs = [];

  const line = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) return;
    segs.push({ type: "line", ax, ay, bx, by, len, tx: (bx - ax) / len, ty: (by - ay) / len });
  };
  const arc = (cx, cy, r, a0, a1) => {
    const sweep = a1 - a0;
    segs.push({ type: "arc", cx, cy, r, a0, a1, sweep, dir: Math.sign(sweep), len: r * Math.abs(sweep) });
  };

  // Ceiling, then down the right side (upper wall, goal pocket, lower wall, quarterpipe),
  // along the floor, and back up the left side.
  line(-(W - Rt), -H, W - Rt, -H);
  arc(W - Rt, -H + Rt, Rt, -HP, 0);
  line(W, -H + Rt, W, gT - rl);
  arc(W + rl, gT - rl, rl, PI, HP);
  line(W + rl, gT, W + D - rn, gT);
  arc(W + D - rn, gT + rn, rn, -HP, 0);
  line(W + D, gT + rn, W + D, gB - rn);
  arc(W + D - rn, gB - rn, rn, 0, HP);
  line(W + D - rn, gB, W + rl, gB);
  arc(W + rl, gB + rl, rl, -HP, -PI);
  line(W, gB + rl, W, H - Rq);
  arc(W - Rq, H - Rq, Rq, 0, HP);
  line(W - Rq, H, -(W - Rq), H);
  arc(-(W - Rq), H - Rq, Rq, HP, PI);
  line(-W, H - Rq, -W, gB + rl);
  arc(-W - rl, gB + rl, rl, 0, -HP);
  line(-W - rl, gB, -W - D + rn, gB);
  arc(-W - D + rn, gB - rn, rn, HP, PI);
  line(-W - D, gB - rn, -W - D, gT + rn);
  arc(-W - D + rn, gT + rn, rn, PI, PI + HP);
  line(-W - D + rn, gT, -W - rl, gT);
  arc(-W - rl, gT - rl, rl, HP, 0);
  line(-W, gT - rl, -W, -H + Rt);
  arc(-(W - Rt), -H + Rt, Rt, PI, PI + HP);

  let acc = 0;
  for (const g of segs) {
    g.s0 = acc;
    acc += g.len;
    if (g.type === "arc") {
      // Concave arcs (center on the playable side) push a car into the surface as it
      // rides them; convex ones (the goal lips) fling it off at speed.
      const mid = (g.a0 + g.a1) / 2;
      const px = g.cx + g.r * Math.cos(mid), py = g.cy + g.r * Math.sin(mid);
      const tx = -g.dir * Math.sin(mid), ty = g.dir * Math.cos(mid);
      g.concave = (g.cx - px) * ty + (g.cy - py) * -tx < 0;
    }
  }

  return {
    cfg, segs, perim: acc,
    W, H, gT, gB, D,
    goalMidY: (gT + gB) / 2,
    floorY: H,
  };
}

// Point, tangent (+s direction), outward normal and signed curvature at arc length s.
function pathAt(A, s) {
  s = ((s % A.perim) + A.perim) % A.perim;
  const segs = A.segs;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].s0 <= s) lo = mid; else hi = mid - 1;
  }
  const g = segs[lo];
  const u = s - g.s0;
  if (g.type === "line") {
    return { x: g.ax + g.tx * u, y: g.ay + g.ty * u, tx: g.tx, ty: g.ty, nx: g.ty, ny: -g.tx, seg: g };
  }
  const a = g.a0 + (g.dir * u) / g.r;
  const c = Math.cos(a), sn = Math.sin(a);
  const tx = -g.dir * sn, ty = g.dir * c;
  return { x: g.cx + g.r * c, y: g.cy + g.r * sn, tx, ty, nx: ty, ny: -tx, seg: g };
}

// Closest boundary point to (px, py) with its arc length and signed distance
// (positive = outside the playable area).
function pathNearest(A, px, py) {
  let bestG = null, bestU = 0, bestX = 0, bestY = 0, bestD2 = Infinity;
  for (const g of A.segs) {
    let u, qx, qy;
    if (g.type === "line") {
      u = clamp((px - g.ax) * g.tx + (py - g.ay) * g.ty, 0, g.len);
      qx = g.ax + g.tx * u;
      qy = g.ay + g.ty * u;
    } else {
      const ang = Math.atan2(py - g.cy, px - g.cx);
      let du = (ang - g.a0) * g.dir;
      du = ((du % TAU) + TAU) % TAU;
      const span = Math.abs(g.sweep);
      if (du > span) du = du - span < TAU - du ? span : 0;
      u = du * g.r;
      const a = g.a0 + g.dir * du;
      qx = g.cx + g.r * Math.cos(a);
      qy = g.cy + g.r * Math.sin(a);
    }
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < bestD2) { bestD2 = d2; bestG = g; bestU = u; bestX = qx; bestY = qy; }
  }
  const s = bestG.s0 + Math.min(bestU, bestG.len - 1e-9);
  const p = pathAt(A, s);
  const d = Math.sqrt(bestD2);
  const side = (px - bestX) * p.nx + (py - bestY) * p.ny;
  return { s, x: bestX, y: bestY, nx: p.nx, ny: p.ny, tx: p.tx, ty: p.ty, sd: side >= 0 ? d : -d, seg: bestG };
}

// Signed arc-length difference from a to b, taking the shorter way around the loop.
function pathDelta(A, a, b) {
  let d = (b - a) % A.perim;
  if (d > A.perim / 2) d -= A.perim;
  if (d < -A.perim / 2) d += A.perim;
  return d;
}

function floorS(A, x) {
  return pathNearest(A, x, A.H + 5).s;
}
