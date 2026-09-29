uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vValid;

void main() {
  if (vValid < 0.999) discard;
  gl_FragColor = vec4(vColor, vAlpha * uOpacity);
}
