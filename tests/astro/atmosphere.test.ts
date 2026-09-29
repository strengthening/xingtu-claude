import { Refraction } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  DARK_SKY_NL,
  airmass,
  moonSkyBrightness,
  nakedEyeLimit,
  nanolambertsToMagArcsec2,
  refractionForTrueAltitude,
  skyBrightnessPenalty,
} from '../../src/astro';

describe('refraction', () => {
  it('matches astronomy-engine (Sæmundsson) above the horizon within 0.3′', () => {
    for (const h of [0, 2, 5, 10, 20, 34, 45, 70, 89]) {
      const ours = refractionForTrueAltitude(h);
      const theirs = Refraction('normal', h);
      expect(Math.abs(ours - theirs) * 60).toBeLessThan(0.3);
    }
  });

  it('about 29′ at the horizon, ~1′ at 45°, vanishing at the zenith', () => {
    expect(refractionForTrueAltitude(0) * 60).toBeGreaterThan(28);
    expect(refractionForTrueAltitude(0) * 60).toBeLessThan(35);
    expect(refractionForTrueAltitude(45) * 60).toBeCloseTo(1.0, 0);
    expect(refractionForTrueAltitude(90) * 3600).toBeLessThan(1);
    expect(refractionForTrueAltitude(-6)).toBe(0);
  });
});

describe('extinction & sky brightness', () => {
  it('airmass: 1 at zenith, ≈2 at 30°, ≈38 at the horizon', () => {
    expect(airmass(90)).toBeCloseTo(1, 3);
    expect(airmass(30)).toBeCloseTo(1.995, 2);
    expect(airmass(0)).toBeGreaterThan(36);
    expect(airmass(0)).toBeLessThan(40);
  });

  it('naked-eye limit ≈ 6.4 under a 21.5 mag/arcsec² sky', () => {
    expect(nanolambertsToMagArcsec2(DARK_SKY_NL)).toBeCloseTo(21.5, 1);
    expect(nakedEyeLimit(21.5)).toBeCloseTo(6.38, 1);
    expect(skyBrightnessPenalty(0)).toBeCloseTo(0, 10);
  });

  it('a high full Moon costs ~1–2.5 magnitudes; more near the Moon', () => {
    const far = moonSkyBrightness({
      phaseAngleDeg: 0,
      moonAltDeg: 60,
      targetAltDeg: 60,
      separationDeg: 90,
    });
    const near = moonSkyBrightness({
      phaseAngleDeg: 0,
      moonAltDeg: 60,
      targetAltDeg: 60,
      separationDeg: 10,
    });
    expect(near).toBeGreaterThan(far * 2);
    const penalty = skyBrightnessPenalty(far);
    expect(penalty).toBeGreaterThan(0.8);
    expect(penalty).toBeLessThan(2.5);
    // crescent Moon matters much less
    const crescent = moonSkyBrightness({
      phaseAngleDeg: 120,
      moonAltDeg: 60,
      targetAltDeg: 60,
      separationDeg: 90,
    });
    expect(crescent).toBeLessThan(far / 5);
    // Moon below the horizon: no contribution
    expect(
      moonSkyBrightness({ phaseAngleDeg: 0, moonAltDeg: -5, targetAltDeg: 60, separationDeg: 90 }),
    ).toBe(0);
  });
});
