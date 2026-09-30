import { describe, expect, it } from 'vitest';
import { geoToEcef, surfaceDistanceKm } from '../../src/astro/flight';
import {
  MISSIONS,
  computeReplayFrame,
  formatTPlus,
  missionById,
  presetFor,
  vehicleView,
} from '../../src/missions';
import { FLIGHT_14_MODEL, STARSHIP_FLIGHT_14 as M } from '../../src/missions/starship-flight-14';
import { timelinePos, timelineTime } from '../../src/ui/ReplayPanel';

const T = FLIGHT_14_MODEL.times;
const FLIGHT_14_SITE = { latitude: 26.07, longitude: -97.16, elevation: 5 };

function ship(t: number) {
  const s = M.trackAt('ship', t);
  if (!s) throw new Error(`no ship at T+${t}`);
  return s;
}

describe('Starship Flight 14 mission data', () => {
  it('is registered and lifts off at 12:48:59 UTC on 2026-09-28', () => {
    expect(missionById('starship-14')).toBe(M);
    expect(MISSIONS).toContain(M);
    expect(new Date(M.t0Ms).toISOString()).toBe('2026-09-28T12:48:59.000Z');
  });

  it('lists events in time order inside the replay range', () => {
    const ts = M.events.map((e) => e.tPlus);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    for (const t of ts) {
      expect(t).toBeGreaterThanOrEqual(M.start);
      expect(t).toBeLessThanOrEqual(M.end);
    }
    expect(new Set(M.events.map((e) => e.key)).size).toBe(M.events.length);
  });

  it('starts on the pad', () => {
    const p = ship(0);
    expect(surfaceDistanceKm(p, FLIGHT_14_MODEL.pad)).toBeLessThan(0.01);
    expect(p.altKm).toBe(0);
  });

  it('stays between perigee and apogee in orbit, at 30.5° inclination', () => {
    let maxLat = 0;
    for (let t = T.INSERTION; t <= T.DEORBIT; t += 10) {
      const p = ship(t);
      expect(p.altKm).toBeGreaterThanOrEqual(FLIGHT_14_MODEL.perigeeKm - 1e-6);
      expect(p.altKm).toBeLessThanOrEqual(FLIGHT_14_MODEL.apogeeKm + 1e-6);
      maxLat = Math.max(maxLat, Math.abs(p.lat));
    }
    expect(maxLat).toBeCloseTo(30.5, 1);
    expect(FLIGHT_14_MODEL.periodS / 60).toBeGreaterThan(89.5);
    expect(FLIGHT_14_MODEL.periodS / 60).toBeLessThan(90);
  });

  it('moves continuously, never faster than a low orbit allows', () => {
    for (const id of ['ship', 'booster'] as const) {
      const [from, to] = M.lifetime(id);
      let prev = M.trackAt(id, Math.max(from, 0));
      for (let t = Math.max(from, 0) + 1; t <= to; t += 1) {
        const p = M.trackAt(id, t);
        if (!p || !prev) throw new Error(`${id} missing at T+${t}`);
        const a = geoToEcef(prev);
        const b = geoToEcef(p);
        // ground speed in orbit is ~7.3 km/s; leave room for rounding at segment joins
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(8.5);
        prev = p;
      }
    }
  });

  it('splashes the booster down in the Gulf and the ship north of Hawaii', () => {
    const b = M.trackAt('booster', T.BOOSTER_SPLASH);
    expect(b?.altKm).toBe(0);
    expect(b && surfaceDistanceKm(b, FLIGHT_14_MODEL.pad)).toBeGreaterThan(20);
    expect(b && surfaceDistanceKm(b, FLIGHT_14_MODEL.pad)).toBeLessThan(60);
    expect(b?.lon).toBeGreaterThan(-97.2); // offshore, east of the coast

    const s = ship(T.SPLASH);
    expect(s.altKm).toBe(0);
    expect(s.lat).toBeGreaterThan(24);
    expect(s.lat).toBeLessThan(31);
    expect(s.lon).toBeGreaterThan(-165);
    expect(s.lon).toBeLessThan(-154);
  });

  it('deploys all 26 Starlink satellites', () => {
    const sats = (t: number) => M.vehiclesAt(t).filter((v) => v.kind === 'starlink').length;
    expect(sats(T.DEPLOY_START - 1)).toBe(0);
    expect(sats(T.DEPLOY_START)).toBe(1);
    expect(sats(T.DEPLOY_END)).toBe(26);
    expect(sats(M.end)).toBe(26);
  });

  it('shows the stack before hot staging and two vehicles after', () => {
    const ids = (t: number) => M.vehiclesAt(t).map((v) => v.id);
    expect(ids(60)).toEqual(['ship']);
    expect(ids(T.HOT_STAGING + 10)).toEqual(['ship', 'booster']);
    expect(ids(T.SPLASH + 600).filter((i) => i === 'ship' || i === 'booster')).toEqual([]);
  });

  it('lets each observing site see the flight during its window', () => {
    for (const o of M.observers) {
      for (const [a, b] of o.windows) {
        let best = -90;
        for (let t = a; t < b; t += 10) {
          const f = computeReplayFrame(M, M.t0Ms + t * 1000, o);
          const v = vehicleView(f, 'ship') ?? vehicleView(f, 'starlink');
          if (v) best = Math.max(best, v.altDeg);
        }
        expect(best, `${o.id} ${a}–${b}`).toBeGreaterThan(10);
      }
    }
  });

  it('picks a site for every moment of the replay', () => {
    for (let t = M.start; t <= M.end; t += 30) expect(presetFor(M, t)).toBeDefined();
    expect(presetFor(M, 0)?.id).toBe('south-padre');
  });
});

describe('replay helpers', () => {
  it('formats mission time', () => {
    expect(formatTPlus(0)).toBe('T+00:00:00');
    expect(formatTPlus(-30)).toBe('T−00:00:30');
    expect(formatTPlus(3 * 3600 + 8 * 60 + 5.9)).toBe('T+03:08:05');
  });

  it('maps the stretched timeline both ways', () => {
    expect(timelinePos(M, M.start)).toBe(0);
    expect(timelinePos(M, M.end)).toBe(1);
    for (const t of [M.start, 0, 140, 600, 5000, M.end]) {
      expect(timelineTime(M, timelinePos(M, t))).toBeCloseTo(t, 6);
    }
  });

  it('reports ship speed and sunlight in a frame', () => {
    const f = computeReplayFrame(M, M.t0Ms + 3000 * 1000, FLIGHT_14_SITE);
    const v = vehicleView(f, 'ship');
    expect(v?.speedKmh).toBeGreaterThan(25000);
    expect(v?.speedKmh).toBeLessThan(29000);
    expect(f.phase).toBe('部署星链');
  });
});
