/**
 * Approximate vehicle trajectories from sparse public data (webcast
 * telemetry, orbit apsides, splashdown areas). Times are seconds from
 * lift-off (T+); positions are Earth-fixed.
 *
 * Two kinds of segment:
 * - GroundTrack: a great circle over the ground from a launch site, with
 *   downrange distance and altitude interpolated through key points. Right
 *   for ascent and booster return, where Earth rotation is part of the motion.
 * - InPlaneTrack: motion in a fixed inertial orbit plane (with J2 nodal drift),
 *   the Earth turning underneath. Right from engine cutoff to splashdown.
 */
import { DEG, RAD } from '../math';
import {
  EARTH_MU,
  EARTH_RADIUS_KM,
  EARTH_ROTATION_RAD_S,
  bearingDeg,
  destination,
  wrapLon,
  type GeoPoint,
} from './geodesy';
import { Pchip } from './interp';

export type Keys = readonly (readonly [t: number, value: number])[];

/** Circular orbital speed at an altitude, km/s. */
export function circularSpeed(altKm: number): number {
  return Math.sqrt(EARTH_MU / (EARTH_RADIUS_KM + altKm));
}

/** Two-body period of an orbit with these apsis altitudes, seconds. */
export function orbitalPeriod(perigeeKm: number, apogeeKm: number): number {
  const a = EARTH_RADIUS_KM + (perigeeKm + apogeeKm) / 2;
  return 2 * Math.PI * Math.sqrt(a ** 3 / EARTH_MU);
}

/** Great-circle path over the ground from a launch site. */
export class GroundTrack {
  private readonly downrange: Pchip;
  private readonly altitude: Pchip;

  constructor(
    readonly origin: { lat: number; lon: number },
    readonly azimuthDeg: number,
    downrangeKm: Keys,
    altitudeKm: Keys,
  ) {
    this.downrange = new Pchip(downrangeKm);
    this.altitude = new Pchip(altitudeKm);
  }

  get start(): number {
    return Math.min(this.downrange.first, this.altitude.first);
  }

  get end(): number {
    return Math.max(this.downrange.last, this.altitude.last);
  }

  positionAt(t: number): GeoPoint {
    const p = destination(this.origin.lat, this.origin.lon, this.azimuthDeg, this.downrange.at(t));
    return { lat: p.lat, lon: p.lon, altKm: Math.max(0, this.altitude.at(t)) };
  }
}

export interface InPlaneSpec {
  /** Where the segment starts (Earth-fixed) and when. */
  start: { t: number; lat: number; lon: number };
  end: number;
  inclinationDeg: number;
  /** Moving south at the start (descending node side of the orbit). */
  descending: boolean;
  /** Altitude above the surface, km, as a function of T+. */
  altitudeKm: (t: number) => number;
  /** Inertial speed along the track, km/s; defaults to circular speed at the altitude. */
  speedKmS?: (t: number) => number;
  /** Integration step, s. */
  step?: number;
}

/**
 * Motion in an inertial orbit plane. The argument of latitude is integrated
 * from the along-track speed once, at construction; the Earth's rotation
 * (relative to lift-off) turns the inertial longitude into a ground longitude.
 */
export class InPlaneTrack {
  readonly start: number;
  readonly end: number;
  private readonly step: number;
  private readonly u: Float64Array;
  private readonly node0: number;
  private readonly nodeRate: number;
  private readonly inc: number;
  private readonly altitude: (t: number) => number;

  constructor(spec: InPlaneSpec) {
    this.start = spec.start.t;
    this.end = spec.end;
    this.step = spec.step ?? 1;
    this.altitude = spec.altitudeKm;
    this.inc = spec.inclinationDeg * DEG;
    const speed = spec.speedKmS ?? ((t: number) => circularSpeed(this.altitude(t)));

    const sinLat = Math.sin(spec.start.lat * DEG);
    const s = Math.max(-1, Math.min(1, sinLat / Math.sin(this.inc)));
    const u0 = spec.descending ? Math.PI - Math.asin(s) : Math.asin(s);
    // inertial longitude of the start point (the Earth has turned since lift-off)
    const lonI = spec.start.lon * DEG + EARTH_ROTATION_RAD_S * spec.start.t;
    this.node0 = lonI - Math.atan2(Math.sin(u0) * Math.cos(this.inc), Math.cos(u0));
    // J2 regression of the node for a near-circular orbit at the mean altitude
    const a = EARTH_RADIUS_KM + this.altitude((this.start + this.end) / 2);
    const n = Math.sqrt(EARTH_MU / a ** 3);
    this.nodeRate = -1.5 * n * 1.082_63e-3 * (6378.137 / a) ** 2 * Math.cos(this.inc);

    const count = Math.ceil((this.end - this.start) / this.step) + 1;
    this.u = new Float64Array(count);
    this.u[0] = u0;
    for (let i = 1; i < count; i++) {
      // midpoint rule: speed and radius at the middle of the step
      const tm = this.start + (i - 0.5) * this.step;
      const r = EARTH_RADIUS_KM + this.altitude(tm);
      this.u[i] = (this.u[i - 1] ?? 0) + (speed(tm) / r) * this.step;
    }
  }

  /** Argument of latitude at t, radians (clamped to the segment). */
  angleAt(t: number): number {
    const x = (Math.min(Math.max(t, this.start), this.end) - this.start) / this.step;
    const i = Math.min(Math.floor(x), this.u.length - 2);
    const f = x - i;
    const a = this.u[i] ?? 0;
    const b = this.u[i + 1] ?? a;
    return a + (b - a) * f;
  }

  /**
   * Position at t; `aheadKm` shifts it along the track (satellites drifting
   * away from the ship that released them).
   */
  positionAt(t: number, aheadKm = 0, altitudeKm?: number): GeoPoint {
    const tc = Math.min(Math.max(t, this.start), this.end);
    const alt = altitudeKm ?? this.altitude(tc);
    const u = this.angleAt(tc) + aheadKm / (EARTH_RADIUS_KM + alt);
    const node = this.node0 + this.nodeRate * (tc - this.start);
    const x = Math.cos(u);
    const y = Math.sin(u) * Math.cos(this.inc);
    const z = Math.sin(u) * Math.sin(this.inc);
    const lonI = node + Math.atan2(y, x);
    const lon = lonI - EARTH_ROTATION_RAD_S * tc;
    return {
      lat: Math.asin(Math.max(-1, Math.min(1, z))) * RAD,
      lon: wrapLon(lon * RAD),
      altKm: Math.max(0, alt),
    };
  }
}

/**
 * Launch azimuth whose great circle, `downrangeKm` from the site, heads the
 * way an orbit of this inclination does at that latitude, so the ascent
 * flows into the orbit plane without a kink.
 */
export function launchAzimuthFor(
  site: { lat: number; lon: number },
  downrangeKm: number,
  inclinationDeg: number,
  descending: boolean,
): number {
  const inc = inclinationDeg * DEG;
  const headingAt = (az: number): { heading: number; target: number } => {
    const end = destination(site.lat, site.lon, az, downrangeKm);
    // bearing at the end = reverse bearing from the end back to the site, turned around
    const back = bearingDeg(end, site);
    const heading = (back + 180) % 360;
    const ratio = Math.min(1, Math.cos(inc) / Math.cos(end.lat * DEG));
    const east = Math.asin(ratio) * RAD; // heading of the orbit, from north
    return { heading, target: descending ? 180 - east : east };
  };
  let lo = descending ? 90 : 0;
  let hi = descending ? 180 : 90;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const { heading, target } = headingAt(mid);
    if (heading > target) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
