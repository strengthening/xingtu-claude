uniform vec3 uColor;
uniform float uOpacity;
varying float vValid;

void main() {
  // a segment touching an unprojectable vertex would streak across the screen
  if (vValid < 0.999) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}
