import { describe, expect, it } from 'vitest';
import {
  formatDesignation,
  parseChineseStarNames,
  properMotionVector,
  raDecToUnit,
  tychoToJohnson,
} from '../../scripts/lib/catalog';

describe('catalogue helpers', () => {
  it('proper-motion vector is tangent and has the right size (Barnard’s star)', () => {
    // HIP 87937: μα* = −802.8, μδ = 10362.5 mas/yr (Gaia DR3)
    const ra = 17.96347; // h
    const dec = 4.69339; // deg
    const p = raDecToUnit(ra, dec);
    const v = properMotionVector(ra, dec, -802.8, 10362.5);
    expect(p[0] * v[0] + p[1] * v[1] + p[2] * v[2]).toBeCloseTo(0, 15);
    const masPerYr = Math.hypot(...v) * (180 / Math.PI) * 3600 * 1000;
    expect(masPerYr).toBeCloseTo(Math.hypot(-802.8, 10362.5), 6);
    // northward motion shows up as +z
    expect(v[2]).toBeGreaterThan(0);
  });

  it('missing proper motion → zero vector', () => {
    expect(properMotionVector(1, 2, Number.NaN, 3)).toEqual([0, 0, 0]);
  });

  it('Tycho VT/BT−VT → Johnson V/B−V', () => {
    const { v, bv } = tychoToJohnson(9.239, 1.117);
    expect(v).toBeCloseTo(9.239 - 0.09 * 1.117, 10);
    expect(bv).toBeCloseTo(0.85 * 1.117, 10);
    expect(tychoToJohnson(10, Number.NaN).v).toBe(10);
  });

  it('Bayer / Flamsteed designations', () => {
    expect(formatDesignation('Alp', '58', 'Ori')).toBe('α Ori');
    expect(formatDesignation('Kap-1', '', 'Scl')).toBe('κ¹ Scl');
    expect(formatDesignation('', '61', 'Cyg')).toBe('61 Cyg');
    expect(formatDesignation('', '', '')).toBe('');
  });

  it('parses Stellarium Chinese star names with groups and aliases', () => {
    const zh = parseChineseStarNames(
      [
        '###紫微垣',
        '#北极',
        '11767|_("勾陈一") 1',
        '11767|_("北极星") 1',
        '###近南极天区',
        '#孔雀',
        '5350358584482202880|_("某星") 1',
      ].join('\n'),
    );
    expect(zh.byHip.get(11767)).toEqual(['勾陈一', '北极星']);
    expect(zh.byGaia.get('5350358584482202880')).toEqual(['某星']);
    expect(zh.groupOf.get('北极')).toBe('紫微垣');
  });
});
