import type { App } from '../app';
import { formatRate } from '../astro';
import {
  MISSIONS,
  formatTPlus,
  nextEvent,
  vehicleView,
  type Mission,
  type MissionEvent,
} from '../missions';
import type { ReplayController } from '../replay/ReplayController';
import { h } from './dom';

/** Rate buttons (simulated seconds per real second). */
const RATES = [1, 10, 60, 600] as const;
/** The first minutes are busy: they get this share of the timeline's width. */
const EARLY_S = 600;
const EARLY_SHARE = 0.3;
/** Slider resolution. */
const STEPS = 2000;

/** T+ → position 0–1 on the timeline (the first ten minutes stretched). */
export function timelinePos(m: Mission, t: number): number {
  const c = Math.min(Math.max(t, m.start), m.end);
  if (c <= EARLY_S) return ((c - m.start) / (EARLY_S - m.start)) * EARLY_SHARE;
  return EARLY_SHARE + ((c - EARLY_S) / (m.end - EARLY_S)) * (1 - EARLY_SHARE);
}

/** Inverse of timelinePos. */
export function timelineTime(m: Mission, x: number): number {
  const p = Math.min(Math.max(x, 0), 1);
  if (p <= EARLY_SHARE) return m.start + (p / EARLY_SHARE) * (EARLY_S - m.start);
  return EARLY_S + ((p - EARLY_SHARE) / (1 - EARLY_SHARE)) * (m.end - EARLY_S);
}

function eventTitle(e: MissionEvent): string {
  return `${formatTPlus(e.tPlus)}${e.approx ? '（约）' : ''} ${e.name}：${e.detail}`;
}

/** Bottom timeline for a launch replay, plus the mission menu behind the 回放 button. */
export class ReplayPanel {
  readonly el: HTMLElement;
  readonly menu: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly clockText: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly rateBtns = new Map<number, HTMLButtonElement>();
  private readonly rateLabel: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly ticks: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly next: HTMLElement;
  private readonly observer: HTMLSelectElement;
  private readonly auto: HTMLInputElement;
  private readonly jump: HTMLSelectElement;
  private readonly notes: HTMLElement;
  private dragging = false;
  private last = 0;
  private built: Mission | null = null;

  constructor(
    private readonly app: App,
    private readonly replay: ReplayController,
  ) {
    this.title = h('span.replay-title');
    this.subtitle = h('span.replay-subtitle');
    const badge = h('span.replay-badge', { title: '' }, '示意性重建');
    this.clockText = h('span.replay-clock');
    this.phase = h('span.replay-phase');
    const close = h(
      'button.replay-close',
      { type: 'button', title: '退出回放，恢复之前的时间和地点', 'aria-label': '退出回放' },
      '×',
    );

    this.playBtn = h('button.replay-play', { type: 'button', title: '播放 / 暂停 (K)' }, '❚❚');
    const rates = h('div.replay-rates', { role: 'group', 'aria-label': '回放速度' });
    for (const r of RATES) {
      const b = h('button', { type: 'button', title: `每秒推进 ${r} 秒` }, `×${r}`);
      b.addEventListener('click', () => {
        app.clock.setRate(r);
        app.clock.setPaused(false);
        this.last = 0;
      });
      this.rateBtns.set(r, b);
      rates.append(b);
    }
    this.rateLabel = h('span.replay-rate');

    this.slider = h('input.replay-slider', {
      type: 'range',
      min: 0,
      max: STEPS,
      step: 1,
      'aria-label': '回放进度',
    });
    this.ticks = h('div.replay-ticks');
    const track = h('div.replay-track', {}, this.ticks, this.slider);

    this.readout = h('span.replay-readout');
    this.next = h('span.replay-next');
    this.observer = h('select', { 'aria-label': '观测地点' });
    this.auto = h('input', { type: 'checkbox' });
    this.jump = h('select', { 'aria-label': '跳到事件' });
    this.notes = h('div.replay-notes');

    this.el = h(
      'section.replay-panel',
      { 'aria-label': '发射回放' },
      h('header', {}, h('div.replay-names', {}, this.title, badge, this.subtitle), close),
      h('div.replay-row', {}, this.clockText, this.phase, this.next),
      h('div.replay-row.replay-controls', {}, this.playBtn, rates, this.rateLabel, track),
      h('div.replay-row', {}, this.readout),
      h(
        'div.replay-row.replay-site',
        {},
        h('label', {}, '观测地点', this.observer),
        h('label.replay-auto', { title: '按飞行阶段自动换到能看到飞船的地点' }, this.auto, '自动'),
        this.jump,
      ),
      h('details', {}, h('summary', {}, '说明与来源'), this.notes),
    );
    this.el.hidden = true;

    this.menu = h('div.replay-menu', { role: 'menu' });
    this.menu.hidden = true;

    close.addEventListener('click', () => replay.exit());
    this.playBtn.addEventListener('click', () => {
      app.clock.setPaused(!app.clock.paused);
      this.last = 0;
    });
    this.slider.addEventListener('pointerdown', () => (this.dragging = true));
    const release = (): void => {
      this.dragging = false;
    };
    this.slider.addEventListener('pointerup', release);
    this.slider.addEventListener('pointercancel', release);
    this.slider.addEventListener('blur', release);
    this.slider.addEventListener('input', () => {
      const m = replay.mission;
      if (m) replay.seek(timelineTime(m, Number(this.slider.value) / STEPS));
      this.last = 0;
    });
    this.observer.addEventListener('change', () => {
      const p = replay.mission?.observers.find((o) => o.id === this.observer.value);
      if (p) replay.setObserver(p);
    });
    this.auto.addEventListener('change', () => replay.setAutoObserver(this.auto.checked));
    this.jump.addEventListener('change', () => {
      const e = replay.mission?.events.find((x) => x.key === this.jump.value);
      if (e) this.seekToEvent(e);
      this.jump.value = '';
    });
    document.addEventListener('pointerdown', this.onOutside);

    replay.onChange(() => this.sync());
  }

  private readonly onOutside = (e: PointerEvent): void => {
    if (this.menu.hidden) return;
    const t = e.target as Node | null;
    if (t && (this.menu.contains(t) || (t as HTMLElement).closest?.('.replay-toggle'))) return;
    this.menu.hidden = true;
  };

  /** The 回放 header button: exit when replaying, else list the missions. */
  toggleMenu(anchor: HTMLElement): void {
    if (this.replay.active) {
      this.replay.exit();
      return;
    }
    if (!this.menu.hidden) {
      this.menu.hidden = true;
      return;
    }
    this.menu.replaceChildren(
      h('div.replay-menu-title', {}, '发射回放'),
      ...MISSIONS.map((m) => {
        const b = h(
          'button',
          { type: 'button', role: 'menuitem' },
          h('strong', {}, m.name),
          h('span', {}, m.subtitle),
          h('span', {}, new Date(m.t0Ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'),
        );
        b.addEventListener('click', () => {
          this.menu.hidden = true;
          this.replay.enter(m.id);
        });
        return b;
      }),
    );
    const r = anchor.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, r.left)}px`;
    this.menu.style.top = `${r.bottom + 6}px`;
    this.menu.hidden = false;
  }

  private seekToEvent(e: MissionEvent): void {
    // a few seconds early, so the event is seen happening
    this.replay.seek(e.tPlus - (e.tPlus > 0 ? 5 : 0));
    this.last = 0;
  }

  /** Rebuild for the active mission (or hide). */
  private sync(): void {
    const m = this.replay.mission;
    this.el.hidden = !m;
    document.body.classList.toggle('replay-active', m !== null);
    if (!m) {
      this.built = null;
      return;
    }
    if (this.built !== m) {
      this.built = m;
      this.title.textContent = m.name;
      this.subtitle.textContent = m.subtitle;
      this.el.querySelector('.replay-badge')?.setAttribute('title', m.notes.join('\n'));
      this.ticks.replaceChildren(
        ...m.events.map((e) => {
          const b = h('button.replay-tick', {
            type: 'button',
            title: eventTitle(e),
            'aria-label': `跳到 ${e.name}`,
          });
          b.style.left = `${(timelinePos(m, e.tPlus) * 100).toFixed(2)}%`;
          b.addEventListener('click', () => this.seekToEvent(e));
          return b;
        }),
        h('span.replay-early', { title: '前 10 分钟放大显示' }),
      );
      this.jump.replaceChildren(
        h('option', { value: '' }, '跳到事件…'),
        ...m.events.map((e) =>
          h(
            'option',
            { value: e.key },
            `${formatTPlus(e.tPlus)} ${e.name}${e.approx ? '（约）' : ''}`,
          ),
        ),
      );
      this.observer.replaceChildren(
        ...m.observers.map((o) => h('option', { value: o.id, title: o.note }, o.name)),
        h('option', { value: '' }, '其他（自定义）'),
      );
      this.notes.replaceChildren(
        ...m.notes.map((n) => h('p', {}, n)),
        h(
          'p',
          {},
          '来源：',
          ...m.sources.flatMap((s, i) => [
            i ? ' · ' : '',
            h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title),
          ]),
        ),
      );
    }
    this.last = 0;
  }

  /** Called every frame; DOM work is throttled. */
  update(): void {
    this.replay.update();
    const m = this.replay.mission;
    if (!m) return;
    const now = performance.now();
    if (now - this.last < 150) return;
    this.last = now;

    const clock = this.app.clock;
    const t = this.replay.tPlus;
    const frame = this.app.lastFrame?.replay;
    const inRange = t >= m.start - 1 && t <= m.end + 1;
    this.clockText.textContent = inRange ? formatTPlus(t) : '不在回放时段';
    this.phase.textContent = inRange ? (frame?.phase ?? '') : '拖动进度条回到飞行';
    const ne = inRange ? nextEvent(m, t) : undefined;
    this.next.textContent = ne ? `下一步：${ne.name}（${formatTPlus(t - ne.tPlus).slice(1)}）` : '';

    this.playBtn.textContent = clock.paused ? '▶' : '❚❚';
    for (const [r, b] of this.rateBtns)
      b.classList.toggle('active', !clock.paused && clock.rate === r);
    const custom = !RATES.some((r) => r === clock.rate);
    this.rateLabel.textContent = clock.paused ? '已暂停' : custom ? formatRate(clock.rate) : '';
    if (!this.dragging && document.activeElement !== this.slider) {
      this.slider.value = String(Math.round(timelinePos(m, t) * STEPS));
    }
    this.el.style.setProperty('--progress', `${(timelinePos(m, t) * 100).toFixed(2)}%`);

    const ship = vehicleView(frame, 'ship');
    const booster = vehicleView(frame, 'booster');
    const sats = frame?.vehicles.filter((v) => v.kind === 'starlink').length ?? 0;
    const parts: string[] = [];
    if (ship) {
      parts.push(
        `${ship.name}：高度 ${ship.geo.altKm.toFixed(0)} km · 地速 ${Math.round(ship.speedKmh).toLocaleString()} km/h · ${ship.sunlit ? '阳光照射' : '地球阴影中'}${ship.altDeg < 0 ? ' · 在地平线下' : ''}`,
      );
    }
    if (booster) parts.push(`助推器：高度 ${booster.geo.altKm.toFixed(1)} km`);
    if (sats) parts.push(`星链已部署 ${sats} 颗`);
    this.readout.textContent = parts.join('  ·  ') || '—';

    const preset = this.replay.currentPreset();
    const value = preset?.id ?? '';
    if (document.activeElement !== this.observer && this.observer.value !== value) {
      this.observer.value = value;
    }
    this.observer.title = preset?.note ?? '';
    this.auto.checked = this.replay.autoObserver;
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.onOutside);
    this.el.remove();
    this.menu.remove();
  }
}
