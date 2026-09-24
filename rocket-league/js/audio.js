"use strict";
// Synthesized audio (no asset files): engine hum that tracks the local car's speed,
// a boost roar, ball hits, bumps, countdown beeps, and a stadium goal horn.

const Sound = (() => {
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  const engines = [];

  function init() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(freq, dur, type, gain, when = 0, slideTo = null) {
    if (!ac) return;
    const t0 = ac.currentTime + when;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, gain, freq, q = 1, when = 0, type = "bandpass") {
    if (!ac) return;
    const t0 = ac.currentTime + when;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  function makeEngine() {
    if (!ac) return null;
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 400;
    const g = ac.createGain();
    g.gain.value = 0;
    osc.connect(lp).connect(g).connect(master);
    osc.start();

    const bsrc = ac.createBufferSource();
    bsrc.buffer = noiseBuf; bsrc.loop = true;
    const bf = ac.createBiquadFilter();
    bf.type = "bandpass"; bf.frequency.value = 900; bf.Q.value = 0.7;
    const bg = ac.createGain();
    bg.gain.value = 0;
    bsrc.connect(bf).connect(bg).connect(master);
    bsrc.start();
    const e = { osc, lp, g, bg, bf };
    engines.push(e);
    return e;
  }

  function updateEngine(e, speed01, boosting, active) {
    if (!ac || !e) return;
    const t = ac.currentTime;
    const target = active ? 0.035 + speed01 * 0.03 : 0;
    e.g.gain.setTargetAtTime(target, t, 0.08);
    e.osc.frequency.setTargetAtTime(48 + speed01 * 95, t, 0.06);
    e.lp.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.08);
    e.bg.gain.setTargetAtTime(active && boosting ? 0.07 : 0, t, 0.04);
    e.bf.frequency.setTargetAtTime(700 + speed01 * 900, t, 0.1);
  }

  function stopEngines() {
    for (const e of engines) {
      try { e.g.gain.value = 0; e.bg.gain.value = 0; } catch (_) { /* context closed */ }
    }
  }

  return {
    init,
    get ready() { return !!ac; },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    makeEngine, updateEngine, stopEngines,
    hit(power) {
      const p = clamp(power, 0, 1);
      tone(170 + p * 120, 0.16, "sine", 0.18 + p * 0.3, 0, 60);
      noise(0.09, 0.12 + p * 0.25, 1800 + p * 1500, 0.8);
    },
    bump() { tone(90, 0.2, "square", 0.12, 0, 50); noise(0.12, 0.15, 500, 0.8); },
    jump() { noise(0.1, 0.08, 1400, 1.2); },
    dodge() { noise(0.18, 0.1, 2400, 0.6, 0, "highpass"); },
    land(power) { noise(0.08, clamp(power, 0.02, 0.2), 300, 0.7); },
    flipReset() { tone(880, 0.12, "triangle", 0.12); tone(1320, 0.16, "triangle", 0.1, 0.07); },
    beep(final) { tone(final ? 880 : 440, final ? 0.45 : 0.18, "square", 0.12); },
    goal() {
      tone(233, 1.4, "sawtooth", 0.16);
      tone(294, 1.4, "sawtooth", 0.13);
      tone(349, 1.4, "sawtooth", 0.11);
      noise(1.6, 0.25, 900, 0.4, 0.05);
      tone(60, 0.6, "sine", 0.5, 0, 30);
    },
    whistle() { tone(1250, 0.5, "square", 0.05); tone(1480, 0.5, "square", 0.04, 0.02); },
  };
})();
