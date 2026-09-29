// Additive survey light; the stencil keeps overlapping LOD levels from adding twice.
uniform sampler2D uMap;
uniform float uBrightness;
uniform float uBlackPoint;
varying vec2 vUv;
varying float vValid;
varying vec3 vWorld;

void main() {
  if (vValid < 0.999) discard;
  vec3 c = texture2D(uMap, vUv).rgb;
  // lift the survey's residual sky background out so dark sky stays dark
  c = max(c - uBlackPoint, 0.0) / (1.0 - uBlackPoint);
  float ext = atmExtinction(normalize(vWorld));
  gl_FragColor = vec4(c * atmTint(vWorld) * uBrightness * pow(10.0, -0.4 * ext), 1.0);
}
