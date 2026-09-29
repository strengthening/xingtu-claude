import { describe, expect, it } from 'vitest';
import {
  HOR_TO_WORLD,
  altAzToWorld,
  mat3MulVec,
  raDecToVector,
  vectorToRaDec,
  worldToAltAz,
} from '../../src/astro';

describe('ra/dec ↔ vector', () => {
  it('round-trips', () => {
    for (const [ra, dec] of [
      [0, 0],
      [101.287215, -16.716116],
      [279.2346, 38.783692],
      [359.9, -89.5],
    ] as const) {
      const r = vectorToRaDec(raDecToVector(ra, dec));
      expect(r.ra).toBeCloseTo(ra, 9);
      expect(r.dec).toBeCloseTo(dec, 9);
    }
  });

  it('axes: x→RA 0h, y→RA 6h, z→north pole', () => {
    expect(raDecToVector(0, 0)[0]).toBeCloseTo(1);
    expect(raDecToVector(90, 0)[1]).toBeCloseTo(1);
    expect(raDecToVector(0, 90)[2]).toBeCloseTo(1);
  });
});

describe('world frame', () => {
  it('HOR (N,W,Z) maps to world (−z, −x, +y)', () => {
    const close = (a: readonly number[], b: readonly number[]) =>
      a.forEach((x, i) => expect(x).toBeCloseTo(b[i] ?? NaN, 12));
    close(mat3MulVec(HOR_TO_WORLD, [1, 0, 0]), [0, 0, -1]);
    close(mat3MulVec(HOR_TO_WORLD, [0, 1, 0]), [-1, 0, 0]);
    close(mat3MulVec(HOR_TO_WORLD, [0, 0, 1]), [0, 1, 0]);
  });

  it('alt/az round-trips and cardinal points land where expected', () => {
    const east = altAzToWorld(0, 90);
    expect(east[0]).toBeCloseTo(1);
    const south = altAzToWorld(0, 180);
    expect(south[2]).toBeCloseTo(1);
    const r = worldToAltAz(altAzToWorld(37.5, 222.25));
    expect(r.alt).toBeCloseTo(37.5, 9);
    expect(r.az).toBeCloseTo(222.25, 9);
  });
});
