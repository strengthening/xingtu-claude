// Ground below the horizon + the horizon line. Drawn after stars/planets/grids,
// so it occludes everything below altitude 0 (partially when uGroundOpacity < 1).
uniform float uGroundOpacity;
uniform vec3 uGroundColor;
uniform vec3 uHorizonColor;
uniform float uAtmStrength; // daylight on the ground follows the sky's strength

void main() {
  vec3 dir = viewRay();
  float alt = asin(clamp(dir.y, -1.0, 1.0));
  float w = max(fwidth(alt), 1e-6);

  float below = smoothstep(0.5 * w, -0.5 * w, alt);
  vec3 ground = uGroundColor * mix(0.35, 1.0, uSkyLevel * uAtmStrength);
  ground *= mix(1.0, 0.5, clamp(-dir.y * 1.5, 0.0, 1.0)); // darker toward the nadir
  float a = below * uGroundOpacity;

  float line = 1.0 - smoothstep(0.6 * w, 1.6 * w, abs(alt));
  vec3 col = mix(ground, uHorizonColor, line);
  a = max(a, line * 0.85);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(col, a);
}
