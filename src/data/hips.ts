/**
 * HiPS (Hierarchical Progressive Surveys, IVOA 2017) survey descriptions.
 * Tiles are fetched at runtime by the viewer's browser straight from the
 * survey host (CDS alasky supports CORS); nothing is redistributed here.
 */
export type HipsFrame = 'equatorial' | 'galactic';

export interface HipsSurvey {
  id: string;
  name: string;
  /** Base URL (no trailing slash): tiles at `${url}/Norder{k}/Dir{d}/Npix{n}.jpg`. */
  url: string;
  frame: HipsFrame;
  /** Lowest order with individual tiles (Norder3 always exists, with Allsky.jpg). */
  minOrder: number;
  maxOrder: number;
  tileWidth: number;
  format: 'jpg' | 'png';
  /** Default brightness multiplier. */
  brightness: number;
  credit: string;
  creditUrl: string;
}

export const SURVEYS = {
  mellinger: {
    id: 'mellinger',
    name: 'Mellinger 银河全景',
    url: 'https://alasky.cds.unistra.fr/MellingerRGB',
    frame: 'galactic',
    minOrder: 3,
    maxOrder: 4,
    tileWidth: 512,
    format: 'jpg',
    brightness: 0.75,
    credit: 'Milky Way panorama © Axel Mellinger, HiPS by CDS',
    creditUrl: 'http://www.milkywaysky.com/',
  },
  dss: {
    id: 'dss',
    name: 'DSS2 彩色巡天',
    url: 'https://alasky.cds.unistra.fr/DSS/DSSColor',
    frame: 'equatorial',
    minOrder: 3,
    maxOrder: 9,
    tileWidth: 512,
    format: 'jpg',
    brightness: 0.9,
    credit: 'Digitized Sky Survey – STScI/NASA, colored & HiPS by CDS',
    creditUrl: 'http://archive.stsci.edu/dss/copyright.html',
  },
} as const satisfies Record<string, HipsSurvey>;

export type SurveyId = keyof typeof SURVEYS;

export function tileUrl(s: HipsSurvey, order: number, ipix: number): string {
  const dir = Math.floor(ipix / 10000) * 10000;
  return `${s.url}/Norder${order}/Dir${dir}/Npix${ipix}.${s.format}`;
}

/** Order-3 mosaic of the whole survey: 768 tiles, 27 per row. */
export function allskyUrl(s: HipsSurvey): string {
  return `${s.url}/Norder3/Allsky.${s.format}`;
}

export const ALLSKY_COLUMNS = 27;
