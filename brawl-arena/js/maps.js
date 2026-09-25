"use strict";
// Tile maps. Each map is written as its top (red) half plus the middle row; the bottom
// (blue) half is the top half rotated 180°, so both sides are exactly fair.
//
//   .  floor        #  stone wall (blocks moving and shots; supers can smash it)
//   C  crate        ~  water (blocks moving, shots fly over)
//   "  bush (hides you)   M  gem mine   2  red spawn (becomes 1, blue, when mirrored)

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

const MAPS = {
  canyon: {
    name: "Gem Canyon",
    blurb: "Open middle with water on the flanks. Good for long-range brawlers.",
    top: [
      '~~~.....2.2.2.....~~~',
      '~~.................~~',
      '.....""".....""".....',
      '..##.""".....""".##..',
      '..#...............#..',
      '.......###.###.......',
      '"".................""',
      '"""...CC.....CC..."""',
      '.....................',
      '##..."""..#.."""...##',
      '.....................',
      '....~~~.......~~~....',
      '....~~~..#.#..~~~....',
      '.........#.#.........',
      '.."""..........."""..',
      '.."""..C.....C.."""..',
    ],
    mid: '..........M..........',
  },
  grove: {
    name: "Hidden Grove",
    blurb: "Thick bushes everywhere. Great for ambushes and close-range brawlers.",
    top: [
      'C.......2.2.2.......C',
      'C...................C',
      '..."""""....."""""...',
      '..."""""....."""""...',
      '...##...........##...',
      '.....................',
      '""....CCC...CCC....""',
      '"""".............""""',
      '"""".....""".....""""',
      '........#"""#........',
      '........#...#........',
      '~~~...............~~~',
      '~~~.."""....."""..~~~',
      '.....""".....""".....',
      '.........C.C.........',
      '..##.............##..',
    ],
    mid: '..........M..........',
  },
};

const SOLID = new Set(["#", "C", "~"]);   // blocks movement
const WALL = new Set(["#", "C"]);         // blocks shots, breakable

function buildMap(id) {
  const def = MAPS[id];
  const flip = (row) => row.split("").reverse().join("").replace(/2/g, "1");
  const rows = [...def.top, def.mid, ...def.top.slice().reverse().map(flip)];
  const w = 21, h = rows.length;
  for (const r of rows) if (r.length !== w) throw new Error(`map ${id}: row "${r}" is ${r.length} wide`);
  const map = { id, name: def.name, w, h, tiles: rows.map((r) => r.split("")), spawns: [[], []], mine: null, version: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = map.tiles[y][x];
      if (c === "1" || c === "2") {
        map.spawns[c === "1" ? 0 : 1].push({ x: x + 0.5, y: y + 0.5 });
        map.tiles[y][x] = ".";
      } else if (c === "M") {
        map.mine = { x: x + 0.5, y: y + 0.5 };
        map.tiles[y][x] = ".";
      }
    }
  }
  // Blue spawns listed left to right like red's.
  map.spawns[0].sort((a, b) => a.x - b.x);
  return map;
}

function tileAt(map, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return "X";
  return map.tiles[ty][tx];
}
const solidAt = (map, x, y) => { const c = tileAt(map, x, y); return c === "X" || SOLID.has(c); };
const wallAt = (map, x, y) => WALL.has(tileAt(map, x, y));
const bushAt = (map, x, y) => tileAt(map, x, y) === '"';

// Clear line for shots between two points (walls block, water doesn't).
function shotClear(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (wallAt(map, lerp(x0, x1, t), lerp(y0, y1, t))) return false;
  }
  return true;
}

// Clear line for walking a body of radius r.
function walkClear(map, x0, y0, x1, y1, r) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1e-6) return true;
  const px = -(y1 - y0) / d * r, py = (x1 - x0) / d * r, n = Math.ceil(d / 0.25);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
    if (solidAt(map, x + px, y + py) || solidAt(map, x - px, y - py) || solidAt(map, x, y)) return false;
  }
  return true;
}

// A* over the tile grid (8 directions, no corner cutting). Returns tile-centre waypoints.
function findPath(map, sx, sy, gx, gy) {
  const w = map.w, h = map.h;
  const free = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !SOLID.has(map.tiles[y][x]);
  let tx = clamp(Math.floor(gx), 0, w - 1), ty = clamp(Math.floor(gy), 0, h - 1);
  if (!free(tx, ty)) {
    // Nearest free tile to the goal.
    let best = null, bd = 1e9;
    for (let y = Math.max(0, ty - 3); y <= Math.min(h - 1, ty + 3); y++)
      for (let x = Math.max(0, tx - 3); x <= Math.min(w - 1, tx + 3); x++)
        if (free(x, y)) { const d = (x - tx) ** 2 + (y - ty) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
    if (!best) return null;
    [tx, ty] = best;
  }
  const s0 = clamp(Math.floor(sx), 0, w - 1), s1 = clamp(Math.floor(sy), 0, h - 1);
  const start = s1 * w + s0, goal = ty * w + tx;
  const g = new Float32Array(w * h).fill(1e9), from = new Int32Array(w * h).fill(-1), closed = new Uint8Array(w * h);
  const open = [start];
  g[start] = 0;
  const hfn = (i) => { const dx = Math.abs((i % w) - tx), dy = Math.abs(((i / w) | 0) - ty); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
  while (open.length) {
    let bi = 0, bf = 1e9;
    for (let i = 0; i < open.length; i++) { const f = g[open[i]] + hfn(open[i]); if (f < bf) { bf = f; bi = i; } }
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w, cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
      const ni = ny * w + nx, ng = g[cur] + (dx && dy ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; open.push(ni); }
    }
  }
  if (from[goal] < 0 && goal !== start) return null;
  const path = [];
  for (let i = goal; i !== start && i >= 0; i = from[i]) path.push({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
  return path.reverse();
}
