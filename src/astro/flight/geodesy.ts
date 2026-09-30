/**
 * Earth-fixed geometry for vehicles near the Earth (rockets, low orbits).
 *
 * The Earth is a sphere of mean radius here: flight tracks are approximate
 * reconstructions anyway, and using the same sphere for the observer and the
 * vehicle keeps a rocket on its pad exactly where the pad is (a geodetic /
 * geocentric mix would shift it by up to ~20 km).
 *
 * ECEF: x → (0°N, 0°E), y → (0°N, 90°E), z → north pole; kilometres.
 */
import { DEG, RAD, type Vec3 } from '../math';
import type { ObserverLocation } from '../observer';

export const EARTH_RADIUS_KM = 6371.0;
/** Sidereal rotation rate, rad/s. */
export const EARTH_ROTATION_RAD_S = 7.292_115_9e-5;
/** GM of the Earth, km³/s². */
export const EARTH_MU = 398_600.4418;

export interface GeoPoint {
  /** Latitude, degrees north. */
  lat: number;
  /** Longitude, degrees east in (−180, 180]. */
  lon: number;
  /** Height above the (spherical) surface, km. */
  altKm: number;
}

export function wrapLon(lon: number): number {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return l === -180 ? 180 : l;
}

export function geoToEcef(p: GeoPoint): [number, number, number] {
  const r = EARTH_RADIUS_KM + p.altKm;
  const la = p.lat * DEG;
  const lo = p.lon * DEG;
  const c = Math.cos(la);
  return [r * c * Math.cos(lo), r * c * Math.sin(lo), r * Math.sin(la)];
}

export function ecefToGeo(v: Vec3): GeoPoint {
  const r = Math.hypot(v[0], v[1], v[2]);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * RAD,
    lon: Math.atan2(v[1], v[0]) * RAD,
    altKm: r - EARTH_RADIUS_KM,
  };
}

/** Point reached going `distKm` along a great circle from (lat, lon) with initial bearing `azDeg`. */
export function destination(
  lat: number,
  lon: number,
  azDeg: number,
  distKm: number,
): { lat: number; lon: number } {
  const a = distKm / EARTH_RADIUS_KM;
  const la = lat * DEG;
  const az = azDeg * DEG;
  const la2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(az));
  const dLon = Math.atan2(
    Math.sin(az) * Math.sin(a) * Math.cos(la),
    Math.cos(a) - Math.sin(la) * Math.sin(la2),
  );
  return { lat: la2 * RAD, lon: wrapLon(lon + dLon * RAD) };
}

/** Initial great-circle bearing from a to b, degrees in [0, 360). */
export function bearingDeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const la1 = a.lat * DEG;
  const la2 = b.lat * DEG;
  const dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return (((Math.atan2(y, x) * RAD) % 360) + 360) % 360;
}

/** Great-circle distance along the surface, km. */
export function surfaceDistanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const la1 = a.lat * DEG;
  const la2 = b.lat * DEG;
  const s =
    Math.sin((la2 - la1) / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(((b.lon - a.lon) * DEG) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function observerEcef(o: ObserverLocation): [number, number, number] {
  return geoToEcef({ lat: o.latitude, lon: o.longitude, altKm: o.elevation / 1000 });
}

/**
 * Line of sight from an observer to an Earth-fixed point, in the render WORLD
 * frame (x → east, y → zenith, z → south; see coords.ts), unit length.
 */
export function lookDirection(
  o: ObserverLocation,
  target: Vec3,
): {
  world: [number, number, number];
  rangeKm: number;
} {
  const p = observerEcef(o);
  const dx = target[0] - p[0];
  const dy = target[1] - p[1];
  const dz = target[2] - p[2];
  const la = o.latitude * DEG;
  const lo = o.longitude * DEG;
  const sla = Math.sin(la);
  const cla = Math.cos(la);
  const slo = Math.sin(lo);
  const clo = Math.cos(lo);
  const e = -slo * dx + clo * dy;
  const n = -sla * clo * dx - sla * slo * dy + cla * dz;
  const u = cla * clo * dx + cla * slo * dy + sla * dz;
  const rangeKm = Math.hypot(e, n, u);
  const k = rangeKm > 0 ? 1 / rangeKm : 0;
  return { world: [e * k, u * k, -n * k], rangeKm };
}
