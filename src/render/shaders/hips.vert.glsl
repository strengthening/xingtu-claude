// HiPS tile patch (prefix: projection + atmosphere). position = J2000 unit vector.
varying vec2 vUv;
varying float vValid;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vec3 w = atmRefract(normalize((modelMatrix * vec4(position, 0.0)).xyz));
  vWorld = w;
  float valid;
  gl_Position = projectToClip((viewMatrix * vec4(w, 0.0)).xyz, valid);
  vValid = valid;
}
