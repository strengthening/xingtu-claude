import * as THREE from 'three';
import {
  maxProjectableCos,
  projectView,
  projectionScale,
  pxPerRadian,
  viewRadiusDeg,
  type Projection,
} from '../astro/projection';

/** Per-frame projection parameters (derived once, used by layers, labels and picking). */
export interface ProjectionState extends Projection {
  scale: number;
  /** CSS px per radian at the view centre. */
  pxPerRad: number;
  /** Angular radius of the viewport corner, degrees. */
  viewRadiusDeg: number;
  maxCos: number;
}

export function makeProjectionState(p: Projection, heightPx: number): ProjectionState {
  return {
    ...p,
    scale: projectionScale(p.mode, p.fov),
    pxPerRad: pxPerRadian(heightPx, p),
    viewRadiusDeg: viewRadiusDeg(p),
    maxCos: maxProjectableCos(p),
  };
}

/**
 * Uniform objects shared by reference between all sky materials
 * (spread them into a material's `uniforms`), updated once per frame.
 */
export const projectionUniforms = {
  uProjMode: { value: 1 },
  uProjScale: { value: 1 },
  uAspect: { value: 1 },
  uProjMaxCos: { value: -0.9 },
};

export function updateProjectionUniforms(p: ProjectionState): void {
  projectionUniforms.uProjMode.value = p.mode === 'perspective' ? 0 : 1;
  projectionUniforms.uProjScale.value = p.scale;
  projectionUniforms.uAspect.value = p.aspect;
  projectionUniforms.uProjMaxCos.value = p.maxCos;
}

const tmp = new THREE.Vector3();

/** World direction → screen position in CSS px, or null if not visible/projectable. */
export function worldToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  p: ProjectionState,
  width: number,
  height: number,
): [number, number] | null {
  tmp.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const ndc = projectView([tmp.x, tmp.y, tmp.z], p);
  if (!ndc) return null;
  return [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
}
