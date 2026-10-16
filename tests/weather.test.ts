import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchArchive, fetchForecast, type WeatherLocation } from '../src/index.js';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
const here: WeatherLocation = { lat: 48.85, lon: 2.35, timezone: 'Europe/Paris' };
const forecastFixture = load('openmeteo-forecast.json');
const archiveFixture = load('openmeteo-archive.json');

const fakeFetch = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const failingFetch = (async () => {
  throw new Error('network down');
}) as unknown as typeof fetch;
function countingFetch(body: unknown) {
  const urls: string[] = [];
  const fn = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return Object.defineProperties(fn, {
    urls: { value: urls },
    calls: { get: () => urls.length },
  }) as typeof fn & { urls: string[]; calls: number };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('openmeteo client', () => {
  it('parses the daily forecast payload', async () => {
    const r = await fetchForecast(fakeFetch(forecastFixture), here);
    expect(r.ok && r.value[0]).toEqual({ date: '2026-10-16', tmin: 8.1, tmax: 17.4, precipMm: 0.2, et0Mm: 1.3, source: 'forecast' });
  });
  it('skips days with null values', async () => {
    const r = await fetchForecast(fakeFetch(forecastFixture), here);
    expect(r.ok && r.value.map((d) => d.date)).toEqual(['2026-10-16', '2026-10-17', '2026-10-19']);
  });
  it('builds the forecast url from the location', async () => {
    const f = countingFetch(forecastFixture);
    await fetchForecast(f, here);
    expect(f.urls[0]).toContain('https://api.open-meteo.com/v1/forecast?');
    expect(f.urls[0]).toContain('latitude=48.85');
    expect(f.urls[0]).toContain('longitude=2.35');
    expect(f.urls[0]).toContain('timezone=Europe%2FParis');
    expect(f.urls[0]).toContain('forecast_days=16');
    expect(f.urls[0]).toContain('past_days=7');
  });
  it('builds the archive url with dates', async () => {
    const f = countingFetch(archiveFixture);
    const r = await fetchArchive(f, here, '2026-09-01', '2026-09-30');
    expect(f.urls[0]).toContain('archive-api.open-meteo.com/v1/archive');
    expect(f.urls[0]).toContain('start_date=2026-09-01');
    expect(r.ok && r.value[0]?.source).toBe('archive');
  });
  it.each([
    ['network error', failingFetch],
    ['non-2xx', fakeFetch({}, 500)],
    ['malformed shape', fakeFetch({ nope: 1 })],
    ['invalid json', (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch],
  ])('returns a French error on %s', async (_n, f) => {
    const r = await fetchForecast(f, here);
    expect(r).toEqual({ ok: false, error: 'Météo indisponible.' });
    expect(errSpy).toHaveBeenCalled();
  });
});
