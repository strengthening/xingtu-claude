import { Body, Equator, MakeTime, Observer, SiderealTime } from 'astronomy-engine';
import { DEG } from '../math';
import type { Vec3 } from '../math';
import { EARTH_RADIUS_KM } from './geodesy';

/** Unit vector toward the Sun in the Earth-fixed frame (geocentric, true equator of date). */
export function sunDirectionEcef(date: Date): [number, number, number] {
  const time = MakeTime(date);
  const eq = Equator(Body.Sun, time, new Observer(0, 0, 0), true, false);
  const lon = (eq.ra - SiderealTime(time)) * 15 * DEG;
  const dec = eq.dec * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(dec)];
}

/**
 * Whether a point (ECEF, km) is in sunlight: outside the Earth's shadow,
 * modelled as a cylinder (the umbra/penumbra split is a fraction of a
 * degree at low-orbit heights).
 */
export function isSunlit(p: Vec3, sun: Vec3): boolean {
  const along = p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2];
  if (along >= 0) return true;
  const perp = Math.hypot(p[0] - along * sun[0], p[1] - along * sun[1], p[2] - along * sun[2]);
  return perp > EARTH_RADIUS_KM;
}
