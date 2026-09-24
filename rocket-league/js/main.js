"use strict";
// Match flow, modes, stats and menus.

const STEP = 1 / 120;
const MATCH_TIME = 120;

const game = {
  state: "menu", // menu | countdown | play | goal | over
  paused: false,
  mode: "duel", arenaId: "shortstack", level: "pro", collisions: "off",
  arena: buildArena(ARENAS.shortstack),
  cars: [],
  ball: new Ball(),
  score: [0, 0],
  clock: MATCH_TIME, otTime: 0, overtime: false, clockRunning: false, awaitGround: false,
  kickoff: true, frozen: true, countdown: 0, lastCount: 0, goalTimer: 0,
  events: [],
  ballPre: null,
  emit(type, car, data) { this.events.push(Object.assign({ type, car }, data)); },
  teamTouch: [null, null],
  ownGoals: 0,
  onTouch(car, wasFrozen) {
    if (wasFrozen) { this.kickoff = false; this.clockRunning = true; }
    this.teamTouch[car.team] = car;
    if (this.mode === "freeplay" || !this.ballPre) return;
    const ownSide = car.team === 0 ? -1 : 1;
    const wasOnTarget = headingIntoGoal(this.ballPre, ownSide, this.arena);
    if (wasOnTarget && !headingIntoGoal(this.ball, ownSide, this.arena)) {
      car.stats.saves++;
      UI.toast(car.human ? "SAVE!" : `${car.name}: Save`, car.team);
    }
    const enemy = -ownSide;
    if (headingIntoGoal(this.ball, enemy, this.arena) && !headingIntoGoal(this.ballPre, enemy, this.arena)) car.stats.shots++;
  },
};
game.ball.place(0, kickoffBallY(game.arena));
game.ball.hidden = true;

// Would the ball, on its current flight (with floor bounces), cross into the goal on `side`?
function headingIntoGoal(b, side, A) {
  let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
  const R = P.BALL_R;
  if (Math.abs(vx) < 150 || Math.sign(vx) !== side) return false;
  for (let t = 0; t < 2.4 / P.TIME; t += 0.02) {
    vy += P.G * 0.02;
    x += vx * 0.02;
    y += vy * 0.02;
    if (y > A.H - R) { y = A.H - R; vy = -vy * P.BALL_REST; }
    if (y < -A.H + R) { y = -A.H + R; vy = -vy * P.BALL_REST; }
    if (side * x > A.W) return y > A.gT + R * 0.3 && y < A.gB - R * 0.3;
  }
  return false;
}

const MODES = {
  duel: { label: "Duel", teams: [["human"], ["bot"]], spawns: [[-520], [520]] },
  doubles: { label: "Doubles", teams: [["human", "bot"], ["bot", "bot"]], spawns: [[-430, -720], [430, 720]] },
  local: { label: "Local Duel", teams: [["p1"], ["p2"]], spawns: [[-520], [520]] },
  freeplay: { label: "Free Play", teams: [["human"], []], spawns: [[-450], []] },
};

function setupMatch() {
  game.arena = buildArena(ARENAS[game.arenaId]);
  const def = MODES[game.mode];
  const names = pickBotNames(4);
  game.cars = [];
  def.teams.forEach((members, team) => {
    members.forEach((kind, i) => {
      const opts = { team, spawnX: def.spawns[team][i] };
      if (kind === "human") Object.assign(opts, { human: true, name: "You", tag: "YOU", localIndex: 0 });
      else if (kind === "p1") Object.assign(opts, { human: true, name: "Player 1", tag: "P1", localIndex: 0 });
      else if (kind === "p2") Object.assign(opts, { human: true, name: "Player 2", tag: "P2", localIndex: 1 });
      else Object.assign(opts, { name: names.pop(), bot: new BotBrain(game.level) });
      const car = new Car(opts);
      car.spawnX = opts.spawnX;
      car.tag = opts.tag;
      if (car.human && Sound.ready) car.engine = Sound.makeEngine();
      game.cars.push(car);
    });
  });
  game.score = [0, 0];
  game.ownGoals = 0;
  game.clock = MATCH_TIME;
  game.otTime = 0;
  game.overtime = false;
  game.awaitGround = false;
  kickoffReset(game.mode === "freeplay");
}

function kickoffReset(skipCountdown) {
  const A = game.arena;
  for (const c of game.cars) c.place(A, c.spawnX);
  game.ball.place(0, kickoffBallY(A));
  game.ball.hidden = false;
  game.kickoff = true;
  game.kickoffId = (game.kickoffId || 0) + 1;
  game.clockRunning = false;
  game.awaitGround = false;
  game.teamTouch = [null, null];
  if (skipCountdown) {
    game.state = "play";
    game.frozen = false;
  } else {
    game.state = "countdown";
    game.frozen = true;
    game.countdown = 3;
    game.lastCount = 4;
  }
}

function scoreGoal(team) {
  const A = game.arena, ball = game.ball;
  const kmh = Math.round((ball.speed / (P.SIZE * P.TIME)) * 0.036); // uu/s -> km/h
  // As in Rocket League, the goal goes to the scoring team's last toucher even if an
  // opponent deflected it in; it's only an own goal if nobody on that team touched it.
  const scorer = game.teamTouch[team];
  if (ball.lastTouch && ball.lastTouch.team !== team) game.ownGoals++;
  if (game.mode !== "freeplay") game.score[team]++;
  if (scorer) scorer.stats.goals++;
  game.teamTouch = [null, null];

  game.emit("goal", null, { team, x: ball.x, y: ball.y });
  for (const c of game.cars) {
    const dx = c.x - ball.x, dy = c.y - ball.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 560) {
      const f = (1 - d / 560) * 1750 * P.SIZE * P.TIME;
      c.applyImpulse((dx / d) * f, (dy / d) * f - f * 0.25, A);
    }
  }
  ball.hidden = true;
  game.state = "goal";
  game.goalTimer = game.mode === "freeplay" ? 1.6 : 3.2;
  const who = scorer ? (scorer.human ? (scorer.tag === "YOU" ? "You scored" : scorer.name) : scorer.name) : "Own goal";
  UI.banner("GOAL!", `${who}  ·  ${kmh} KM/H`, team, 2.6);
  Sound.goal();
}

function afterGoal() {
  if (game.mode === "freeplay") {
    const A = game.arena;
    game.ball.place(0, kickoffBallY(A));
    game.ball.hidden = false;
    game.state = "play";
    return;
  }
  if (game.overtime) return endMatch();
  if (game.awaitGround || game.clock <= 0) {
    if (game.score[0] === game.score[1]) return startOvertime();
    return endMatch();
  }
  kickoffReset(false);
}

function startOvertime() {
  game.overtime = true;
  game.otTime = 0;
  UI.banner("OVERTIME", "Next goal wins", null, 2);
  Sound.whistle();
  kickoffReset(false);
}

function endMatch() {
  game.state = "over";
  game.frozen = true;
  Sound.whistle();
  setTimeout(() => UI.showOver(), 600);
}

function step(h) {
  const A = game.arena, ball = game.ball;
  game.ballPre = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  for (const c of game.cars) c.snapPrev();
  ball.snapPrev();

  if (game.state === "countdown") {
    game.countdown -= h;
    const n = Math.ceil(game.countdown);
    if (n !== game.lastCount && n > 0) {
      game.lastCount = n;
      UI.banner(String(n), game.overtime ? "Overtime" : "", null, 0.9);
      Sound.beep(false);
    }
    if (game.countdown <= 0) {
      game.state = "play";
      game.frozen = false;
      UI.banner("GO!", "", null, 0.6);
      Sound.beep(true);
    }
  }

  const twoLocal = game.mode === "local";
  for (const c of game.cars) {
    const inp = c.human ? Input.read(c.localIndex, twoLocal) : c.bot.input(c, game, h);
    c.update(h, inp, game);
  }
  if (!ball.hidden) {
    ball.update(h, game);
    // Resolve every car's touch against the ball's velocity from before this step's
    // touches, then add them up. Done one after another, a car hitting the ball on the
    // same frame as another would see it already flying at it and fire it back (always
    // favouring whichever car is processed last).
    const v0x = ball.vx, v0y = ball.vy, s0 = ball.spin;
    let dvx = 0, dvy = 0, dspin = 0;
    for (const c of game.cars) {
      ball.vx = v0x; ball.vy = v0y; ball.spin = s0;
      if (collideCarBall(c, ball, game)) {
        dvx += ball.vx - v0x; dvy += ball.vy - v0y; dspin += ball.spin - s0;
      }
    }
    ball.vx = v0x + dvx; ball.vy = v0y + dvy; ball.spin = s0 + dspin;
  }
  // Sideswipe cars drive through each other; bumping is an optional mutator.
  if (game.collisions === "on") {
    for (let i = 0; i < game.cars.length; i++) {
      for (let j = i + 1; j < game.cars.length; j++) collideCars(game.cars[i], game.cars[j], game);
    }
  }

  if (game.state === "play") {
    if (game.overtime) game.otTime += h;
    else if (game.clockRunning && game.mode !== "freeplay" && !game.awaitGround) {
      game.clock -= h;
      if (game.clock <= 0) {
        // At 0:00 the match only ends once the ball comes down, as in Rocket League.
        game.clock = 0;
        game.awaitGround = true;
        ball.touchedSurface = false;
      }
    }
    if (!ball.hidden) {
      if (ball.x - ball.r > A.W) scoreGoal(0);
      else if (ball.x + ball.r < -A.W) scoreGoal(1);
    }
    if (game.state === "play" && game.awaitGround && ball.touchedSurface) {
      if (game.score[0] === game.score[1]) startOvertime(); else endMatch();
    }
  } else if (game.state === "goal") {
    game.goalTimer -= h;
    if (game.goalTimer <= 0) afterGoal();
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), acc = 0, prevStart = false;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const pad = Input.pad(0);
  if (pad && pad.start && !prevStart && game.state !== "menu" && game.state !== "over") togglePause();
  prevStart = !!(pad && pad.start);

  const running = !game.paused && game.state !== "menu" && game.state !== "over";
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 12) { step(STEP); acc -= STEP; n++; }
    if (n === 12) acc = 0;
  }
  for (const e of game.events) {
    Render.effect(e, game);
    playSound(e);
  }
  game.events.length = 0;

  for (const c of game.cars) {
    if (c.engine) Sound.updateEngine(c.engine, c.speed / P.MAX_SPEED, c.boosting, running);
  }
  Render.frame(game, running ? acc / STEP : 1, running ? dt : 0);
}

function playSound(e) {
  switch (e.type) {
    case "hit": Sound.hit(e.power); break;
    case "ballBounce": if (e.power > 0.15) Sound.hit(e.power * 0.4); break;
    case "jump": case "stall": Sound.jump(); break;
    case "dodge": Sound.dodge(); break;
    case "land": Sound.land(e.power * 0.2); break;
    case "bump": Sound.bump(); break;
    case "flipReset": if (e.car.human) Sound.flipReset(); break;
  }
}

// ------------------------------------------------------------------ UI
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let bannerTimer = null, toastTimer = null;

  function banner(big, sub, team, secs) {
    const el = $("banner");
    el.querySelector(".big").textContent = big;
    el.querySelector(".sub").textContent = sub || "";
    el.className = "banner show" + (team === 0 ? " blue" : team === 1 ? " orange" : "");
    void el.offsetWidth;
    el.classList.add("pop");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.className = "banner"; }, secs * 1000);
  }

  function toast(text, team) {
    const el = $("toast");
    el.textContent = text;
    el.className = "toast show " + (team === 0 ? "blue" : "orange");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, 1400);
  }

  function showScreen(id) {
    for (const s of ["menu", "pause", "over"]) $(s).classList.toggle("hidden", s !== id);
  }

  function showOver() {
    const s = game.score;
    const title = $("overTitle");
    const humans = game.cars.filter((c) => c.human);
    let text;
    if (s[0] === s[1]) text = "DRAW";
    else if (game.mode === "local") text = (s[0] > s[1] ? "PLAYER 1" : "PLAYER 2") + " WINS";
    else if (!humans.length) text = (s[0] > s[1] ? "BLUE" : "ORANGE") + " WINS";
    else text = humans[0].team === (s[0] > s[1] ? 0 : 1) ? "VICTORY" : "DEFEAT";
    title.textContent = text;
    title.className = s[0] > s[1] ? "blue" : s[1] > s[0] ? "orange" : "";
    $("overScore").innerHTML = `<span class="b">${s[0]}</span><span class="dash">–</span><span class="o">${s[1]}</span>`;

    const winTeam = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
    const rating = (c) => c.stats.goals * 100 + c.stats.saves * 50 + c.stats.shots * 20 + c.stats.touches * 2;
    const pool = winTeam >= 0 ? game.cars.filter((c) => c.team === winTeam) : game.cars;
    const mvp = pool.slice().sort((a, b) => rating(b) - rating(a))[0];
    const rows = game.cars.slice().sort((a, b) => a.team - b.team || rating(b) - rating(a)).map((c) =>
      `<tr class="${c.team === 0 ? "blue" : "orange"}"><td>${c === mvp ? "★ " : ""}${escapeHtml(c.name)}</td>` +
      `<td>${rating(c)}</td><td>${c.stats.goals}</td><td>${c.stats.shots}</td><td>${c.stats.saves}</td><td>${c.stats.touches}</td></tr>`
    ).join("");
    $("overStats").innerHTML = `<tr><th>Player</th><th>Score</th><th>Goals</th><th>Shots</th><th>Saves</th><th>Touches</th></tr>${rows}`;
    showScreen("over");
    Sound.stopEngines();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function wireChips() {
    document.querySelectorAll(".chips").forEach((group) => {
      const key = group.dataset.group;
      group.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", b.dataset.value === game[key]);
        b.addEventListener("click", () => {
          game[key] = b.dataset.value;
          group.querySelectorAll("button").forEach((o) => o.classList.toggle("on", o === b));
          savePrefs();
          syncMenu();
        });
      });
    });
  }

  function syncMenu() {
    $("levelSection").classList.toggle("dim", game.mode === "local" || game.mode === "freeplay");
    $("arenaBlurb").textContent = ARENAS[game.arenaId].blurb;
  }

  function savePrefs() {
    try { localStorage.setItem("sideswipe-prefs", JSON.stringify({ mode: game.mode, arenaId: game.arenaId, level: game.level, collisions: game.collisions })); } catch (_) { /* storage unavailable */ }
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem("sideswipe-prefs") || "{}");
      if (MODES[p.mode]) game.mode = p.mode;
      if (ARENAS[p.arenaId]) game.arenaId = p.arenaId;
      if (BOT_LEVELS[p.level]) game.level = p.level;
      if (p.collisions === "on" || p.collisions === "off") game.collisions = p.collisions;
    } catch (_) { /* storage unavailable */ }
  }

  function start() {
    Sound.init();
    Sound.stopEngines();
    setupMatch();
    game.paused = false;
    showScreen(null);
    Input.clearTaps();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (Input.touch.enabled || matchMedia("(pointer: coarse)").matches) {
      const el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {})).catch(() => {});
      }
    }
  }

  function toMenu() {
    game.state = "menu";
    game.paused = false;
    Sound.stopEngines();
    showScreen("menu");
  }

  function init() {
    loadPrefs();
    wireChips();
    syncMenu();
    $("play").addEventListener("click", start);
    $("resume").addEventListener("click", togglePause);
    $("restart").addEventListener("click", start);
    $("quit").addEventListener("click", toMenu);
    $("rematch").addEventListener("click", start);
    $("overMenu").addEventListener("click", toMenu);
    const mute = $("mute");
    mute.addEventListener("click", () => {
      Sound.init();
      mute.textContent = Sound.toggleMute() ? "Sound: Off" : "Sound: On";
    });
    showScreen("menu");
  }

  return { init, banner, toast, showOver, showScreen, start, toMenu };
})();

function togglePause() {
  if (game.state === "menu" || game.state === "over") return;
  game.paused = !game.paused;
  UI.showScreen(game.paused ? "pause" : null);
  if (game.paused) Sound.stopEngines();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" || e.code === "KeyP") togglePause();
  else if (e.code === "KeyM") {
    Sound.init();
    document.getElementById("mute").textContent = Sound.toggleMute() ? "Sound: Off" : "Sound: On";
  } else if (e.code === "KeyR" && game.mode === "freeplay" && game.state === "play") {
    game.ball.place(0, kickoffBallY(game.arena));
  } else if (e.code === "Enter" && game.state === "menu") {
    UI.start();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && !game.paused && (game.state === "play" || game.state === "countdown" || game.state === "goal")) togglePause();
});

Input.captureKeys = true;
Input.onFirstTouch = () => document.body.classList.add("touch");
Render.init(document.getElementById("game"));
Input.attachTouch(document.getElementById("game"), togglePause);
UI.init();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });

// Hooks for automated testing.
window.__SS = { game, step, setupMatch, kickoffReset, STEP };
