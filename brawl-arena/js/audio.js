"use strict";
// Synthesized sound effects (no audio files).

const Sound = (() => {
  let ac = null, master = null, noiseBuf = null, muted = false;

  function init() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(freq, dur, type, gain, when = 0, slideTo = null) {
    const t0 = ac.currentTime + when;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, gain, freq, type = "bandpass", q = 1, when = 0) {
    const t0 = ac.currentTime + when;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }

  const bank = {
    shotgun: (v) => { noise(0.18, 0.5 * v, 900, "lowpass"); tone(120, 0.12, "square", 0.12 * v, 0, 60); },
    pistol: (v) => { noise(0.07, 0.35 * v, 2500, "bandpass", 2); },
    throw: (v) => { tone(300, 0.15, "triangle", 0.15 * v, 0, 600); },
    punch: (v) => { noise(0.08, 0.35 * v, 500, "lowpass"); },
    jump: (v) => { tone(200, 0.3, "sawtooth", 0.1 * v, 0, 500); },
    boom: (v) => { noise(0.5, 0.7 * v, 300, "lowpass"); tone(90, 0.4, "sine", 0.3 * v, 0, 40); },
    hit: (v) => { tone(700, 0.06, "square", 0.08 * v, 0, 350); },
    death: (v) => { tone(400, 0.35, "sawtooth", 0.12 * v, 0, 90); },
    gem: (v) => { tone(900, 0.1, "sine", 0.2 * v); tone(1350, 0.14, "sine", 0.18 * v, 0.06); },
    mine: (v) => { tone(600, 0.12, "triangle", 0.12 * v, 0, 900); },
    ready: (v) => { tone(660, 0.12, "triangle", 0.2 * v); tone(990, 0.2, "triangle", 0.2 * v, 0.1); },
    countGood: (v) => { [523, 659, 784].forEach((f, i) => tone(f, 0.18, "triangle", 0.2 * v, i * 0.09)); },
    countBad: (v) => { [392, 330, 262].forEach((f, i) => tone(f, 0.2, "sawtooth", 0.12 * v, i * 0.1)); },
    tick: (v) => { tone(1000, 0.05, "square", 0.08 * v); },
    beep: (v) => { tone(660, 0.12, "square", 0.12 * v); },
    go: (v) => { tone(990, 0.35, "square", 0.14 * v); },
    win: (v) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, "triangle", 0.22 * v, i * 0.12)); },
    lose: (v) => { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.35, "triangle", 0.18 * v, i * 0.16)); },
  };

  return {
    init,
    play(name, vol = 1) {
      if (!ac || muted || vol <= 0.02 || !bank[name]) return;
      bank[name](Math.min(1, vol));
    },
    toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() { return muted; },
    set muted(v) { muted = v; if (master) master.gain.value = muted ? 0 : 0.5; },
  };
})();
