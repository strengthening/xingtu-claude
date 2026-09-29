/**
 * Catalogue place (J2000, epoch 2000.0) → apparent direction at a date:
 *   1. space motion: linear proper-motion propagation on the tangent plane
 *   2. annual aberration: Earth's barycentric velocity / c
 * Precession, nutation and Earth rotation are applied afterwards by the
 * EQJ → horizontal rotation matrix. Mirrored in render/shaders/apparent.glsl.
 */
import { BaryState, Body, C_AUDAY, MakeTime, type AstroTime } from 'astronomy-engine';
import { normalize, type Vec3 } from './math';

/** Julian years (TT) since J2000.0, the catalogue epoch. */
export function yearsSinceJ2000(time: AstroTime | Date): number {
  return MakeTime(time).tt / 365.25;
}

/** Earth's barycentric velocity in units of c, J2000 equatorial frame (|β| ≈ 1e-4). */
export function aberrationBeta(time: AstroTime | Date): [number, number, number] {
  const s = BaryState(Body.Earth, MakeTime(time));
  return [s.vx / C_AUDAY, s.vy / C_AUDAY, s.vz / C_AUDAY];
}

/** Direction corrected for proper motion only (mean place of date, J2000 axes). */
export function propagateProperMotion(p0: Vec3, pm: Vec3, years: number): [number, number, number] {
  return normalize([p0[0] + pm[0] * years, p0[1] + pm[1] * years, p0[2] + pm[2] * years]);
}

/**
 * Apparent direction (J2000 axes) of a star: proper motion + first-order
 * annual aberration (u' ∝ u + β; the second-order term is < 0.01″).
 */
export function apparentStarDirection(
  p0: Vec3,
  pm: Vec3,
  years: number,
  beta: Vec3,
): [number, number, number] {
  const p = propagateProperMotion(p0, pm, years);
  return normalize([p[0] + beta[0], p[1] + beta[1], p[2] + beta[2]]);
}
