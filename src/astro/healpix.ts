/**
 * HEALPix (Górski et al. 2005), NESTED scheme — just what the star tiles and
 * HiPS surveys need. Face coordinates follow healpix_cxx: within a base pixel
 * (face) x, y ∈ [0, 1]; (0,0) is the south corner, (1,0) east, (1,1) north,
 * (0,1) west. Index arithmetic avoids 32-bit bit operations, so any order up
 * to 24 is exact in doubles. Verified against healpy (tests/astro/healpix.test.ts).
 */
import type { Vec3 } from './math';

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
const HALF_PI = Math.PI / 2;

export interface FaceXY {
  face: number;
  /** Continuous face coordinates in [0, 1]. */
  x: number;
  y: number;
}

export function nside(order: number): number {
  return 2 ** order;
}

export function npix(order: number): number {
  return 12 * 4 ** order;
}

/** Direction (any length) → face + continuous face coordinates. */
export function vecToFaceXY(v: Vec3): FaceXY {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const z = v[2] / len;
  const za = Math.abs(z);
  let tt = Math.atan2(v[1], v[0]) / HALF_PI;
  tt = ((tt % 4) + 4) % 4;
  if (tt >= 4) tt = 0;

  if (za <= 2 / 3) {
    const temp1 = 0.5 + tt;
    const temp2 = 0.75 * z;
    const jp = temp1 - temp2; // ascending edge line index
    const jm = temp1 + temp2; // descending edge line index
    const ifp = Math.floor(jp);
    const ifm = Math.floor(jm);
    const face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    return { face, x: jm - ifm, y: 1 - (jp - ifp) };
  }
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  // sqrt(3(1−|z|)) computed stably near the poles
  const sth = Math.hypot(v[0], v[1]) / len;
  const tmp = za < 0.99 ? Math.sqrt(3 * (1 - za)) : (sth * Math.sqrt(3)) / Math.sqrt(1 + za);
  const jp = Math.min(tp * tmp, 1);
  const jm = Math.min((1 - tp) * tmp, 1);
  return z >= 0 ? { face: ntt, x: 1 - jm, y: 1 - jp } : { face: ntt + 8, x: jp, y: jm };
}

/** Face + continuous face coordinates → unit vector (healpix_cxx xyf2loc). */
export function faceXYToVec(face: number, x: number, y: number): [number, number, number] {
  const jr = (JRLL[face] ?? 0) - x - y;
  let nr: number;
  let z: number;
  let sth: number;
  if (jr < 1) {
    nr = jr;
    const tmp = (nr * nr) / 3;
    z = 1 - tmp;
    sth = Math.sqrt(tmp * (2 - tmp));
  } else if (jr > 3) {
    nr = 4 - jr;
    const tmp = (nr * nr) / 3;
    z = tmp - 1;
    sth = Math.sqrt(tmp * (2 - tmp));
  } else {
    nr = 1;
    z = ((2 - jr) * 2) / 3;
    sth = Math.sqrt((1 - z) * (1 + z));
  }
  let t = (JPLL[face] ?? 0) * nr + x - y;
  if (t < 0) t += 8;
  if (t >= 8) t -= 8;
  const phi = nr < 1e-15 ? 0 : (HALF_PI * 0.5 * t) / nr;
  return [sth * Math.cos(phi), sth * Math.sin(phi), z];
}

function spreadBits(v: number, bits: number): number {
  let r = 0;
  let p = 1;
  for (let i = 0; i < bits; i++) {
    if (Math.floor(v / 2 ** i) % 2 === 1) r += p;
    p *= 4;
  }
  return r;
}

function compressBits(v: number, bits: number): number {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    if (Math.floor(v / 4 ** i) % 2 === 1) r += 2 ** i;
  }
  return r;
}

export function xyfToNest(order: number, face: number, ix: number, iy: number): number {
  return face * 4 ** order + spreadBits(ix, order) + 2 * spreadBits(iy, order);
}

export function nestToXyf(order: number, ipix: number): { face: number; ix: number; iy: number } {
  const per = 4 ** order;
  const face = Math.floor(ipix / per);
  const ipf = ipix - face * per;
  return { face, ix: compressBits(ipf, order), iy: compressBits(Math.floor(ipf / 2), order) };
}

/**
 * Nested pixel index containing a direction (healpix_cxx loc2pix with the same
 * integer tie-breaking, so boundary points agree with healpy exactly).
 */
export function vecToNest(order: number, v: Vec3): number {
  const n = nside(order);
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const z = v[2] / len;
  const za = Math.abs(z);
  let tt = Math.atan2(v[1], v[0]) / HALF_PI;
  tt = ((tt % 4) + 4) % 4;
  if (tt >= 4) tt = 0;

  if (za <= 2 / 3) {
    const temp1 = n * (0.5 + tt);
    const temp2 = n * (z * 0.75);
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / n);
    const ifm = Math.floor(jm / n);
    const face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    const ix = jm % n;
    const iy = n - (jp % n) - 1;
    return xyfToNest(order, face, ix, iy);
  }
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  const sth = Math.hypot(v[0], v[1]) / len;
  const tmp = n * (za < 0.99 ? Math.sqrt(3 * (1 - za)) : (sth * Math.sqrt(3)) / Math.sqrt(1 + za));
  const jp = Math.min(Math.floor(tp * tmp), n - 1);
  const jm = Math.min(Math.floor((1 - tp) * tmp), n - 1);
  return z >= 0 ? xyfToNest(order, ntt, n - jm - 1, n - jp - 1) : xyfToNest(order, ntt + 8, jp, jm);
}

export function nestCenter(order: number, ipix: number): [number, number, number] {
  const { face, ix, iy } = nestToXyf(order, ipix);
  const n = nside(order);
  return faceXYToVec(face, (ix + 0.5) / n, (iy + 0.5) / n);
}

/** Pixel corners in healpy.boundaries order: north, west, south, east. */
export function nestCorners(order: number, ipix: number): [number, number, number][] {
  const { face, ix, iy } = nestToXyf(order, ipix);
  const n = nside(order);
  return [
    faceXYToVec(face, (ix + 1) / n, (iy + 1) / n),
    faceXYToVec(face, ix / n, (iy + 1) / n),
    faceXYToVec(face, ix / n, iy / n),
    faceXYToVec(face, (ix + 1) / n, iy / n),
  ];
}

function angle(a: Vec3, b: Vec3): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/** Conservative angular radius (rad) of a pixel around its centre. */
export function nestRadius(order: number, ipix: number): number {
  const { face, ix, iy } = nestToXyf(order, ipix);
  const n = nside(order);
  const c = faceXYToVec(face, (ix + 0.5) / n, (iy + 0.5) / n);
  let r = 0;
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.5, 0],
    [0.5, 1],
    [0, 0.5],
    [1, 0.5],
  ] as const) {
    r = Math.max(r, angle(c, faceXYToVec(face, (ix + dx) / n, (iy + dy) / n)));
  }
  return r * 1.05; // edges are not great circles; keep a small margin
}

/**
 * Nested pixels at `order` that may intersect the cone (centre, radius).
 * Conservative: never misses a pixel, may include a few extra near the rim.
 */
export function queryDisc(order: number, centre: Vec3, radiusRad: number): number[] {
  const len = Math.hypot(centre[0], centre[1], centre[2]) || 1;
  const c: Vec3 = [centre[0] / len, centre[1] / len, centre[2] / len];
  const out: number[] = [];
  if (radiusRad >= Math.PI) {
    for (let i = 0; i < npix(order); i++) out.push(i);
    return out;
  }
  const visit = (o: number, ipix: number): void => {
    if (angle(c, nestCenter(o, ipix)) > radiusRad + nestRadius(o, ipix)) return;
    if (o === order) {
      out.push(ipix);
      return;
    }
    for (let k = 0; k < 4; k++) visit(o + 1, ipix * 4 + k);
  };
  for (let f = 0; f < 12; f++) visit(0, f);
  return out;
}
