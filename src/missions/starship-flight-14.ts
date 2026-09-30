/**
 * Starship Flight 14 (2026-09-28): Super Heavy B21 + Ship 41, the first
 * Starship to reach orbit; 26 Starlink V3 satellites deployed; flight cut
 * short after an engine failure on each stage; splashdown north of Hawaii.
 *
 * An illustrative reconstruction from public reports, not an ephemeris:
 * - Reported: lift-off 12:48:59 UTC; hot staging ~T+2:20; booster splashdown
 *   in the Gulf ~T+7; ship ascent burn ends ~T+8; single-engine orbit
 *   insertion ~T+25 into 262 × 275 km at 30.5°; Starlink deployment from
 *   ~T+34 for ~30 min; early deorbit burn ~T+2:12; splashdown ~T+3:08 north
 *   of Hawaii. (Wikipedia "Starship flight 14"; Space.com live coverage;
 *   SpaceX mission page.)
 * - Estimated here: ascent / booster key points (typical of earlier Starship
 *   webcasts), Max-Q, boostback, entry timing, the ground track (launch
 *   azimuth chosen so the ascent flows into a 30.5° orbit heading ESE over the
 *   Gulf, as on earlier flights), and the satellites' drift apart. With those,
 *   the modelled splashdown lands at ~29°N 159°W — north of Hawaii, as
 *   reported, which is a useful check on the whole chain.
 */
import {
  GroundTrack,
  InPlaneTrack,
  Pchip,
  circularSpeed,
  destination,
  launchAzimuthFor,
  orbitalPeriod,
  type GeoPoint,
  type Keys,
} from '../astro/flight';
import type { Mission, MissionEvent, MissionPhase, ObserverPreset, VehicleSample } from './types';

/** Lift-off, 2026-09-28 12:48:59 UTC. */
const T0 = Date.UTC(2026, 8, 28, 12, 48, 59);
/** Orbital Launch Pad 2, Starbase, Texas. */
const PAD = { lat: 25.9969, lon: -97.1572 };

const INCLINATION = 30.5;
const PERIGEE = 262;
const APOGEE = 275;

// ---- key times, s after lift-off -------------------------------------------------
const HOT_STAGING = 140;
const BOOSTER_SPLASH = 420;
const SECO = 480;
const INSERTION = 25 * 60;
const INSERTION_END = INSERTION + 30;
const DEPLOY_START = 34 * 60;
const DEPLOY_END = 65 * 60;
const DEORBIT = 2 * 3600 + 12 * 60;
const DEORBIT_END = DEORBIT + 60;
const ENTRY = 2 * 3600 + 45 * 60;
const FLIP = 3 * 3600 + 7 * 60 + 30;
const SPLASH = 3 * 3600 + 8 * 60;
const START = -60;
const END = 3 * 3600 + 10 * 60;

const STARLINK_COUNT = 26;

// ---- ascent (ship and booster share the first 140 s) ----------------------------
const STACK_DOWNRANGE: Keys = [
  [0, 0],
  [20, 0.1],
  [40, 1.2],
  [60, 4],
  [90, 15],
  [120, 38],
  [HOT_STAGING, 55],
];
const STACK_ALTITUDE: Keys = [
  [0, 0],
  [20, 0.4],
  [40, 2.5],
  [60, 7],
  [90, 20],
  [120, 42],
  [HOT_STAGING, 60],
];
const SHIP_DOWNRANGE: Keys = [
  ...STACK_DOWNRANGE,
  [180, 110],
  [240, 230],
  [300, 420],
  [360, 700],
  [420, 1050],
  [SECO, 1500],
];
const SHIP_ALTITUDE: Keys = [
  ...STACK_ALTITUDE,
  [180, 95],
  [240, 130],
  [300, 155],
  [360, 172],
  [420, 183],
  [SECO, 190],
];
// boostback reverses the booster's travel; it splashes down ~35 km offshore
const BOOSTER_DOWNRANGE: Keys = [
  ...STACK_DOWNRANGE,
  [160, 66],
  [180, 73],
  [200, 76],
  [230, 77],
  [300, 68],
  [360, 50],
  [400, 38],
  [BOOSTER_SPLASH, 35],
];
const BOOSTER_ALTITUDE: Keys = [
  ...STACK_ALTITUDE,
  [160, 72],
  [180, 82],
  [210, 90],
  [240, 92],
  [270, 88],
  [300, 76],
  [340, 50],
  [370, 22],
  [390, 6],
  [410, 1],
  [BOOSTER_SPLASH, 0],
];

const AZIMUTH = launchAzimuthFor(PAD, 1500, INCLINATION, true);
const shipAscent = new GroundTrack(PAD, AZIMUTH, SHIP_DOWNRANGE, SHIP_ALTITUDE);
const boosterTrack = new GroundTrack(PAD, AZIMUTH, BOOSTER_DOWNRANGE, BOOSTER_ALTITUDE);

// ---- from engine cutoff to splashdown: an inertial orbit plane ----------------
const PERIOD = orbitalPeriod(PERIGEE, APOGEE);
const MEAN_ALT = (PERIGEE + APOGEE) / 2;
const HALF_RANGE = (APOGEE - PERIGEE) / 2;
/** In orbit: perigee at insertion, apogee half a revolution later. */
const orbitAltitude = (t: number): number =>
  MEAN_ALT - HALF_RANGE * Math.cos((2 * Math.PI * (t - INSERTION)) / PERIOD);
const coastAltitude = new Pchip([
  [SECO, 190],
  [800, 215],
  [1150, 245],
  [INSERTION, PERIGEE],
]);
const entryAltitude = new Pchip([
  [DEORBIT, orbitAltitude(DEORBIT)],
  [8400, 240],
  [9000, 195],
  [ENTRY, 120],
  [10320, 75],
  [10680, 50],
  [10980, 25],
  [11160, 8],
  [11250, 1],
  [SPLASH, 0],
]);
const entrySpeed = new Pchip([
  [ENTRY, circularSpeed(120)],
  [10320, 7.0],
  [10680, 4.5],
  [10980, 1.5],
  [11160, 0.6],
  [SPLASH, 0.4],
]);
const nominalAltitude = (t: number): number =>
  t < INSERTION ? coastAltitude.at(t) : orbitAltitude(t);
const shipAltitude = (t: number): number =>
  t < DEORBIT ? nominalAltitude(t) : entryAltitude.at(t);

const secoPoint = shipAscent.positionAt(SECO);
const planeStart = { t: SECO, lat: secoPoint.lat, lon: secoPoint.lon };
const shipOrbit = new InPlaneTrack({
  start: planeStart,
  end: SPLASH,
  inclinationDeg: INCLINATION,
  descending: true,
  altitudeKm: shipAltitude,
  speedKmS: (t) => (t < ENTRY ? circularSpeed(shipAltitude(t)) : entrySpeed.at(t)),
});
/** The orbit the ship would have kept without deorbiting: the satellites stay on it. */
const satelliteOrbit = new InPlaneTrack({
  start: planeStart,
  end: END,
  inclinationDeg: INCLINATION,
  descending: true,
  altitudeKm: nominalAltitude,
});

// ---- Starlink V3 --------------------------------------------------------------------
const releases = Array.from(
  { length: STARLINK_COUNT },
  (_, k) => DEPLOY_START + (k * (DEPLOY_END - DEPLOY_START)) / (STARLINK_COUNT - 1),
);
/** Separation drift, km/s: small differences spread the group into a short "train". */
const drift = releases.map((_, k) => -(0.001 + 0.00025 * k));

// ---- burns --------------------------------------------------------------------------
const SHIP_BURNS: readonly (readonly [number, number])[] = [
  [0, SECO],
  [INSERTION, INSERTION_END],
  [DEORBIT, DEORBIT_END],
  [FLIP, SPLASH],
];
const BOOSTER_BURNS: readonly (readonly [number, number])[] = [
  [150, 200],
  [390, BOOSTER_SPLASH],
];
const within = (t: number, spans: readonly (readonly [number, number])[]): boolean =>
  spans.some(([a, b]) => t >= a && t < b);

// ---- lifetimes ----------------------------------------------------------------------
const SHIP_LIFE = [START, SPLASH + 90] as const;
const BOOSTER_LIFE = [HOT_STAGING, BOOSTER_SPLASH + 60] as const;

function shipPosition(t: number): GeoPoint {
  if (t <= 0) return { ...PAD, altKm: 0 };
  if (t < SECO) return shipAscent.positionAt(t);
  return shipOrbit.positionAt(t);
}

function trackAt(id: 'ship' | 'booster', t: number): GeoPoint | null {
  if (id === 'ship') {
    return t >= SHIP_LIFE[0] && t <= SHIP_LIFE[1] ? shipPosition(t) : null;
  }
  // before hot staging the booster is part of the stack (the ship's point)
  return t >= 0 && t <= BOOSTER_LIFE[1] ? boosterTrack.positionAt(t) : null;
}

function vehiclesAt(t: number): VehicleSample[] {
  const out: VehicleSample[] = [];
  if (t >= SHIP_LIFE[0] && t <= SHIP_LIFE[1]) {
    const stacked = t < HOT_STAGING;
    out.push({
      id: 'ship',
      kind: 'ship',
      name: stacked ? '星舰（全箭）' : '星舰 Ship 41',
      geo: shipPosition(t),
      burning: within(t, SHIP_BURNS),
    });
  }
  if (t >= BOOSTER_LIFE[0] && t <= BOOSTER_LIFE[1]) {
    out.push({
      id: 'booster',
      kind: 'booster',
      name: '超重助推器 B21',
      geo: boosterTrack.positionAt(t),
      burning: within(t, BOOSTER_BURNS),
    });
  }
  releases.forEach((r, k) => {
    if (t < r || t > END) return;
    out.push({
      id: `starlink-${k}`,
      kind: 'starlink',
      name: `星链 V3 #${k + 1}`,
      geo: satelliteOrbit.positionAt(t, (drift[k] ?? 0) * (t - r)),
      burning: false,
    });
  });
  return out;
}

// ---- timeline -----------------------------------------------------------------------
const EVENTS: readonly MissionEvent[] = [
  {
    tPlus: 0,
    key: 'liftoff',
    name: '点火升空',
    detail:
      '超重 B21 的 33 台猛禽发动机点火，全箭从 Starbase 二号发射台升空。上升初段有 1 台助推器发动机提前关机。',
  },
  {
    tPlus: 60,
    key: 'maxq',
    name: 'Max-Q',
    detail: '最大动压：全箭承受的气动载荷最大。',
    approx: true,
  },
  {
    tPlus: HOT_STAGING,
    key: 'staging',
    name: '热分离',
    detail: '助推器主发动机关机；飞船在两级分离前点燃发动机（热分离）。',
  },
  {
    tPlus: 150,
    key: 'boostback',
    name: '助推器返航点火',
    detail: '助推器掉头，反推减小向东的速度，飞回墨西哥湾。',
    approx: true,
  },
  {
    tPlus: 390,
    key: 'booster-landing',
    name: '助推器着陆点火',
    detail: '海面上方的着陆点火（本次不回收，不用发射塔机械臂捕获）。',
    approx: true,
  },
  {
    tPlus: BOOSTER_SPLASH,
    key: 'booster-splash',
    name: '助推器溅落',
    detail: '超重 B21 在墨西哥湾受控溅落。',
  },
  {
    tPlus: SECO,
    key: 'seco',
    name: '飞船关机',
    detail:
      '飞船主上升段结束。3 台真空猛禽中有 1 台在上升段失效；SpaceX 一度宣布不入轨，评估后改为继续。',
  },
  {
    tPlus: INSERTION,
    key: 'insertion',
    name: '入轨点火',
    detail: '单台猛禽短时点火，进入约 262 × 275 km、倾角 30.5° 的近地轨道——星舰首次入轨。',
  },
  {
    tPlus: DEPLOY_START,
    key: 'deploy',
    name: '开始部署星链',
    detail: '开始释放 26 颗 Starlink V3（Group 31-1），其中 3 颗带相机，在轨拍摄飞船隔热瓦。',
  },
  {
    tPlus: DEPLOY_END,
    key: 'deploy-done',
    name: '部署完成',
    detail: '约 30 分钟的部署结束，26 颗卫星全部释放。',
  },
  {
    tPlus: DEORBIT,
    key: 'deorbit',
    name: '提前离轨点火',
    detail: '因发动机故障缩短任务：原计划绕地约 6 圈、飞行近 10 小时，实际约 1.5 圈后离轨。',
  },
  {
    tPlus: ENTRY,
    key: 'entry',
    name: '再入大气层',
    detail: '约 120 km 高度进入稠密大气，隔热瓦承受再入加热。',
    approx: true,
  },
  {
    tPlus: FLIP,
    key: 'flip',
    name: '翻转 · 着陆点火',
    detail: '由水平姿态翻转为竖直，点火减速。',
    approx: true,
  },
  {
    tPlus: SPLASH,
    key: 'splash',
    name: '飞船溅落',
    detail: '在夏威夷以北的太平洋受控溅落，随后侧翻，残余推进剂起火（本次不回收）。',
  },
];

const PHASES: readonly MissionPhase[] = [
  { from: START, name: '发射前' },
  { from: 0, name: '一级上升' },
  { from: HOT_STAGING, name: '热分离 · 二级上升' },
  { from: SECO, name: '滑行（入轨前）' },
  { from: INSERTION, name: '入轨点火' },
  { from: INSERTION_END, name: '在轨飞行' },
  { from: DEPLOY_START, name: '部署星链' },
  { from: DEPLOY_END, name: '在轨飞行' },
  { from: DEORBIT, name: '离轨点火' },
  { from: DEORBIT_END, name: '离轨滑行' },
  { from: ENTRY, name: '再入大气层' },
  { from: FLIP, name: '翻转 · 着陆点火' },
  { from: SPLASH, name: '已溅落' },
];

/** Splashdown site as modelled, and a hypothetical ship 40 km to its south-west. */
const splashPoint = shipOrbit.positionAt(SPLASH);
const splashWatch = destination(splashPoint.lat, splashPoint.lon, 225, 40);

const OBSERVERS: readonly ObserverPreset[] = [
  {
    id: 'south-padre',
    name: '南帕德雷岛（美国得州）',
    latitude: 26.07,
    longitude: -97.16,
    elevation: 5,
    note: '发射台以北约 8 km：升空、热分离、助推器返航',
    windows: [[START, SECO]],
  },
  {
    id: 'kingston',
    name: '金斯敦（牙买加）',
    latitude: 17.97,
    longitude: -76.79,
    elevation: 10,
    note: '飞船关机后从头顶附近掠过',
    windows: [[SECO, 900]],
  },
  {
    id: 'recife',
    name: '累西腓（巴西）',
    latitude: -8.05,
    longitude: -34.88,
    elevation: 10,
    note: '入轨前的滑行段，入轨点火在东南方低空',
    windows: [[900, 1800]],
  },
  {
    id: 'durban',
    name: '德班（南非）',
    latitude: -29.86,
    longitude: 31.02,
    elevation: 10,
    note: '开始部署星链后第一次过境',
    windows: [[1800, 2900]],
  },
  {
    id: 'jakarta',
    name: '雅加达（印尼）',
    latitude: -6.2,
    longitude: 106.85,
    elevation: 10,
    note: '星链部署接近尾声',
    windows: [[2900, 4300]],
  },
  {
    id: 'midway',
    name: '中途岛',
    latitude: 28.21,
    longitude: -177.38,
    elevation: 3,
    note: '第二圈过境；再入段的等离子体尾迹',
    windows: [
      [4300, 5700],
      [9900, 10800],
    ],
  },
  {
    id: 'acapulco',
    name: '阿卡普尔科（墨西哥）',
    latitude: 16.85,
    longitude: -99.9,
    elevation: 10,
    note: '第二圈飞越墨西哥',
    windows: [[5700, 6300]],
  },
  {
    id: 'manaus',
    name: '马瑙斯（巴西）',
    latitude: -3.12,
    longitude: -60.02,
    elevation: 50,
    note: '第二圈飞越亚马孙',
    windows: [[6300, 7200]],
  },
  {
    id: 'kimberley',
    name: '金伯利（南非）',
    latitude: -28.74,
    longitude: 24.77,
    elevation: 1200,
    note: '提前离轨点火',
    windows: [[7200, 8700]],
  },
  {
    id: 'manila',
    name: '马尼拉（菲律宾）',
    latitude: 14.6,
    longitude: 120.98,
    elevation: 10,
    note: '离轨后下降途中',
    windows: [[8700, 9900]],
  },
  {
    id: 'splash-zone',
    name: '溅落区附近海面（假想）',
    latitude: Math.round(splashWatch.lat * 100) / 100,
    longitude: Math.round(splashWatch.lon * 100) / 100,
    elevation: 10,
    note: '夏威夷以北的溅落海域（假想的观测船位置）',
    windows: [[10800, END]],
  },
];

export const STARSHIP_FLIGHT_14: Mission = {
  id: 'starship-14',
  name: '星舰第 14 次飞行',
  subtitle: '超重 B21 + 星舰 Ship 41 · 首次入轨 · 26 颗星链 V3',
  t0Ms: T0,
  start: START,
  end: END,
  events: EVENTS,
  phases: PHASES,
  observers: OBSERVERS,
  notes: [
    '基于公开报道的示意性重建：轨迹、部分事件时刻（标“约”）和溅落点为估算，并非官方星历。',
    '发射时德州当地为清晨，天已亮；回放中飞行器一律画出，不按真实亮度判断能否看见。',
    '地球按球体计算；星链卫星彼此的漂移为示意。',
  ],
  sources: [
    {
      title: 'Wikipedia: Starship flight 14',
      url: 'https://en.wikipedia.org/wiki/Starship_flight_14',
    },
    {
      title: 'Space.com: Starship Flight 14 live updates',
      url: 'https://www.space.com/news/live/spacex-starship-flight-14-live-updates-sept-28-2026-starship-first-orbital-launch-attempt',
    },
    {
      title: 'SpaceX: Starship Flight 14',
      url: 'https://www.spacex.com/launches/starship-flight-14',
    },
  ],
  vehiclesAt,
  trackAt,
  lifetime: (id) => (id === 'ship' ? SHIP_LIFE : BOOSTER_LIFE),
};

/** Exposed for tests. */
export const FLIGHT_14_MODEL = {
  pad: PAD,
  azimuthDeg: AZIMUTH,
  periodS: PERIOD,
  perigeeKm: PERIGEE,
  apogeeKm: APOGEE,
  inclinationDeg: INCLINATION,
  times: {
    HOT_STAGING,
    BOOSTER_SPLASH,
    SECO,
    INSERTION,
    DEPLOY_START,
    DEPLOY_END,
    DEORBIT,
    SPLASH,
  },
  splashPoint,
};
