"use strict";
// Game state and rules: brawlers, shots, bombs, and the two modes: Gem Grab (gems and
// the hold-10 countdown) and Brawl Ball (the ball, goals, match clock and overtime).

const STEP = 1 / 60;
const RESPAWN_T = 3;
const REGEN_DELAY = 3, REGEN_RATE = 0.13;  // 13% of max health per second after 3s out of combat
const BUSH_REVEAL = 2.6;                    // enemies this close can see into your bush
const GEM_GOAL = 10, GEM_COUNTDOWN = 15, GEM_SPAWN_T = 7;
// Brawl Ball: first to 2 goals, 2:30 on the clock, sudden-death overtime if tied.
const BALL_GOALS = 2, BALL_TIME = 150, BALL_OVERTIME = 60, GOAL_PAUSE = 2.5;
const BALL_R = 0.22, KICK_SPEED = 16, BALL_FRICTION = 1.5, PASS_RANGE = 8;
// Aim shapes while carrying the ball: attack kicks it along the ground, super lobs a pass.
const BALL_AIM = {
  kick: { type: "line", range: KICK_SPEED / BALL_FRICTION, width: BALL_R * 2 },
  pass: { type: "lob", range: PASS_RANGE, radius: 0.6, minRange: 1.5 },
};

const G = {
  state: "menu", paused: false, map: null, level: "normal", mode: "gem",
  brawlers: [], shots: [], bombs: [], gems: [], fx: [], texts: [], feed: [], sounds: [],
  teamGems: [0, 0], countTeam: -1, countdown: GEM_COUNTDOWN, mineT: GEM_SPAWN_T,
  ball: null, score: [0, 0], clock: BALL_TIME, overtime: false, goalT: 0, lastGoal: null, kickoffs: 0,
  time: 0, intro: 0, winner: -1, draw: false, overT: 0, player: null,
};

class Brawler {
  constructor(key, team, slot, name, isPlayer) {
    this.key = key;
    this.def = BRAWLERS[key];
    this.team = team;
    this.slot = slot;
    this.name = name;
    this.isPlayer = isPlayer;
    this.r = key === "rook" ? 0.42 : 0.38;
    this.maxHp = this.def.hp;
    this.stats = { kills: 0, deaths: 0, dmg: 0, gems: 0, goals: 0 };
    this.bot = null;
    this.spawn();
  }

  spawn() {
    const sp = G.map.spawns[this.team][this.slot];
    this.x = sp.x; this.y = sp.y;
    this.hp = this.maxHp;
    this.ammo = 3;
    this.superC = this.superC || 0;
    this.dead = false;
    this.respawnT = 0;
    this.gems = 0;
    this.kx = 0; this.ky = 0;
    this.vx = 0; this.vy = 0;
    this.faceAng = this.team === 0 ? -Math.PI / 2 : Math.PI / 2;
    this.aimT = 0;
    this.cool = 0;
    this.combatT = 99;
    this.revealT = 0;
    this.hitT = 0;
    this.shieldT = 1.5;
    this.burst = null;
    this.superQ = null;
    this.leap = null;
    this.walkT = 0;
    this.holdT = 0;
    this.superReadyShown = this.superC >= 1;
  }

  get inBush() { return !this.leap && bushAt(G.map, this.x, this.y); }
  get z() {
    if (!this.leap) return 0;
    const t = this.leap.t / this.leap.T;
    return 4 * t * (1 - t) * (1.2 + this.leap.T);
  }

  update(dt, inp) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.spawn();
      return;
    }
    const x0 = this.x, y0 = this.y;
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.revealT = Math.max(0, this.revealT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.cool = Math.max(0, this.cool - dt);
    this.aimT = Math.max(0, this.aimT - dt);
    this.combatT += dt;
    this.ammo = Math.min(3, this.ammo + dt / this.def.reload);
    if (this.combatT > REGEN_DELAY && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * REGEN_RATE * dt);
    }
    if (this.superC >= 1 && !this.superReadyShown) {
      this.superReadyShown = true;
      if (this.isPlayer) sfx(G, "ready", this);
    }

    if (this.leap) {
      const L = this.leap;
      L.t += dt;
      const t = Math.min(1, L.t / L.T);
      this.x = lerp(L.x0, L.x1, t);
      this.y = lerp(L.y0, L.y1, t);
      if (t >= 1) this.land();
      this.vx = (this.x - x0) / dt; this.vy = (this.y - y0) / dt;
      return;
    }

    if (this.burst) {
      const B = this.burst;
      B.t -= dt;
      while (B.t <= 0 && B.n > 0) { B.fire(G, this, B.ang); B.n--; B.t += B.gap; }
      if (B.n <= 0) this.burst = null;
    }

    // Walk, plus any knockback.
    let mx = inp.mx || 0, my = inp.my || 0;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const sp = this.def.speed;
    moveBody(this, (mx * sp + this.kx) * dt, (my * sp + this.ky) * dt);
    const kd = Math.exp(-7 * dt);
    this.kx *= kd; this.ky *= kd;
    if (m > 0.1) {
      this.walkT += dt * sp;
      if (this.aimT <= 0) this.faceAng = Math.atan2(my, mx);
    }
    if (inp.aimAng != null) { this.faceAng = inp.aimAng; this.aimT = Math.max(this.aimT, 0.1); }

    // Carrying the ball: attack kicks it, super passes it. No shooting while you hold it.
    if (G.ball && G.ball.holder === this) {
      this.holdT += dt;
      this.superQ = null;
      // A held fire button from before the pickup doesn't kick: let go and press again.
      if (!inp.fire && this.holdT > 0.1) this.kickReady = true;
      if (inp.super) {
        this.faceAng = inp.superAng; this.aimT = 0.3; this.cool = 0.3;
        passBall(G, this, inp.superAng, inp.superDist ?? PASS_RANGE);
      } else if (inp.fire && this.cool <= 0 && this.kickReady) {
        this.faceAng = inp.fireAng; this.aimT = 0.3; this.cool = 0.35;
        kickBall(G, this, inp.fireAng);
      }
      this.vx = (this.x - x0) / dt; this.vy = (this.y - y0) / dt;
      return;
    }

    // A super pressed mid-burst waits for the burst to finish instead of being dropped.
    if (inp.super && this.superC >= 1) this.superQ = { ang: inp.superAng, dist: inp.superDist, t: 0.8 };
    if (this.superQ && (this.superQ.t -= dt) <= 0) this.superQ = null;

    // Attack.
    if (this.superQ && this.superC >= 1 && !this.burst) {
      const q = this.superQ;
      this.superQ = null;
      this.superC = 0;
      this.superReadyShown = false;
      this.combatT = 0;
      this.revealT = 1;
      this.faceAng = q.ang;
      this.aimT = 0.45;
      this.def.superAttack(G, this, q.ang, q.dist ?? this.def.superAim.range);
    } else if (inp.fire && this.ammo >= 1 && this.cool <= 0 && !this.burst) {
      this.ammo -= 1;
      this.cool = 0.32;
      this.combatT = 0;
      this.revealT = 1;
      this.faceAng = inp.fireAng;
      this.aimT = 0.45;
      this.def.attack(G, this, inp.fireAng, inp.fireDist ?? this.def.aim.range);
    }
    this.vx = (this.x - x0) / dt; this.vy = (this.y - y0) / dt;
  }

  land() {
    this.leap = null;
    const R = this.def.superAim.radius;
    breakCircle(G, this.x, this.y, 1.2);
    for (const e of G.brawlers) {
      if (e.team === this.team || e.dead || e.leap) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < R + e.r) {
        damage(G, e, 1400, this, true);
        knock(e, e.x - this.x, e.y - this.y, 2.4);
      }
    }
    // Never end up standing in water or a wall.
    if (solidAt(G.map, this.x, this.y)) {
      let best = null, bd = 1e9;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const tx = Math.floor(this.x) + dx, ty = Math.floor(this.y) + dy;
        if (!solidAt(G.map, tx + 0.5, ty + 0.5)) {
          const d = (tx + 0.5 - this.x) ** 2 + (ty + 0.5 - this.y) ** 2;
          if (d < bd) { bd = d; best = [tx + 0.5, ty + 0.5]; }
        }
      }
      if (best) { this.x = best[0]; this.y = best[1]; }
    }
    moveBody(this, 0, 0);
    G.fx.push({ type: "ring", x: this.x, y: this.y, t: 0, T: 0.45, r: R, color: "#c9a2ff" });
    G.fx.push({ type: "dust", x: this.x, y: this.y, t: 0, T: 0.6, r: R });
    sfx(G, "boom", this, 0.8);
  }
}

// Circle vs tile-grid collision: move, then push out of any solid tile.
function moveBody(b, dx, dy) {
  b.x += dx; resolveBody(b);
  b.y += dy; resolveBody(b);
}
function resolveBody(b) {
  const map = G.map, r = b.r;
  b.x = clamp(b.x, r, map.w - r);
  b.y = clamp(b.y, r, map.h - r);
  for (let ty = Math.floor(b.y - r); ty <= Math.floor(b.y + r); ty++) {
    for (let tx = Math.floor(b.x - r); tx <= Math.floor(b.x + r); tx++) {
      if (!solidAt(map, tx + 0.5, ty + 0.5)) continue;
      const cx = clamp(b.x, tx, tx + 1), cy = clamp(b.y, ty, ty + 1);
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 1e-6) { b.x = cx + dx / d * r; b.y = cy + dy / d * r; }
      else {
        // Centre inside the tile: leave through the nearest edge.
        const opts = [[tx - r, b.y, b.x - tx], [tx + 1 + r, b.y, tx + 1 - b.x], [b.x, ty - r, b.y - ty], [b.x, ty + 1 + r, ty + 1 - b.y]];
        opts.sort((a, c) => a[2] - c[2]);
        b.x = opts[0][0]; b.y = opts[0][1];
      }
    }
  }
}

function knock(e, dx, dy, power) {
  const d = Math.hypot(dx, dy) || 1;
  e.kx += dx / d * power * 4;
  e.ky += dy / d * power * 4;
  // Knockback makes the carrier lose the ball.
  if (G.ball && G.ball.holder === e) dropBall(G, dx / d * power * 2, dy / d * power * 2);
}

function visibleTo(team, b) {
  if (b.team === team) return true;
  if (b.dead) return false;
  if (G.ball && G.ball.holder === b) return true;   // the ball gives the carrier away
  if (!b.inBush || b.revealT > 0) return true;
  for (const f of G.brawlers) {
    if (f.team === team && !f.dead && Math.hypot(f.x - b.x, f.y - b.y) < BUSH_REVEAL) return true;
  }
  return false;
}

function sfx(G, name, src, vol = 1) { G.sounds.push({ name, x: src.x, y: src.y, vol }); }

// ---------------------------------------------------------------------------- shots

function spawnShot(G, b, ang, o) {
  const ox = o.offset ? -Math.sin(ang) * o.offset : 0, oy = o.offset ? Math.cos(ang) * o.offset : 0;
  G.shots.push({
    x: b.x + Math.cos(ang) * 0.3 + ox, y: b.y + Math.sin(ang) * 0.3 + oy,
    vx: Math.cos(ang) * o.speed, vy: Math.sin(ang) * o.speed,
    range: o.range, travelled: 0.3, r: o.r, dmg: o.dmg, color: o.color, team: b.team, owner: b,
    knock: o.knock || 0, breakWalls: !!o.breakWalls, isSuper: !!o.isSuper, fist: !!o.fist, ang,
  });
}

function updateShots(G, dt) {
  const map = G.map;
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i];
    const sp = Math.hypot(s.vx, s.vy), n = Math.max(1, Math.ceil(sp * dt / 0.15));
    let dead = false;
    for (let k = 0; k < n && !dead; k++) {
      s.x += s.vx * dt / n; s.y += s.vy * dt / n; s.travelled += sp * dt / n;
      if (s.travelled > s.range || s.x < 0 || s.y < 0 || s.x > map.w || s.y > map.h) { dead = true; break; }
      if (wallAt(map, s.x, s.y)) {
        if (s.breakWalls) breakTile(G, Math.floor(s.x), Math.floor(s.y));
        else { G.fx.push({ type: "spark", x: s.x, y: s.y, t: 0, T: 0.2, color: s.color }); dead = true; break; }
      }
      for (const e of G.brawlers) {
        if (e.team === s.team || e.dead || e.leap) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + s.r) {
          damage(G, e, s.dmg, s.owner, s.isSuper);
          if (s.knock) knock(e, s.vx, s.vy, s.knock);
          G.fx.push({ type: "spark", x: s.x, y: s.y, t: 0, T: 0.25, color: "#fff" });
          dead = true;
          break;
        }
      }
    }
    if (dead) G.shots.splice(i, 1);
  }
}

function lobBomb(G, b, ang, dist, o) {
  G.bombs.push({
    x0: b.x, y0: b.y, x1: b.x + Math.cos(ang) * dist, y1: b.y + Math.sin(ang) * dist,
    t: 0, T: o.T, radius: o.radius, dmg: o.dmg, knock: o.knock || 0, breakWalls: !!o.breakWalls,
    big: !!o.big, color: o.color, team: b.team, owner: b,
  });
}

function updateBombs(G, dt) {
  for (let i = G.bombs.length - 1; i >= 0; i--) {
    const bm = G.bombs[i];
    bm.t += dt;
    if (bm.t < bm.T) continue;
    G.bombs.splice(i, 1);
    const x = clamp(bm.x1, 0, G.map.w), y = clamp(bm.y1, 0, G.map.h);
    if (bm.breakWalls) breakCircle(G, x, y, bm.radius * 0.8);
    for (const e of G.brawlers) {
      if (e.team === bm.team || e.dead || e.leap) continue;
      if (Math.hypot(e.x - x, e.y - y) < bm.radius + e.r * 0.5) {
        damage(G, e, bm.dmg, bm.owner, bm.big);
        if (bm.knock) knock(e, e.x - x, e.y - y, bm.knock);
      }
    }
    G.fx.push({ type: "boom", x, y, t: 0, T: 0.45, r: bm.radius, big: bm.big });
    sfx(G, "boom", { x, y }, bm.big ? 1 : 0.6);
  }
}

function breakTile(G, tx, ty) {
  const map = G.map;
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  const c = map.tiles[ty][tx];
  if (!BREAKABLE.has(c)) return;
  map.tiles[ty][tx] = ".";
  map.version++;
  G.fx.push({ type: "debris", x: tx + 0.5, y: ty + 0.5, t: 0, T: 0.6, color: c === "C" ? "#b87a3a" : "#a47b58",
    bits: Array.from({ length: 6 }, () => ({ a: rand(0, TAU), s: rand(1.5, 3.5) })) });
}

function breakCircle(G, x, y, r) {
  for (let ty = Math.floor(y - r - 1); ty <= Math.floor(y + r + 1); ty++)
    for (let tx = Math.floor(x - r - 1); tx <= Math.floor(x + r + 1); tx++)
      if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) < r + 0.5) breakTile(G, tx, ty);
}

function damage(G, e, amount, src, fromSuper) {
  if (e.shieldT > 0 || e.dead) return;
  amount = Math.round(amount);
  e.hp -= amount;
  e.hitT = 0.12;
  e.combatT = 0;
  e.revealT = Math.max(e.revealT, 0.6);
  if (src) {
    src.stats.dmg += amount;
    if (!fromSuper) src.superC = Math.min(1, src.superC + amount / src.def.superCost);
  }
  G.texts.push({ x: e.x + 0.55 + rand(-0.1, 0.15), y: e.y - 0.35 + rand(-0.15, 0.15), t: 0, T: 0.8, text: String(amount),
    color: e.isPlayer ? "#ff6b6b" : src && src.isPlayer ? "#ffffff" : "#ffe7b0" });
  if (e.isPlayer || (src && src.isPlayer)) sfx(G, "hit", e, 0.8);
  if (e.hp <= 0) kill(G, e, src);
}

function kill(G, e, src) {
  e.hp = 0;
  e.dead = true;
  e.respawnT = RESPAWN_T;
  e.burst = null;
  e.stats.deaths++;
  if (src && src !== e) src.stats.kills++;
  if (G.ball && G.ball.holder === e) dropBall(G, 0, 0);
  // Drop every gem this brawler was carrying.
  for (let i = 0; i < e.gems; i++) {
    const a = rand(0, TAU), s = rand(1.8, 3.6);
    G.gems.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0.3, vz: rand(3, 5), age: 0 });
  }
  e.gems = 0;
  G.fx.push({ type: "poof", x: e.x, y: e.y, t: 0, T: 0.7, color: e.def.color });
  G.feed.push({ killer: src, victim: e, t: G.time });
  if (G.feed.length > 4) G.feed.shift();
  sfx(G, "death", e);
}

// ---------------------------------------------------------------------------- gems

function updateGems(G, dt) {
  const map = G.map;
  G.mineT -= dt;
  if (G.mineT <= 0) {
    G.mineT += GEM_SPAWN_T;
    const a = rand(0, TAU), s = rand(1, 2.2);
    G.gems.push({ x: map.mine.x, y: map.mine.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0.2, vz: 4.5, age: 0 });
    sfx(G, "mine", map.mine, 0.5);
  }
  for (let i = G.gems.length - 1; i >= 0; i--) {
    const g = G.gems[i];
    g.age += dt;
    const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
    if (solidAt(map, nx, g.y)) g.vx *= -0.5; else g.x = nx;
    if (solidAt(map, g.x, ny)) g.vy *= -0.5; else g.y = ny;
    const f = Math.exp(-(g.z > 0 ? 0.5 : 5) * dt);
    g.vx *= f; g.vy *= f;
    if (g.z > 0 || g.vz > 0) {
      g.vz -= 14 * dt; g.z += g.vz * dt;
      if (g.z <= 0) { g.z = 0; g.vz = Math.abs(g.vz) > 2 ? -g.vz * 0.35 : 0; }
    }
    if (g.age < 0.35 || g.z > 0.3) continue;
    let taker = null, bd = 0.75;
    for (const b of G.brawlers) {
      if (b.dead || b.leap) continue;
      const d = Math.hypot(b.x - g.x, b.y - g.y);
      if (d < bd) { bd = d; taker = b; }
    }
    if (taker) {
      taker.gems++;
      taker.stats.gems++;
      G.gems.splice(i, 1);
      if (taker.team === 0) sfx(G, "gem", taker, taker.isPlayer ? 1 : 0.5);
    }
  }
  G.teamGems = [0, 0];
  for (const b of G.brawlers) G.teamGems[b.team] += b.gems;
}

function updateGemRule(G, dt) {
  const [a, b] = G.teamGems;
  const lead = a >= GEM_GOAL && a > b ? 0 : b >= GEM_GOAL && b > a ? 1 : -1;
  if (lead !== G.countTeam) {
    G.countTeam = lead;
    G.countdown = GEM_COUNTDOWN;
    if (lead >= 0) sfx(G, lead === 0 ? "countGood" : "countBad", G.map.mine);
  }
  if (lead < 0) return;
  const before = Math.ceil(G.countdown);
  G.countdown -= dt;
  if (Math.ceil(G.countdown) !== before && G.countdown > 0 && G.countdown <= 5) sfx(G, "tick", G.map.mine, 0.6);
  if (G.countdown <= 0) {
    G.winner = lead;
    G.state = "ending";
    G.overT = 2.2;
    sfx(G, lead === 0 ? "win" : "lose", G.map.mine);
  }
}

// ---------------------------------------------------------------------------- brawl ball

function newBall(G) {
  const s = G.map.ballSpot;
  return { x: s.x, y: s.y, z: 0, vx: 0, vy: 0, holder: null, lob: null, noPick: null, noPickT: 0, last: null, spin: 0 };
}

// Where team t shoots: the middle of the goal the other team defends.
function enemyGoal(t) { return G.map.goals[1 - t]; }

function dropBall(G, vx, vy) {
  const ball = G.ball, h = ball.holder;
  ball.holder = null;
  ball.x = h.x; ball.y = h.y; ball.z = 0;
  ball.vx = vx; ball.vy = vy;
  ball.noPick = h; ball.noPickT = 0.5;
}

function kickBall(G, b, ang) {
  const ball = G.ball;
  ball.holder = null;
  ball.lob = null;
  const fx = b.x + Math.cos(ang) * 0.3, fy = b.y + Math.sin(ang) * 0.3;
  if (solidAt(G.map, fx, fy)) { ball.x = b.x; ball.y = b.y; } else { ball.x = fx; ball.y = fy; }
  ball.z = 0;
  ball.vx = Math.cos(ang) * KICK_SPEED; ball.vy = Math.sin(ang) * KICK_SPEED;
  ball.noPick = b; ball.noPickT = 0.4; ball.last = b;
  sfx(G, "kick", b);
}

// Lob pass: flies over walls and water and can't be caught until it comes down.
function passBall(G, b, ang, dist) {
  const ball = G.ball, map = G.map;
  const d = clamp(dist, BALL_AIM.pass.minRange, PASS_RANGE);
  let tx = clamp(b.x + Math.cos(ang) * d, 0.5, map.w - 0.5), ty = clamp(b.y + Math.sin(ang) * d, 0.5, map.h - 0.5);
  if (solidAt(map, tx, ty) || goalAt(map, tx, ty)) {
    // Never land in a wall, the water or straight in a net: pick the nearest open tile.
    let best = null, bd = 1e9;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const cx = Math.floor(tx) + dx + 0.5, cy = Math.floor(ty) + dy + 0.5;
      if (solidAt(map, cx, cy) || goalAt(map, cx, cy)) continue;
      const e = (cx - tx) ** 2 + (cy - ty) ** 2;
      if (e < bd) { bd = e; best = [cx, cy]; }
    }
    if (best) [tx, ty] = best; else { tx = b.x; ty = b.y; }
  }
  const len = Math.hypot(tx - b.x, ty - b.y);
  ball.holder = null;
  ball.lob = { x0: b.x, y0: b.y, x1: tx, y1: ty, t: 0, T: 0.4 + len * 0.045, h: 0.9 + len * 0.13 };
  ball.x = b.x; ball.y = b.y;
  ball.vx = len ? (tx - b.x) / len * 2 : 0; ball.vy = len ? (ty - b.y) / len * 2 : 0;   // rolls on after landing
  ball.noPick = b; ball.noPickT = ball.lob.T + 0.2; ball.last = b;
  sfx(G, "throw", b);
}

function updateBall(G, dt) {
  const ball = G.ball, map = G.map;
  ball.noPickT -= dt;
  if (ball.holder) {
    const h = ball.holder;
    const fx = h.x + Math.cos(h.faceAng) * 0.34, fy = h.y + Math.sin(h.faceAng) * 0.34;
    if (solidAt(map, fx, fy)) { ball.x = h.x; ball.y = h.y; } else { ball.x = fx; ball.y = fy; }
    ball.z = h.z;
    ball.spin += Math.hypot(h.vx, h.vy) * dt * 3;
  } else if (ball.lob) {
    const L = ball.lob;
    L.t += dt;
    const t = Math.min(1, L.t / L.T);
    ball.x = lerp(L.x0, L.x1, t); ball.y = lerp(L.y0, L.y1, t);
    ball.z = 4 * t * (1 - t) * L.h;
    ball.spin += dt * 12;
    if (t >= 1) { ball.lob = null; ball.z = 0; sfx(G, "bounce", ball, 0.6); }
  } else {
    // Rolls along the ground and bounces off walls, water and the fence.
    const sp = Math.hypot(ball.vx, ball.vy), n = Math.max(1, Math.ceil(sp * dt / 0.1));
    let bounced = false;
    for (let k = 0; k < n; k++) {
      const nx = ball.x + ball.vx * dt / n;
      if (solidAt(map, nx + Math.sign(ball.vx) * BALL_R, ball.y)) { ball.vx *= -0.6; bounced = true; } else ball.x = nx;
      const ny = ball.y + ball.vy * dt / n;
      if (solidAt(map, ball.x, ny + Math.sign(ball.vy) * BALL_R)) { ball.vy *= -0.6; bounced = true; } else ball.y = ny;
    }
    if (bounced && sp > 3) sfx(G, "bounce", ball, Math.min(1, sp / 12));
    const f = Math.exp(-BALL_FRICTION * dt);
    ball.vx *= f; ball.vy *= f;
    if (Math.hypot(ball.vx, ball.vy) < 0.3) { ball.vx = 0; ball.vy = 0; }
    ball.spin += sp * dt * 3;
  }

  // Goal: the ball (on the ground or at the carrier's feet) crosses into a net.
  const h = ball.holder;
  if (ball.z < 0.5 && (goalAt(map, ball.x, ball.y) || (h && goalAt(map, h.x, h.y)))) {
    const y = h && goalAt(map, h.x, h.y) ? h.y : ball.y;
    scoreGoal(G, y < map.h / 2 ? 0 : 1);
    return;
  }

  // Pick up: first brawler to touch a loose ball on the ground gets it, enemies included.
  if (ball.holder || ball.z > 0.5 || G.goalT > 0 || G.state !== "play") return;
  let taker = null, bd = 1e9;
  for (const b of G.brawlers) {
    if (b.dead || b.leap || (b === ball.noPick && ball.noPickT > 0)) continue;
    const d = Math.hypot(b.x - ball.x, b.y - ball.y);
    if (d < b.r + BALL_R + 0.12 && d < bd) { bd = d; taker = b; }
  }
  if (taker) {
    ball.holder = taker;
    ball.last = taker;
    ball.lob = null;
    ball.vx = 0; ball.vy = 0;
    taker.holdT = 0;
    taker.kickReady = false;
    taker.burst = null;
    taker.superQ = null;
    sfx(G, "catch", taker, taker.team === 0 ? 1 : 0.6);
  }
}

function scoreGoal(G, team) {
  if (G.goalT > 0 || G.state !== "play") return;
  const ball = G.ball, s = ball.last;
  G.score[team]++;
  const scorer = s && s.team === team ? s : null;
  if (scorer) scorer.stats.goals++;
  G.lastGoal = { team, scorer, own: !!(s && s.team !== team), t: G.time };
  if (ball.holder) {
    const h = ball.holder;
    ball.holder = null;
    ball.vx = Math.cos(h.faceAng) * 2; ball.vy = (team === 0 ? -1 : 1) * 2;
  }
  ball.noPickT = 99;
  G.fx.push({ type: "ring", x: ball.x, y: ball.y, t: 0, T: 0.8, r: 3, color: TEAM_COLORS[team] });
  sfx(G, "goal", ball);
  if (G.score[team] >= BALL_GOALS || G.overtime) {
    G.winner = team;
    G.state = "ending";
    G.overT = 2.6;
    sfx(G, team === 0 ? "win" : "lose", ball);
  } else {
    G.goalT = GOAL_PAUSE;
  }
}

// After a goal: everyone back to their spawn, ball back in the middle.
function kickoff(G) {
  for (const b of G.brawlers) b.spawn();
  G.shots = []; G.bombs = [];
  G.ball = newBall(G);
  G.kickoffs++;
  G.intro = 2;
}

function updateClock(G, dt) {
  G.clock -= dt;
  if (!G.overtime && G.clock <= 10 && Math.ceil(G.clock) !== Math.ceil(G.clock + dt) && G.clock > 0) sfx(G, "tick", G.map.center, 0.6);
  if (G.clock > 0) return;
  G.clock = 0;
  const [a, b] = G.score;
  if (a === b && !G.overtime) {
    // Tied at the buzzer: sudden death, next goal wins.
    G.overtime = true;
    G.clock = BALL_OVERTIME;
    sfx(G, "whistle", G.map.center);
    return;
  }
  G.winner = a > b ? 0 : b > a ? 1 : -1;
  G.draw = G.winner < 0;
  G.state = "ending";
  G.overT = 2.6;
  sfx(G, G.winner === 0 ? "win" : "lose", G.map.center);
}

// Quick-aim while carrying: kicks go at the enemy goal, passes to the best-placed teammate.
function ballAutoAim(b, kind) {
  const goal = enemyGoal(b.team), gx = goal.cx, gy = goal.line - goal.out * 0.5;
  if (kind === "sup") {
    let best = null, bs = 1e9;
    for (const f of G.brawlers) {
      if (f === b || f.team !== b.team || f.dead) continue;
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      if (d > PASS_RANGE + 1 || d < 1.5) continue;
      const score = Math.hypot(f.x - gx, f.y - gy);
      if (score < bs) { bs = score; best = f; }
    }
    if (best) return { ang: Math.atan2(best.y + best.vy * 0.4 - b.y, best.x + best.vx * 0.4 - b.x), dist: Math.hypot(best.x - b.x, best.y - b.y) };
  }
  return { ang: Math.atan2(gy - b.y, gx - b.x), dist: Math.min(PASS_RANGE, Math.hypot(gx - b.x, gy - b.y)) };
}

// ---------------------------------------------------------------------------- effects

function updateFx(G, dt) {
  for (const list of [G.fx, G.texts]) {
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].t += dt;
      if (list[i].t >= list[i].T) list.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------- setup & step

function newMatch(opts) {
  G.map = buildMap(opts.mapId);
  G.mode = G.map.mode;
  G.level = opts.level;
  G.brawlers = []; G.shots = []; G.bombs = []; G.gems = []; G.fx = []; G.texts = []; G.feed = []; G.sounds = [];
  G.teamGems = [0, 0]; G.countTeam = -1; G.countdown = GEM_COUNTDOWN; G.mineT = 3;
  G.score = [0, 0]; G.clock = BALL_TIME; G.overtime = false; G.goalT = 0; G.lastGoal = null; G.kickoffs = 0;
  G.time = 0; G.intro = 3; G.winner = -1; G.draw = false; G.overT = 0; G.paused = false;
  const keys = Object.keys(BRAWLERS);
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  for (let team = 0; team < 2; team++) {
    const pool = keys.slice().sort(() => Math.random() - 0.5);
    if (team === 0 && opts.playerBrawler) {
      pool.splice(pool.indexOf(opts.playerBrawler), 1);
      pool.unshift(opts.playerBrawler);
    }
    for (let slot = 0; slot < 3; slot++) {
      const isPlayer = team === 0 && slot === 1 && !!opts.playerBrawler;
      const key = isPlayer ? opts.playerBrawler : pool[(slot + (team === 0 ? 1 : 0)) % pool.length];
      const b = new Brawler(key, team, slot, isPlayer ? "You" : names.pop(), isPlayer);
      if (!isPlayer) b.bot = new Bot(b, opts.level);
      G.brawlers.push(b);
    }
  }
  G.player = G.brawlers.find((b) => b.isPlayer) || null;
  G.ball = G.mode === "ball" ? newBall(G) : null;
  G.state = "play";
}

function step(dt, playerInp) {
  if (G.state !== "play" && G.state !== "ending") return;
  G.time += dt;
  updateFx(G, dt);
  if (G.intro > 0) { G.intro -= dt; return; }
  if (G.state === "ending") {
    // Short slow-motion celebration before the results screen.
    G.overT -= dt;
    dt *= 0.3;
    if (G.overT <= 0) { G.state = "over"; return; }
  }
  if (G.goalT > 0) {
    // Goal celebration: play stops while the ball settles in the net, then kick off again.
    G.goalT -= dt;
    if (G.goalT <= 0) { G.goalT = 0; kickoff(G); } else updateBall(G, dt);
    return;
  }
  for (const b of G.brawlers) {
    const inp = b.isPlayer ? (playerInp || {}) : b.bot.control(dt);
    b.update(dt, inp);
  }
  updateShots(G, dt);
  updateBombs(G, dt);
  if (G.mode === "ball") {
    updateBall(G, dt);
    if (G.state === "play" && G.goalT <= 0) updateClock(G, dt);
  } else {
    updateGems(G, dt);
    if (G.state === "play") updateGemRule(G, dt);
  }
}

// Nearest visible enemy for quick-fire (tap) attacks, with a little lead.
function autoAim(b, aim, speed) {
  let best = null, bd = 1e9;
  for (const e of G.brawlers) {
    if (e.team === b.team || e.dead || !visibleTo(b.team, e)) continue;
    const d = Math.hypot(e.x - b.x, e.y - b.y);
    const clear = aim.type === "lob" || aim.type === "leap" || shotClear(G.map, b.x, b.y, e.x, e.y);
    const score = d + (clear ? 0 : 6) + (d > aim.range + 0.5 ? 20 : 0);
    if (score < bd) { bd = score; best = e; }
  }
  if (!best || Math.hypot(best.x - b.x, best.y - b.y) > aim.range * 1.4) return { ang: b.faceAng, dist: aim.range };
  const d = Math.hypot(best.x - b.x, best.y - b.y);
  const t = speed ? d / speed : b.def.lobTime || 0.5;
  const px = best.x + best.vx * t * 0.7, py = best.y + best.vy * t * 0.7;
  return { ang: Math.atan2(py - b.y, px - b.x), dist: Math.hypot(px - b.x, py - b.y) };
}
