
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALES = {
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10],
  dorian: [0,2,3,5,7,9,10],
  phrygian: [0,1,3,5,7,8,10],
  pentatonic: [0,2,4,7,9],
  blues: [0,3,5,6,7,10]
};
const STEPS = 16;
let scaleName = 'minor';
let root = 9;
let octave = 4;
let wave = 'sine';
let bpm = 100;
let delayRate = '1/8D';
let compAmount = 0.35;
let forcerAmount = 0.12;
let delayOn = true;
let pattern = [
  new Set([3]), new Set(), new Set(), new Set([1]),
  new Set(), new Set([4]), new Set(), new Set(),
  new Set([2]), new Set(), new Set(), new Set([5]),
  new Set(), new Set([3]), new Set(), new Set()
];
let ctx = null, masterIn = null, delayNode = null, delayFb = null, delayWet = null, delayDry = null;
let echoLow = null, echoHigh = null, echoDrive = null, comp = null, busDrive = null, masterOut = null;
let playing = false, nextTime = 0, stepIdx = 0, timer = null, lockedScrollY = 0;
function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function getRows() { return SCALES[scaleName].length; }
function rowToMidi(row) { return 12 * (octave + 1) + root + SCALES[scaleName][row]; }
function midiLabel(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
function delayRateToSeconds(rate, bpmVal) {
  const quarter = 60 / bpmVal;
  const base = { '1/4': quarter, '1/8': quarter / 2, '1/16': quarter / 4 };
  const m = rate.match(/^(1\/(?:4|8|16))(T|D)?$/);
  if (!m) return quarter / 2;
  let s = base[m[1]];
  if (m[2] === 'T') s *= 2 / 3;
  if (m[2] === 'D') s *= 1.5;
  return Math.min(s, 1.5);
}
function makeCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  const drive = 1 + amount * 18;
  for (let i = 0; i < n; i++) {
    const x = i * 2 / (n - 1) - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}
function ensureCtx() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  masterIn = ctx.createGain(); masterIn.gain.value = 0.9;
  delayNode = ctx.createDelay(1.5); delayNode.delayTime.value = delayRateToSeconds(delayRate, bpm);
  delayFb = ctx.createGain(); delayFb.gain.value = 0.28;
  delayWet = ctx.createGain(); delayWet.gain.value = 0.24;
  delayDry = ctx.createGain(); delayDry.gain.value = 1;
  echoLow = ctx.createBiquadFilter(); echoLow.type = 'lowshelf'; echoLow.frequency.value = 260; echoLow.gain.value = 0;
  echoHigh = ctx.createBiquadFilter(); echoHigh.type = 'highshelf'; echoHigh.frequency.value = 3300; echoHigh.gain.value = 0;
  echoDrive = ctx.createWaveShaper(); echoDrive.oversample = '2x'; echoDrive.curve = makeCurve(forcerAmount * forcerAmount * 0.20);
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.1;
  busDrive = ctx.createWaveShaper(); busDrive.oversample = '2x'; busDrive.curve = makeCurve(compAmount * compAmount * 0.16);
  masterOut = ctx.createGain(); masterOut.gain.value = 0.76;
  masterIn.connect(delayDry);
  masterIn.connect(delayNode);
  delayNode.connect(delayWet);
  delayNode.connect(echoLow);
  echoLow.connect(echoHigh);
  echoHigh.connect(echoDrive);
  echoDrive.connect(delayFb);
  delayFb.connect(delayNode);
  delayDry.connect(comp);
  delayWet.connect(comp);
  comp.connect(busDrive);
  busDrive.connect(masterOut);
  masterOut.connect(ctx.destination);
  applyCompAmount(); applyForcerAmount(); applyDelayBypass();
  return ctx;
}
function applyCompAmount() {
  if (!ctx || !comp || !busDrive) return;
  const a = compAmount, t = ctx.currentTime;
  const push = a * a;
  comp.threshold.setTargetAtTime(-6 - push * 26, t, 0.025);
  comp.ratio.setTargetAtTime(1.15 + push * 7.2, t, 0.025);
  comp.knee.setTargetAtTime(14 - push * 6, t, 0.025);
  comp.attack.setTargetAtTime(0.006 + (1 - a) * 0.018, t, 0.025);
  comp.release.setTargetAtTime(0.07 + (1 - a) * 0.18, t, 0.025);
  busDrive.curve = makeCurve(push * 0.16);
  masterOut.gain.setTargetAtTime(0.88 - push * 0.12, t, 0.025);
}
function applyForcerAmount() {
  if (!ctx || !echoLow || !echoHigh || !echoDrive || !delayFb) return;
  const a = forcerAmount, t = ctx.currentTime;
  const push = a * a;
  echoLow.gain.setTargetAtTime(-push * 4.5, t, 0.035);
  echoHigh.gain.setTargetAtTime(-push * 7.5, t, 0.035);
  echoDrive.curve = makeCurve(push * 0.20);
  const fbBase = Number($('delay-fb').value) / 100;
  delayFb.gain.setTargetAtTime(Math.min(0.82, fbBase + push * 0.025), t, 0.035);
}
function applyDelayBypass() {
  if (!ctx || !delayWet) return;
  const mix = delayOn ? Number($('delay-mix').value) / 100 * 0.62 : 0;
  delayWet.gain.setTargetAtTime(mix, ctx.currentTime, 0.012);
}
function envGain(g, when, peak, attack, decay, sustain, release, dur) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
  g.gain.exponentialRampToValueAtTime(Math.max(peak * sustain, 0.0002), when + attack + decay);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);
}
function noiseBuffer() {
  const len = Math.floor(ctx.sampleRate * 0.32);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function playNote(when, midi, duration, voiceScale) {
  if (!ctx) return;
  const freq = midiToFreq(midi);
  const peak = 0.20 * voiceScale;
  const dest = masterIn || ctx.destination;
  if (wave === 'bell') {
    const carrier = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    carrier.frequency.value = freq; mod.frequency.value = freq * 3.4; mg.gain.value = freq * 1.35;
    mod.connect(mg); mg.connect(carrier.frequency); carrier.connect(g); g.connect(dest);
    envGain(g, when, peak * 1.35, 0.004, 0.06, 0.28, duration * 3.4, duration * 1.1);
    mg.gain.setValueAtTime(freq * 1.35, when); mg.gain.exponentialRampToValueAtTime(freq * 0.08, when + duration * 3.5);
    carrier.start(when); mod.start(when); carrier.stop(when + duration * 4.7); mod.stop(when + duration * 4.7);
    return;
  }
  if (wave === 'flute') {
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; vib.type = 'sine'; vib.frequency.value = 5.2; vg.gain.value = freq * 0.006;
    vib.connect(vg); vg.connect(o.frequency); f.type = 'lowpass'; f.frequency.value = 2300; f.Q.value = 0.8;
    o.connect(f); f.connect(g); g.connect(dest); envGain(g, when, peak * 0.92, 0.035, 0.12, 0.62, 0.18, duration * 1.35);
    const n = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();
    n.buffer = noiseBuffer(); nf.type = 'bandpass'; nf.frequency.value = 3600; nf.Q.value = 0.7; ng.gain.value = 0.012 * voiceScale;
    n.connect(nf); nf.connect(ng); ng.connect(dest); n.start(when); n.stop(when + duration * 1.7);
    o.start(when); vib.start(when); o.stop(when + duration * 1.7); vib.stop(when + duration * 1.7);
    return;
  }
  if (wave === 'rave') {
    const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4400, when); f.frequency.exponentialRampToValueAtTime(760, when + duration * 0.85); f.Q.value = 2.4;
    ['sawtooth','square'].forEach((type, i) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq * (i ? 1.005 : 0.995); o.connect(f); o.start(when); o.stop(when + duration * 1.5); });
    f.connect(g); g.connect(dest); envGain(g, when, peak * 0.85, 0.003, 0.045, 0.18, 0.10, duration * 0.95);
    return;
  }
  if (wave === 'organ' || wave === 'choir') {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = wave === 'choir' ? 'bandpass' : 'lowpass'; f.frequency.value = wave === 'choir' ? 920 : 1800; f.Q.value = wave === 'choir' ? 1.3 : 0.9;
    const types = wave === 'choir' ? ['sine','triangle','sine'] : ['square','triangle'];
    types.forEach((type, i) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq * (1 + (i - 1) * (wave === 'choir' ? 0.006 : 0.003)); o.connect(f); o.start(when); o.stop(when + duration * (wave === 'choir' ? 2.5 : 1.8)); });
    f.connect(g); g.connect(dest); envGain(g, when, peak * (wave === 'choir' ? 0.56 : 0.82), wave === 'choir' ? 0.08 : 0.018, 0.15, wave === 'choir' ? 0.72 : 0.58, wave === 'choir' ? 0.38 : 0.16, duration * 1.45);
    return;
  }
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = wave === 'chiptune' ? 'square' : 'sine'; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = wave === 'chiptune' ? 4200 : 5200; f.Q.value = 0.7;
  o.connect(f); f.connect(g); g.connect(dest);
  envGain(g, when, peak, 0.004, wave === 'chiptune' ? 0.035 : 0.07, wave === 'chiptune' ? 0.25 : 0.5, 0.08, duration * 1.25);
  o.start(when); o.stop(when + duration * 1.55);
}
function render() {
  const rows = getRows();
  $('seq-head').innerHTML = '<div>NOTE</div>' + Array.from({length: STEPS}, (_, i) => '<div>' + (i + 1) + '</div>').join('');
  const grid = $('grid'); grid.innerHTML = '';
  for (let visual = rows - 1; visual >= 0; visual--) {
    const lab = document.createElement('div'); lab.className = 'note-label'; lab.textContent = midiLabel(rowToMidi(visual)); grid.appendChild(lab);
    for (let s = 0; s < STEPS; s++) {
      const c = document.createElement('button'); c.className = 'cell'; if (s % 4 === 0) c.classList.add('beat'); c.dataset.step = s; c.dataset.row = visual; c.setAttribute('aria-label', 'step ' + (s + 1) + ' note ' + lab.textContent); c.setAttribute('aria-pressed', pattern[s].has(visual));
      if (pattern[s].has(visual)) c.classList.add('on');
      c.addEventListener('pointerdown', e => { e.preventDefault(); toggleCell(s, visual, c); });
      grid.appendChild(c);
    }
  }
}
function toggleCell(step, row, el) {
  if (pattern[step].has(row)) pattern[step].delete(row); else pattern[step].add(row);
  el.classList.toggle('on', pattern[step].has(row));
  el.setAttribute('aria-pressed', pattern[step].has(row));
  if (pattern[step].has(row)) { const c = ensureCtx(); if (c) playNote(c.currentTime + 0.01, rowToMidi(row), 0.18, 1); }
}
function lightStep(step) {
  document.querySelectorAll('.cell.lit').forEach(el => el.classList.remove('lit'));
  document.querySelectorAll('.cell[data-step="' + step + '"]').forEach(el => el.classList.add('lit'));
}
function playStep(step, when, stepDur) {
  const rows = Array.from(pattern[step]);
  if (!rows.length) return;
  const gainScale = 1 / Math.sqrt(rows.length);
  rows.forEach(row => playNote(when, rowToMidi(row), stepDur * 1.25, gainScale));
}
function scheduler() {
  if (!playing || !ctx) return;
  while (nextTime < ctx.currentTime + 0.1) {
    const stepDur = (60 / bpm) / 4;
    const cur = stepIdx, when = nextTime;
    playStep(cur, when, stepDur);
    setTimeout(() => lightStep(cur), Math.max(0, (when - ctx.currentTime) * 1000));
    nextTime += stepDur; stepIdx = (stepIdx + 1) % STEPS;
  }
  timer = setTimeout(scheduler, 25);
}
function syncPlayUI() {
  $('play-icon').textContent = playing ? '■' : '▶'; $('dock-play-icon').textContent = playing ? '■' : '▶';
  $('play').classList.toggle('playing', playing); $('dock-play').classList.toggle('playing', playing);
}
function start() { const c = ensureCtx(); if (!c) return; playing = true; stepIdx = 0; nextTime = c.currentTime + 0.05; syncPlayUI(); scheduler(); }
function stop() { playing = false; if (timer) clearTimeout(timer); timer = null; syncPlayUI(); document.querySelectorAll('.cell.lit').forEach(el => el.classList.remove('lit')); }
function regenerate() {
  const rows = getRows();
  for (let s = 0; s < STEPS; s++) {
    pattern[s] = new Set();
    const chance = (s % 4 === 0) ? 0.44 : 0.28;
    if (Math.random() < chance) pattern[s].add(Math.floor(Math.random() * rows));
    if (Math.random() < 0.12) pattern[s].add(Math.floor(Math.random() * rows));
    if (s % 4 === 0 && Math.random() < 0.10) pattern[s].add(Math.floor(Math.random() * rows));
  }
  render();
}
function clearPattern() { pattern = Array.from({length: STEPS}, () => new Set()); render(); }
function setBpm(v) {
  bpm = Number(v); $('bpm').value = bpm; $('dock-bpm').value = bpm; $('bpm-display').textContent = bpm; $('dock-bpm-display').textContent = bpm;
  if (delayNode && ctx) delayNode.delayTime.setTargetAtTime(delayRateToSeconds(delayRate, bpm), ctx.currentTime, 0.04);
}
function updateCompLabel() { const v = Number($('comp-amount').value); $('comp-amount-v').textContent = v; $('comp-state').textContent = v < 22 ? 'LOOSE' : v < 52 ? 'GLUE' : v < 78 ? 'CRUSH' : 'PANIC'; }
function toggleScreenLock() {
  const active = !document.body.classList.contains('ui-locked');
  if (active) document.body.classList.add('ui-locked');
  else document.body.classList.remove('ui-locked');
  $('screen-lock').classList.toggle('on', active); $('screen-lock').textContent = active ? 'LOCKED' : 'LOCK'; $('screen-lock').setAttribute('aria-pressed', active);
}
function preventLockedScroll(e) {
  if (!document.body.classList.contains('ui-locked')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON')) return;
  e.preventDefault();
}
document.addEventListener('touchmove', preventLockedScroll, { passive: false });

function updateKnob(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const val = Number(input.value || 0);
  const pct = max === min ? 0 : (val - min) / (max - min);
  const deg = -135 + pct * 270;
  const shell = input.closest('.knob-shell');
  if (shell) shell.style.setProperty('--deg', deg + 'deg');
}
function initKnobs() {
  document.querySelectorAll('.knob-input').forEach(input => {
    updateKnob(input);
    input.addEventListener('input', () => updateKnob(input));
  });
}

function wire() {
  $('play').addEventListener('click', () => playing ? stop() : start()); $('dock-play').addEventListener('click', () => playing ? stop() : start());
  $('regen').addEventListener('click', regenerate); $('dock-regen').addEventListener('click', regenerate);
  $('clear').addEventListener('click', clearPattern); $('dock-clear').addEventListener('click', clearPattern);
  $('bpm').addEventListener('input', e => setBpm(e.target.value)); $('dock-bpm').addEventListener('input', e => setBpm(e.target.value));
  $('scale').addEventListener('change', e => { scaleName = e.target.value; document.body.dataset.scale = scaleName; const rows = getRows(); pattern.forEach(set => Array.from(set).forEach(r => { if (r >= rows) set.delete(r); })); render(); });
  $('root').addEventListener('change', e => { root = Number(e.target.value); render(); });
  $('oct').addEventListener('change', e => { octave = Number(e.target.value); render(); });
  $('wave').addEventListener('change', e => { wave = e.target.value; });
  $('delay-on').addEventListener('click', () => { delayOn = !delayOn; $('delay-on').classList.toggle('on', delayOn); $('delay-on').setAttribute('aria-pressed', delayOn); applyDelayBypass(); });
  $('delay-rate').addEventListener('change', e => { delayRate = e.target.value; if (delayNode && ctx) delayNode.delayTime.setTargetAtTime(delayRateToSeconds(delayRate, bpm), ctx.currentTime, 0.04); });
  $('delay-mix').addEventListener('input', e => { $('delay-mix-v').textContent = e.target.value; applyDelayBypass(); });
  $('delay-fb').addEventListener('input', e => { $('delay-fb-v').textContent = e.target.value; applyForcerAmount(); });
  $('forcer').addEventListener('input', e => { forcerAmount = Number(e.target.value) / 100; $('forcer-v').textContent = e.target.value; applyForcerAmount(); });
  $('comp-amount').addEventListener('input', e => { compAmount = Number(e.target.value) / 100; updateCompLabel(); applyCompAmount(); });
  $('screen-lock').addEventListener('click', toggleScreenLock);
  $('dock-collapse').addEventListener('click', () => { $('dock').classList.toggle('collapsed'); $('dock-collapse').textContent = $('dock').classList.contains('collapsed') ? '+' : '−'; });
  document.addEventListener('keydown', e => { if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return; if (e.code === 'Space') { e.preventDefault(); playing ? stop() : start(); } });
}
wire(); initKnobs(); updateCompLabel(); render();
