/**
 * Geometry for HiPS tiles: a HiPS tile of order k is the nested HEALPix pixel
 * of order k, and its image pixels are the order k+m sub-pixels. Orientation
 * (JPEG/PNG, first row at the top) — as used by the hips reference reader
 * (hipspy `tile_corner_pixel_coordinates`): image column ↔ face y, image row
 * ↔ face x. Hence, with texture flipY = false:  u = local y,  v = local x.
 */
import { Rotation_GAL_EQJ } from 'astronomy-engine';
import { rotationToMat3 } from './frames';
import { faceXYToVec, nestToXyf, nside } from './healpix';
import { DEG, mat3MulVec, type Mat3 } from './math';

export interface TileMesh {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Galactic → J2000 equatorial (IAU 1958 definition via astronomy-engine). */
export const GAL_TO_EQJ: Mat3 = rotationToMat3(Rotation_GAL_EQJ());

/**
 * Subdivided quad patch for one tile.
 * @param toEqj rotation from the survey frame to J2000 (undefined = identity)
 * @param uvRect sub-rectangle of the texture holding this tile ([u0, v0, size u, size v])
 */
export function tileMesh(
  order: number,
  ipix: number,
  subdiv: number,
  toEqj?: Mat3,
  uvRect: readonly [number, number, number, number] = [0, 0, 1, 1],
): TileMesh {
  const { face, ix, iy } = nestToXyf(order, ipix);
  const n = nside(order);
  const s = subdiv;
  const positions = new Float32Array((s + 1) * (s + 1) * 3);
  const uvs = new Float32Array((s + 1) * (s + 1) * 2);
  let p = 0;
  let q = 0;
  for (let i = 0; i <= s; i++) {
    const fx = i / s; // along face x  → texture v (rows)
    for (let j = 0; j <= s; j++) {
      const fy = j / s; // along face y → texture u (columns)
      let v = faceXYToVec(face, (ix + fx) / n, (iy + fy) / n);
      if (toEqj) v = mat3MulVec(toEqj, v);
      positions[p++] = v[0];
      positions[p++] = v[1];
      positions[p++] = v[2];
      uvs[q++] = uvRect[0] + fy * uvRect[2];
      uvs[q++] = uvRect[1] + fx * uvRect[3];
    }
  }
  const indices = new Uint32Array(s * s * 6);
  let k = 0;
  for (let i = 0; i < s; i++) {
    for (let j = 0; j < s; j++) {
      const a = i * (s + 1) + j;
      const b = a + 1;
      const c = a + (s + 1);
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  return { positions, uvs, indices };
}

/** Texture sub-rectangle of tile `ipix` inside an order-3 Allsky mosaic (half-texel inset). */
export function allskyRect(
  ipix: number,
  width: number,
  height: number,
  columns = 27,
): [number, number, number, number] {
  const tile = width / columns;
  const col = ipix % columns;
  const row = Math.floor(ipix / columns);
  const inset = 0.5;
  return [
    (col * tile + inset) / width,
    (row * tile + inset) / height,
    (tile - 2 * inset) / width,
    (tile - 2 * inset) / height,
  ];
}

/** Mean angular size of a tile's side at an order (rad). */
export function tileAngle(order: number): number {
  return Math.sqrt((4 * Math.PI) / 12) / 2 ** order;
}

/**
 * Lowest tile order whose texels are no coarser than `pixelAngle` (rad per
 * device pixel) × `slack`, clamped to what the survey provides.
 */
export function hipsOrderFor(
  pixelAngle: number,
  tileWidth: number,
  minOrder: number,
  maxOrder: number,
  slack = 1.25,
): number {
  const k = Math.ceil(Math.log2(tileAngle(0) / tileWidth / (pixelAngle * slack)));
  return Math.min(maxOrder, Math.max(minOrder, k));
}

/** Tile subdivision so edges stay smooth under stereographic projection (~2° per quad). */
export function subdivFor(order: number): number {
  return Math.max(2, Math.min(16, Math.ceil(tileAngle(order) / (2 * DEG))));
}
