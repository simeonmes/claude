"use strict";
// Bots. They see exactly what their team can see (bushes hide enemies from them too),
// path around walls with A*, and drive the same inputs a player does. In Brawl Ball they
// chase loose balls, escort and pass to the carrier, keep one defender home, and shoot
// at the goal when they have a clear lane.

const BOT_LEVELS = {
  easy: { name: "Easy", react: 0.5, aimErr: 0.3, lead: 0, strafe: 0.35, think: 0.35, eager: 0.35, superUse: 0.5, retreat: 0.3 },
  normal: { name: "Normal", react: 0.28, aimErr: 0.14, lead: 0.6, strafe: 0.75, think: 0.2, eager: 0.7, superUse: 0.85, retreat: 0.4 },
  hard: { name: "Hard", react: 0.14, aimErr: 0.06, lead: 0.95, strafe: 1, think: 0.1, eager: 1, superUse: 1, retreat: 0.4 },
};

// Modes where bots stand and trade shots instead of walking to their goal.
const FIGHT_MODES = new Set(["fight", "hold", "press", "escort", "support"]);

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
    const b = this.b, team = b.team;
    // Pick the most attractive visible enemy: close, weak, and actually hittable.
    // In Brawl Ball the enemy carrying the ball is the priority.
    let target = null, best = 1e9;
    for (const e of G.brawlers) {
      if (e.team === team || e.dead || !visibleTo(team, e)) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d > 11) continue;
      const carrier = G.ball && G.ball.holder === e;
      const score = d - (1 - e.hp / e.maxHp) * 2.5 - e.gems * 0.3 - (carrier ? 3 : 0);
      if (score < best) { best = score; target = e; }
    }
    if (target !== this.target) this.seenT = 0;
    this.target = target;
    if (target) this.lastSeen = { x: target.x, y: target.y, t: G.time };
    if (G.mode === "ball") this.thinkBall(target);
    else this.thinkGem(target);
  }

  thinkGem(target) {
    const b = this.b, team = b.team, def = b.def;

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

  // Where a loose ball will be by the time we can reach it.
  ballSpot() {
    const ball = G.ball;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp < 0.3) return { x: ball.x, y: ball.y };
    // Intercept: somewhere along its roll, closer for faster brawlers.
    const t = clamp(Math.hypot(ball.x - this.b.x, ball.y - this.b.y) / (this.b.def.speed + sp), 0, 1.5);
    const k = (1 - Math.exp(-BALL_FRICTION * t)) / BALL_FRICTION;
    return { x: clamp(ball.x + ball.vx * k, 0.6, G.map.w - 0.6), y: clamp(ball.y + ball.vy * k, 0.6, G.map.h - 0.6) };
  }

  thinkBall(target) {
    const b = this.b, team = b.team, ball = G.ball, map = G.map;
    const own = map.goals[team], foe = map.goals[1 - team];
    const hpFrac = b.hp / b.maxHp;
    const tDist = target ? Math.hypot(target.x - b.x, target.y - b.y) : 99;
    const holder = ball.holder;
    const mates = G.brawlers.filter((f) => f.team === team && !f.dead);

    if (holder === b) { this.mode = "carry"; this.goal = { x: foe.cx, y: foe.line - foe.out * 0.4 }; return; }

    // Retreat when badly hurt, unless the ball is right here or our goal is in danger.
    const danger = holder && holder.team !== team && Math.hypot(holder.x - own.cx, holder.y - own.line) < 8;
    if (this.mode === "retreat" && (hpFrac > 0.75 || tDist > 9)) this.mode = "";
    if (hpFrac < this.L.retreat && tDist < 6 && !danger && Math.hypot(ball.x - b.x, ball.y - b.y) > 2) {
      this.mode = "retreat";
      const ax = b.x - target.x, ay = b.y - target.y, a = Math.hypot(ax, ay) || 1;
      this.goal = { x: clamp(b.x + ax / a * 4, 1, map.w - 1), y: clamp(lerp(b.y + ay / a * 4, own.line + own.out * 3, 0.5), 1.5, map.h - 1.5) };
      return;
    }

    // One defender stays home: whoever is closest to our goal, when the ball is in our half
    // or the enemy has it.
    const ballOurHalf = (ball.y - map.h / 2) * -own.out > 0;
    const keeperDist = (f) => Math.hypot(f.x - own.cx, f.y - own.line);
    const keeper = mates.slice().sort((p, q) => keeperDist(p) - keeperDist(q))[0];
    const threat = (holder && holder.team !== team) || (!holder && ballOurHalf);

    if (!holder) {
      // Loose ball: the closest one or two of us go for it.
      const spot = this.ballSpot();
      const dist = (f) => Math.hypot(f.x - spot.x, f.y - spot.y);
      const order = mates.slice().sort((p, q) => dist(p) - dist(q));
      let foeBest = 1e9;
      for (const e of G.brawlers) if (e.team !== team && !e.dead) foeBest = Math.min(foeBest, dist(e));
      const rank = order.indexOf(b);
      if (rank === 0 || (rank === 1 && foeBest < dist(order[0]) + 1.5)) {
        this.mode = "chase";
        this.goal = spot;
        return;
      }
      if (b === keeper && threat) { this.mode = "keeper"; this.goal = this.keeperSpot(spot); return; }
      // Support: stay level with the ball, in a lane, a little on our side of it.
      this.mode = target && tDist < 6 ? "fight" : "support";
      this.goal = { x: clamp(spot.x + this.laneX * 1.4, 1.5, map.w - 1.5), y: clamp(spot.y + own.out * -2.5, 2, map.h - 2) };
      if (this.mode === "fight") this.goal = { x: target.x, y: target.y };
      return;
    }

    if (holder.team === team) {
      // Teammate has it: run ahead into space as a pass target and clear enemies away.
      this.mode = target && tDist < 5.5 ? "fight" : "escort";
      const ahead = clamp(Math.abs(foe.line - holder.y) * 0.5, 2, 5);
      this.goal = { x: clamp(holder.x + this.laneX * 1.3 + (this.laneX === 0 ? 3 : 0), 1.5, map.w - 1.5), y: holder.y - own.out * ahead };
      if (this.mode === "fight") this.goal = { x: target.x, y: target.y };
      return;
    }

    // Enemy has it: keeper guards the net, everyone else hunts the carrier.
    if (b === keeper && mates.length > 1) { this.mode = "keeper"; this.goal = this.keeperSpot(holder); return; }
    this.mode = "press";
    this.target = holder;
    this.goal = { x: holder.x, y: holder.y };
  }

  // Stand between the ball and the middle of our goal, a couple of tiles out.
  keeperSpot(p) {
    const own = G.map.goals[this.b.team];
    const gx = own.cx, gy = own.line + own.out * 0.6;
    const dx = p.x - gx, dy = p.y - gy, d = Math.hypot(dx, dy) || 1;
    const out = Math.min(2.2, d * 0.5);
    return { x: gx + dx / d * out, y: gy + dy / d * out };
  }

  // Carrying the ball: walk it toward the goal, shoot through a clear lane, pass when pressured.
  carry(dt, inp) {
    const b = this.b, L = this.L, map = G.map, foe = map.goals[1 - b.team];
    const enemies = G.brawlers.filter((e) => e.team !== b.team && !e.dead);
    const near = enemies.reduce((m, e) => Math.min(m, Math.hypot(e.x - b.x, e.y - b.y)), 99);
    const toGoal = Math.hypot(foe.cx - b.x, foe.line - b.y);

    // How many enemies stand in the way of a ground kick from here to (x, y)?
    const blockers = (x, y) => {
      const dx = x - b.x, dy = y - b.y, len = Math.hypot(dx, dy) || 1;
      let n = 0;
      for (const e of enemies) {
        const t = clamp(((e.x - b.x) * dx + (e.y - b.y) * dy) / (len * len), 0, 1);
        if (t > 0.05 && Math.hypot(b.x + dx * t - e.x, b.y + dy * t - e.y) < e.r + BALL_R + 0.25) n++;
      }
      return n;
    };
    const hasSuper = b.superC >= 1;
    const kickRange = hasSuper ? BALL_AIM.superKick.range : BALL_AIM.kick.range;
    if (b.ammo < 1 && !hasSuper) return;    // no ammo, no kick: keep dribbling

    const pressured = near < 2.4 || (b.combatT < 0.5 && b.hp < b.maxHp * 0.45);

    // Shot on goal: try spots across the goal mouth and take the best clear one.
    // A kick that stops short still rolls toward the net, so long shots are fine under pressure.
    if (b.holdT > 0.2 && toGoal < kickRange * (pressured ? 1.05 : 0.95)) {
      let bestShot = null, bs = 1e9;
      for (let i = 0; i < 5; i++) {
        const x = lerp(foe.x0 + 0.6, foe.x1 - 0.6, i / 4), y = foe.line - foe.out * 0.6;
        if (!walkClear(map, b.x, b.y, x, y, BALL_R)) continue;
        const score = blockers(x, y) * 5 + Math.abs(x - foe.cx) * 0.2 + Math.random() * 0.5;
        if (score < bs) { bs = score; bestShot = { x, y }; }
      }
      // Close and nobody in the way: shoot. Further out, only when it's worth it.
      // Under pressure it's worth trying to beat one defender rather than losing the ball.
      const worth = bestShot && (bs < 5 || (pressured && bs < 10)) && (toGoal < kickRange * 0.75 || pressured || Math.random() < dt * 3);
      if (worth && !(toGoal < 2 && near > 2.5)) {
        // The Super kick is faster and goes further, so save it for longer shots.
        const ang = Math.atan2(bestShot.y - b.y, bestShot.x - b.x) + (Math.random() - 0.5) * L.aimErr;
        if (hasSuper && (toGoal > BALL_AIM.kick.range * 0.7 || b.ammo < 1)) { inp.super = true; inp.superAng = ang; }
        else if (b.ammo >= 1) { inp.fire = true; inp.fireAng = ang; }
        return;
      }
    }

    // Under pressure: pass to a teammate who is better placed.
    if (b.holdT > 0.3 && pressured) {
      let mate = null, ms = 1e9;
      for (const f of G.brawlers) {
        if (f === b || f.team !== b.team || f.dead) continue;
        const d = Math.hypot(f.x - b.x, f.y - b.y);
        if (d < 2 || d > BALL_AIM.kick.range * 0.8) continue;
        const fGoal = Math.hypot(foe.cx - f.x, foe.line - f.y);
        const fNear = enemies.reduce((m, e) => Math.min(m, Math.hypot(e.x - f.x, e.y - f.y)), 99);
        if (fNear < 2) continue;
        const score = fGoal - toGoal - fNear * 0.5;
        if (score < ms) { ms = score; mate = f; }
      }
      if (mate && Math.random() < L.eager * dt * 8) {
        const lead = 0.5, px = mate.x + mate.vx * lead, py = mate.y + mate.vy * lead;
        const ang = Math.atan2(py - b.y, px - b.x) + (Math.random() - 0.5) * L.aimErr;
        // Passes are just kicks along the ground, so they need an open lane.
        if (b.ammo >= 1 && walkClear(map, b.x, b.y, px, py, BALL_R) && !blockers(px, py)) {
          inp.fire = true; inp.fireAng = ang;
          return;
        }
      }
      // Nobody to pass to and about to be defeated: boot it up the pitch, away from the enemies.
      if (b.combatT < 0.5 && b.hp < b.maxHp * 0.3) {
        let bestAng = null, bs = -1e9;
        for (let i = -3; i <= 3; i++) {
          const a = Math.atan2(foe.line - b.y, foe.cx - b.x) + i * 0.3;
          const x = b.x + Math.cos(a) * 6, y = b.y + Math.sin(a) * 6;
          const room = walkClear(map, b.x, b.y, x, y, BALL_R) ? 3 : 0;
          const score = room - blockers(x, y) * 4 - Math.abs(i) * 0.4;
          if (score > bs) { bs = score; bestAng = a; }
        }
        const ang = bestAng + (Math.random() - 0.5) * L.aimErr;
        if (b.ammo >= 1) { inp.fire = true; inp.fireAng = ang; } else { inp.super = true; inp.superAng = ang; }
      }
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
    const engaged = target && FIGHT_MODES.has(this.mode) && tDist < def.aim.range + 3;

    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = rand(0.5, 1.4); }

    if (engaged && (clear || def.aim.type === "lob")) {
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
      } else if (this.mode === "mine" || this.mode === "hold" || this.mode === "support" || this.mode === "keeper") {
        mvx = -this.strafe * 0.3;   // idle shuffle
      }
    }
    // Dribbling: veer away from enemies closing in on the ball.
    if (this.mode === "carry" && walking) {
      const len = Math.hypot(mvx, mvy) || 1;
      mvx /= len; mvy /= len;
      for (const e of G.brawlers) {
        if (e.team === b.team || e.dead) continue;
        const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy);
        if (d > 3.5 || d < 1e-3) continue;
        const w = (3.5 - d) / 3.5 * 0.9;
        mvx += dx / d * w; mvy += dy / d * w;
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
    if (G.ball && G.ball.holder === b) { this.carry(dt, inp); return inp; }
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
