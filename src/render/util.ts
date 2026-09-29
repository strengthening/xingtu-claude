import * as THREE from 'three';
import type { Mat3, Vec3 } from '../astro';

/** Column-major 3×3 rotation → 4×4 (Three's Matrix4.elements is column-major too). */
export function mat3ToMatrix4(m: Mat3, out = new THREE.Matrix4()): THREE.Matrix4 {
  const e = out.elements;
  e[0] = m[0] ?? 0;
  e[1] = m[1] ?? 0;
  e[2] = m[2] ?? 0;
  e[3] = 0;
  e[4] = m[3] ?? 0;
  e[5] = m[4] ?? 0;
  e[6] = m[5] ?? 0;
  e[7] = 0;
  e[8] = m[6] ?? 0;
  e[9] = m[7] ?? 0;
  e[10] = m[8] ?? 0;
  e[11] = 0;
  e[12] = 0;
  e[13] = 0;
  e[14] = 0;
  e[15] = 1;
  return out;
}

export function vec3(v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v[0], v[1], v[2]);
}

/** Objects placed on the celestial sphere are posed via an explicit matrix every frame. */
export function makeSkyObject<T extends THREE.Object3D>(obj: T, renderOrder: number): T {
  obj.matrixAutoUpdate = false;
  obj.frustumCulled = false;
  obj.renderOrder = renderOrder;
  return obj;
}

export function setSkyMatrix(obj: THREE.Object3D, m: THREE.Matrix4): void {
  obj.matrix.copy(m);
  obj.matrixWorldNeedsUpdate = true;
}

/** Draw order (lower first). Everything sits "at infinity"; depth testing is off. */
export const ORDER = {
  sky: 0,
  hips: 5,
  grids: 10,
  figures: 12,
  stars: 20,
  bodies: 30,
  ground: 40,
} as const;
