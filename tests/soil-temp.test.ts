import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SOIL_TEMP_PARAMS, soilSowingAlerts, soilStatus, type Crop, type SoilStatus } from '../src/index.js';
import { crop, days } from './day-fixtures.js';

const TODAY = '2026-10-20'; // ISO week 43
const open = { value: { from: 40, to: 46 }, source: 'test' };
const radis = crop('radis', 'Radis', {
  sowDirect: open,
  germSoilC: { value: { min: 4.4, optLow: 7.2, optHigh: 32.2, max: 35 }, source: 'Harrington via OSU' },
});
const haricot = crop('haricot', 'Haricot', {
  sowDirect: open,
  germSoilC: { value: { min: 15.6, optLow: 15.6, optHigh: 29.4, max: 35 }, source: 'Harrington via OSU' },
});
const chou = crop('chou-hiver', "Chou d'hiver", { sowDirect: open, germSoilC: { value: { min: 4.4, max: 37.8 }, source: 'Harrington via OSU' } });
const patate = crop('pomme-de-terre', 'Pomme de terre', { sowDirect: open });
const closed = crop('carotte', 'Carotte', {
  sowDirect: { value: { from: 10, to: 30 }, source: 'test' },
  germSoilC: { value: { min: 4.4, optLow: 7.2, optHigh: 29.4, max: 35 }, source: 'Harrington via OSU' },
});
const noData = crop('ail', 'Ail', { sowDirect: open });

/** Three forecast days from today with a flat 6 cm (and 18 cm) soil temperature. */
const flat = (soil6: number, soil18 = soil6, from = TODAY, count = 3) =>
  days(from, count, () => ({ soil_temperature_6cm: soil6, soil_temperature_18cm: soil18 }));
const statusOf = (c: Crop, soil6: number, soil18?: number) => soilSowingAlerts(flat(soil6, soil18), [c], { today: TODAY })[0]?.level;

describe('soil status at the Harrington boundaries (radis 4.4, 7.2 to 32.2, 35)', () => {
  it.each([
    [4.3, 'trop-froid'],
    [4.4, 'possible'],
    [7.1, 'possible'],
    [7.2, 'ideal'],
    [32.2, 'ideal'],
    [32.3, 'possible'],
    [35, 'possible'],
    [35.1, 'trop-chaud'],
  ] as const)('soil at %s °C gives %s', (soil, expected) => {
    expect(statusOf(radis, soil)).toBe(expected);
  });

  it('calls a crop with min equal to optLow ideal at the minimum (haricot 15.6)', () => {
    expect(statusOf(haricot, 15.5)).toBe('trop-froid');
    expect(statusOf(haricot, 15.6)).toBe('ideal');
  });

  it('never calls a crop without optimum ideal (chou: min and max only)', () => {
    expect(statusOf(chou, 4.3)).toBe('trop-froid');
    expect(statusOf(chou, 4.4)).toBe('possible');
    expect(statusOf(chou, 20)).toBe('possible');
    expect(statusOf(chou, 37.9)).toBe('trop-chaud');
  });
});

describe('soilSowingAlerts', () => {
  it('reads the mean of the next three days at 6 cm and explains a cold soil', () => {
    const hours = [
      ...flat(2, 2, '2026-10-19', 1),
      ...days(TODAY, 3, (i) => ({
        soil_temperature_6cm: [8, 9, 10][i]!,
        modelOf: { temperature_2m: 'meteofrance_arome_france_hd', soil_temperature_6cm: 'best_match' },
      })),
      ...flat(30, 30, '2026-10-23', 1),
    ];
    const [a] = soilSowingAlerts(hours, [haricot], { today: TODAY });
    expect(a).toMatchObject({
      kind: 'soil-temp',
      level: 'trop-froid',
      date: TODAY,
      daysAhead: 0,
      estimate: true,
      crops: [{ species: 'haricot', name: 'Haricot' }],
      inputs: { depthCm: 6, meanC: 9, maxC: 10, days: ['2026-10-20', '2026-10-21', '2026-10-22'], models: ['best_match'] },
    });
    expect(a!.inputs.germSoilC).toEqual(haricot.germSoilC);
    expect(a!.inputs.params.lookAheadDays).toEqual(SOIL_TEMP_PARAMS.lookAheadDays);
    expect(a!.reason).toBe('Haricot : sol à 9 °C en surface, trop froid pour semer (15,6 °C minimum). Attends quelques jours.');
  });

  it('writes a French reason for each status', () => {
    const reason = (c: Crop, hours = flat(5)) => soilSowingAlerts(hours, [c], { today: TODAY })[0]!.reason;
    expect(reason(radis)).toBe('Radis : sol à 5 °C en surface, semis possible mais lent (idéal à partir de 7,2 °C).');
    expect(reason(radis, flat(20))).toBe('Radis : sol à 20 °C en surface, idéal pour semer cette semaine.');
    expect(reason(radis, flat(33))).toBe("Radis : sol à 33 °C en surface, semis possible, un peu chaud (idéal jusqu'à 32,2 °C).");
    expect(reason(chou, flat(12))).toBe("Chou d'hiver : sol à 12 °C en surface, semis possible (entre 4,4 et 37,8 °C).");
    const hot = days(TODAY, 3, (_, h) => ({ soil_temperature_6cm: h === 14 ? 36 : 25 }));
    expect(reason(radis, hot)).toBe(
      "Radis : sol trop chaud en surface (jusqu'à 36 °C, plus de 35 °C). Sème le soir, ombre et garde le sillon humide.",
    );
  });

  it('only looks at crops with a direct sowing window open this week and germination data', () => {
    const list = soilSowingAlerts(flat(10), [radis, closed, noData, crop('x', 'X', { germSoilC: radis.germSoilC })], { today: TODAY });
    expect(list.map((a) => a.crops[0]!.species)).toEqual(['radis']);
  });

  it('handles a window that wraps over the new year', () => {
    const wrap = { ...radis, sowDirect: { value: [{ from: 50, to: 3 }], source: 'test' } };
    expect(soilSowingAlerts(flat(10, 10, '2027-01-04'), [wrap], { today: '2027-01-04' })).toHaveLength(1);
    expect(soilSowingAlerts(flat(10), [wrap], { today: TODAY })).toHaveLength(0);
  });

  it('says nothing without three days of soil temperature', () => {
    expect(soilSowingAlerts(flat(10, 10, TODAY, 2), [radis], { today: TODAY })).toEqual([]);
    const gaps = days(TODAY, 3, (i) => ({ soil_temperature_6cm: i === 1 ? null : 10 }));
    expect(soilSowingAlerts(gaps, [radis], { today: TODAY })).toEqual([]);
  });

  it('accepts a longer look-ahead as a parameter', () => {
    const params = { ...SOIL_TEMP_PARAMS, lookAheadDays: { ...SOIL_TEMP_PARAMS.lookAheadDays, value: 4 } };
    expect(soilSowingAlerts(flat(10), [radis], { today: TODAY, params })).toEqual([]);
    expect(soilSowingAlerts(flat(10, 10, TODAY, 4), [radis], { today: TODAY, params })[0]!.inputs.days).toHaveLength(4);
  });
});

describe('potato planting from the soil at 18 cm', () => {
  it.each([
    [5.9, 'trop-froid'],
    [7.9, 'trop-froid'],
    [8, 'possible'],
    [9.9, 'possible'],
    [10, 'ideal'],
  ] as const)('soil at %s °C gives %s', (soil, expected) => {
    expect(statusOf(patate, 30, soil)).toBe(expected);
  });

  it('shows both published thresholds and counts the days at 6 °C or more', () => {
    const hours = days(TODAY, 3, (i) => ({ soil_temperature_18cm: [5, 7, 9][i]! }));
    const [a] = soilSowingAlerts(hours, [patate], { today: TODAY });
    expect(a).toMatchObject({ level: 'trop-froid', estimate: true, inputs: { depthCm: 18, meanC: 7, daysAtMarketC: 2 } });
    expect(a!.inputs.params.potatoPlantC).toEqual({ value: 8, unit: '°C', estimate: true, source: expect.any(String) });
    expect(a!.reason).toBe(
      "Pomme de terre : sol à 7 °C vers 18 cm, trop froid pour planter (8 °C conseillés ; 6 °C trois jours de suite pour certains maraîchers, 10 °C pour d'autres). Attends quelques jours.",
    );
    const warm = soilSowingAlerts(flat(20, 11), [patate], { today: TODAY })[0]!;
    expect(warm.reason).toBe('Pomme de terre : sol à 11 °C vers 18 cm, idéal pour planter cette semaine.');
    const mild = soilSowingAlerts(flat(20, 9), [patate], { today: TODAY })[0]!;
    expect(mild.reason).toBe('Pomme de terre : sol à 9 °C vers 18 cm, plantation possible (10 °C conseillés par certaines fiches).');
  });
});

describe('soilStatus properties', () => {
  const RANK: Record<SoilStatus, number> = { 'trop-froid': 0, possible: 1, ideal: 2, 'trop-chaud': 3 };
  const g = { min: 4.4, optLow: 7.2, optHigh: 32.2, max: 35 };

  it('is trop-chaud exactly when the daily maximum passes max', () => {
    fc.assert(
      fc.property(fc.double({ min: -5, max: 45, noNaN: true }), fc.double({ min: 0, max: 10, noNaN: true }), (mean, spread) => {
        expect(soilStatus(g, mean, mean + spread) === 'trop-chaud').toBe(mean + spread > g.max);
      }),
    );
  });

  it('never gets colder as the soil warms below the optimum', () => {
    fc.assert(
      fc.property(fc.double({ min: -5, max: 32, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), (mean, rise) => {
        fc.pre(mean + rise <= g.optHigh);
        expect(RANK[soilStatus(g, mean + rise, mean + rise)]).toBeGreaterThanOrEqual(RANK[soilStatus(g, mean, mean)]);
      }),
    );
  });
});
