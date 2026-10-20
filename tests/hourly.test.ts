import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHourly, HOURLY_MODELS, nightsOf, WEATHER_UNAVAILABLE, type WeatherLocation } from '../src/index.js';
import { hour } from './hourly-fixtures.js';

/** Recorded on 2026-10-20 for Le Pian-Médoc (commune centre), 7 past days and 7 forecast days, four models. */
const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/openmeteo-hourly-meteofrance.json', import.meta.url), 'utf8'),
) as unknown;
const here: WeatherLocation = { lat: 44.95, lon: -0.7, timezone: 'Europe/Paris' };

const fakeFetch = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
function recordingFetch(body: unknown) {
  const urls: string[] = [];
  const fn = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return Object.assign(fn, { urls });
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('fetchHourly', () => {
  it('asks Open-Meteo for the agronomy variables, AROME first, then ARPEGE, then the default model', async () => {
    const f = recordingFetch(recorded);
    await fetchHourly(f, here);
    const url = new URL(f.urls[0]!);
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('models')).toBe(
      'meteofrance_arome_france_hd,meteofrance_arome_france,meteofrance_arpege_europe,best_match',
    );
    expect(url.searchParams.get('hourly')?.split(',')).toEqual([
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'cloud_cover',
      'cloud_cover_low',
      'wind_speed_10m',
      'wind_gusts_10m',
      'soil_temperature_6cm',
      'soil_temperature_18cm',
      'precipitation',
    ]);
    expect(url.searchParams.get('past_days')).toBe('7');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    expect(url.searchParams.get('timezone')).toBe('Europe/Paris');
    expect(url.searchParams.get('latitude')).toBe('44.95');
  });

  it('accepts custom past and forecast days', async () => {
    const f = recordingFetch(recorded);
    await fetchHourly(f, here, { pastDays: 2, forecastDays: 4 });
    const url = new URL(f.urls[0]!);
    expect(url.searchParams.get('past_days')).toBe('2');
    expect(url.searchParams.get('forecast_days')).toBe('4');
  });

  it('takes each variable from the first model that has it and records which one', async () => {
    const r = await fetchHourly(fakeFetch(recorded), here);
    if (!r.ok) throw new Error(r.error);
    const first = r.value[0]!;
    expect(first.ts).toBe('2026-10-13T00:00');
    expect(first.model).toBe('meteofrance_arome_france_hd');
    expect(first.temperature_2m).toBe(15.9);
    // AROME HD has no total cloud cover: it comes from AROME 2.5 km.
    expect(first.cloud_cover).toBe(50);
    expect(first.modelOf.cloud_cover).toBe('meteofrance_arome_france');
    // No Météo-France model gives soil temperature: it comes from the default model.
    expect(first.soil_temperature_6cm).toBe(17.8);
    expect(first.modelOf.soil_temperature_6cm).toBe('best_match');
    expect(first.modelOf.temperature_2m).toBe('meteofrance_arome_france_hd');
  });

  it('falls back to ARPEGE after the AROME horizon and to the default model after ARPEGE', async () => {
    const r = await fetchHourly(fakeFetch(recorded), here);
    if (!r.ok) throw new Error(r.error);
    const at = (ts: string) => r.value.find((h) => h.ts === ts)!;
    expect(at('2026-10-23T10:00')).toMatchObject({ model: 'meteofrance_arpege_europe', temperature_2m: 13.2, cloud_cover: 9 });
    expect(at('2026-10-25T12:00')).toMatchObject({ model: 'best_match', temperature_2m: 17.2 });
    expect(r.value).toHaveLength(336);
  });

  it('drops an hour that has no temperature in any model', async () => {
    const body = structuredClone(recorded) as { hourly: Record<string, (number | null)[]> };
    for (const m of HOURLY_MODELS) body.hourly[`temperature_2m_${m}`]![0] = null;
    const r = await fetchHourly(fakeFetch(body), here);
    expect(r.ok && r.value[0]?.ts).toBe('2026-10-13T01:00');
  });

  it('keeps a variable null when no model has it', async () => {
    const body = structuredClone(recorded) as { hourly: Record<string, (number | null)[]> };
    for (const m of HOURLY_MODELS) body.hourly[`wind_gusts_10m_${m}`]![0] = null;
    const r = await fetchHourly(fakeFetch(body), here);
    expect(r.ok && r.value[0]?.wind_gusts_10m).toBeNull();
    expect(r.ok && r.value[0]?.modelOf.wind_gusts_10m).toBeUndefined();
  });

  it('accepts a payload where a model column is missing', async () => {
    const body = structuredClone(recorded) as { hourly: Record<string, unknown> };
    for (const key of Object.keys(body.hourly)) if (key.endsWith('_meteofrance_arome_france_hd')) delete body.hourly[key];
    const r = await fetchHourly(fakeFetch(body), here);
    expect(r.ok && r.value[0]?.model).toBe('meteofrance_arome_france');
  });

  it.each([
    ['an HTTP error', fakeFetch({ error: true, reason: 'quota' }, 429)],
    ['an unexpected payload', fakeFetch({ hourly: { time: 'x' } })],
    ['a column of the wrong length', fakeFetch({ hourly: { time: ['2026-10-20T00:00'], temperature_2m_best_match: [1, 2] } })],
    [
      'a network failure',
      (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    ],
  ])('returns the French error on %s', async (_label, fn) => {
    expect(await fetchHourly(fn, here)).toEqual({ ok: false, error: WEATHER_UNAVAILABLE });
  });
});

describe('nightsOf', () => {
  it('groups hours from 18:00 to 09:00 under the evening date', () => {
    const hours = ['2026-10-20T17:00', '2026-10-20T18:00', '2026-10-20T23:00', '2026-10-21T00:00', '2026-10-21T09:00', '2026-10-21T10:00', '2026-10-21T18:00'].map(
      (ts) => hour(ts, 5),
    );
    const nights = nightsOf(hours);
    expect(nights.map((n) => [n.night, n.hours.map((h) => h.ts.slice(11, 13))])).toEqual([
      ['2026-10-20', ['18', '23', '00', '09']],
      ['2026-10-21', ['18']],
    ]);
  });

  it('puts the early hours of the first day under the previous evening', () => {
    expect(nightsOf([hour('2026-10-20T03:00', 5)]).map((n) => n.night)).toEqual(['2026-10-19']);
  });

  it('sorts the hours of a night by time', () => {
    const nights = nightsOf([hour('2026-10-21T02:00', 1), hour('2026-10-20T19:00', 2)]);
    expect(nights[0]!.hours.map((h) => h.ts)).toEqual(['2026-10-20T19:00', '2026-10-21T02:00']);
  });
});
