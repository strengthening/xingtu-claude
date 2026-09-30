import { describe, expect, it } from 'vitest';
import { formatTargetKey, parseTargetKey, targetKey, targetUrlKey } from '../../src/selection';
import { formatUrlState, parseUrlState, type UrlState } from '../../src/ui/url-state';
import { formatDms, formatHourAngle, formatRaHms, formatSmallAngle } from '../../src/ui/dom';

describe('URL hash state', () => {
  it('round-trips a full state', () => {
    const s: UrlState = {
      lat: 31.23,
      lon: 121.47,
      name: '上海',
      t: Date.parse('2026-09-27T13:05:07Z'),
      rate: 3600,
      paused: true,
      az: 181.25,
      alt: 42.5,
      fov: 12.5,
      proj: 'perspective',
      cons: 'western',
      mw: 'dss',
      sel: 'hip:32349',
      track: true,
    };
    const hash = formatUrlState(s);
    expect(hash).toContain('t=2026-09-27T13:05:07Z');
    expect(hash).toContain('sel=hip:32349');
    expect(hash).toContain('proj=persp');
    expect(parseUrlState(`#${hash}`)).toEqual(s);
  });

  it('keeps more decimals for the view centre when zoomed in', () => {
    const hash = formatUrlState({ az: 123.456789, alt: 10.123456, fov: 0.5 });
    expect(parseUrlState(hash)).toEqual({ az: 123.45679, alt: 10.12346, fov: 0.5 });
  });

  it('ignores invalid or out-of-range values', () => {
    const s = parseUrlState(
      '#lat=95&lon=abc&fov=-3&proj=fisheye&cons=klingon&sel=star:1&t=yesterday',
    );
    expect(s).toEqual({});
  });

  it('accepts local times with a UTC offset, even with "+" left unescaped', () => {
    const want = Date.parse('2026-01-15T13:00:00Z');
    expect(parseUrlState('#t=2026-01-15T21:00:00+08:00').t).toBe(want);
    expect(parseUrlState('#t=2026-01-15T21:00:00%2B08:00').t).toBe(want);
    expect(parseUrlState('#t=2026-01-15T08:00:00-05:00').t).toBe(want);
  });

  it('keeps a star position in the selection key readable', () => {
    const hash = formatUrlState({ sel: 'hip:13137@42.2051,-4.1234' });
    expect(hash).toBe('sel=hip:13137@42.2051,-4.1234');
    expect(parseUrlState(hash).sel).toBe('hip:13137@42.2051,-4.1234');
  });

  it('wraps longitude and accepts millisecond timestamps', () => {
    const s = parseUrlState('#lat=-33.9&lon=210&t=1790000000000');
    expect(s.lon).toBeCloseTo(-150);
    expect(s.t).toBe(1790000000000);
  });
});

describe('replay in the URL', () => {
  it('round-trips a replay link', () => {
    const s: UrlState = {
      t: Date.parse('2026-09-28T12:50:00Z'),
      replay: 'starship-14',
      auto: false,
    };
    const hash = formatUrlState(s);
    expect(hash).toContain('replay=starship-14');
    expect(hash).toContain('auto=0');
    expect(parseUrlState(`#${hash}`)).toEqual(s);
  });

  it('leaves out the default automatic observer and rejects odd ids', () => {
    expect(formatUrlState({ replay: 'starship-14', auto: true })).toBe('replay=starship-14');
    expect(parseUrlState('#replay=<script>')).toEqual({});
  });
});

describe('selection keys', () => {
  it('parses body, HIP and AT-HYG keys', () => {
    expect(parseTargetKey('body:moon')).toEqual({ kind: 'body', id: 'Moon' });
    expect(parseTargetKey('hip:32349')).toEqual({ kind: 'hip', hip: 32349 });
    expect(parseTargetKey('athyg:1125268')).toEqual({ kind: 'athyg', cat: 1125268 });
    expect(parseTargetKey('body:Pluto')).toBeNull();
    const k = parseTargetKey('hip:13137@90,0');
    expect(k?.kind).toBe('hip');
    const near = k && (k.kind === 'hip' || k.kind === 'athyg') ? k.near : undefined;
    expect(near?.[0]).toBeCloseTo(0, 12);
    expect(near?.[1]).toBeCloseTo(1, 12);
    expect(parseTargetKey('hip:1@10,95')).toEqual({ kind: 'hip', hip: 1 }); // bad dec ignored
    expect(parseTargetKey('hip:-4')).toBeNull();
  });

  it('parses and formats vehicle keys', () => {
    expect(parseTargetKey('veh:ship')).toEqual({ kind: 'vehicle', id: 'ship' });
    expect(parseTargetKey('veh:Booster')).toEqual({ kind: 'vehicle', id: 'booster' });
    expect(parseTargetKey('veh:rover')).toBeNull();
    expect(targetKey({ kind: 'vehicle', id: 'starlink' })).toBe('veh:starlink');
    expect(targetUrlKey({ kind: 'vehicle', id: 'ship' })).toBe('veh:ship');
    expect(formatTargetKey({ kind: 'vehicle', id: 'booster' })).toBe('veh:booster');
  });

  it('prefers HIP numbers for stars that have one', () => {
    const base = {
      kind: 'star' as const,
      p0: [1, 0, 0] as [number, number, number],
      pm: [0, 0, 0] as [number, number, number],
      mag: 1,
      ci: 0,
      dist: 10,
    };
    expect(targetKey({ ...base, cat: 7, hip: 32349 })).toBe('hip:32349');
    expect(targetKey({ ...base, cat: 7, hip: 0 })).toBe('athyg:7');
    expect(targetKey({ kind: 'body', id: 'Jupiter' })).toBe('body:Jupiter');
    expect(targetUrlKey({ ...base, cat: 7, hip: 32349 })).toBe('hip:32349@0.0000,0.0000');
    expect(formatTargetKey({ kind: 'athyg', cat: 9, near: [0, 0, 1] })).toBe(
      'athyg:9@0.0000,90.0000',
    );
  });
});

describe('coordinate formatting', () => {
  it('formats RA / Dec with carries', () => {
    expect(formatRaHms(101.287155)).toBe('06h45m08.9s');
    expect(formatRaHms(359.99999)).toBe('00h00m00.0s');
    expect(formatDms(-16.716116)).toBe('−16°42′58″');
    expect(formatDms(38.99999)).toBe('+39°00′00″');
  });

  it('formats small angles and hour angles', () => {
    expect(formatSmallAngle(0.5236)).toBe('31′25″');
    expect(formatSmallAngle(12.3 / 3600)).toBe('12.3″');
    expect(formatSmallAngle(1919.7 / 3600)).toBe('32′00″');
    expect(formatSmallAngle(59.97 / 3600)).toBe('1′00″');
    expect(formatHourAngle(25.5)).toBe('+1h30m');
    expect(formatHourAngle(-2.25)).toBe('−2h15m');
  });
});
