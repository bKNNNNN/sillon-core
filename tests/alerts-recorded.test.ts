import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchHourly, heatAlerts, slugAlerts, soilSowingAlerts, windAlerts, type HourlyWeather } from '../src/index.js';
import { crop, planting } from './day-fixtures.js';

/** Recorded on 2026-10-20 for Le Pian-Médoc, 7 past days and 7 forecast days, four models. */
const recorded = JSON.parse(readFileSync(new URL('./fixtures/openmeteo-hourly-meteofrance.json', import.meta.url), 'utf8')) as unknown;
const TODAY = '2026-10-20';

async function hours(): Promise<HourlyWeather[]> {
  const fetchFn = (async () => new Response(JSON.stringify(recorded), { status: 200 })) as unknown as typeof fetch;
  const result = await fetchHourly(fetchFn, { lat: 44.95, lon: -0.7, timezone: 'Europe/Paris' });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const open = { value: { from: 36, to: 48 }, source: 'test' };
const crops = [
  crop('radis', 'Radis', { sowDirect: open, germSoilC: { value: { min: 4.4, optLow: 7.2, optHigh: 32.2, max: 35 }, source: 'Harrington via OSU' } }),
  crop('haricot', 'Haricot', { sowDirect: open, germSoilC: { value: { min: 15.6, optLow: 15.6, optHigh: 29.4, max: 35 }, source: 'Harrington via OSU' } }),
  crop('salade', 'Salade'),
  crop('tomate', 'Tomate'),
];
const plantings = [planting('salade', { sownOn: '2026-10-10' }), planting('tomate')];

describe('alerts on the recorded Le Pian-Médoc week of 20 October 2026', () => {
  it('reads the soil from the default model, the only one with soil temperature', async () => {
    const list = soilSowingAlerts(await hours(), crops, { today: TODAY });
    expect(list.map((a) => a.crops[0]!.species)).toEqual(['radis', 'haricot']);
    for (const a of list) {
      expect(a.inputs.models).toEqual(['best_match']);
      expect(a.inputs.days).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    }
    expect(list.find((a) => a.crops[0]!.species === 'haricot')!.level).toBe('trop-froid');
  });

  it('sees slugs on the humid nights of the 20th and the 23rd, and gusts of 62 km/h on the 23rd', async () => {
    const h = await hours();
    expect(slugAlerts(h, plantings, crops, { today: TODAY }).map((a) => [a.date, a.reason.match(/\((.*?),/)![1]])).toEqual([
      ['2026-10-20', 'air très humide'],
      ['2026-10-23', 'sol humide'],
    ]);
    expect(windAlerts(h, plantings, crops, { today: TODAY }).map((a) => a.reason)).toEqual([
      'Rafales à 62 km/h prévues vendredi 23 octobre. Vérifie les tuteurs (tomate).',
    ]);
  });

  it('finds no heat in October and keeps every alert explained and in French', async () => {
    const h = await hours();
    expect(heatAlerts(h, plantings, crops, { today: TODAY })).toEqual([]);
    const all = [...slugAlerts(h, plantings, crops, { today: TODAY }), ...windAlerts(h, plantings, crops, { today: TODAY })];
    for (const a of all) {
      expect(a.daysAhead).toBeGreaterThanOrEqual(0);
      expect(a.reason).not.toMatch(/—/);
      expect(Object.keys(a.inputs.params).length).toBeGreaterThan(0);
    }
  });
});
