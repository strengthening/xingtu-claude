type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper: h('div.panel#id', { title: 'x' }, child…). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const name = /^[a-z][a-z0-9]*/i.exec(tag)?.[0] ?? 'div';
  const el = document.createElement(name as K);
  const classes: string[] = [];
  for (const token of tag.slice(name.length).match(/[.#][^.#]+/g) ?? []) {
    if (token.startsWith('#')) el.id = token.slice(1);
    else classes.push(token.slice(1));
  }
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function pad2(n: number): string {
  return String(Math.trunc(n)).padStart(2, '0');
}

/** Local time as the `datetime-local` input expects: YYYY-MM-DDTHH:mm:ss. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

export function formatHours(h: number): string {
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t);
  const mm = Math.floor((t - hh) * 60);
  const ss = Math.floor(((t - hh) * 60 - mm) * 60);
  return `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`;
}

export function formatDeg(d: number, digits = 1): string {
  return `${d.toFixed(digits)}°`;
}

export function formatTzOffset(ms: number): string {
  const off = -new Date(ms).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '−';
  const a = Math.abs(off);
  return `UTC${sign}${pad2(a / 60)}:${pad2(a % 60)}`;
}

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
export function compassName(az: number): string {
  return COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8] ?? '';
}

/** Right ascension in degrees → "06h45m08.9s". */
export function formatRaHms(raDeg: number, secDigits = 1): string {
  const scale = 10 ** secDigits;
  let totalSec = Math.round(((((raDeg / 15) % 24) + 24) % 24) * 3600 * scale) / scale;
  if (totalSec >= 86400) totalSec -= 86400;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec - hh * 3600) / 60);
  const ss = totalSec - hh * 3600 - mm * 60;
  const s = ss.toFixed(secDigits).padStart(secDigits ? 3 + secDigits : 2, '0');
  return `${pad2(hh)}h${pad2(mm)}m${s}s`;
}

/** Signed angle in degrees → "−16°42′58″" (arc-seconds rounded to `secDigits`). */
export function formatDms(deg: number, secDigits = 0, signed = true): string {
  const sign = deg < 0 ? '−' : signed ? '+' : '';
  const scale = 10 ** secDigits;
  const totalSec = Math.round(Math.abs(deg) * 3600 * scale) / scale;
  const d = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec - d * 3600) / 60);
  const s = totalSec - d * 3600 - m * 60;
  const ss = s.toFixed(secDigits).padStart(secDigits ? 3 + secDigits : 2, '0');
  return `${sign}${d}°${pad2(m)}′${ss}″`;
}

/** Small angle (degrees) → "31′25″" or "12.3″". */
export function formatSmallAngle(deg: number): string {
  const arcsec = deg * 3600;
  if (arcsec < 59.95) return `${arcsec.toFixed(1)}″`;
  const total = Math.round(arcsec); // round first so 31′59.7″ becomes 32′00″, not 31′60″
  const m = Math.floor(total / 60);
  return `${m}′${pad2(total - m * 60)}″`;
}

/** Hour angle in hours → "+2h13m" (west of the meridian positive). */
export function formatHourAngle(h: number): string {
  let x = ((h % 24) + 24) % 24;
  if (x > 12) x -= 24;
  const sign = x < 0 ? '−' : '+';
  const total = Math.round(Math.abs(x) * 60);
  return `${sign}${Math.floor(total / 60)}h${pad2(total % 60)}m`;
}

/** Local clock time; the date is added when it differs from `refMs`'s. */
export function formatLocalTime(d: Date, refMs: number): string {
  const ref = new Date(refMs);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate();
  return sameDay ? hm : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hm}`;
}

/** Brief message in the top centre of the screen. */
export function showToast(text: string, ms = 2200): void {
  const el = h('div.toast', { role: 'status' }, text);
  document.getElementById('ui')?.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
}
