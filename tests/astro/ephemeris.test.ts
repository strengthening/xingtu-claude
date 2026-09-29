import { describe, expect, it } from 'vitest';
import {
  bodyRiseTransitSet,
  constellationOf,
  moonPhaseName,
  properMotionComponents,
  raDecOfDate,
  raDecToVector,
  starRiseTransitSet,
  SHANGHAI,
} from '../../src/astro';
import { properMotionVector } from '../../scripts/lib/catalog';
import { IAU_CONSTELLATION_ZH } from '../../src/data/constellations';

describe('info-card ephemeris', () => {
  it('proper-motion components round-trip (Arcturus)', () => {
    const raH = 14.26103;
    const dec = 19.18241;
    const pm = properMotionVector(raH, dec, -1093.45, -1999.4);
    const c = properMotionComponents(raDecToVector(raH * 15, dec), pm);
    expect(c.pmRa).toBeCloseTo(-1093.45, 6);
    expect(c.pmDec).toBeCloseTo(-1999.4, 6);
  });

  it('coordinates of date move by precession (~0.36° in RA for Sirius, 2000→2026)', () => {
    const d = raDecOfDate(raDecToVector(101.287155, -16.716116), new Date('2026-01-15T13:00:00Z'));
    // Stellarium 24.4 apparent RA of date 101.5805°, Dec −16.7533° (incl. pm + aberration)
    expect(Math.abs(d.ra - 101.5805)).toBeLessThan(0.02);
    expect(Math.abs(d.dec - -16.7533)).toBeLessThan(0.02);
  });

  it('Sun rises, transits and sets over Shanghai; transit altitude ≈ 90 − φ + δ', () => {
    const r = bodyRiseTransitSet('Sun', SHANGHAI, new Date('2026-06-21T06:00:00Z'));
    expect(r.kind).toBe('normal');
    expect(r.transitAlt).toBeGreaterThan(81.5);
    expect(r.transitAlt).toBeLessThan(83);
  });

  it('circumpolar and never-rising stars', () => {
    const polaris = starRiseTransitSet(
      raDecToVector(37.95, 89.26),
      133,
      SHANGHAI,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(polaris.kind).toBe('up');
    const acrux = starRiseTransitSet(
      raDecToVector(186.65, -63.1),
      99,
      SHANGHAI,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(acrux.kind).toBe('down');
  });

  it('moon phase names', () => {
    expect(moonPhaseName(new Date('2026-09-26T16:49:00Z'))).toBe('满月');
    expect(moonPhaseName(new Date('2026-01-18T19:52:00Z'))).toBe('新月');
  });
});

describe('constellationOf', () => {
  it('finds the IAU constellation of bright stars', () => {
    expect(constellationOf(raDecToVector(101.287155, -16.716116)).symbol).toBe('CMa'); // Sirius
    expect(constellationOf(raDecToVector(279.23473, 38.78369)).symbol).toBe('Lyr'); // Vega
    expect(constellationOf(raDecToVector(37.95456, 89.26411)).symbol).toBe('UMi'); // Polaris
  });

  it('every IAU abbreviation has a Chinese name', () => {
    for (let ra = 0; ra < 360; ra += 7.5) {
      for (let dec = -87.5; dec <= 87.5; dec += 5) {
        const { symbol } = constellationOf(raDecToVector(ra, dec));
        expect(IAU_CONSTELLATION_ZH[symbol], symbol).toBeDefined();
      }
    }
  });
});
