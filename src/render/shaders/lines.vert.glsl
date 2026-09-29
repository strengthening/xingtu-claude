// Great/small-circle polylines on the unit sphere (prefix: projection + atmosphere).
uniform float uRefract; // 1 for sky-fixed grids (refracted like stars), 0 for the alt-az grid
varying float vValid;

void main() {
  vec3 w = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  if (uRefract > 0.5) w = atmRefract(w);
  float valid;
  gl_Position = projectToClip((viewMatrix * vec4(w, 0.0)).xyz, valid);
  vValid = valid;
}
