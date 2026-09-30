/**
 * What the user clicked: a solar-system body, a catalogue star, or a vehicle
 * of a launch being replayed. Keys ("body:Moon", "hip:32349", "athyg:123",
 * "veh:ship") identify a target in URLs.
 */
import * as THREE from 'three';
import {
  BODY_IDS,
  apparentStarDirection,
  raDecToVector,
  vectorToRaDec,
  type BodyId,
  type BodyState,
  type Vec3,
} from './astro';
import { VEHICLE_IDS, vehicleView, type ReplayFrame, type VehicleId } from './missions';
import { refractWorld } from './render/atmosphere';

export interface BodyTarget {
  kind: 'body';
  id: BodyId;
}

export interface StarTarget {
  kind: 'star';
  /** AT-HYG id (stable within a catalogue version). */
  cat: number;
  /** Hipparcos number, 0 if none. */
  hip: number;
  /** J2000 unit vector at epoch J2000.0 and its proper motion (rad/yr). */
  p0: Vec3;
  pm: Vec3;
  mag: number;
  /** B−V; NaN if unknown. */
  ci: number;
  /** parsecs; NaN if unknown. */
  dist: number;
}

export interface VehicleTarget {
  kind: 'vehicle';
  id: VehicleId;
}

export type Target = BodyTarget | StarTarget | VehicleTarget;

/** Parsed URL key; stars may carry an approximate J2000 position ("hip:13137@42.2422,4.0800"). */
export type TargetKey =
  | { kind: 'body'; id: BodyId }
  | { kind: 'vehicle'; id: VehicleId }
  | { kind: 'hip'; hip: number; near?: Vec3 }
  | { kind: 'athyg'; cat: number; near?: Vec3 };

export function targetKey(t: Target): string {
  if (t.kind === 'body') return `body:${t.id}`;
  if (t.kind === 'vehicle') return `veh:${t.id}`;
  return t.hip > 0 ? `hip:${t.hip}` : `athyg:${t.cat}`;
}

/** Pattern of a URL selection key (also used to validate the hash). */
export const TARGET_KEY_RE = /^(body|hip|athyg|veh):(\w+)(?:@(-?[\d.]+),(-?[\d.]+))?$/;

export function parseTargetKey(s: string): TargetKey | null {
  const m = TARGET_KEY_RE.exec(s.trim());
  if (!m) return null;
  const [, kind, value = '', ra, dec] = m;
  if (kind === 'body') {
    const id = BODY_IDS.find((b) => b.toLowerCase() === value.toLowerCase());
    return id ? { kind: 'body', id } : null;
  }
  if (kind === 'veh') {
    const id = VEHICLE_IDS.find((v) => v === value.toLowerCase());
    return id ? { kind: 'vehicle', id } : null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  const key: TargetKey = kind === 'hip' ? { kind: 'hip', hip: n } : { kind: 'athyg', cat: n };
  const r = Number(ra);
  const d = Number(dec);
  if (ra !== undefined && Number.isFinite(r) && Number.isFinite(d) && Math.abs(d) <= 90) {
    key.near = raDecToVector(r, d);
  }
  return key;
}

/** Key for URLs: stars also record where they are, so they can be found before any zoom. */
export function targetUrlKey(t: Target): string {
  if (t.kind !== 'star') return targetKey(t);
  const { ra, dec } = vectorToRaDec(t.p0);
  return `${targetKey(t)}@${ra.toFixed(4)},${dec.toFixed(4)}`;
}

/** URL form of a parsed key (for a selection that is still loading). */
export function formatTargetKey(k: TargetKey): string {
  if (k.kind === 'body') return `body:${k.id}`;
  if (k.kind === 'vehicle') return `veh:${k.id}`;
  const base = k.kind === 'hip' ? `hip:${k.hip}` : `athyg:${k.cat}`;
  if (!k.near) return base;
  const { ra, dec } = vectorToRaDec(k.near);
  return `${base}@${ra.toFixed(4)},${dec.toFixed(4)}`;
}

export function sameTarget(a: Target | null, b: Target | null): boolean {
  if (!a || !b) return a === b;
  return targetKey(a) === targetKey(b);
}

/** The minimum of a frame needed to place a target on the sky. */
export interface TargetFrame {
  eqjToWorld: THREE.Matrix4;
  years: number;
  beta: Vec3;
  bodies: readonly BodyState[];
  atmosphere: boolean;
  /** Launch replay in progress, for vehicle targets. */
  replay?: ReplayFrame | null;
}

/**
 * Apparent J2000 direction of a target (proper motion + aberration for stars).
 * Vehicles are Earth-fixed, not on the celestial sphere: null.
 */
export function targetEqj(
  t: Target,
  f: Pick<TargetFrame, 'years' | 'beta' | 'bodies'>,
): Vec3 | null {
  if (t.kind === 'vehicle') return null;
  if (t.kind === 'body') return f.bodies.find((b) => b.id === t.id)?.eqj ?? null;
  return apparentStarDirection(t.p0, t.pm, f.years, f.beta);
}

/** Apparent world direction (refracted when the atmosphere is on). */
export function targetWorld(
  t: Target,
  f: TargetFrame,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  if (t.kind === 'vehicle') {
    const v = vehicleView(f.replay, t.id);
    if (!v) return null;
    return refractWorld(out.set(v.world[0], v.world[1], v.world[2]), f.atmosphere);
  }
  const d = targetEqj(t, f);
  if (!d) return null;
  out.set(d[0], d[1], d[2]).applyMatrix4(f.eqjToWorld);
  return refractWorld(out, f.atmosphere);
}
