/**
 * Atmosphere: refraction, extinction and moonlight sky brightness.
 * Mirrored in render/shaders/atmosphere.glsl — keep the formulas identical.
 */
import { DEG, clamp } from './math';

/** Default V-band extinction coefficient (mag per airmass) for a typical low-altitude city site. */
export const EXTINCTION_K = 0.2;

/** Relative airmass, Kasten & Young (1989); `altDeg` is the true altitude. */
export function airmass(altDeg: number): number {
  const z = 90 - Math.max(altDeg, -1);
  return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

/** Magnitudes lost to extinction at an altitude. */
export function extinctionMag(altDeg: number, k = EXTINCTION_K): number {
  return k * airmass(altDeg);
}

/**
 * Refraction lift (degrees) for a true (airless) altitude, Sæmundsson (1986),
 * standard 1010 hPa / 10 °C, faded to zero between −1.9° and −5° (objects
 * that far below the horizon are hidden anyway).
 */
export function refractionForTrueAltitude(altDeg: number): number {
  if (altDeg < -5) return 0;
  const h = Math.max(altDeg, -1.9);
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
  return altDeg < -1.9 ? (r * (altDeg + 5)) / 3.1 : r;
}

// ---- sky brightness -------------------------------------------------------

/** Dark-sky zenith brightness, nanolamberts (≈ 21.5 mag/arcsec² V). */
export const DARK_SKY_NL = 85.6;

export function nanolambertsToMagArcsec2(nl: number): number {
  return (20.7233 - Math.log(nl / 34.08)) / 0.92104;
}

/**
 * Naked-eye limiting magnitude for a sky surface brightness (mag/arcsec²),
 * the widely used fit NELM = 7.93 − 5 log10(10^(4.316 − S/5) + 1).
 */
export function nakedEyeLimit(sqm: number): number {
  return 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1);
}

/** Magnitudes lost to extra sky brightness `nl` on top of a dark sky. */
export function skyBrightnessPenalty(extraNl: number): number {
  const dark = nakedEyeLimit(nanolambertsToMagArcsec2(DARK_SKY_NL));
  return dark - nakedEyeLimit(nanolambertsToMagArcsec2(DARK_SKY_NL + Math.max(extraNl, 0)));
}

/** Moon brightness factor I* (Krisciunas & Schaefer 1991) for a phase angle in degrees (0 = full). */
export function moonIllumFactor(phaseAngleDeg: number): number {
  const a = Math.abs(phaseAngleDeg);
  return 10 ** (-0.4 * (3.84 + 0.026 * a + 4e-9 * a ** 4));
}

/** K&S airmass for sky brightness (valid up to the horizon). */
export function ksAirmass(altDeg: number): number {
  const z = (90 - clamp(altDeg, 0, 90)) * DEG;
  return 1 / Math.sqrt(1 - 0.96 * Math.sin(z) ** 2);
}

/**
 * Sky brightness added by the Moon at a target, nanolamberts
 * (Krisciunas & Schaefer 1991, PASP 103, 1033).
 */
export function moonSkyBrightness(opts: {
  phaseAngleDeg: number;
  moonAltDeg: number;
  targetAltDeg: number;
  separationDeg: number;
  k?: number;
}): number {
  const k = opts.k ?? EXTINCTION_K;
  if (opts.moonAltDeg < 0 || opts.targetAltDeg < 0) return 0;
  const rho = clamp(opts.separationDeg, 0.5, 180);
  const f = 10 ** 5.36 * (1.06 + Math.cos(rho * DEG) ** 2) + 10 ** (6.15 - rho / 40);
  const moon = moonIllumFactor(opts.phaseAngleDeg) * 10 ** (-0.4 * k * ksAirmass(opts.moonAltDeg));
  return f * moon * (1 - 10 ** (-0.4 * k * ksAirmass(opts.targetAltDeg)));
}

/** Apparent altitude for a true altitude (for tests / labels). */
export function apparentAltitude(trueAltDeg: number): number {
  return trueAltDeg + refractionForTrueAltitude(trueAltDeg);
}
