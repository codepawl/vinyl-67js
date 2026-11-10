// The per-pixel part of the disc sheets (colour, finish and normal map), free of the DOM so that it runs in
// workers. The page prepares the tables once; each worker then shades a band of rows.
import { TAU } from './dsp.js';
import { R_DISC, R_LEADIN, R_LOCK, R_LABEL, thetaForRadius } from './geometry.js';

// +1 when the groove angle grows the same way round as the disc mesh's own angle, -1 when it runs the other way.
const GROOVE_ANGLE_SIGN = 1;
// Real grooves lie about a tenth of a millimetre apart, finer than one pixel of the sheet. So that they still
// show from a normal viewing distance, neighbouring turns are drawn together as one line this many pixels
// wide; the lines follow the real spiral, so track gaps and loud passages sit where they are on the record.
const VISIBLE_GROOVE_PIXELS = 3;
const VISIBLE_GROOVE_SHARE = 0.6;      // part of each line taken by the groove, the rest is land
const VISIBLE_GROOVE_SLOPE = 0.62;     // how far the walls lean in the normal map
const PAPER_ROUGHNESS = 215;
const VINYL_METAL = 36;
const LOUDNESS_BINS = 512;
const TURN_SAMPLES = 8192;

// Everything the shading needs to know about one record, as plain typed arrays that can be posted to a worker.
export function buildSheetTables(rec, vis, size) {
  const radiusLow = R_LOCK - 0.002;
  const radiusHigh = R_LEADIN + 0.002;
  const loudnessByBin = new Float32Array(LOUDNESS_BINS);
  const gapByBin = new Uint8Array(LOUDNESS_BINS);
  const hasSpiral = !!(rec && rec.rTab);
  const hasLoudness = !!(hasSpiral && vis);

  if (hasLoudness) {
    for (let bin = 0; bin < LOUDNESS_BINS; bin++) {
      const radius = radiusLow + ((radiusHigh - radiusLow) * bin) / (LOUDNESS_BINS - 1);
      const turn = thetaForRadius(rec.rTab, radius) / TAU;
      const row = Math.max(0, Math.min(vis.rows - 1, Math.floor(turn)));
      let sum = 0;
      for (let column = 0; column < vis.cols; column += 4) sum += vis.data[row * vis.cols + column];
      loudnessByBin[bin] = sum / (vis.cols / 4) / 255;

      const turnsAcross = Math.abs(
        thetaForRadius(rec.rTab, radius - 0.00025) - thetaForRadius(rec.rTab, radius + 0.00025),
      ) / TAU;
      if (turnsAcross < 0.75 && radius > R_LOCK + 0.004 && radius < R_LEADIN - 0.003) gapByBin[bin] = 1;
    }
  } else {
    for (let bin = 0; bin < LOUDNESS_BINS; bin++) {
      loudnessByBin[bin] = 0.35 + 0.25 * Math.sin(bin * 0.17);
      if (bin === 170 || bin === 330) gapByBin[bin] = 1;
    }
  }

  // The real spiral: how many turns in the groove is at each radius, and how far apart the turns are there.
  const turnsByRadius = new Float32Array(TURN_SAMPLES);
  const pitchByRadius = new Float32Array(TURN_SAMPLES);
  const pixelMetres = R_DISC / (size / 2);
  let turnsPerLine = 1;
  if (hasSpiral) {
    for (let index = 0; index < TURN_SAMPLES; index++) {
      const radius = radiusLow + ((radiusHigh - radiusLow) * index) / (TURN_SAMPLES - 1);
      turnsByRadius[index] = thetaForRadius(rec.rTab, radius) / TAU;
    }
    const radiusStep = (radiusHigh - radiusLow) / (TURN_SAMPLES - 1);
    for (let index = 0; index < TURN_SAMPLES; index++) {
      const before = turnsByRadius[Math.max(0, index - 4)];
      const after = turnsByRadius[Math.min(TURN_SAMPLES - 1, index + 4)];
      const turnsPerMetre = Math.abs(after - before) / (8 * radiusStep);
      pitchByRadius[index] = turnsPerMetre > 1 ? 1 / turnsPerMetre : 0;
    }
    // How many real turns one drawn line stands for, from the usual spacing of this record's turns.
    const pitches = Array.from(pitchByRadius).filter((pitch) => pitch > 0 && pitch < 0.001).sort((a, b) => a - b);
    const usualPitch = pitches.length ? pitches[pitches.length >> 1] : 0;
    if (usualPitch > 0) turnsPerLine = Math.max(1, Math.ceil((VISIBLE_GROOVE_PIXELS * pixelMetres) / usualPitch));
  }

  return {
    size,
    radiusLow,
    radiusHigh,
    loudnessByBin,
    gapByBin,
    hasSpiral,
    turnsByRadius,
    pitchByRadius,
    turnsPerLine,
    grooveWidth: rec?.W || 56e-6,
    loudnessRows: hasLoudness ? vis.rows : 0,
    loudnessColumns: hasLoudness ? vis.cols : 0,
    loudness: hasLoudness ? vis.data : null,
  };
}

// Shades the rows firstRow..lastRow-1 of the three sheets and returns them as RGBA bands.
export function shadeSheetRows(tables, firstRow, lastRow) {
  const {
    size, radiusLow, radiusHigh, loudnessByBin, gapByBin, hasSpiral, turnsByRadius, pitchByRadius,
    turnsPerLine, grooveWidth, loudnessRows, loudnessColumns, loudness,
  } = tables;
  const half = size / 2;
  const pixelMetres = R_DISC / half;
  const rows = lastRow - firstRow;
  const color = new Uint8ClampedArray(rows * size * 4);
  const finish = new Uint8ClampedArray(rows * size * 4);
  const normal = new Uint8ClampedArray(rows * size * 4);
  for (let offset = 0; offset < finish.length; offset += 4) {
    finish[offset] = 255;
    finish[offset + 1] = PAPER_ROUGHNESS;
    finish[offset + 3] = 255;
    normal[offset] = 128;
    normal[offset + 1] = 128;
    normal[offset + 2] = 255;
    normal[offset + 3] = 255;
  }

  for (let y = firstRow; y < lastRow; y++) {
    const dy = (y + 0.5 - half) / half;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const radiusShare = Math.hypot(dx, dy);
      const radius = radiusShare * R_DISC;
      const pixel = ((y - firstRow) * size + x) * 4;
      color[pixel + 3] = 255;

      if (radius < 0.0037) {
        // Spindle hole
        color[pixel] = 10;
        color[pixel + 1] = 10;
        color[pixel + 2] = 12;
        continue;
      }
      if (radius <= R_LABEL) {
        // Overdrawn with the paper label afterwards
        color[pixel] = 30;
        color[pixel + 1] = 30;
        color[pixel + 2] = 32;
        continue;
      }
      if (radius > R_DISC) {
        color[pixel] = 8;
        color[pixel + 1] = 8;
        color[pixel + 2] = 10;
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const across = (radius - radiusLow) / (radiusHigh - radiusLow);
      const bin = Math.max(0, Math.min(LOUDNESS_BINS - 1, Math.floor(across * (LOUDNESS_BINS - 1))));

      let shade = 14; // base deep black PVC
      let roughness = 0.1;
      if (radius >= R_LOCK && radius <= R_LEADIN) {
        let grooveRing = 0.5 + 0.5 * Math.sin(radius * 26500 + angle);
        let turns = 0;
        if (hasSpiral) {
          const position = Math.max(0, Math.min(TURN_SAMPLES - 1.001, across * (TURN_SAMPLES - 1)));
          const sample = Math.floor(position);
          const blend = position - sample;
          turns = turnsByRadius[sample] + (turnsByRadius[sample + 1] - turnsByRadius[sample]) * blend;
          const pitch = pitchByRadius[sample];
          // Angle of this point on the disc, counted the way the groove angle is counted.
          const discAngle = Math.atan2(-dy, dx) * GROOVE_ANGLE_SIGN;
          let offset = (turns - discAngle / TAU) / turnsPerLine;
          offset -= Math.round(offset);
          const linePitch = pitch * turnsPerLine;
          const halfWidth = Math.max(grooveWidth / 2, linePitch * VISIBLE_GROOVE_SHARE / 2);
          const metresFromGroove = Math.abs(offset) * linePitch;
          const coverage = (halfWidth - metresFromGroove) / pixelMetres + 0.5;
          grooveRing = pitch > 0 ? Math.max(0, Math.min(1, coverage)) : 0;
          if (grooveRing > 0 && radiusShare > 0) {
            // Turns count up towards the label, so a positive offset is the wall on the label side of the
            // line; that wall faces outwards. Green points up the image, hence the minus on dy.
            const lean = Math.sign(offset) * VISIBLE_GROOVE_SLOPE * grooveRing;
            normal[pixel] = Math.round((dx / radiusShare) * lean * 127.5 + 127.5);
            normal[pixel + 1] = Math.round((-dy / radiusShare) * lean * 127.5 + 127.5);
            normal[pixel + 2] = Math.round(Math.sqrt(Math.max(0, 1 - lean * lean)) * 127.5 + 127.5);
          }
        }
        let loudnessHere = loudnessByBin[bin];
        if (loudness) {
          const row = Math.max(0, Math.min(loudnessRows - 1, Math.floor(turns)));
          const column = Math.floor(((angle < 0 ? angle + TAU : angle) / TAU) * loudnessColumns) % loudnessColumns;
          loudnessHere = loudness[row * loudnessColumns + column] / 255;
        }
        if (gapByBin[bin]) {
          // Unmodulated shiny land between tracks appears darker
          shade = 9 + grooveRing * 4;
          roughness = 0.1 + grooveRing * 0.22;
        } else {
          // Heavily modulated grooves scatter more light
          shade = hasSpiral
            ? 9 + grooveRing * (16 + loudnessHere * 46)
            : 15 + loudnessHere * 36 + grooveRing * (6 + loudnessHere * 14);
          roughness = 0.1 + grooveRing * (0.34 + loudnessHere * 0.36);
        }
      } else {
        // Lead-out / run-out mirror land with sparse spiral
        const spiral = Math.sin((radius - R_LABEL) * 1400 - angle * 2);
        shade = spiral > 0.92 ? 32 : 11;
      }

      // Outer rim bevel highlight
      if (radius > R_LEADIN) shade = 18;

      color[pixel] = shade;
      color[pixel + 1] = shade;
      color[pixel + 2] = Math.min(255, Math.round(shade * 1.05));
      finish[pixel + 1] = Math.round(roughness * 255);
      finish[pixel + 2] = VINYL_METAL;
    }
  }
  return { color, finish, normal };
}
