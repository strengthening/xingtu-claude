/**
 * Text for the info card: names, type, and a list of labelled read-outs.
 * Kept free of DOM so the formatting is easy to test.
 */
import * as THREE from 'three';
import {
  DEG,
  bvToTemperature,
  extinctionMag,
  constellationOf,
  moonPhaseName,
  properMotionComponents,
  propagateProperMotion,
  raDecOfDate,
  vectorToRaDec,
  worldToAltAz,
  type BodyId,
  type RiseTransitSet,
} from '../astro';
import { IAU_CONSTELLATION_ZH } from '../data/constellations';
import type { NamedStar } from '../data/names';
import type { FrameContext } from '../render/context';
import { BODY_NAMES_ZH } from '../render/layers/BodyLayer';
import { targetEqj, targetWorld, type Target } from '../selection';
import {
  formatDms,
  formatHourAngle,
  formatLocalTime,
  formatRaHms,
  formatSmallAngle,
  formatTzOffset,
} from './dom';

const KM_PER_AU = 149_597_870.7;
const LY_PER_PC = 3.261_563_78;
const LIGHT_MIN_PER_AU = 8.316_746_4;

export interface Description {
  title: string;
  /** Other names and catalogue numbers. */
  aliases: string[];
  /** One-line classification, e.g. "恒星 · 光谱 A1V". */
  kind: string;
  rows: [label: string, value: string][];
}

const BODY_KIND: Record<BodyId, string> = {
  Sun: '恒星',
  Moon: '卫星',
  Mercury: '行星',
  Venus: '行星',
  Mars: '行星',
  Jupiter: '行星',
  Saturn: '行星',
  Uranus: '行星',
  Neptune: '行星',
};

/** Names of a star in display order for the chosen language. */
function starNames(
  t: Extract<Target, { kind: 'star' }>,
  named: NamedStar | undefined,
  zh: boolean,
) {
  const out: string[] = [];
  const zhNames = named?.zh ?? [];
  if (zh) out.push(...zhNames);
  if (named?.name) out.push(named.name);
  if (!zh) out.push(...zhNames);
  if (named?.des) out.push(named.des);
  if (t.hip > 0) out.push(`HIP ${t.hip}`);
  if (named?.hd) out.push(`HD ${named.hd}`);
  out.push(`AT-HYG ${t.cat}`);
  return [...new Set(out)];
}

/** Short display name (also used for the on-sky selection label). */
export function targetTitle(t: Target, named: NamedStar | undefined, zh: boolean): string {
  if (t.kind === 'body') return zh ? BODY_NAMES_ZH[t.id] : t.id;
  return starNames(t, named, zh)[0] ?? `AT-HYG ${t.cat}`;
}

/** Fixed-point with a typographic minus sign. */
function fmt(n: number, digits: number): string {
  const t = Math.abs(n).toFixed(digits);
  return n < 0 && Number(t) !== 0 ? `−${t}` : t;
}

function fmtMag(m: number): string {
  return fmt(m, 2);
}

function riseRows(rts: RiseTransitSet | null, nowMs: number): [string, string][] {
  if (!rts) return [];
  if (rts.kind === 'up') return [['升落', '拱极，全天在地平线上']];
  if (rts.kind === 'down') return [['升落', '全天在地平线下']];
  const rows: [string, string][] = [];
  rows.push(['升起', rts.rise ? formatLocalTime(rts.rise, nowMs) : '—']);
  if (rts.transit) {
    const alt = rts.transitAlt === null ? '' : `（高度 ${rts.transitAlt.toFixed(1)}°）`;
    rows.push(['中天', `${formatLocalTime(rts.transit, nowMs)}${alt}`]);
  }
  rows.push(['落下', rts.set ? formatLocalTime(rts.set, nowMs) : '—']);
  rows.push(['时区', `${formatTzOffset(nowMs)}（本机时区）`]);
  return rows;
}

const tmp = new THREE.Vector3();

export function describeTarget(
  t: Target,
  ctx: FrameContext,
  named: NamedStar | undefined,
  rts: RiseTransitSet | null,
  nowMs: number,
): Description {
  const zh = ctx.settings.chineseNames;
  const atm = ctx.atmosphere;
  const rows: [string, string][] = [];
  const apparent = targetEqj(t, ctx);
  const world = targetWorld(t, { ...ctx, atmosphere: atm }, tmp);

  // constellation (IAU boundaries, from the J2000 position)
  if (apparent) {
    const c = constellationOf(apparent);
    const zhName = IAU_CONSTELLATION_ZH[c.symbol];
    rows.push(['星座', zh && zhName ? `${zhName}（${c.symbol}）` : `${c.name} (${c.symbol})`]);
  }

  let title: string;
  let aliases: string[];
  let kind: string;

  if (t.kind === 'star') {
    const names = starNames(t, named, zh);
    title = names[0] ?? `AT-HYG ${t.cat}`;
    aliases = names.slice(1);
    const spect = named?.spect?.replace(/\.+$/, ''); // HYG marks uncertain types with "..."
    kind = spect ? `恒星 · 光谱 ${spect}` : '恒星';

    let mag = `${fmtMag(t.mag)}`;
    if (atm && world && world.y > 0) {
      const ext = extinctionMag(Math.asin(Math.min(world.y, 1)) / DEG, ctx.extinctionK);
      if (ext >= 0.05) mag += `（大气消光后 ${fmtMag(t.mag + ext)}）`;
    }
    rows.push(['视星等', mag]);
    if (Number.isFinite(t.ci)) {
      const k = Math.round(bvToTemperature(t.ci) / 100) * 100;
      rows.push(['色指数', `B−V ${fmt(t.ci, 2)} · 约 ${k.toLocaleString()} K`]);
    }
    if (Number.isFinite(t.dist) && t.dist > 0) {
      const ly = t.dist * LY_PER_PC;
      const lyText = ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString();
      const pc = t.dist < 100 ? t.dist.toFixed(2) : Math.round(t.dist).toLocaleString();
      rows.push(['距离', `${lyText} 光年（${pc} pc）`]);
    } else {
      rows.push(['距离', '未知']);
    }
    // J2000 frame, position at the current epoch (proper motion applied, no aberration)
    const astrometric = propagateProperMotion(t.p0, t.pm, ctx.years);
    const j = vectorToRaDec(astrometric);
    rows.push(['赤经/赤纬 J2000', `${formatRaHms(j.ra)} / ${formatDms(j.dec)}`]);
  } else {
    const b = ctx.bodies.find((x) => x.id === t.id);
    title = zh ? BODY_NAMES_ZH[t.id] : t.id;
    aliases = zh ? [t.id] : [BODY_NAMES_ZH[t.id]];
    kind = BODY_KIND[t.id];
    if (b) {
      rows.push(['视星等', fmtMag(b.mag)]);
      rows.push(['视直径', formatSmallAngle(b.diameterDeg)]);
      if (t.id === 'Moon') {
        rows.push(['距离', `${Math.round(b.distAu * KM_PER_AU).toLocaleString()} km`]);
      } else {
        const lt = b.distAu * LIGHT_MIN_PER_AU;
        const ltText = lt < 60 ? `${lt.toFixed(1)} 分钟` : `${(lt / 60).toFixed(2)} 小时`;
        rows.push(['距离', `${b.distAu.toFixed(4)} AU · 光行时 ${ltText}`]);
      }
      if (t.id === 'Moon') {
        rows.push([
          '月相',
          `${moonPhaseName(new Date(nowMs))} · 照亮 ${(b.phase * 100).toFixed(0)}%`,
        ]);
      } else if (t.id !== 'Sun') {
        rows.push(['相位', `照亮 ${(b.phase * 100).toFixed(0)}%`]);
      }
      const j = vectorToRaDec(b.eqj);
      rows.push(['赤经/赤纬 J2000', `${formatRaHms(j.ra)} / ${formatDms(j.dec)}`]);
    }
  }

  if (apparent) {
    const d = raDecOfDate(apparent, ctx.frames.time);
    rows.push(['赤经/赤纬 当日', `${formatRaHms(d.ra)} / ${formatDms(d.dec)}`]);
    rows.push(['时角', formatHourAngle(ctx.frames.last - d.ra / 15)]);
  }
  if (world) {
    const h = worldToAltAz([world.x, world.y, world.z]);
    const note = atm ? '（含大气折射）' : '';
    rows.push(['方位/高度', `${h.az.toFixed(2)}° / ${formatDms(h.alt)}${note}`]);
  }
  if (t.kind === 'star') {
    const pm = properMotionComponents(t.p0, t.pm);
    if (pm.pmRa !== 0 || pm.pmDec !== 0) {
      rows.push(['自行', `μα* ${fmt(pm.pmRa, 1)} · μδ ${fmt(pm.pmDec, 1)} mas/年`]);
    }
  }
  rows.push(...riseRows(rts, nowMs));

  return { title, aliases, kind, rows };
}
