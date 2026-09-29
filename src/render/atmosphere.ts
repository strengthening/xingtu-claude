import * as THREE from 'three';
import { EXTINCTION_K, refractionForTrueAltitude } from '../astro';

/** Uniforms for shaders/atmosphere.glsl, shared by reference between materials. */
export const atmosphereUniforms = {
  uAtmosphere: { value: 1 },
  uExtinctionK: { value: EXTINCTION_K },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonFactor: { value: 0 },
  uAtmStrength: { value: 1 },
};

export function updateAtmosphereUniforms(
  on: boolean,
  moonWorld: THREE.Vector3,
  moonFactor: number,
  strength: number,
): void {
  atmosphereUniforms.uAtmosphere.value = on ? 1 : 0;
  atmosphereUniforms.uMoonDir.value.copy(moonWorld);
  atmosphereUniforms.uMoonFactor.value = on ? moonFactor : 0;
  atmosphereUniforms.uAtmStrength.value = on ? strength : 0;
}

/** CPU twin of atmRefract(): lift a world direction by refraction (in place). */
export function refractWorld(v: THREE.Vector3, on: boolean): THREE.Vector3 {
  if (!on) return v;
  const hl = Math.hypot(v.x, v.z);
  if (hl < 1e-9) return v;
  const len = v.length();
  const alt = Math.asin(Math.max(-1, Math.min(1, v.y / len))) / (Math.PI / 180);
  const a = (alt + refractionForTrueAltitude(alt)) * (Math.PI / 180);
  const k = (Math.cos(a) / hl) * len;
  return v.set(v.x * k, Math.sin(a) * len, v.z * k);
}
