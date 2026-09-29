import type { ObserverLocation } from '../astro';

/** Groups of the place menu, in display order. */
export const PLACE_REGIONS = ['北半球', '南半球'] as const;
export type PlaceRegion = (typeof PLACE_REGIONS)[number];

export interface Place extends ObserverLocation {
  name: string;
}

/** The menu group follows from the latitude. */
export function placeRegion(p: ObserverLocation): PlaceRegion {
  return p.latitude >= 0 ? '北半球' : '南半球';
}

export const PLACES: readonly Place[] = [
  // Northern hemisphere: a spread of latitudes, from Hong Kong (22°N) to Harbin (46°N) and London
  { name: '上海', latitude: 31.23, longitude: 121.47, elevation: 4 },
  { name: '北京', latitude: 39.9, longitude: 116.41, elevation: 44 },
  { name: '香港', latitude: 22.32, longitude: 114.17, elevation: 10 },
  { name: '哈尔滨', latitude: 45.8, longitude: 126.53, elevation: 150 },
  { name: '拉萨', latitude: 29.65, longitude: 91.13, elevation: 3650 },
  { name: '东京', latitude: 35.68, longitude: 139.69, elevation: 40 },
  { name: '新加坡', latitude: 1.35, longitude: 103.82, elevation: 15 },
  { name: '伦敦', latitude: 51.51, longitude: -0.13, elevation: 11 },
  { name: '纽约', latitude: 40.71, longitude: -74.01, elevation: 10 },
  // Southern hemisphere: the south celestial pole, Crux and the Magellanic Clouds are up
  { name: '悉尼', latitude: -33.87, longitude: 151.21, elevation: 58 },
  { name: '墨尔本', latitude: -37.81, longitude: 144.96, elevation: 31 },
  { name: '珀斯', latitude: -31.95, longitude: 115.86, elevation: 20 },
  { name: '奥克兰', latitude: -36.85, longitude: 174.76, elevation: 26 },
  // Aoraki Mackenzie International Dark Sky Reserve
  { name: '特卡波（新西兰暗夜保护区）', latitude: -44.0, longitude: 170.48, elevation: 710 },
  { name: '开普敦', latitude: -33.92, longitude: 18.42, elevation: 25 },
  { name: '约翰内斯堡', latitude: -26.2, longitude: 28.05, elevation: 1753 },
  { name: '圣保罗', latitude: -23.55, longitude: -46.63, elevation: 760 },
  { name: '布宜诺斯艾利斯', latitude: -34.6, longitude: -58.38, elevation: 25 },
  { name: '圣地亚哥（智利）', latitude: -33.45, longitude: -70.67, elevation: 570 },
  // ESO Very Large Telescope, Atacama desert
  { name: '帕瑞纳天文台（智利）', latitude: -24.63, longitude: -70.4, elevation: 2635 },
];
