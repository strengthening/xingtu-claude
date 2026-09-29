varying vec3 vColor;
varying float vCoreFrac;
varying float vHalo;
varying float vIntensity;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = pointProfile(r, vCoreFrac, vHalo) * vIntensity;
  gl_FragColor = vec4(vColor, a); // additive: dst += rgb · a
}
