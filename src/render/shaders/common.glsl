// Shared point-source model (stars, and planets when their disc is unresolved).
// Magnitudes are relative to the current limiting magnitude uLimMag.

uniform float uLimMag;     // faintest magnitude drawn
uniform float uPixelRatio; // device px per CSS px
uniform float uStarScale;  // user size factor (1.0 = default)

struct PointSource {
  float spriteRadius; // CSS px (half of gl_PointSize before DPR)
  float coreFrac;     // gaussian core radius / sprite radius
  float halo;         // 0..1 halo strength
  float intensity;    // 0..1 overall brightness
};

PointSource pointSource(float mag) {
  PointSource s;
  float dm = uLimMag - mag;
  float f = pow(10.0, 0.4 * clamp(dm, 0.0, 14.0)); // flux relative to a limit-magnitude star
  float core = uStarScale * clamp(pow(f, 0.27), 1.0, 12.0);
  s.halo = clamp((dm - 3.0) / 4.0, 0.0, 1.0);
  s.spriteRadius = max(core * (1.6 + 3.4 * s.halo), 1.6);
  s.coreFrac = core / s.spriteRadius;
  // fade in over the first magnitude so stars never pop at the limit,
  // and keep faint stars dimmer than bright ones
  s.intensity = smoothstep(0.0, 1.0, dm) * clamp(0.45 + 0.55 * dm / 3.5, 0.45, 1.0);
  return s;
}

// Radial profile of a point source; r = distance from sprite centre in sprite radii.
float pointProfile(float r, float coreFrac, float halo) {
  float x = r / coreFrac;
  float core = exp(-1.6 * x * x);
  float glow = halo * 0.55 * exp(-1.1 * x) * (1.0 - r);
  return core + glow;
}
