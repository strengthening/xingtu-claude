varying vec3 vColor;

void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  // bright core with a soft glow
  float core = 1.0 - smoothstep(0.18, 0.34, r);
  float glow = exp(-r * r * 5.0) * 0.8;
  float a = max(core, glow);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.55), a);
}
