import { describe, expect, it } from 'vitest';
import {
  DEG,
  maxProjectableCos,
  projectView,
  projectionScale,
  pxPerRadian,
  unprojectNdc,
  viewRadiusDeg,
  type Projection,
  type ProjectionMode,
} from '../../src/astro';

const modes: ProjectionMode[] = ['stereographic', 'perspective'];

describe('projections', () => {
  for (const mode of modes) {
    const p: Projection = { mode, fov: 70, aspect: 16 / 9 };

    it(`${mode}: vertical half-FOV lands on NDC y = ±1`, () => {
      const t = 35 * DEG;
      const ndc = projectView([0, Math.sin(t), -Math.cos(t)], p);
      expect(ndc?.[1]).toBeCloseTo(1, 12);
      expect(ndc?.[0]).toBeCloseTo(0, 12);
    });

    it(`${mode}: project ∘ unproject = identity`, () => {
      for (const [x, y] of [
        [0, 0],
        [0.3, -0.7],
        [-0.95, 0.9],
        [0.5, 0.5],
      ] as const) {
        const v = unprojectNdc(x, y, p);
        expect(Math.hypot(...v)).toBeCloseTo(1, 12);
        const back = projectView(v, p);
        expect(back?.[0]).toBeCloseTo(x, 10);
        expect(back?.[1]).toBeCloseTo(y, 10);
      }
    });

    it(`${mode}: unit radial scale at the centre`, () => {
      const eps = 1e-6;
      const ndc = projectView([Math.sin(eps), 0, -Math.cos(eps)], p);
      // NDC x per radian × (width/2) = px per radian
      const pxPerRad = ((ndc?.[0] ?? 0) / eps) * (1600 / 2);
      expect(pxPerRad).toBeCloseTo(pxPerRadian(900, p), 3);
    });
  }

  it('stereographic keeps a 180° field projectable; perspective does not', () => {
    const wide: Projection = { mode: 'stereographic', fov: 180, aspect: 1 };
    expect(projectView([1, 0, 0], wide)).not.toBeNull(); // 90° off-axis
    expect(projectionScale('stereographic', 180)).toBeCloseTo(0.5);
    expect(projectView([1, 0, 0], { mode: 'perspective', fov: 100, aspect: 1 })).toBeNull();
  });

  it('view radius covers the corner and cull limit stays below the antipode', () => {
    const p: Projection = { mode: 'stereographic', fov: 90, aspect: 2 };
    const r = viewRadiusDeg(p);
    const corner = unprojectNdc(1, 1, p);
    expect(Math.acos(-corner[2]) / DEG).toBeCloseTo(r, 8);
    expect(maxProjectableCos(p)).toBeGreaterThan(Math.cos(171 * DEG));
  });
});
