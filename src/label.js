// Generates the 2D canvas textures for the 67js PBR materials:
// 1. Center paper label + full vinyl disc surface map (modulated grooves, lead-in/out, track gaps, scratches, dust)
// 2. Wax cylinder surface texture for the 1877 Edison Phonograph
import { TAU, rng } from './dsp.js';
import { R_DISC, R_LEADIN, R_LOCK, R_LABEL, thetaForRadius } from './geometry.js';

const LABEL_SIZE = 1024;
const DISC_TEX_SIZE = 1024;
// +1 when the groove angle grows the same way round as the disc mesh's own angle, -1 when it runs the other way.
const GROOVE_ANGLE_SIGN = 1;
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
export function drawDiscSurfaceTexture(rec, vis, titles = [], meta = {}, targetCanvas = null, finishCanvas = null) {
  const canvas = targetCanvas || createSheet(DISC_TEX_SIZE);
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const half = size / 2;

  const labelCanvas = drawLabel(titles, meta);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const finishContext = finishCanvas ? finishCanvas.getContext('2d') : null;
  const finishImage = finishContext ? finishContext.createImageData(size, size) : null;
  const finish = finishImage ? finishImage.data : null;
  const PAPER_ROUGHNESS = 215;
  const VINYL_METAL = 36;
  if (finish) {
    for (let offset = 0; offset < finish.length; offset += 4) {
      finish[offset] = 255;
      finish[offset + 1] = PAPER_ROUGHNESS;
      finish[offset + 2] = 0;
      finish[offset + 3] = 255;
    }
  }

  // Build radial lookup table for groove pitch and average modulation per radius
  const bins = 512;
  const modByBin = new Float32Array(bins);
  const gapByBin = new Uint8Array(bins);
  const rLo = R_LOCK - 0.002;
  const rHi = R_LEADIN + 0.002;

  if (rec && vis && rec.rTab) {
    for (let b = 0; b < bins; b++) {
      const r = rLo + ((rHi - rLo) * b) / (bins - 1);
      const rev = thetaForRadius(rec.rTab, r) / TAU;
      const row = Math.max(0, Math.min(vis.rows - 1, Math.floor(rev)));
      let sum = 0;
      for (let c = 0; c < vis.cols; c += 4) {
        sum += vis.data[row * vis.cols + c];
      }
      modByBin[b] = sum / (vis.cols / 4) / 255;

      const rNext = r + 0.00025;
      const dRev = Math.abs(thetaForRadius(rec.rTab, r - 0.00025) - thetaForRadius(rec.rTab, rNext)) / TAU;
      if (dRev < 0.75 && r > R_LOCK + 0.004 && r < R_LEADIN - 0.003) {
        gapByBin[b] = 1;
      }
    }
  } else {
    for (let b = 0; b < bins; b++) {
      modByBin[b] = 0.35 + 0.25 * Math.sin(b * 0.17);
      if (b === 170 || b === 330) gapByBin[b] = 1;
    }
  }

  const scratches = rec?.scratches || [];
  const dustLevel = rec?.condition?.dust ?? 0.25;

  // The real spiral: how many turns in the groove is at each radius, and how far apart the turns are there.
  // With these the texture draws every turn of the groove where the cutter put it, so the needle is seen
  // riding the same groove the simulation plays.
  const turnSamples = 8192;
  const turnsByRadius = new Float32Array(turnSamples);
  const pitchByRadius = new Float32Array(turnSamples);
  const hasSpiral = !!(rec && rec.rTab);
  if (hasSpiral) {
    for (let index = 0; index < turnSamples; index++) {
      const radius = rLo + ((rHi - rLo) * index) / (turnSamples - 1);
      turnsByRadius[index] = thetaForRadius(rec.rTab, radius) / TAU;
    }
    const radiusStep = (rHi - rLo) / (turnSamples - 1);
    for (let index = 0; index < turnSamples; index++) {
      const before = turnsByRadius[Math.max(0, index - 4)];
      const after = turnsByRadius[Math.min(turnSamples - 1, index + 4)];
      const turnsPerMetre = Math.abs(after - before) / (8 * radiusStep);
      pitchByRadius[index] = turnsPerMetre > 1 ? 1 / turnsPerMetre : 0;
    }
  }
  const grooveWidth = rec?.W || 56e-6;
  const pixelMetres = R_DISC / half;

  for (let y = 0; y < size; y++) {
    const dy = (y + 0.5 - half) / half;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const rNorm = Math.hypot(dx, dy);
      const rMeters = rNorm * R_DISC;
      const idx = (y * size + x) * 4;

      if (rMeters < 0.0037) {
        // Spindle hole
        data[idx] = 10;
        data[idx + 1] = 10;
        data[idx + 2] = 12;
        data[idx + 3] = 255;
        continue;
      }

      if (rMeters <= R_LABEL) {
        // Will be overdrawn with the high-res labelCanvas below
        data[idx] = 30;
        data[idx + 1] = 30;
        data[idx + 2] = 32;
        data[idx + 3] = 255;
        continue;
      }

      if (rMeters > R_DISC) {
        data[idx] = 8;
        data[idx + 1] = 8;
        data[idx + 2] = 10;
        data[idx + 3] = 255;
        continue;
      }

      const phi = Math.atan2(dy, dx);
      const u = (rMeters - rLo) / (rHi - rLo);
      const bin = Math.max(0, Math.min(bins - 1, Math.floor(u * (bins - 1))));

      let shade = 14; // base deep black PVC
      let roughness = 0.1;
      if (rMeters >= R_LOCK && rMeters <= R_LEADIN) {
        const mod = modByBin[bin];
        // Fine concentric groove rings + angular modulation variation
        let grooveRing = 0.5 + 0.5 * Math.sin(rMeters * 26500 + phi);
        let turns = 0;
        if (hasSpiral) {
          const position = Math.max(0, Math.min(turnSamples - 1.001, u * (turnSamples - 1)));
          const sample = Math.floor(position);
          const blend = position - sample;
          turns = turnsByRadius[sample] + (turnsByRadius[sample + 1] - turnsByRadius[sample]) * blend;
          const pitch = pitchByRadius[sample];
          // Angle of this point on the disc, counted the way the groove angle is counted.
          const discAngle = Math.atan2(-dy, dx) * GROOVE_ANGLE_SIGN;
          let offset = turns - discAngle / TAU;
          offset -= Math.round(offset);
          const metresFromGroove = Math.abs(offset) * pitch;
          const coverage = (grooveWidth / 2 - metresFromGroove) / pixelMetres + 0.5;
          grooveRing = pitch > 0 ? Math.max(0, Math.min(1, coverage)) : 0;
        }
        let angularMod = mod;
        if (vis && rec?.rTab) {
          const rev = Math.floor(turns);
          const row = Math.max(0, Math.min(vis.rows - 1, rev));
          const col = Math.floor(((phi < 0 ? phi + TAU : phi) / TAU) * vis.cols) % vis.cols;
          angularMod = vis.data[row * vis.cols + col] / 255;
        }
        if (gapByBin[bin]) {
          // Unmodulated shiny land between tracks appears darker
          shade = 9 + grooveRing * 4;
          roughness = 0.1 + grooveRing * 0.22;
        } else {
          // Heavily modulated grooves scatter more light
          shade = hasSpiral
            ? 9 + grooveRing * (16 + angularMod * 46)
            : 15 + angularMod * 36 + grooveRing * (6 + angularMod * 14);
          roughness = 0.1 + grooveRing * (0.34 + angularMod * 0.36);
        }
      } else {
        // Lead-out / run-out mirror land with sparse spiral
        const spiral = Math.sin((rMeters - R_LABEL) * 1400 - phi * 2);
        shade = spiral > 0.92 ? 32 : 11;
      }

      // Outer rim bevel highlight
      if (rMeters > R_LEADIN) {
        shade = 18;
      }

      data[idx] = shade;
      data[idx + 1] = shade;
      data[idx + 2] = Math.min(255, Math.round(shade * 1.05));
      data[idx + 3] = 255;
      if (finish) {
        finish[idx + 1] = Math.round(roughness * 255);
        finish[idx + 2] = VINYL_METAL;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  if (finishContext) finishContext.putImageData(finishImage, 0, 0);

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

  return canvas;
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
