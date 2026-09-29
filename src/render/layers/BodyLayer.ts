import * as THREE from 'three';
import { BODY_IDS, DEG, normalize, type BodyId, type BodyState } from '../../astro';
import type { FrameContext, Layer } from '../context';
import fragGlsl from '../shaders/bodies.frag.glsl?raw';
import vertGlsl from '../shaders/bodies.vert.glsl?raw';
import commonGlsl from '../shaders/common.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import { atmosphereUniforms } from '../atmosphere';
import { projectionUniforms } from '../projection';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import { ORDER, makeSkyObject, setSkyMatrix } from '../util';

export const BODY_NAMES_ZH: Record<BodyId, string> = {
  Sun: '太阳',
  Moon: '月球',
  Mercury: '水星',
  Venus: '金星',
  Mars: '火星',
  Jupiter: '木星',
  Saturn: '土星',
  Uranus: '天王星',
  Neptune: '海王星',
};

const BODY_COLORS: Record<BodyId, [number, number, number]> = {
  Sun: [1.0, 0.96, 0.86],
  Moon: [0.92, 0.9, 0.86],
  Mercury: [0.85, 0.8, 0.74],
  Venus: [1.0, 0.97, 0.88],
  Mars: [1.0, 0.62, 0.42],
  Jupiter: [1.0, 0.92, 0.8],
  Saturn: [1.0, 0.9, 0.7],
  Uranus: [0.72, 0.92, 0.95],
  Neptune: [0.6, 0.72, 1.0],
};

const KIND: Record<BodyId, number> = {
  Sun: 1,
  Moon: 2,
  Mercury: 0,
  Venus: 0,
  Mars: 0,
  Jupiter: 0,
  Saturn: 0,
  Uranus: 0,
  Neptune: 0,
};

/** Sun, Moon and planets drawn as instanced camera-facing quads. */
export class BodyLayer implements Layer {
  readonly object: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly light: THREE.InstancedBufferAttribute;
  private readonly mag: THREE.InstancedBufferAttribute;
  private readonly radius: THREE.InstancedBufferAttribute;
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly uniforms = {
    ...projectionUniforms,
    ...atmosphereUniforms,
    uLimMag: { value: 6 },
    uPixelRatio: { value: 1 },
    uStarScale: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPxPerRad: { value: 1 },
  };

  constructor() {
    const n = BODY_IDS.length;
    const g = this.geometry;
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute(
      'aCorner',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2),
    );
    // three.js requires a `position` attribute for draw-range bookkeeping
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.light = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mag = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.radius = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const color = new THREE.InstancedBufferAttribute(
      new Float32Array(BODY_IDS.flatMap((id) => BODY_COLORS[id])),
      3,
    );
    const kind = new THREE.InstancedBufferAttribute(
      new Float32Array(BODY_IDS.map((id) => KIND[id])),
      1,
    );
    for (const a of [this.center, this.light, this.mag, this.radius, this.phase])
      a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCenter', this.center);
    g.setAttribute('aLight', this.light);
    g.setAttribute('aMag', this.mag);
    g.setAttribute('aRadius', this.radius);
    g.setAttribute('aPhase', this.phase);
    g.setAttribute('aColor', color);
    g.setAttribute('aKind', kind);
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

    this.material = new THREE.ShaderMaterial({
      name: 'BodyMaterial',
      vertexShader: `${projectionGlsl}\n${atmosphereGlsl}\n${commonGlsl}\n${vertGlsl}`,
      fragmentShader: `${commonGlsl}\n${fragGlsl}`,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.object = makeSkyObject(new THREE.Mesh(g, this.material), ORDER.bodies);
    this.object.name = 'bodies';
  }

  update(ctx: FrameContext): void {
    this.object.visible = ctx.settings.showBodies;
    if (!this.object.visible) return;
    const u = this.uniforms;
    u.uLimMag.value = ctx.limMag;
    u.uPixelRatio.value = ctx.pixelRatio;
    u.uStarScale.value = ctx.settings.starScale;
    u.uViewport.value.set(ctx.width, ctx.height);
    u.uPxPerRad.value = ctx.projection.pxPerRad;

    const sun = ctx.bodies.find((b) => b.id === 'Sun');
    ctx.bodies.forEach((b, i) => {
      this.center.setXYZ(i, b.eqj[0], b.eqj[1], b.eqj[2]);
      const l = sun ? lightDirection(b, sun) : [0, 0, 1];
      this.light.setXYZ(i, l[0] ?? 0, l[1] ?? 0, l[2] ?? 1);
      this.mag.setX(i, b.mag);
      this.radius.setX(i, (b.diameterDeg / 2) * DEG);
      this.phase.setX(i, b.phase);
    });
    this.center.needsUpdate = true;
    this.light.needsUpdate = true;
    this.mag.needsUpdate = true;
    this.radius.needsUpdate = true;
    this.phase.needsUpdate = true;
    setSkyMatrix(this.object, ctx.eqjToWorld);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Unit vector from a body toward the Sun (J2000), from topocentric positions. */
function lightDirection(body: BodyState, sun: BodyState): readonly number[] {
  if (body.id === 'Sun') return [0, 0, 1];
  return normalize([
    sun.eqj[0] * sun.distAu - body.eqj[0] * body.distAu,
    sun.eqj[1] * sun.distAu - body.eqj[1] * body.distAu,
    sun.eqj[2] * sun.distAu - body.eqj[2] * body.distAu,
  ]);
}

/** On-screen radius (CSS px) of a body's disc (at least a few px), for label offsets. */
export function bodyMarkerRadiusPx(b: BodyState, pxPerDeg: number): number {
  const disk = (b.diameterDeg / 2) * pxPerDeg;
  if (b.id === 'Sun') return Math.max(disk * 1.4, 20);
  if (b.id === 'Moon') return Math.max(disk, 8);
  return Math.max(disk, 3);
}
