/**
 * A mission as seen from one place at one instant: where each vehicle is in
 * the observer's sky, how fast it goes, whether the Sun lights it.
 */
import type { ObserverLocation, Vec3 } from '../astro';
import {
  geoToEcef,
  isSunlit,
  lookDirection,
  sunDirectionEcef,
  type GeoPoint,
} from '../astro/flight';
import { worldToAltAz } from '../astro/coords';
import type { Mission, MissionEvent, ObserverPreset, VehicleId, VehicleSample } from './types';

export interface VehicleView extends VehicleSample {
  ecef: Vec3;
  /** Line of sight in the render world frame, unit length (not refracted). */
  world: Vec3;
  altDeg: number;
  azDeg: number;
  rangeKm: number;
  /** Speed over the ground, km/h. */
  speedKmh: number;
  sunlit: boolean;
}

export interface ReplayFrame {
  mission: Mission;
  /** Seconds from lift-off. */
  tPlus: number;
  observer: ObserverLocation;
  vehicles: VehicleView[];
  phase: string;
}

/** Half-width of the central difference used for speeds, s. */
const DT = 0.5;

export function computeReplayFrame(
  mission: Mission,
  ms: number,
  observer: ObserverLocation,
): ReplayFrame {
  const tPlus = (ms - mission.t0Ms) / 1000;
  const sun = sunDirectionEcef(new Date(ms));
  const before = new Map(mission.vehiclesAt(tPlus - DT).map((v) => [v.id, v.geo]));
  const after = new Map(mission.vehiclesAt(tPlus + DT).map((v) => [v.id, v.geo]));
  const vehicles = mission.vehiclesAt(tPlus).map((v): VehicleView => {
    const ecef = geoToEcef(v.geo);
    const look = lookDirection(observer, ecef);
    const h = worldToAltAz(look.world);
    const a = before.get(v.id) ?? v.geo;
    const b = after.get(v.id) ?? v.geo;
    const speedKmh = (distanceKm(a, b) / (2 * DT)) * 3600;
    return {
      ...v,
      ecef,
      world: look.world,
      altDeg: h.alt,
      azDeg: h.az,
      rangeKm: look.rangeKm,
      speedKmh,
      sunlit: isSunlit(ecef, sun),
    };
  });
  return { mission, tPlus, observer, vehicles, phase: phaseAt(mission, tPlus) };
}

function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const p = geoToEcef(a);
  const q = geoToEcef(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function phaseAt(mission: Mission, tPlus: number): string {
  let name = mission.phases[0]?.name ?? '';
  for (const p of mission.phases) if (p.from <= tPlus) name = p.name;
  return name;
}

/** The view of a selectable vehicle; for the Starlink group, its middle satellite. */
export function vehicleView(
  frame: ReplayFrame | null | undefined,
  id: VehicleId,
): VehicleView | undefined {
  if (!frame) return undefined;
  if (id !== 'starlink') return frame.vehicles.find((v) => v.id === id);
  const sats = frame.vehicles.filter((v) => v.kind === 'starlink');
  return sats[Math.floor((sats.length - 1) / 2)];
}

/**
 * Line-of-sight directions (world frame, xyz triples) along a vehicle's path
 * from `from` to `to`, `n` samples; null where the vehicle does not exist.
 */
export function trailDirections(
  mission: Mission,
  id: 'ship' | 'booster',
  from: number,
  to: number,
  n: number,
  observer: ObserverLocation,
): Float32Array {
  const out = new Float32Array(n * 3);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? from : from + ((to - from) * i) / (n - 1);
    const g = mission.trackAt(id, t);
    if (!g) continue;
    const w = lookDirection(observer, geoToEcef(g)).world;
    out[k++] = w[0];
    out[k++] = w[1];
    out[k++] = w[2];
  }
  return out.subarray(0, k);
}

/** "T+01:23:45" / "T−00:00:30". */
export function formatTPlus(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  const s = Math.floor(Math.abs(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (x: number): string => String(x).padStart(2, '0');
  return `T${sign}${p(hh)}:${p(mm)}:${p(ss)}`;
}

/** Next event strictly after T+, if any. */
export function nextEvent(mission: Mission, tPlus: number): MissionEvent | undefined {
  return mission.events.find((e) => e.tPlus > tPlus + 0.5);
}

/** The preset automatic mode uses at T+ (the first whose window contains it). */
export function presetFor(mission: Mission, tPlus: number): ObserverPreset | undefined {
  const t = Math.min(Math.max(tPlus, mission.start), mission.end - 1e-3);
  return mission.observers.find((o) => o.windows.some(([a, b]) => t >= a && t < b));
}
