export interface ObserverLocation {
  /** Geodetic latitude, degrees, north positive. */
  latitude: number;
  /** Longitude, degrees, east positive. */
  longitude: number;
  /** Height above mean sea level, metres. */
  elevation: number;
}

export const SHANGHAI: Readonly<ObserverLocation> = {
  latitude: 31.23,
  longitude: 121.47,
  elevation: 4,
};

export function isValidLocation(o: ObserverLocation): boolean {
  return (
    Number.isFinite(o.latitude) &&
    Number.isFinite(o.longitude) &&
    Number.isFinite(o.elevation) &&
    Math.abs(o.latitude) <= 90 &&
    Math.abs(o.longitude) <= 180
  );
}
