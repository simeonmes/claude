"use strict";
// Rendering: a cached stadium/arena layer, then cars, ball and particles in world
// space, then the HUD (scoreboard, boost gauge, name tags, touch controls) in screen space.

const TEAM = [
  { name: "BLUE", main: "#2f80ff", dark: "#0f3fa8", light: "#8fc0ff", glow: "rgba(60,140,255,", tint: "rgba(47,128,255,0.07)" },
  { name: "ORANGE", main: "#ff8a1f", dark: "#b24c05", light: "#ffc890", glow: "rgba(255,140,40,", tint: "rgba(255,138,31,0.07)" },
];

const Render = (() => {
  let canvas, ctx, dpr = 1, cw = 1, ch = 1;
  let layer = null, layerKey = "";
  const M = 70; // cached layer margin (css px) so the camera can drift without gaps
  const view = { scale: 1, ox: 0, oy: 0, top: 60 };
  const cam = { x: 0, y: 0, shake: 0, flash: 0, flashColor: "#fff" };
  const parts = [];
  let boundaryPath = null, boundaryArena = null;

  function init(c) {
    canvas = c;
    ctx = c.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 200));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.max(1, window.innerWidth);
    ch = Math.max(1, window.innerHeight);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    layerKey = "";
    Input.layoutButtons(cw, ch);
  }

  function computeView(A) {
    view.top = clamp(ch * 0.1, 46, 80);
    const worldW = 2 * (A.W + A.D) + 110;
    const worldH = 2 * A.H + 50;
    const availH = ch - view.top - 6;
    view.scale = Math.min(cw / worldW, availH / worldH);
    view.ox = cw / 2;
    view.oy = view.top + availH / 2;
  }

  function toScreen(wx, wy) {
    return { x: (wx - cam.x) * view.scale + view.ox, y: (wy - cam.y) * view.scale + view.oy };
  }

  function getBoundaryPath(A) {
    if (boundaryArena === A) return boundaryPath;
    const p = new Path2D();
    const first = A.segs[0];
    p.moveTo(first.ax, first.ay);
    for (const g of A.segs) {
      if (g.type === "line") p.lineTo(g.bx, g.by);
      else p.arc(g.cx, g.cy, g.r, g.a0, g.a1, g.dir < 0);
    }
    p.closePath();
    boundaryPath = p;
    boundaryArena = A;
    return p;
  }

  // ---------------------------------------------------------------- static layer
  function buildLayer(A) {
    computeView(A);
    const key = [A.cfg.id, cw, ch, dpr].join("|");
    if (key === layerKey) return;
    layerKey = key;
    layer = layer || document.createElement("canvas");
    layer.width = Math.round((cw + 2 * M) * dpr);
    layer.height = Math.round((ch + 2 * M) * dpr);
    const g = layer.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(M, M);
    const th = A.cfg.theme;
    const s = view.scale;

    // sky
    const sky = g.createLinearGradient(0, -M, 0, ch + M);
    sky.addColorStop(0, th.sky0);
    sky.addColorStop(1, th.sky1);
    g.fillStyle = sky;
    g.fillRect(-M, -M, cw + 2 * M, ch + 2 * M);

    g.save();
    g.translate(view.ox, view.oy);
    g.scale(s, s);
    drawStadium(g, A, th);
    drawArenaBody(g, A, th);
    g.restore();

    // stadium light glare and vignette in screen space
    for (const lx of [0.12, 0.88]) {
      const rg = g.createRadialGradient(cw * lx, -M, 0, cw * lx, -M, ch * 0.9);
      rg.addColorStop(0, "rgba(255,255,255,0.20)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(-M, -M, cw + 2 * M, ch + 2 * M);
    }
    const vg = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = vg;
    g.fillRect(-M, -M, cw + 2 * M, ch + 2 * M);
  }

  function drawStadium(g, A, th) {
    const W = A.W + A.D + 120, H = A.H;
    // tiered stands behind the arena
    const rng = mulberry(7);
    for (let tier = 0; tier < 4; tier++) {
      const y0 = -H - 150 - tier * 95;
      const y1 = y0 + 85;
      const inset = tier * 60;
      g.fillStyle = `rgba(10,14,30,${0.55 - tier * 0.08})`;
      g.beginPath();
      g.moveTo(-W - 400 + inset, y1);
      g.lineTo(-W - 360 + inset, y0);
      g.lineTo(W + 360 - inset, y0);
      g.lineTo(W + 400 - inset, y1);
      g.closePath();
      g.fill();
      for (let i = 0; i < 260; i++) {
        const x = -W - 360 + inset + rng() * (2 * W + 720 - 2 * inset);
        const y = y0 + 10 + rng() * (y1 - y0 - 16);
        const c = rng();
        g.fillStyle = c < 0.2 ? "rgba(90,150,255,0.55)" : c < 0.4 ? "rgba(255,150,70,0.55)" : `rgba(200,210,235,${0.18 + rng() * 0.25})`;
        g.fillRect(x, y, 5, 7);
      }
    }
    // side stands
    for (const side of [-1, 1]) {
      g.fillStyle = "rgba(8,12,26,0.6)";
      g.beginPath();
      g.moveTo(side * (A.W + A.D + 60), -H - 120);
      g.lineTo(side * (W + 600), -H - 360);
      g.lineTo(side * (W + 600), H + 300);
      g.lineTo(side * (A.W + A.D + 60), H + 120);
      g.closePath();
      g.fill();
      for (let i = 0; i < 220; i++) {
        const t = rng();
        const x = side * (A.W + A.D + 90 + t * 480);
        const y = -H - 100 - t * 200 + rng() * (2 * H + 260 + t * 380);
        const c = rng();
        g.fillStyle = c < 0.25 ? (side < 0 ? "rgba(90,150,255,0.5)" : "rgba(255,150,70,0.5)") : `rgba(200,210,235,${0.12 + rng() * 0.22})`;
        g.fillRect(x, y, 5, 7);
      }
    }
    // floodlight pylons
    for (const side of [-1, 1]) {
      const x = side * (A.W + 420);
      g.fillStyle = "rgba(20,26,48,0.9)";
      g.fillRect(x - 8, -H - 560, 16, 300);
      g.fillStyle = "rgba(255,255,240,0.9)";
      for (let i = 0; i < 4; i++) g.fillRect(x - 40 + i * 21, -H - 580, 16, 14);
    }
  }

  function drawArenaBody(g, A, th) {
    const path = getBoundaryPath(A);
    const W = A.W, H = A.H, D = A.D, T = 34;

    // wall shell: everything between an outer frame and the playable boundary
    const shell = new Path2D();
    roundRectPath(shell, -W - D - T, -H - T, 2 * (W + D + T), 2 * (H + T), 70);
    shell.addPath(path);
    const steel = g.createLinearGradient(0, -H - T, 0, H + T);
    steel.addColorStop(0, "#2a3350");
    steel.addColorStop(0.5, "#161c30");
    steel.addColorStop(1, "#2a3350");
    g.fillStyle = steel;
    g.fill(shell, "evenodd");

    // field
    g.save();
    g.clip(path);
    const field = g.createLinearGradient(0, -H, 0, H);
    field.addColorStop(0, shade(th.field, 12));
    field.addColorStop(0.55, th.field);
    field.addColorStop(1, shade(th.field, -10));
    g.fillStyle = field;
    g.fillRect(-W - D - 10, -H - 10, 2 * (W + D + 10), 2 * H + 20);
    // team halves: blue fades in from the left, orange from the right
    const halves = g.createLinearGradient(-W - D, 0, W + D, 0);
    halves.addColorStop(0, "rgba(47,128,255,0.16)");
    halves.addColorStop(0.46, "rgba(47,128,255,0.03)");
    halves.addColorStop(0.54, "rgba(255,150,60,0.025)");
    halves.addColorStop(1, "rgba(255,150,60,0.11)");
    g.fillStyle = halves;
    g.fillRect(-W - D - 10, -H - 10, 2 * (W + D + 10), 2 * H + 20);

    // hex-ish backdrop grid
    g.strokeStyle = "rgba(160,190,255,0.05)";
    g.lineWidth = 2;
    for (let x = -W - D; x <= W + D; x += 80) {
      g.beginPath(); g.moveTo(x, -H); g.lineTo(x, H); g.stroke();
    }
    for (let y = -H; y <= H; y += 80) {
      g.beginPath(); g.moveTo(-W - D, y); g.lineTo(W + D, y); g.stroke();
    }

    // goal pockets
    for (const side of [-1, 1]) {
      const team = side < 0 ? TEAM[0] : TEAM[1];
      const x0 = side < 0 ? -W - D : W;
      const grd = g.createLinearGradient(side * W, 0, side * (W + D), 0);
      grd.addColorStop(0, team.glow + "0.18)");
      grd.addColorStop(1, team.glow + "0.42)");
      g.fillStyle = grd;
      g.fillRect(x0, A.gT, D, A.gB - A.gT);
      g.strokeStyle = team.glow + "0.35)";
      g.lineWidth = 2;
      for (let x = x0 + 12; x < x0 + D; x += 20) {
        g.beginPath(); g.moveTo(x, A.gT); g.lineTo(x, A.gB); g.stroke();
      }
      for (let y = A.gT + 12; y < A.gB; y += 20) {
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + D, y); g.stroke();
      }
    }

    // midfield line and the kickoff ring where the ball spawns
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 4;
    g.setLineDash([22, 18]);
    g.beginPath(); g.moveTo(0, -H); g.lineTo(0, H); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 5;
    g.beginPath(); g.arc(0, kickoffBallY(A), P.BALL_R + 16, 0, TAU); g.stroke();

    // floor glow strip
    const fl = g.createLinearGradient(0, H - 40, 0, H);
    fl.addColorStop(0, "rgba(255,255,255,0)");
    fl.addColorStop(1, "rgba(180,210,255,0.12)");
    g.fillStyle = fl;
    g.fillRect(-W, H - 40, 2 * W, 40);
    g.restore();

    // neon boundary
    g.save();
    g.lineJoin = "round";
    g.shadowColor = th.glow;
    g.shadowBlur = 22;
    g.strokeStyle = th.glow;
    g.lineWidth = 7;
    g.stroke(path);
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 2.5;
    g.stroke(path);
    g.restore();

    // goal frames in team colours
    for (const side of [-1, 1]) {
      const team = side < 0 ? TEAM[0] : TEAM[1];
      g.save();
      g.shadowColor = team.main;
      g.shadowBlur = 26;
      g.strokeStyle = team.main;
      g.lineWidth = 9;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(side * W, A.gT - 6);
      g.lineTo(side * W, A.gT + 8);
      g.moveTo(side * W, A.gB - 8);
      g.lineTo(side * W, A.gB + 6);
      g.stroke();
      g.lineWidth = 4;
      g.strokeStyle = team.light;
      g.beginPath();
      g.rect(side < 0 ? -W - D : W, A.gT, D, A.gB - A.gT);
      g.stroke();
      g.restore();
    }
  }

  // ---------------------------------------------------------------- particles
  function spawn(p) {
    if (parts.length > 900) parts.shift();
    parts.push(p);
  }

  function burst(x, y, n, color, speed, life, size, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 1) : Math.random() * TAU;
      const v = speed * (0.35 + Math.random() * 0.8);
      spawn({
        x, y, vx: Math.cos(a) * v + (opts.vx || 0), vy: Math.sin(a) * v + (opts.vy || 0),
        life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random() * 0.8),
        color, grav: opts.grav ?? 0, drag: opts.drag ?? 2.2, kind: opts.kind || "dot",
      });
    }
  }

  function ring(x, y, color, r1, life, width) {
    spawn({ x, y, vx: 0, vy: 0, life, max: life, size: r1, color, kind: "ring", width: width || 8, grav: 0, drag: 0 });
  }

  function updateParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function drawParticles() {
    for (const p of parts) {
      const t = p.life / p.max;
      if (p.kind === "ring") {
        ctx.globalAlpha = t * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width * t + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t) + 10, 0, TAU);
        ctx.stroke();
      } else if (p.kind === "streak") {
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
      } else {
        ctx.globalAlpha = clamp(t * 1.4, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (0.4 + 0.6 * t)), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function effect(e, game) {
    const car = e.car;
    switch (e.type) {
      case "hit":
        burst(e.x, e.y, 6 + Math.round(e.power * 18), "#fff4c2", 260 + e.power * 700, 0.35, 5, { drag: 4 });
        if (e.power > 0.55) { cam.shake = Math.max(cam.shake, e.power * 9); ring(e.x, e.y, "rgba(255,255,255,0.9)", 90, 0.3, 6); }
        break;
      case "ballBounce":
        burst(e.x, e.y, 4 + Math.round(e.power * 10), "rgba(210,225,255,0.8)", 150 + e.power * 300, 0.35, 4, { drag: 4 });
        break;
      case "jump":
      case "stall": {
        const u = car.up();
        burst(car.x - u.x * 18, car.y - u.y * 18, 10, "rgba(220,230,255,0.7)", 170, 0.35, 5, { drag: 5 });
        break;
      }
      case "dodge":
        ring(car.x, car.y, "rgba(255,255,255,0.8)", 70, 0.28, 5);
        break;
      case "land": {
        const u = car.up();
        burst(car.x - u.x * 18, car.y - u.y * 18, 4 + Math.round(e.power * 14), "rgba(200,215,245,0.7)", 120 + e.power * 260, 0.4, 5, { drag: 5 });
        break;
      }
      case "bump":
        burst(car.x, car.y, 10, "#ffe08a", 320, 0.3, 4, { drag: 5 });
        cam.shake = Math.max(cam.shake, 3 + e.power * 6);
        break;
      case "shot":
        ring(e.x, e.y, e.shot.color, 150, 0.45, 10);
        burst(e.x, e.y, 26, e.shot.color, 650, 0.45, 6, { drag: 3.5 });
        cam.shake = Math.max(cam.shake, 8);
        break;
      case "flipReset":
        ring(car.x, car.y, TEAM[car.team].light, 80, 0.5, 7);
        burst(car.x, car.y, 14, TEAM[car.team].light, 220, 0.45, 4);
        break;
      case "goal": {
        const team = TEAM[e.team];
        for (let i = 0; i < 3; i++) ring(e.x, e.y, i === 1 ? "#ffffff" : team.main, 380 + i * 140, 0.9 + i * 0.25, 16);
        burst(e.x, e.y, 140, team.main, 1300, 1.3, 9, { drag: 1.6, grav: 400 });
        burst(e.x, e.y, 70, "#ffffff", 900, 1.0, 6, { drag: 1.8, grav: 300 });
        burst(e.x, e.y, 60, team.light, 1600, 0.6, 3, { drag: 2.5, kind: "streak" });
        cam.shake = 22;
        cam.flash = 0.55;
        cam.flashColor = team.main;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  function frame(game, alpha, dt) {
    const A = game.arena;
    buildLayer(A);
    updateParticles(dt);

    // light camera drift toward the action
    const ball = game.ball;
    const focusX = ball && !ball.hidden ? ball.x : 0;
    const focusY = ball && !ball.hidden ? ball.y : 0;
    cam.x += (clamp(focusX * 0.04, -24, 24) - cam.x) * Math.min(1, dt * 2.5);
    cam.y += (clamp(focusY * 0.04, -16, 16) - cam.y) * Math.min(1, dt * 2.5);
    cam.shake *= Math.max(0, 1 - dt * 7);
    cam.flash = Math.max(0, cam.flash - dt * 1.6);
    const shx = (Math.random() - 0.5) * cam.shake, shy = (Math.random() - 0.5) * cam.shake;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(layer, -M - cam.x * view.scale + shx, -M - cam.y * view.scale + shy, cw + 2 * M, ch + 2 * M);

    ctx.save();
    ctx.translate(view.ox - cam.x * view.scale + shx, view.oy - cam.y * view.scale + shy);
    ctx.scale(view.scale, view.scale);

    for (const car of game.cars) drawTrail(car);
    if (ball && !ball.hidden) drawBall(ball, alpha, game);
    for (const car of game.cars) { emitBoost(car, dt); drawCar(car, alpha); }
    drawParticles();
    ctx.restore();

    if (cam.flash > 0) {
      ctx.globalAlpha = cam.flash * 0.35;
      ctx.fillStyle = cam.flashColor;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }

    for (const car of game.cars) drawNameTag(car, alpha, game);
    drawHud(game);
  }

  function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }

  function drawTrail(car) {
    const tr = car.trail;
    if (tr.length < 3 || !tr[0].ss) return;
    ctx.lineCap = "round";
    for (let i = 1; i < tr.length; i++) {
      if (!tr[i].ss) break;
      const t = 1 - i / tr.length;
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * t})`;
      ctx.lineWidth = 10 * t + 1;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
  }

  function emitBoost(car, dt) {
    if (!car.boosting) return;
    const n = car.nose();
    const bx = car.x - n.x * 44, by = car.y - n.y * 44;
    const team = TEAM[car.team];
    const count = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      spawn({
        x: bx, y: by,
        vx: -n.x * (380 + Math.random() * 260) + car.vx * 0.3 + (Math.random() - 0.5) * 90,
        vy: -n.y * (380 + Math.random() * 260) + car.vy * 0.3 + (Math.random() - 0.5) * 90,
        life: 0.28, max: 0.28, size: 7 + Math.random() * 5,
        color: Math.random() < 0.35 ? "#fff3c4" : team.main, grav: -60, drag: 3, kind: "dot",
      });
    }
  }

  function drawCar(car, alpha) {
    const team = TEAM[car.team];
    const x = lerp(car.px, car.x, alpha), y = lerp(car.py, car.y, alpha);
    const ang = lerpAngle(car.pang, car.ang + car.angAnim, alpha);
    const roll = car.roll + car.rollAnim;
    const cr = Math.cos(roll), sr = Math.sin(roll);

    ctx.save();
    ctx.translate(x, y);

    if (car.resetFlash > 0) {
      ctx.globalAlpha = clamp(car.resetFlash, 0, 1) * 0.8;
      ctx.strokeStyle = team.light;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 62 + (1.1 - car.resetFlash) * 20, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(ang);
    if (car.yawAnim > 0) {
      // Turning around: physics already faces the new way, so start mirrored (looking
      // like the old heading) and swing through a nose-on view to the new one.
      const k = Math.cos(Math.PI * car.yawAnim);
      ctx.scale(Math.sign(k || 1) * Math.max(0.14, Math.abs(k)), 1);
    }

    if (car.boosting) {
      const f = 0.75 + Math.random() * 0.5;
      const grd = ctx.createLinearGradient(-44, 0, -44 - 46 * f, 0);
      grd.addColorStop(0, "rgba(255,250,220,0.95)");
      grd.addColorStop(0.35, team.main);
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-42, -10);
      ctx.quadraticCurveTo(-60 - 30 * f, -4, -44 - 50 * f, -3);
      ctx.quadraticCurveTo(-60 - 30 * f, 0, -42, 4);
      ctx.closePath();
      ctx.fill();
    }

    // Air roll turns the car about its long axis. Project it like the 3D model would:
    // the side profile squashes by cos(roll) (mirroring past 90 degrees) while the
    // roof or underside comes into view by |sin(roll)|.
    if (Math.abs(cr) > 0.06) {
      ctx.save();
      ctx.scale(1, cr);
      drawSideProfile(car, team);
      ctx.restore();
    }
    if (Math.abs(sr) > 0.3) {
      ctx.save();
      ctx.globalAlpha = clamp((Math.abs(sr) - 0.3) / 0.45, 0, 1);
      ctx.scale(1, Math.abs(sr));
      drawTopView(team, sr > 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTopView(team, roof) {
    ctx.fillStyle = roof ? team.main : "#1c2130";
    roundRectFill(ctx, -44, -27, 88, 54, 13);
    ctx.fillStyle = "#101318";
    for (const wx of [-25, 26]) for (const wy of [-31, 23]) ctx.fillRect(wx - 9, wy, 18, 8);
    if (roof) {
      ctx.fillStyle = "#0e1628";
      roundRectFill(ctx, -18, -20, 34, 40, 8);
      ctx.fillStyle = team.light;
      roundRectFill(ctx, -10, -15, 16, 30, 5);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(18, -3, 24, 6);
    } else {
      ctx.fillStyle = "#2b3244";
      roundRectFill(ctx, -34, -12, 68, 24, 6);
    }
  }

  function drawSideProfile(car, team) {
    // body (Octane-like silhouette; nose to +x, roof to -y)
    const body = ctx.createLinearGradient(0, -22, 0, 10);
    body.addColorStop(0, team.light);
    body.addColorStop(0.35, team.main);
    body.addColorStop(1, team.dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-42, 5);
    ctx.lineTo(-43, -6);
    ctx.lineTo(-40, -12);
    ctx.lineTo(-47, -16);
    ctx.lineTo(-45, -20);
    ctx.lineTo(-31, -18);
    ctx.lineTo(-22, -18);
    ctx.lineTo(-8, -22);
    ctx.lineTo(6, -21);
    ctx.lineTo(18, -10);
    ctx.lineTo(34, -7);
    ctx.lineTo(44, -3);
    ctx.lineTo(46, 3);
    ctx.lineTo(40, 7);
    ctx.arc(26, 9, 14, 0, Math.PI, true);
    ctx.lineTo(-12, 7);
    ctx.arc(-25, 9, 14, 0, Math.PI, true);
    ctx.lineTo(-42, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // windows
    const glass = ctx.createLinearGradient(0, -21, 0, -9);
    glass.addColorStop(0, "#0b1224");
    glass.addColorStop(1, "#3b4f78");
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(-19, -16);
    ctx.lineTo(-7, -19.5);
    ctx.lineTo(4, -18.5);
    ctx.lineTo(14, -10);
    ctx.lineTo(-17, -10);
    ctx.closePath();
    ctx.fill();

    // decal stripe, lights
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(-36, -4, 70, 3);
    ctx.fillStyle = "#fffbe0";
    ctx.fillRect(40, -3, 5, 3);
    ctx.fillStyle = "#ff3b3b";
    ctx.fillRect(-44, -8, 4, 4);

    // wheels
    for (const wx of [-25, 26]) {
      ctx.save();
      ctx.translate(wx, 9);
      ctx.fillStyle = "#111318";
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = "#a9b2c6";
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
      ctx.rotate(car.wheelAngle);
      ctx.strokeStyle = "#454c5c";
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawBall(ball, alpha, game) {
    const R = ball.r;
    const x = lerp(ball.px, ball.x, alpha), y = lerp(ball.py, ball.y, alpha);
    const sp = ball.speed;
    const shot = ball.shot;
    const streakFrom = 1630 * P.SIZE * P.TIME;
    if (sp > streakFrom || shot) {
      const a = shot ? 0.55 * clamp(ball.shotT, 0, 1) : clamp((sp - streakFrom) / (3500 * P.SIZE * P.TIME), 0, 0.35);
      ctx.strokeStyle = shot ? shot.glow + a + ")" : `rgba(255,255,255,${a})`;
      ctx.lineWidth = R * 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - ball.vx * 0.07, y - ball.vy * 0.07);
      ctx.stroke();
    }
    if (ball.frozen) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.35})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, R + 12 + pulse * 6, 0, TAU); ctx.stroke();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = shot ? shot.color : "rgba(190,215,255,0.55)";
    ctx.shadowBlur = shot ? 34 : 18;
    const base = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
    base.addColorStop(0, "#f4f6fa");
    base.addColorStop(0.6, "#b9c0cf");
    base.addColorStop(1, "#7c8598");
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;

    // rotating panel pattern
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, TAU); ctx.clip();
    ctx.rotate(ball.angle);
    ctx.fillStyle = "rgba(55,62,80,0.55)";
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      hexagon(ctx, Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72, R * 0.26, a);
    }
    hexagon(ctx, 0, 0, R * 0.24, 0);
    ctx.strokeStyle = "rgba(40,46,62,0.45)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + TAU / 10;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.stroke();
    }
    ctx.restore();

    // fixed lighting over the spinning pattern
    const shine = ctx.createRadialGradient(-R * 0.35, -R * 0.4, 0, -R * 0.2, -R * 0.2, R * 1.1);
    shine.addColorStop(0, "rgba(255,255,255,0.55)");
    shine.addColorStop(0.35, "rgba(255,255,255,0.08)");
    shine.addColorStop(1, "rgba(0,0,20,0.35)");
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    if (shot) {
      ctx.globalAlpha = clamp(ball.shotT, 0, 1);
      ctx.fillStyle = shot.glow + "0.28)";
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, R + 1, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function hexagon(c, x, y, r, rot) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * TAU;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
  }

  function drawNameTag(car, alpha, game) {
    const x = lerp(car.px, car.x, alpha), y = lerp(car.py, car.y, alpha);
    const p = toScreen(x, y);
    const label = car.tag || car.name;
    const fs = clamp(view.scale * 22, 10, 15);
    ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
    const w = ctx.measureText(label).width + 12;
    const ty = p.y - 52 * view.scale - fs;
    ctx.globalAlpha = car.human ? 0.95 : 0.7;
    ctx.fillStyle = "rgba(6,10,22,0.6)";
    roundRectFill(ctx, p.x - w / 2, ty - fs * 0.85, w, fs * 1.35, 5);
    ctx.fillStyle = car.human ? "#ffffff" : TEAM[car.team].light;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, p.x, ty + fs * 0.2);
    if (car.human) {
      ctx.fillStyle = TEAM[car.team].main;
      ctx.beginPath();
      ctx.moveTo(p.x - 6, ty + fs * 0.55);
      ctx.lineTo(p.x + 6, ty + fs * 0.55);
      ctx.lineTo(p.x, ty + fs * 0.55 + 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- HUD
  function drawHud(game) {
    if (game.state === "menu") return;
    const top = view.top;
    const h = clamp(top * 0.62, 30, 50);
    const y = (top - h) / 2 + 2;
    const sw = h * 1.35, cwid = h * 2.5;
    const x0 = cw / 2 - cwid / 2 - sw;

    if (game.mode !== "freeplay") {
      scoreBox(x0, y, sw, h, TEAM[0], game.score[0], "left");
      scoreBox(cw / 2 + cwid / 2, y, sw, h, TEAM[1], game.score[1], "right");
      ctx.fillStyle = "rgba(8,12,24,0.88)";
      roundRectFill(ctx, cw / 2 - cwid / 2, y, cwid, h, 0);
      ctx.fillStyle = game.overtime ? "#ffd166" : "#ffffff";
      ctx.font = `800 ${h * 0.56}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(formatClock(game), cw / 2, y + h / 2 + 1);
      if (game.overtime) {
        ctx.font = `800 ${h * 0.26}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText("OVERTIME", cw / 2, y + h + h * 0.24);
      }
    } else {
      ctx.fillStyle = "rgba(8,12,24,0.8)";
      roundRectFill(ctx, cw / 2 - cwid * 0.7, y, cwid * 1.4, h, 8);
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${h * 0.42}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("FREE PLAY", cw / 2, y + h / 2 + 1);
    }

    // boost gauges for local players
    const locals = game.cars.filter((c) => c.human);
    const gr = clamp(Math.min(cw, ch) * 0.07, 28, 52);
    if (Input.touch.enabled && locals[0]) {
      drawTouch(locals[0]);
    } else {
      locals.forEach((car, i) => {
        const right = locals.length === 1 || i === 1;
        const gx = right ? cw - gr * 1.45 : gr * 1.45;
        boostGauge(gx, ch - gr * 1.45, gr, car);
      });
    }
  }

  function scoreBox(x, y, w, h, team, score, side) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, team.main);
    g.addColorStop(1, team.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    const r = h * 0.28;
    if (side === "left") {
      ctx.moveTo(x + r, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + r, y, r);
    } else {
      ctx.moveTo(x, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r); ctx.lineTo(x, y + h);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${h * 0.68}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(score), x + w / 2, y + h / 2 + 2);
  }

  function boostGauge(x, y, r, car) {
    const amt = car.boost / P.BOOST_MAX;
    ctx.fillStyle = "rgba(6,10,22,0.72)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    ctx.lineCap = "round";
    ctx.lineWidth = r * 0.2;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.arc(x, y, r * 0.78, a0, a0 + span); ctx.stroke();
    if (amt > 0.005) {
      const g = ctx.createLinearGradient(x - r, y, x + r, y);
      g.addColorStop(0, "#ff7a18");
      g.addColorStop(1, "#ffe26a");
      ctx.strokeStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 0.78, a0, a0 + span * amt); ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${r * 0.62}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(car.boost)), x, y + 1);
    ctx.font = `700 ${r * 0.22}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("BOOST", x, y + r * 0.52);
  }

  function drawTouch(car) {
    const t = Input.touch;
    // stick
    const R = t.radius;
    const bx = t.stickId !== null ? t.baseX : R * 1.5;
    const by = t.stickId !== null ? t.baseY : ch - R * 1.5;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, R, 0, TAU); ctx.fill(); ctx.stroke();
    const kx = t.stickId !== null ? bx + t.sx * R : bx, ky = t.stickId !== null ? by + t.sy * R : by;
    ctx.fillStyle = t.roll ? "rgba(255,209,102,0.8)" : "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(kx, ky, R * 0.42, 0, TAU); ctx.fill();

    // jump
    const j = t.jumpBtn;
    ctx.fillStyle = t.jumpId !== null ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.16)";
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(j.x, j.y, j.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${j.r * 0.36}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("JUMP", j.x, j.y + 1);

    // boost button doubles as the boost gauge
    const b = t.boostBtn;
    ctx.fillStyle = t.boostId !== null ? "rgba(255,150,40,0.5)" : "rgba(255,150,40,0.18)";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.lineWidth = b.r * 0.16;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.9, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "#ffcf5a";
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.9, -Math.PI / 2, -Math.PI / 2 + TAU * (car.boost / P.BOOST_MAX)); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${b.r * 0.36}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(String(Math.round(car.boost)), b.x, b.y + 1);

    // pause
    const pb = t.pauseBtn;
    ctx.fillStyle = "rgba(6,10,22,0.6)";
    ctx.beginPath(); ctx.arc(pb.x, pb.y, pb.r, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(pb.x - 6, pb.y - 7, 4, 14);
    ctx.fillRect(pb.x + 2, pb.y - 7, 4, 14);
  }

  function formatClock(game) {
    const t = game.overtime ? game.otTime : Math.ceil(Math.max(0, game.clock) - 1e-6);
    const s = Math.floor(t);
    const m = Math.floor(s / 60), r = s % 60;
    return (game.overtime ? "+" : "") + m + ":" + String(r).padStart(2, "0");
  }

  // ---------------------------------------------------------------- utils
  function roundRectPath(p, x, y, w, h, r) {
    p.moveTo(x + r, y);
    p.arcTo(x + w, y, x + w, y + h, r);
    p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r);
    p.arcTo(x, y, x + w, y, r);
    p.closePath();
  }

  function roundRectFill(c, x, y, w, h, r) {
    c.beginPath();
    if (r <= 0) { c.rect(x, y, w, h); c.fill(); return; }
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    c.fill();
  }

  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + (pct / 100) * 255), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { init, frame, effect, resize, get size() { return { cw, ch }; } };
})();

// Kickoff ball rests on the floor at midfield.
function kickoffBallY(A) { return A.H - P.BALL_R; }
