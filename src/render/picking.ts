/**
 * Click → object. Bodies are tested on screen; stars are pre-filtered by a
 * dot product against the (un-refracted, aberration-free) click direction in
 * J2000, then the few survivors are placed exactly as the star shader does
 * (proper motion, aberration, refraction, extinction, moonlight) and scored
 * by their on-screen distance to the click.
 */
import * as THREE from 'three';
import {
  DEG,
  apparentStarDirection,
  extinctionMag,
  moonSkyBrightness,
  refractionForTrueAltitude,
  skyBrightnessPenalty,
  worldToAltAz,
  angularSeparationDeg,
  type Vec3,
} from '../astro';
import { FIELD_OFFSET, type StarChunk } from '../data/StarCatalog';
import type { BodyTarget, StarTarget, Target } from '../selection';
import { refractWorld } from './atmosphere';
import type { FrameContext } from './context';
import { GROUND_Y, pxPerDegree, starRadiusPx } from './labels';
import { bodyMarkerRadiusPx } from './layers/BodyLayer';
import { worldToScreen } from './projection';

/** Slop (CSS px) around a star's drawn core / a body's disc that still counts as a hit. */
const STAR_SLOP_PX = 9;
const BODY_SLOP_PX = 12;
/** Largest drawn star core (labels.ts clamps to 12 × star scale). */
const MAX_CORE_PX = 12;

const tmpWorld = new THREE.Vector3();
const worldToEqj = new THREE.Matrix3();

/** Faintest magnitude lost to moonlight at an apparent world direction (CPU twin of atmMoonPenalty). */
export function moonPenaltyAt(ctx: FrameContext, w: THREE.Vector3): number {
  if (!ctx.atmosphere || w.y <= 0) return 0;
  const moon = ctx.bodies.find((b) => b.id === 'Moon');
  if (!moon) return 0;
  const m = tmpWorld.set(moon.eqj[0], moon.eqj[1], moon.eqj[2]).applyMatrix4(ctx.eqjToWorld);
  const mv: Vec3 = [m.x, m.y, m.z];
  const moonAlt = worldToAltAz(mv).alt;
  if (moonAlt <= 0) return 0;
  const nl = moonSkyBrightness({
    phaseAngleDeg: moon.phaseAngleDeg,
    moonAltDeg: moonAlt,
    targetAltDeg: Math.asin(Math.min(w.y / w.length(), 1)) / DEG,
    separationDeg: angularSeparationDeg(mv, [w.x, w.y, w.z]),
  });
  return skyBrightnessPenalty(nl) * ctx.atmStrength;
}

/** Magnitude a star appears at (extinction + moonlight) at apparent world direction `w`. */
export function effectiveMagnitude(ctx: FrameContext, mag: number, w: THREE.Vector3): number {
  if (!ctx.atmosphere) return mag;
  const alt = Math.asin(Math.max(-1, Math.min(1, w.y / w.length()))) / DEG;
  return mag + extinctionMag(alt, ctx.extinctionK) + moonPenaltyAt(ctx, w);
}

/** Undo refraction on an apparent world direction (fixed-point on Sæmundsson). */
function unrefract(w: THREE.Vector3, on: boolean): THREE.Vector3 {
  if (!on) return w;
  const hl = Math.hypot(w.x, w.z);
  if (hl < 1e-9) return w;
  const app = Math.asin(Math.max(-1, Math.min(1, w.y))) / DEG;
  let h = app;
  for (let i = 0; i < 4; i++) h = app - refractionForTrueAltitude(h);
  const a = h * DEG;
  const k = Math.cos(a) / hl;
  return w.set(w.x * k, Math.sin(a), w.z * k);
}

/** The i-th star of a chunk as a selection target. */
export function starTargetAt(chunk: StarChunk, i: number): StarTarget {
  const { data, stride } = chunk;
  const o = i * stride;
  const O = FIELD_OFFSET;
  const f = (k: number): number => data[o + k] ?? Number.NaN;
  return {
    kind: 'star',
    cat: Math.round(f(O.cat)),
    hip: Math.round(f(O.hip)) || 0,
    p0: [f(O.x), f(O.y), f(O.z)],
    pm: [f(O.pmx) || 0, f(O.pmy) || 0, f(O.pmz) || 0],
    mag: f(O.mag),
    ci: f(O.ci),
    dist: f(O.dist),
  };
}

interface Hit {
  score: number;
  target: Target;
}

/**
 * Object under screen point (sx, sy) in canvas CSS px, whose world direction is `clickWorld`.
 * Returns null for empty sky.
 */
export function pickTarget(
  ctx: FrameContext,
  sx: number,
  sy: number,
  clickWorld: THREE.Vector3,
  chunks: Iterable<StarChunk>,
): Target | null {
  const { settings } = ctx;
  const atm = ctx.atmosphere;
  const hideBelow = settings.showGround ? GROUND_Y : -2;
  let best: Hit | null = null;
  const consider = (score: number, target: Target): void => {
    if (!best || score < best.score) best = { score, target };
  };
  const w = new THREE.Vector3();

  // ---- Sun, Moon, planets -----------------------------------------------------
  if (settings.showBodies) {
    const ppd = pxPerDegree(ctx);
    for (const b of ctx.bodies) {
      w.set(b.eqj[0], b.eqj[1], b.eqj[2]).applyMatrix4(ctx.eqjToWorld);
      refractWorld(w, atm);
      if (w.y < hideBelow) continue;
      if (b.id !== 'Sun' && b.id !== 'Moon' && effectiveMagnitude(ctx, b.mag, w) > ctx.limMag)
        continue;
      const p = worldToScreen(w, ctx.camera, ctx.projection, ctx.width, ctx.height);
      if (!p) continue;
      const r = bodyMarkerRadiusPx(b, ppd);
      const d = Math.hypot(p[0] - sx, p[1] - sy);
      if (d > r + BODY_SLOP_PX) continue;
      // inside a disc beats any star behind it; otherwise bodies win close calls
      const target: BodyTarget = { kind: 'body', id: b.id };
      consider(d <= r ? -1000 + d / Math.max(r, 1) : d - r - 6, target);
    }
  }

  // ---- stars ------------------------------------------------------------------
  const scale = settings.starScale;
  const maxPx = MAX_CORE_PX * scale + STAR_SLOP_PX;
  const theta = maxPx / ctx.projection.pxPerRad + 1e-4; // + ~20″ for aberration / refraction residue
  const cosMax = Math.cos(Math.min(theta, Math.PI));
  worldToEqj.setFromMatrix4(ctx.eqjToWorld).transpose();
  const c = unrefract(w.copy(clickWorld).normalize(), atm).applyMatrix3(worldToEqj);
  const cx = c.x - ctx.beta[0];
  const cy = c.y - ctx.beta[1];
  const cz = c.z - ctx.beta[2];
  const cl = Math.hypot(cx, cy, cz);
  const [ux, uy, uz] = [cx / cl, cy / cl, cz / cl];
  const years = ctx.years;
  const O = FIELD_OFFSET;

  for (const chunk of chunks) {
    const { data, stride, count } = chunk;
    for (let i = 0, o = 0; i < count; i++, o += stride) {
      const mag = data[o + O.mag] ?? 99;
      if (mag > ctx.limMag) continue;
      const x = (data[o] ?? 0) + (data[o + O.pmx] ?? 0) * years;
      const y = (data[o + 1] ?? 0) + (data[o + O.pmy] ?? 0) * years;
      const z = (data[o + 2] ?? 0) + (data[o + O.pmz] ?? 0) * years;
      if (x * ux + y * uy + z * uz < cosMax) continue;

      const p0: Vec3 = [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0];
      const pm: Vec3 = [data[o + O.pmx] ?? 0, data[o + O.pmy] ?? 0, data[o + O.pmz] ?? 0];
      const d = apparentStarDirection(p0, pm, years, ctx.beta);
      w.set(d[0], d[1], d[2]).applyMatrix4(ctx.eqjToWorld);
      refractWorld(w, atm);
      if (w.y < hideBelow) continue;
      const eff = effectiveMagnitude(ctx, mag, w);
      if (ctx.limMag - eff < 0.1) continue; // not drawn (see pointSource fade-in)
      const p = worldToScreen(w, ctx.camera, ctx.projection, ctx.width, ctx.height);
      if (!p) continue;
      const r = starRadiusPx(eff, ctx.limMag, scale);
      const dist = Math.hypot(p[0] - sx, p[1] - sy);
      if (dist > r + STAR_SLOP_PX) continue;
      // distance outside the drawn core, with brighter stars winning near-ties
      consider(Math.max(dist - r, 0) + 0.35 * eff, starTargetAt(chunk, i));
    }
  }
  return best === null ? null : (best as Hit).target;
}
