/**
 * Pure helpers for turning catalogue rows into render data. Unit-tested in
 * tests/scripts/catalog.test.ts.
 */

const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);
const DEG = Math.PI / 180;

/** RA (hours) / Dec (deg) → J2000 unit vector. */
export function raDecToUnit(raHours: number, decDeg: number): [number, number, number] {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/**
 * Proper motion (μα* = μα·cosδ and μδ, mas/yr) → rate of change of the unit
 * vector, rad/yr:  ṗ = μα*·ê_α + μδ·ê_δ.
 */
export function properMotionVector(
  raHours: number,
  decDeg: number,
  pmRaCosDec: number,
  pmDec: number,
): [number, number, number] {
  if (!Number.isFinite(pmRaCosDec) || !Number.isFinite(pmDec)) return [0, 0, 0];
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  const a = pmRaCosDec * MAS_TO_RAD;
  const d = pmDec * MAS_TO_RAD;
  const sa = Math.sin(ra);
  const ca = Math.cos(ra);
  const sd = Math.sin(dec);
  const cd = Math.cos(dec);
  return [-a * sa - d * sd * ca, a * ca - d * sd * sa, d * cd];
}

/**
 * Tycho-2 VT / BT−VT → Johnson V / B−V (ESA 1997, Vol. 1 §1.3, Appendix 4):
 *   V = VT − 0.090 (BT−VT),  B−V = 0.850 (BT−VT).
 */
export function tychoToJohnson(vt: number, btvt: number): { v: number; bv: number } {
  if (!Number.isFinite(btvt)) return { v: vt, bv: Number.NaN };
  return { v: vt - 0.09 * btvt, bv: 0.85 * btvt };
}

const GREEK: Record<string, string> = {
  Alp: 'α',
  Bet: 'β',
  Gam: 'γ',
  Del: 'δ',
  Eps: 'ε',
  Zet: 'ζ',
  Eta: 'η',
  The: 'θ',
  Iot: 'ι',
  Kap: 'κ',
  Lam: 'λ',
  Mu: 'μ',
  Nu: 'ν',
  Xi: 'ξ',
  Omi: 'ο',
  Pi: 'π',
  Rho: 'ρ',
  Sig: 'σ',
  Tau: 'τ',
  Ups: 'υ',
  Phi: 'φ',
  Chi: 'χ',
  Psi: 'ψ',
  Ome: 'ω',
};
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** "Kap-1", "Ori" → "κ¹ Ori"; flamsteed-only → "58 Ori"; nothing → "". */
export function formatDesignation(bayer: string, flam: string, con: string): string {
  const b = bayer.trim();
  const f = flam.trim();
  const c = con.trim();
  if (!c) return '';
  if (b) {
    const [letter = '', index] = b.split('-');
    const greek = GREEK[letter] ?? letter;
    const sup = index ? [...index].map((d) => SUPERSCRIPT[Number(d)] ?? d).join('') : '';
    return `${greek}${sup} ${c}`;
  }
  return f ? `${f} ${c}` : '';
}

export interface ZhStarNames {
  /** HIP → names, formal name first (e.g. 11767 → ['勾陈一', '北极星']). */
  byHip: Map<number, string[]>;
  /** Gaia DR3 source_id (as string) → names, for stars without HIP. */
  byGaia: Map<string, string[]>;
  /** Asterism (星官) name → group (紫微垣, 东方苍龙, …). */
  groupOf: Map<string, string>;
  /** HIP → group of the section the star is listed under. */
  groupOfHip: Map<number, string>;
}

/**
 * Parse Stellarium's chinese/star_names.zh_CN.fab:
 *   ###紫微垣            group (三垣 / 四象 / 近南极天区)
 *   #北极                asterism
 *   75097|_("北极一") 1  star
 */
export function parseChineseStarNames(text: string): ZhStarNames {
  const byHip = new Map<number, string[]>();
  const byGaia = new Map<string, string[]>();
  const groupOf = new Map<string, string>();
  const groupOfHip = new Map<number, string>();
  let group = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('###')) {
      group = line.slice(3).trim();
      continue;
    }
    if (line.startsWith('#')) {
      const name = line.slice(1).trim();
      if (name && group) groupOf.set(name, group);
      continue;
    }
    const m = /^(\d+)\|_\("([^"]+)"\)/.exec(line);
    if (!m) continue;
    const id = m[1] ?? '';
    const name = m[2] ?? '';
    // HIP numbers are < 200k; longer ids are Gaia DR3 source ids
    if (id.length > 9) addName(byGaia, id, name);
    else {
      addName(byHip, Number(id), name);
      if (group && !groupOfHip.has(Number(id))) groupOfHip.set(Number(id), group);
    }
  }
  return { byHip, byGaia, groupOf, groupOfHip };
}

function addName<K>(map: Map<K, string[]>, key: K, name: string): void {
  const list = map.get(key);
  if (!list) map.set(key, [name]);
  else if (!list.includes(name)) list.push(name);
}
