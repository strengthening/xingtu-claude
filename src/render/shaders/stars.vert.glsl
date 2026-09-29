// position: J2000 unit vector at epoch 2000.0; aPm: its proper motion (rad/yr).
// Everything per star runs here on the GPU — never per star on the CPU:
// proper motion + aberration (apparent.glsl), equatorial→horizontal rotation
// (modelMatrix = eqjToWorld), refraction, extinction and moonlight (atmosphere.glsl).
attribute vec3 aPm;
attribute float aMag;
attribute vec3 aColor;

varying vec3 vColor;
varying float vCoreFrac;
varying float vHalo;
varying float vIntensity;

void main() {
  vec3 dir = apparentDir(position, aPm);
  vec3 w = atmRefract(normalize((modelMatrix * vec4(dir, 0.0)).xyz));
  PointSource s = pointSource(aMag + atmExtinction(w) + atmMoonPenalty(w));
  float valid;
  vec4 clip = projectToClip((viewMatrix * vec4(w, 0.0)).xyz, valid);
  if (s.intensity <= 0.001 || valid < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space → culled
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = clip;
  gl_PointSize = 2.0 * s.spriteRadius * uPixelRatio;
  vColor = aColor * atmTint(w);
  vCoreFrac = s.coreFrac;
  vHalo = s.halo;
  vIntensity = s.intensity;
}
