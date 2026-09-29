// Shared by the sky background and the ground overlay (prefix: projection.glsl).
uniform mat3 uViewToWorld; // camera rotation (camera at the origin)
uniform vec3 uSunDir;      // world, unit
uniform float uSkyLevel;   // 0 = night … 1 = full day

varying vec2 vNdc;

// World-space direction seen through this pixel, for any projection.
vec3 viewRay() {
  return normalize(uViewToWorld * unprojectNdc(vNdc));
}
