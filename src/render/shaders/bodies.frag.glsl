// Output is premultiplied: rgb = light added, a = coverage of the solid disc.
// Blend ONE, ONE_MINUS_SRC_ALPHA → discs occlude stars, glows add light.
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
  float r = length(vUv);
  if (r > 1.0) discard;

  float q = r / max(vDiskFrac, 1e-4); // 1 at the limb
  float aa = max(fwidth(q), 1e-4);
  float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, q);

  vec3 disk;
  vec3 glow = vec3(0.0);
  float limbPx = max(r - vDiskFrac, 0.0) * vSpritePx; // distance outside the limb, px
  if (vKind > 0.5 && vKind < 1.5) {
    // Sun: limb-darkened disc + wide soft glow
    float mu = sqrt(max(1.0 - q * q, 0.0));
    disk = vColor * (0.45 + 0.55 * mu) * 1.2;
    glow = vColor * (0.6 * exp(-limbPx / 5.0) + 0.18 * exp(-limbPx / 28.0)) * (1.0 - r);
  } else {
    vec2 d = vUv / max(vDiskFrac, 1e-4);
    float z = sqrt(max(1.0 - dot(d, d), 0.0));
    vec3 n = normalize(d.x * vRight + d.y * vUp + z * vToViewer);
    float mu0 = dot(n, vLight); // cos incidence
    if (vKind > 1.5) {
      // Moon: Lommel–Seeliger (regolith looks evenly bright up to the terminator)
      float mu = max(z, 1e-3);
      float ls = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
      disk = vColor * (0.92 * ls + 0.03);
      glow = vColor * vPhase * (0.28 * exp(-limbPx / 4.0) + 0.06 * exp(-limbPx / 14.0)) * (1.0 - r);
    } else {
      disk = vColor * max(mu0, 0.0);
    }
  }

  // Unresolved planets look like stars; the point-source fades out as the disc grows.
  float point = 0.0;
  if (vKind < 0.5) {
    point = pointProfile(r, vCoreFrac, vHalo) * vIntensity * (1.0 - smoothstep(1.5, 5.0, vDiskPx));
    cover *= smoothstep(0.8, 2.0, vDiskPx);
  }

  vec3 rgb = (disk * cover + (glow + vColor * point) * (1.0 - cover)) * vAtm;
  gl_FragColor = vec4(rgb, cover);
}
