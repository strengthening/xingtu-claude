/**
 * Coordinate conventions.
 *
 * EQJ   J2000 mean equator/equinox. x → (RA 0h, Dec 0), y → (RA 6h, Dec 0), z → north pole.
 * EQD   Same axes but for the true equator/equinox of date.
 * HOR   astronomy-engine horizontal frame: x → north, y → west, z → zenith.
 * WORLD Render frame (Three.js, y-up, right-handed): x → east, y → zenith, z → south.
 *       The camera sits at the origin; default forward (−z) therefore looks north.
 *
 * Everything on the celestial sphere is a unit vector — no physical distances.
 */
import { DEG, RAD, mat3FromRows, type Vec3 } from './math';

/** HOR (N, W, Z) → WORLD (E, Up, S). */
export const HOR_TO_WORLD = mat3FromRows([
  [0, -1, 0], // east  = −west
  [0, 0, 1], //  up    =  zenith
  [-1, 0, 0], // south = −north
]);

export function raDecToVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

export function vectorToRaDec(v: Vec3): { ra: number; dec: number } {
  const [x, y, z] = v;
  let ra = Math.atan2(y, x) * RAD;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.atan2(z, Math.hypot(x, y)) * RAD };
}

export interface AltAz {
  /** Altitude above the horizon, degrees. */
  alt: number;
  /** Azimuth measured from north through east, degrees in [0, 360). */
  az: number;
}

export function worldToAltAz(v: Vec3): AltAz {
  const [x, y, z] = v;
  let az = Math.atan2(x, -z) * RAD;
  if (az < 0) az += 360;
  return { alt: Math.atan2(y, Math.hypot(x, z)) * RAD, az };
}

export function altAzToWorld(altDeg: number, azDeg: number): [number, number, number] {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const c = Math.cos(alt);
  return [c * Math.sin(az), Math.sin(alt), -c * Math.cos(az)];
}
