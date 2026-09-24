"use strict";
// Bots drive with exactly the inputs a human has (stick, jump, boost, air roll), so they
// obey the same physics. Difficulty changes reaction time, boost use, jump accuracy and
// whether they go for aerials and flip shots.

// Speeds and timings below were tuned at game speed TIME = 1.35; these keep them in
// step with P.TIME (speeds scale with it, durations inversely).
const VK = P.TIME / 1.35, TK = 1.35 / P.TIME;

const BOT_LEVELS = {
  rookie: { name: "Rookie", think: 0.32, boostUse: 0.25, jumpErr: 60, aerial: false, dodge: 0.25, pred: 0.4, kickBoost: 0.35, idle: 0.18 },
  pro: { name: "Pro", think: 0.11, boostUse: 0.75, jumpErr: 18, aerial: true, dodge: 0.8, pred: 0.95, kickBoost: 0.8, idle: 0.03 },
  allstar: { name: "All-Star", think: 0.04, boostUse: 1, jumpErr: 5, aerial: true, dodge: 1, pred: 1.15, kickBoost: 0.9, idle: 0 },
};

const BOT_NAMES = [
  "Armstrong", "Bandit", "Beast", "Boomer", "Buzz", "C-Block", "Casper", "Caveman", "Centice",
  "Chipper", "Cougar", "Dude", "Foamer", "Fury", "Gerwin", "Goose", "Heater", "Hollywood", "Hound",
  "Iceman", "Imp", "Jester", "Junker", "Khan", "Maverick", "Middy", "Merlin", "Mountain", "Myrtle",
  "Outlaw", "Poncho", "Rainmaker", "Raja", "Rex", "Roundhouse", "Sabretooth", "Saltie", "Samara",
  "Scout", "Shepard", "Slider", "Squall", "Sticks", "Stinger", "Storm", "Sultan", "Sundown",
  "Swabbie", "Tex", "Tusk", "Viper", "Wolfman", "Yuri",
];

function pickBotNames(n) {
  const pool = BOT_NAMES.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

class BotBrain {
  constructor(levelKey) {
    this.L = BOT_LEVELS[levelKey] || BOT_LEVELS.pro;
    this.thinkT = 0;
    this.cool = 0;
    this.holdJump = 0;
    this.pending = null;
    this.airPlan = null;
    this.jitter = 0;
    this.useBoost = true;
    this.tx = 0; this.ty = 0; this.aimBall = false; this.role = "attack";
  }

  input(car, game, dt) {
    const out = { sx: 0, sy: 0, jump: false, boost: false, rollL: false, rollR: false };
    if (game.frozen) { this.holdJump = 0; this.pending = null; return out; }
    this.cool -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.decide(car, game);
      this.thinkT = this.L.think * (0.7 + Math.random() * 0.6);
    }

    if (car.grounded) {
      this.airPlan = null;
      this.drive(car, game, out);
    } else {
      this.fly(car, game, out);
    }

    if (this.holdJump > 0) { out.jump = true; this.holdJump -= dt; }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        out.jump = true;
        out.sx = this.pending.sx; out.sy = 0;
        if (--this.pending.frames <= 0) this.pending = null;
      }
    }
    return out;
  }

  decide(car, game) {
    const A = game.arena, ball = game.ball, R = P.BALL_R, L = this.L;
    const atk = car.team === 0 ? 1 : -1;
    const egx = atk * (A.W + 60), gy = A.goalMidY;
    const ogx = -egx;

    const d = Math.hypot(ball.x - car.x, ball.y - car.y);
    const tp = ball.frozen ? 0 : clamp(d / (1500 * VK), 0, 0.9 * TK) * L.pred;
    let bx = ball.x + ball.vx * tp;
    let by = Math.min(ball.y + ball.vy * tp + 0.5 * P.G * tp * tp, A.H - R);
    bx = clamp(bx, -A.W + R * 0.5, A.W - R * 0.5);
    this.bx = bx; this.by = by;
    this.jitter = (Math.random() * 2 - 1) * L.jumpErr;
    this.useBoost = Math.random() < L.boostUse;
    this.idle = !game.kickoff && Math.random() < L.idle; // weaker bots sometimes just hesitate
    if (game.kickoff && this.kickId !== game.kickoffId) {
      // Vary each kickoff (speed and where on the ball to hit) so it isn't the same
      // shot every time.
      this.kickId = game.kickoffId;
      this.kickBoost = Math.random() < L.kickBoost;
      this.kickAimY = (Math.random() * 2 - 1) * R * 0.55;
    }

    // The teammate closest to the ball attacks; the other hangs back goal-side.
    let closest = car, cd = Infinity;
    for (const m of game.cars) {
      if (m.team !== car.team) continue;
      const md = Math.hypot(ball.x - m.x, ball.y - m.y) + (m.grounded ? 0 : 60);
      if (md < cd) { cd = md; closest = m; }
    }
    const danger = ball.x * -atk > A.W * 0.3 && ball.vx * -atk > 250 * VK;
    this.role = closest === car || danger || game.kickoff ? "attack" : "support";

    if (this.role === "support") {
      this.tx = lerp(ogx, bx, 0.42);
      this.ty = A.H;
      this.aimBall = false;
      this.hop = false;
      this.waitBall = false;
      return;
    }

    // Come at the ball from the side facing away from the goal we're shooting at.
    let ex = bx - egx, ey = by - gy;
    const em = Math.hypot(ex, ey) || 1;
    ex /= em; ey /= em;
    const wrongSide = !game.kickoff && (car.x - bx) * atk > R * 0.6;
    if (wrongSide) {
      this.tx = bx - atk * (R + 240);
      this.ty = A.H;
      this.aimBall = false;
      // A ball rolling on the floor between us and where we're going can be hopped;
      // one hanging at mid-height can't be cleared, so hold off until it drops or rises.
      const ballH = A.H - ball.y; // ball centre height above the floor
      this.hop = ballH < R + 14 && Math.abs(ball.x - car.x) < 460;
      this.waitBall = ballH >= R + 14 && ballH < R + 50 && Math.abs(ball.x - car.x) < 360;
    } else {
      this.tx = bx + ex * R * 0.6;
      this.ty = by + ey * R * 0.6;
      this.aimBall = true;
      this.hop = false;
      this.waitBall = false;
    }
  }

  drive(car, game, out) {
    const A = game.arena, ball = game.ball, R = P.BALL_R, L = this.L;
    const p = car.gp;
    const nearWall = Math.abs(this.tx) > A.W - 180 && this.ty < A.H - 160;
    // Stay below the goal's lower lip at either end: driving up to it launches the car
    // off the edge past the ball (knocking it back the wrong way) or into our own goal
    // mouth. Jump from the ramp instead.
    const wallY = Math.max(this.ty, A.gB + 90);
    const sT = nearWall ? pathNearest(A, this.tx, wallY).s : floorS(A, clamp(this.tx, -A.W + 30, A.W - 30));
    const diff = pathDelta(A, car.s, sT);
    let want = Math.abs(diff) < 22 ? 0 : Math.sign(diff);
    // Heading back past a low ball: arrive slow enough to time a hop over it.
    const ballAhead = Math.sign(ball.x - car.x) === Math.sign(car.vx || 1) && Math.abs(ball.x - car.x) < 650;
    const hopping = this.hop && ballAhead;
    if (hopping && Math.abs(car.ds) > 850 * VK) want = 0;
    // Arrive rather than overshoot when heading somewhere other than the ball: brake
    // (push the other way) while fast, then let go before the car would turn round.
    // Otherwise a boosting bot sails past its spot, up the quarterpipe and off the
    // goal lip into the air in front of its own net.
    if ((!this.aimBall || nearWall) && want !== 0 && Math.sign(car.ds) === want) {
      const stopDist = (car.ds * car.ds) / (2 * P.BRAKE) + 30;
      if (Math.abs(diff) < stopDist) want = Math.abs(car.ds) > P.TURN_SPEED * 1.3 ? -want : 0;
    }
    if (this.waitBall && ballAhead) want = 0;
    if (this.idle) want = 0;
    out.sx = p.tx * want;
    out.sy = p.ty * want;

    if (!hopping && want !== 0 && want === car.face && car.boost > 10 &&
        ((Math.abs(diff) > 280 && this.useBoost) || (game.kickoff && this.kickBoost))) {
      out.boost = true;
    }

    // Retreating past a low ball: hop over it rather than shoving it at our own goal.
    // A full jump plus an early double jump clears the ball about 0.3s after takeoff,
    // so take off that far out (plus the ball radius and half a car).
    const closing = (car.vx - ball.vx) * Math.sign(ball.x - car.x);
    if (hopping && this.cool <= 0 && closing > 120 * VK && Math.abs(ball.x - car.x) < R + 48 + closing * 0.3 * TK) {
      this.holdJump = P.JUMP_HOLD_T + 0.02;
      this.airPlan = "hop";
      this.cool = 0.9;
      return;
    }

    if (!this.aimBall || this.cool > 0) return;
    const u = car.up(), nz = car.nose();
    const rx = ball.x - car.x, ry = ball.y - car.y;
    const hUp = rx * u.x + ry * u.y;
    const along = rx * nz.x + ry * nz.y;
    const reach = Math.abs(car.ds) * 0.14 * TK;
    // Only leave the ground for a ball that's still ahead of us in the attacking
    // direction. A ball we've already driven under would get hit on its front side and
    // knocked back toward our own goal.
    const ahead = rx * atk;
    const attackSide = ahead > R * 0.25;

    if (L.aerial && ahead > R * 0.3 && hUp > 330 && ahead < 300 && car.boost > 45 && ball.vy > -350 * VK) {
      this.holdJump = P.JUMP_HOLD_T + 0.02;
      this.airPlan = "aerial";
      this.cool = 0.6;
    } else if (attackSide && hUp > 55 + this.jitter && hUp < 330 && along > 0 && along < R + 70 + reach) {
      this.holdJump = clamp((hUp - 45) / 260, 0.05, 1) * P.JUMP_HOLD_T + 0.02;
      this.airPlan = hUp > 210 ? "reach" : "shot";
      this.cool = 0.45;
    }
  }

  // Keep air rolling until the roof is up and the car is square to the camera again;
  // stopping as soon as the roof flips up would leave the car sideways.
  needsRoll(car) {
    return car.up().y > 0.1 || Math.abs(Math.cos(car.roll)) < 0.92;
  }

  fly(car, game, out) {
    const A = game.arena, ball = game.ball, R = P.BALL_R, L = this.L;
    const atk = car.team === 0 ? 1 : -1;

    if (this.airPlan === "hop") {
      // Hold the current nose direction level (pitching around mid-hop would swing the
      // car's length down into the ball), and double jump early for extra height.
      out.sx = Math.sign(car.nose().x) || atk;
      out.sy = 0;
      if (car.flipAvailable && !this.pending && car.airTime > 0.16 * TK) {
        this.holdJump = 0;
        this.pending = { t: 1 / 90, frames: 2, sx: 0 };
      }
      if (this.needsRoll(car)) out.rollR = true;
      return;
    }

    const rx = ball.x - car.x, ry = ball.y - car.y;
    const d = Math.hypot(rx, ry);
    // Drop an attack plan once we've drifted past the ball: hitting it from here
    // would send it toward our own goal.
    const goalSide = (ball.x - car.x) * atk > -R * 0.3;
    if (this.airPlan && d < 750 && this.aimBall && goalSide) {
      // Aim slightly at the ball's far side from the enemy goal so hits go forward.
      const ax = rx - atk * R * 0.25, ay = ry + (game.kickoff ? this.kickAimY || 0 : 0);
      const am = Math.hypot(ax, ay) || 1;
      out.sx = ax / am;
      out.sy = ay / am;
      const nz = car.nose();
      const aligned = nz.x * out.sx + nz.y * out.sy > 0.82;
      if ((this.airPlan === "aerial" || (this.airPlan === "reach" && ry < -110)) && aligned && car.boost > 4) out.boost = true;

      if (car.flipAvailable && d < R + 78 && car.airTime > 0.1 * TK && !this.pending) {
        // Only flip when it sends the ball toward their goal; a flip from the ball's
        // far side would drive it into our own net.
        const dir = Math.sign(rx) || atk;
        // Ball must stay in front through the flip's first frames, so a fast car needs more room.
        const ahead = rx * atk > 18 + Math.max(0, car.vx * atk) * 0.03 * TK;
        // Flip only into a ball at car height; under a high ball the spinning tail swats it back.
        const level = Math.abs(ry) < R + 25;
        if (dir === atk && ahead && level && Math.random() < L.dodge) {
          this.holdJump = 0;
          this.pending = { t: 1 / 90, frames: 2, sx: dir };
        }
      }
      return;
    }

    // Nothing to hit: fall wheels-down, nose toward where we're heading.
    out.sx = Math.sign(this.tx - car.x) || atk;
    out.sy = 0.3;
    if (this.needsRoll(car)) out.rollR = true;
  }
}
