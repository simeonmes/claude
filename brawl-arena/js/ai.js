"use strict";
// Bots. They see exactly what their team can see (bushes hide enemies from them too),
// path around walls with A*, and drive the same inputs a player does.

const BOT_LEVELS = {
  easy: { name: "Easy", react: 0.5, aimErr: 0.3, lead: 0, strafe: 0.35, think: 0.35, eager: 0.35, superUse: 0.5, retreat: 0.25 },
  normal: { name: "Normal", react: 0.28, aimErr: 0.14, lead: 0.6, strafe: 0.75, think: 0.2, eager: 0.7, superUse: 0.85, retreat: 0.35 },
  hard: { name: "Hard", react: 0.14, aimErr: 0.06, lead: 0.95, strafe: 1, think: 0.1, eager: 1, superUse: 1, retreat: 0.4 },
};

class Bot {
  constructor(b, level) {
    this.b = b;
    this.L = BOT_LEVELS[level] || BOT_LEVELS.normal;
    this.mode = "mine";
    this.goal = null;
    this.path = null;
    this.pathGoal = null;
    this.pathT = 0;
    this.thinkT = Math.random() * 0.2;
    this.target = null;
    this.seenT = 0;
    this.lastSeen = null;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = rand(0.5, 1.2);
    this.stuckT = 0;
    this.errAng = 0;
    this.laneX = [-3.5, 0, 3.5][b.slot] ?? 0;
  }

  home() {
    const sp = G.map.spawns[this.b.team][1];
    return { x: sp.x, y: sp.y };
  }

  think() {
    const b = this.b, team = b.team, def = b.def;
    // Pick the most attractive visible enemy: close, weak, and actually hittable.
    let target = null, best = 1e9;
    for (const e of G.brawlers) {
      if (e.team === team || e.dead || !visibleTo(team, e)) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d > 11) continue;
      const score = d - (1 - e.hp / e.maxHp) * 2.5 - e.gems * 0.3;
      if (score < best) { best = score; target = e; }
    }
    if (target !== this.target) this.seenT = 0;
    this.target = target;
    if (target) this.lastSeen = { x: target.x, y: target.y, t: G.time };

    const mine = G.teamGems[team], theirs = G.teamGems[1 - team];
    const leading = mine >= GEM_GOAL && mine > theirs;
    const hpFrac = b.hp / b.maxHp;
    const tDist = target ? Math.hypot(target.x - b.x, target.y - b.y) : 99;
    const home = this.home();
    const dirHome = team === 0 ? 1 : -1;   // +y is toward blue's end

    if (this.mode === "retreat" && (hpFrac > 0.8 || (tDist > 9 && hpFrac > 0.55))) this.mode = "mine";
    if (hpFrac < this.L.retreat && tDist < 7.5) this.mode = "retreat";
    else if (this.mode !== "retreat") {
      // Loose gems nearby?
      let gem = null, gd = 1e9;
      for (const g of G.gems) {
        const d = Math.hypot(g.x - b.x, g.y - b.y);
        if (d < gd) { gd = d; gem = g; }
      }
      if (leading && b.gems >= 2) this.mode = "hold";
      else if (gem && gd < 10 && !(target && tDist < 2.5 && def.prefRange > 3)) { this.mode = "gem"; this.goal = { x: gem.x, y: gem.y }; }
      else if (target) this.mode = "fight";
      else if (this.lastSeen && G.time - this.lastSeen.t < 2.5) { this.mode = "hunt"; this.goal = { x: this.lastSeen.x, y: this.lastSeen.y }; }
      else this.mode = "mine";
    }

    if (this.mode === "retreat") {
      const ax = target ? b.x - target.x : 0, ay = target ? b.y - target.y : dirHome;
      const a = Math.hypot(ax, ay) || 1;
      this.goal = { x: clamp(b.x + ax / a * 4, 1, G.map.w - 1), y: clamp(lerp(b.y + ay / a * 4, home.y, 0.5), 1, G.map.h - 1) };
    } else if (this.mode === "hold") {
      this.goal = { x: clamp(home.x + this.laneX, 1, G.map.w - 1), y: G.map.mine.y + dirHome * 9 };
    } else if (this.mode === "fight") {
      this.goal = { x: target.x, y: target.y };
    } else if (this.mode === "mine") {
      // Gem carriers hang back a little; everyone else holds the middle.
      const back = b.gems >= 3 ? 5 : 1.5;
      this.goal = { x: G.map.mine.x + this.laneX, y: G.map.mine.y + dirHome * back };
    }
  }

  control(dt) {
    const b = this.b, L = this.L, def = b.def;
    const inp = { mx: 0, my: 0, aimAng: null, fire: false, super: false };
    if (b.dead || b.leap) return inp;

    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.think(); this.thinkT = L.think * rand(0.8, 1.25); }
    const target = this.target && !this.target.dead && visibleTo(b.team, this.target) ? this.target : null;
    if (target) this.seenT += dt;

    // ---- movement
    let mvx = 0, mvy = 0, walking = false;
    const tDist = target ? Math.hypot(target.x - b.x, target.y - b.y) : 99;
    const clear = target && shotClear(G.map, b.x, b.y, target.x, target.y);
    const engaged = target && (this.mode === "fight" || this.mode === "hold" || this.mode === "gem") && tDist < def.aim.range + 3;

    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = rand(0.5, 1.4); }

    if (engaged && (clear || def.aim.type === "lob") && this.mode !== "gem") {
      // Keep at our preferred range and sidestep to dodge.
      const ux = (target.x - b.x) / tDist, uy = (target.y - b.y) / tDist;
      let want = def.prefRange;
      if (b.gems >= 4) want += 1.5;
      if (b.ammo < 1 && def.prefRange > 2) want += 2;
      const radial = clamp((tDist - want) / 1.5, -1, 1);
      mvx = ux * radial - uy * this.strafe * L.strafe;
      mvy = uy * radial + ux * this.strafe * L.strafe;
    } else if (this.goal) {
      const g = this.goal;
      if (Math.hypot(g.x - b.x, g.y - b.y) > 0.4) {
        const wp = this.nextWaypoint(dt);
        if (wp) { mvx = wp.x - b.x; mvy = wp.y - b.y; walking = true; }
      } else if (this.mode === "mine" || this.mode === "hold") {
        mvx = -this.strafe * 0.3;   // idle shuffle
      }
    }
    // Walking to a goal is always full speed; fighting footwork can be gentler.
    const m = Math.hypot(mvx, mvy);
    if (m > 1e-6) {
      const k = walking ? 1 / m : 1 / Math.max(m, 1);
      inp.mx = mvx * k; inp.my = mvy * k;
    }

    // Unstick: if we want to move but aren't, flip the sidestep and repath.
    if (Math.hypot(inp.mx, inp.my) > 0.5 && Math.hypot(b.vx, b.vy) < 0.4) {
      this.stuckT += dt;
      if (this.stuckT > 0.35) { this.strafe *= -1; this.path = null; this.stuckT = 0; }
    } else this.stuckT = 0;

    // ---- attacking
    if (!target || this.seenT < L.react) return inp;
    const aim = def.aim;
    const isLob = aim.type === "lob";
    if (!clear && !isLob) return inp;

    const lead = L.lead;
    const flight = isLob ? def.lobTime : tDist / (def.shotSpeed || 15);
    const px = target.x + target.vx * flight * lead, py = target.y + target.vy * flight * lead;
    const ang = Math.atan2(py - b.y, px - b.x);
    const dist = Math.hypot(px - b.x, py - b.y);

    if (b.cool <= 0 && b.ammo >= 1 && !b.burst) {
      // Shotguns spread out, so wait until most pellets would land (unless ammo is full).
      const reach = aim.type === "cone" && b.ammo < 2.6 ? aim.range * 0.65 : aim.range * 0.95;
      const inRange = dist < reach && (!aim.minRange || dist > aim.minRange * 0.8);
      const willing = b.ammo >= 2.6 || tDist < aim.range * 0.55 || Math.random() < L.eager * dt * 6;
      if (inRange && willing) {
        this.errAng = (Math.random() + Math.random() - 1) * L.aimErr;
        inp.fire = true;
        inp.fireAng = ang + this.errAng;
        inp.fireDist = dist * rand(1 - L.aimErr * 0.6, 1 + L.aimErr * 0.6);
        inp.aimAng = inp.fireAng;
      }
    }
    if (!inp.fire && b.superC >= 1 && !b.burst && Math.random() < L.superUse * dt * 4) {
      const sa = def.superAim;
      const good = sa.type === "leap" ? dist < sa.range && dist > 1.5
        : sa.type === "lob" ? dist < sa.range * 0.95 && dist > 1.5
        : dist < (b.key === "buck" ? 4.5 : sa.range * 0.8);
      if (good) {
        inp.super = true;
        inp.superAng = ang + (Math.random() - 0.5) * L.aimErr;
        inp.superDist = dist;
      }
    }
    return inp;
  }

  nextWaypoint(dt) {
    const b = this.b, g = this.goal;
    // Walk straight when nothing's in the way.
    if (walkClear(G.map, b.x, b.y, g.x, g.y, b.r + 0.05)) { this.path = null; return g; }
    this.pathT -= dt;
    const moved = !this.pathGoal || Math.hypot(this.pathGoal.x - g.x, this.pathGoal.y - g.y) > 1.2;
    if (!this.path || moved || this.pathT <= 0) {
      this.path = findPath(G.map, b.x, b.y, g.x, g.y) || [];
      this.pathGoal = { x: g.x, y: g.y };
      this.pathT = 1;
    }
    // Skip ahead to the furthest waypoint we can walk to directly.
    while (this.path.length > 1 && walkClear(G.map, b.x, b.y, this.path[1].x, this.path[1].y, b.r + 0.05)) this.path.shift();
    if (this.path.length && Math.hypot(this.path[0].x - b.x, this.path[0].y - b.y) < 0.3) this.path.shift();
    return this.path[0] || g;
  }
}
