import * as THREE from 'three';
import {
  figureColor,
  loadSkyCulture,
  type SkyCulture,
  type SkyCultureId,
} from '../../data/skyculture';
import { apparentUniforms } from '../apparent';
import { atmosphereUniforms } from '../atmosphere';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import type { FrameContext, Layer } from '../context';
import { projectionUniforms } from '../projection';
import apparentGlsl from '../shaders/apparent.glsl?raw';
import figuresFrag from '../shaders/figures.frag.glsl?raw';
import figuresVert from '../shaders/figures.vert.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import { ORDER, makeSkyObject, setSkyMatrix } from '../util';
import { lineMaterial } from './GridLayer';

/** Great-circle tessellation step for figure segments (radians). */
const STEP = (2 * Math.PI) / 180;

interface Built {
  culture: SkyCulture;
  lines: THREE.LineSegments;
  boundaries: THREE.LineSegments | undefined;
}

/** Constellation / 星官 figures for the selected sky culture. */
export class ConstellationLayer implements Layer {
  readonly object = new THREE.Group();
  private readonly built = new Map<SkyCultureId, Built>();
  private readonly loading = new Set<SkyCultureId>();
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms = {
    ...projectionUniforms,
    ...apparentUniforms,
    ...atmosphereUniforms,
    uGapPx: { value: 5 },
    uPxPerRad: { value: 1000 },
    uOpacity: { value: 1 },
  };
  /** Culture currently shown (for labels / picking), if loaded. */
  active: SkyCulture | undefined;

  constructor() {
    this.object.name = 'constellations';
    this.material = new THREE.ShaderMaterial({
      name: 'FigureMaterial',
      uniforms: this.uniforms,
      vertexShader: `${projectionGlsl}\n${apparentGlsl}\n${atmosphereGlsl}\n${figuresVert}`,
      fragmentShader: figuresFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  update(ctx: FrameContext): void {
    const want = ctx.settings.constellations;
    for (const [id, b] of this.built) {
      const on = id === want;
      b.lines.visible = on && ctx.settings.showConstellationLines;
      if (b.boundaries) b.boundaries.visible = on && ctx.settings.showMansionBoundaries;
      if (on) {
        setSkyMatrix(b.lines, ctx.eqjToWorld);
        if (b.boundaries) setSkyMatrix(b.boundaries, ctx.eqjToWorld);
      }
    }
    this.active = want === 'off' ? undefined : this.built.get(want)?.culture;
    if (want !== 'off' && !this.built.has(want) && !this.loading.has(want)) this.load(want);

    this.uniforms.uPxPerRad.value = ctx.projection.pxPerRad;
    this.uniforms.uGapPx.value = 5 * ctx.settings.starScale;
    // daylight washes the figures out a little, like the stars
    this.uniforms.uOpacity.value = 1 - 0.6 * ctx.sky.level * ctx.atmStrength;
  }

  private load(id: SkyCultureId): void {
    this.loading.add(id);
    loadSkyCulture(id)
      .then((culture) => {
        const lines = makeSkyObject(
          new THREE.LineSegments(buildFigures(culture), this.material),
          ORDER.figures,
        );
        lines.name = `figures-${id}`;
        lines.visible = false;
        let boundaries: THREE.LineSegments | undefined;
        if (culture.boundaries?.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute(
            'position',
            new THREE.BufferAttribute(polylinesToSegments(culture.boundaries), 3),
          );
          boundaries = makeSkyObject(
            new THREE.LineSegments(g, lineMaterial(0xb58a4a, 0.35)),
            ORDER.grids,
          );
          boundaries.visible = false;
          this.object.add(boundaries);
        }
        this.object.add(lines);
        this.built.set(id, { culture, lines, boundaries });
      })
      .catch((err: unknown) => console.error(err))
      .finally(() => this.loading.delete(id));
  }

  dispose(): void {
    for (const b of this.built.values()) {
      b.lines.geometry.dispose();
      b.boundaries?.geometry.dispose();
      (b.boundaries?.material as THREE.Material | undefined)?.dispose();
    }
    this.material.dispose();
  }
}

function buildFigures(c: SkyCulture): THREE.BufferGeometry {
  const pos: number[] = [];
  const apm: number[] = [];
  const bpos: number[] = [];
  const bpm: number[] = [];
  const ts: number[] = [];
  const colors: number[] = [];
  const alphas: number[] = [];
  const color = new THREE.Color();
  for (const f of c.figures) {
    color.setHex(figureColor(c.id, f));
    const alpha = c.id === 'western' ? 0.55 : f.mansion ? 0.9 : 0.55;
    for (const poly of f.lines) {
      for (let k = 0; k + 1 < poly.length; k++) {
        const A = c.vertices[poly[k] ?? -1];
        const B = c.vertices[poly[k + 1] ?? -1];
        if (!A || !B) continue;
        const dot = A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
        const n = Math.max(1, Math.ceil(Math.acos(Math.min(1, Math.max(-1, dot))) / STEP));
        for (let i = 0; i < n; i++) {
          for (const t of [i / n, (i + 1) / n]) {
            pos.push(A[0], A[1], A[2]);
            apm.push(A[3], A[4], A[5]);
            bpos.push(B[0], B[1], B[2]);
            bpm.push(B[3], B[4], B[5]);
            ts.push(t);
            colors.push(color.r, color.g, color.b);
            alphas.push(alpha);
          }
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aApm', new THREE.Float32BufferAttribute(apm, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(bpos, 3));
  g.setAttribute('aBpm', new THREE.Float32BufferAttribute(bpm, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return g;
}

function polylinesToSegments(lines: number[][]): Float32Array {
  const out: number[] = [];
  for (const l of lines) {
    for (let i = 0; i + 5 < l.length; i += 3) {
      out.push(
        l[i] ?? 0,
        l[i + 1] ?? 0,
        l[i + 2] ?? 0,
        l[i + 3] ?? 0,
        l[i + 4] ?? 0,
        l[i + 5] ?? 0,
      );
    }
  }
  return new Float32Array(out);
}
