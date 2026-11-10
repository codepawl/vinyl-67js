// 67js renderer for the three record players: sourced GLB models split into moving parts, a studio stage,
// the camera, picking and the hover outline.
//
// Frames: the app's physics frame is metres with +Z up and the record plane at z = 0. 67js is +Y up, so a
// physics point (x, y, z) is the 67js point (x, z, -y). The GLB files are exported in that same frame.

import { Renderer67 } from '../67js/67.module.js';
import { createEnvironmentMap } from '../67js/hdri.js';
import { loadGltf } from '../67js/gltf.js';
import '../67js/material-layer-shaders.js';
import '../67js/texture-update.js';
import { updatePartVertices } from '../67js/update-part-vertices.js';
import '../67js/render-passes.js';
import '../67js/camera-effects.js';

import { TAU } from './dsp.js';
import { R_DISC, R_PROGRAM, R_PROGRAM_MIN, ALPHA_REST, stylusXY } from './geometry.js';
import { drawDiscSurfaceTexture } from './label.js';
import { physTo67, mat4Identity, transformPointMat4, buildDiscPart, applyDiscWarpToPart, buildCablePart, MATERIALS } from './meshes67.js';

const PHONOGRAPH = 'phonograph-1877';
const GRAMOPHONE = 'gramophone-1925';
const DIRECT_DRIVE = 'direct-drive-1979';

// ---------------------------------------------------------------------------------------------------------
// Interactive parts. `groups` are mesh object names in the player's GLB.
// ---------------------------------------------------------------------------------------------------------
export const INTERACTIVE_CONTROLS = [
  {
    id: 'ph-crank',
    turns: true,
    player: PHONOGRAPH,
    groups: ['ph_shaft'],
    title: 'Hand crank and feed screw',
    howTo: 'Click to start or stop cranking. Drag up or down to turn it by hand.',
  },
  {
    id: 'ph-cylinder',
    turns: true,
    player: PHONOGRAPH,
    groups: ['ph_drum'],
    title: 'Tinfoil drum',
    howTo: 'Click a spot on the drum to set the needle there. Drag to spin it.',
  },
  {
    id: 'ph-lift',
    player: PHONOGRAPH,
    groups: ['ph_support'],
    title: 'Needle carrier',
    howTo: 'Click to press the needle into the foil or lift it clear.',
  },
  {
    id: 'ph-horn',
    player: PHONOGRAPH,
    groups: ['ph_horn'],
    title: 'Mouthpiece and funnel',
    howTo: 'Click to switch between the thin sound of the funnel and a clean signal.',
  },
  {
    id: 'ph-spare',
    player: PHONOGRAPH,
    groups: ['ph_body'],
    title: 'Base (next recording)',
    howTo: 'Click the base to wrap a fresh foil with the next recording.',
  },

  {
    id: 'gr-crank',
    turns: true,
    player: GRAMOPHONE,
    groups: ['gr_crank'],
    title: 'Winding crank',
    howTo: 'Click to release or stop the spring motor. Drag to wind by hand.',
  },
  {
    id: 'gr-tonearm',
    player: GRAMOPHONE,
    groups: ['gr_arm'],
    title: 'Tonearm and sound box',
    howTo: 'Drag the sound box onto the record. Click to lower or lift the needle.',
  },
  {
    id: 'gr-disc',
    turns: true,
    player: GRAMOPHONE,
    groups: ['disc', 'gr_platter'],
    title: 'Record and felt turntable',
    howTo: 'Click a groove to play from there. Drag to spin. Click the label for the next record.',
  },
  {
    id: 'gr-speed',
    player: GRAMOPHONE,
    groups: ['gr_speed'],
    title: 'Speed regulator',
    howTo: 'Click to step through 33, 45 and 78 rpm.',
  },
  {
    id: 'gr-horn',
    player: GRAMOPHONE,
    groups: ['gr_horn'],
    title: 'Brass horn',
    howTo: 'Click to switch between the horn’s own sound and a clean signal.',
  },

  {
    id: 'dd-start',
    player: DIRECT_DRIVE,
    groups: ['dd_start'],
    title: 'Start / stop',
    howTo: 'Click to start or stop the platter.',
  },
  {
    id: 'dd-strobe',
    turns: true,
    player: DIRECT_DRIVE,
    groups: ['dd_strobe'],
    title: 'Power dial and strobe',
    howTo: 'Click to start or stop the motor. The strobe lights the dots on the platter rim.',
  },
  {
    id: 'dd-btn33',
    player: DIRECT_DRIVE,
    groups: ['dd_btn33'],
    title: '33⅓ rpm',
    howTo: 'Click for LP speed.',
  },
  {
    id: 'dd-btn45',
    player: DIRECT_DRIVE,
    groups: ['dd_btn45'],
    title: '45 rpm',
    howTo: 'Click for singles speed.',
  },
  {
    id: 'dd-puck',
    player: DIRECT_DRIVE,
    groups: ['dd_puck'],
    title: '45 adapter (next record)',
    howTo: 'Click to put on the next record.',
  },
  {
    id: 'dd-pitch',
    player: DIRECT_DRIVE,
    groups: ['dd_pitch'],
    title: 'Pitch fader',
    howTo: 'Drag up or down for ±8 %. Double-click to return to quartz lock.',
  },
  {
    id: 'dd-cue',
    player: DIRECT_DRIVE,
    groups: ['dd_cue'],
    title: 'Cue lever',
    howTo: 'Click to lower the stylus into the groove or lift it.',
  },
  {
    id: 'dd-antiskate',
    player: DIRECT_DRIVE,
    groups: ['dd_antiskate'],
    title: 'Anti-skate dial',
    howTo: 'Drag up or down to set the sideways force on the arm.',
  },
  {
    id: 'dd-counterweight',
    player: DIRECT_DRIVE,
    groups: ['dd_counterweight'],
    title: 'Counterweight',
    howTo: 'Drag up or down to set the tracking force, 0.5 to 3.5 g.',
  },
  {
    id: 'dd-headshell',
    player: DIRECT_DRIVE,
    groups: ['dd_arm'],
    title: 'Tonearm and cartridge',
    howTo: 'Drag the headshell onto the record. Click to lower or lift the stylus.',
  },
  {
    id: 'dd-disc',
    turns: true,
    player: DIRECT_DRIVE,
    groups: ['disc', 'dd_platter'],
    title: 'Record and platter',
    howTo: 'Click a groove to play from there. Drag to scratch. Click the label for the next record.',
  },
];

// ---------------------------------------------------------------------------------------------------------
// Player definitions: where the model's moving parts pivot. Positions are in the physics frame, measured
// from the source models after tools/prep_player.py.
// ---------------------------------------------------------------------------------------------------------
const PLAYER_DEFS = {
  [PHONOGRAPH]: {
    url: 'assets/models/phonograph-1877.glb',
    floorZ: 0,
    hasDisc: false,
    drum: { axisY: 0.006, axisZ: 0.0898, travelStart: 0.006, travelEnd: -0.07, low: -0.0126, high: 0.0789 },
    view: { azimuth: -0.62, elevation: 0.36, fov: 30 },
  },
  [GRAMOPHONE]: {
    url: 'assets/models/gramophone-1925.glb',
    floorZ: -0.1676,
    hasDisc: true,
    arm: { pivot: [0.2212, 0.0005], stylus: [0.0525, -0.0291], tipZ: 0.0004, parkedRadius: 0.186, groups: ['gr_arm'] },
    spin: ['gr_platter'],
    crank: { group: 'gr_crank' },
    view: { azimuth: -0.5, elevation: 0.3, fov: 30 },
  },
  [DIRECT_DRIVE]: {
    url: 'assets/models/direct-drive-1979.glb',
    floorZ: -0.1076,
    hasDisc: true,
    arm: {
      pivot: [0.1962, 0.0866],
      stylus: [0.1513, -0.1393],
      tipZ: 0.0043,
      parkedRadius: null,
      groups: ['dd_arm', 'dd_counterweight'],
    },
    spin: ['dd_platter'],
    view: { azimuth: -0.42, elevation: 0.62, fov: 28 },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Looks: the room the machine sits in. Softboxes are rectangles on the environment sphere.
// ---------------------------------------------------------------------------------------------------------
export const LOOKS = {
  studio: {
    label: 'Dark studio',
    room: [0.012, 0.013, 0.016],
    floor: { color: [0.055, 0.056, 0.06], roughness: 0.78, metallic: 0.0 },
    softboxes: [
      { direction: [-0.45, 0.82, 0.36], width: 0.62, height: 0.44, color: [8, 7.7, 7.3] },
      { direction: [0.72, 0.4, -0.56], width: 0.16, height: 0.62, color: [4.5, 5.2, 6.8] },
      { direction: [0.2, 0.3, 0.93], width: 0.5, height: 0.18, color: [0.8, 0.8, 0.9] },
    ],
    // A low key from the back left, so the machine throws its shadow toward the camera side.
    lightDirection: [-4.5, 3.2, -1.0],
    keyColor: [1.0, 0.97, 0.93],
    keyIntensity: 6,
    fillIntensity: 0.05,
    ambientIntensity: 0.25,
    exposure: 0.7,
    effects: { vignette: 0.42, contrast: 1.08, saturation: 1.0, bloom: { strength: 0.2, threshold: 1.1, radius: 0.6 } },
    page: '#07080a',
  },
  parlour: {
    label: 'Lamp-lit room',
    room: [0.05, 0.03, 0.018],
    floor: { color: [0.11, 0.05, 0.024], roughness: 0.7, metallic: 0.0 },
    softboxes: [
      { direction: [-0.6, 0.62, 0.5], width: 0.5, height: 0.42, color: [17, 11.5, 6.2] },
      { direction: [0.78, 0.3, -0.5], width: 0.2, height: 0.5, color: [2.4, 2.2, 2.4] },
      { direction: [0.3, 0.2, 0.93], width: 0.6, height: 0.3, color: [1.6, 1.1, 0.7] },
    ],
    lightDirection: [-3.6, 2.6, 1.8],
    keyColor: [1.0, 0.8, 0.55],
    keyIntensity: 5,
    fillIntensity: 0.06,
    ambientIntensity: 0.45,
    exposure: 0.92,
    effects: { vignette: 0.48, contrast: 1.06, saturation: 1.06, temperature: 0.12, bloom: { strength: 0.22, threshold: 1.1, radius: 0.6 } },
    page: '#0d0806',
  },
  daylight: {
    label: 'Daylight sweep',
    room: [0.62, 0.63, 0.66],
    floor: { color: [0.62, 0.62, 0.63], roughness: 0.62, metallic: 0.0 },
    softboxes: [
      { direction: [-0.4, 0.85, 0.34], width: 0.9, height: 0.7, color: [7.5, 7.5, 7.7] },
      { direction: [0.8, 0.35, -0.48], width: 0.3, height: 0.6, color: [3.0, 3.1, 3.4] },
    ],
    lightDirection: [-3.4, 4.6, -1.4],
    keyColor: [1.0, 0.98, 0.95],
    keyIntensity: 3.2,
    fillIntensity: 0.2,
    ambientIntensity: 0.5,
    exposure: 0.72,
    effects: { vignette: 0.16, contrast: 1.04, saturation: 0.98, bloom: { strength: 0.08, threshold: 1.3, radius: 0.5 } },
    page: '#b9bcc2',
    tone: 'light',
  },
};

export const CAMERA_PRESETS = {
  overview: { label: 'Overview' },
  stylus: { label: 'Needle' },
  profile: { label: 'Side' },
  top: { label: 'Top' },
};

// ---------------------------------------------------------------------------------------------------------
// Matrix helpers (column-major, 67js space)
// ---------------------------------------------------------------------------------------------------------
function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

// Rotation by `angle` about the line through `point` along the unit `axis`, then a translation.
function rotationAbout(axis, angle, point, translation = [0, 0, 0]) {
  const [x, y, z] = axis;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rest = 1 - cosine;
  const matrix = new Float32Array(16);
  matrix[0] = cosine + x * x * rest;
  matrix[1] = y * x * rest + z * sine;
  matrix[2] = z * x * rest - y * sine;
  matrix[4] = x * y * rest - z * sine;
  matrix[5] = cosine + y * y * rest;
  matrix[6] = z * y * rest + x * sine;
  matrix[8] = x * z * rest + y * sine;
  matrix[9] = y * z * rest - x * sine;
  matrix[10] = cosine + z * z * rest;
  matrix[15] = 1;
  const [px, py, pz] = point;
  matrix[12] = px - (matrix[0] * px + matrix[4] * py + matrix[8] * pz) + translation[0];
  matrix[13] = py - (matrix[1] * px + matrix[5] * py + matrix[9] * pz) + translation[1];
  matrix[14] = pz - (matrix[2] * px + matrix[6] * py + matrix[10] * pz) + translation[2];
  return matrix;
}

function translation67(offset) {
  const matrix = mat4Identity();
  matrix[12] = offset[0];
  matrix[13] = offset[1];
  matrix[14] = offset[2];
  return matrix;
}

const AXIS_UP = [0, 1, 0];          // physics +Z
const AXIS_RIGHT = [1, 0, 0];       // physics +X
const AXIS_BACK = [0, 0, -1];       // physics +Y

function groupOfPartName(name) {
  return name.replace(/_\d+$/, '');
}

function wrapAngle(angle) {
  let wrapped = angle % TAU;
  if (wrapped > Math.PI) wrapped -= TAU;
  if (wrapped < -Math.PI) wrapped += TAU;
  return wrapped;
}

// ---------------------------------------------------------------------------------------------------------
// Environment: a dark room with rectangular softboxes, as an equirectangular HDR image.
// ---------------------------------------------------------------------------------------------------------
function buildRoomEnvironment(look) {
  const width = 512;
  const height = 256;
  const data = new Float32Array(width * height * 3);
  const boxes = look.softboxes.map((box) => {
    const forward = normalize3(box.direction);
    const side = normalize3([forward[2], 0, -forward[0]]);
    const up = [
      forward[1] * side[2] - forward[2] * side[1],
      forward[2] * side[0] - forward[0] * side[2],
      forward[0] * side[1] - forward[1] * side[0],
    ];
    return { ...box, forward, side, up };
  });
  for (let row = 0; row < height; row++) {
    const polar = ((row + 0.5) / height) * Math.PI;
    const sinPolar = Math.sin(polar);
    const cosPolar = Math.cos(polar);
    for (let column = 0; column < width; column++) {
      const azimuth = ((column + 0.5) / width - 0.5) * TAU;
      const direction = [sinPolar * Math.sin(azimuth), cosPolar, -sinPolar * Math.cos(azimuth)];
      const horizon = Math.max(0, direction[1]);
      let red = look.room[0] * (0.55 + 0.9 * horizon);
      let green = look.room[1] * (0.55 + 0.9 * horizon);
      let blue = look.room[2] * (0.55 + 0.9 * horizon);
      for (const box of boxes) {
        const facing = direction[0] * box.forward[0] + direction[1] * box.forward[1] + direction[2] * box.forward[2];
        if (facing <= 0.05) continue;
        const across = (direction[0] * box.side[0] + direction[1] * box.side[1] + direction[2] * box.side[2]) / facing;
        const along = (direction[0] * box.up[0] + direction[1] * box.up[1] + direction[2] * box.up[2]) / facing;
        const edgeAcross = Math.min(1, Math.max(0, (box.width - Math.abs(across)) / 0.035));
        const edgeAlong = Math.min(1, Math.max(0, (box.height - Math.abs(along)) / 0.035));
        const cover = edgeAcross * edgeAlong;
        if (cover <= 0) continue;
        const falloff = 0.82 + 0.18 * (1 - Math.min(1, Math.hypot(across / box.width, along / box.height)));
        red += box.color[0] * cover * falloff;
        green += box.color[1] * cover * falloff;
        blue += box.color[2] * cover * falloff;
      }
      const index = (row * width + column) * 3;
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
    }
  }
  return createEnvironmentMap({ width, height, data, intensity: 1, showBackground: true, backgroundBlur: 0.55 });
}

function buildFloorPart(look, floorY) {
  // A photo sweep: flat under the machine, then curving up into a wall all round, so no horizon line shows.
  const segments = 96;
  const flatRadius = 1.5;
  const curveRadius = 1.3;
  const wallHeight = 5;
  const profile = [];
  for (let step = 0; step <= 12; step++) {
    profile.push({ radius: flatRadius * (step / 12) ** 1.6, height: 0, normal: [0, 1] });
  }
  for (let step = 1; step <= 16; step++) {
    const turn = (step / 16) * (Math.PI / 2);
    profile.push({
      radius: flatRadius + curveRadius * Math.sin(turn),
      height: curveRadius * (1 - Math.cos(turn)),
      normal: [-Math.sin(turn), Math.cos(turn)],
    });
  }
  profile.push({ radius: flatRadius + curveRadius, height: wallHeight, normal: [-1, 0] });
  const rings = profile.length - 1;
  const positions = [];
  const normals = [];
  const indices = [];
  for (const point of profile) {
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * TAU;
      positions.push(point.radius * Math.cos(angle), floorY + point.height, point.radius * Math.sin(angle));
      normals.push(point.normal[0] * Math.cos(angle), point.normal[1], point.normal[0] * Math.sin(angle));
    }
  }
  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const first = ring * stride + segment;
      indices.push(first, first + stride + 1, first + stride, first, first + 1, first + stride + 1);
    }
  }
  return {
    name: 'stage_floor',
    geometry: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
    },
    material: { emission: 0, ...look.floor },
    matrix: mat4Identity(),
    castShadow: false,
    visible: true,
  };
}

// The key light's shadow camera: looks at the machine from the light, wide enough for its shadow on the floor.
function shadowBoundsFor(lightDirection, centre, radius) {
  const toLight = normalize3(lightDirection);
  const distance = radius * 6;
  return {
    eye: [centre[0] + toLight[0] * distance, centre[1] + toLight[1] * distance, centre[2] + toLight[2] * distance],
    target: [...centre],
    up: [0, 0, -1],
    extent: radius * 1.9,
    near: 0.01,
    far: distance * 2,
  };
}

function localBoundsOf(positions) {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index + axis];
      if (value < bounds[axis]) bounds[axis] = value;
      if (value > bounds[axis + 3]) bounds[axis + 3] = value;
    }
  }
  return bounds;
}

// ---------------------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------------------
// Groups that look the same at every angle of their spin, so their outline survives a turn.
const SPIN_SYMMETRIC_GROUPS = new Set(['disc', 'dd_platter', 'gr_platter', 'ph_drum']);
// Longest side of the hover mask in pixels; a larger part is drawn smaller and scaled up.
const HOVER_MASK_MAX_SIDE = 1024;

// A tonearm riding the groove shivers by hundredths of a millimetre every frame. Moves this small shift
// the outline by less than a pixel, so they do not count as a change.
const HOVER_SIGNATURE_TOLERANCE = 1e-4;

function sameNumbers(first, second) {
  if (!first || !second || first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) {
    if (Math.abs(first[index] - second[index]) > HOVER_SIGNATURE_TOLERANCE) return false;
  }
  return true;
}

// Marks every pixel a triangle touches. Each row takes the span between the triangle's edges at the row
// centre; the centre is clamped into the triangle so slivers thinner than a pixel still leave a mark.
function fillTriangleCoverage(coverage, width, height, x0, y0, x1, y1, x2, y2) {
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  const firstRow = Math.max(0, Math.floor(minY));
  const lastRow = Math.min(height - 1, Math.floor(maxY));
  for (let row = firstRow; row <= lastRow; row++) {
    let sampleY = row + 0.5;
    if (sampleY < minY) sampleY = minY;
    else if (sampleY > maxY) sampleY = maxY;
    let spanLeft = Infinity;
    let spanRight = -Infinity;
    if ((sampleY >= y0 && sampleY <= y1) || (sampleY >= y1 && sampleY <= y0)) {
      if (y0 === y1) {
        spanLeft = Math.min(spanLeft, x0, x1);
        spanRight = Math.max(spanRight, x0, x1);
      } else {
        const crossing = x0 + ((sampleY - y0) * (x1 - x0)) / (y1 - y0);
        if (crossing < spanLeft) spanLeft = crossing;
        if (crossing > spanRight) spanRight = crossing;
      }
    }
    if ((sampleY >= y1 && sampleY <= y2) || (sampleY >= y2 && sampleY <= y1)) {
      if (y1 === y2) {
        spanLeft = Math.min(spanLeft, x1, x2);
        spanRight = Math.max(spanRight, x1, x2);
      } else {
        const crossing = x1 + ((sampleY - y1) * (x2 - x1)) / (y2 - y1);
        if (crossing < spanLeft) spanLeft = crossing;
        if (crossing > spanRight) spanRight = crossing;
      }
    }
    if ((sampleY >= y2 && sampleY <= y0) || (sampleY >= y0 && sampleY <= y2)) {
      if (y2 === y0) {
        spanLeft = Math.min(spanLeft, x2, x0);
        spanRight = Math.max(spanRight, x2, x0);
      } else {
        const crossing = x2 + ((sampleY - y2) * (x0 - x2)) / (y0 - y2);
        if (crossing < spanLeft) spanLeft = crossing;
        if (crossing > spanRight) spanRight = crossing;
      }
    }
    const start = Math.max(0, Math.floor(spanLeft));
    const end = Math.min(width, Math.floor(spanRight) + 1);
    if (end <= start) continue;
    const rowOffset = row * width;
    if (end - start < 12) {
      for (let column = start; column < end; column++) coverage[rowOffset + column] = 255;
    } else {
      coverage.fill(255, rowOffset + start, rowOffset + end);
    }
  }
}

// Pixels drawn per CSS pixel. A plain monitor gets a quarter more than it shows, which with 4x MSAA is
// enough to keep thin chrome edges clean; 67js's default of 1.5 drew 44 % more pixels for the same picture.
function renderPixelRatio() {
  return Math.min(2, Math.max(1.25, window.devicePixelRatio || 1));
}

// How far a record is lifted off the spindle and how far it is carried aside when it is changed, metres.
const DISC_SWAP_RISE = 0.045;
const DISC_SWAP_TRAVEL = 1.1;

function smoothStep(amount) {
  return amount * amount * (3 - 2 * amount);
}

const MAINS_CABLE_RADIUS = 0.0032;
// Camera distance in metres under which the background starts to fall out of focus.
const CLOSE_UP_DISTANCE = 0.5;

export class TurntableRenderer67 {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.lookName = LOOKS[options.look] ? options.look : 'studio';
    this.onLoadingChange = options.onLoadingChange || (() => {});

    this.discCanvas = document.createElement('canvas');
    // 4096 px puts a pixel every 73 micrometres, about one groove wide; phones keep the lighter sheet.
    const discTextureSize = Math.min(window.innerWidth, window.innerHeight) < 700 ? 2048 : 4096;
    this.discCanvas.width = discTextureSize;
    this.discCanvas.height = discTextureSize;
    this.discTextureDesc = { image: this.discCanvas, colorSpace: 'srgb', wrapS: 33071, wrapT: 33071 };
    this.discFinishCanvas = document.createElement('canvas');
    this.discFinishCanvas.width = discTextureSize;
    this.discFinishCanvas.height = discTextureSize;
    this.discFinishDesc = { image: this.discFinishCanvas, colorSpace: 'linear', wrapS: 33071, wrapT: 33071 };
    this.lastRecordArgs = null;

    this.controlById = new Map(INTERACTIVE_CONTROLS.map((control) => [control.id, control]));
    this.assets = new Map();          // player id -> Promise of the decoded GLB
    this.stage = null;                // what is on screen now: { player, parts, groups, renderer, ... }
    this.loadToken = 0;

    this.activePlayer = DIRECT_DRIVE;
    this.activePreset = 'overview';
    this.lastState = {};
    this.pitchPct = 0;
    this.lastStylus67 = [0.12, 0.01, 0.05];
    this.camBasis = null;
    this.cam = {
      az: -0.4, el: 0.6, dist: 0.9, target: [0, 0, 0], fov: 28,
      azGoal: -0.4, elGoal: 0.6, distGoal: 0.9, targetGoal: [0, 0, 0], fovGoal: 28,
    };
    this.environments = new Map();
    this.setPlayer(this.activePlayer);
  }

  // --- Loading -------------------------------------------------------------------------------------------
  loadAsset(playerId) {
    if (!this.assets.has(playerId)) {
      const definition = PLAYER_DEFS[playerId];
      this.assets.set(playerId, loadGltf(definition.url, { maxTexturePixels: 96 * 1024 * 1024 }));
    }
    return this.assets.get(playerId);
  }

  environmentFor(lookName) {
    if (!this.environments.has(lookName)) {
      this.environments.set(lookName, buildRoomEnvironment(LOOKS[lookName]));
    }
    return this.environments.get(lookName);
  }

  setLook(lookName) {
    if (!LOOKS[lookName] || lookName === this.lookName) return;
    this.lookName = lookName;
    this.setPlayer(this.activePlayer, true);
  }

  setPlayer(playerId, keepCamera = false) {
    this.activePlayer = playerId;
    const token = ++this.loadToken;
    this.onLoadingChange(true);
    this.loadAsset(playerId).then((asset) => {
      if (token !== this.loadToken) return;
      this.buildStage(playerId, asset);
      if (!keepCamera) this.setCameraPreset('overview', true);
      if (this.lastRecordArgs) this.setRecord(...this.lastRecordArgs);
      this.onLoadingChange(false);
      // Warm the other machines so switching eras is instant.
      for (const otherId of Object.keys(PLAYER_DEFS)) this.loadAsset(otherId).catch(() => {});
    }).catch((error) => {
      console.error('Could not load the player model', error);
      this.onLoadingChange(false, error);
    });
  }

  buildStage(playerId, asset) {
    if (this.stage) {
      this.stage.renderer.dispose();
      this.stage = null;
    }
    const definition = PLAYER_DEFS[playerId];
    const look = LOOKS[this.lookName];
    const groups = new Map();
    const machineParts = [];
    for (const part of asset.parts) {
      const groupName = groupOfPartName(part.name);
      part.matrix = mat4Identity();
      part.localBounds = part.localBounds || localBoundsOf(part.geometry.positions);
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(part);
      machineParts.push(part);
    }

    let discPart = null;
    if (definition.hasDisc) {
      discPart = buildDiscPart('disc', this.discTextureDesc, this.discFinishDesc);
      discPart.localBounds = localBoundsOf(discPart.geometry.positions);
      groups.set('disc', [discPart]);
      machineParts.push(discPart);
    }

    const floorPart = buildFloorPart(look, definition.floorZ);
    const parts = [...machineParts, floorPart];
    // Only the 1979 deck runs on mains: the phonograph is cranked by hand and the gramophone by a spring.
    if (playerId === DIRECT_DRIVE) {
      const floor = definition.floorZ + MAINS_CABLE_RADIUS;
      const cablePart = buildCablePart('dd_mains_cable', [
        [-0.105, 0.168, -0.062],
        [-0.105, 0.2, -0.064],
        [-0.108, 0.235, floor + 0.012],
        [-0.125, 0.275, floor],
        [-0.19, 0.33, floor],
        [-0.3, 0.36, floor],
        [-0.42, 0.345, floor],
        [-0.56, 0.37, floor],
        [-0.75, 0.46, floor],
        [-1.0, 0.62, floor],
        [-1.5, 0.9, floor],
      ], MAINS_CABLE_RADIUS, MATERIALS.rubberMat);
      cablePart.matrix = mat4Identity();
      parts.push(cablePart);
    }

    // Machine bounds in 67js space, for framing and shadows.
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const part of machineParts) {
      for (let axis = 0; axis < 3; axis++) {
        bounds[axis] = Math.min(bounds[axis], part.localBounds[axis]);
        bounds[axis + 3] = Math.max(bounds[axis + 3], part.localBounds[axis + 3]);
      }
    }
    const centre = [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2];
    const radius = Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) / 2;

    const environment = {
      map: this.environmentFor(this.lookName),
      lightDirection: look.lightDirection,
      keyColor: look.keyColor,
      keyIntensity: look.keyIntensity,
      fillIntensity: look.fillIntensity,
      ambientIntensity: look.ambientIntensity,
      sunAngularRadius: 0.045,
    };
    const renderer = new Renderer67(this.canvas, parts, {
      hdr: true,
      depth: true,
      samples: 4,
      pixelRatio: renderPixelRatio(),
      ground: false,
      memoryBudgetMiB: 768,
      shadowBounds: shadowBoundsFor(look.lightDirection, centre, radius),
      environment,
    });

    const controlByPart = new Map();
    for (const control of INTERACTIVE_CONTROLS) {
      if (control.player !== playerId) continue;
      for (const groupName of control.groups) {
        for (const part of groups.get(groupName) || []) controlByPart.set(part, control);
      }
    }

    const stage = { player: playerId, definition, look, parts, machineParts, groups, discPart, renderer, environment, controlByPart, centre, radius, bounds };
    this.prepareMotion(stage);
    this.stage = stage;
    this.updateTransforms(this.lastState || {});
    document.documentElement.style.setProperty('--page', look.page);
  }

  // Measure the pivots that are easier to read from the mesh than to type in.
  prepareMotion(stage) {
    const { definition, groups } = stage;
    if (definition.arm) {
      const arm = definition.arm;
      const pivotDistance = Math.hypot(arm.pivot[0], arm.pivot[1]);
      const length = Math.hypot(arm.stylus[0] - arm.pivot[0], arm.stylus[1] - arm.pivot[1]);
      const towardSpindle = Math.atan2(-arm.pivot[1], -arm.pivot[0]);
      const modelAngle = Math.atan2(arm.stylus[1] - arm.pivot[1], arm.stylus[0] - arm.pivot[0]);
      const side = Math.sign(wrapAngle(modelAngle - towardSpindle)) || 1;
      const angleForRadius = (radius) => {
        const cosine = (pivotDistance * pivotDistance + length * length - radius * radius) / (2 * pivotDistance * length);
        return towardSpindle + side * Math.acos(Math.max(-1, Math.min(1, cosine)));
      };
      const modelRadius = Math.hypot(arm.stylus[0], arm.stylus[1]);
      const parkedAngle = arm.parkedRadius ? angleForRadius(arm.parkedRadius) : modelAngle;
      stage.arm = { ...arm, pivotDistance, length, towardSpindle, modelAngle, side, angleForRadius, modelRadius, parkedAngle };
    }
    if (definition.crank) {
      // The crank turns about the shaft that enters the cabinet: the centre of its rearmost vertices.
      let farthest = -Infinity;
      for (const part of groups.get(definition.crank.group) || []) farthest = Math.max(farthest, -part.localBounds[2]);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (const part of groups.get(definition.crank.group) || []) {
        const positions = part.geometry.positions;
        for (let index = 0; index < positions.length; index += 3) {
          if (-positions[index + 2] > farthest - 0.012) {
            sumX += positions[index];
            sumY += positions[index + 1];
            count++;
          }
        }
      }
      stage.crankPoint = count ? [sumX / count, sumY / count, 0] : [0, 0, 0];
    }
    stage.partCentre = (groupName) => {
      const list = groups.get(groupName) || [];
      const centre = [0, 0, 0];
      for (const part of list) {
        for (let axis = 0; axis < 3; axis++) centre[axis] += (part.localBounds[axis] + part.localBounds[axis + 3]) / 2 / list.length;
      }
      return centre;
    };
  }

  setGroupMatrix(groupName, matrix) {
    for (const part of this.stage.groups.get(groupName) || []) part.matrix = matrix;
  }

  // --- Camera --------------------------------------------------------------------------------------------
  framingDistance(fovDegrees) {
    const stage = this.stage;
    if (!stage) return 0.9;
    const aspect = Math.max(0.3, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const halfVertical = Math.tan((fovDegrees * Math.PI) / 360);
    const halfHorizontal = halfVertical * aspect;
    const tightest = Math.min(halfVertical, halfHorizontal * 0.92);
    return (stage.radius * 0.86) / Math.sin(Math.atan(tightest));
  }

  setCameraPreset(presetKey, snap = false) {
    const stage = this.stage;
    this.activePreset = CAMERA_PRESETS[presetKey] ? presetKey : 'overview';
    if (!stage) return;
    const view = stage.definition.view;
    const centre = [...stage.centre];
    if (this.activePreset === 'overview') {
      this.cam.azGoal = view.azimuth;
      this.cam.elGoal = view.elevation;
      this.cam.fovGoal = view.fov;
      this.cam.distGoal = this.framingDistance(view.fov);
      this.cam.targetGoal = centre;
    } else if (this.activePreset === 'stylus') {
      this.cam.azGoal = view.azimuth - 0.35;
      this.cam.elGoal = 0.24;
      this.cam.fovGoal = 24;
      this.cam.distGoal = 0.2;
      this.cam.targetGoal = [...this.lastStylus67];
    } else if (this.activePreset === 'profile') {
      this.cam.azGoal = 0;
      this.cam.elGoal = 0.12;
      this.cam.fovGoal = 24;
      this.cam.distGoal = this.framingDistance(24);
      this.cam.targetGoal = centre;
    } else {
      this.cam.azGoal = 0;
      this.cam.elGoal = 1.5;
      this.cam.fovGoal = 26;
      this.cam.distGoal = this.framingDistance(26);
      this.cam.targetGoal = centre;
    }
    if (snap) {
      this.cam.az = this.cam.azGoal;
      this.cam.el = this.cam.elGoal;
      this.cam.fov = this.cam.fovGoal;
      this.cam.dist = this.cam.distGoal;
      this.cam.target = [...this.cam.targetGoal];
    }
  }

  orbit(deltaAzimuth, deltaElevation) {
    this.cam.azGoal -= deltaAzimuth;
    this.cam.elGoal = Math.max(0.04, Math.min(1.52, this.cam.elGoal + deltaElevation));
    this.activePreset = 'custom';
  }

  pan(deltaX, deltaY) {
    const scale = this.cam.distGoal * 0.0014;
    const cosine = Math.cos(this.cam.az);
    const sine = Math.sin(this.cam.az);
    this.cam.targetGoal[0] -= deltaX * cosine * scale;
    this.cam.targetGoal[2] += deltaX * sine * scale;
    this.cam.targetGoal[1] += deltaY * scale;
    this.activePreset = 'custom';
  }

  zoom(factor) {
    this.cam.distGoal = Math.max(0.1, Math.min(3.2, this.cam.distGoal * factor));
  }

  // --- Record --------------------------------------------------------------------------------------------
  setRecord(rec, vis, meta) {
    this.lastRecordArgs = [rec, vis, meta];
    const titles = (rec?.tracks || []).map((track) => track.title);
    const labelMeta = {
      albumTitle: meta?.title || 'Studio Cut',
      artist: meta?.by || meta?.artist || 'CodePawl Studio',
      year: meta?.year || '1924',
      labelColor: meta?.labelColor || meta?.color || '#7c1f22',
      inkColor: meta?.inkColor || meta?.ink || '#e6c98a',
      playerEra: this.activePlayer,
    };
    drawDiscSurfaceTexture(rec, vis, titles.length ? titles : [labelMeta.albumTitle], labelMeta, this.discCanvas, this.discFinishCanvas);
    const stage = this.stage;
    if (!stage || !stage.discPart) return;
    if (typeof stage.renderer.updateTexture === 'function') {
      stage.renderer.updateTexture(this.discTextureDesc);
      stage.renderer.updateTexture(this.discFinishDesc);
    }
    const positions = applyDiscWarpToPart(stage.discPart, rec);
    updatePartVertices(stage.renderer, stage.discPart, positions, stage.discPart.geometry.normals);
  }

  // Changes whenever the view does, so anything pinned to the screen knows when to let go.
  cameraKey() {
    const basis = this.camBasis;
    if (!basis) return '';
    return [basis.eye[0], basis.eye[1], basis.eye[2], basis.fx, basis.fy, basis.fz, basis.fovDeg].map((value) => value.toFixed(3)).join(',');
  }

  // --- Changing the record -------------------------------------------------------------------------------
  hasDisc() {
    return !!(this.stage && this.stage.discPart);
  }

  // 0 = the disc sits on the platter, 1 = it has been carried out of the picture.
  setDiscSwap(amount) {
    if (amount > 0 && !(this.discSwapAmount > 0) && this.camBasis) {
      // The disc leaves towards the right of the picture as it stands when the hand takes it.
      this.discSwapDirection = [this.camBasis.rx, 0, this.camBasis.rz];
    }
    this.discSwapAmount = Math.max(0, Math.min(1, amount));
  }

  // The disc first rises clear of the spindle, then travels sideways while it keeps rising a little.
  liftedDiscMatrix(spin) {
    const amount = this.discSwapAmount;
    const rise = smoothStep(Math.min(1, amount / 0.3));
    const travel = smoothStep(Math.max(0, (amount - 0.2) / 0.8));
    const direction = this.discSwapDirection || [1, 0, 0];
    const matrix = new Float32Array(spin);
    matrix[12] += direction[0] * travel * DISC_SWAP_TRAVEL;
    matrix[13] += rise * DISC_SWAP_RISE + travel * DISC_SWAP_RISE;
    matrix[14] += direction[2] * travel * DISC_SWAP_TRAVEL;
    return matrix;
  }

  // --- Motion --------------------------------------------------------------------------------------------
  // Radius of the stylus from the spindle that the engine's arm angle stands for.
  static radiusOfAlpha(alpha) {
    const [x, y] = stylusXY(alpha);
    return Math.hypot(x, y);
  }

  updateTransforms(state = {}) {
    this.lastState = state;
    const stage = this.stage;
    if (!stage) return;
    const platterAngle = state.thp || 0;
    const alpha = state.al ?? ALPHA_REST;
    const stylusHeight = Math.max(0, state.zb ?? 0.005);
    const cueUp = state.cueUp ?? true;
    const motor = !!state.motor;
    const rpm = state.rpm || 33.333;
    const vtf = state.vtf || 1.8;
    const antiskate = state.antiskate ?? 1.8;
    const radius = TurntableRenderer67.radiusOfAlpha(alpha);
    const progress = Math.max(0, Math.min(1, (R_PROGRAM - radius) / (R_PROGRAM - R_PROGRAM_MIN)));

    if (stage.player === PHONOGRAPH) {
      const drum = stage.definition.drum;
      const axisPoint = physTo67(0, drum.axisY, drum.axisZ);
      const slide = drum.travelStart + (drum.travelEnd - drum.travelStart) * progress;
      const turn = rotationAbout(AXIS_RIGHT, -platterAngle * 1.6, axisPoint, [slide, 0, 0]);
      this.setGroupMatrix('ph_drum', turn);
      this.setGroupMatrix('ph_shaft', turn);
      // The needle carrier tips back a few degrees when lifted.
      const hinge = physTo67(0, -0.0795, 0.045);
      const lift = Math.min(1, stylusHeight / 0.004);
      const tilt = rotationAbout(AXIS_RIGHT, lift * 0.07, hinge);
      this.setGroupMatrix('ph_support', tilt);
      this.setGroupMatrix('ph_horn', tilt);
      this.lastStylus67 = physTo67(0, drum.axisY - 0.045, drum.axisZ);
    } else {
      const spin = rotationAbout(AXIS_UP, platterAngle, [0, 0, 0]);
      for (const groupName of stage.definition.spin) this.setGroupMatrix(groupName, spin);
      this.setGroupMatrix('disc', this.discSwapAmount > 0 ? this.liftedDiscMatrix(spin) : spin);

      const arm = stage.arm;
      const parkedFrom = R_DISC + 0.002;
      let armAngle;
      if (radius <= parkedFrom) {
        armAngle = arm.angleForRadius(radius);
      } else {
        const restRadius = TurntableRenderer67.radiusOfAlpha(ALPHA_REST);
        const blend = Math.min(1, (radius - parkedFrom) / Math.max(1e-6, restRadius - parkedFrom));
        const edgeAngle = arm.angleForRadius(parkedFrom);
        armAngle = edgeAngle + wrapAngle(arm.parkedAngle - edgeAngle) * blend;
      }
      const swing = wrapAngle(armAngle - arm.modelAngle);
      const pivot67 = physTo67(arm.pivot[0], arm.pivot[1], 0);
      const armMatrix = rotationAbout(AXIS_UP, swing, pivot67, [0, stylusHeight - arm.tipZ + 0.0006, 0]);
      for (const groupName of arm.groups) this.setGroupMatrix(groupName, armMatrix);
      const stylusX = arm.pivot[0] + arm.length * Math.cos(armAngle);
      const stylusY = arm.pivot[1] + arm.length * Math.sin(armAngle);
      this.lastStylus67 = physTo67(stylusX, stylusY, Math.max(0.002, stylusHeight));

      if (stage.player === GRAMOPHONE) {
        const crankAngle = motor ? platterAngle * 0.35 : 0;
        this.setGroupMatrix('gr_crank', rotationAbout(AXIS_BACK, crankAngle, stage.crankPoint));
      } else {
        this.setGroupMatrix('dd_start', translation67([0, motor ? -0.0012 : 0, 0]));
        this.setGroupMatrix('dd_btn33', translation67([0, rpm < 39 ? -0.0008 : 0, 0]));
        this.setGroupMatrix('dd_btn45', translation67([0, rpm >= 39 && rpm < 60 ? -0.0008 : 0, 0]));
        this.setGroupMatrix('dd_pitch', translation67([0, 0, (this.pitchPct / 8) * 0.045]));
        this.setGroupMatrix('dd_cue', rotationAbout(AXIS_RIGHT, cueUp ? 0 : 0.5, stage.partCentre('dd_cue')));
        this.setGroupMatrix('dd_antiskate', rotationAbout(AXIS_UP, (antiskate - 1.8) * 0.9, stage.partCentre('dd_antiskate')));
        // The counterweight screws along the arm's rear stub as tracking force changes.
        const along = (vtf - 1.8) * 0.004;
        const stubAngle = armAngle + Math.PI;
        const weightShift = physTo67(along * Math.cos(stubAngle), along * Math.sin(stubAngle), 0);
        const weightMatrix = new Float32Array(armMatrix);
        weightMatrix[12] += weightShift[0];
        weightMatrix[14] += weightShift[2];
        this.setGroupMatrix('dd_counterweight', weightMatrix);
      }
    }
    stage.renderer.updateParts(stage.machineParts);
  }

  // Groove radius under the pointer when dragging the arm of a disc player.
  armRadiusAt(clientX, clientY) {
    const stage = this.stage;
    if (!stage || !stage.arm) return null;
    const point = this.rayPlanePhysXY(clientX, clientY, 0.012);
    if (!point) return null;
    const arm = stage.arm;
    const angle = Math.atan2(point[1] - arm.pivot[1], point[0] - arm.pivot[0]);
    const stylusX = arm.pivot[0] + arm.length * Math.cos(angle);
    const stylusY = arm.pivot[1] + arm.length * Math.sin(angle);
    const offSide = Math.sign(wrapAngle(angle - arm.towardSpindle)) !== arm.side;
    return offSide ? 0.045 : Math.hypot(stylusX, stylusY);
  }

  // 0 at the start of the foil, 1 at the end, for a physics x on the phonograph drum.
  drumProgressAt(physX) {
    const stage = this.stage;
    if (!stage || stage.player !== PHONOGRAPH) return 0;
    const drum = stage.definition.drum;
    const slide = stage.groups.get('ph_drum')?.[0]?.matrix[12] || 0;
    const fromLeft = (physX - slide - drum.low) / (drum.high - drum.low);
    return Math.max(0, Math.min(1, 1 - fromLeft));
  }

  // --- Frame ---------------------------------------------------------------------------------------------
  draw(state) {
    const stage = this.stage;
    if (!stage) return;
    this.updateTransforms(state);

    if (this.activePreset === 'stylus') this.cam.targetGoal = [...this.lastStylus67];
    const damping = 0.16;
    this.cam.az += (this.cam.azGoal - this.cam.az) * damping;
    this.cam.el += (this.cam.elGoal - this.cam.el) * damping;
    this.cam.dist += (this.cam.distGoal - this.cam.dist) * damping;
    this.cam.fov += (this.cam.fovGoal - this.cam.fov) * damping;
    for (let axis = 0; axis < 3; axis++) {
      this.cam.target[axis] += (this.cam.targetGoal[axis] - this.cam.target[axis]) * damping;
    }

    const cosElevation = Math.cos(this.cam.el);
    const eye = [
      this.cam.target[0] + this.cam.dist * cosElevation * Math.sin(this.cam.az),
      this.cam.target[1] + this.cam.dist * Math.sin(this.cam.el),
      this.cam.target[2] + this.cam.dist * cosElevation * Math.cos(this.cam.az),
    ];
    const floorY = stage.definition.floorZ + 0.02;
    if (eye[1] < floorY) eye[1] = floorY;

    // 67js sizes the canvas itself from its own pixel ratio. Setting canvas.width here as well made the
    // two fight: every frame the frame targets were thrown away and allocated again.
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (this.sizedRenderer !== stage.renderer || this.sizedWidth !== width || this.sizedHeight !== height) {
      this.sizedRenderer = stage.renderer;
      this.sizedWidth = width;
      this.sizedHeight = height;
      stage.renderer.resize();
      if (this.activePreset === 'overview') this.cam.distGoal = this.framingDistance(this.cam.fovGoal);
    }
    this.computeViewProj(eye, this.cam.target, this.cam.fov, width / height);

    const pointLights = [];
    if (stage.player === DIRECT_DRIVE) {
      const strobe = stage.partCentre('dd_strobe');
      pointLights.push({
        position: [strobe[0] + 0.02, strobe[1] + 0.004, strobe[2]],
        color: [1.0, 0.2, 0.06],
        intensity: state.motor ? 0.05 : 0.012,
        range: 0.12,
      });
    }

    const look = stage.look;
    stage.renderer.render({
      eye,
      target: this.cam.target,
      up: [0, 1, 0],
      fov: this.cam.fov,
      near: 0.02,
      far: 12,
      exposure: look.exposure,
      environment: { ...stage.environment, pointLights },
      effects: this.frameEffects(look),
    });
  }

  // The look's grade plus what depends on the shot: contact shading, a little film grain, and a shallow
  // focus that only sets in when the camera comes close, the way a lens behaves near its subject.
  frameEffects(look) {
    const distance = this.cam.dist;
    const closeness = Math.max(0, Math.min(1, (CLOSE_UP_DISTANCE - distance) / CLOSE_UP_DISTANCE));
    const effects = { ...look.effects, ambientOcclusion: 0.5, grain: 0.012 };
    if (closeness > 0.02) effects.depthOfField = { blur: 0.014 * closeness, focusDistance: distance };
    return effects;
  }

  computeViewProj(eye, target, fovDeg, aspect) {
    let fx = target[0] - eye[0];
    let fy = target[1] - eye[1];
    let fz = target[2] - eye[2];
    const forwardLength = Math.hypot(fx, fy, fz) || 1;
    fx /= forwardLength; fy /= forwardLength; fz /= forwardLength;
    let rx = -fz;
    let rz = fx;
    const rightLength = Math.hypot(rx, rz) || 1;
    rx /= rightLength; rz /= rightLength;
    const ry = 0;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    this.camBasis = { eye, fx, fy, fz, rx, ry, rz, ux, uy, uz, fovDeg, aspect };
  }

  // 67js world point -> CSS pixel position [x, y, depth] inside the canvas.
  projectWorld67(point) {
    if (!this.camBasis) return null;
    const { eye, fx, fy, fz, rx, ry, rz, ux, uy, uz, fovDeg, aspect } = this.camBasis;
    const dx = point[0] - eye[0];
    const dy = point[1] - eye[1];
    const dz = point[2] - eye[2];
    const depth = dx * fx + dy * fy + dz * fz;
    if (depth <= 0.005) return null;
    const across = dx * rx + dy * ry + dz * rz;
    const upward = dx * ux + dy * uy + dz * uz;
    const tangent = Math.tan((fovDeg * Math.PI) / 360);
    return [
      (across / (depth * tangent * aspect) * 0.5 + 0.5) * this.canvas.clientWidth,
      (0.5 - upward / (depth * tangent) * 0.5) * this.canvas.clientHeight,
      depth,
    ];
  }

  screenRay67(clientX, clientY) {
    if (!this.camBasis) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2;
    const { eye, fx, fy, fz, rx, ry, rz, ux, uy, uz, fovDeg, aspect } = this.camBasis;
    const tangent = Math.tan((fovDeg * Math.PI) / 360);
    const px = ndcX * tangent * aspect;
    const py = ndcY * tangent;
    return { origin: eye, dir: normalize3([fx + px * rx + py * ux, fy + px * ry + py * uy, fz + px * rz + py * uz]) };
  }

  // Where the pointer's ray meets the horizontal plane z = zPhys, as physics [x, y].
  rayPlanePhysXY(clientX, clientY, zPhys = 0) {
    const ray = this.screenRay67(clientX, clientY);
    if (!ray || Math.abs(ray.dir[1]) < 1e-5) return null;
    const distance = (zPhys - ray.origin[1]) / ray.dir[1];
    if (distance <= 0) return null;
    return [ray.origin[0] + distance * ray.dir[0], -(ray.origin[2] + distance * ray.dir[2])];
  }

  // --- Picking -------------------------------------------------------------------------------------------
  // Nearest triangle hit over every machine part, so a control hidden behind the cabinet is not picked.
  pickControl(clientX, clientY) {
    const stage = this.stage;
    const ray = this.screenRay67(clientX, clientY);
    if (!stage || !ray) return null;
    let bestDistance = Infinity;
    let bestPart = null;

    for (const part of stage.machineParts) {
      const matrix = part.matrix;
      const ox = ray.origin[0] - matrix[12];
      const oy = ray.origin[1] - matrix[13];
      const oz = ray.origin[2] - matrix[14];
      const origin = [
        matrix[0] * ox + matrix[1] * oy + matrix[2] * oz,
        matrix[4] * ox + matrix[5] * oy + matrix[6] * oz,
        matrix[8] * ox + matrix[9] * oy + matrix[10] * oz,
      ];
      const direction = [
        matrix[0] * ray.dir[0] + matrix[1] * ray.dir[1] + matrix[2] * ray.dir[2],
        matrix[4] * ray.dir[0] + matrix[5] * ray.dir[1] + matrix[6] * ray.dir[2],
        matrix[8] * ray.dir[0] + matrix[9] * ray.dir[1] + matrix[10] * ray.dir[2],
      ];

      const bounds = part.localBounds;
      const padding = stage.controlByPart.has(part) ? 0.003 : 0;
      let near = 0;
      let far = bestDistance;
      let insideBox = true;
      for (let axis = 0; axis < 3; axis++) {
        const low = bounds[axis] - padding;
        const high = bounds[axis + 3] + padding;
        if (Math.abs(direction[axis]) < 1e-8) {
          if (origin[axis] < low || origin[axis] > high) { insideBox = false; break; }
        } else {
          const first = (low - origin[axis]) / direction[axis];
          const second = (high - origin[axis]) / direction[axis];
          near = Math.max(near, Math.min(first, second));
          far = Math.min(far, Math.max(first, second));
          if (near > far) { insideBox = false; break; }
        }
      }
      if (!insideBox) continue;

      const positions = part.geometry.positions;
      const indices = part.geometry.indices;
      const [ldx, ldy, ldz] = direction;
      const [lox, loy, loz] = origin;
      let hit = Infinity;
      for (let index = 0; index < indices.length; index += 3) {
        const i0 = indices[index] * 3;
        const i1 = indices[index + 1] * 3;
        const i2 = indices[index + 2] * 3;
        const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
        const e1x = positions[i1] - v0x, e1y = positions[i1 + 1] - v0y, e1z = positions[i1 + 2] - v0z;
        const e2x = positions[i2] - v0x, e2y = positions[i2 + 1] - v0y, e2z = positions[i2 + 2] - v0z;
        const px = ldy * e2z - ldz * e2y;
        const py = ldz * e2x - ldx * e2z;
        const pz = ldx * e2y - ldy * e2x;
        const determinant = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(determinant) < 1e-12) continue;
        const inverse = 1 / determinant;
        const tx = lox - v0x, ty = loy - v0y, tz = loz - v0z;
        const u = (tx * px + ty * py + tz * pz) * inverse;
        if (u < -0.02 || u > 1.02) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (ldx * qx + ldy * qy + ldz * qz) * inverse;
        if (v < -0.02 || u + v > 1.02) continue;
        const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
        if (distance > 0.01 && distance < hit) hit = distance;
      }
      if (hit < bestDistance) {
        bestDistance = hit;
        bestPart = part;
      }
    }

    const control = bestPart ? stage.controlByPart.get(bestPart) : null;
    if (!control) return null;
    const hit67 = [
      ray.origin[0] + bestDistance * ray.dir[0],
      ray.origin[1] + bestDistance * ray.dir[1],
      ray.origin[2] + bestDistance * ray.dir[2],
    ];
    const hitPhys = [hit67[0], -hit67[2], hit67[1]];
    return { control, part: bestPart, hit67, hitPhys, hitR: Math.hypot(hitPhys[0], hitPhys[1]) };
  }

  // --- Hover outline -------------------------------------------------------------------------------------
  // Draws the outline of the hovered control and returns where its leader line starts plus the machine's
  // screen box, so the tooltip can sit clear of the machine.
  drawHoverOverlay(context, control, cssWidth, cssHeight) {
    context.clearRect(0, 0, cssWidth, cssHeight);
    const stage = this.stage;
    if (!control || !stage || !this.camBasis) return null;

    const projector = this.screenProjector(cssWidth, cssHeight);
    const deviceScale = context.canvas.width / cssWidth;
    const signature = this.hoverSignature(control, projector, deviceScale);
    let ring = this.hoverRing;
    if (!ring || ring.control !== control || !sameNumbers(ring.signature, signature)) {
      ring = this.buildHoverRing(control, projector, deviceScale);
      if (ring) {
        ring.control = control;
        ring.signature = signature;
      }
      this.hoverRing = ring;
    }
    if (!ring) return null;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(
      this.ringCanvas,
      0, 0, ring.width, ring.height,
      ring.left * deviceScale, ring.top * deviceScale,
      (ring.width / ring.maskScale) * deviceScale, (ring.height / ring.maskScale) * deviceScale,
    );
    context.restore();
    return { box: ring.box, centre: ring.centre, machineBounds: this.machineScreenBounds(projector) };
  }

  // Constants for turning a 67js world point into CSS pixels, worked out once per frame.
  screenProjector(cssWidth, cssHeight) {
    const basis = this.camBasis;
    const tangent = Math.tan((basis.fovDeg * Math.PI) / 360);
    return {
      basis,
      cssWidth,
      cssHeight,
      scaleX: (0.5 * cssWidth) / (tangent * basis.aspect),
      scaleY: (0.5 * cssHeight) / tangent,
    };
  }

  machineScreenBounds(projector) {
    const { basis, cssWidth, cssHeight, scaleX, scaleY } = projector;
    const { eye, fx, fy, fz, rx, ry, rz, ux, uy, uz } = basis;
    const machine = [Infinity, Infinity, -Infinity, -Infinity];
    for (const part of this.stage.machineParts) {
      const bounds = part.localBounds;
      const matrix = part.matrix;
      for (let corner = 0; corner < 8; corner++) {
        const localX = corner & 1 ? bounds[3] : bounds[0];
        const localY = corner & 2 ? bounds[4] : bounds[1];
        const localZ = corner & 4 ? bounds[5] : bounds[2];
        const dx = matrix[0] * localX + matrix[4] * localY + matrix[8] * localZ + matrix[12] - eye[0];
        const dy = matrix[1] * localX + matrix[5] * localY + matrix[9] * localZ + matrix[13] - eye[1];
        const dz = matrix[2] * localX + matrix[6] * localY + matrix[10] * localZ + matrix[14] - eye[2];
        const depth = dx * fx + dy * fy + dz * fz;
        if (depth <= 0.005) continue;
        const screenX = cssWidth / 2 + ((dx * rx + dy * ry + dz * rz) / depth) * scaleX;
        const screenY = cssHeight / 2 - ((dx * ux + dy * uy + dz * uz) / depth) * scaleY;
        if (screenX < machine[0]) machine[0] = screenX;
        if (screenY < machine[1]) machine[1] = screenY;
        if (screenX > machine[2]) machine[2] = screenX;
        if (screenY > machine[3]) machine[3] = screenY;
      }
    }
    return machine;
  }

  // Everything the outline depends on. While these numbers hold, the ring drawn last frame is reused.
  // A disc, platter or drum looks the same at every turn, so only a point on its axis goes in.
  hoverSignature(control, projector, deviceScale) {
    const { eye, fx, fy, fz, rx, ry, rz, fovDeg, aspect } = projector.basis;
    const signature = [projector.cssWidth, projector.cssHeight, deviceScale, eye[0], eye[1], eye[2], fx, fy, fz, rx, ry, rz, fovDeg, aspect];
    for (const groupName of control.groups) {
      const symmetric = SPIN_SYMMETRIC_GROUPS.has(groupName);
      for (const part of this.stage.groups.get(groupName) || []) {
        const matrix = part.matrix;
        if (symmetric) {
          const bounds = part.localBounds;
          const centreX = (bounds[0] + bounds[3]) / 2;
          const centreY = (bounds[1] + bounds[4]) / 2;
          const centreZ = (bounds[2] + bounds[5]) / 2;
          // A bounds centre sits a hair off the spin axis, so it is rounded to half a millimetre.
          signature.push(
            Math.round((matrix[0] * centreX + matrix[4] * centreY + matrix[8] * centreZ + matrix[12]) * 2000),
            Math.round((matrix[1] * centreX + matrix[5] * centreY + matrix[9] * centreZ + matrix[13]) * 2000),
            Math.round((matrix[2] * centreX + matrix[6] * centreY + matrix[10] * centreZ + matrix[14]) * 2000),
          );
        } else {
          for (let index = 0; index < 16; index++) signature.push(matrix[index]);
        }
      }
    }
    return signature;
  }

  // The outline is the part's own silhouette. Its triangles are filled into a small coverage buffer that
  // spans only the part's screen box, the buffer is drawn a few pixels fatter, and the shape itself is cut
  // back out, which leaves a ring that hugs the part. The 2D canvas path fill took about a second for the
  // record's 20,000 triangles; this fill takes a few milliseconds.
  buildHoverRing(control, projector, deviceScale) {
    const { basis, cssWidth, cssHeight, scaleX, scaleY } = projector;
    const { eye, fx, fy, fz, rx, ry, rz, ux, uy, uz } = basis;
    const halfWidth = cssWidth / 2;
    const halfHeight = cssHeight / 2;

    const projectedParts = [];
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const groupName of control.groups) {
      for (const part of this.stage.groups.get(groupName) || []) {
        const positions = part.geometry.positions;
        const matrix = part.matrix;
        const vertexCount = positions.length / 3;
        const screenX = new Float32Array(vertexCount);
        const screenY = new Float32Array(vertexCount);
        const onScreen = new Uint8Array(vertexCount);
        for (let vertex = 0; vertex < vertexCount; vertex++) {
          const offset = vertex * 3;
          const localX = positions[offset];
          const localY = positions[offset + 1];
          const localZ = positions[offset + 2];
          const dx = matrix[0] * localX + matrix[4] * localY + matrix[8] * localZ + matrix[12] - eye[0];
          const dy = matrix[1] * localX + matrix[5] * localY + matrix[9] * localZ + matrix[13] - eye[1];
          const dz = matrix[2] * localX + matrix[6] * localY + matrix[10] * localZ + matrix[14] - eye[2];
          const depth = dx * fx + dy * fy + dz * fz;
          if (depth <= 0.005) continue;
          const pointX = halfWidth + ((dx * rx + dy * ry + dz * rz) / depth) * scaleX;
          const pointY = halfHeight - ((dx * ux + dy * uy + dz * uz) / depth) * scaleY;
          onScreen[vertex] = 1;
          screenX[vertex] = pointX;
          screenY[vertex] = pointY;
          if (pointX < box[0]) box[0] = pointX;
          if (pointY < box[1]) box[1] = pointY;
          if (pointX > box[2]) box[2] = pointX;
          if (pointY > box[3]) box[3] = pointY;
        }
        projectedParts.push({ indices: part.geometry.indices, vertexCount, screenX, screenY, onScreen });
      }
    }
    if (box[0] > box[2]) return null;

    const gapCss = 3;
    const ringCss = 1.6;
    const padding = gapCss + ringCss + 2;
    const left = Math.max(-padding, box[0] - padding);
    const top = Math.max(-padding, box[1] - padding);
    const right = Math.min(cssWidth + padding, box[2] + padding);
    const bottom = Math.min(cssHeight + padding, box[3] + padding);
    if (right <= left || bottom <= top) return null;
    const maskScale = Math.min(deviceScale, HOVER_MASK_MAX_SIDE / Math.max(right - left, bottom - top));
    const width = Math.max(1, Math.ceil((right - left) * maskScale));
    const height = Math.max(1, Math.ceil((bottom - top) * maskScale));

    if (!this.coverage || this.coverage.length < width * height) this.coverage = new Uint8Array(width * height);
    const coverage = this.coverage;
    coverage.fill(0, 0, width * height);

    let triangleCount = 0;
    for (const projected of projectedParts) {
      const { indices, vertexCount, screenX, screenY, onScreen } = projected;
      const indexCount = indices ? indices.length : vertexCount;
      for (let index = 0; index + 2 < indexCount; index += 3) {
        const first = indices ? indices[index] : index;
        const second = indices ? indices[index + 1] : index + 1;
        const third = indices ? indices[index + 2] : index + 2;
        if (!onScreen[first] || !onScreen[second] || !onScreen[third]) continue;
        const x0 = (screenX[first] - left) * maskScale;
        const y0 = (screenY[first] - top) * maskScale;
        const x1 = (screenX[second] - left) * maskScale;
        const y1 = (screenY[second] - top) * maskScale;
        const x2 = (screenX[third] - left) * maskScale;
        const y2 = (screenY[third] - top) * maskScale;
        fillTriangleCoverage(coverage, width, height, x0, y0, x1, y1, x2, y2);
        triangleCount++;
      }
    }
    if (triangleCount === 0) return null;

    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskContext = this.maskCanvas.getContext('2d', { willReadFrequently: true });
      this.ringCanvas = document.createElement('canvas');
      this.ringContext = this.ringCanvas.getContext('2d');
    }
    // The two canvases only grow; the used corner is width x height.
    if (this.maskCanvas.width < width || this.maskCanvas.height < height) {
      const grownWidth = Math.max(this.maskCanvas.width, width);
      const grownHeight = Math.max(this.maskCanvas.height, height);
      this.maskCanvas.width = grownWidth;
      this.maskCanvas.height = grownHeight;
      this.ringCanvas.width = grownWidth;
      this.ringCanvas.height = grownHeight;
    }
    if (!this.maskImage || this.maskImage.width !== width || this.maskImage.height !== height) {
      this.maskImage = new ImageData(width, height);
      this.maskPixels = new Uint32Array(this.maskImage.data.buffer);
    }
    const pixels = this.maskPixels;
    const pixelCount = width * height;
    for (let pixel = 0; pixel < pixelCount; pixel++) pixels[pixel] = coverage[pixel] ? 0xffffffff : 0;
    this.maskContext.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.maskContext.putImageData(this.maskImage, 0, 0);

    const mask = this.maskCanvas;
    const ringContext = this.ringContext;
    const gapPixels = gapCss * maskScale;
    const ringPixels = ringCss * maskScale;
    const drawFat = (distance) => {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * TAU;
        ringContext.drawImage(mask, Math.cos(angle) * distance, Math.sin(angle) * distance);
      }
    };
    ringContext.globalCompositeOperation = 'source-over';
    ringContext.globalAlpha = 1;
    ringContext.clearRect(0, 0, this.ringCanvas.width, this.ringCanvas.height);
    drawFat(gapPixels + ringPixels);
    ringContext.globalCompositeOperation = 'destination-out';
    drawFat(gapPixels);
    ringContext.drawImage(mask, 0, 0);
    ringContext.globalCompositeOperation = 'source-over';
    ringContext.globalAlpha = 0.07;
    ringContext.drawImage(mask, 0, 0);
    ringContext.globalAlpha = 1;

    // The box centre stays put while a disc or a drum spins, so the leader line does not wander.
    const centre = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    return { box, centre, left, top, width, height, maskScale };
  }
}

function roundedPolygon(context, points, radius) {
  const count = points.length;
  for (let index = 0; index < count; index++) {
    const previous = points[(index + count - 1) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const inLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]) || 1;
    const outLength = Math.hypot(next[0] - current[0], next[1] - current[1]) || 1;
    const inset = Math.min(radius, inLength / 2, outLength / 2);
    const startX = current[0] - ((current[0] - previous[0]) / inLength) * inset;
    const startY = current[1] - ((current[1] - previous[1]) / inLength) * inset;
    const endX = current[0] + ((next[0] - current[0]) / outLength) * inset;
    const endY = current[1] + ((next[1] - current[1]) / outLength) * inset;
    if (index === 0) context.moveTo(startX, startY);
    else context.lineTo(startX, startY);
    context.quadraticCurveTo(current[0], current[1], endX, endY);
  }
  context.closePath();
}

// Monotone chain convex hull.
function convexHull2D(points) {
  const sorted = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
