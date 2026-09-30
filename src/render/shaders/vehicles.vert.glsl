// Rockets and satellites as round sprites (prefix: projection + atmosphere).
// position = line of sight in the world frame (Earth-fixed objects: no sky matrix).
attribute vec3 aColor;
attribute float aSize;   // sprite diameter, CSS px

uniform float uPixelRatio;

varying vec3 vColor;

void main() {
  vec3 w = atmRefract(normalize(position));
  float valid;
  gl_Position = projectToClip((viewMatrix * vec4(w, 0.0)).xyz, valid);
  gl_PointSize = valid > 0.5 ? aSize * uPixelRatio : 0.0;
  vColor = aColor;
}
