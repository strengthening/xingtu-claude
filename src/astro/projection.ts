/**
 * Sky projections, shared by the CPU (labels, picking, culling) and mirrored
 * in src/render/shaders/projection.glsl.
 *
 * View space: camera at the origin looking down −z, +y up, +x right.
 * Plane coordinates P are normalised so the vertical half-FOV maps to NDC y = ±1.
 *
 *   perspective (gnomonic)  P = d.xy / (−d.z)           r = tan θ
 *   stereographic           P = 2 d.xy / (1 − d.z)      r = 2 tan(θ/2)
 *
 * Both have unit radial scale at the centre, so px/rad at the centre is
 * (height / 2) · scale for either mode.
 */
import { DEG, clamp, type Vec3 } from './math';

export type ProjectionMode = 'stereographic' | 'perspective';

export const FOV_LIMITS: Record<ProjectionMode, { min: number; max: number }> = {
  stereographic: { min: 0.2, max: 180 },
  perspective: { min: 0.2, max: 120 },
};

export interface Projection {
  mode: ProjectionMode;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Viewport width / height. */
  aspect: number;
}

/** NDC-y units per plane unit. */
export function projectionScale(mode: ProjectionMode, fovDeg: number): number {
  const half = (fovDeg * DEG) / 2;
  return mode === 'perspective' ? 1 / Math.tan(half) : 1 / (2 * Math.tan(half / 2));
}

/** Plane radius for an angle θ from the view axis. */
function planeRadius(mode: ProjectionMode, theta: number): number {
  return mode === 'perspective' ? Math.tan(theta) : 2 * Math.tan(theta / 2);
}

function planeAngle(mode: ProjectionMode, r: number): number {
  return mode === 'perspective' ? Math.atan(r) : 2 * Math.atan(r / 2);
}

/** Angular radius (deg) of the viewport corner from the view centre. */
export function viewRadiusDeg(p: Projection): number {
  const s = projectionScale(p.mode, p.fov);
  const r = Math.hypot(p.aspect, 1) / s;
  return planeAngle(p.mode, r) / DEG;
}

/**
 * Cosine of the largest off-axis angle that may be projected. Beyond it
 * primitives are dropped (perspective: the back hemisphere; stereographic:
 * the region around the antipode, where coordinates explode).
 */
export function maxProjectableCos(p: Projection): number {
  if (p.mode === 'perspective') return Math.cos(89 * DEG);
  const limit = Math.min(viewRadiusDeg(p) + 30, 170);
  return Math.cos(limit * DEG);
}

/** View-space direction → NDC, or null when it cannot be projected. */
export function projectView(v: Vec3, p: Projection): [number, number] | null {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const x = v[0] / len;
  const y = v[1] / len;
  const c = -v[2] / len; // cos(angle from the view axis)
  if (c < maxProjectableCos(p)) return null;
  const k = (p.mode === 'perspective' ? 1 / c : 2 / (1 + c)) * projectionScale(p.mode, p.fov);
  return [(x * k) / p.aspect, y * k];
}

/** NDC → unit view-space direction. */
export function unprojectNdc(ndcX: number, ndcY: number, p: Projection): [number, number, number] {
  const s = projectionScale(p.mode, p.fov);
  const px = (ndcX * p.aspect) / s;
  const py = ndcY / s;
  if (p.mode === 'perspective') {
    const l = Math.hypot(px, py, 1);
    return [px / l, py / l, -1 / l];
  }
  const r2 = px * px + py * py;
  return [(4 * px) / (r2 + 4), (4 * py) / (r2 + 4), (r2 - 4) / (r2 + 4)];
}

/** CSS px per radian at the view centre. */
export function pxPerRadian(heightPx: number, p: Projection): number {
  return (heightPx / 2) * projectionScale(p.mode, p.fov);
}

/** Local linear magnification relative to the centre (stereographic is conformal). */
export function localScale(v: Vec3, mode: ProjectionMode): number {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const c = clamp(-v[2] / len, -0.999, 1);
  return mode === 'perspective' ? 1 / Math.max(c, 1e-3) : 2 / (1 + c);
}

/** Inverse of planeRadius, exported for tests. */
export function offAxisAngleForRadius(mode: ProjectionMode, r: number): number {
  return planeAngle(mode, r);
}

export function radiusForOffAxisAngle(mode: ProjectionMode, theta: number): number {
  return planeRadius(mode, theta);
}
