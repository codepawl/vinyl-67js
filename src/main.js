// Main application controller: connects the 67js 3D renderer, AudioWorklet physics engine,
// direct 3D machine part interactions, non-occluding circle-dot hover callouts, and 4-corner UI.

import { TAU } from './dsp.js';
import {
  RPM33, R_DISC, R_LEADIN, R_LOCK, R_LABEL, R_PROGRAM, R_PROGRAM_MIN,
  PIVOT_X, PIVOT_Y, ALPHA_REST, ALPHA_MIN, alphaForRadius, stylusXY, grooveRadius,
} from './geometry.js';
import { Engine } from './engine.js';
import { cut } from './cut.js';
import { press, makeVis, DEFAULT_CONDITION } from './press.js';
import { demoTracks } from './demo.js';
import { RECORDS, PLAYERS } from './records.js';
import { TurntableRenderer67, LOOKS } from './render67.js';

const $ = (id) => document.getElementById(id);

const canvas = $('gl');
const hoverCanvas = $('hover-canvas');
const hoverCtx = hoverCanvas.getContext('2d');
const leaderSvg = $('leader-svg');
const leaderLine = $('leader-line');
const leaderDotStart = $('leader-dot-start');
const leaderDotEnd = $('leader-dot-end');
const hoverCard = $('hover-card');

const requestedLook = new URLSearchParams(location.search).get('look');
let activeLook = LOOKS[requestedLook] ? requestedLook : 'parlour';

function applyLookTone(lookName) {
  document.documentElement.dataset.tone = LOOKS[lookName].tone || 'dark';
  document.documentElement.style.setProperty('--page', LOOKS[lookName].page);
  for (const button of document.querySelectorAll('#ui-look-tabs .mini-tab')) {
    button.classList.toggle('on', button.dataset.look === lookName);
  }
}

const renderer = new TurntableRenderer67(canvas, {
  look: activeLook,
  onLoadingChange: (isLoading) => $('loading').classList.toggle('on', isLoading),
});
applyLookTone(activeLook);
window.vinylDebug = { renderer, LOOKS };

// --- Application & Physics State ---
let actx = null;
let node = null;
let localEng = new Engine(48000);
let eraFilterChain = null;
// Quiet recordings (a solo piano at -26 LUFS) are brought up to the level of the loud ones, as a listener
// would with the volume knob. The limiter after it keeps the peaks in range.
let recordGainNode = null;
let currentRawWallIn = null;
let currentRawWallOut = null;
let currentRec = null;
let currentVis = null;
let currentMeta = RECORDS[0];
let activeRecId = RECORDS[0].id;
let activePlayerId = 'direct-drive-1979';
let acousticsMode = 'authentic'; // 'authentic' | 'direct'
let pressSeed = 7;

const ui = {
  motor: false,
  cueUp: true,
  rpm: RPM33,
  pitchPct: 0,
  stylus: 'elliptical',
  vtf: 1.8,
  antiskate: 1.8,
  volume: 1.0,
  hum: 0.0,
  noise: 1.0,
  dust: 1.0,
  scratches: 0,
  warp: 0.4,
  ecc: 0.12,
};

let tel = {
  thp: 0, wp: 0, al: ALPHA_REST, zb: 0.005, ze: 0, xi: 0,
  cueUp: true, motor: false, hand: false, auto: 0,
  theta: 0, r: 0.172, err: 0, vg: 0, hc: 1, xg: 0,
  nIn: 0, nOut: 0, loss: 0, peak: 0, cpu: 0,
  vtf: 1.8, antiskate: 1.8, rpm: RPM33,
};
let wallBuf = new Float32Array(5 * 160 * 2 + 2);

// --- Toast helper ---
let toastTimer = 0;
function showToast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// --- Status Pill Icon + Text (distinct shape + color per state) ---
let statusPillShown = '';
function updateStatusPill() {
  const icon = $('status-icon');
  const text = $('status-text');
  const eq = $('now-eq');
  const playing = ui.motor && !tel.cueUp && tel.r <= R_LEADIN + 0.004 && tel.r >= R_LOCK - 0.004;
  // This runs every frame; the page is only touched when the state it shows has changed.
  const shown = playing ? `playing ${effectiveRpm().toFixed(1)}` : ui.motor ? 'spinning' : 'stopped';
  if (shown === statusPillShown) return;
  statusPillShown = shown;
  eq.classList.toggle('playing', playing);
  $('play-btn').classList.toggle('playing', playing);

  if (playing) {
    // Green filled play circle
    icon.innerHTML = '<circle cx="8" cy="8" r="6.5" fill="#46d17d"/><polygon points="6.4,5.2 11.4,8 6.4,10.8" fill="#0d1711"/>';
    text.textContent = `Playing at ${effectiveRpm().toFixed(1)} rpm`;
  } else if (ui.motor) {
    // Amber spinning ring (motor running, stylus lifted)
    icon.innerHTML = '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3" fill="#f5c26b"/><circle cx="8" cy="8" r="2.6" fill="#18140c"/>';
    text.textContent = 'Spinning, needle up';
  } else {
    // Subtle neutral diamond (stopped)
    icon.innerHTML = '<polygon points="8,1.6 14.4,8 8,14.4 1.6,8" fill="#8b8a94"/>';
    text.textContent = 'Stopped';
  }
}

function effectiveRpm() {
  return ui.rpm * (1 + ui.pitchPct / 100);
}

// --- WebAudio & Era Acoustic Horn Filter ---
function buildEraFilterChain(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  const peak1 = ctx.createBiquadFilter();
  const peak2 = ctx.createBiquadFilter();
  const lp = ctx.createBiquadFilter();

  input.connect(hp);
  hp.connect(peak1);
  peak1.connect(peak2);
  peak2.connect(lp);
  const mono = ctx.createGain();
  lp.connect(mono);
  mono.connect(output);

  const chain = { input, output, hp, peak1, peak2, lp, mono };
  configureEraAcoustics(chain);
  return chain;
}

function configureEraAcoustics(chain = eraFilterChain) {
  if (!chain || !actx) return;
  const now = actx.currentTime;
  // A horn machine has a single sound path, so its two channels are summed; the 1979 deck stays stereo.
  const stereo = acousticsMode === 'direct' || activePlayerId === 'direct-drive-1979';
  chain.mono.channelCountMode = stereo ? 'max' : 'explicit';
  chain.mono.channelCount = stereo ? 2 : 1;
  if (acousticsMode === 'direct' || activePlayerId === 'direct-drive-1979') {
    chain.hp.type = 'highpass';
    chain.hp.frequency.setTargetAtTime(18, now, 0.02);
    chain.hp.Q.setTargetAtTime(0.707, now, 0.02);
    chain.peak1.type = 'peaking';
    chain.peak1.frequency.setTargetAtTime(1000, now, 0.02);
    chain.peak1.gain.setTargetAtTime(0, now, 0.02);
    chain.peak2.type = 'peaking';
    chain.peak2.frequency.setTargetAtTime(2400, now, 0.02);
    chain.peak2.gain.setTargetAtTime(0, now, 0.02);
    chain.lp.type = 'lowpass';
    chain.lp.frequency.setTargetAtTime(20500, now, 0.02);
    chain.lp.Q.setTargetAtTime(0.707, now, 0.02);
  } else if (activePlayerId === 'gramophone-1925') {
    // 1925 Morning-Glory Brass Horn + Mica Exhibition Soundbox resonance
    chain.hp.type = 'highpass';
    chain.hp.frequency.setTargetAtTime(210, now, 0.02);
    chain.hp.Q.setTargetAtTime(1.15, now, 0.02);
    chain.peak1.type = 'peaking';
    chain.peak1.frequency.setTargetAtTime(860, now, 0.02);
    chain.peak1.Q.setTargetAtTime(2.2, now, 0.02);
    chain.peak1.gain.setTargetAtTime(4.8, now, 0.02);
    chain.peak2.type = 'peaking';
    chain.peak2.frequency.setTargetAtTime(2150, now, 0.02);
    chain.peak2.Q.setTargetAtTime(2.8, now, 0.02);
    chain.peak2.gain.setTargetAtTime(5.2, now, 0.02);
    chain.lp.type = 'lowpass';
    chain.lp.frequency.setTargetAtTime(4600, now, 0.02);
    chain.lp.Q.setTargetAtTime(1.25, now, 0.02);
  } else if (activePlayerId === 'phonograph-1877') {
    // 1877 Edison Wax Cylinder + Small Spun-Brass Horn acoustic profile
    chain.hp.type = 'highpass';
    chain.hp.frequency.setTargetAtTime(340, now, 0.02);
    chain.hp.Q.setTargetAtTime(1.35, now, 0.02);
    chain.peak1.type = 'peaking';
    chain.peak1.frequency.setTargetAtTime(1180, now, 0.02);
    chain.peak1.Q.setTargetAtTime(3.2, now, 0.02);
    chain.peak1.gain.setTargetAtTime(6.5, now, 0.02);
    chain.peak2.type = 'peaking';
    chain.peak2.frequency.setTargetAtTime(2480, now, 0.02);
    chain.peak2.Q.setTargetAtTime(3.4, now, 0.02);
    chain.peak2.gain.setTargetAtTime(4.5, now, 0.02);
    chain.lp.type = 'lowpass';
    chain.lp.frequency.setTargetAtTime(3300, now, 0.02);
    chain.lp.Q.setTargetAtTime(1.4, now, 0.02);
  }
}

let ensureAudioPromise = null;
async function ensureAudio() {
  if (actx) {
    if (ensureAudioPromise) await ensureAudioPromise;
    if (actx.state === 'suspended') await actx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  actx = new AC({ latencyHint: 'interactive' });
  eraFilterChain = buildEraFilterChain(actx);
  recordGainNode = actx.createGain();
  recordGainNode.connect(eraFilterChain.input);
  applyRecordGain();
  // Safety limiter: a skipping needle or a bad record must never reach the speakers above full scale.
  const limiter = actx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  const clipCurve = new Float32Array([-1, 1]);
  const hardClip = actx.createWaveShaper();
  hardClip.curve = clipCurve;
  eraFilterChain.output.connect(limiter);
  limiter.connect(hardClip);
  eraFilterChain.output = hardClip;
  eraFilterChain.output.connect(actx.destination);

  ensureAudioPromise = (async () => {
    try {
      await actx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
      node = new AudioWorkletNode(actx, 'turntable', { outputChannelCount: [2] });
      node.port.onmessage = (e) => {
        if (e.data.t === 'tel') {
          const d = e.data.d || e.data;
          tel = {
            ...d,
            cpu: d.load ?? d.cpu ?? 0,
            vtf: ui.vtf,
            antiskate: ui.antiskate,
            rpm: effectiveRpm(),
          };
          if (e.data.view) wallBuf = e.data.view;
          else if (e.data.w) wallBuf = e.data.w;
        }
      };
      node.connect(recordGainNode);
      node.port.postMessage({ t: 'view', on: true });
      if (currentRec) sendRecordToWorklet(currentRec);
      post({ t: 'set', o: { stylus: ui.stylus, vtf: ui.vtf, antiskate: ui.antiskate, volume: ui.volume, hum: ui.hum } });
      post({ t: 'speed', rpm: effectiveRpm() });
      post({ t: 'motor', on: ui.motor });
      if (ui.motor && !ui.cueUp) {
        post({ t: 'cueTo', al: alphaForRadius(R_PROGRAM - 0.002) });
      } else {
        post({ t: 'cue', up: ui.cueUp });
      }
    } catch (err) {
      console.warn('AudioWorklet fallback to ScriptProcessor:', err);
      localEng = new Engine(actx.sampleRate);
      if (currentRec) localEng.setRecord(currentRec);
      const sp = actx.createScriptProcessor(512, 0, 2);
      sp.onaudioprocess = (ev) => {
        const t0 = performance.now();
        localEng.process(ev.outputBuffer.getChannelData(0), ev.outputBuffer.getChannelData(1), ev.outputBuffer.length);
        const dt = (performance.now() - t0) / ((ev.outputBuffer.length / actx.sampleRate) * 1000);
        tel = { ...localEng.telemetry(), cpu: dt, vtf: ui.vtf, antiskate: ui.antiskate, rpm: effectiveRpm() };
        wallBuf = localEng.grooveView(5, 160, 400);
      };
      sp.connect(recordGainNode);
    }
    if (actx.state === 'suspended') await actx.resume();
  })();
  await ensureAudioPromise;
}

function post(msg, transfer) {
  if (node) {
    if (msg.t === 'set' && msg.o) {
      node.port.postMessage({ t: 'set', ...msg.o, o: msg.o }, transfer || []);
    } else if (msg.t === 'platterHand') {
      node.port.postMessage({ t: 'platter', on: msg.on }, transfer || []);
    } else {
      node.port.postMessage(msg, transfer || []);
    }
  }
  const e = localEng;
  switch (msg.t) {
    case 'set': e.set(msg.o || msg); break;
    case 'motor': e.setMotor(msg.on); break;
    case 'speed': e.setSpeed(msg.rpm); break;
    case 'cue': e.setCue(msg.up); break;
    case 'hand': e.hand(msg.on, msg.al); break;
    case 'cueTo': e.cueTo(msg.al); break;
    case 'platter':
    case 'platterHand': e.platterHand(msg.on); break;
    case 'platterMove': e.platterMove(msg.d); break;
    case 'bump': e.bump(msg.s); break;
  }
}

function sendRecordToWorklet(rec) {
  if (!node || !rec) return;
  const copy = {
    ...rec,
    wallIn: rec.wallIn.slice(),
    wallOut: rec.wallOut.slice(),
    rTab: rec.rTab.slice(),
  };
  node.port.postMessage(
    { t: 'record', rec: copy },
    [copy.wallIn.buffer, copy.wallOut.buffer, copy.rTab.buffer]
  );
}

// --- Record Loading & Pressing ---
const PREBUILT_ASSET_DIRS = {
  house: 'assets',
  rhapsody: 'assets/rhapsody',
  'summer-air': 'assets/summer-air',
  gymnopedie: 'assets/gymnopedie',
  nocturne: 'assets/nocturne',
  'clair-de-lune': 'assets/clair-de-lune',
};

function pressCond() {
  return {
    ...DEFAULT_CONDITION,
    noise: ui.noise,
    dust: ui.dust * 0.25,
    scratches: ui.scratches * 0.15,
    warp: ui.warp,
    offCenter: ui.ecc,
  };
}

function applyRecord(rec, vis, meta, saveCleanWalls = true) {
  if (saveCleanWalls) {
    currentRawWallIn = rec.wallIn.slice();
    currentRawWallOut = rec.wallOut.slice();
  }
  currentRec = rec;
  if (meta) currentMeta = meta;
  currentVis = vis || makeVis(rec);
  localEng.setRecord(currentRec);
  sendRecordToWorklet(currentRec);
  renderer.setRecord(currentRec, currentVis, currentMeta);
  applyRecordGain();
  $('now-title').textContent = currentMeta.title;
  $('now-dot').style.background = currentMeta.labelColor || currentMeta.color || '#7c1f22';
}

function applyRecordGain() {
  if (!recordGainNode) return;
  const gainDb = (currentMeta && currentMeta.gainDb) || 0;
  recordGainNode.gain.setTargetAtTime(10 ** (gainDb / 20), actx.currentTime, 0.05);
}

function repress() {
  if (!currentRec || !currentRawWallIn || !currentRawWallOut) return;
  currentRec.wallIn.set(currentRawWallIn);
  currentRec.wallOut.set(currentRawWallOut);
  press(currentRec, pressCond(), pressSeed);
  applyRecord(currentRec, currentVis, currentMeta, false);
}

const PARTED_FLAC_DIRS = {
  'assets/rhapsody': 2,
  'assets/summer-air': 2,
};

// Precompiled asset loader (FLAC + JSON + VIS)
async function loadAssetBundle(dir = 'assets') {
  const partCount = PARTED_FLAC_DIRS[dir] || 0;
  const flacPromise = partCount > 1
    ? Promise.all(
        Array.from({ length: partCount }, (_, i) =>
          fetch(`./${dir}/record.flac.part${i}`).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
        )
      ).then((buffers) => {
        const total = buffers.reduce((s, b) => s + b.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const b of buffers) {
          merged.set(new Uint8Array(b), offset);
          offset += b.byteLength;
        }
        return merged.buffer;
      })
    : fetch(`./${dir}/record.flac`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });

  const [metaRes, visRes, flacBuf] = await Promise.all([
    fetch(`./${dir}/record.json`),
    fetch(`./${dir}/record.vis`),
    flacPromise,
  ]);
  if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const visBuf = visRes.ok ? await visRes.arrayBuffer() : null;

  const DecCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decCtx = new DecCtx(2, 1, meta.fs || 48000);
  const audio = await decCtx.decodeAudioData(flacBuf);
  // The file holds 16-bit DPCM of the wall slope (rauchg/vinyl record format, version 2): each sample is a
  // step of `gain` metres, and the wall position is the running sum of those steps.
  if (meta.version !== 2) throw new Error('Prebuilt record is not in format version 2');
  const n = meta.n;
  if (audio.length < n) throw new Error('Prebuilt record is shorter than its manifest says');
  const unpackWall = (steps) => {
    const wall = new Float32Array(n);
    let position = 0;
    for (let index = 0; index < n; index++) {
      position += Math.round(steps[index] * 32768) * meta.gain;
      wall[index] = position;
    }
    return wall;
  };
  const wallIn = unpackWall(audio.getChannelData(0));
  const wallOut = unpackWall(audio.getChannelData(1));

  const rec = {
    ...(meta.rec || meta),
    rTab: new Float64Array(meta.rTab || meta.rec.rTab),
    wallIn,
    wallOut,
  };

  let vis = null;
  if (visBuf && meta.vis && meta.vis.cols) {
    vis = {
      data: new Uint8Array(visBuf),
      cols: meta.vis.cols,
      rows: meta.vis.rows,
    };
  } else {
    vis = makeVis(rec);
  }

  return { rec, vis };
}

// Worker for cutting raw MP3 / user audio files onto a physical groove
let masterWorker = null;
let cutJobId = 0;
function cutInWorker(tracks, fs, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!masterWorker) {
      masterWorker = new Worker(new URL('./master-worker.js', import.meta.url), { type: 'module' });
    }
    const id = ++cutJobId;
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      if (e.data.t === 'done') {
        masterWorker.removeEventListener('message', onMsg);
        resolve({ rec: e.data.rec, vis: e.data.vis });
      } else if (e.data.t === 'error') {
        masterWorker.removeEventListener('message', onMsg);
        reject(new Error(e.data.msg));
      }
    };
    masterWorker.addEventListener('message', onMsg);
    const xfer = [];
    const copyTracks = tracks.map((t) => {
      const L = new Float32Array(t.L);
      const R = new Float32Array(t.R || t.L);
      xfer.push(L.buffer, R.buffer);
      return { L, R, title: t.title };
    });
    masterWorker.postMessage({ t: 'tracks', id, tracks: copyTracks, fs, opts, cond: pressCond(), seed: pressSeed }, xfer);
  });
}

async function decodeAndCutAudioBuffer(arrayBuffer, title, labelColor = '#2e6b9e', inkColor = '#f5efe6') {
  const DecCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = actx || new DecCtx(2, 1, 48000);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  const chL = buf.getChannelData(0);
  const chR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : chL;
  const { rec, vis } = await cutInWorker([{ L: chL, R: chR, title }], buf.sampleRate);
  applyRecord(rec, vis, {
    title,
    by: 'Custom Cut',
    year: '2026',
    labelColor,
    inkColor,
  });
}

function buildQuickDemoRecord() {
  const fs = 48000;
  const tracks = demoTracks(fs).slice(0, 1);
  const rec = cut(tracks, fs, { maxExtra: 150e-6 });
  press(rec, pressCond(), pressSeed);
  return { rec, vis: makeVis(rec) };
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Waits for the machine to reach a state, and gives up after a while so a change can never hang.
async function waitUntil(isReached, timeoutMilliseconds) {
  const deadline = performance.now() + timeoutMilliseconds;
  while (!isReached() && performance.now() < deadline) await pause(40);
}

// Moves the disc between the platter (0) and out of the picture (1).
function animateDiscSwap(from, to, milliseconds) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      renderer.setDiscSwap(to);
      resolve();
    };
    const step = () => {
      if (finished) return;
      const progress = Math.min(1, (performance.now() - startedAt) / milliseconds);
      renderer.setDiscSwap(from + (to - from) * progress);
      if (progress >= 1) finish();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // A hidden tab stops drawing; the change still has to end.
    setTimeout(finish, milliseconds + 120);
  });
}

// A record is changed the way a hand does it: the arm goes back to its rest, the platter stops, the old
// disc comes off, and only then does the new one go on. Clicks made meanwhile replace the record that is
// about to go on instead of starting a second change.
let queuedRecordChange = null;
let recordChangeRunning = false;
let discSwapAmount = 0;

async function changeRecord(item, autoPlay) {
  queuedRecordChange = { item, autoPlay };
  activeRecId = item.id;
  for (const el of document.querySelectorAll('.rec-item')) {
    el.classList.toggle('active', el.dataset.id === item.id);
  }
  $('now-title').textContent = `${item.title}…`;
  $('now-dot').style.background = item.labelColor || '#7c1f22';
  if (recordChangeRunning) return;
  recordChangeRunning = true;
  try {
    while (queuedRecordChange) await runRecordChange();
  } finally {
    recordChangeRunning = false;
  }
}

async function runRecordChange() {
  const armIsParked = () => tel.al >= ALPHA_REST - 0.02;
  if (!armIsParked() || !tel.cueUp) {
    ui.cueUp = true;
    post({ t: 'cueTo', al: ALPHA_REST });
    syncSettingsUI();
    await waitUntil(armIsParked, 3500);
  }
  if (ui.motor) {
    ui.motor = false;
    post({ t: 'motor', on: false });
    syncSettingsUI();
    updateStatusPill();
    await waitUntil(() => Math.abs(tel.wp || 0) < 1.2, 1400);
  }

  if (renderer.hasDisc()) {
    await animateDiscSwap(discSwapAmount, 1, 650 * (1 - discSwapAmount) + 50);
    discSwapAmount = 1;
  } else {
    // The phonograph has no disc to carry away; the needle carrier stays lifted for a moment instead.
    await pause(450);
  }

  // Whatever was asked for last is the record that goes on.
  const request = queuedRecordChange;
  queuedRecordChange = null;
  await selectRecord(request.item, false);
  if (queuedRecordChange) return;

  if (renderer.hasDisc()) {
    await animateDiscSwap(1, 0, 700);
    discSwapAmount = 0;
  }
  if (request.autoPlay && !queuedRecordChange) await startPlayback();
}

let loadSeq = 0;
async function selectRecord(item, autoPlay = false) {
  const mySeq = ++loadSeq;
  activeRecId = item.id;
  for (const el of document.querySelectorAll('.rec-item')) {
    el.classList.toggle('active', el.dataset.id === item.id);
  }
  $('now-title').textContent = `${item.title}…`;
  $('now-dot').style.background = item.labelColor || '#7c1f22';

  try {
    const assetDir = PREBUILT_ASSET_DIRS[item.id];
    if (assetDir) {
      const { rec, vis } = await loadAssetBundle(assetDir);
      if (mySeq !== loadSeq) return;
      applyRecord(rec, vis, item);
      // The bundle is the clean cut; noise, dust and warp are pressed in here, as upstream does.
      repress();
    } else if (item.tracks && item.tracks.length) {
      showToast(`Cutting grooves for "${item.title}"…`, 5000);
      const DecCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const decCtx = actx || new DecCtx(2, 1, 48000);
      const decodedTracks = [];
      let sr = 48000;
      for (const tr of item.tracks) {
        const res = await fetch(`./records/${tr.file}`);
        const ab = await res.arrayBuffer();
        const buf = await decCtx.decodeAudioData(ab);
        sr = buf.sampleRate;
        decodedTracks.push({
          L: buf.getChannelData(0),
          R: buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0),
          title: tr.title,
        });
      }
      if (mySeq !== loadSeq) return;
      const { rec, vis } = await cutInWorker(decodedTracks, sr, item.cut || {});
      if (mySeq !== loadSeq) return;
      applyRecord(rec, vis, item);
    } else {
      const { rec, vis } = buildQuickDemoRecord();
      if (mySeq !== loadSeq) return;
      applyRecord(rec, vis, item);
    }
    showToast(`Loaded: ${item.title} (${item.by})`);
    if (autoPlay) await startPlayback();
  } catch (err) {
    console.warn('Fallback to procedural groove:', err);
    if (mySeq !== loadSeq) return;
    const { rec, vis } = buildQuickDemoRecord();
    applyRecord(rec, vis, item);
  }
}

function isPlaying() {
  return ui.motor && !tel.cueUp && tel.r <= R_LEADIN + 0.004 && tel.r >= R_LOCK - 0.004;
}

// Skipping lifts the needle and sets it down in the groove that many seconds away, as a hand would.
// Presses made while the arm is still travelling add to the place it is heading for.
const SEEK_TRAVEL_MILLISECONDS = 2500;
let seekTargetTheta = 0;
let seekStartedAt = -Infinity;
// The lowered needle settles a little outside the spot the arm was aimed at. Each landing is measured and
// the next aim is moved by what was learned, so a skip lands on the second it was asked for.
let seekRadiusBias = 0.0015;
let seekAwaitingLanding = false;
let seekLandedAt = 0;
function measureSeekLanding() {
  if (!seekAwaitingLanding || !currentRec) return;
  if (tel.cueUp || tel.auto) {
    seekLandedAt = 0;
    return;
  }
  const now = performance.now();
  if (!seekLandedAt) seekLandedAt = now;
  const settledSeconds = (now - seekLandedAt) / 1000;
  if (settledSeconds < 0.8) return;
  seekAwaitingLanding = false;
  if (!isPlaying()) return;
  const expectedTheta = Math.min(currentRec.thetaEnd, seekTargetTheta + settledSeconds * (RPM33 / 60) * TAU);
  const miss = grooveRadius(currentRec.rTab, tel.theta) - grooveRadius(currentRec.rTab, expectedTheta);
  seekRadiusBias = Math.max(-0.003, Math.min(0.003, seekRadiusBias + miss));
  window.vinylDebug.lastSeek = { miss, bias: seekRadiusBias };
}
function seekBySeconds(seconds) {
  if (!currentRec || recordChangeRunning) return;
  const armIsTravelling = performance.now() - seekStartedAt < SEEK_TRAVEL_MILLISECONDS;
  if (!armIsTravelling && !isPlaying()) {
    startPlayback();
    return;
  }
  const turnsPerSecond = RPM33 / 60;
  const from = armIsTravelling ? seekTargetTheta : tel.theta;
  seekTargetTheta = Math.max(0, Math.min(currentRec.thetaEnd, from + seconds * turnsPerSecond * TAU));
  seekStartedAt = performance.now();
  ui.cueUp = false;
  seekAwaitingLanding = true;
  seekLandedAt = 0;
  post({ t: 'cueTo', al: alphaForRadius(grooveRadius(currentRec.rTab, seekTargetTheta) - seekRadiusBias) });
}

// When a side runs out the needle circles the locked groove for a moment, then the next record goes on.
const RUN_OUT_MILLISECONDS = 2500;
let runOutSince = 0;
function checkRecordEnd() {
  const inRunOut = ui.motor && !tel.cueUp && tel.r <= R_LOCK + 0.003 && !recordChangeRunning && !dragMode;
  if (!inRunOut) {
    runOutSince = 0;
    return;
  }
  const now = performance.now();
  if (!runOutSince) runOutSince = now;
  if (now - runOutSince < RUN_OUT_MILLISECONDS) return;
  runOutSince = 0;
  const index = RECORDS.findIndex((record) => record.id === activeRecId);
  const next = RECORDS[(index + 1) % RECORDS.length];
  showToast(`Record finished. Next: ${next.title}`, 4000);
  changeRecord(next, true);
}

function cycleRecord(step = 1) {
  const idx = RECORDS.findIndex((r) => r.id === activeRecId);
  const nextIdx = (idx + step + RECORDS.length) % RECORDS.length;
  changeRecord(RECORDS[nextIdx], ui.motor);
}

// --- Deck Control Actions ---
async function setMotorState(on) {
  await ensureAudio();
  ui.motor = !!on;
  post({ t: 'motor', on: ui.motor });
  // When starting the motor from a parked or lifted state, automatically cue the stylus onto the lead-in groove so music plays right away!
  if (ui.motor && tel.cueUp) {
    if (tel.al > alphaForRadius(R_LEADIN + 0.004)) {
      ui.cueUp = false;
      post({ t: 'cueTo', al: alphaForRadius(R_PROGRAM - 0.002) });
    } else {
      ui.cueUp = false;
      post({ t: 'cue', up: false });
    }
  }
  syncSettingsUI();
  updateStatusPill();
}

async function toggleMotor() {
  await setMotorState(!ui.motor);
}

async function toggleCue() {
  await ensureAudio();
  if (tel.cueUp) {
    if (!ui.motor) {
      ui.motor = true;
      post({ t: 'motor', on: true });
    }
    if (tel.al > alphaForRadius(R_LEADIN + 0.004)) {
      ui.cueUp = false;
      post({ t: 'cueTo', al: alphaForRadius(R_PROGRAM - 0.002) });
    } else {
      ui.cueUp = false;
      post({ t: 'cue', up: false });
    }
  } else {
    ui.cueUp = true;
    post({ t: 'cue', up: true });
  }
  syncSettingsUI();
  updateStatusPill();
}

async function startPlayback() {
  await ensureAudio();
  if (!ui.motor) {
    ui.motor = true;
    post({ t: 'motor', on: true });
  }
  if (tel.cueUp || tel.al > alphaForRadius(R_LEADIN + 0.004)) {
    ui.cueUp = false;
    post({ t: 'cueTo', al: alphaForRadius(R_PROGRAM - 0.002) });
  }
  syncSettingsUI();
  updateStatusPill();
}

function setSpeedRpm(rpm) {
  ui.rpm = rpm;
  post({ t: 'speed', rpm: effectiveRpm() });
  syncSettingsUI();
  updateStatusPill();
}

function cycleSpeedRpm() {
  if (ui.rpm < 39) setSpeedRpm(45);
  else if (ui.rpm < 60) setSpeedRpm(78);
  else setSpeedRpm(RPM33);
  const label = ui.rpm < 39 ? '33⅓ rpm' : ui.rpm < 60 ? '45 rpm' : '78 rpm';
  showToast(`Speed ${label}`);
}

function setPitchPct(pct) {
  ui.pitchPct = Math.max(-8, Math.min(8, pct));
  renderer.pitchPct = ui.pitchPct;
  post({ t: 'speed', rpm: effectiveRpm() });
  syncSettingsUI();
  updateStatusPill();
}

function setPlayerEra(playerId) {
  activePlayerId = playerId;
  renderer.setPlayer(playerId);
  if (currentRec) renderer.setRecord(currentRec, currentVis, currentMeta);
  configureEraAcoustics();
  for (const btn of document.querySelectorAll('.era-tab')) {
    btn.classList.toggle('active', btn.dataset.player === playerId);
  }
  const pMeta = PLAYERS.find((p) => p.id === playerId) || PLAYERS[2];
  clearHoverOverlay();
}

function syncSettingsUI() {
  const motorBtn = $('ui-motor-btn');
  motorBtn.textContent = ui.motor ? 'Stop' : 'Start';
  motorBtn.classList.toggle('on', ui.motor);

  const cueBtn = $('ui-cue-btn');
  cueBtn.textContent = tel.cueUp ? 'Lower needle' : 'Lift needle';
  cueBtn.classList.toggle('on', !tel.cueUp);

  for (const b of document.querySelectorAll('#ui-speed-tabs .mini-tab')) {
    const r = parseFloat(b.dataset.rpm);
    b.classList.toggle('on', Math.abs(r - ui.rpm) < 1.5);
  }
  for (const b of document.querySelectorAll('#ui-acoustics-tabs .mini-tab')) {
    b.classList.toggle('on', b.dataset.acoustics === acousticsMode);
  }
  for (const b of document.querySelectorAll('#ui-stylus-tabs .mini-tab')) {
    b.classList.toggle('on', b.dataset.stylus === ui.stylus);
  }

  $('s-pitch').value = ui.pitchPct;
  $('v-pitch').textContent = `${ui.pitchPct >= 0 ? '+' : ''}${ui.pitchPct.toFixed(1)}%`;
  $('s-vtf').value = ui.vtf;
  $('v-vtf').textContent = `${ui.vtf.toFixed(2)} g`;
  $('s-as').value = ui.antiskate;
  $('v-as').textContent = `${ui.antiskate.toFixed(2)} g`;
  $('s-vol').value = ui.volume;
  $('v-vol').textContent = `${Math.round(ui.volume * 100)}%`;
  $('s-hum').value = ui.hum;
  $('v-hum').textContent = `${Math.round(ui.hum * 100)}%`;
}

// --- Live State String for Hovered 3D Control ---
function getControlLiveState(ctrl) {
  switch (ctrl.id) {
    case 'ph-crank':
    case 'gr-crank':
    case 'dd-start':
    case 'dd-strobe':
      return ui.motor ? 'Running' : 'Stopped';
    case 'gr-brake':
      return ui.motor ? 'Released' : 'Braked';
    case 'ph-lift':
    case 'gr-cue':
    case 'dd-cue':
      return tel.cueUp ? 'Needle up' : 'Needle down';
    case 'ph-speed':
    case 'gr-speed':
      return ui.rpm < 39 ? '33⅓ rpm' : ui.rpm < 60 ? '45 rpm' : '78 rpm';
    case 'dd-btn33':
      return ui.rpm < 39 ? 'On' : 'Off';
    case 'dd-btn45':
      return ui.rpm >= 39 && ui.rpm < 60 ? 'On' : 'Off';
    case 'dd-btn78':
      return ui.rpm >= 60 ? 'Active · 78' : '78 RPM';
    case 'ph-spare':
    case 'gr-label':
    case 'dd-puck':
      return currentMeta.title;
    case 'dd-pitch':
      return Math.abs(ui.pitchPct) < 0.08
        ? '0.0%'
        : `${ui.pitchPct >= 0 ? '+' : ''}${ui.pitchPct.toFixed(1)}%`;
    case 'dd-counterweight':
      return `${ui.vtf.toFixed(2)} g`;
    case 'dd-antiskate':
      return `${ui.antiskate.toFixed(2)} g`;
    case 'ph-carriage':
    case 'gr-tonearm':
    case 'dd-headshell':
      return `${(tel.r * 1000).toFixed(1)} mm`;
    case 'ph-cylinder':
    case 'gr-disc':
    case 'dd-disc':
      return `${(tel.wp * 60 / TAU).toFixed(1)} rpm`;
    case 'ph-horn':
    case 'gr-horn':
      return acousticsMode === 'authentic' ? 'Era sound' : 'Clean sound';
    default:
      return ctrl.badge;
  }
}

// --- Non-Occluding Circle-Dot Leader Line & Tooltip Positioning ---
let hoveredControl = null;
let pendingHoverPoint = null;
const hoverLock = { key: '', centre: null };
// What the hover card last showed, so the page is only laid out again when the words change.
const hoverCardShown = { title: '', state: '', how: '', width: 0, height: 0, left: '', top: '', points: '' };

function clearHoverOverlay() {
  pendingHoverPoint = null;
  hoveredControl = null;
  canvas.classList.remove('hover-part');
  hoverCtx.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
  leaderSvg.classList.remove('on');
  hoverCard.classList.remove('on');
}

function hoverCardPlacement(centre, machine, cardWidth, cardHeight, viewWidth, viewHeight) {
  // The card sits outside the machine's screen box, on the side the hovered part is nearer to.
  const margin = 16;
  const gap = 28;
  const topLimit = viewWidth < 860 ? 84 : 60;
  const bottomLimit = viewHeight - 56;
  const [machineLeft, machineTop, machineRight, machineBottom] = machine;
  const roomLeft = machineLeft - margin;
  const roomRight = viewWidth - margin - machineRight;
  const preferLeft = centre[0] < (machineLeft + machineRight) / 2;
  const clampY = (y) => Math.max(topLimit, Math.min(bottomLimit - cardHeight, y));
  const sides = preferLeft ? ['left', 'right'] : ['right', 'left'];
  for (const side of sides) {
    const room = side === 'left' ? roomLeft : roomRight;
    if (room < cardWidth + gap) continue;
    const x = side === 'left'
      ? Math.max(margin, machineLeft - gap - cardWidth)
      : Math.min(viewWidth - margin - cardWidth, machineRight + gap);
    let y = clampY(centre[1] - cardHeight / 2);
    // The specs panel owns the bottom left corner.
    if (side === 'left' && viewWidth >= 860) y = Math.min(y, viewHeight - 250 - cardHeight);
    return { x, y: Math.max(topLimit, y), side };
  }
  // No room beside the machine (phone, or zoomed in): use the strip above or below it.
  const roomAbove = machineTop - topLimit;
  const roomBelow = bottomLimit - machineBottom;
  const x = Math.max(margin, Math.min(viewWidth - margin - cardWidth, centre[0] - cardWidth / 2));
  if (roomAbove >= roomBelow) return { x, y: Math.max(topLimit, machineTop - gap - cardHeight), side: 'above' };
  return { x, y: Math.min(bottomLimit - cardHeight, machineBottom + gap), side: 'below' };
}

function updateHoverVisuals(ctrl) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = window.innerWidth, cssH = window.innerHeight;
  if (hoverCanvas.width !== Math.floor(cssW * dpr) || hoverCanvas.height !== Math.floor(cssH * dpr)) {
    hoverCanvas.width = Math.floor(cssW * dpr);
    hoverCanvas.height = Math.floor(cssH * dpr);
  }
  hoverCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!ctrl) {
    clearHoverOverlay();
    return;
  }

  const info = renderer.drawHoverOverlay(hoverCtx, ctrl, cssW, cssH);
  if (!info) {
    clearHoverOverlay();
    return;
  }

  const liveState = getControlLiveState(ctrl);
  const wordsChanged = hoverCardShown.title !== ctrl.title || hoverCardShown.state !== liveState || hoverCardShown.how !== ctrl.howTo;
  if (wordsChanged || hoverCardShown.width === 0) {
    $('hc-title').textContent = ctrl.title;
    $('hc-state').textContent = liveState;
    $('hc-how').textContent = ctrl.howTo;
    hoverCardShown.title = ctrl.title;
    hoverCardShown.state = liveState;
    hoverCardShown.how = ctrl.howTo;
    hoverCardShown.width = hoverCard.offsetWidth;
    hoverCardShown.height = hoverCard.offsetHeight;
  }
  const cardWidth = hoverCardShown.width;
  const cardHeight = hoverCardShown.height;
  const lockKey = `${ctrl.id} ${renderer.cameraKey()} ${cssW}x${cssH} ${cardWidth}x${cardHeight}`;
  // The machine's own outline also shifts while it plays (the phonograph's carriage travels), and the card
  // is placed against that outline, so it is held as well.
  if (hoverLock.key === lockKey) {
    info.machineBounds = hoverLock.machineBounds;
    if (ctrl.turns) info.centre = hoverLock.centre;
  } else {
    hoverLock.key = lockKey;
    hoverLock.centre = info.centre;
    hoverLock.machineBounds = info.machineBounds;
  }
  const place = hoverCardPlacement(info.centre, info.machineBounds, cardWidth, cardHeight, cssW, cssH);

  // The leader starts on the part with a round dot and ends on the card edge that faces the part.
  const [startX, startY] = info.centre;
  let endX;
  let endY;
  if (place.side === 'left' || place.side === 'right') {
    endX = place.side === 'left' ? place.x + cardWidth : place.x;
    endY = Math.max(place.y + 16, Math.min(place.y + cardHeight - 16, startY));
  } else {
    endX = Math.max(place.x + 16, Math.min(place.x + cardWidth - 16, startX));
    endY = place.side === 'above' ? place.y + cardHeight : place.y;
  }
  const points = `${startX.toFixed(1)},${startY.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`;
  if (points !== hoverCardShown.points) {
    hoverCardShown.points = points;
    leaderLine.setAttribute('points', points);
    leaderDotStart.setAttribute('cx', startX.toFixed(1));
    leaderDotStart.setAttribute('cy', startY.toFixed(1));
    leaderDotEnd.setAttribute('cx', endX.toFixed(1));
    leaderDotEnd.setAttribute('cy', endY.toFixed(1));
  }
  leaderSvg.classList.add('on');

  const left = `${Math.round(place.x)}px`;
  const top = `${Math.round(place.y)}px`;
  if (left !== hoverCardShown.left || top !== hoverCardShown.top) {
    hoverCardShown.left = left;
    hoverCardShown.top = top;
    hoverCard.style.left = left;
    hoverCard.style.top = top;
  }
  hoverCard.classList.add('on');
}

// --- Direct 3D Pointer Interactions ---
let dragMode = null; // null | 'arm' | 'carriage' | 'platter' | 'pitch' | 'vtf' | 'antiskate' | 'crank' | 'orbit' | 'pan'
let downX = 0, downY = 0, lastX = 0, lastY = 0;
let dragMoved = false;
let lastPlatterAng = 0;
let dragStartVal = 0;

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  closeDropdowns();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;
  dragMoved = false;

  if (e.button === 2 || e.shiftKey) {
    dragMode = 'pan';
    canvas.classList.add('dragging');
    return;
  }

  const pick = renderer.pickControl(e.clientX, e.clientY);
  if (pick) {
    const id = pick.control.id;
    hoveredControl = pick.control;

    if (id === 'dd-headshell' || id === 'gr-tonearm') {
      dragMode = 'arm';
      ui.cueUp = true;
      post({ t: 'hand', on: true, al: tel.al });
      canvas.classList.add('dragging');
      return;
    }
    if (id === 'dd-pitch') {
      dragMode = 'pitch';
      dragStartVal = ui.pitchPct;
      canvas.classList.add('dragging');
      return;
    }
    if (id === 'dd-counterweight') {
      dragMode = 'vtf';
      dragStartVal = ui.vtf;
      canvas.classList.add('dragging');
      return;
    }
    if (id === 'dd-antiskate') {
      dragMode = 'antiskate';
      dragStartVal = ui.antiskate;
      canvas.classList.add('dragging');
      return;
    }
    if (id === 'ph-crank' || id === 'gr-crank') {
      dragMode = 'crank';
      canvas.classList.add('dragging');
      return;
    }
    if (id === 'dd-disc' || id === 'gr-disc' || id === 'ph-cylinder') {
      // Check if center label clicked -> switch record on click!
      if ((id === 'dd-disc' || id === 'gr-disc') && pick.hitR < R_LABEL) {
        dragMode = 'label-click';
        return;
      }
      dragMode = 'platter';
      lastPlatterAng = Math.atan2(pick.hitPhys[1], pick.hitPhys[0]);
      post({ t: 'platterHand', on: true });
      canvas.classList.add('dragging');
      return;
    }

    // Immediate button/lever click target
    dragMode = `click:${id}`;
    return;
  }

  dragMode = 'orbit';
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) dragMoved = true;

  if (!dragMode) {
    // A mouse reports far more often than the screen redraws, so the pick waits for the next frame.
    pendingHoverPoint = [e.clientX, e.clientY];
    return;
  }

  if (dragMode === 'orbit') {
    renderer.orbit(dx * 0.0065, dy * 0.0065);
    clearHoverOverlay();
  } else if (dragMode === 'pan') {
    renderer.pan(dx, dy);
    clearHoverOverlay();
  } else if (dragMode === 'arm') {
    const radius = renderer.armRadiusAt(e.clientX, e.clientY);
    if (radius !== null) {
      const clamped = Math.max(0.049, Math.min(0.172, radius));
      post({ t: 'hand', on: true, al: alphaForRadius(clamped) });
    }
  } else if (dragMode === 'platter') {
    const p = renderer.rayPlanePhysXY(e.clientX, e.clientY, 0.002);
    if (p) {
      const a = Math.atan2(p[1], p[0]);
      let d = a - lastPlatterAng;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      lastPlatterAng = a;
      post({ t: 'platterMove', d });
    }
  } else if (dragMode === 'pitch') {
    const pct = dragStartVal + (e.clientY - downY) * 0.08;
    setPitchPct(pct);
  } else if (dragMode === 'vtf') {
    ui.vtf = Math.max(0.5, Math.min(3.5, dragStartVal - (e.clientY - downY) * 0.015));
    post({ t: 'set', o: { vtf: ui.vtf } });
    syncSettingsUI();
  } else if (dragMode === 'antiskate') {
    ui.antiskate = Math.max(0.0, Math.min(3.5, dragStartVal - (e.clientY - downY) * 0.015));
    post({ t: 'set', o: { antiskate: ui.antiskate } });
    syncSettingsUI();
  } else if (dragMode === 'crank') {
    post({ t: 'platterMove', d: -dy * 0.03 });
  }
});

function handleControlClick(id, e) {
  switch (id) {
    case 'dd-start':
    case 'dd-strobe':
    case 'gr-brake':
    case 'ph-crank':
    case 'gr-crank':
      toggleMotor();
      showToast(ui.motor ? 'Started' : 'Stopped');
      break;
    case 'dd-cue':
    case 'gr-cue':
    case 'ph-lift':
      toggleCue();
      showToast(ui.cueUp ? 'Needle up' : 'Needle down');
      break;
    case 'dd-btn33':
      setSpeedRpm(RPM33);
      showToast('33⅓ rpm');
      break;
    case 'dd-btn45':
      setSpeedRpm(45);
      showToast('45 rpm');
      break;
    case 'dd-btn78':
      setSpeedRpm(78);
      showToast('78 rpm');
      break;
    case 'ph-speed':
    case 'gr-speed':
      cycleSpeedRpm();
      break;
    case 'ph-spare':
    case 'gr-label':
    case 'dd-puck':
      cycleRecord(1);
      break;
    case 'ph-horn':
    case 'gr-horn':
      acousticsMode = acousticsMode === 'authentic' ? 'direct' : 'authentic';
      configureEraAcoustics();
      syncSettingsUI();
      showToast(acousticsMode === 'authentic' ? 'Sound of the era' : 'Clean sound');
      break;
  }
}

function endPointer(e) {
  canvas.classList.remove('dragging');
  if (!dragMode) return;

  if (dragMode === 'arm' || dragMode === 'carriage') {
    if (!dragMoved) {
      toggleCue();
    } else {
      const [sx, sy] = stylusXY(tel.al);
      const r = Math.hypot(sx, sy);
      const onDisc = r < R_LEADIN + 0.004 && r > R_LOCK - 0.005;
      post({ t: 'hand', on: false });
      if (!onDisc) {
        ui.cueUp = true;
        post({ t: 'cue', up: true });
      } else {
        ui.cueUp = false;
        if (!ui.motor) setMotorState(true);
      }
      syncSettingsUI();
      updateStatusPill();
    }
  } else if (dragMode === 'platter') {
    post({ t: 'platterHand', on: false });
    if (!dragMoved) {
      // Single click on groove -> drop stylus right onto that track radius and start playing!
      const pick = renderer.pickControl(e.clientX, e.clientY);
      if (pick) {
        if (activePlayerId === 'phonograph-1877') {
          const norm = renderer.drumProgressAt(pick.hitPhys[0]);
          const r = R_PROGRAM - norm * (R_PROGRAM - R_PROGRAM_MIN);
          if (!ui.motor) setMotorState(true);
          ui.cueUp = false;
          post({ t: 'cueTo', al: alphaForRadius(r) });
        } else if (pick.hitR >= R_LOCK && pick.hitR <= R_LEADIN) {
          if (!ui.motor) setMotorState(true);
          ui.cueUp = false;
          post({ t: 'cueTo', al: alphaForRadius(pick.hitR) });
        }
        syncSettingsUI();
        updateStatusPill();
      }
    }
  } else if (dragMode === 'label-click' && !dragMoved) {
    cycleRecord(1);
  } else if (dragMode === 'crank' && !dragMoved) {
    toggleMotor();
  } else if (dragMode.startsWith('click:') && !dragMoved) {
    handleControlClick(dragMode.slice(6), e);
  }

  dragMode = null;
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (!dragMode) clearHoverOverlay();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('dblclick', (e) => {
  const pick = renderer.pickControl(e.clientX, e.clientY);
  if (pick && pick.control.id === 'dd-pitch') {
    setPitchPct(0);
    showToast('Pitch back to 0');
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoom(Math.exp(e.deltaY * 0.001));
}, { passive: false });

// --- Build Top-Right Records Shelf & Bind UI Controls ---
function buildShelfUI() {
  const list = $('shelf-list');
  list.innerHTML = '';
  for (const item of RECORDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rec-item' + (item.id === activeRecId ? ' active' : '');
    btn.dataset.id = item.id;
    btn.innerHTML = `
      <span class="rec-disc-icon" style="--lc:${item.labelColor}"></span>
      <span class="rec-meta">
        <div class="rt">${item.title}</div>
        <div class="rs">${item.by} · ${item.credit || ''}</div>
      </span>
      <span class="rec-era">${item.year}</span>
    `;
    btn.addEventListener('click', () => {
      closeDropdowns();
      changeRecord(item, true);
    });
    list.appendChild(btn);
  }
}

function closeDropdowns() {
  $('shelf-panel').classList.remove('open');
  $('settings-panel').classList.remove('open');
  $('now-btn').classList.remove('open');
  $('settings-btn').classList.remove('active');
}

$('now-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !$('shelf-panel').classList.contains('open');
  closeDropdowns();
  if (open) {
    $('shelf-panel').classList.add('open');
    $('now-btn').classList.add('open');
  }
});

$('settings-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !$('settings-panel').classList.contains('open');
  closeDropdowns();
  if (open) {
    $('settings-panel').classList.add('open');
    $('settings-btn').classList.add('active');
  }
});

$('next-rec-btn').addEventListener('click', () => cycleRecord(1));
$('prev-rec-btn').addEventListener('click', () => cycleRecord(-1));
$('play-btn').addEventListener('click', () => toggleCue());
$('back-btn').addEventListener('click', () => seekBySeconds(-5));
$('forward-btn').addEventListener('click', () => seekBySeconds(5));

// Era Tabs at Top-Center
for (const btn of document.querySelectorAll('.era-tab')) {
  btn.addEventListener('click', () => setPlayerEra(btn.dataset.player));
}

// Camera View Presets at Bottom-Right
for (const btn of document.querySelectorAll('#bottom-right [data-view]')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('#bottom-right [data-view]')) {
      b.classList.toggle('active', b === btn);
    }
    renderer.setCameraPreset(btn.dataset.view);
  });
}
for (const button of document.querySelectorAll('#ui-look-tabs .mini-tab')) {
  button.addEventListener('click', () => {
    activeLook = button.dataset.look;
    renderer.setLook(activeLook);
    applyLookTone(activeLook);
  });
}
$('hud-toggle').addEventListener('click', () => $('hud').classList.toggle('open'));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeDropdowns();
    $('info-backdrop').classList.remove('open');
  }
});

// Info Modal at Top-Left
$('more-btn').addEventListener('click', () => $('info-backdrop').classList.add('open'));
$('info-close').addEventListener('click', () => $('info-backdrop').classList.remove('open'));
$('info-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'info-backdrop') $('info-backdrop').classList.remove('open');
});

// Settings Panel Fallback Controls
$('ui-motor-btn').addEventListener('click', toggleMotor);
$('ui-cue-btn').addEventListener('click', toggleCue);

for (const b of document.querySelectorAll('#ui-speed-tabs .mini-tab')) {
  b.addEventListener('click', () => setSpeedRpm(parseFloat(b.dataset.rpm)));
}
for (const b of document.querySelectorAll('#ui-acoustics-tabs .mini-tab')) {
  b.addEventListener('click', () => {
    acousticsMode = b.dataset.acoustics;
    configureEraAcoustics();
    syncSettingsUI();
  });
}
for (const b of document.querySelectorAll('#ui-stylus-tabs .mini-tab')) {
  b.addEventListener('click', () => {
    ui.stylus = b.dataset.stylus;
    post({ t: 'set', o: { stylus: ui.stylus } });
    syncSettingsUI();
  });
}

$('s-pitch').addEventListener('input', (e) => setPitchPct(parseFloat(e.target.value)));
$('s-vol').addEventListener('input', (e) => {
  ui.volume = parseFloat(e.target.value);
  post({ t: 'set', o: { volume: ui.volume } });
  syncSettingsUI();
});
$('s-vtf').addEventListener('input', (e) => {
  ui.vtf = parseFloat(e.target.value);
  post({ t: 'set', o: { vtf: ui.vtf } });
  syncSettingsUI();
});
$('s-as').addEventListener('input', (e) => {
  ui.antiskate = parseFloat(e.target.value);
  post({ t: 'set', o: { antiskate: ui.antiskate } });
  syncSettingsUI();
});
$('s-hum').addEventListener('input', (e) => {
  ui.hum = parseFloat(e.target.value);
  post({ t: 'set', o: { hum: ui.hum } });
  syncSettingsUI();
});

for (const [id, key, fmt] of [
  ['s-noise', 'noise', (v) => `${v.toFixed(1)}×`],
  ['s-dust', 'dust', (v) => `${v.toFixed(1)}×`],
  ['s-scratch', 'scratches', (v) => `${v | 0}`],
  ['s-warp', 'warp', (v) => `${v.toFixed(1)} mm`],
  ['s-ecc', 'ecc', (v) => `${v.toFixed(2)} mm`],
]) {
  const el = $(id);
  const vEl = $('v-' + id.slice(2));
  el.addEventListener('input', () => {
    ui[key] = parseFloat(el.value);
    vEl.textContent = fmt(ui[key]);
  });
  el.addEventListener('change', repress);
}

$('repress-btn').addEventListener('click', () => {
  pressSeed++;
  repress();
  showToast('Fresh pressing');
});
$('bump-btn').addEventListener('click', async () => {
  await ensureAudio();
  post({ t: 'bump', s: 1.0 });
});
$('reset-params-btn').addEventListener('click', () => {
  ui.rpm = RPM33;
  ui.pitchPct = 0;
  renderer.pitchPct = 0;
  ui.stylus = 'elliptical';
  ui.vtf = 1.8;
  ui.antiskate = 1.8;
  ui.volume = 1.0;
  ui.hum = 0.0;
  ui.noise = 1.0;
  ui.dust = 1.0;
  ui.scratches = 0;
  ui.warp = 0.4;
  ui.ecc = 0.12;
  post({ t: 'set', o: { stylus: ui.stylus, vtf: ui.vtf, antiskate: ui.antiskate, volume: ui.volume, hum: ui.hum } });
  post({ t: 'speed', rpm: effectiveRpm() });
  syncSettingsUI();
  repress();
});

// Custom Audio File Upload & Drag-and-Drop
$('upload-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  closeDropdowns();
  showToast(`Cutting grooves from "${f.name}"…`, 4000);
  const ab = await f.arrayBuffer();
  const title = f.name.replace(/\.[^.]+$/, '');
  await decodeAndCutAudioBuffer(ab, title, '#2e6b9e', '#f5efe6');
  await startPlayback();
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  showToast(`Cutting grooves from "${f.name}"…`, 4000);
  const ab = await f.arrayBuffer();
  const title = f.name.replace(/\.[^.]+$/, '');
  await decodeAndCutAudioBuffer(ab, title, '#2e6b9e', '#f5efe6');
  await startPlayback();
});

// --- Groove Microscope Oscilloscope at Bottom-Left ---
const scopeCanvas = $('scope');
const sctx = scopeCanvas.getContext('2d');
const S_ROWS = 5, S_COLS = 160;

function drawScope() {
  const w = scopeCanvas.width, h = scopeCanvas.height;
  sctx.clearRect(0, 0, w, h);
  const scaleY = h / 460e-6;
  const cy = h * 0.5;
  const half = (S_ROWS - 1) / 2;

  for (let g = 0; g < S_ROWS; g++) {
    const cur = g === half;
    sctx.strokeStyle = cur ? 'rgba(245, 194, 107, 0.90)' : 'rgba(236, 234, 228, 0.22)';
    sctx.lineWidth = cur ? 1.35 : 0.85;
    for (let side = 0; side < 2; side++) {
      sctx.beginPath();
      let started = false;
      for (let c = 0; c < S_COLS; c++) {
        const v = wallBuf[(g * S_COLS + c) * 2 + side];
        if (v !== v) { started = false; continue; }
        const x = (c / (S_COLS - 1)) * w;
        const y = cy - v * scaleY;
        if (!started) { sctx.moveTo(x, y); started = true; }
        else sctx.lineTo(x, y);
      }
      sctx.stroke();
    }
  }

  // Diamond stylus contact points in the center groove
  const xg = wallBuf[S_ROWS * S_COLS * 2] || 0;
  const hc = wallBuf[S_ROWS * S_COLS * 2 + 1] || 1;
  const sx = w * 0.5;
  const yIn = cy - (xg - hc * 30e-6) * scaleY;
  const yOut = cy - (xg + hc * 30e-6) * scaleY;
  sctx.fillStyle = tel.loss > 0.01 ? '#ff6448' : '#5cd68d';
  sctx.beginPath();
  sctx.arc(sx, yIn, 2.4, 0, TAU);
  sctx.arc(sx, yOut, 2.4, 0, TAU);
  sctx.fill();
}

// The readout is text; ten updates a second read the same as one per frame and cost a tenth of the layout.
const HUD_INTERVAL_MILLISECONDS = 100;
let hudUpdatedAt = 0;
function updateHUD() {
  const now = performance.now();
  if (now - hudUpdatedAt < HUD_INTERVAL_MILLISECONDS) return;
  hudUpdatedAt = now;
  const rpm = tel.wp * 60 / TAU;
  $('t-rpm').textContent = `${rpm.toFixed(1)} rpm`;
  $('t-vg').textContent = `${tel.vg.toFixed(2)} m/s`;
  $('t-r').textContent = `${(tel.r * 1000).toFixed(1)} mm`;
  const errDeg = tel.err * 180 / Math.PI;
  $('t-err').textContent = `${errDeg >= 0 ? '+' : ''}${errDeg.toFixed(2)}°`;
  $('t-in').textContent = `${(tel.nIn * 100).toFixed(0)}%`;
  $('t-out').textContent = `${(tel.nOut * 100).toFixed(0)}%`;
  const lossEl = $('t-loss');
  lossEl.textContent = `${(tel.loss * 100).toFixed(2)}%`;
  lossEl.style.color = tel.loss > 0.005 ? '#ff6b52' : '';
  const zMm = (tel.zb + tel.ze) * 1000;
  $('t-z').textContent = `${zMm >= 0 ? '+' : ''}${zMm.toFixed(2)} mm`;
  const xiUm = tel.xi * 1e6;
  $('t-xi').textContent = `${xiUm >= 0 ? '+' : ''}${xiUm.toFixed(1)} µm`;
  $('t-cpu').textContent = `${((tel.cpu || 0) * 100).toFixed(0)}%`;

  // Update elapsed track time in top-right badge
  if (currentRec && tel.theta > 0) {
    const sec = Math.max(0, Math.min(currentRec.n / currentRec.spr, (tel.theta / TAU) * (60 / RPM33)));
    const tot = Math.round(currentRec.n / currentRec.spr);
    const s = Math.floor(sec);
    $('now-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${Math.floor(tot / 60)}:${String(tot % 60).padStart(2, '0')}`;
  } else {
    $('now-time').textContent = '0:00';
  }
}

// --- Main Render Loop ---
function frame() {
  if (!actx) {
    // Advance idle arm & platter physics smoothly before first audio gesture
    localEng.process(new Float32Array(128), new Float32Array(128), 128);
    tel = {
      ...localEng.telemetry(),
      cpu: 0,
      vtf: ui.vtf,
      antiskate: ui.antiskate,
      rpm: effectiveRpm(),
    };
    wallBuf = localEng.grooveView(S_ROWS, S_COLS, 400);
  }

  renderer.draw(tel);
  if (pendingHoverPoint) {
    const hadHover = !!hoveredControl;
    const pick = dragMode ? null : renderer.pickControl(pendingHoverPoint[0], pendingHoverPoint[1]);
    pendingHoverPoint = null;
    if (!dragMode) {
      hoveredControl = pick ? pick.control : null;
      canvas.classList.toggle('hover-part', !!hoveredControl);
      if (hadHover && !hoveredControl) clearHoverOverlay();
    }
  }
  if (hoveredControl) updateHoverVisuals(hoveredControl);
  drawScope();
  checkRecordEnd();
  measureSeekLanding();
  updateHUD();
  updateStatusPill();
  requestAnimationFrame(frame);
}

// --- Boot ---
buildShelfUI();
syncSettingsUI();
selectRecord(RECORDS[0], false);
requestAnimationFrame(frame);

// Deep link: ?player=gramophone-1925&look=parlour opens that machine in that light.
const requestedPlayer = new URLSearchParams(location.search).get('player');
if (PLAYERS.some((player) => player.id === requestedPlayer)) setPlayerEra(requestedPlayer);

window.addEventListener('resize', () => { hoverCardShown.width = 0; });

// Test hooks: a muted check plays every record and reads the machine's state through these.
window.vinylDebug.records = RECORDS;
window.vinylDebug.changeRecord = changeRecord;
window.vinylDebug.telemetry = () => tel;
window.vinylDebug.recordChangeRunning = () => recordChangeRunning;
window.vinylDebug.seekBySeconds = seekBySeconds;
