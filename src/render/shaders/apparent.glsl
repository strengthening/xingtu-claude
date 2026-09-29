// Catalogue place → apparent direction (J2000 axes). Mirrors src/astro/apparent.ts.
uniform float uYears;       // Julian years since J2000.0
uniform vec3 uAberration;   // Earth barycentric velocity / c, J2000 frame

vec3 apparentDir(vec3 p0, vec3 pm) {
  // float32: |p0| = 1 has a 6e-8 ulp (0.012″); pm·years and β (~1e-4) stay well above it
  vec3 p = normalize(p0 + pm * uYears);
  return normalize(p + uAberration);
}
