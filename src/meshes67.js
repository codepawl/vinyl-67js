// Procedural high-detail 3D meshes and PBR materials for the three historical record players in 67js.
// Physics coordinates: (px, py, pz) with +Z up, disc on XY plane at Z=0.
// 67js world coordinates: (wx, wy, wz) = (px, pz, -py) with +Y up, right-handed.

import { TAU } from './dsp.js';
import { R_DISC, R_LABEL, ARM_LE, ARM_BETA, PIVOT_X, PIVOT_Y } from './geometry.js';

export function physTo67(px, py, pz) {
  return [px, pz, -py];
}

export function vec67(dx, dy, dz) {
  return [dx, dz, -dy];
}

// --- Matrix helpers (column-major 4x4 in 67js world space) ---
export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4FromPhysTranslation(px, py, pz) {
  const m = mat4Identity();
  m[12] = px;
  m[13] = pz;
  m[14] = -py;
  return m;
}

// Rotation around physics +Z axis (= 67js +Y axis) by angle theta, translated by (px, py, pz)
export function mat4FromPhysRotZ(theta, px = 0, py = 0, pz = 0) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const m = new Float32Array(16);
  // In physics: x' = c*x - s*y, y' = s*x + c*y, z' = z
  // In 67js (wx=px, wy=pz, wz=-py):
  // wx' = c*wx + s*wz
  // wy' = wy
  // wz' = -s*wx + c*wz
  m[0] = c;   m[1] = 0; m[2] = -s;  m[3] = 0;
  m[4] = 0;   m[5] = 1; m[6] = 0;   m[7] = 0;
  m[8] = s;   m[9] = 0; m[10] = c;  m[11] = 0;
  m[12] = px; m[13] = pz; m[14] = -py; m[15] = 1;
  return m;
}

// Rotation around physics +X axis (= 67js +X axis) by angle phi, translated by (px, py, pz)
export function mat4FromPhysRotX(phi, px = 0, py = 0, pz = 0) {
  const c = Math.cos(phi), s = Math.sin(phi);
  const m = new Float32Array(16);
  m[0] = 1;   m[1] = 0; m[2] = 0;   m[3] = 0;
  m[4] = 0;   m[5] = c; m[6] = -s;  m[7] = 0;
  m[8] = 0;   m[9] = s; m[10] = c;  m[11] = 0;
  m[12] = px; m[13] = pz; m[14] = -py; m[15] = 1;
  return m;
}

export function mat4Parked() {
  return mat4FromPhysTranslation(0, 0, -50);
}

export function transformPointMat4(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// --- Geometry builder in physics coordinates, automatically converted to 67js world coordinates ---
export class MeshBuilder67 {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }

  v(px, py, pz, nx, ny, nz, u = 0, v = 0) {
    const i = this.pos.length / 3;
    this.pos.push(px, pz, -py);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nor.push(nx / l, nz / l, -ny / l);
    this.uv.push(u, v);
    return i;
  }

  tri(a, b, c) {
    const i0 = a * 3, i1 = b * 3, i2 = c * 3;
    const e1x = this.pos[i1] - this.pos[i0];
    const e1y = this.pos[i1 + 1] - this.pos[i0 + 1];
    const e1z = this.pos[i1 + 2] - this.pos[i0 + 2];
    const e2x = this.pos[i2] - this.pos[i0];
    const e2y = this.pos[i2 + 1] - this.pos[i0 + 1];
    const e2z = this.pos[i2 + 2] - this.pos[i0 + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (Math.hypot(cx, cy, cz) < 1e-11) return;
    const nx = this.nor[i0] + this.nor[i1] + this.nor[i2];
    const ny = this.nor[i0 + 1] + this.nor[i1 + 1] + this.nor[i2 + 1];
    const nz = this.nor[i0 + 2] + this.nor[i1 + 2] + this.nor[i2 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) {
      this.idx.push(a, b, c);
    } else {
      this.idx.push(a, c, b);
    }
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  // Surface of revolution around physics Z axis at center (cx, cy)
  latheZ(cx, cy, profile, segs = 64, uMode = 'cyl') {
    const base = this.pos.length / 3;
    const m = profile.length;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const th = u * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      for (let j = 0; j < m; j++) {
        const [r, z, nr, nz] = profile[j];
        const px = cx + r * c, py = cy + r * s;
        const uu = uMode === 'disc' ? 0.5 + 0.5 * (r / R_DISC) * c : u;
        const vv = uMode === 'disc' ? 0.5 - 0.5 * (r / R_DISC) * s : j / Math.max(1, m - 1);
        this.v(px, py, z, nr * c, nr * s, nz, uu, vv);
      }
    }
    const stride = m;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < m - 1; j++) {
        if (Math.hypot(profile[j][0] - profile[j + 1][0], profile[j][1] - profile[j + 1][1]) < 1e-7) continue;
        const a = base + i * stride + j;
        const b = a + stride;
        this.quad(a, b, b + 1, a + 1);
      }
    }
  }

  // Surface of revolution around physics X axis at center (x0, cy, cz)
  latheX(x0, cy, cz, profile, segs = 48, uSpan = 0.1) {
    const base = this.pos.length / 3;
    const m = profile.length;
    for (let i = 0; i <= segs; i++) {
      const v = i / segs;
      const th = v * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      for (let j = 0; j < m; j++) {
        const [lx, r, nx, nr] = profile[j];
        const px = x0 + lx;
        const py = cy + r * c;
        const pz = cz + r * s;
        const u = Math.max(0, Math.min(1, lx / Math.max(1e-4, uSpan)));
        this.v(px, py, pz, nx, nr * c, nr * s, u, v);
      }
    }
    const stride = m;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < m - 1; j++) {
        if (Math.hypot(profile[j][0] - profile[j + 1][0], profile[j][1] - profile[j + 1][1]) < 1e-7) continue;
        const a = base + i * stride + j;
        const b = a + stride;
        this.quad(a, b, b + 1, a + 1);
      }
    }
  }

  cylZ(cx, cy, z0, z1, r0, r1 = r0, segs = 48, capBot = true, capTop = true) {
    const dz = z1 - z0, dr = r1 - r0, len = Math.hypot(dz, dr) || 1;
    const nr = dz / len, nz = -dr / len;
    const prof = [];
    if (capBot && r0 > 0) prof.push([0, z0, 0, -1], [r0, z0, 0, -1]);
    prof.push([r0, z0, nr, nz], [r1, z1, nr, nz]);
    if (capTop && r1 > 0) prof.push([r1, z1, 0, 1], [0, z1, 0, 1]);
    this.latheZ(cx, cy, prof, segs);
  }

  cylX(x0, x1, cy, cz, r0, r1 = r0, segs = 40, capL = true, capR = true) {
    const dx = x1 - x0, dr = r1 - r0, len = Math.hypot(dx, dr) || 1;
    const nr = dx / len, nx = -dr / len;
    const prof = [];
    if (capL && r0 > 0) prof.push([0, 0, -1, 0], [0, r0, -1, 0]);
    prof.push([0, r0, nx, nr], [dx, r1, nx, nr]);
    if (capR && r1 > 0) prof.push([dx, r1, 1, 0], [dx, 0, 1, 0]);
    this.latheX(x0, cy, cz, prof, segs, Math.abs(dx));
  }

  ringZ(cx, cy, z0, z1, rIn, rOut, segs = 56) {
    this.latheZ(cx, cy, [
      [rIn, z0, 0, -1], [rOut, z0, 0, -1],
      [rOut, z0, 1, 0], [rOut, z1, 1, 0],
      [rOut, z1, 0, 1], [rIn, z1, 0, 1],
      [rIn, z1, -1, 0], [rIn, z0, -1, 0],
    ], segs);
  }

  box(x0, y0, z0, x1, y1, z1, bev = 0.0012) {
    const b = Math.min(bev, (x1 - x0) * 0.25, (y1 - y0) * 0.25, (z1 - z0) * 0.25);
    const xs = [x0, x0 + b, x1 - b, x1];
    const ys = [y0, y0 + b, y1 - b, y1];
    const zs = [z0, z0 + b, z1 - b, z1];
    const cx = 0.5 * (x0 + x1), cy = 0.5 * (y0 + y1), cz = 0.5 * (z0 + z1);
    const hx = 0.5 * (x1 - x0) - b, hy = 0.5 * (y1 - y0) - b, hz = 0.5 * (z1 - z0) - b;
    const g = (x, y, z) => {
      const dx = Math.max(0, Math.abs(x - cx) - hx) * Math.sign(x - cx);
      const dy = Math.max(0, Math.abs(y - cy) - hy) * Math.sign(y - cy);
      const dz = Math.max(0, Math.abs(z - cz) - hz) * Math.sign(z - cz);
      const l = Math.hypot(dx, dy, dz) || 1;
      const px = cx + Math.sign(x - cx) * hx + (dx / l) * b;
      const py = cy + Math.sign(y - cy) * hy + (dy / l) * b;
      const pz = cz + Math.sign(z - cz) * hz + (dz / l) * b;
      return this.v(px, py, pz, dx / l, dy / l, dz / l, (px - x0) / Math.max(1e-4, x1 - x0), (py - y0) / Math.max(1e-4, y1 - y0));
    };
    const patch = (uArr, vArr, wVal, axis, flip) => {
      const idx = Array.from({ length: 4 }, () => new Array(4));
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const p = [0, 0, 0];
          p[axis] = wVal;
          p[(axis + 1) % 3] = uArr[i];
          p[(axis + 2) % 3] = vArr[j];
          idx[i][j] = g(p[0], p[1], p[2]);
        }
      }
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (flip) this.quad(idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]);
          else this.quad(idx[i][j], idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]);
        }
      }
    };
    patch(ys, zs, x0, 0, true);
    patch(ys, zs, x1, 0, false);
    patch(zs, xs, y0, 1, true);
    patch(zs, xs, y1, 1, false);
    patch(xs, ys, z0, 2, true);
    patch(xs, ys, z1, 2, false);
  }

  tube(pts, sides = 20, capStart = true, capEnd = true) {
    const n = pts.length;
    let up = [0, 0, 1];
    const base = this.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = pts[i], r = p[3];
      const pPrev = pts[Math.max(0, i - 1)], pNext = pts[Math.min(n - 1, i + 1)];
      let tx = pNext[0] - pPrev[0], ty = pNext[1] - pPrev[1], tz = pNext[2] - pPrev[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let bx = ty * up[2] - tz * up[1], by = tz * up[0] - tx * up[2], bz = tx * up[1] - ty * up[0];
      let bl = Math.hypot(bx, by, bz);
      if (bl < 1e-4) {
        up = [1, 0, 0];
        bx = ty * up[2] - tz * up[1]; by = tz * up[0] - tx * up[2]; bz = tx * up[1] - ty * up[0];
        bl = Math.hypot(bx, by, bz) || 1;
      }
      bx /= bl; by /= bl; bz /= bl;
      const ux = by * tz - bz * ty, uy = bz * tx - bx * tz, uz = bx * ty - by * tx;
      up = [ux, uy, uz];
      for (let j = 0; j <= sides; j++) {
        const th = (j / sides) * TAU, c = Math.cos(th), s = Math.sin(th);
        const nx = c * bx + s * ux, ny = c * by + s * uy, nz = c * bz + s * uz;
        this.v(p[0] + r * nx, p[1] + r * ny, p[2] + r * nz, nx, ny, nz, i / Math.max(1, n - 1), j / sides);
      }
    }
    const stride = sides + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * stride + j;
        this.quad(a, a + stride, a + stride + 1, a + 1);
      }
    }
    if (capStart) {
      const p = pts[0], p1 = pts[1];
      const tx = p[0] - p1[0], ty = p[1] - p1[1], tz = p[2] - p1[2];
      const cIdx = this.v(p[0], p[1], p[2], tx, ty, tz, 0, 0.5);
      for (let j = 0; j < sides; j++) this.tri(cIdx, base + j + 1, base + j);
    }
    if (capEnd) {
      const p = pts[n - 1], p0 = pts[n - 2];
      const tx = p[0] - p0[0], ty = p[1] - p0[1], tz = p[2] - p0[2];
      const cIdx = this.v(p[0], p[1], p[2], tx, ty, tz, 1, 0.5);
      const ring = base + (n - 1) * stride;
      for (let j = 0; j < sides; j++) this.tri(cIdx, ring + j, ring + j + 1);
    }
  }

  toPart(name, material, includeUVs = false) {
    const geometry = {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      indices: new Uint32Array(this.idx),
    };
    if (includeUVs) geometry.uvs = new Float32Array(this.uv);
    return {
      name,
      geometry,
      material: {
        metallic: 0,
        roughness: 0.5,
        emission: 0,
        ...material,
      },
      matrix: mat4Identity(),
      visible: true,
    };
  }
}

// --- Material palette (67js PBR materials) ---
export const MATERIALS = {
  // 1877 Edison Phonograph materials
  oakWood: {
    color: [0.36, 0.20, 0.09],
    roughness: 0.34,
    metallic: 0.02,
    clearcoat: 0.65,
    clearcoatRoughness: 0.18,
  },
  oakDarkTrim: {
    color: [0.22, 0.11, 0.05],
    roughness: 0.38,
    metallic: 0.03,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
  },
  castIronEnamel: {
    color: [0.05, 0.055, 0.06],
    roughness: 0.24,
    metallic: 0.45,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
  },
  polishedBrass: {
    color: [0.90, 0.69, 0.28],
    roughness: 0.16,
    metallic: 0.96,
    anisotropy: 0.45,
  },
  agedBrass: {
    color: [0.74, 0.54, 0.22],
    roughness: 0.26,
    metallic: 0.92,
    anisotropy: 0.35,
  },
  machinedSteel: {
    color: [0.76, 0.78, 0.82],
    roughness: 0.20,
    metallic: 0.94,
    anisotropy: 0.55,
  },
  micaDiaphragm: {
    color: [0.88, 0.85, 0.76],
    roughness: 0.15,
    metallic: 0.10,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
  },
  spareBrownWax: {
    color: [0.26, 0.16, 0.10],
    roughness: 0.25,
    metallic: 0.04,
    clearcoat: 0.45,
    clearcoatRoughness: 0.2,
  },

  // 1925 Acoustic Gramophone materials
  mahoganyCabinet: {
    color: [0.32, 0.11, 0.06],
    roughness: 0.28,
    metallic: 0.02,
    clearcoat: 0.78,
    clearcoatRoughness: 0.12,
  },
  walnutPanel: {
    color: [0.22, 0.08, 0.04],
    roughness: 0.34,
    metallic: 0.02,
    clearcoat: 0.65,
    clearcoatRoughness: 0.16,
  },
  emeraldFelt: {
    color: [0.06, 0.28, 0.16],
    roughness: 0.88,
    metallic: 0.0,
    sheenColor: [0.16, 0.48, 0.30],
    sheenRoughness: 0.65,
  },
  ivoryScale: {
    color: [0.92, 0.89, 0.80],
    roughness: 0.32,
    metallic: 0.02,
  },

  // 1979 Direct-Drive Studio Turntable materials
  plinthDarkCast: {
    color: [0.09, 0.095, 0.105],
    roughness: 0.42,
    metallic: 0.65,
    clearcoat: 0.18,
    clearcoatRoughness: 0.32,
  },
  topPlateAnodized: {
    color: [0.16, 0.17, 0.185],
    roughness: 0.28,
    metallic: 0.82,
    anisotropy: 0.55,
  },
  platterAluminum: {
    color: [0.83, 0.85, 0.88],
    roughness: 0.17,
    metallic: 0.95,
    anisotropy: 0.72,
  },
  rubberMat: {
    color: [0.055, 0.058, 0.064],
    roughness: 0.76,
    metallic: 0.04,
  },
  chromeMirror: {
    color: [0.91, 0.92, 0.95],
    roughness: 0.10,
    metallic: 0.98,
    anisotropy: 0.35,
  },
  blackAnodized: {
    color: [0.07, 0.075, 0.082],
    roughness: 0.30,
    metallic: 0.78,
  },
  cartridgeBody: {
    color: [0.11, 0.12, 0.14],
    roughness: 0.25,
    metallic: 0.45,
  },
  strobeRedLens: {
    color: [0.95, 0.22, 0.08],
    roughness: 0.15,
    metallic: 0.1,
    emission: 2.2,
    emissiveColor: [1.0, 0.22, 0.06],
  },
  ledRedOn: {
    color: [1.0, 0.20, 0.08],
    roughness: 0.2,
    metallic: 0.05,
    emission: 2.5,
    emissiveColor: [1.0, 0.20, 0.06],
  },
  ledRedOff: {
    color: [0.25, 0.06, 0.04],
    roughness: 0.4,
    metallic: 0.1,
    emission: 0.02,
    emissiveColor: [0.3, 0.05, 0.02],
  },
  ledGreenQuartz: {
    color: [0.18, 0.95, 0.48],
    roughness: 0.2,
    metallic: 0.05,
    emission: 2.2,
    emissiveColor: [0.22, 1.0, 0.52],
  },
};

// --- Disc mesh with UV mapping and warp capability ---
export function buildDiscPart(name, discTextureDescriptor, discFinishDescriptor, discNormalDescriptor) {
  const b = new MeshBuilder67();
  const rRings = 44, thSegs = 128;
  const rMin = 0.0036, rMax = R_DISC;
  const baseTop = 0;
  for (let ir = 0; ir <= rRings; ir++) {
    const v = ir / rRings;
    const r = rMin + (rMax - rMin) * v;
    for (let it = 0; it <= thSegs; it++) {
      const u = it / thSegs;
      const th = u * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      const px = r * c, py = r * s;
      const uu = 0.5 + 0.5 * (r / rMax) * c;
      const vv = 0.5 - 0.5 * (r / rMax) * s;
      const zTop = r < R_LABEL ? 0.00035 : 0.0;
      b.v(px, py, zTop, 0, 0, 1, uu, vv);
    }
  }
  const stride = thSegs + 1;
  for (let ir = 0; ir < rRings; ir++) {
    for (let it = 0; it < thSegs; it++) {
      const a = baseTop + ir * stride + it;
      b.quad(a, a + stride, a + stride + 1, a + 1);
    }
  }
  const topVertCount = b.pos.length / 3;
  // Rim bevel + bottom face
  b.latheZ(0, 0, [
    [rMax, 0.0, 0.7, 0.7],
    [rMax + 0.0006, -0.0009, 1, 0],
    [rMax, -0.0018, 0.7, -0.7],
    [rMin, -0.0018, 0, -1],
    [rMin, 0.00035, -1, 0],
  ], thSegs, 'disc');

  const part = b.toPart(name, {
    color: [0.92, 0.92, 0.94],
    // The finish map carries roughness and metal per point, so these factors stay at one.
    roughness: discFinishDescriptor ? 1 : 0.2,
    metallic: discFinishDescriptor ? 1 : 0.14,
    metallicRoughnessMap: discFinishDescriptor,
    normalMap: discNormalDescriptor,
    // No anisotropy: its highlight is tied to the disc and swept the whole surface white twice a turn.
    anisotropy: 0,
    iridescence: 0.36,
    iridescenceIOR: 1.48,
    clearcoat: 0.12,
    clearcoatRoughness: 0.14,
    map: discTextureDescriptor,
  }, true);
  part.userData = { topVertCount, basePositions: new Float32Array(part.geometry.positions) };
  return part;
}

// Apply physical warp & eccentricity to the disc's vertices
export function applyDiscWarpToPart(part, rec) {
  if (!part || !part.userData) return part.geometry.positions;
  const base = part.userData.basePositions;
  const pos = new Float32Array(base.length);
  const warp = rec?.warp || [];
  const ox = rec?.ecc?.[0] || 0;
  const oy = rec?.ecc?.[1] || 0;
  for (let i = 0; i < base.length; i += 3) {
    const px = base[i] + ox;
    const pz = base[i + 1];
    const py = -base[i + 2] + oy;
    const r = Math.hypot(px, py);
    const th = Math.atan2(py, px);
    const rf = Math.max(0, (r - R_LABEL) / (R_DISC - R_LABEL));
    let dz = 0;
    for (let k = 0; k < warp.length; k++) {
      dz += warp[k].amp * rf * rf * Math.cos(warp[k].k * th + warp[k].ph);
    }
    pos[i] = px;
    pos[i + 1] = pz + dz;
    pos[i + 2] = -py;
  }
  return pos;
}

// ============================================================================
// 1. 1877 EDISON CYLINDER PHONOGRAPH
// ============================================================================
export function buildPhonograph1877(cylinderTextureDescriptor) {
  const parts = [];

  // Oak base cabinet
  const bBase = new MeshBuilder67();
  bBase.box(-0.235, -0.155, -0.072, 0.235, 0.155, -0.018, 0.005);
  bBase.box(-0.250, -0.170, -0.084, 0.250, 0.170, -0.068, 0.004);
  parts.push(bBase.toPart('ph_oak_base', MATERIALS.oakWood));

  const bTrim = new MeshBuilder67();
  bTrim.box(-0.222, -0.142, -0.020, 0.222, 0.142, -0.010, 0.003);
  for (const [fx, fy] of [[-0.22, -0.14], [0.22, -0.14], [-0.22, 0.14], [0.22, 0.14]]) {
    bTrim.cylZ(fx, fy, -0.092, -0.082, 0.018, 0.022, 24);
  }
  parts.push(bTrim.toPart('ph_oak_moulding', MATERIALS.oakDarkTrim));

  // Cast-iron bedplate + twin stanchions supporting the mandrel & feedscrew
  const bIron = new MeshBuilder67();
  bIron.box(-0.210, -0.130, -0.011, 0.210, 0.130, 0.000, 0.003);
  // Left stanchion (supporting mandrel axle & feedscrew)
  bIron.box(-0.155, -0.068, 0.000, -0.132, 0.032, 0.098, 0.003);
  // Right swing gate stanchion
  bIron.box(0.132, -0.068, 0.000, 0.155, 0.032, 0.098, 0.003);
  // Rear guide rod brackets
  bIron.box(-0.155, 0.048, 0.000, -0.132, 0.074, 0.076, 0.002);
  bIron.box(0.132, 0.048, 0.000, 0.155, 0.074, 0.076, 0.002);
  parts.push(bIron.toPart('ph_bedplate', MATERIALS.castIronEnamel));

  // Static steel guide rods & threaded leadscrew housing
  const bSteel = new MeshBuilder67();
  // Rear sliding rod (y = 0.060, z = 0.068)
  bSteel.cylX(-0.145, 0.145, 0.060, 0.068, 0.0055, 0.0055, 28);
  // Front straight edge rail (y = -0.056, z = 0.042)
  bSteel.box(-0.145, -0.060, 0.038, 0.145, -0.050, 0.044, 0.001);
  // Mandrel central axle
  bSteel.cylX(-0.165, 0.165, -0.005, 0.078, 0.005, 0.005, 28);
  parts.push(bSteel.toPart('ph_guide_rods', MATERIALS.machinedSteel));

  // Rotating threaded feedscrew (centered at y = 0.036, z = 0.068)
  const bScrew = new MeshBuilder67();
  bScrew.cylX(-0.168, 0.138, 0, 0, 0.0065, 0.0065, 32, true, true);
  for (let k = 0; k < 28; k++) {
    const x = -0.122 + k * 0.009;
    bScrew.cylX(x, x + 0.0045, 0, 0, 0.0085, 0.0085, 24, true, true);
  }
  // Drive gear on left end (radius 0.0195 so it meshes cleanly without overlapping mandrel gear)
  bScrew.cylX(-0.163, -0.155, 0, 0, 0.0195, 0.0195, 36, true, true);
  bScrew.cylX(-0.167, -0.152, 0, 0, 0.010, 0.010, 24, true, true);
  parts.push(bScrew.toPart('ph_leadscrew', { ...MATERIALS.polishedBrass, doubleSided: true }));

  // Rotating brass mandrel (centered at y = -0.005, z = 0.078 in world, built at local origin)
  const bMandrel = new MeshBuilder67();
  bMandrel.cylX(-0.105, 0.105, 0, 0, 0.0285, 0.0305, 48, true, true);
  bMandrel.cylX(-0.168, 0.140, 0, 0, 0.0065, 0.0065, 28, true, true);
  bMandrel.cylX(-0.163, -0.155, 0, 0, 0.021, 0.021, 36, true, true);
  bMandrel.cylX(-0.167, -0.152, 0, 0, 0.0105, 0.0105, 24, true, true);
  parts.push(bMandrel.toPart('ph_mandrel', { ...MATERIALS.polishedBrass, doubleSided: true }));

  // Rotating textured wax cylinder on the mandrel (local origin, x from -0.092 to +0.092)
  const bCyl = new MeshBuilder67();
  const cLen = 0.184;
  bCyl.latheX(-0.092, 0, 0, [
    [0, 0.029, -1, 0],
    [0, 0.0355, -1, 0],
    [0, 0.0355, 0, 1],
    [cLen, 0.0365, 0, 1],
    [cLen, 0.0365, 1, 0],
    [cLen, 0.030, 1, 0],
  ], 64, cLen);
  parts.push(bCyl.toPart('ph_wax_cylinder', {
    color: [0.95, 0.92, 0.88],
    roughness: 0.22,
    metallic: 0.06,
    anisotropy: 0.65,
    clearcoat: 0.55,
    clearcoatRoughness: 0.16,
    doubleSided: true,
    map: cylinderTextureDescriptor,
  }, true));

  // Spare wax cylinder on front-left peg (interactive: click to change song/cylinder!)
  const bSpare = new MeshBuilder67();
  bSpare.cylZ(-0.185, -0.095, 0.000, 0.096, 0.026, 0.027, 48, true, true);
  parts.push(bSpare.toPart('ph_spare_cylinder', { ...MATERIALS.spareBrownWax, doubleSided: true }));

  const bSpareRim = new MeshBuilder67();
  bSpareRim.cylZ(-0.185, -0.095, 0.096, 0.102, 0.027, 0.027, 48, true, true);
  bSpareRim.cylZ(-0.185, -0.095, 0.102, 0.114, 0.0085, 0.0085, 28, true, true);
  parts.push(bSpareRim.toPart('ph_spare_rim', { ...MATERIALS.polishedBrass, doubleSided: true }));

  // Winding hand crank on the right side (interactive: click/drag to wind/toggle motor)
  // Built around local X-axis at (0.155, -0.015, -0.032)
  const bCrankMetal = new MeshBuilder67();
  bCrankMetal.cylX(0.0, 0.055, 0, 0, 0.006, 0.006, 24);
  bCrankMetal.box(0.048, -0.008, -0.008, 0.060, 0.008, 0.078, 0.002);
  bCrankMetal.cylX(0.058, 0.112, 0, 0.070, 0.005, 0.005, 20);
  parts.push(bCrankMetal.toPart('ph_crank_arm', MATERIALS.polishedBrass));

  const bCrankWood = new MeshBuilder67();
  bCrankWood.cylX(0.064, 0.116, 0, 0.070, 0.011, 0.013, 28, true, true);
  parts.push(bCrankWood.toPart('ph_crank_handle', MATERIALS.oakDarkTrim));

  // Speed regulator & spinning governor assembly on the front-left bedplate
  const bGov = new MeshBuilder67();
  bGov.cylZ(-0.095, -0.095, 0.000, 0.008, 0.021, 0.020, 36, true, true);
  bGov.cylZ(-0.095, -0.095, 0.008, 0.026, 0.016, 0.016, 36, true, true);
  bGov.cylZ(-0.095, -0.095, 0.026, 0.046, 0.0075, 0.0075, 28, true, true);
  bGov.cylZ(-0.095, -0.095, 0.046, 0.055, 0.0165, 0.0165, 36, true, true);
  bGov.cylZ(-0.095, -0.095, 0.055, 0.061, 0.0065, 0.0055, 24, true, true);
  // Governor flyballs on side arms
  bGov.cylZ(-0.113, -0.095, 0.028, 0.038, 0.006, 0.006, 20, true, true);
  bGov.cylZ(-0.077, -0.095, 0.028, 0.038, 0.006, 0.006, 20, true, true);
  parts.push(bGov.toPart('ph_speed_screw', { ...MATERIALS.polishedBrass, doubleSided: true }));

  // Sliding reproducer carriage (moves along X as cylinder plays)
  const bCarriage = new MeshBuilder67();
  // Sleeve around rear guide rod (y=0.060, z=0.068) and feedscrew nut (y=0.036, z=0.068)
  bCarriage.cylX(-0.026, 0.026, 0.060, 0.068, 0.011, 0.011, 28);
  bCarriage.cylX(-0.022, 0.022, 0.036, 0.068, 0.011, 0.011, 28);
  // Bridge arm reaching over the cylinder to (y=-0.005, z=0.122)
  bCarriage.tube([
    [0, 0.060, 0.068, 0.008],
    [0, 0.035, 0.105, 0.008],
    [0, -0.005, 0.124, 0.009],
    [0, -0.042, 0.082, 0.006],
    [0, -0.055, 0.044, 0.006],
  ], 20);
  // Reproducer soundbox housing ring sitting over top of wax cylinder
  bCarriage.cylZ(0, -0.005, 0.114, 0.125, 0.024, 0.024, 36);
  // Neck rising into the acoustic horn
  bCarriage.tube([
    [0, -0.005, 0.125, 0.009],
    [0, 0.008, 0.152, 0.011],
    [0, 0.032, 0.175, 0.014],
  ], 24);
  parts.push(bCarriage.toPart('ph_carriage', { ...MATERIALS.polishedBrass, doubleSided: true }));

  // Mica diaphragm + sapphire stylus bar inside reproducer
  const bMica = new MeshBuilder67();
  bMica.cylZ(0, -0.005, 0.113, 0.115, 0.020, 0.020, 32);
  bMica.cylZ(0, -0.005, 0.108, 0.114, 0.0025, 0.001, 16);
  parts.push(bMica.toPart('ph_mica', MATERIALS.micaDiaphragm));

  // Engage / Lift lever on front of carriage (interactive!)
  const bLift = new MeshBuilder67();
  bLift.tube([
    [0, -0.046, 0.056, 0.004],
    [0.016, -0.072, 0.064, 0.0035],
    [0.024, -0.085, 0.070, 0.006],
  ], 16);
  parts.push(bLift.toPart('ph_lift_lever', MATERIALS.machinedSteel));

  // Spun-brass acoustic horn riding with the carriage (double-walled + rolled brass lip + stiffening rings)
  const bHorn = new MeshBuilder67();
  const hSteps = 22, hSegs = 48;
  const hornCenters = [];
  for (let i = 0; i <= hSteps; i++) {
    const t = i / hSteps;
    const px = 0.010 * t;
    const py = 0.032 - t * 0.145;
    const pz = 0.175 + t * 0.095 + 0.014 * Math.sin(t * Math.PI);
    const rOut = 0.014 * Math.pow(1 + t * 1.48, 1.55) + 0.008 * Math.pow(t, 4);
    const rIn = Math.max(0.0115, rOut - 0.0018);
    hornCenters.push({ px, py, pz, rOut, rIn, t });
  }
  // Compute stable Frenet frames along horn axis
  const hornFrames = hornCenters.map((c, i) => {
    const p0 = hornCenters[Math.max(0, i - 1)];
    const p1 = hornCenters[Math.min(hSteps, i + 1)];
    let tx = p1.px - p0.px, ty = p1.py - p0.py, tz = p1.pz - p0.pz;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // Cross with X axis [1, 0, 0] for up-ish vector, then orthogonalize
    let ux = 0, uy = tz, uz = -ty;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    return { ...c, tx, ty, tz, ux, uy, uz, vx, vy, vz };
  });

  const stride = hSegs + 1;
  // 1) Outer wall of the spun-brass horn
  const outBase = bHorn.pos.length / 3;
  for (let i = 0; i <= hSteps; i++) {
    const f = hornFrames[i];
    const fNext = hornFrames[Math.min(hSteps, i + 1)];
    const fPrev = hornFrames[Math.max(0, i - 1)];
    const dr = (fNext.rOut - fPrev.rOut) / Math.max(1e-4, Math.hypot(fNext.px - fPrev.px, fNext.py - fPrev.py, fNext.pz - fPrev.pz));
    for (let j = 0; j <= hSegs; j++) {
      const u = j / hSegs, th = u * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      const rx = c * f.vx + s * f.ux;
      const ry = c * f.vy + s * f.uy;
      const rz = c * f.vz + s * f.uz;
      let nx = rx - dr * 0.45 * f.tx;
      let ny = ry - dr * 0.45 * f.ty;
      let nz = rz - dr * 0.45 * f.tz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      bHorn.v(f.px + f.rOut * rx, f.py + f.rOut * ry, f.pz + f.rOut * rz, nx / nl, ny / nl, nz / nl, u, f.t);
    }
  }
  for (let i = 0; i < hSteps; i++) {
    for (let j = 0; j < hSegs; j++) {
      const a = outBase + i * stride + j;
      bHorn.quad(a, a + stride, a + stride + 1, a + 1);
    }
  }

  // 2) Inner acoustic wall of the horn (normals pointing inward into the horn cavity)
  const inBase = bHorn.pos.length / 3;
  for (let i = 0; i <= hSteps; i++) {
    const f = hornFrames[i];
    const fNext = hornFrames[Math.min(hSteps, i + 1)];
    const fPrev = hornFrames[Math.max(0, i - 1)];
    const dr = (fNext.rIn - fPrev.rIn) / Math.max(1e-4, Math.hypot(fNext.px - fPrev.px, fNext.py - fPrev.py, fNext.pz - fPrev.pz));
    for (let j = 0; j <= hSegs; j++) {
      const u = j / hSegs, th = u * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      const rx = c * f.vx + s * f.ux;
      const ry = c * f.vy + s * f.uy;
      const rz = c * f.vz + s * f.uz;
      let nx = -rx + dr * 0.45 * f.tx;
      let ny = -ry + dr * 0.45 * f.ty;
      let nz = -rz + dr * 0.45 * f.tz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      bHorn.v(f.px + f.rIn * rx, f.py + f.rIn * ry, f.pz + f.rIn * rz, nx / nl, ny / nl, nz / nl, u, f.t);
    }
  }
  for (let i = 0; i < hSteps; i++) {
    for (let j = 0; j < hSegs; j++) {
      const a = inBase + i * stride + j;
      bHorn.quad(a, a + 1, a + stride + 1, a + stride);
    }
  }

  // 3) Rolled toroidal brass lip around the horn bell mouth + throat ferrule ring
  for (const [stepIdx, tubeR] of [[hSteps, 0.0028], [6, 0.0018], [0, 0.0022]]) {
    const f = hornFrames[stepIdx];
    const rMid = 0.5 * (f.rOut + f.rIn);
    const lipSegs = 12;
    const lipBase = bHorn.pos.length / 3;
    for (let m = 0; m <= lipSegs; m++) {
      const phi = (m / lipSegs) * TAU;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      for (let j = 0; j <= hSegs; j++) {
        const u = j / hSegs, th = u * TAU;
        const c = Math.cos(th), s = Math.sin(th);
        const rx = c * f.vx + s * f.ux;
        const ry = c * f.vy + s * f.uy;
        const rz = c * f.vz + s * f.uz;
        const nx = cp * rx + sp * f.tx;
        const ny = cp * ry + sp * f.ty;
        const nz = cp * rz + sp * f.tz;
        const rad = rMid + tubeR * cp;
        const px = f.px + rad * rx + tubeR * sp * f.tx;
        const py = f.py + rad * ry + tubeR * sp * f.ty;
        const pz = f.pz + rad * rz + tubeR * sp * f.tz;
        bHorn.v(px, py, pz, nx, ny, nz, u, m / lipSegs);
      }
    }
    for (let m = 0; m < lipSegs; m++) {
      for (let j = 0; j < hSegs; j++) {
        const a = lipBase + m * stride + j;
        bHorn.quad(a, a + stride, a + stride + 1, a + 1);
      }
    }
  }
  parts.push(bHorn.toPart('ph_horn_cone', { ...MATERIALS.polishedBrass, doubleSided: true }));

  return parts;
}

// ============================================================================
// 2. 1925 ACOUSTIC HORN GRAMOPHONE
// ============================================================================
export function buildGramophone1925(discTextureDescriptor) {
  const parts = [];

  // Mahogany cabinet case + tiered moldings
  const bCab = new MeshBuilder67();
  // Base plinth molding
  bCab.box(-0.205, -0.205, -0.145, 0.205, 0.205, -0.118, 0.006);
  // Main cabinet body
  bCab.box(-0.182, -0.182, -0.118, 0.182, 0.182, -0.026, 0.005);
  // Top cornice table
  bCab.box(-0.198, -0.198, -0.026, 0.198, 0.198, -0.008, 0.005);
  parts.push(bCab.toPart('gr_cabinet', MATERIALS.mahoganyCabinet));

  // Corner pilasters & carved dark walnut panels
  const bPanels = new MeshBuilder67();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      bPanels.cylZ(sx * 0.178, sy * 0.178, -0.118, -0.026, 0.016, 0.016, 20);
      bPanels.cylZ(sx * 0.190, sy * 0.190, -0.155, -0.144, 0.020, 0.024, 20);
    }
  }
  // Recessed side panels
  bPanels.box(-0.185, -0.135, -0.102, 0.185, 0.135, -0.042, 0.002);
  bPanels.box(-0.135, -0.185, -0.102, 0.135, 0.185, -0.042, 0.002);
  parts.push(bPanels.toPart('gr_corner_pillars', MATERIALS.walnutPanel));

  // Brass front plaque & back-bracket mount
  const bBackBracket = new MeshBuilder67();
  // Front maker's plaque
  bBackBracket.box(-0.042, -0.186, -0.082, 0.042, -0.182, -0.062, 0.001);
  // Ornate cast-brass back bracket rising behind the cabinet (at y = +0.185)
  bBackBracket.tube([
    [0, 0.185, -0.065, 0.022],
    [0, 0.212, -0.020, 0.020],
    [0, 0.222, 0.045, 0.018],
    [0, 0.205, 0.115, 0.017],
    [0, 0.182, 0.155, 0.022],
  ], 28);
  // Tonearm pivot socket at (PIVOT_X, PIVOT_Y, 0.045) bridged to the back bracket
  bBackBracket.tube([
    [0, 0.212, 0.045, 0.014],
    [PIVOT_X * 0.55, 0.165, 0.038, 0.013],
    [PIVOT_X, PIVOT_Y, 0.032, 0.018],
  ], 24);
  bBackBracket.cylZ(PIVOT_X, PIVOT_Y, -0.008, 0.038, 0.022, 0.018, 32);
  parts.push(bBackBracket.toPart('gr_back_bracket', MATERIALS.polishedBrass));

  // Flared 10-petal Morning Glory brass horn (interactive: click to toggle 1925 horn acoustics!)
  const bHorn = new MeshBuilder67();
  const hSteps = 22, hSegs = 60;
  const hBase = bHorn.pos.length / 3;
  for (let i = 0; i <= hSteps; i++) {
    const t = i / hSteps;
    // Curve from (0, 0.182, 0.155) up and forward toward (0, -0.025, 0.345)
    const cy = 0.182 - Math.pow(t, 0.85) * 0.215;
    const cz = 0.155 + Math.sin(t * Math.PI * 0.62) * 0.185;
    const rBase = 0.020 + 0.155 * Math.pow(t, 2.05);
    // Tangent along curve
    const ty = -0.215, tz = Math.cos(t * Math.PI * 0.62) * 0.185 * Math.PI * 0.62;
    const tl = Math.hypot(ty, tz) || 1;
    const uy = -tz / tl, uz = ty / tl;
    for (let j = 0; j <= hSegs; j++) {
      const u = j / hSegs, th = u * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      // 10 scalloped petals near the bell
      const petal = 1 + 0.065 * Math.pow(t, 2.2) * Math.cos(10 * th);
      const rib = 0.0025 * Math.pow(t, 1.5) * Math.pow(Math.max(0, Math.sin(10 * th * 0.5)), 8);
      const r = rBase * petal + rib;
      const px = r * c;
      const py = cy + r * s * uy;
      const pz = cz + r * s * uz;
      bHorn.v(px, py, pz, c, s * uy, s * uz, t, u);
    }
  }
  const hStride = hSegs + 1;
  for (let i = 0; i < hSteps; i++) {
    for (let j = 0; j < hSegs; j++) {
      const a = hBase + i * hStride + j;
      bHorn.quad(a, a + hStride, a + hStride + 1, a + 1);
    }
  }
  parts.push(bHorn.toPart('gr_horn_petals', { ...MATERIALS.polishedBrass, doubleSided: true }));

  // Turntable platter rim + emerald felt mat + spindle
  const bPlatter = new MeshBuilder67();
  bPlatter.cylZ(0, 0, -0.008, -0.002, 0.154, 0.156, 72);
  bPlatter.cylZ(0, 0, -0.002, 0.016, 0.0036, 0.0034, 24);
  parts.push(bPlatter.toPart('gr_platter_rim', MATERIALS.polishedBrass));

  const bFelt = new MeshBuilder67();
  bFelt.cylZ(0, 0, -0.002, -0.0004, 0.151, 0.151, 72);
  parts.push(bFelt.toPart('gr_felt_mat', MATERIALS.emeraldFelt));

  // Disc on gramophone
  parts.push(buildDiscPart('gr_disc', discTextureDescriptor));

  // Center label interactive puck / brass record clamp
  const bClamp = new MeshBuilder67();
  bClamp.cylZ(0, 0, 0.0004, 0.006, 0.016, 0.013, 36);
  parts.push(bClamp.toPart('gr_label_hitbox', MATERIALS.polishedBrass));

  // Side winding crank at right side of cabinet (x = 0.182, y = -0.02, z = -0.072)
  const bCrank = new MeshBuilder67();
  bCrank.cylX(0, 0.062, 0, 0, 0.0065, 0.0065, 24);
  bCrank.box(0.054, -0.008, -0.008, 0.066, 0.008, 0.082, 0.002);
  bCrank.cylX(0.066, 0.124, 0, 0.074, 0.005, 0.005, 20);
  parts.push(bCrank.toPart('gr_crank_arm', MATERIALS.polishedBrass));

  const bCrankWood = new MeshBuilder67();
  bCrankWood.cylX(0.070, 0.128, 0, 0.074, 0.012, 0.014, 28, true, true);
  parts.push(bCrankWood.toPart('gr_crank_wood', MATERIALS.mahoganyCabinet));

  // Turntable brake lever at front-right corner (-0.145, -0.145, -0.008)
  const bBrake = new MeshBuilder67();
  bBrake.cylZ(-0.145, -0.135, -0.008, 0.004, 0.012, 0.012, 28);
  bBrake.box(-0.152, -0.172, -0.003, -0.138, -0.105, 0.003, 0.001);
  bBrake.cylZ(-0.145, -0.168, 0.003, 0.010, 0.007, 0.007, 20);
  parts.push(bBrake.toPart('gr_brake_lever', MATERIALS.polishedBrass));

  // Speed regulator dial at front-left (-0.145, 0.115, -0.008)
  const bSpeedScale = new MeshBuilder67();
  bSpeedScale.cylZ(-0.145, 0.115, -0.008, -0.005, 0.026, 0.026, 36);
  parts.push(bSpeedScale.toPart('gr_speed_scale', MATERIALS.ivoryScale));

  const bSpeedDial = new MeshBuilder67();
  bSpeedDial.cylZ(-0.145, 0.115, -0.005, 0.009, 0.013, 0.011, 32);
  bSpeedDial.box(-0.148, 0.092, -0.004, -0.142, 0.115, -0.001, 0.0005);
  parts.push(bSpeedDial.toPart('gr_speed_dial', MATERIALS.polishedBrass));

  // Tonearm rest catch on the right
  const bCatch = new MeshBuilder67();
  bCatch.cylZ(0.172, -0.025, -0.008, 0.028, 0.006, 0.005, 24);
  bCatch.box(0.162, -0.035, 0.026, 0.182, -0.015, 0.036, 0.0015);
  parts.push(bCatch.toPart('gr_cue_catch', MATERIALS.polishedBrass));

  // Gooseneck tonearm + Exhibition mica soundbox (rotates around PIVOT_X, PIVOT_Y)
  const bArm = new MeshBuilder67();
  const armPts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = t * ARM_LE;
    const y = Math.sin(t * Math.PI) * 0.018;
    const z = 0.032 - t * 0.010 + Math.sin(t * Math.PI * 1.5) * 0.006;
    const r = 0.014 * (1 - 0.52 * t);
    armPts.push([x, y, z, r]);
  }
  bArm.tube(armPts, 24);
  // Exhibition soundbox circular brass frame at x = ARM_LE
  bArm.cylX(ARM_LE - 0.004, ARM_LE + 0.005, 0.004, 0.020, 0.024, 0.024, 36);
  parts.push(bArm.toPart('gr_tonearm', MATERIALS.polishedBrass));

  const bSoundbox = new MeshBuilder67();
  bSoundbox.cylX(ARM_LE + 0.004, ARM_LE + 0.0065, 0.004, 0.020, 0.020, 0.020, 32);
  // Steel needle descending to (ARM_LE, 0, 0)
  bSoundbox.tube([
    [ARM_LE + 0.005, 0.004, 0.020, 0.002],
    [ARM_LE + 0.002, 0.002, 0.008, 0.0015],
    [ARM_LE, 0, 0, 0.0008],
  ], 12);
  parts.push(bSoundbox.toPart('gr_soundbox', MATERIALS.micaDiaphragm));

  return parts;
}

// ============================================================================
// 3. 1979 QUARTZ DIRECT-DRIVE STUDIO TURNTABLE
// ============================================================================
export function buildDirectDrive1979(discTextureDescriptor) {
  const parts = [];

  // Heavy die-cast dark aluminum plinth + brushed anodized top plate
  const bPlinth = new MeshBuilder67();
  bPlinth.box(-0.238, -0.188, -0.044, 0.272, 0.188, -0.014, 0.004);
  for (const [fx, fy] of [[-0.205, -0.155], [0.238, -0.155], [-0.205, 0.155], [0.238, 0.155]]) {
    bPlinth.cylZ(fx, fy, -0.058, -0.044, 0.024, 0.028, 32);
  }
  parts.push(bPlinth.toPart('dd_plinth', MATERIALS.plinthDarkCast));

  const bTop = new MeshBuilder67();
  bTop.box(-0.232, -0.182, -0.014, 0.266, 0.182, -0.008, 0.002);
  // Recessed platter well collar
  bTop.ringZ(0, 0, -0.008, -0.006, 0.160, 0.168, 72);
  parts.push(bTop.toPart('dd_top_plate', MATERIALS.topPlateAnodized));

  // Lathe-turned aluminum platter with beveled strobe rim
  const bPlatter = new MeshBuilder67();
  bPlatter.latheZ(0, 0, [
    [0.010, -0.008, 0, -1],
    [0.164, -0.008, 0, -1],
    [0.164, -0.008, 1, 0],
    [0.164, -0.005, 1, 0],
    [0.157, -0.001, 0.72, 0.69],
    [0.152, -0.001, 0, 1],
    [0.010, -0.001, 0, 1],
  ], 96);
  // Raised strobe dots around the beveled platter skirt (rotates with platter!)
  const nDots = 72;
  for (let i = 0; i < nDots; i++) {
    const th = (i / nDots) * TAU;
    const c = Math.cos(th), s = Math.sin(th);
    const r = 0.1608;
    bPlatter.cylZ(r * c, r * s, -0.0052, -0.0018, 0.0018, 0.0015, 8);
  }
  // Center chrome spindle
  bPlatter.cylZ(0, 0, -0.001, 0.016, 0.0036, 0.0034, 28);
  parts.push(bPlatter.toPart('dd_platter', MATERIALS.platterAluminum));

  const bMat = new MeshBuilder67();
  bMat.cylZ(0, 0, -0.001, -0.0002, 0.150, 0.150, 72);
  parts.push(bMat.toPart('dd_rubber_mat', MATERIALS.rubberMat));

  // Warped 12" vinyl disc
  parts.push(buildDiscPart('dd_disc', discTextureDescriptor));

  // 45-RPM machined aluminum adaptor puck in top-left dock (-0.195, 0.142) -> click to change record!
  const bPuck = new MeshBuilder67();
  bPuck.ringZ(-0.195, 0.142, -0.008, 0.001, 0.004, 0.019, 40);
  bPuck.ringZ(-0.195, 0.142, 0.001, 0.004, 0.004, 0.012, 32);
  parts.push(bPuck.toPart('dd_puck_45', MATERIALS.chromeMirror));

  // Strobe illuminator tower at front-left (-0.182, -0.118)
  const bStrobe = new MeshBuilder67();
  bStrobe.cylZ(-0.182, -0.118, -0.008, 0.014, 0.012, 0.011, 32);
  parts.push(bStrobe.toPart('dd_strobe_tower', MATERIALS.blackAnodized));

  const bStrobeLens = new MeshBuilder67();
  bStrobeLens.box(-0.175, -0.124, 0.002, -0.168, -0.112, 0.011, 0.001);
  parts.push(bStrobeLens.toPart('dd_strobe_lens', MATERIALS.strobeRedLens));

  // Physical START / STOP button at front-left corner (-0.202, -0.155)
  const bStartBezel = new MeshBuilder67();
  bStartBezel.box(-0.224, -0.174, -0.008, -0.180, -0.138, -0.005, 0.001);
  parts.push(bStartBezel.toPart('dd_start_bezel', MATERIALS.blackAnodized));

  const bStartBtn = new MeshBuilder67();
  bStartBtn.box(-0.220, -0.170, -0.005, -0.184, -0.142, 0.001, 0.0012);
  parts.push(bStartBtn.toPart('dd_start_btn', MATERIALS.platterAluminum));

  // 33 / 45 / 78 RPM speed selector buttons + LEDs
  const bBtn33 = new MeshBuilder67();
  bBtn33.box(-0.174, -0.172, -0.008, -0.150, -0.154, -0.002, 0.001);
  parts.push(bBtn33.toPart('dd_btn_33', MATERIALS.platterAluminum));

  const bLed33 = new MeshBuilder67();
  bLed33.box(-0.170, -0.152, -0.008, -0.154, -0.148, -0.005, 0.0005);
  parts.push(bLed33.toPart('dd_led_33', { ...MATERIALS.ledRedOn }));

  const bBtn45 = new MeshBuilder67();
  bBtn45.box(-0.146, -0.172, -0.008, -0.122, -0.154, -0.002, 0.001);
  parts.push(bBtn45.toPart('dd_btn_45', MATERIALS.platterAluminum));

  const bLed45 = new MeshBuilder67();
  bLed45.box(-0.142, -0.152, -0.008, -0.126, -0.148, -0.005, 0.0005);
  parts.push(bLed45.toPart('dd_led_45', { ...MATERIALS.ledRedOff }));

  const bBtn78 = new MeshBuilder67();
  bBtn78.box(-0.118, -0.172, -0.008, -0.094, -0.154, -0.002, 0.001);
  parts.push(bBtn78.toPart('dd_btn_78', MATERIALS.platterAluminum));

  const bLed78 = new MeshBuilder67();
  bLed78.box(-0.114, -0.152, -0.008, -0.098, -0.148, -0.005, 0.0005);
  parts.push(bLed78.toPart('dd_led_78', { ...MATERIALS.ledRedOff }));

  // Pitch control slot + sliding fader knob on right side (x = 0.238, y from -0.125 to -0.025)
  const bPitchSlot = new MeshBuilder67();
  bPitchSlot.box(0.224, -0.132, -0.008, 0.252, -0.018, -0.006, 0.001);
  parts.push(bPitchSlot.toPart('dd_pitch_slot', MATERIALS.blackAnodized));

  const bQuartzLed = new MeshBuilder67();
  bQuartzLed.cylZ(0.216, -0.075, -0.008, -0.005, 0.003, 0.003, 16);
  parts.push(bQuartzLed.toPart('dd_quartz_led', { ...MATERIALS.ledGreenQuartz }));

  const bPitchKnob = new MeshBuilder67();
  bPitchKnob.box(0.227, -0.084, -0.006, 0.249, -0.066, 0.005, 0.0015);
  parts.push(bPitchKnob.toPart('dd_pitch_knob', MATERIALS.chromeMirror));

  // Tonearm base collar at (PIVOT_X, PIVOT_Y)
  const bArmBase = new MeshBuilder67();
  bArmBase.cylZ(PIVOT_X, PIVOT_Y, -0.008, -0.001, 0.044, 0.042, 48);
  bArmBase.ringZ(PIVOT_X, PIVOT_Y, -0.001, 0.006, 0.028, 0.038, 48);
  // Gimbal outer vertical yoke
  bArmBase.box(PIVOT_X - 0.005, PIVOT_Y - 0.022, 0.000, PIVOT_X + 0.005, PIVOT_Y - 0.016, 0.036, 0.001);
  bArmBase.box(PIVOT_X - 0.005, PIVOT_Y + 0.016, 0.000, PIVOT_X + 0.005, PIVOT_Y + 0.022, 0.036, 0.001);
  bArmBase.box(PIVOT_X - 0.005, PIVOT_Y - 0.022, 0.032, PIVOT_X + 0.005, PIVOT_Y + 0.022, 0.037, 0.001);
  // Curved cueing lift bar & arm rest at (PIVOT_X - 0.024, PIVOT_Y - 0.072)
  bArmBase.cylZ(PIVOT_X - 0.024, PIVOT_Y - 0.072, -0.008, 0.018, 0.004, 0.004, 20);
  bArmBase.box(PIVOT_X - 0.034, PIVOT_Y - 0.078, 0.016, PIVOT_X - 0.014, PIVOT_Y - 0.066, 0.021, 0.001);
  parts.push(bArmBase.toPart('dd_arm_base', MATERIALS.blackAnodized));

  // Anti-skate dial at (PIVOT_X + 0.032, PIVOT_Y - 0.028)
  const bAntiSkate = new MeshBuilder67();
  bAntiSkate.cylZ(PIVOT_X + 0.032, PIVOT_Y - 0.028, -0.008, 0.006, 0.011, 0.010, 32);
  bAntiSkate.box(PIVOT_X + 0.031, PIVOT_Y - 0.038, 0.006, PIVOT_X + 0.033, PIVOT_Y - 0.026, 0.008, 0.0004);
  parts.push(bAntiSkate.toPart('dd_antiskate_dial', MATERIALS.chromeMirror));

  // Hydraulic cueing lever at (PIVOT_X + 0.024, PIVOT_Y - 0.056)
  const bCueLever = new MeshBuilder67();
  bCueLever.tube([
    [PIVOT_X + 0.018, PIVOT_Y - 0.052, 0.004, 0.0022],
    [PIVOT_X + 0.028, PIVOT_Y - 0.068, 0.016, 0.0022],
    [PIVOT_X + 0.032, PIVOT_Y - 0.076, 0.022, 0.0038],
  ], 16);
  parts.push(bCueLever.toPart('dd_cue_lever', MATERIALS.chromeMirror));

  // S-shaped chrome tonearm tube + gimbal inner block (built at local origin, rotated by alpha around PIVOT_X, PIVOT_Y)
  const bArmTube = new MeshBuilder67();
  bArmTube.box(-0.012, -0.012, 0.010, 0.012, 0.012, 0.028, 0.002);
  // Rear stub for counterweight
  bArmTube.cylX(-0.062, -0.012, 0, 0.019, 0.0055, 0.0055, 24);
  // S-shaped front tube reaching toward (ARM_LE - 0.038, 0, 0.019)
  const sPts = [];
  const xEnd = ARM_LE - 0.038;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = 0.012 + t * (xEnd - 0.012);
    const y = Math.sin(t * TAU) * 0.011;
    const z = 0.019;
    sPts.push([x, y, z, 0.0046]);
  }
  bArmTube.tube(sPts, 24);
  // Diamond cantilever & stylus descending to exact (ARM_LE, 0, 0)
  bArmTube.tube([
    [ARM_LE - 0.009, 0, 0.005, 0.0007],
    [ARM_LE, 0, 0.0008, 0.0004],
    [ARM_LE, 0, 0.0, 0.0001],
  ], 10);
  parts.push(bArmTube.toPart('dd_arm_tube', MATERIALS.chromeMirror));

  // Headshell + cartridge + finger lift (built in tonearm local space so it moves with dd_arm_tube)
  const bHead = new MeshBuilder67();
  const cb = Math.cos(-ARM_BETA), sb = Math.sin(-ARM_BETA);
  const hPoint = (lx, ly, lz) => [
    xEnd + lx * cb - ly * sb,
    lx * sb + ly * cb,
    lz,
  ];
  const p0 = hPoint(0, 0, 0.019), p1 = hPoint(0.042, 0, 0.017);
  bHead.tube([
    [p0[0], p0[1], p0[2], 0.006],
    [p1[0], p1[1], p1[2], 0.008],
  ], 16);
  // Cartridge body above stylus at (ARM_LE, 0)
  bHead.box(ARM_LE - 0.018, -0.009, 0.005, ARM_LE + 0.004, 0.009, 0.017, 0.0015);
  // Finger lift loop on headshell
  const fl0 = hPoint(0.026, -0.008, 0.016);
  const fl1 = hPoint(0.030, -0.022, 0.022);
  const fl2 = hPoint(0.034, -0.026, 0.019);
  bHead.tube([
    [fl0[0], fl0[1], fl0[2], 0.0014],
    [fl1[0], fl1[1], fl1[2], 0.0014],
    [fl2[0], fl2[1], fl2[2], 0.0014],
  ], 12);
  parts.push(bHead.toPart('dd_headshell', MATERIALS.blackAnodized));

  // Calibrated Counterweight on rear stub (local space of tonearm, slides slightly with VTF)
  const bCW = new MeshBuilder67();
  bCW.ringZ(0, 0, 0, 0, 0, 0, 8); // unused dummy
  const bCWReal = new MeshBuilder67();
  bCWReal.cylX(-0.052, -0.024, 0, 0.019, 0.0165, 0.0165, 36, true, true);
  bCWReal.cylX(-0.024, -0.019, 0, 0.019, 0.0135, 0.0135, 32, true, true);
  parts.push(bCWReal.toPart('dd_counterweight', MATERIALS.chromeMirror));

  return parts;
}

// A round cable laid along a path of physical points [x, y, z] (metres), smoothed between them.
export function buildCablePart(name, pathPoints, radius, material) {
  const builder = new MeshBuilder67();
  const stepsPerSpan = 10;
  const sides = 10;
  const centres = [];
  const pointAt = (index) => pathPoints[Math.max(0, Math.min(pathPoints.length - 1, index))];
  for (let span = 0; span < pathPoints.length - 1; span++) {
    const [before, start, end, after] = [pointAt(span - 1), pointAt(span), pointAt(span + 1), pointAt(span + 2)];
    const lastStep = span === pathPoints.length - 2 ? stepsPerSpan : stepsPerSpan - 1;
    for (let step = 0; step <= lastStep; step++) {
      const t = step / stepsPerSpan;
      const centre = [0, 1, 2].map((axis) => 0.5 * (
        2 * start[axis]
        + (end[axis] - before[axis]) * t
        + (2 * before[axis] - 5 * start[axis] + 4 * end[axis] - after[axis]) * t * t
        + (3 * start[axis] - before[axis] - 3 * end[axis] + after[axis]) * t * t * t
      ));
      centres.push(centre);
    }
  }
  const normalise = (vector) => {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  };
  const cross = (first, second) => [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
  for (let ring = 0; ring < centres.length; ring++) {
    const previous = centres[Math.max(0, ring - 1)];
    const next = centres[Math.min(centres.length - 1, ring + 1)];
    const forward = normalise([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]]);
    const reference = Math.abs(forward[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const sideways = normalise(cross(forward, reference));
    const upward = cross(sideways, forward);
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * TAU;
      const outward = [0, 1, 2].map((axis) => sideways[axis] * Math.cos(angle) + upward[axis] * Math.sin(angle));
      builder.v(
        centres[ring][0] + outward[0] * radius,
        centres[ring][1] + outward[1] * radius,
        centres[ring][2] + outward[2] * radius,
        outward[0], outward[1], outward[2],
      );
    }
  }
  for (let ring = 0; ring < centres.length - 1; ring++) {
    for (let side = 0; side < sides; side++) {
      const nextSide = (side + 1) % sides;
      const corner = ring * sides + side;
      builder.quad(corner, ring * sides + nextSide, (ring + 1) * sides + nextSide, corner + sides);
    }
  }
  return builder.toPart(name, material);
}

// --- The groove under the needle, at true scale -----------------------------------------------------------
// A patch of record surface a few millimetres long, lying on the disc where the needle rides: flat land with
// V-shaped grooves cut into it. The mesh is laid out in its own frame (x along the groove, y up, z towards
// the rim) and reshaped every frame from the wall positions the simulation reads, so what is drawn is the
// stretch of groove being played. Around it the disc carries on with its drawn grooves.
export const GROOVE_PATCH_MARGIN = 0.0002;   // flat land kept beyond the outermost groove of the patch
// Towards its ends and its outermost turns the grooves of the patch close up, so it has no visible border.
const GROOVE_PATCH_FADE_COLUMNS = 0.14;      // share of the length, at each end
const GROOVE_PATCH_FADE_ROWS = 8;

// coverDescriptor: a small texture whose alpha says how much of the patch shows; the renderer fades the patch
// in with it as the camera comes close, and its soft border lets the patch melt into the disc around it.
export function buildGroovePatchPart(name, rows, columns, coverDescriptor) {
  const strips = 1 + rows * 3;
  const vertexCount = columns * strips * 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    normals[vertex * 3 + 1] = 1;
    const column = Math.floor(vertex / (strips * 2));
    const across = vertex % (strips * 2);
    uvs[vertex * 2] = column / (columns - 1);
    uvs[vertex * 2 + 1] = across / (strips * 2 - 1);
  }
  const indices = new Uint32Array((columns - 1) * strips * 6);
  let cursor = 0;
  for (let column = 0; column < columns - 1; column++) {
    for (let strip = 0; strip < strips; strip++) {
      const near = (column * strips + strip) * 2;
      const far = ((column + 1) * strips + strip) * 2;
      indices[cursor++] = near; indices[cursor++] = far; indices[cursor++] = far + 1;
      indices[cursor++] = near; indices[cursor++] = far + 1; indices[cursor++] = near + 1;
    }
  }
  return {
    name,
    geometry: { positions, normals, uvs, indices },
    material: {
      color: [0.005, 0.005, 0.0055],
      roughness: 0.38,
      metallic: 0.14,
      doubleSided: true,
      map: coverDescriptor,
      alphaMode: 'blend',
    },
    userData: { rows, columns, strips },
  };
}

function smoothFade(amount) {
  const share = Math.max(0, Math.min(1, amount));
  return share * share * (3 - 2 * share);
}

// walls: for each row and column, the inner and outer top edge of that groove in metres from the centre of
// the groove being played (NaN where the record has no groove). Row 0 is the turn nearest the rim.
export function shapeGroovePatch(part, walls, halfLength) {
  const { rows, columns, strips } = part.userData;
  const { positions, normals } = part.geometry;
  const edges = new Float32Array(rows * 2);
  // How far the patch reaches across the grooves, read off the column under the needle.
  const middleColumn = Math.floor(columns / 2);
  let lowest = 0;
  let highest = 0;
  for (let row = 0; row < rows; row++) {
    const offset = (row * columns + middleColumn) * 2;
    const inner = walls[offset];
    const outer = walls[offset + 1];
    if (inner === inner && inner < lowest) lowest = inner;
    if (outer === outer && outer > highest) highest = outer;
  }
  lowest -= GROOVE_PATCH_MARGIN;
  highest += GROOVE_PATCH_MARGIN;
  for (let column = 0; column < columns; column++) {
    const along = (column / (columns - 1) * 2 - 1) * halfLength;
    const fromEnd = Math.min(column, columns - 1 - column) / ((columns - 1) * GROOVE_PATCH_FADE_COLUMNS);
    const lengthFade = smoothFade(fromEnd);
    let reach = lowest;
    for (let order = 0; order < rows; order++) {
      const row = rows - 1 - order;                 // later turns lie nearer the label, so they come first
      const offset = (row * columns + column) * 2;
      let inner = walls[offset];
      let outer = walls[offset + 1];
      if (!(inner === inner) || !(outer === outer) || outer < inner) inner = outer = reach;
      const open = lengthFade * smoothFade((Math.min(row, rows - 1 - row) + 1) / GROOVE_PATCH_FADE_ROWS);
      const centre = (inner + outer) / 2;
      inner = centre - (centre - inner) * open;
      outer = centre + (outer - centre) * open;
      inner = Math.max(inner, reach);
      outer = Math.max(outer, inner);
      edges[order * 2] = inner;
      edges[order * 2 + 1] = outer;
      reach = outer;
    }
    let vertex = column * strips * 2 * 3;
    const put = (radial, height, normalRadial, normalUp) => {
      positions[vertex] = along; positions[vertex + 1] = height; positions[vertex + 2] = radial;
      normals[vertex] = 0; normals[vertex + 1] = normalUp; normals[vertex + 2] = normalRadial;
      vertex += 3;
    };
    let landStart = lowest;
    for (let order = 0; order < rows; order++) {
      const inner = edges[order * 2];
      const outer = edges[order * 2 + 1];
      const middle = (inner + outer) / 2;
      const depth = (outer - inner) / 2;              // the cutter's walls stand at 45 degrees
      const slope = Math.SQRT1_2;
      put(landStart, 0, 0, 1); put(inner, 0, 0, 1);
      put(inner, 0, slope, slope); put(middle, -depth, slope, slope);
      put(middle, -depth, -slope, slope); put(outer, 0, -slope, slope);
      landStart = outer;
    }
    put(landStart, 0, 0, 1); put(Math.max(highest, landStart), 0, 0, 1);
  }
}

// The point of the machine's own needle. The needle the machine is built with ends a fraction of a
// millimetre wide; this grows out of that very end, outline for outline, and narrows down to the ball of
// 18 micrometres that rides the groove. It is built in the needle's own space and moves with the arm; only
// its tip is moved, each frame, to where the groove holds it.
export const STYLUS_TIP_RADIUS = 18e-6;
const NEEDLE_POINT_NECK_HEIGHT = 12e-6;      // the last ring sits this far above the very tip

// outline: the end of the needle as a closed ring of points [x, y, z] in the needle part's space.
// material: the needle's material. textureCoordinate: where its end is painted on that material's texture.
export function buildNeedlePointPart(name, outline, material, textureCoordinate = null) {
  const sides = outline.length;
  const vertexCount = sides * 7;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(sides * 9);
  for (let side = 0; side < sides; side++) {
    const first = side * 7;
    indices.set([first, first + 1, first + 2, first, first + 2, first + 3, first + 4, first + 5, first + 6], side * 9);
  }
  const geometry = { positions, normals, indices };
  if (textureCoordinate) {
    const uvs = new Float32Array(vertexCount * 2);
    for (let offset = 0; offset < uvs.length; offset += 2) {
      uvs[offset] = textureCoordinate[0];
      uvs[offset + 1] = textureCoordinate[1];
    }
    geometry.uvs = uvs;
  }
  const centre = [0, 0, 0];
  for (const point of outline) {
    for (let axis = 0; axis < 3; axis++) centre[axis] += point[axis] / sides;
  }
  let reach = 0;
  for (const point of outline) reach += Math.hypot(point[0] - centre[0], point[2] - centre[2]) / sides;
  const part = {
    name,
    geometry,
    material: { ...material, doubleSided: true },
    userData: { outline, centre, neckScale: STYLUS_TIP_RADIUS / Math.max(reach, 1e-9) },
  };
  shapeNeedlePoint(part, [centre[0], centre[1] - 0.0003, centre[2]]);
  return part;
}

// Moves the tip of the point to the given place, in the needle part's space.
export function shapeNeedlePoint(part, tip) {
  const { outline, centre, neckScale } = part.userData;
  const { positions, normals } = part.geometry;
  const sides = outline.length;
  const neck = outline.map((point) => [
    tip[0] + (point[0] - centre[0]) * neckScale,
    tip[1] + NEEDLE_POINT_NECK_HEIGHT,
    tip[2] + (point[2] - centre[2]) * neckScale,
  ]);
  const axis = [(centre[0] + tip[0]) / 2, (centre[1] + tip[1]) / 2, (centre[2] + tip[2]) / 2];
  let cursor = 0;
  const putFace = (corners) => {
    const [a, b, c] = corners;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    // Faces look away from the middle of the point.
    if (nx * (a[0] - axis[0]) + ny * (a[1] - axis[1]) + nz * (a[2] - axis[2]) < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    for (const corner of corners) {
      positions[cursor] = corner[0]; positions[cursor + 1] = corner[1]; positions[cursor + 2] = corner[2];
      normals[cursor] = nx; normals[cursor + 1] = ny; normals[cursor + 2] = nz;
      cursor += 3;
    }
  };
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    putFace([outline[side], outline[next], neck[next], neck[side]]);
    putFace([neck[side], neck[next], tip]);
  }
}
