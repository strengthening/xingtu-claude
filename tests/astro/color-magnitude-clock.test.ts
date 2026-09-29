import { describe, expect, it } from 'vitest';
import {
  SimClock,
  bvToRgb,
  bvToTemperature,
  labelMagnitudeLimit,
  limitingMagnitude,
  skyBrightness,
  temperatureToRgb,
  tierNeeded,
} from '../../src/astro';

describe('colour', () => {
  it('B–V of the Sun (0.65) gives ~5780 K', () => {
    expect(bvToTemperature(0.65)).toBeGreaterThan(5700);
    expect(bvToTemperature(0.65)).toBeLessThan(5850);
  });

  it('hot stars are blue-ish, cool stars red-ish', () => {
    const [rb, , bb] = bvToRgb(-0.2, 1);
    const [rr, , br] = bvToRgb(1.6, 1);
    expect(bb).toBeGreaterThan(rb);
    expect(rr).toBeGreaterThan(br);
  });

  it('unknown colour falls back to a valid white-ish colour', () => {
    const c = bvToRgb(Number.NaN);
    for (const x of c) {
      expect(x).toBeGreaterThan(0.5);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it('temperatureToRgb is normalised to max = 1', () => {
    for (const k of [2000, 4000, 6600, 10000, 30000]) {
      expect(Math.max(...temperatureToRgb(k))).toBeCloseTo(1, 9);
    }
  });
});

describe('visibility model', () => {
  it('limiting magnitude deepens monotonically with zoom', () => {
    let prev = -Infinity;
    for (const fov of [120, 70, 30, 10, 3, 1, 0.5]) {
      const m = limitingMagnitude(fov);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
    expect(limitingMagnitude(70)).toBeCloseTo(6.3);
  });

  it('labels: mag < 2 at the default view, more when zoomed', () => {
    expect(labelMagnitudeLimit(70)).toBeCloseTo(2);
    expect(labelMagnitudeLimit(10)).toBeGreaterThan(4);
  });

  it('faint tier is only needed when zoomed in', () => {
    expect(tierNeeded(null, 6)).toBe(true);
    expect(tierNeeded(6.5, limitingMagnitude(70))).toBe(false);
    expect(tierNeeded(6.5, limitingMagnitude(20))).toBe(true);
  });

  it('daylight suppresses stars; night does not', () => {
    expect(skyBrightness(-30).magPenalty).toBe(0);
    expect(skyBrightness(30).magPenalty).toBeGreaterThan(8);
    expect(skyBrightness(-9).phase).toBe('nautical');
  });
});

describe('SimClock', () => {
  it('runs, changes rate continuously, pauses and resets', () => {
    let real = 1_000_000;
    const clock = new SimClock(() => real, 0);
    real += 1000;
    expect(clock.now()).toBe(1000);
    clock.setRate(60);
    real += 1000;
    expect(clock.now()).toBe(61_000);
    clock.setPaused(true);
    real += 5000;
    expect(clock.now()).toBe(61_000);
    clock.setPaused(false);
    real += 1000;
    expect(clock.now()).toBe(121_000);
    clock.resetToNow();
    expect(clock.now()).toBe(real);
    expect(clock.isLive).toBe(true);
  });

  it('steps through rate presets', () => {
    const clock = new SimClock(() => 0);
    expect(clock.stepRate(1)).toBe(10);
    expect(clock.stepRate(1)).toBe(60);
    expect(clock.stepRate(-1)).toBe(10);
    clock.setRate(1);
    expect(clock.stepRate(-1)).toBe(-1);
  });
});
