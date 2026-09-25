"use strict";
// Main loop, player input, menus and results screen.

const UI = {
  prefs: { brawler: "buck", mode: "gem", map: "canyon", level: "normal", muted: false },
  $: (id) => document.getElementById(id),

  load() {
    try { Object.assign(this.prefs, JSON.parse(localStorage.getItem("brawlArena.prefs") || "{}")); } catch (e) { /* storage blocked */ }
    if (!BRAWLERS[this.prefs.brawler]) this.prefs.brawler = "buck";
    if (!MODES[this.prefs.mode]) this.prefs.mode = "gem";
    if (!MAPS[this.prefs.map] || MAPS[this.prefs.map].mode !== this.prefs.mode) this.prefs.map = this.firstMap(this.prefs.mode);
    if (!BOT_LEVELS[this.prefs.level]) this.prefs.level = "normal";
  },
  firstMap(mode) { return Object.keys(MAPS).find((k) => MAPS[k].mode === mode); },

  save() { try { localStorage.setItem("brawlArena.prefs", JSON.stringify(this.prefs)); } catch (e) { /* ignore */ } },

  show(id) {
    for (const s of ["menu", "pause", "over"]) this.$(s).classList.toggle("hidden", s !== id);
  },

  build() {
    // Brawler cards.
    const grid = this.$("brawlers");
    for (const [key, d] of Object.entries(BRAWLERS)) {
      const el = document.createElement("button");
      el.className = "bcard";
      el.dataset.key = key;
      el.style.setProperty("--c", d.color);
      el.innerHTML = `<canvas width="120" height="120"></canvas><b>${d.name}</b><small>${d.role}</small>
        <div class="bars">${["hp", "dmg", "range", "speed"].map((k) =>
          `<span><i>${{ hp: "Health", dmg: "Damage", range: "Range", speed: "Speed" }[k]}</i><em style="width:${d.bars[k] * 100}%"></em></span>`).join("")}</div>`;
      el.onclick = () => { this.prefs.brawler = key; this.save(); this.refresh(); };
      grid.appendChild(el);
      drawPortrait(el.querySelector("canvas"), key);
    }
    for (const [group, list] of [["mode", MODES], ["map", MAPS], ["level", BOT_LEVELS]]) {
      const box = document.querySelector(`.chips[data-group="${group}"]`);
      for (const [key, v] of Object.entries(list)) {
        const b = document.createElement("button");
        b.dataset.value = key;
        b.textContent = v.name;
        b.onclick = () => {
          const modeChanged = group === "mode" && key !== this.prefs.mode;
          this.prefs[group] = key;
          if (modeChanged) this.prefs.map = this.firstMap(key);
          this.save(); this.refresh();
          if (modeChanged) startDemo();
        };
        box.appendChild(b);
      }
    }
    this.$("play").onclick = () => startMatch();
    this.$("resume").onclick = () => togglePause(false);
    this.$("restart").onclick = () => startMatch();
    this.$("quit").onclick = () => toMenu();
    this.$("again").onclick = () => startMatch();
    this.$("overMenu").onclick = () => toMenu();
    this.$("mute").onclick = () => { Sound.muted = !Sound.muted; this.prefs.muted = Sound.muted; this.save(); this.refresh(); };
    this.refresh();
  },

  refresh() {
    const p = this.prefs, d = BRAWLERS[p.brawler];
    for (const el of document.querySelectorAll(".bcard")) el.classList.toggle("on", el.dataset.key === p.brawler);
    for (const b of document.querySelectorAll('.chips[data-group="mode"] button')) b.classList.toggle("on", b.dataset.value === p.mode);
    for (const b of document.querySelectorAll('.chips[data-group="map"] button')) {
      b.classList.toggle("on", b.dataset.value === p.map);
      b.hidden = MAPS[b.dataset.value].mode !== p.mode;
    }
    for (const el of document.querySelectorAll("[data-mode]")) el.hidden = el.dataset.mode !== p.mode;
    this.$("modeSub").textContent = MODES[p.mode].sub;
    for (const b of document.querySelectorAll('.chips[data-group="level"] button')) b.classList.toggle("on", b.dataset.value === p.level);
    this.$("bdesc").innerHTML = `<b>${d.name}</b>: ${d.desc}<br><span class="super">${d.superDesc}</span>`;
    this.$("mapBlurb").textContent = MAPS[p.map].blurb;
    this.$("mute").textContent = "Sound: " + (Sound.muted ? "Off" : "On");
  },

  results() {
    const won = G.winner === 0, ball = G.mode === "ball";
    this.$("overTitle").textContent = G.draw ? "DRAW" : won ? "VICTORY!" : "DEFEAT";
    this.$("overTitle").className = G.draw ? "" : won ? "win" : "lose";
    const [a, b] = ball ? G.score : G.teamGems;
    this.$("overScore").innerHTML = `<span class="b">${a}</span> <small>${ball ? "goals" : "gems"}</small> <span class="r">${b}</span>`;
    const key = ball ? "goals" : "gems";
    const rows = G.brawlers.slice().sort((a, b) => a.team - b.team || b.stats.kills - a.stats.kills);
    this.$("overStats").innerHTML = `<tr><th></th><th>Brawler</th><th>Defeats</th><th>Deaths</th><th>${ball ? "Goals" : "Gems"}</th><th>Damage</th></tr>` +
      rows.map((b) => `<tr class="t${b.team}${b.isPlayer ? " me" : ""}"><td>${b.name}</td><td>${b.def.name}</td><td>${b.stats.kills}</td><td>${b.stats.deaths}</td><td>${b.stats[key]}</td><td>${b.stats.dmg.toLocaleString()}</td></tr>`).join("");
    this.show("over");
  },
};

// Small brawler portrait for the menu cards, drawn with the in-game renderer.
function drawPortrait(canvas, key) {
  const ctx = canvas.getContext("2d");
  const fake = { key, def: BRAWLERS[key], x: 0, y: 0, z: 0, faceAng: 0.5, team: 0, isPlayer: false, superC: 0, shieldT: 0, hitT: 0, walkT: 0, cool: 0, burst: null, leap: null };
  ctx.save();
  ctx.translate(60, 78);
  ctx.scale(80, 80);
  const saved = G.time; G.time = 0;
  drawBrawler(ctx, fake, 1);
  G.time = saved;
  ctx.restore();
}

// ---------------------------------------------------------------------------- flow

function startDemo() {
  newMatch({ mapId: UI.prefs.map, level: "normal", playerBrawler: null });
  G.demo = true;
  G.intro = 0;
  R.cam.init = false;
}

function startMatch() {
  Sound.init();
  newMatch({ mapId: UI.prefs.map, level: UI.prefs.level, playerBrawler: UI.prefs.brawler });
  G.demo = false;
  R.cam.init = false;
  UI.show(null);
  Sound.play("beep");
}

function toMenu() {
  UI.show("menu");
  startDemo();
}

function togglePause(force) {
  if (G.demo || (G.state !== "play" && G.state !== "ending")) return;
  G.paused = force ?? !G.paused;
  UI.show(G.paused ? "pause" : null);
}

// ---------------------------------------------------------------------------- player input

function playerInput() {
  const p = G.player;
  const inp = { mx: 0, my: 0, aimAng: null, fire: false, super: false };
  R.aim = null;
  if (!p || p.dead || G.demo) return inp;
  const mv = Input.moveVector();
  inp.mx = mv.x; inp.my = mv.y;
  const def = p.def;
  const shapes = aimShapes(p);
  const carrying = G.ball && G.ball.holder === p;
  const auto = (kind) => carrying ? ballAutoAim(p, kind) : autoAim(p, kind === "sup" ? def.superAim : def.aim, def.shotSpeed);
  const doFire = (a) => { inp.fire = true; inp.fireAng = a.ang; inp.fireDist = a.dist; };
  const doSuper = (a) => { inp.super = true; inp.superAng = a.ang; inp.superDist = a.dist; };

  // Mouse: aim with the pointer, left button attacks, right button (or E) fires the super.
  if (!Input.touchMode) {
    const w = toWorld(Input.mouse.x, Input.mouse.y);
    const m = { ang: Math.atan2(w.y - p.y, w.x - p.x), dist: Math.hypot(w.x - p.x, w.y - p.y) };
    const usedMouse = Input.mouse.lastMove > 0;
    if (Input.mouse.left) doFire(m);
    if (Input.mouse.rightPressed || Input.pressed.has("KeyE")) doSuper(usedMouse ? m : auto("sup"));
    if (usedMouse && (performance.now() - Input.mouse.lastMove < 2500 || Input.mouse.left || Input.mouse.right)) {
      R.aim = { kind: Input.mouse.right || Input.keys.has("KeyE") ? "sup" : "atk", ang: m.ang, dist: m.dist, strong: Input.mouse.left || Input.mouse.right };
    }
  }
  // Keyboard quick-fire at the nearest enemy.
  if (Input.keys.has("Space") || Input.pressed.has("Space")) doFire(auto("atk"));
  if (Input.pressed.has("KeyQ")) doSuper(auto("sup"));

  // Touch: release the attack/super stick to fire, or tap it to quick-fire.
  for (const r of Input.releases) {
    const shape = shapes[r.kind];
    const a = r.auto ? auto(r.kind) : { ang: r.ang, dist: Math.max(shape.minRange || 0, r.frac * shape.range) };
    if (r.kind === "atk") doFire(a); else doSuper(a);
  }
  const ta = Input.touchAim();
  if (ta) {
    const shape = shapes[ta.kind];
    R.aim = { kind: ta.kind, ang: ta.ang, dist: ta.frac * shape.range, strong: true };
    inp.aimAng = ta.ang;
  }

  // Gamepad: right stick aims; RT/RB attack, LT/LB super, A/B quick-fire.
  const pad = Input.pad();
  if (pad) {
    const rm = Math.hypot(pad.rx, pad.ry);
    const aimed = rm > 0.3 ? { ang: Math.atan2(pad.ry, pad.rx), dist: rm * shapes.atk.range } : null;
    if (aimed) R.aim = { kind: pad.super ? "sup" : "atk", ang: aimed.ang, dist: aimed.dist, strong: true };
    if (pad.fire) doFire(aimed || auto("atk"));
    if (Input.padEdge(pad, "super")) doSuper(aimed ? { ang: aimed.ang, dist: rm * shapes.sup.range } : auto("sup"));
    if (pad.autoFire) doFire(auto("atk"));
    if (Input.padEdge(pad, "autoSuper")) doSuper(auto("sup"));
    if (Input.padEdge(pad, "start")) togglePause();
  }
  return inp;
}

// Aim shapes for the attack and super buttons: kick and pass while carrying the ball.
function aimShapes(p) {
  if (G.ball && G.ball.holder === p) return { atk: BALL_AIM.kick, sup: BALL_AIM.pass };
  return { atk: p.def.aim, sup: p.def.superAim };
}

// ---------------------------------------------------------------------------- loop

let last = performance.now(), acc = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if ((G.state === "play" || G.state === "ending") && !G.paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) {
      step(STEP, playerInput());
      Input.endFrame();
      acc -= STEP;
      n++;
    }
    if (n === 8) acc = 0;
  } else {
    Input.endFrame();
  }
  if (G.state === "over") {
    if (G.demo) startDemo();
    else if (UI.$("over").classList.contains("hidden")) UI.results();
  }
  playSounds();
  drawGame(dt);
  requestAnimationFrame(frame);
}

function playSounds() {
  if (G.demo) { G.sounds.length = 0; return; }
  const cx = R.cam.x, cy = R.cam.y;
  const loud = new Set(["goal", "whistle", "win", "lose", "tick", "countGood", "countBad"]);
  for (const s of G.sounds) {
    const d = loud.has(s.name) ? 0 : Math.hypot(s.x - cx, s.y - cy);
    Sound.play(s.name, s.vol * clamp(1.3 - d / 10, 0, 1));
  }
  G.sounds.length = 0;
}

// ---------------------------------------------------------------------------- boot

UI.load();
Sound.muted = UI.prefs.muted;
initRender(document.getElementById("game"));
Input.init(document.getElementById("game"));
Input.onPause = () => togglePause();
UI.build();
addEventListener("keydown", (e) => {
  if (e.code === "Escape" || e.code === "KeyP") togglePause();
  if (e.code === "KeyM") { Sound.muted = !Sound.muted; UI.prefs.muted = Sound.muted; UI.save(); UI.refresh(); }
});
addEventListener("pointerdown", () => Sound.init(), { once: true });
startDemo();
requestAnimationFrame(frame);

window.__BA = { G, newMatch, step, STEP, Input, R, playerInput, startMatch, toMenu };
