/**
 * Shareable view state in the URL hash, e.g.
 *   #lat=31.23&lon=121.47&name=上海&t=2026-09-27T13:00:00Z&az=180&alt=35&fov=60&sel=hip:32349
 * Pure parse / format (tested); UrlSync applies it to the app.
 */
import type { ProjectionMode } from '../astro/projection';
import type { SurveyId } from '../data/hips';
import type { SkyCultureId } from '../data/skyculture';
import { TARGET_KEY_RE } from '../selection';

export interface UrlState {
  lat?: number;
  lon?: number;
  /** metres */
  elev?: number;
  /** place name shown in the status bar */
  name?: string;
  /** simulated time, ms since the Unix epoch; absent = now */
  t?: number;
  /** simulated seconds per real second */
  rate?: number;
  paused?: boolean;
  /** view centre azimuth / altitude and vertical field of view, degrees */
  az?: number;
  alt?: number;
  fov?: number;
  proj?: ProjectionMode;
  cons?: 'off' | SkyCultureId;
  mw?: 'off' | SurveyId;
  /** selected object: body:Moon, hip:32349 or athyg:123456, stars optionally with "@ra,dec" */
  sel?: string;
  track?: boolean;
  /** launch replay in progress, e.g. "starship-14" */
  replay?: string;
  /** replay observer follows the flight (default); false = stays where it was put */
  auto?: boolean;
}

const PROJ: Record<string, ProjectionMode> = {
  stereo: 'stereographic',
  stereographic: 'stereographic',
  persp: 'perspective',
  perspective: 'perspective',
};
const CONS = ['off', 'chinese', 'western'] as const;
const MW = ['off', 'mellinger', 'dss'] as const;

function num(v: string | null, min: number, max: number): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function bool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  return v === '' || v === '1' || v === 'true';
}

function oneOf<T extends string>(v: string | null, options: readonly T[]): T | undefined {
  return options.find((o) => o === v);
}

/** Time as ISO 8601 (preferred) or a millisecond timestamp. */
function parseTime(v: string | null): number | undefined {
  if (!v) return undefined;
  // URLSearchParams turns an unescaped "+" (as in +08:00) into a space
  const iso = v.trim().replace(/ (\d\d(?::?\d\d)?)$/, '+$1');
  const ms = /^-?\d+$/.test(iso) ? Number(iso) : Date.parse(iso);
  // astronomy-engine is good for ±several millennia; keep it sane
  return Number.isFinite(ms) && Math.abs(ms) < 3e14 ? ms : undefined;
}

export function parseUrlState(hash: string): UrlState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const s: UrlState = {};
  const set = <K extends keyof UrlState>(k: K, v: UrlState[K] | undefined): void => {
    if (v !== undefined) s[k] = v;
  };
  set('lat', num(q.get('lat'), -90, 90));
  const lon = num(q.get('lon'), -360, 360);
  if (lon !== undefined) s.lon = lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
  set('elev', num(q.get('elev'), -500, 9000));
  const name = q.get('name');
  if (name !== null) s.name = name.slice(0, 60);
  set('t', parseTime(q.get('t')));
  set('rate', num(q.get('rate'), -1e7, 1e7));
  set('paused', bool(q.get('paused')));
  set('az', num(q.get('az'), -360, 720));
  set('alt', num(q.get('alt'), -90, 90));
  set('fov', num(q.get('fov'), 1e-3, 360));
  set('proj', PROJ[q.get('proj') ?? '']);
  set('cons', oneOf(q.get('cons'), CONS));
  set('mw', oneOf(q.get('mw'), MW));
  const sel = q.get('sel');
  if (sel && TARGET_KEY_RE.test(sel)) s.sel = sel;
  set('track', bool(q.get('track')));
  const replay = q.get('replay');
  if (replay && /^[a-z0-9-]{1,40}$/.test(replay)) s.replay = replay;
  set('auto', bool(q.get('auto')));
  return s;
}

function fixed(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/** Readable hash (without "#"): ":" and "," stay unescaped, CJK is percent-encoded. */
export function formatUrlState(s: UrlState): string {
  const parts: [string, string][] = [];
  const push = (k: string, v: string | undefined): void => {
    if (v !== undefined) parts.push([k, v]);
  };
  const fine = s.fov !== undefined && s.fov < 2; // zoomed in: keep sub-arcsecond view centres
  push('lat', s.lat === undefined ? undefined : fixed(s.lat, 4));
  push('lon', s.lon === undefined ? undefined : fixed(s.lon, 4));
  push('elev', s.elev ? String(Math.round(s.elev)) : undefined);
  push('name', s.name || undefined);
  push(
    't',
    s.t === undefined
      ? undefined
      : new Date(Math.round(s.t / 1000) * 1000).toISOString().replace('.000Z', 'Z'),
  );
  push('rate', s.rate === undefined ? undefined : String(s.rate));
  push('paused', s.paused ? '1' : undefined);
  push('az', s.az === undefined ? undefined : fixed(s.az, fine ? 5 : 2));
  push('alt', s.alt === undefined ? undefined : fixed(s.alt, fine ? 5 : 2));
  push('fov', s.fov === undefined ? undefined : String(Number(s.fov.toPrecision(4))));
  push('proj', s.proj === undefined ? undefined : s.proj === 'stereographic' ? 'stereo' : 'persp');
  push('cons', s.cons);
  push('mw', s.mw);
  push('sel', s.sel);
  push('track', s.track ? '1' : undefined);
  push('replay', s.replay);
  push('auto', s.replay && s.auto === false ? '0' : undefined);
  return parts.map(([k, v]) => `${k}=${readable(encodeURIComponent(v))}`).join('&');
}

/** Characters that are legal in a fragment are left unescaped for readability. */
function readable(encoded: string): string {
  return encoded.replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%40/gi, '@');
}
