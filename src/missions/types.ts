/**
 * A replayable launch: vehicles with reconstructed trajectories, a timeline
 * of events, and ground sites to watch from. Pure data + maths (no DOM, no
 * Three.js), so missions can be unit-tested headless.
 */
import type { ObserverLocation } from '../astro';
import type { GeoPoint } from '../astro/flight';

export type VehicleKind = 'ship' | 'booster' | 'starlink';

/** Vehicles the user can select / track. 'starlink' stands for the whole satellite group. */
export type VehicleId = 'ship' | 'booster' | 'starlink';

export const VEHICLE_IDS: readonly VehicleId[] = ['ship', 'booster', 'starlink'];

export interface VehicleSample {
  /** Unique per object ("ship", "booster", "starlink-3"). */
  id: string;
  kind: VehicleKind;
  name: string;
  geo: GeoPoint;
  /** Engines firing (drawn as a bright plume). */
  burning: boolean;
}

export interface MissionEvent {
  /** Seconds from lift-off. */
  tPlus: number;
  key: string;
  name: string;
  detail: string;
  /** Time estimated rather than reported. */
  approx?: boolean;
}

export interface MissionPhase {
  /** Phase starts at this T+ (seconds) and lasts until the next one. */
  from: number;
  name: string;
}

export interface ObserverPreset extends ObserverLocation {
  id: string;
  name: string;
  /** What can be seen from here. */
  note: string;
  /** T+ ranges (seconds, [from, to)) in which automatic mode picks this site. */
  windows: readonly (readonly [number, number])[];
}

export interface Mission {
  id: string;
  name: string;
  /** Vehicles, one line. */
  subtitle: string;
  /** Lift-off, ms since the Unix epoch (UTC). */
  t0Ms: number;
  /** Replay range, seconds from lift-off. */
  start: number;
  end: number;
  events: readonly MissionEvent[];
  phases: readonly MissionPhase[];
  observers: readonly ObserverPreset[];
  /** Caveats shown with the replay. */
  notes: readonly string[];
  sources: readonly { title: string; url: string }[];
  /** Every vehicle in flight at T+ (seconds). */
  vehiclesAt(tPlus: number): VehicleSample[];
  /** Position of a vehicle at T+, or null when it is not flying (for trails). */
  trackAt(id: 'ship' | 'booster', tPlus: number): GeoPoint | null;
  /** T+ range over which a vehicle exists. */
  lifetime(id: 'ship' | 'booster'): readonly [number, number];
}
