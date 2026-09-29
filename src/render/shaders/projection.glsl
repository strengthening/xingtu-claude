// Sky projection shared by every sky shader. Mirrors src/astro/projection.ts.
// View space: camera looks down −z. Output clip w is always 1 (no perspective divide).
uniform float uProjMode;    // 0 = perspective (gnomonic), 1 = stereographic
uniform float uProjScale;   // NDC-y units per plane unit
uniform float uAspect;      // viewport width / height
uniform float uProjMaxCos;  // directions further off-axis than this are not projectable

// Returns NDC xy; `valid` is 0 when the direction must not be drawn.
vec2 projectDir(vec3 v, out float valid) {
  vec3 d = normalize(v);
  float c = -d.z;
  valid = step(uProjMaxCos, c);
  float k = uProjMode < 0.5 ? 1.0 / max(c, 1e-4) : 2.0 / max(1.0 + c, 1e-4);
  vec2 p = d.xy * k * uProjScale;
  return vec2(p.x / uAspect, p.y);
}

vec4 projectToClip(vec3 v, out float valid) {
  return vec4(projectDir(v, valid), 0.0, 1.0);
}

// Linear magnification relative to the view centre (stereographic is conformal).
float projLocalScale(vec3 v) {
  float c = clamp(-normalize(v).z, -0.999, 1.0);
  return uProjMode < 0.5 ? 1.0 / max(c, 1e-3) : 2.0 / (1.0 + c);
}

// NDC → unit view-space direction.
vec3 unprojectNdc(vec2 ndc) {
  vec2 p = vec2(ndc.x * uAspect, ndc.y) / uProjScale;
  if (uProjMode < 0.5) return normalize(vec3(p, -1.0));
  float r2 = dot(p, p);
  return vec3(4.0 * p, r2 - 4.0) / (r2 + 4.0);
}
