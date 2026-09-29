/**
 * Visibility model: which magnitudes are drawn / labelled for a field of view
 * and sky brightness. Pure functions so the renderer and the tests agree.
 */
import { clamp, lerp } from './math';

/** Vertical FOV (deg) at which the naked-eye limit applies. */
export const REFERENCE_FOV = 70;
export const NAKED_EYE_LIMIT = 6.3;
/** Magnitudes gained per decade of zoom (telescope-like deepening). */
export const ZOOM_GAIN = 2.8;
export const MAX_LIMIT = 14;

/** Faintest magnitude to draw for a vertical FOV, reduced by sky brightness. */
export function limitingMagnitude(fovDeg: number, skyPenalty = 0): number {
  const zoom = Math.log10(REFERENCE_FOV / Math.max(fovDeg, 1e-3));
  return clamp(NAKED_EYE_LIMIT + ZOOM_GAIN * zoom - skyPenalty, -30, MAX_LIMIT);
}

/** Faintest named star to label: mag < 2 at the default view, more when zoomed in. */
export function labelMagnitudeLimit(fovDeg: number, skyPenalty = 0): number {
  const zoom = Math.log10(REFERENCE_FOV / Math.max(fovDeg, 1e-3));
  const lim = 2 + 2.6 * Math.max(zoom, 0);
  return Math.min(lim, limitingMagnitude(fovDeg, skyPenalty) - 0.5);
}

/** Whether a magnitude tier (starting at `tierMagMin`, null = unbounded) contributes anything. */
export function tierNeeded(tierMagMin: number | null, limMag: number): boolean {
  return tierMagMin === null || tierMagMin < limMag;
}

export interface SkyBrightness {
  /** 0 = dark night, 1 = full daylight. */
  level: number;
  /** Magnitudes subtracted from the limiting magnitude. */
  magPenalty: number;
  phase: 'night' | 'astronomical' | 'nautical' | 'civil' | 'day';
}

/** Crude twilight model from the Sun's geometric altitude (moonlight not modelled yet). */
export function skyBrightness(sunAltDeg: number): SkyBrightness {
  const a = sunAltDeg;
  if (a <= -18) return { level: 0, magPenalty: 0, phase: 'night' };
  if (a <= -12) {
    const t = (a + 18) / 6;
    return { level: lerp(0, 0.04, t), magPenalty: lerp(0, 1, t), phase: 'astronomical' };
  }
  if (a <= -6) {
    const t = (a + 12) / 6;
    return { level: lerp(0.04, 0.2, t), magPenalty: lerp(1, 3, t), phase: 'nautical' };
  }
  if (a <= 0) {
    const t = (a + 6) / 6;
    return { level: lerp(0.2, 0.65, t), magPenalty: lerp(3, 5.5, t), phase: 'civil' };
  }
  const t = clamp(a / 10, 0, 1);
  return { level: lerp(0.65, 1, t), magPenalty: lerp(5.5, 9, t), phase: 'day' };
}
