import type { App } from '../app';
import type { FrameContext } from '../render/context';
import { compassName, formatDeg, formatHours, formatTzOffset, h, pad2 } from './dom';

const PHASE_ZH = {
  night: '夜间',
  astronomical: '天文晨昏',
  nautical: '航海晨昏',
  civil: '民用晨昏',
  day: '白天',
} as const;

/** Bottom-left read-out: time, sidereal time, view, visibility. */
export class StatusBar {
  readonly el: HTMLElement;
  private readonly fields: Record<'time' | 'place' | 'view' | 'sky' | 'data', HTMLElement>;
  private last = 0;
  private creditKey = '';

  constructor(private readonly app: App) {
    this.fields = {
      time: h('div'),
      place: h('div'),
      view: h('div'),
      sky: h('div'),
      data: h('div.muted'),
    };
    this.el = h('section.status#status', {}, ...Object.values(this.fields));
  }

  update(ctx: FrameContext): void {
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;

    const ms = this.app.clock.now();
    const d = new Date(ms);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    this.fields.time.textContent = `${date} ${time} (${formatTzOffset(ms)})  ·  地方恒星时 ${formatHours(ctx.frames.last)}`;

    const o = ctx.settings.observer;
    const name = ctx.settings.locationName ? `${ctx.settings.locationName} ` : '';
    this.fields.place.textContent = `${name}${Math.abs(o.latitude).toFixed(2)}°${o.latitude >= 0 ? 'N' : 'S'} ${Math.abs(o.longitude).toFixed(2)}°${o.longitude >= 0 ? 'E' : 'W'}`;

    const v = this.app.view.state;
    this.fields.view.textContent = `视线 ${compassName(v.az)} 方位 ${formatDeg(v.az)} 高度 ${formatDeg(v.alt)}  ·  视场 ${formatDeg(v.fov, v.fov < 10 ? 2 : 1)}`;

    const moon = ctx.moonPenalty > 0.05 ? `（月光 −${ctx.moonPenalty.toFixed(1)}）` : '';
    this.fields.sky.textContent = `太阳高度 ${formatDeg(ctx.sunAltDeg)}（${PHASE_ZH[ctx.sky.phase]}）  ·  极限星等 ${(ctx.limMag - ctx.moonPenalty).toFixed(1)}${moon}`;

    this.updateCredits(ctx);

    const cat = this.app.catalog;
    this.fields.data.textContent = cat
      ? `已加载 ${cat.loadedCount.toLocaleString()} / ${cat.totalCount.toLocaleString()} 颗恒星（${cat.manifest.source.name} ${cat.manifest.source.version}）${cat.isLoading() ? ' 加载中…' : ''}`
      : this.app.catalogError
        ? '星表数据缺失（运行 pnpm data）'
        : '星表加载中…';
    const hips = this.app.hips.status;
    if (hips) this.fields.data.textContent += `  ·  ${hips}`;
  }

  /** Footer attributions that depend on what is shown (HiPS survey, sky culture). */
  private updateCredits(ctx: FrameContext): void {
    const survey = ctx.settings.milkyWay === 'off' ? undefined : this.app.hips.activeSurvey;
    const culture = this.app.figures.active;
    const key = `${survey?.id ?? ''}|${culture?.id ?? ''}`;
    if (key === this.creditKey) return;
    this.creditKey = key;
    const el = document.getElementById('credits-extra');
    if (!el) return;
    el.replaceChildren();
    if (culture) {
      el.append(' · 星座：', link(culture.url, 'Stellarium 星空文化'), ' (CC BY-SA 4.0)');
    }
    if (survey) el.append(' · 银河：', link(survey.creditUrl, survey.credit));
  }
}

function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener' }, text);
}
