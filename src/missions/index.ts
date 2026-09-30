import { STARSHIP_FLIGHT_14 } from './starship-flight-14';
import type { Mission } from './types';

export * from './frame';
export * from './types';

/** Replayable missions, newest first. */
export const MISSIONS: readonly Mission[] = [STARSHIP_FLIGHT_14];

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
