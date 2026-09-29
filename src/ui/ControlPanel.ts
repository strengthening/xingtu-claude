import { formatRate, isValidLocation } from '../astro';
import type { App } from '../app';
import type { Settings } from '../state';
import { h, toLocalInputValue } from './dom';
import { PLACES, PLACE_REGIONS, placeRegion } from './locations';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type StringKey = { [K in keyof Settings]: Settings[K] extends string ? K : never }[keyof Settings];

/** Left-hand control panel: location, time, display toggles. */
export class ControlPanel {
  readonly el: HTMLElement;
  private readonly lat: HTMLInputElement;
  private readonly lon: HTMLInputElement;
  private readonly place: HTMLSelectElement;
  private readonly timeInput: HTMLInputElement;
  private readonly rateLabel: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly toggles: HTMLElement;
  private readonly toggleInputs = new Map<BoolKey, HTMLInputElement>();
  private readonly selects = new Map<StringKey, HTMLSelectElement>();
  private readonly selectRows: HTMLElement;
  private readonly headerTools: HTMLElement;
  private lastSync = 0;

  constructor(private readonly app: App) {
    const s = app.settings.get();

    // ---- location ----------------------------------------------------------
    this.place = h(
      'select',
      { 'aria-label': '预设地点' },
      ...PLACE_REGIONS.map((region) =>
        h(
          'optgroup',
          { label: region },
          ...PLACES.filter((p) => placeRegion(p) === region).map((p) =>
            h('option', { value: p.name }, p.name),
          ),
        ),
      ),
      h('option', { value: '' }, '自定义'),
    );
    this.lat = h('input', {
      type: 'number',
      step: '0.01',
      min: -90,
      max: 90,
      'aria-label': '纬度',
      title: '纬度（北纬为正）',
    });
    this.lon = h('input', {
      type: 'number',
      step: '0.01',
      min: -180,
      max: 180,
      'aria-label': '经度',
      title: '经度（东经为正）',
    });
    const locate = h('button', { type: 'button', title: '使用浏览器定位' }, '定位');

    this.place.addEventListener('change', () => {
      const p = PLACES.find((x) => x.name === this.place.value);
      if (p) {
        const observer = { latitude: p.latitude, longitude: p.longitude, elevation: p.elevation };
        app.settings.set({ observer, locationName: p.name });
      }
    });
    const onCoord = (): void => {
      const observer = {
        latitude: Number(this.lat.value),
        longitude: Number(this.lon.value),
        elevation: app.settings.get().observer.elevation,
      };
      if (isValidLocation(observer)) app.settings.set({ observer, locationName: '' });
    };
    this.lat.addEventListener('change', onCoord);
    this.lon.addEventListener('change', onCoord);
    locate.addEventListener('click', () => {
      if (!('geolocation' in navigator)) return;
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locate.disabled = false;
          app.settings.set({
            observer: {
              latitude: round(pos.coords.latitude, 4),
              longitude: round(pos.coords.longitude, 4),
              elevation: pos.coords.altitude ?? 0,
            },
            locationName: '当前位置',
          });
        },
        () => {
          locate.disabled = false;
        },
        { timeout: 10_000 },
      );
    });

    // ---- time ----------------------------------------------------------------
    this.timeInput = h('input', {
      type: 'datetime-local',
      step: '1',
      'aria-label': '日期时间（本地）',
    });
    this.timeInput.addEventListener('change', () => {
      const ms = new Date(this.timeInput.value).getTime();
      if (Number.isFinite(ms)) app.clock.setTime(ms);
    });
    const slower = h('button', { type: 'button', title: '减速 / 倒流 (J)' }, '⏪');
    this.pauseBtn = h('button', { type: 'button', title: '暂停 / 继续 (K)' }, '❚❚');
    const faster = h('button', { type: 'button', title: '加速 (L)' }, '⏩');
    const now = h('button', { type: 'button', title: '回到当前时间 (N)' }, '现在');
    this.rateLabel = h('span.rate');
    slower.addEventListener('click', () => app.clock.stepRate(-1));
    faster.addEventListener('click', () => app.clock.stepRate(1));
    this.pauseBtn.addEventListener('click', () => app.clock.setPaused(!app.clock.paused));
    now.addEventListener('click', () => app.clock.resetToNow());
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j') app.clock.stepRate(-1);
      else if (k === 'l') app.clock.stepRate(1);
      else if (k === 'k') app.clock.setPaused(!app.clock.paused);
      else if (k === 'n') app.clock.resetToNow();
      else return;
      this.lastSync = 0;
    });

    // ---- display toggles -----------------------------------------------------
    this.toggles = h('div.toggles');
    this.selectRows = h('div.selects');
    const scale = h('input', {
      type: 'range',
      min: 0.6,
      max: 1.8,
      step: 0.05,
      value: s.starScale,
      'aria-label': '星点大小',
    });
    scale.addEventListener('input', () => app.settings.set({ starScale: Number(scale.value) }));
    const milky = h('input', {
      type: 'range',
      min: 0,
      max: 2,
      step: 0.05,
      value: s.milkyWayBrightness,
      'aria-label': '银河亮度',
    });
    milky.addEventListener('input', () =>
      app.settings.set({ milkyWayBrightness: Number(milky.value) }),
    );

    const atmosphere = h('input', {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      value: s.atmosphereStrength,
      'aria-label': '大气浓度',
    });
    atmosphere.addEventListener('input', () =>
      app.settings.set({ atmosphereStrength: Number(atmosphere.value) }),
    );

    const collapse = h('button.collapse', { type: 'button', title: '收起 / 展开' }, '☰');
    this.headerTools = h('div.header-tools', {}, collapse);
    const body = h(
      'div.panel-body',
      {},
      h('h2', {}, '观测地点'),
      h('div.row', {}, this.place, locate),
      h('div.row', {}, h('label', {}, '纬度', this.lat), h('label', {}, '经度', this.lon)),
      h('h2', {}, '时间'),
      h('div.row', {}, this.timeInput),
      h('div.row.time-controls', {}, slower, this.pauseBtn, faster, now, this.rateLabel),
      h('h2', {}, '显示'),
      this.selectRows,
      this.toggles,
      h('label.slider', {}, '星点大小', scale),
      h('label.slider', {}, '银河亮度', milky),
      h(
        'label.slider',
        {
          title:
            '100% 为真实大气；调低后白天、晨昏和月光的天光变淡，更多星星透出来；0% 为无大气（也不计折射）',
        },
        '大气浓度',
        atmosphere,
      ),
    );
    this.el = h(
      'section.panel#control-panel',
      {},
      h('header', {}, h('span.title', {}, '星图'), this.headerTools),
      body,
    );
    collapse.addEventListener('click', () => this.el.classList.toggle('collapsed'));
    if (window.matchMedia('(max-width: 640px)').matches) this.el.classList.add('collapsed');

    app.settings.subscribe(() => this.syncSettings());
    this.syncSettings();
  }

  /** A button in the panel header (visible even when the panel is collapsed). */
  addHeaderButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = h('button.header-button', { type: 'button', title }, text);
    b.addEventListener('click', onClick);
    this.headerTools.prepend(b);
    return b;
  }

  addToggle(key: BoolKey, label: string, title?: string): void {
    const input = h('input', { type: 'checkbox' });
    input.checked = this.app.settings.get()[key];
    input.addEventListener('change', () => this.app.settings.set({ [key]: input.checked }));
    this.toggleInputs.set(key, input);
    this.toggles.append(h('label.toggle', { title }, input, label));
  }

  /** A labelled <select> bound to a string setting. */
  addSelect<K extends StringKey>(
    key: K,
    label: string,
    options: readonly { value: Settings[K]; text: string }[],
    title?: string,
  ): void {
    const select = h(
      'select',
      { 'aria-label': label },
      ...options.map((o) => h('option', { value: o.value }, o.text)),
    );
    select.value = this.app.settings.get()[key];
    select.addEventListener('change', () =>
      this.app.settings.set({ [key]: select.value } as Partial<Settings>),
    );
    this.selects.set(key, select);
    this.selectRows.append(h('label.select-row', { title }, label, select));
  }

  private syncSettings(): void {
    const s = this.app.settings.get();
    if (document.activeElement !== this.lat) this.lat.value = String(s.observer.latitude);
    if (document.activeElement !== this.lon) this.lon.value = String(s.observer.longitude);
    this.place.value = PLACES.some((p) => p.name === s.locationName) ? s.locationName : '';
    for (const [key, input] of this.toggleInputs) input.checked = s[key];
    for (const [key, select] of this.selects) if (select.value !== s[key]) select.value = s[key];
  }

  /** Called every frame; DOM work is throttled. */
  update(): void {
    const now = performance.now();
    if (now - this.lastSync < 200) return;
    this.lastSync = now;
    const clock = this.app.clock;
    if (document.activeElement !== this.timeInput) {
      this.timeInput.value = toLocalInputValue(clock.now());
    }
    this.pauseBtn.textContent = clock.paused ? '▶' : '❚❚';
    this.rateLabel.textContent = clock.paused
      ? '已暂停'
      : clock.isLive
        ? '实时'
        : formatRate(clock.rate);
    this.rateLabel.classList.toggle('live', clock.isLive);
  }
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
