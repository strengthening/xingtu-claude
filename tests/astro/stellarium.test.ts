/**
 * Cross-check the astro layer against Stellarium 24.4.
 * See tests/fixtures/stellarium-ref.json for how the reference was produced.
 *
 * Stars go through exactly the path the GPU uses: J2000 unit vector +
 * proper motion + annual aberration (apparent.glsl), then × eqjToWorld.
 * Budget: 0.1° as required; in practice the agreement is at the arc-second level.
 */
import { describe, expect, it } from 'vitest';
import {
  aberrationBeta,
  apparentAltitude,
  altAzToWorld,
  angularSeparationDeg,
  apparentStarDirection,
  yearsSinceJ2000,
  computeBody,
  computeFrames,
  eqjToAltAz,
  mat3MulVec,
  raDecToVector,
  refractionDeg,
  type BodyId,
  type Vec3,
} from '../../src/astro';
import { MakeTime } from 'astronomy-engine';
import ref from '../fixtures/stellarium-ref.json';

const TOLERANCE_DEG = 0.1;
/** Arc-second level agreement once proper motion and aberration are applied. */
const TIGHT_ARCSEC = 5;
const observer = ref.observer;

function azDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

describe('stars vs Stellarium (Shanghai)', () => {
  for (const s of ref.stars) {
    it(`${s.name} @ ${s.utc}: alt/az within ${TOLERANCE_DEG}°`, () => {
      const time = new Date(s.utc);
      const frames = computeFrames(time, observer);
      const v = apparentStarDirection(
        raDecToVector(s.raJ2000, s.decJ2000),
        s.pmRadPerYr as unknown as Vec3,
        yearsSinceJ2000(time),
        aberrationBeta(time),
      );
      const { alt, az } = eqjToAltAz(v, frames);

      // geometric altitude & azimuth
      expect(Math.abs(alt - s.altGeo)).toBeLessThan(TOLERANCE_DEG);
      expect(azDiff(az, s.az) * Math.cos((alt * Math.PI) / 180)).toBeLessThan(TOLERANCE_DEG);

      // full great-circle separation
      const ours = altAzToWorld(alt, az);
      const theirs = altAzToWorld(s.altGeo, s.az);
      const sep = angularSeparationDeg(ours, theirs);
      expect(sep).toBeLessThan(TOLERANCE_DEG);
      expect(sep * 3600).toBeLessThan(TIGHT_ARCSEC);

      // apparent altitude (with refraction) as Stellarium displays it — both
      // astronomy-engine's and our shader's refraction formula
      expect(Math.abs(alt + refractionDeg(alt) - s.alt)).toBeLessThan(TOLERANCE_DEG);
      expect(Math.abs(apparentAltitude(alt) - s.alt) * 3600).toBeLessThan(TIGHT_ARCSEC + 5);
    });
  }

  it('without proper motion and aberration Sirius would be off by ~50″', () => {
    const s = ref.stars[0];
    if (!s) throw new Error('fixture missing');
    const frames = computeFrames(new Date(s.utc), observer);
    const { alt, az } = eqjToAltAz(raDecToVector(s.raJ2000, s.decJ2000), frames);
    const sep = angularSeparationDeg(altAzToWorld(alt, az), altAzToWorld(s.altGeo, s.az)) * 3600;
    expect(sep).toBeGreaterThan(30);
    expect(sep).toBeLessThan(0.1 * 3600);
  });
});

describe('Sun / Moon / planets vs Stellarium', () => {
  for (const b of ref.bodies) {
    it(`${b.id} @ ${b.utc}`, () => {
      const time = MakeTime(new Date(b.utc));
      const frames = computeFrames(time, observer);
      const state = computeBody(b.id as BodyId, time, observer);
      const { alt, az } = eqjToAltAz(state.eqj, frames);
      const sep = angularSeparationDeg(altAzToWorld(alt, az), altAzToWorld(b.altGeo, b.az));
      expect(sep).toBeLessThan(TOLERANCE_DEG);
    });
  }
});

describe('frame matrices', () => {
  it('eqjToWorld is orthonormal', () => {
    const { eqjToWorld: m } = computeFrames(new Date('2026-09-26T14:00:00Z'), observer);
    for (const v of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const) {
      const w = mat3MulVec(m, v);
      expect(Math.hypot(...w)).toBeCloseTo(1, 12);
    }
  });

  it('celestial pole sits at altitude = latitude, due north', () => {
    const frames = computeFrames(new Date('2026-09-26T14:00:00Z'), observer);
    // EQD pole is exact; the J2000 pole differs by precession (~0.15°)
    const pole = mat3MulVec(frames.eqdToWorld, [0, 0, 1]);
    const { alt, az } = eqjToAltAz([0, 0, 1], { ...frames, eqjToWorld: frames.eqdToWorld });
    expect(pole[1]).toBeCloseTo(Math.sin((observer.latitude * Math.PI) / 180), 6);
    expect(alt).toBeCloseTo(observer.latitude, 6);
    expect(azDiff(az, 0)).toBeLessThan(1e-6);
  });

  it('local sidereal time: GMST at J2000.0 epoch ≈ 18.697 h', () => {
    const frames = computeFrames(new Date('2000-01-01T12:00:00Z'), {
      latitude: 0,
      longitude: 0,
      elevation: 0,
    });
    // GAST = GMST + equation of equinoxes (≲ 1.2 s); allow 2 s
    expect(Math.abs(frames.gast - 18.697374558)).toBeLessThan(2 / 3600);
  });
});
