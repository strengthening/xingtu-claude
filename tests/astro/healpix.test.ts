/**
 * HEALPix nested-scheme maths vs healpy 1.20 (tests/fixtures/healpix-ref.json,
 * generated with healpy.vec2pix / pix2vec / boundaries / query_disc).
 */
import { describe, expect, it } from 'vitest';
import {
  angularSeparationDeg,
  faceXYToVec,
  nestCenter,
  nestCorners,
  nestToXyf,
  queryDisc,
  vecToFaceXY,
  vecToNest,
  xyfToNest,
  type Vec3,
} from '../../src/astro';
import ref from '../fixtures/healpix-ref.json';

const vectors = ref.vectors as unknown as Vec3[];

describe('healpix vs healpy', () => {
  for (const [order, expected] of Object.entries(ref.ang2pix)) {
    it(`vec2pix nest, order ${order}`, () => {
      const got = vectors.map((v) => vecToNest(Number(order), v));
      expect(got).toEqual(expected);
    });
  }

  for (const [order, c] of Object.entries(ref.centers)) {
    it(`pix2vec centres, order ${order}`, () => {
      c.pix.forEach((p, i) => {
        const sep = angularSeparationDeg(nestCenter(Number(order), p), c.vec[i] as unknown as Vec3);
        expect(sep).toBeLessThan(1e-9);
      });
    });
  }

  for (const [order, c] of Object.entries(ref.corners)) {
    it(`corners (N, W, S, E), order ${order}`, () => {
      c.pix.forEach((p, i) => {
        const mine = nestCorners(Number(order), p);
        (c.vec[i] as unknown as Vec3[]).forEach((v, k) => {
          expect(angularSeparationDeg(mine[k] as Vec3, v)).toBeLessThan(1e-9);
        });
      });
    });
  }

  it('query_disc is a superset of healpy exact results and stays tight', () => {
    for (const d of ref.disc) {
      const mine = new Set(queryDisc(d.order, d.vec as unknown as Vec3, d.radius));
      for (const p of d.exact) expect(mine.has(p)).toBe(true);
      expect(mine.size).toBeLessThan(d.exact.length * 2 + 16);
    }
  });

  it('face coordinates round-trip', () => {
    for (const v of vectors.slice(0, 80)) {
      const { face, x, y } = vecToFaceXY(v);
      expect(angularSeparationDeg(faceXYToVec(face, x, y), v)).toBeLessThan(1e-9);
    }
  });

  it('xyf ↔ nest round-trip at a deep order', () => {
    for (const [f, ix, iy] of [
      [0, 0, 0],
      [5, 1234, 4321],
      [11, 8191, 1],
    ] as const) {
      const p = xyfToNest(13, f, ix, iy);
      expect(nestToXyf(13, p)).toEqual({ face: f, ix, iy });
    }
  });
});
