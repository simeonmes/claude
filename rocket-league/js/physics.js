"use strict";
// Car and ball physics. Constants are Rocket League's, scaled to this arena (the ball
// is ~0.64x RL size) and sped up 1.35x in time, since Sideswipe plays faster than RL.

const P = {
  G: 760,
  CAR_LEN: 78, CAR_H: 26, CAR_W: 54, RIDE: 19, WHEEL_R: 10,
  MAX_THROTTLE: 1210, THROTTLE_ACC: 1860, BRAKE: 4000, COAST: 600,
  MAX_SPEED: 1980, BOOST_ACC: 1150, SUPERSONIC: 1760,
  STICK_THROTTLE: 1.3, STICK_IDLE: 0.45,
  JUMP_V: 255, JUMP_HOLD_ACC: 1700, JUMP_HOLD_T: 0.15, DOUBLE_JUMP_V: 255,
  DODGE_V: 440, DODGE_T: 0.5, STALL_T: 0.42,
  AIR_ROT_MAX: 7.4, AIR_ROT_ACC: 42, AIR_ROT_DAMP: 5, ROLL_SPEED: 7.4,
  BOOST_MAX: 100, BOOST_DRAIN: 45, BOOST_REGEN: 62,
  BALL_R: 58, BALL_MAX: 5000, BALL_REST: 0.6, BALL_DRAG: 0.03,
  BALL_MASS: 30, CAR_MASS: 180,
};

function throttleAcc(speed) {
  return speed >= P.MAX_THROTTLE ? 0 : P.THROTTLE_ACC * (1 - 0.9 * (speed / P.MAX_THROTTLE));
}

class Car {
  constructor(opts) {
    this.team = opts.team;           // 0 = blue (defends left), 1 = orange (defends right)
    this.name = opts.name;
    this.human = !!opts.human;
    this.localIndex = opts.localIndex ?? -1;
    this.color = opts.color;
    this.colorDark = opts.colorDark;
    this.bot = opts.bot || null;
    this.stats = { goals: 0, shots: 0, saves: 0, touches: 0 };
    this.trail = [];
    this.engine = null;
  }

  place(A, spawnX) {
    this.grounded = true;
    this.s = floorS(A, spawnX);
    this.ds = 0;
    const p = pathAt(A, this.s);
    this.face = Math.sign(p.tx) === -Math.sign(spawnX) ? 1 : -1; // nose toward midfield
    this.boost = P.BOOST_MAX;
    this.angVel = 0;
    this.hasJumped = false;
    this.flipAvailable = false;
    this.jumpHoldT = 0;
    this.dodgeT = 0;
    this.stallT = 0;
    this.airTime = 0;
    this.prevJump = false;
    this.latch = null;
    this.wheelAngle = 0;
    this.resetFlash = 0;
    this.angAnim = 0;
    this.rollAnim = 0;
    this.touchCd = 0;
    this.boosting = false;
    this.ballWheelContact = false;
    this.trail.length = 0;
    this.syncGround(A);
    this.snapPrev();
  }

  snapPrev() { this.px = this.x; this.py = this.y; this.pang = this.ang + this.angAnim; }

  nose() { return { x: Math.cos(this.ang), y: Math.sin(this.ang) }; }
  mirror() { return Math.cos(this.roll) >= 0 ? 1 : -1; }
  up() {
    const m = this.mirror();
    return { x: Math.sin(this.ang) * m, y: -Math.cos(this.ang) * m };
  }
  halfT() {
    return 0.5 * (P.CAR_H * Math.abs(Math.cos(this.roll)) + P.CAR_W * Math.abs(Math.sin(this.roll)));
  }
  get speed() { return Math.hypot(this.vx, this.vy); }

  syncGround(A) {
    const p = pathAt(A, this.s);
    this.gp = p;
    this.x = p.x - p.nx * P.RIDE;
    this.y = p.y - p.ny * P.RIDE;
    this.vx = p.tx * this.ds;
    this.vy = p.ty * this.ds;
    this.ang = Math.atan2(this.face * p.ty, this.face * p.tx);
    // With the nose along face*T, the unmirrored roof would point along face*n
    // (into the wall), so a car with face > 0 is drawn mirrored (roll = pi).
    this.roll = this.face > 0 ? Math.PI : 0;
  }

  update(dt, inp, game) {
    const A = game.arena;
    const jumpPressed = inp.jump && !this.prevJump;
    this.prevJump = inp.jump;
    this.touchCd -= dt;
    this.resetFlash -= dt;
    this.angAnim *= Math.max(0, 1 - 14 * dt);
    this.rollAnim *= Math.max(0, 1 - 10 * dt);

    if (game.frozen) {
      this.boosting = false;
      if (this.grounded) { this.ds = 0; this.syncGround(A); }
      return;
    }

    this.boosting = inp.boost && this.boost > 0.5;
    if (this.grounded) this.updateGround(dt, inp, jumpPressed, game);
    else this.updateAir(dt, inp, jumpPressed, game);

    if (this.boosting) this.boost = Math.max(0, this.boost - P.BOOST_DRAIN * dt);
    else if (this.grounded || this.ballWheelContact) this.boost = Math.min(P.BOOST_MAX, this.boost + P.BOOST_REGEN * dt);
    this.ballWheelContact = false;

    // wheels spin with ground speed, and keep spinning (slowing) in the air
    if (this.grounded) this.wheelSpin = (this.ds * this.face) / P.WHEEL_R;
    else this.wheelSpin = (this.wheelSpin || 0) * (1 - 0.6 * dt);
    this.wheelAngle += this.wheelSpin * dt;

    const sp = this.speed;
    this.supersonic = sp > P.SUPERSONIC;
    const n = this.nose();
    this.trail.unshift({ x: this.x - n.x * 40, y: this.y - n.y * 40, ss: this.supersonic });
    if (this.trail.length > 14) this.trail.pop();
  }

  updateGround(dt, inp, jumpPressed, game) {
    const A = game.arena;
    const p = pathAt(A, this.s);

    // Which way along the surface the stick asks for. The choice latches while the stick
    // is held in roughly the same direction, so holding "right" keeps the car driving
    // forward up a quarterpipe, up the wall and onto the ceiling without reversing.
    let want = 0;
    const mag = Math.hypot(inp.sx, inp.sy);
    if (mag > 0.2) {
      const ux = inp.sx / mag, uy = inp.sy / mag;
      if (this.latch && ux * this.latch.ux + uy * this.latch.uy > 0.7) {
        want = this.latch.dir;
      } else {
        const proj = ux * p.tx + uy * p.ty;
        if (Math.abs(proj) > 0.3) want = Math.sign(proj);
        else if (Math.abs(p.ty) > 0.3) {
          // Stick pointing straight into or away from a wall: into climbs, away descends.
          const into = ux * p.nx + uy * p.ny;
          const climb = p.ty < 0 ? 1 : -1;
          want = into > 0 ? climb : -climb;
        }
        this.latch = want ? { ux, uy, dir: want } : null;
      }
    } else {
      this.latch = null;
    }

    const spd = Math.abs(this.ds), mdir = Math.sign(this.ds);
    if (want !== 0) {
      if (mdir !== 0 && want !== mdir) {
        const dv = P.BRAKE * dt;
        this.ds = spd <= dv ? 0 : this.ds + want * dv;
      } else {
        this.ds += want * throttleAcc(spd) * dt;
      }
    } else {
      const dv = P.COAST * dt;
      this.ds = spd <= dv ? 0 : this.ds - mdir * dv;
    }
    if (this.boosting) this.ds += this.face * P.BOOST_ACC * dt;
    this.ds += P.G * p.ty * dt; // gravity along the surface
    this.ds = clamp(this.ds, -P.MAX_SPEED, P.MAX_SPEED);

    this.s = (((this.s + this.ds * dt) % A.perim) + A.perim) % A.perim;
    this.syncGround(A);

    if (jumpPressed) { this.leaveGround(A, true); game.emit("jump", this); return; }

    // Stay attached only while the surface can still push on the wheels: the needed
    // centripetal force, gravity's normal component and the sticky force must net >= 0.
    const q = this.gp, g = q.seg;
    let k = 0;
    if (g.type === "arc") k = g.concave ? 1 / (g.r - P.RIDE) : -1 / (g.r + P.RIDE);
    const S = (want !== 0 ? P.STICK_THROTTLE : P.STICK_IDLE) * P.G;
    if (this.ds * this.ds * k + P.G * q.ny + S < 0) {
      this.leaveGround(A, false);
      this.angVel = this.ds * k;
    }
  }

  leaveGround(A, jumped) {
    const p = this.gp;
    this.grounded = false;
    this.hasJumped = true;
    this.flipAvailable = true; // driving off a ledge still leaves one flip, as in RL
    this.airTime = 0;
    this.dodgeT = 0;
    this.stallT = 0;
    this.angVel = 0;
    this.latch = null;
    this.x -= p.nx * 2;
    this.y -= p.ny * 2;
    if (jumped) {
      const u = this.up();
      this.vx += u.x * P.JUMP_V;
      this.vy += u.y * P.JUMP_V;
      this.jumpHoldT = P.JUMP_HOLD_T;
    } else {
      this.jumpHoldT = 0;
    }
  }

  updateAir(dt, inp, jumpPressed, game) {
    const A = game.arena;
    this.airTime += dt;

    if (this.jumpHoldT > 0) {
      if (inp.jump) {
        const u = this.up();
        this.vx += u.x * P.JUMP_HOLD_ACC * dt;
        this.vy += u.y * P.JUMP_HOLD_ACC * dt;
        this.jumpHoldT -= dt;
      } else {
        this.jumpHoldT = 0;
      }
    }

    const rollIn = (inp.rollR ? 1 : 0) - (inp.rollL ? 1 : 0);

    if (jumpPressed && this.flipAvailable && this.airTime > 0.04) {
      const dx = Math.abs(inp.sx) > 0.35 ? Math.sign(inp.sx) : 0;
      if (dx !== 0 && rollIn === -dx) {
        // Stall: air roll one way + flip the other cancels the flip into a hover.
        this.stallT = P.STALL_T;
        this.vy = Math.min(this.vy, 0) * 0.2;
        this.vx *= 0.85;
        game.emit("stall", this);
      } else if (dx !== 0) {
        this.dodgeT = P.DODGE_T;
        this.dodgeSpin = (dx * TAU) / P.DODGE_T;
        this.vx += dx * P.DODGE_V;
        this.vy = this.vy > 0 ? this.vy * 0.2 : this.vy * 0.7;
        game.emit("dodge", this);
      } else {
        const u = this.up();
        this.vx += u.x * P.DOUBLE_JUMP_V;
        this.vy += u.y * P.DOUBLE_JUMP_V;
        game.emit("jump", this);
      }
      this.flipAvailable = false;
      this.jumpHoldT = 0;
    }

    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      this.angVel = this.dodgeSpin;
      if (this.dodgeT <= 0) this.angVel *= 0.15;
    } else {
      const mag = Math.hypot(inp.sx, inp.sy);
      if (mag > 0.25) {
        // The stick aims the nose.
        const err = wrapAngle(Math.atan2(inp.sy, inp.sx) - this.ang);
        const desired = clamp(err * 10, -P.AIR_ROT_MAX, P.AIR_ROT_MAX);
        this.angVel += clamp(desired - this.angVel, -P.AIR_ROT_ACC * dt, P.AIR_ROT_ACC * dt);
      } else {
        this.angVel *= Math.max(0, 1 - P.AIR_ROT_DAMP * dt);
      }
    }
    this.ang = wrapAngle(this.ang + this.angVel * dt);
    if (rollIn !== 0) this.roll = wrapAngle(this.roll + rollIn * P.ROLL_SPEED * dt);

    const gScale = this.stallT > 0 ? 0.05 : 1;
    this.stallT -= dt;
    this.vy += P.G * gScale * dt;
    if (this.boosting) {
      const n = this.nose();
      this.vx += n.x * P.BOOST_ACC * dt;
      this.vy += n.y * P.BOOST_ACC * dt;
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > P.MAX_SPEED) { this.vx *= P.MAX_SPEED / sp; this.vy *= P.MAX_SPEED / sp; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.collideAir(game);
  }

  collideAir(game) {
    const A = game.arena;
    const n = this.nose(), u = this.up(), ht = this.halfT();
    let hit = null;
    for (const t of [-30, 0, 30]) {
      const nb = pathNearest(A, this.x + n.x * t, this.y + n.y * t);
      const pen = nb.sd + ht;
      if (pen > 0 && (!hit || pen > hit.pen)) hit = { nb, pen };
    }
    for (const t of [-26, 26]) {
      const nb = pathNearest(A, this.x + n.x * t - u.x * P.RIDE, this.y + n.y * t - u.y * P.RIDE);
      if (nb.sd > 0 && (!hit || nb.sd > hit.pen)) hit = { nb, pen: nb.sd, wheel: true };
    }
    if (!hit) return;

    const nb = hit.nb;
    const align = -(u.x * nb.nx + u.y * nb.ny); // 1 when the wheels face the surface
    const vn = this.vx * nb.nx + this.vy * nb.ny; // speed into the surface

    if (align > 0.45 || (align > -0.2 && vn < 380) || vn < 240) {
      this.land(game, vn);
      return;
    }
    // Hit roof- or nose-first at speed: bounce, and tip the wheels toward the surface.
    this.x -= nb.nx * hit.pen;
    this.y -= nb.ny * hit.pen;
    if (vn > 0) {
      this.vx -= 1.3 * vn * nb.nx;
      this.vy -= 1.3 * vn * nb.ny;
    }
    const dA = wrapAngle(Math.atan2(-nb.ny, -nb.nx) - Math.atan2(u.y, u.x));
    this.angVel = this.angVel * 0.4 + clamp(dA, -1, 1) * 5;
    this.dodgeT = 0;
    game.emit("bump", this, { power: clamp(vn / 1200, 0, 1) });
  }

  land(game, impact) {
    const A = game.arena;
    const c = pathNearest(A, this.x, this.y);
    const p = pathAt(A, c.s);
    const n = this.nose();
    const oldAng = this.ang, oldRoll = this.roll;
    this.s = c.s;
    this.face = n.x * p.tx + n.y * p.ty >= 0 ? 1 : -1;
    this.ds = this.vx * p.tx + this.vy * p.ty;
    this.grounded = true;
    this.hasJumped = false;
    this.flipAvailable = false;
    this.jumpHoldT = 0;
    this.dodgeT = 0;
    this.stallT = 0;
    this.angVel = 0;
    this.syncGround(A);
    // Ease the body into its new orientation instead of snapping (also animates a
    // car that landed on its roof rolling back onto its wheels).
    this.angAnim = wrapAngle(oldAng - this.ang);
    this.rollAnim = wrapAngle(oldRoll - this.roll);
    if (impact > 160) game.emit("land", this, { power: clamp(impact / 1400, 0, 1) });
  }

  // Apply a velocity change from a collision. A grounded car only gets knocked off its
  // surface when the push away from it is strong enough.
  applyImpulse(dvx, dvy, A) {
    if (this.grounded) {
      const p = this.gp;
      const away = -(dvx * p.nx + dvy * p.ny);
      if (away > 220) {
        this.leaveGround(A, false);
        this.vx += dvx;
        this.vy += dvy;
      } else {
        this.ds += dvx * p.tx + dvy * p.ty;
      }
    } else {
      this.vx += dvx;
      this.vy += dvy;
    }
  }

  nudge(px, py, A) {
    if (this.grounded) {
      const p = this.gp;
      this.s = (((this.s + px * p.tx + py * p.ty) % A.perim) + A.perim) % A.perim;
      this.syncGround(A);
    } else {
      this.x += px;
      this.y += py;
    }
  }
}

class Ball {
  constructor() { this.r = P.BALL_R; }

  place(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.spin = 0; this.angle = 0;
    this.frozen = true; // kickoff ball hangs until the first touch
    this.lastTouch = null;
    this.touchedSurface = false;
    this.px = x; this.py = y;
  }

  snapPrev() { this.px = this.x; this.py = this.y; }

  get speed() { return Math.hypot(this.vx, this.vy); }

  update(dt, game) {
    if (this.frozen) return;
    const A = game.arena, R = this.r;
    this.vy += P.G * dt;
    const drag = 1 - P.BALL_DRAG * dt;
    this.vx *= drag; this.vy *= drag;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > P.BALL_MAX) { this.vx *= P.BALL_MAX / sp; this.vy *= P.BALL_MAX / sp; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.spin * dt;

    for (let i = 0; i < 2; i++) {
      const nb = pathNearest(A, this.x, this.y);
      const pen = nb.sd + R;
      if (pen <= 0) break;
      this.touchedSurface = true;
      this.x -= nb.nx * pen;
      this.y -= nb.ny * pen;
      const vn = this.vx * nb.nx + this.vy * nb.ny;
      if (vn > 0) {
        this.vx -= (1 + P.BALL_REST) * vn * nb.nx;
        this.vy -= (1 + P.BALL_REST) * vn * nb.ny;
        if (vn > 180) game.emit("ballBounce", null, { power: clamp(vn / 2500, 0, 1), x: this.x + nb.nx * R, y: this.y + nb.ny * R });
      }
      // Friction at the contact point couples spin and sliding: a solid sphere stops
      // slipping once v_t + w*R = 0, which takes an impulse of slip/3.5.
      const tx = -nb.ny, ty = nb.nx;
      const slip = this.vx * tx + this.vy * ty + this.spin * R;
      const f = vn > 0 ? clamp(vn / 600, 0.15, 1) * 0.6 : Math.min(1, 10 * dt);
      const J = (-slip / 3.5) * f;
      this.vx += tx * J;
      this.vy += ty * J;
      this.spin += (2.5 * J) / R;
    }
  }
}

// Ball vs the car's box hitbox, with Rocket League's extra "Psyonix" hit impulse that
// makes shots feel punchy (and depend on where on the car the ball is struck).
function collideCarBall(car, ball, game) {
  const R = ball.r;
  const n = car.nose(), u = car.up(), ht = car.halfT(), hl = P.CAR_LEN / 2;
  const dx = ball.x - car.x, dy = ball.y - car.y;
  const lx = dx * n.x + dy * n.y, ly = dx * u.x + dy * u.y;
  if (Math.abs(lx) > hl + R || Math.abs(ly) > ht + R) return false;
  const cx = clamp(lx, -hl, hl), cy = clamp(ly, -ht, ht);
  const qx = car.x + n.x * cx + u.x * cy, qy = car.y + n.y * cx + u.y * cy;
  let nx = ball.x - qx, ny = ball.y - qy;
  const d = Math.hypot(nx, ny);
  if (d >= R) return false;
  if (d < 1e-6) {
    const s = ly >= 0 ? 1 : -1;
    nx = u.x * s; ny = u.y * s;
  } else {
    nx /= d; ny /= d;
  }
  const pen = R - d;
  ball.x += nx * pen;
  ball.y += ny * pen;

  const wasFrozen = ball.frozen;
  ball.frozen = false;

  const rx = qx - car.x, ry = qy - car.y;
  const cvx = car.vx - car.angVel * ry, cvy = car.vy + car.angVel * rx;
  const rvx = ball.vx - cvx, rvy = ball.vy - cvy;
  const vn = rvx * nx + rvy * ny;
  let power = 0;
  const freshTouch = car.touchCd <= 0;

  if (vn < 0) {
    const invMb = 1 / P.BALL_MASS;
    const invMc = car.grounded ? 1 / (P.CAR_MASS * 3) : 1 / P.CAR_MASS;
    const j = (-(1 + 0.4) * vn) / (invMb + invMc);
    ball.vx += nx * j * invMb;
    ball.vy += ny * j * invMb;
    car.applyImpulse(-nx * j * invMc, -ny * j * invMc, game.arena);

    if (freshTouch) {
      const rel = Math.hypot(rvx, rvy);
      let hx = ball.x - car.x, hy = (ball.y - car.y) * 0.35;
      let hm = Math.hypot(hx, hy) || 1;
      hx /= hm; hy /= hm;
      const f = hx * n.x + hy * n.y;
      hx -= 0.35 * f * n.x; hy -= 0.35 * f * n.y;
      hm = Math.hypot(hx, hy) || 1;
      hx /= hm; hy /= hm;
      const rs = Math.min(rel, 3956);
      const scale = rs <= 430 ? 0.65
        : rs <= 1978 ? lerp(0.65, 0.55, (rs - 430) / 1548)
        : lerp(0.55, 0.3, (rs - 1978) / 1978);
      ball.vx += hx * rs * scale;
      ball.vy += hy * rs * scale;
      power = clamp(rel / 2200, 0, 1);
    }
    // Contact friction spins the ball. The contact point sits at -R*n from the ball's
    // centre (n points car -> ball), so the spin's surface speed there is -w*R along t.
    const tx = -ny, ty = nx;
    const slip = rvx * tx + rvy * ty - ball.spin * R;
    ball.spin += (2.5 * slip * 0.25) / (3.5 * R);
  }

  // Wheels against the ball: refills boost, and in the air restores the flip.
  if (-(nx * u.x + ny * u.y) > 0.6) {
    car.ballWheelContact = true;
    if (!car.grounded && !car.flipAvailable && car.dodgeT <= 0) {
      car.flipAvailable = true;
      car.resetFlash = 1.1;
      game.emit("flipReset", car);
    }
  }

  if (freshTouch) {
    car.touchCd = 0.1;
    car.stats.touches++;
    game.onTouch(car, wasFrozen);
    game.emit("hit", car, { power, x: qx + nx * 4, y: qy + ny * 4 });
  }
  ball.lastTouch = car;
  return true;
}

function collideCars(a, b, game) {
  const R = 30;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= R * 2 || d < 1e-6) return;
  const nx = dx / d, ny = dy / d;
  const pen = R * 2 - d;
  a.nudge(-nx * pen * 0.5, -ny * pen * 0.5, game.arena);
  b.nudge(nx * pen * 0.5, ny * pen * 0.5, game.arena);
  const van = a.vx * nx + a.vy * ny, vbn = b.vx * nx + b.vy * ny;
  const closing = van - vbn;
  if (closing <= 0) return;
  // equal masses, low restitution, plus RL's bump: the faster car shoves the other
  const j = (1 + 0.3) * closing * 0.5;
  a.applyImpulse(-nx * j, -ny * j, game.arena);
  b.applyImpulse(nx * j, ny * j, game.arena);
  if (closing > 450) {
    const hitter = van > -vbn ? a : b, victim = hitter === a ? b : a;
    const sx = hitter === a ? nx : -nx, sy = hitter === a ? ny : -ny;
    const extra = Math.min(closing, 1800) * 0.45;
    victim.applyImpulse(sx * extra, sy * extra - extra * 0.35, game.arena);
  }
  game.emit("bump", a, { power: clamp(closing / 1500, 0, 1) });
}
