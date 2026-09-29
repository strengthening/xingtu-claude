// Atmosphere, mirrors src/astro/atmosphere.ts. World frame: +y = zenith.
uniform float uAtmosphere;  // 0 = off, 1 = on
uniform float uExtinctionK; // mag per airmass
uniform vec3 uMoonDir;      // world, unit
uniform float uMoonFactor;  // I*·10^(−0.4 k X(moon)), 0 when the Moon is down
uniform float uAtmStrength; // 0–1 user strength: scales extinction, tint and sky-glow penalties

const float ATM_DEG = 0.017453292519943295;
const float DARK_SKY_NL = 85.6;

float atmAltDeg(vec3 w) {
  return asin(clamp(w.y, -1.0, 1.0)) / ATM_DEG;
}

// Kasten & Young (1989)
float atmAirmass(float altDeg) {
  float z = 90.0 - max(altDeg, -1.0);
  return 1.0 / (cos(z * ATM_DEG) + 0.50572 * pow(96.07995 - z, -1.6364));
}

// Sæmundsson refraction for a true altitude, degrees
float atmRefraction(float altDeg) {
  if (altDeg < -5.0) return 0.0;
  float h = max(altDeg, -1.9);
  float r = 1.02 / tan((h + 10.3 / (h + 5.11)) * ATM_DEG) / 60.0;
  return altDeg < -1.9 ? r * (altDeg + 5.0) / 3.1 : r;
}

// true world direction → apparent (refracted) world direction
vec3 atmRefract(vec3 w) {
  if (uAtmosphere < 0.5) return w;
  float hl = length(w.xz);
  if (hl < 1e-6) return w;
  float alt = atmAltDeg(w);
  float a = (alt + atmRefraction(alt)) * ATM_DEG;
  vec2 h = w.xz / hl * cos(a);
  return vec3(h.x, sin(a), h.y);
}

// magnitudes of extinction along an (apparent) direction
float atmExtinction(vec3 w) {
  if (uAtmosphere < 0.5) return 0.0;
  return uExtinctionK * uAtmStrength * atmAirmass(atmAltDeg(w));
}

// colour of starlight after passing through `airmass` of air
vec3 atmTint(vec3 w) {
  if (uAtmosphere < 0.5) return vec3(1.0);
  float t = clamp((atmAirmass(atmAltDeg(w)) - 1.0) / 14.0, 0.0, 1.0) * uAtmStrength;
  return mix(vec3(1.0), vec3(1.0, 0.7, 0.42), t);
}

// Krisciunas & Schaefer (1991) moonlit sky brightness, nanolamberts
float atmMoonSkyNL(vec3 w) {
  if (uAtmosphere < 0.5 || uMoonFactor <= 0.0 || w.y <= 0.0) return 0.0;
  float rho = max(acos(clamp(dot(w, uMoonDir), -1.0, 1.0)) / ATM_DEG, 0.5);
  float c = cos(rho * ATM_DEG);
  float f = 229086.765 * (1.06 + c * c) + pow(10.0, 6.15 - rho / 40.0);
  float z = (90.0 - clamp(atmAltDeg(w), 0.0, 90.0)) * ATM_DEG;
  float s = sin(z);
  float xks = 1.0 / sqrt(1.0 - 0.96 * s * s);
  return f * uMoonFactor * (1.0 - pow(10.0, -0.4 * uExtinctionK * xks));
}

float atmNelm(float sqm) {
  return 7.93 - 5.0 * log(pow(10.0, 4.316 - sqm / 5.0) + 1.0) / log(10.0);
}

float atmNlToSqm(float nl) {
  return (20.7233 - log(nl / 34.08)) / 0.92104;
}

// magnitudes lost to moonlight at a direction
float atmMoonPenalty(vec3 w) {
  float b = atmMoonSkyNL(w);
  if (b <= 0.0) return 0.0;
  return (atmNelm(atmNlToSqm(DARK_SKY_NL)) - atmNelm(atmNlToSqm(DARK_SKY_NL + b))) * uAtmStrength;
}
