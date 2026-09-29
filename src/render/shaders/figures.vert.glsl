// Constellation segments (prefix: projection.glsl + apparent.glsl).
// Each vertex knows both segment end stars (position = A) and its fraction t
// along the great circle, so figures follow proper motion and stay curved
// correctly under any projection. The ends are pulled back by uGapPx pixels
// so lines do not touch the star discs.
attribute vec3 aApm;
attribute vec3 aB;
attribute vec3 aBpm;
attribute float aT;
attribute vec3 aColor;
attribute float aAlpha;

uniform float uGapPx;
uniform float uPxPerRad;

varying vec3 vColor;
varying float vAlpha;
varying float vValid;

void main() {
  vec3 a = apparentDir(position, aApm);
  vec3 b = apparentDir(aB, aBpm);
  float ang = acos(clamp(dot(a, b), -1.0, 1.0));
  float g = uGapPx / max(ang * uPxPerRad, 1e-6);
  float t = mix(g, 1.0 - g, aT);
  vec3 d = normalize(mix(a, b, t));
  vec3 w = atmRefract(normalize((modelMatrix * vec4(d, 0.0)).xyz));
  float valid;
  gl_Position = projectToClip((viewMatrix * vec4(w, 0.0)).xyz, valid);
  vValid = valid * step(g, 0.45); // segment too short on screen: hide
  vColor = aColor;
  vAlpha = aAlpha;
}
