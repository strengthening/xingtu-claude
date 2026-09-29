import * as THREE from 'three';
import type { FrameContext, Layer } from '../context';
import groundFrag from '../shaders/ground.frag.glsl?raw';
import fullscreenVert from '../shaders/fullscreen.vert.glsl?raw';
import skyFrag from '../shaders/sky.frag.glsl?raw';
import projectionGlsl from '../shaders/projection.glsl?raw';
import skyCommon from '../shaders/sky.glsl?raw';
import { atmosphereUniforms } from '../atmosphere';
import { projectionUniforms } from '../projection';
import atmosphereGlsl from '../shaders/atmosphere.glsl?raw';
import { ORDER } from '../util';

function fullscreenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return g;
}

/** Ground opacity when the ground is "hidden": below-horizon sky is only dimmed. */
const GROUND_DIMMED = 0.35;

/**
 * Sky background (drawn first) and ground + horizon line (drawn after the sky
 * objects). Both are per-pixel full-screen passes, so they work at any FOV and
 * are independent of the projection.
 */
export class HorizonLayer implements Layer {
  readonly object = new THREE.Group();
  private readonly geometry = fullscreenTriangle();
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly groundMaterial: THREE.ShaderMaterial;
  private readonly uniforms = {
    ...projectionUniforms,
    ...atmosphereUniforms,
    uViewToWorld: { value: new THREE.Matrix3() },
    uSunDir: { value: new THREE.Vector3(0, -1, 0) },
    uSkyLevel: { value: 0 },
    uGroundOpacity: { value: 1 },
    uGroundColor: { value: new THREE.Color(0.045, 0.05, 0.038) },
    uHorizonColor: { value: new THREE.Color(0.62, 0.42, 0.28) },
  };

  constructor() {
    this.object.name = 'horizon';
    const common = {
      uniforms: this.uniforms,
      vertexShader: fullscreenVert,
      depthTest: false,
      depthWrite: false,
    };
    this.skyMaterial = new THREE.ShaderMaterial({
      ...common,
      name: 'SkyMaterial',
      fragmentShader: `${projectionGlsl}\n${skyCommon}\n${atmosphereGlsl}\n${skyFrag}`,
      blending: THREE.NoBlending,
    });
    this.groundMaterial = new THREE.ShaderMaterial({
      ...common,
      name: 'GroundMaterial',
      fragmentShader: `${projectionGlsl}\n${skyCommon}\n${groundFrag}`,
      transparent: true,
      blending: THREE.NormalBlending,
    });
    const sky = new THREE.Mesh(this.geometry, this.skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = ORDER.sky;
    const ground = new THREE.Mesh(this.geometry, this.groundMaterial);
    ground.frustumCulled = false;
    ground.renderOrder = ORDER.ground;
    this.object.add(sky, ground);
  }

  update(ctx: FrameContext): void {
    const u = this.uniforms;
    u.uViewToWorld.value.setFromMatrix4(ctx.camera.matrixWorld);
    u.uSunDir.value.copy(ctx.sunWorld);
    u.uSkyLevel.value = ctx.sky.level;
    u.uGroundOpacity.value = ctx.settings.showGround ? 1 : GROUND_DIMMED;
  }

  dispose(): void {
    this.geometry.dispose();
    this.skyMaterial.dispose();
    this.groundMaterial.dispose();
  }
}
