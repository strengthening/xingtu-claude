import { describe, expect, it } from 'vitest';
import {
  GAL_TO_EQJ,
  allskyRect,
  angularSeparationDeg,
  hipsOrderFor,
  mat3MulVec,
  nestCorners,
  raDecToVector,
  tileMesh,
  type Vec3,
} from '../../src/astro';

const DEG = Math.PI / 180;

describe('HiPS tile geometry', () => {
  it('texture corners follow the HiPS convention (N bottom-right, W top-right, S top-left, E bottom-left)', () => {
    // hipspy tile_corner_pixel_coordinates (JPEG, rows top-down):
    //   north → (col w, row w), west → (col w, row 0), south → (0, 0), east → (0, row w)
    const order = 3;
    const ipix = 200;
    const m = tileMesh(order, ipix, 1);
    const [N, W, S, E] = nestCorners(order, ipix) as unknown as [Vec3, Vec3, Vec3, Vec3];
    const vertex = (k: number): Vec3 => [
      m.positions[k * 3] ?? 0,
      m.positions[k * 3 + 1] ?? 0,
      m.positions[k * 3 + 2] ?? 0,
    ];
    const uv = (k: number) => [m.uvs[k * 2], m.uvs[k * 2 + 1]];
    const expectations: [Vec3, number[]][] = [
      [N, [1, 1]],
      [W, [1, 0]],
      [S, [0, 0]],
      [E, [0, 1]],
    ];
    for (const [corner, expected] of expectations) {
      const k = [0, 1, 2, 3].find((i) => angularSeparationDeg(vertex(i), corner) < 1e-4);
      expect(k).toBeDefined();
      expect(uv(k ?? 0)).toEqual(expected);
    }
  });

  it('galactic → J2000: galactic centre and north galactic pole', () => {
    const gc = mat3MulVec(GAL_TO_EQJ, [1, 0, 0]);
    expect(angularSeparationDeg(gc, raDecToVector(266.40499, -28.93617))).toBeLessThan(0.01);
    const ngp = mat3MulVec(GAL_TO_EQJ, [0, 0, 1]);
    expect(angularSeparationDeg(ngp, raDecToVector(192.85948, 27.12825))).toBeLessThan(0.01);
  });

  it('Allsky mosaic rectangles', () => {
    const r = allskyRect(28, 1728, 1856);
    expect(r[0]).toBeCloseTo((64 + 0.5) / 1728, 12); // column 1
    expect(r[1]).toBeCloseTo((64 + 0.5) / 1856, 12); // row 1
  });

  it('order choice matches texel size to screen pixels', () => {
    // 70° over 900 px ≈ 4.7′/px → order 3 tiles (0.86′ texels) not needed; allsky-level order 3 min
    expect(hipsOrderFor((70 * DEG) / 900, 512, 3, 9)).toBe(3);
    // 1° over 900 px ≈ 4″/px → order 7 (3.2″ texels)
    expect(hipsOrderFor((1 * DEG) / 900, 512, 3, 9)).toBe(7);
    expect(hipsOrderFor((0.05 * DEG) / 900, 512, 3, 4)).toBe(4);
  });
});
