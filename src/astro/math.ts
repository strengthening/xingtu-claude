/**
 * Tiny linear-algebra helpers for the astro layer.
 * Matrices are 3×3, **column-major** (same memory layout as THREE.Matrix3.elements
 * and GLSL mat3), so they can be uploaded to the GPU without transposing.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export type Vec3 = readonly [number, number, number];
/** Column-major 3×3 matrix: m[col * 3 + row]. */
export type Mat3 = Float64Array;

export function mat3(): Mat3 {
  return new Float64Array(9);
}

/** Build from row-major nested rows (how matrices are usually written on paper). */
export function mat3FromRows(rows: readonly (readonly number[])[]): Mat3 {
  const m = mat3();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 3 + r] = rows[r]?.[c] ?? 0;
  return m;
}

export function mat3Mul(a: Mat3, b: Mat3, out: Mat3 = mat3()): Mat3 {
  const r = mat3();
  for (let c = 0; c < 3; c++) {
    for (let row = 0; row < 3; row++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += (a[k * 3 + row] ?? 0) * (b[c * 3 + k] ?? 0);
      r[c * 3 + row] = s;
    }
  }
  out.set(r);
  return out;
}

export function mat3Transpose(a: Mat3, out: Mat3 = mat3()): Mat3 {
  const r = mat3();
  for (let c = 0; c < 3; c++)
    for (let row = 0; row < 3; row++) r[row * 3 + c] = a[c * 3 + row] ?? 0;
  out.set(r);
  return out;
}

export function mat3MulVec(m: Mat3, v: Vec3): [number, number, number] {
  const [x, y, z] = v;
  return [
    (m[0] ?? 0) * x + (m[3] ?? 0) * y + (m[6] ?? 0) * z,
    (m[1] ?? 0) * x + (m[4] ?? 0) * y + (m[7] ?? 0) * z,
    (m[2] ?? 0) * x + (m[5] ?? 0) * y + (m[8] ?? 0) * z,
  ];
}

export function normalize(v: Vec3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Angle between two directions, in degrees (robust for tiny angles). */
export function angularSeparationDeg(a: Vec3, b: Vec3): number {
  const na = normalize(a);
  const nb = normalize(b);
  const cx = na[1] * nb[2] - na[2] * nb[1];
  const cy = na[2] * nb[0] - na[0] * nb[2];
  const cz = na[0] * nb[1] - na[1] * nb[0];
  return Math.atan2(Math.hypot(cx, cy, cz), dot(na, nb)) * RAD;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
