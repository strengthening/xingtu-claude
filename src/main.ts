import './styles.css';
import { App } from './app';
import { ReplayController } from './replay/ReplayController';
import { ControlPanel } from './ui/ControlPanel';
import { InfoCard } from './ui/InfoCard';
import { ReplayPanel } from './ui/ReplayPanel';
import { StatusBar } from './ui/StatusBar';
import { UrlSync } from './ui/UrlSync';

const canvas = document.getElementById('sky');
const labels = document.getElementById('labels');
const ui = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !labels || !ui) {
  throw new Error('index.html is missing #sky / #labels / #ui');
}

const app = new App(canvas, labels, ui);

const panel = new ControlPanel(app);
panel.addSelect(
  'projection',
  '投影',
  [
    { value: 'stereographic', text: '立体投影（广角不变形）' },
    { value: 'perspective', text: '透视投影' },
  ],
  'Stellarium 默认使用立体投影：保角，宽视场下星座形状不变形',
);
panel.addSelect(
  'constellations',
  '星座',
  [
    { value: 'chinese', text: '中国星官（三垣二十八宿）' },
    { value: 'western', text: '西方（IAU 88 星座）' },
    { value: 'off', text: '不显示' },
  ],
  '连线数据：Stellarium 星空文化（CC BY-SA 4.0）',
);
panel.addSelect(
  'milkyWay',
  '银河',
  [
    { value: 'mellinger', text: 'Mellinger 银河全景' },
    { value: 'dss', text: 'DSS2 彩色（深空，可放大）' },
    { value: 'off', text: '不显示' },
  ],
  'HiPS 巡天图像，由浏览器直接从 CDS 加载',
);
panel.addToggle('showGround', '地面', '不透明地面；关闭时地平线下仅变暗');
panel.addToggle('showCardinals', '方位', '东南西北方位标记');
panel.addToggle('showBodies', '日月行星', '太阳、月球与七大行星');
panel.addToggle('showStarLabels', '星名', '亮星名称，放大后显示更多');
panel.addToggle('chineseNames', '中文名', '使用中国传统星名（无则显示 IAU 英文名）');
panel.addToggle('showEquatorialGrid', '赤道网格', '当日赤道坐标：赤经 1h × 赤纬 10°');
panel.addToggle('showAzimuthalGrid', '地平网格', '方位 15° × 高度 10°');
panel.addToggle('showConstellationLines', '星座连线');
panel.addToggle('showConstellationLabels', '星座名');
panel.addToggle(
  'showMansionBoundaries',
  '宿度分界',
  '二十八宿分界：过各宿距星的赤经圈（中国星官）',
);
const status = new StatusBar(app);
const card = new InfoCard(app);
const replay = new ReplayController(app);
const replayPanel = new ReplayPanel(app, replay);
const url = new UrlSync(app, replay);
panel.addHeaderButton('分享', '复制链接：当前地点、时间、视角和选中的天体', () => {
  void url.copyShareUrl();
});
const replayBtn = panel.addHeaderButton('回放', '发射回放：在星空中重演一次火箭发射', () =>
  replayPanel.toggleMenu(replayBtn),
);
replayBtn.classList.add('replay-toggle');
const syncReplayBtn = (): void => {
  replayBtn.textContent = replay.active ? '退出回放' : '回放';
  replayBtn.classList.toggle('active', replay.active);
};
replay.onChange(syncReplayBtn);
syncReplayBtn();
// the card comes first so an expanded panel covers it on narrow screens
ui.append(card.el, panel.el, status.el, replayPanel.el, replayPanel.menu);
app.onFrame((ctx) => {
  replayPanel.update();
  panel.update();
  status.update(ctx);
  card.update(ctx);
  url.update();
});

void app.start();

// the replay moves the observer; don't leave it at sea in the saved settings when the page closes
window.addEventListener('pagehide', () => replay.exit());

// keep the status bar clear of the footer credits, whose height depends on what is credited
const credits = document.getElementById('credits');
const creditsObserver =
  credits && 'ResizeObserver' in window
    ? new ResizeObserver(() => {
        document.documentElement.style.setProperty('--credits-h', `${credits.offsetHeight}px`);
      })
    : undefined;
if (credits) creditsObserver?.observe(credits);

// Handy for debugging from the console.
declare global {
  interface Window {
    xingtu?: App;
  }
}
window.xingtu = app;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    card.dispose();
    replayPanel.dispose();
    url.dispose();
    creditsObserver?.disconnect();
    app.dispose();
  });
}
