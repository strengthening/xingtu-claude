/**
 * Per-frame orientation matrices. This is the only per-frame astronomy work
 * the star field needs: the GPU applies `eqjToWorld` to every star vertex.
 */
import {
  MakeTime,
  Observer,
  Refraction,
  Rotation_EQD_HOR,
  Rotation_EQJ_HOR,
  SiderealTime,
  type AstroTime,
  type RotationMatrix,
} from 'astronomy-engine';
import { HOR_TO_WORLD, worldToAltAz, type AltAz } from './coords';
import { mat3, mat3Mul, mat3MulVec, type Mat3, type Vec3 } from './math';
import type { ObserverLocation } from './observer';

export interface SkyFrames {
  time: AstroTime;
  /** J2000 equatorial → render world. Includes precession + nutation + Earth rotation. */
  eqjToWorld: Mat3;
  /** Equator-of-date → render world (for the equatorial grid). */
  eqdToWorld: Mat3;
  /** Greenwich apparent sidereal time, hours. */
  gast: number;
  /** Local apparent sidereal time, hours in [0, 24). */
  last: number;
}

export function toAstroObserver(o: ObserverLocation): Observer {
  return new Observer(o.latitude, o.longitude, o.elevation);
}

/**
 * astronomy-engine stores `rot[i][j]` such that out_j = Σ_i rot[i][j]·in_i,
 * i.e. `rot[i]` is column i. Flattening row-by-row therefore yields column-major.
 */
export function rotationToMat3(r: RotationMatrix): Mat3 {
  const m = mat3();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = r.rot[i]?.[j] ?? 0;
  return m;
}

export function computeFrames(date: Date | AstroTime, observer: ObserverLocation): SkyFrames {
  const time = MakeTime(date);
  const obs = toAstroObserver(observer);
  const eqjToWorld = mat3Mul(HOR_TO_WORLD, rotationToMat3(Rotation_EQJ_HOR(time, obs)));
  const eqdToWorld = mat3Mul(HOR_TO_WORLD, rotationToMat3(Rotation_EQD_HOR(time, obs)));
  const gast = SiderealTime(time);
  const last = (((gast + observer.longitude / 15) % 24) + 24) % 24;
  return { time, eqjToWorld, eqdToWorld, gast, last };
}

/** Geometric (airless) horizontal coordinates of a J2000 unit vector. */
export function eqjToAltAz(v: Vec3, frames: SkyFrames): AltAz {
  return worldToAltAz(mat3MulVec(frames.eqjToWorld, v));
}

/** Atmospheric refraction lift in degrees for a geometric altitude (standard conditions). */
export function refractionDeg(geometricAltDeg: number): number {
  return Refraction('normal', geometricAltDeg);
}
