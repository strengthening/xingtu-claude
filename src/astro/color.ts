/**
 * Star colour from the B–V colour index.
 *   B–V → effective temperature: Ballesteros (2012), EPL 97, 34008.
 *   temperature → sRGB: Tanner Helland's fit to blackbody colours (1000–40000 K).
 */
import { clamp } from './math';

export const BV_MIN = -0.4;
export const BV_MAX = 2.0;
/** B–V used when the catalogue has no colour (roughly solar). */
export const BV_DEFAULT = 0.65;

export function bvToTemperature(bv: number): number {
  const b = clamp(Number.isFinite(bv) ? bv : BV_DEFAULT, BV_MIN, BV_MAX);
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/** Blackbody colour for a temperature in kelvin, as linear-ish sRGB in [0, 1], max component = 1. */
export function temperatureToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);
  const m = Math.max(r, g, b) || 1;
  return [r / m, g / m, b / m];
}

/**
 * Display colour for a star. `saturation` < 1 blends toward white — the eye
 * perceives star colours as far paler than a raw blackbody curve suggests.
 */
export function bvToRgb(bv: number, saturation = 0.75): [number, number, number] {
  const [r, g, b] = temperatureToRgb(bvToTemperature(bv));
  const s = clamp(saturation, 0, 1);
  return [1 + (r - 1) * s, 1 + (g - 1) * s, 1 + (b - 1) * s];
}
