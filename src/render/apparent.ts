import * as THREE from 'three';
import type { Vec3 } from '../astro';

/**
 * Uniforms for shaders/apparent.glsl, shared by reference between every
 * material that draws catalogue stars (star points, constellation lines).
 */
export const apparentUniforms = {
  uYears: { value: 0 },
  uAberration: { value: new THREE.Vector3() },
};

export function updateApparentUniforms(years: number, beta: Vec3): void {
  apparentUniforms.uYears.value = years;
  apparentUniforms.uAberration.value.set(beta[0], beta[1], beta[2]);
}
