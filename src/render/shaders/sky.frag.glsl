// Sky background: black at night, blue by day, warm glow toward the Sun at twilight.

void main() {
  vec3 dir = viewRay();
  float up = max(dir.y, 0.0);
  float nearHorizon = pow(1.0 - up, 4.0);

  vec3 night = mix(vec3(0.0), vec3(0.010, 0.014, 0.028), nearHorizon); // faint airglow
  vec3 day = mix(vec3(0.10, 0.27, 0.60), vec3(0.50, 0.66, 0.86), nearHorizon);
  vec3 col = mix(night, day, uSkyLevel);

  float sunAlt = uSunDir.y;
  float toSun = max(dot(dir, uSunDir), 0.0);
  // strongest just after sunset / before sunrise
  float twilight = smoothstep(-0.32, -0.02, sunAlt) * (1.0 - smoothstep(0.05, 0.35, sunAlt));
  col += vec3(0.95, 0.45, 0.16) * pow(toSun, 4.0) * nearHorizon * twilight * 0.55;
  // aureole around the Sun by day
  col += vec3(1.0, 0.95, 0.85) * (pow(toSun, 300.0) * 0.8 + pow(toSun, 12.0) * 0.12) * uSkyLevel;

  // moonlit sky (Krisciunas & Schaefer brightness → gentle blue-grey glow)
  float moonNl = atmMoonSkyNL(dir);
  col += vec3(0.075, 0.105, 0.17) * (1.0 - exp(-moonNl / 2500.0));

  // the user's atmosphere strength makes the whole glow translucent
  gl_FragColor = vec4(col * uAtmosphere * uAtmStrength, 1.0);
}
