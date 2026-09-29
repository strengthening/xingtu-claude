import { describe, expect, it } from 'vitest';
import { isValidLocation } from '../../src/astro';
import { PLACES, placeRegion } from '../../src/ui/locations';

describe('preset places', () => {
  it('have unique names and valid coordinates', () => {
    expect(new Set(PLACES.map((p) => p.name)).size).toBe(PLACES.length);
    for (const p of PLACES) expect(isValidLocation(p), p.name).toBe(true);
  });

  it('are grouped by hemisphere, with a good choice in the south', () => {
    expect(placeRegion({ latitude: 31.23, longitude: 121.47, elevation: 0 })).toBe('北半球');
    expect(placeRegion({ latitude: -33.87, longitude: 151.21, elevation: 0 })).toBe('南半球');
    expect(PLACES.filter((p) => placeRegion(p) === '南半球').length).toBeGreaterThanOrEqual(8);
    expect(PLACES[0]?.name).toBe('上海'); // the default location comes first
  });
});
