// Generates the 2D canvas textures for the 67js PBR materials:
// 1. Center paper label + full vinyl disc surface map (modulated grooves, lead-in/out, track gaps, scratches, dust)
// 2. Wax cylinder surface texture for the 1877 Edison Phonograph
import { TAU, rng } from './dsp.js';
import { R_DISC, R_LEADIN, R_LABEL } from './geometry.js';
import { buildSheetTables, shadeSheetRows } from './disc-sheet.js';

const LABEL_SIZE = 1024;
const DISC_TEX_SIZE = 1024;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function createSheet(size = LABEL_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function arcText(context, center, text, radius, gap) {
  const chars = [...text];
  const advances = chars.map((ch) => context.measureText(ch).width + gap);
  let theta = Math.PI / 2 + advances.reduce((a, b) => a + b, 0) / radius / 2;
  chars.forEach((ch, index) => {
    theta -= advances[index] / radius / 2;
    context.save();
    context.translate(center + radius * Math.cos(theta), center + radius * Math.sin(theta));
    context.rotate(theta - Math.PI / 2);
    context.fillText(ch, 0, 0);
    context.restore();
    theta -= advances[index] / radius / 2;
  });
}

// Draws the center record label (1024x1024) customized for the selected album and player era.
export function drawLabel(titles = [], meta = {}, targetCanvas = null) {
  const canvas = targetCanvas || createSheet(LABEL_SIZE);
  const ctx = canvas.getContext('2d');
  const C = LABEL_SIZE / 2;
  const R = rng(41);

  const bgColor = meta.labelColor || '#5e1d20';
  const inkColor = meta.inkColor || '#e8d09c';
  const albumTitle = (meta.albumTitle || titles[0] || 'STUDIO MASTER').toUpperCase();
  const artist = (meta.artist || 'SIMULATED CUT').toUpperCase();
  const year = meta.year || '1924';
  const vintage = meta.playerEra !== 'direct-drive-1979';

  ctx.save();
  ctx.clearRect(0, 0, LABEL_SIZE, LABEL_SIZE);

  // Base stock colour
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, LABEL_SIZE, LABEL_SIZE);

  // Subtle paper vignette and grain
  const radial = ctx.createRadialGradient(C, C, C * 0.18, C, C, C);
  radial.addColorStop(0, 'rgba(255,250,240,0.08)');
  radial.addColorStop(0.75, 'rgba(0,0,0,0.05)');
  radial.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, LABEL_SIZE, LABEL_SIZE);

  // Paper fibres
  for (let i = 0; i < 650; i++) {
    const px = R() * LABEL_SIZE;
    const py = R() * LABEL_SIZE;
    const len = 6 + R() * 24;
    const angle = R() * TAU;
    ctx.lineWidth = 0.6 + R() * 0.8;
    ctx.strokeStyle = R() < 0.6 ? 'rgba(255,248,230,0.04)' : 'rgba(0,0,0,0.07)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(angle) * len, py + Math.sin(angle) * len);
    ctx.stroke();
  }

  // Rim decorative rings
  ctx.strokeStyle = inkColor;
  ctx.fillStyle = inkColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(C, C, 486, 0, TAU);
  ctx.stroke();

  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(C, C, 466, 0, TAU);
  ctx.stroke();

  if (vintage) {
    // Classic Victrola / HMV ornate double inner ring & emblem
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(C, C, 428, 0, TAU);
    ctx.stroke();

    // Vintage horn emblem above spindle
    ctx.save();
    ctx.translate(C, C - 230);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-70, 20);
    ctx.quadraticCurveTo(0, 5, 85, -45);
    ctx.lineTo(85, 55);
    ctx.quadraticCurveTo(0, 15, -70, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(85, 5, 16, 50, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.font = `700 32px ${SERIF}`;
    ctx.fillText('HIS MASTER’S GROOVE', C, C - 135);
    ctx.font = `italic 22px ${SERIF}`;
    ctx.fillText(`${artist} · ${year}`, C, C - 92);
  } else {
    // Modern studio geometric prism emblem above spindle
    const w = 230;
    const h = (w * Math.sqrt(3)) / 2;
    const top = C - 320;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(C, top);
    ctx.lineTo(C + w / 2, top + h);
    ctx.lineTo(C - w / 2, top + h);
    ctx.closePath();
    ctx.stroke();

    // Ratchet gear / pawl mark inside triangle
    ctx.beginPath();
    ctx.arc(C, top + h * 0.64, 34, 0, TAU);
    ctx.stroke();

    ctx.font = `700 28px ${SANS}`;
    ctx.fillText(albumTitle.slice(0, 26), C, C - 84);
  }

  // Left and right of spindle hole
  ctx.font = `600 22px ${SANS}`;
  ctx.fillText(vintage ? 'ACOUSTIC' : 'STEREO', C - 285, C - 16);
  ctx.fillText('SIDE A', C - 285, C + 18);
  ctx.fillText(vintage ? '78 RPM' : '33⅓ RPM', C + 285, C - 16);
  ctx.fillText(`CAT. ${year}`, C + 285, C + 18);

  // Track list below spindle
  ctx.font = vintage ? `600 25px ${SERIF}` : `500 25px ${MONO}`;
  const cleanTitles = titles.filter(Boolean).slice(0, 4);
  cleanTitles.forEach((title, idx) => {
    const dy = 158 + idx * 44;
    const maxW = 2 * Math.sqrt(Math.max(100, 415 * 415 - dy * dy)) - 48;
    ctx.fillText(`${idx + 1}. ${title}`.slice(0, 38), C, C + dy, maxW);
  });

  ctx.font = `600 14px ${SANS}`;
  arcText(ctx, C, 'PHYSICAL GROOVE SIMULATION  ·  STYLUS & CANTILEVER READOUT  ·  67JS PBR', 446, 4.5);

  // Pressing ring & centre spindle wear
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(C, C, 152, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = '#080809';
  ctx.beginPath();
  ctx.arc(C, C, 26, 0, TAU);
  ctx.fill();

  ctx.restore();
  return canvas;
}

// Draws the complete 1024x1024 top-surface texture of the 12" vinyl disc:
// includes the paper center label inside r < R_LABEL and the actual modulated spiral grooves outside.
// finishCanvas, when given, receives the surface finish in glTF layout (green = roughness, blue = metal):
// the land between turns is a mirror, the groove walls scatter light, the paper label is matt.
// --- The disc sheets ---------------------------------------------------------------------------------------
// The pixels are shaded in workers, a band of rows at a time, so loading a record does not freeze the page.
const SHEET_WORKERS_AT_MOST = 6;
const SHEET_BANDS_PER_WORKER = 2;
let sheetWorkers = null;
let sheetJobCounter = 0;

function sheetWorkerPool() {
  if (sheetWorkers) return sheetWorkers;
  sheetWorkers = [];
  if (typeof Worker !== 'function') return sheetWorkers;
  const count = Math.max(1, Math.min(SHEET_WORKERS_AT_MOST, (navigator.hardwareConcurrency || 4) - 1));
  try {
    for (let index = 0; index < count; index++) {
      sheetWorkers.push(new Worker(new URL('./disc-sheet-worker.js', import.meta.url), { type: 'module' }));
    }
  } catch (error) {
    console.warn('Disc sheets are drawn on the main thread', error);
    sheetWorkers = [];
  }
  return sheetWorkers;
}

function nextFrame() {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(settle);
    // A hidden tab draws no frames; the job still has to finish.
    setTimeout(settle, 120);
  });
}

// Calls onBand for every finished band; resolves when all are in, or rejects when a worker fails.
function shadeInWorkers(tables, onBand) {
  const workers = sheetWorkerPool();
  if (!workers.length) return Promise.reject(new Error('no workers'));
  const job = ++sheetJobCounter;
  const size = tables.size;
  const bandCount = workers.length * SHEET_BANDS_PER_WORKER;
  const bandRows = Math.ceil(size / bandCount);
  return new Promise((resolve, reject) => {
    let pending = 0;
    const cleanUp = () => {
      for (const worker of workers) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      }
    };
    function onMessage(event) {
      if (event.data.job !== job) return;
      onBand(event.data);
      pending -= 1;
      if (pending === 0) {
        cleanUp();
        resolve();
      }
    }
    function onError(event) {
      cleanUp();
      reject(event.error || new Error(event.message || 'disc sheet worker failed'));
    }
    for (const worker of workers) {
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ tables });
    }
    for (let band = 0; band < bandCount; band++) {
      const firstRow = band * bandRows;
      const lastRow = Math.min(size, firstRow + bandRows);
      if (firstRow >= lastRow) continue;
      pending += 1;
      workers[band % workers.length].postMessage({ job, firstRow, lastRow });
    }
  });
}

// Draws the colour, finish and normal sheets of a record into the three canvases. isCurrent is asked along
// the way; when a newer record has been requested the job stops and the promise resolves to false.
export async function drawDiscSurfaceSheets(rec, vis, titles, meta, canvases, isCurrent = () => true) {
  const { color: canvas, finish: finishCanvas, normal: normalCanvas } = canvases;
  const size = canvas.width;
  const half = size / 2;
  const contexts = {
    color: canvas.getContext('2d'),
    finish: finishCanvas ? finishCanvas.getContext('2d') : null,
    normal: normalCanvas ? normalCanvas.getContext('2d') : null,
  };
  const tables = buildSheetTables(rec, vis, size);

  const bands = [];
  try {
    await shadeInWorkers(tables, (band) => bands.push(band));
  } catch (error) {
    // No workers here: shade on the page, a slice at a time so it can still draw frames in between.
    bands.length = 0;
    const sliceRows = 128;
    for (let firstRow = 0; firstRow < size; firstRow += sliceRows) {
      const lastRow = Math.min(size, firstRow + sliceRows);
      bands.push({ firstRow, lastRow, ...shadeSheetRows(tables, firstRow, lastRow) });
      if ((firstRow / sliceRows) % 4 === 3) await nextFrame();
      if (!isCurrent()) return false;
    }
  }
  if (!isCurrent()) return false;

  // Copying the bands into the canvases is spread over a few frames.
  let copied = 0;
  for (const band of bands) {
    const rows = band.lastRow - band.firstRow;
    for (const sheet of ['color', 'finish', 'normal']) {
      if (contexts[sheet]) contexts[sheet].putImageData(new ImageData(band[sheet], size, rows), 0, band.firstRow);
    }
    copied += 1;
    if (copied % 3 === 0) {
      await nextFrame();
      if (!isCurrent()) return false;
    }
  }

  const ctx = contexts.color;
  const scratches = rec?.scratches || [];
  const dustLevel = rec?.condition?.dust ?? 0.25;

  // Draw physical scratches across the groove surface
  if (scratches.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(215, 208, 195, 0.42)';
    ctx.lineWidth = 1.25 * size / 2048;
    for (const s of scratches.slice(0, 12)) {
      const r0 = (s.r0 / R_DISC) * half;
      const r1 = (s.r1 / R_DISC) * half;
      ctx.beginPath();
      ctx.moveTo(half + r0 * Math.cos(s.phi0), half + r0 * Math.sin(s.phi0));
      ctx.lineTo(half + r1 * Math.cos(s.phi1), half + r1 * Math.sin(s.phi1));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw dust specks if dust > 0
  if (dustLevel > 0.05) {
    const Rdust = rng(99);
    const count = Math.min(450, Math.round(dustLevel * 180));
    ctx.fillStyle = 'rgba(235, 228, 210, 0.38)';
    for (let i = 0; i < count; i++) {
      const r = (R_LABEL + 0.005 + Rdust() * (R_LEADIN - R_LABEL - 0.008)) / R_DISC * half;
      const a = Rdust() * TAU;
      ctx.fillRect(half + r * Math.cos(a), half + r * Math.sin(a), 1.3 * size / 2048, 1.3 * size / 2048);
    }
  }

  // Composite crisp paper center label in the middle
  const labelCanvas = drawLabel(titles, meta);
  const labelRadiusPx = (R_LABEL / R_DISC) * half;
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, labelRadiusPx, 0, TAU);
  ctx.clip();
  ctx.drawImage(
    labelCanvas,
    half - labelRadiusPx,
    half - labelRadiusPx,
    labelRadiusPx * 2,
    labelRadiusPx * 2
  );
  ctx.restore();
  return true;
}

// Draws the 512x512 texture for the 1877 Edison Phonograph wax cylinder
export function drawCylinderTexture(meta = {}, targetCanvas = null) {
  const size = 512;
  const canvas = targetCanvas || createSheet(size);
  const ctx = canvas.getContext('2d');
  const bg = meta.labelColor || '#4a2511';
  const ink = meta.inkColor || '#f2d59b';
  const title = (meta.albumTitle || 'EDISON RECORD').toUpperCase();

  ctx.fillStyle = '#24150c';
  ctx.fillRect(0, 0, size, size);

  // Fine helical grooves along the cylinder length (U wraps around circumference, V along length)
  for (let y = 0; y < size; y += 2) {
    const mod = 0.5 + 0.5 * Math.sin(y * 0.23) * Math.cos(y * 0.07);
    ctx.fillStyle = y % 4 === 0 ? `rgba(255,215,160,${0.05 + mod * 0.08})` : 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y, size, 1);
  }

  // Molded end-rim band with title
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, 58);
  ctx.fillRect(0, size - 44, size, 44);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 58);
  ctx.lineTo(size, 58);
  ctx.moveTo(0, size - 44);
  ctx.lineTo(size, size - 44);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = `700 22px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`EDISON GOLD MOULDED · ${title.slice(0, 22)}`, size / 2, 29);

  return canvas;
}
