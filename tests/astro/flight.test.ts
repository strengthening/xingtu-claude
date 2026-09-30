import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  Pchip,
  bearingDeg,
  destination,
  ecefToGeo,
  geoToEcef,
  isSunlit,
  lookDirection,
  orbitalPeriod,
  surfaceDistanceKm,
} from '../../src/astro/flight';
import { worldToAltAz } from '../../src/astro';

describe('geodesy', () => {
  it('round-trips geographic ↔ Earth-fixed coordinates', () => {
    for (const p of [
      { lat: 25.9969, lon: -97.1572, altKm: 0 },
      { lat: -30.5, lon: 179.9, altKm: 275 },
      { lat: 89.9, lon: 12, altKm: 0.004 },
    ]) {
      const q = ecefToGeo(geoToEcef(p));
      expect(q.lat).toBeCloseTo(p.lat, 9);
      expect(q.lon).toBeCloseTo(p.lon, 9);
      expect(Math.abs(q.altKm - p.altKm)).toBeLessThan(1e-6); // < 1 mm
    }
  });

  it('follows great circles', () => {
    const a = { lat: 26, lon: -97 };
    const b = destination(a.lat, a.lon, 106.5, 1500);
    expect(surfaceDistanceKm(a, b)).toBeCloseTo(1500, 6);
    expect(bearingDeg(a, b)).toBeCloseTo(106.5, 6);
    // a quarter of the way round the equator
    const q = destination(0, 0, 90, (Math.PI / 2) * EARTH_RADIUS_KM);
    expect(q.lat).toBeCloseTo(0, 9);
    expect(q.lon).toBeCloseTo(90, 9);
  });

  it('looks straight up at a point overhead, and at the horizon toward a distant one', () => {
    const o = { latitude: 26.07, longitude: -97.16, elevation: 5 };
    const up = lookDirection(o, geoToEcef({ lat: 26.07, lon: -97.16, altKm: 100 }));
    expect(worldToAltAz(up.world).alt).toBeCloseTo(90, 6);
    expect(up.rangeKm).toBeCloseTo(99.995, 6);
    // due east on the ground, far away: just below the horizon, azimuth ≈ 90°
    const e = destination(o.latitude, o.longitude, 90, 300);
    const east = lookDirection(o, geoToEcef({ ...e, altKm: 0 }));
    const h = worldToAltAz(east.world);
    expect(h.alt).toBeLessThan(0);
    expect(h.alt).toBeGreaterThan(-2);
    expect(h.az).toBeCloseTo(90, 0);
  });
});

describe('monotone interpolation', () => {
  it('passes through its key points without overshoot', () => {
    const f = new Pchip([
      [0, 0],
      [10, 1],
      [20, 1],
      [30, 5],
    ]);
    expect(f.at(10)).toBeCloseTo(1, 12);
    expect(f.at(-5)).toBe(0);
    expect(f.at(99)).toBe(5);
    for (let x = 10; x <= 20; x += 0.5) expect(f.at(x)).toBeCloseTo(1, 12); // flat stays flat
    for (let x = 0; x < 30; x += 0.25)
      expect(f.at(x + 0.25)).toBeGreaterThanOrEqual(f.at(x) - 1e-12);
  });
});

describe('orbits and sunlight', () => {
  it('has the right period for a 262 × 275 km orbit', () => {
    expect(orbitalPeriod(262, 275) / 60).toBeCloseTo(89.7, 1);
  });

  it('puts the night side of low orbit in shadow', () => {
    const sun: [number, number, number] = [1, 0, 0];
    expect(isSunlit([-(EARTH_RADIUS_KM + 270), 0, 0], sun)).toBe(false);
    expect(isSunlit([EARTH_RADIUS_KM + 270, 0, 0], sun)).toBe(true);
    // over the terminator
    expect(isSunlit([-100, EARTH_RADIUS_KM + 270, 0], sun)).toBe(true);
  });
});
