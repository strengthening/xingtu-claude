/**
 * Sun, Moon and planets as seen by a topocentric observer.
 * Positions are J2000 (EQJ) unit vectors, corrected for light time and
 * aberration, so they share the star field's `eqjToWorld` matrix.
 */
import { Body, Equator, Illumination, MakeTime, type AstroTime } from 'astronomy-engine';
import { RAD, normalize, type Vec3 } from './math';
import type { ObserverLocation } from './observer';
import { toAstroObserver } from './frames';

export type BodyId =
  'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

export const BODY_IDS: readonly BodyId[] = [
  'Sun',
  'Moon',
  'Mercury',
  'Venus',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
];

const KM_PER_AU = 149_597_870.7;

/** Mean radii, km (IAU WGCCRE). */
const RADIUS_KM: Record<BodyId, number> = {
  Sun: 695_700,
  Moon: 1_737.4,
  Mercury: 2_439.7,
  Venus: 6_051.8,
  Mars: 3_389.5,
  Jupiter: 69_911,
  Saturn: 58_232,
  Uranus: 25_362,
  Neptune: 24_622,
};

export interface BodyState {
  id: BodyId;
  /** Topocentric apparent direction, J2000 frame, unit vector. */
  eqj: Vec3;
  /** Topocentric distance, AU. */
  distAu: number;
  /** Visual magnitude. */
  mag: number;
  /** Apparent angular diameter, degrees. */
  diameterDeg: number;
  /** Illuminated fraction of the disc, 0–1 (1 for the Sun). */
  phase: number;
  /** Sun–body–observer angle, degrees (0 = full). */
  phaseAngleDeg: number;
}

export function computeBody(id: BodyId, time: AstroTime, observer: ObserverLocation): BodyState {
  const body = Body[id];
  const eq = Equator(body, time, toAstroObserver(observer), false, true);
  const v = eq.vec;
  const distAu = eq.dist;
  const radiusAu = RADIUS_KM[id] / KM_PER_AU;
  const diameterDeg = 2 * Math.asin(Math.min(1, radiusAu / distAu)) * RAD;
  let mag: number;
  let phase = 1;
  let phaseAngleDeg = 0;
  if (id === 'Sun') {
    mag = -26.74 + 5 * Math.log10(distAu);
  } else {
    const ill = Illumination(body, time);
    mag = ill.mag;
    phase = ill.phase_fraction;
    phaseAngleDeg = ill.phase_angle;
  }
  return { id, eqj: normalize([v.x, v.y, v.z]), distAu, mag, diameterDeg, phase, phaseAngleDeg };
}

export function computeBodies(date: Date | AstroTime, observer: ObserverLocation): BodyState[] {
  const time = MakeTime(date);
  return BODY_IDS.map((id) => computeBody(id, time, observer));
}
