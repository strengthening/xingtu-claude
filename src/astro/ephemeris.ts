/**
 * Read-outs for the info card: coordinates of date, proper-motion components,
 * rise / transit / set. Pure (no rendering), unit-tested.
 */
import {
  Body,
  Constellation,
  DefineStar,
  MakeTime,
  MoonPhase,
  Rotation_EQJ_EQD,
  SearchHourAngle,
  SearchRiseSet,
  type AstroTime,
} from 'astronomy-engine';
import type { BodyId } from './bodies';
import { vectorToRaDec } from './coords';
import { rotationToMat3, toAstroObserver } from './frames';
import { RAD, mat3MulVec, type Vec3 } from './math';
import type { ObserverLocation } from './observer';

/** J2000 direction → RA/Dec of date (true equator & equinox), degrees. */
export function raDecOfDate(eqj: Vec3, time: AstroTime | Date): { ra: number; dec: number } {
  return vectorToRaDec(mat3MulVec(rotationToMat3(Rotation_EQJ_EQD(MakeTime(time))), eqj));
}

/** Proper-motion vector (rad/yr) at unit position p → μα* (= μα cos δ) and μδ in mas/yr. */
export function properMotionComponents(p: Vec3, pm: Vec3): { pmRa: number; pmDec: number } {
  const ra = Math.atan2(p[1], p[0]);
  const dec = Math.asin(Math.max(-1, Math.min(1, p[2])));
  const eRa: Vec3 = [-Math.sin(ra), Math.cos(ra), 0];
  const eDec: Vec3 = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  const toMas = RAD * 3600 * 1000;
  return {
    pmRa: (pm[0] * eRa[0] + pm[1] * eRa[1] + pm[2] * eRa[2]) * toMas,
    pmDec: (pm[0] * eDec[0] + pm[1] * eDec[1] + pm[2] * eDec[2]) * toMas,
  };
}

export interface RiseTransitSet {
  rise: Date | null;
  transit: Date | null;
  /** Altitude at transit, degrees. */
  transitAlt: number | null;
  set: Date | null;
  /** 'up' = circumpolar, 'down' = never rises (within the next day). */
  kind: 'normal' | 'up' | 'down';
}

function events(body: Body, observer: ObserverLocation, from: Date): RiseTransitSet {
  const obs = toAstroObserver(observer);
  const start = MakeTime(from).AddDays(-0.5); // include events of the current night
  const rise = SearchRiseSet(body, obs, +1, start, 1.2);
  const set = SearchRiseSet(body, obs, -1, start, 1.2);
  const tr = SearchHourAngle(body, obs, 0, start, +1);
  const transitAlt = tr.hor.altitude;
  let kind: RiseTransitSet['kind'] = 'normal';
  if (!rise && !set) kind = transitAlt > 0 ? 'up' : 'down';
  return {
    rise: rise?.date ?? null,
    transit: tr.time.date,
    transitAlt,
    set: set?.date ?? null,
    kind,
  };
}

export function bodyRiseTransitSet(
  id: BodyId,
  observer: ObserverLocation,
  from: Date,
): RiseTransitSet {
  return events(Body[id], observer, from);
}

/** Rise / transit / set of a star given its J2000 direction and distance (pc, NaN = far). */
export function starRiseTransitSet(
  eqj: Vec3,
  distPc: number,
  observer: ObserverLocation,
  from: Date,
): RiseTransitSet {
  const { ra, dec } = vectorToRaDec(eqj);
  const ly = Number.isFinite(distPc) && distPc > 0 ? distPc * 3.26156 : 1e6;
  DefineStar(Body.Star1, ra / 15, dec, Math.max(ly, 1));
  return events(Body.Star1, observer, from);
}

/** Moon phase name from the Sun–Moon ecliptic longitude difference. */
export function moonPhaseName(date: Date): string {
  const a = MoonPhase(date); // 0 new, 90 first quarter, 180 full, 270 last quarter
  if (a < 11.25 || a >= 348.75) return '新月';
  if (a < 78.75) return '蛾眉月';
  if (a < 101.25) return '上弦月';
  if (a < 168.75) return '盈凸月';
  if (a < 191.25) return '满月';
  if (a < 258.75) return '亏凸月';
  if (a < 281.25) return '下弦月';
  return '残月';
}

/** IAU constellation containing a J2000 direction: abbreviation and Latin name. */
export function constellationOf(eqj: Vec3): { symbol: string; name: string } {
  const { ra, dec } = vectorToRaDec(eqj);
  const c = Constellation(ra / 15, dec);
  return { symbol: c.symbol, name: c.name };
}
