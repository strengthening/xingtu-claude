// Sun / Moon / planets as camera-facing quads (instanced), so discs can grow
// beyond the GPU's max point size when zoomed in.
// Instance centre is a J2000 unit vector; modelMatrix = eqjToWorld.
attribute vec2 aCorner;   // quad corner in [-1, 1]²
attribute vec3 aCenter;   // J2000 direction
attribute vec3 aLight;    // J2000 direction from the body toward the Sun
attribute vec3 aColor;
attribute float aMag;
attribute float aRadius;  // apparent angular radius, radians
attribute float aKind;    // 0 planet, 1 Sun, 2 Moon
attribute float aPhase;   // illuminated fraction (glow strength of the Moon)

uniform vec2 uViewport;   // CSS px
uniform float uPxPerRad;  // CSS px per radian at the view centre

varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vDiskFrac;
varying float vDiskPx;
varying float vSpritePx;
varying float vPhase;
varying float vCoreFrac;
varying float vHalo;
varying float vIntensity;
varying vec3 vLight;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToViewer;
varying vec3 vAtm;

void main() {
  vec3 w = atmRefract(normalize((modelMatrix * vec4(aCenter, 0.0)).xyz));
  vec3 mvDir = (viewMatrix * vec4(w, 0.0)).xyz;
  float ext = atmExtinction(w);
  float valid;
  vec4 clip = projectToClip(mvDir, valid);

  bool isSun = aKind > 0.5 && aKind < 1.5;
  bool isMoon = aKind > 1.5;
  // true angular size, magnified like the projection does locally
  float diskPx = aRadius * uPxPerRad * projLocalScale(mvDir);
  if (isSun || isMoon) diskPx = max(diskPx, 3.0);

  PointSource ps = pointSource(aMag + ext + atmMoonPenalty(w));
  float sprite;
  if (isSun) sprite = max(diskPx * 7.0, 48.0);
  else if (isMoon) sprite = max(diskPx * 2.5, diskPx + 28.0);
  else sprite = max(ps.spriteRadius, diskPx * 1.25);

  bool hidden = !isSun && !isMoon && ps.intensity <= 0.001 && diskPx < 1.0;
  if (hidden || valid < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  gl_Position = clip + vec4(aCorner * sprite * 2.0 / uViewport, 0.0, 0.0);

  vUv = aCorner;
  vColor = aColor;
  vKind = aKind;
  vDiskPx = diskPx;
  vSpritePx = sprite;
  vPhase = aPhase;
  vDiskFrac = diskPx / sprite;
  vCoreFrac = ps.spriteRadius * ps.coreFrac / sprite;
  vHalo = ps.halo;
  vIntensity = ps.intensity;

  vToViewer = -normalize(mvDir);
  vRight = normalize(cross(vec3(0.0, 1.0, 0.0), vToViewer));
  vUp = cross(vToViewer, vRight);
  vLight = normalize((modelViewMatrix * vec4(aLight, 0.0)).xyz);
  // discs: redden and dim near the horizon (gently — the eye adapts to a setting Sun)
  vAtm = atmTint(w) * max(pow(10.0, -0.1 * ext), 0.3);
}
