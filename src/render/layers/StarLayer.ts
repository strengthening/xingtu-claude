import * as THREE from 'three';
import { bvToRgb, tierNeeded } from '../../astro';
import { FIELD_OFFSET, type StarChunk } from '../../data/StarCatalog';
import type { FrameContext, Layer } from '../context';
import { apparentUniforms } from '../apparent';
import { atmosphereUniforms } from '../atmosphere';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import { projectionUniforms } from '../projection';
import apparentGlsl from '../shaders/apparent.glsl?raw';
import commonGlsl from '../shaders/common.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import fragGlsl from '../shaders/stars.frag.glsl?raw';
import vertGlsl from '../shaders/stars.vert.glsl?raw';
import { ORDER, makeSkyObject, setSkyMatrix } from '../util';

interface ChunkMesh {
  magMin: number | null;
  points: THREE.Points;
}

/**
 * One THREE.Points per loaded chunk (all-sky tier or HEALPix tile), all
 * sharing a ShaderMaterial. Vertex data is the raw interleaved Float32 chunk.
 */
export class StarLayer implements Layer {
  readonly object = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private readonly chunks = new Map<string, ChunkMesh>();
  private readonly uniforms = {
    ...projectionUniforms,
    ...apparentUniforms,
    ...atmosphereUniforms,
    uLimMag: { value: 6 },
    uPixelRatio: { value: 1 },
    uStarScale: { value: 1 },
  };

  constructor() {
    this.object.name = 'stars';
    this.material = new THREE.ShaderMaterial({
      name: 'StarMaterial',
      vertexShader: `${projectionGlsl}\n${apparentGlsl}\n${atmosphereGlsl}\n${commonGlsl}\n${vertGlsl}`,
      fragmentShader: `${commonGlsl}\n${fragGlsl}`,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  get drawnChunks(): number {
    return this.chunks.size;
  }

  addChunk(chunk: StarChunk): void {
    const { data, stride, count } = chunk;
    const ib = new THREE.InterleavedBuffer(data, stride);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, FIELD_OFFSET.x));
    geom.setAttribute('aPm', new THREE.InterleavedBufferAttribute(ib, 3, FIELD_OFFSET.pmx));
    geom.setAttribute('aMag', new THREE.InterleavedBufferAttribute(ib, 1, FIELD_OFFSET.mag));

    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const [r, g, b] = bvToRgb(data[i * stride + FIELD_OFFSET.ci] ?? Number.NaN);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    // Unit sphere around the camera: bounds are trivially known.
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

    const points = makeSkyObject(new THREE.Points(geom, this.material), ORDER.stars);
    points.name = `stars-${chunk.key}`;
    this.chunks.set(chunk.key, { magMin: chunk.tier.magMin, points });
    this.object.add(points);
  }

  removeChunk(chunk: StarChunk): void {
    const c = this.chunks.get(chunk.key);
    if (!c) return;
    this.object.remove(c.points);
    c.points.geometry.dispose();
    this.chunks.delete(chunk.key);
  }

  update(ctx: FrameContext): void {
    const u = this.uniforms;
    u.uLimMag.value = ctx.limMag;
    u.uPixelRatio.value = ctx.pixelRatio;
    u.uStarScale.value = ctx.settings.starScale;
    for (const c of this.chunks.values()) {
      c.points.visible = tierNeeded(c.magMin, ctx.limMag);
      setSkyMatrix(c.points, ctx.eqjToWorld);
    }
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.points.geometry.dispose();
    this.material.dispose();
  }
}
