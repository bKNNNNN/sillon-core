import { describe, expect, it } from 'vitest';
import { WATER_PARAMS, waterAdvice, waterAlerts, type BedWaterInput } from '../src/index.js';
import { ail, dry, planting, salade, tomate, weather, type DayShape } from './water-fixtures.js';

const crops = [tomate, salade, ail];
/** Friday 17 July 2026: the morning state is the end of Thursday 16. */
const TODAY = '2026-07-17';
const bed = { name: 'Planche 2', areaM2: 4, soil: 'sable' as const };

/** A tomato bed soaked on Sunday 12 July (60 mm), then the given days. */
const input = (after: DayShape[], extra: Partial<BedWaterInput> = {}): BedWaterInput => ({
  bed,
  plantings: [planting('tomate')],
  crops,
  weather: weather('2026-07-12', [{ rain: 60 }, ...after]),
  today: TODAY,
  ...extra,
});
const forecastDry = dry(2, { source: 'forecast' });

describe('waterAdvice', () => {
  it('asks for a dose in mm and litres when the reserve is used up (agronomy 4.3 example)', () => {
    const a = waterAdvice(input([...dry(4), ...forecastDry]));
    expect(a).toMatchObject({ bed: 'Planche 2', date: TODAY, status: 'ok', level: 'arroser', estimate: true, crops: [{ species: 'tomate', name: 'Tomate' }] });
    expect(a.inputs.doseMm).toBeCloseTo(23, 10);
    expect(a.inputs.doseL).toBeCloseTo(92, 10);
    expect(a.inputs.driver).toMatchObject({ species: 'tomate', since: { date: '2026-07-12', from: 'rain' }, kc: 1.15, et0MeanMm: 5 });
    expect(a.inputs.driver!.rawMm).toBeCloseTo(20.72, 10);
    expect(a.inputs.params).toEqual(WATER_PARAMS);
    expect(a.reason).toBe(
      'Planche 2 (tomate) : consommé 23 mm sur 21 mm de réserve facile depuis la pluie du 12 juillet (ET0 5 mm/j × Kc 1,15). Arrose 23 L/m², soit 92 L pour la planche.',
    );
  });

  it('says to water at the foot in the morning when mildew is in the air', () => {
    const a = waterAdvice(input([...dry(4), ...forecastDry], { mildewRisk: true }));
    expect(a.inputs.mildewRisk).toBe(true);
    expect(a.reason).toBe(
      'Planche 2 (tomate) : consommé 23 mm sur 21 mm de réserve facile depuis la pluie du 12 juillet (ET0 5 mm/j × Kc 1,15). Arrose 23 L/m², soit 92 L pour la planche, au pied, le matin : risque de mildiou, ne mouille pas le feuillage.',
    );
  });

  it('keeps the plain advice on a bed with no mildew host', () => {
    const lettuce = [planting('salade', { sownOn: '2026-05-15' })];
    const a = waterAdvice(input([...dry(2), ...forecastDry], { plantings: lettuce, mildewRisk: true }));
    expect(a.inputs.mildewRisk).toBe(false);
    expect(a.reason).not.toContain('mildiou');
  });

  it('waits for forecast rain that covers half the deficit', () => {
    const a = waterAdvice(input([...dry(4), { rain: 8, source: 'forecast' }, { rain: 5, source: 'forecast' }]));
    expect(a.level).toBe('pluie-prevue');
    expect(a.inputs.rainForecastMm).toBe(13);
    expect(a.reason).toBe(
      "Planche 2 (tomate) : consommé 23 mm sur 21 mm de réserve facile depuis la pluie du 12 juillet (ET0 5 mm/j × Kc 1,15). Attends la pluie prévue : 13 mm d'ici demain.",
    );
  });

  it('does not wait for rain that would not count', () => {
    const a = waterAdvice(input([...dry(4), { rain: 0.5, source: 'forecast' }, { rain: 11, source: 'forecast' }]));
    expect(a.inputs.rainForecastMm).toBe(11);
    expect(a.level).toBe('arroser');
  });

  it('warns a day or two ahead from 0.7 RAW', () => {
    const a = waterAdvice(input([...dry(3), ...forecastDry], { today: '2026-07-16' }));
    expect(a.level).toBe('a-prevoir');
    expect(a.reason).toBe(
      "Planche 2 (tomate) : consommé 17 mm sur 21 mm de réserve facile depuis la pluie du 12 juillet (ET0 5 mm/j × Kc 1,15). Arrosage à prévoir d'ici 1 à 2 jours.",
    );
  });

  it('says there is nothing to water below 0.7 RAW, and names the last watering', () => {
    const a = waterAdvice(input([...dry(4), ...forecastDry], { irrigations: [{ date: '2026-07-14', mm: 20 }] }));
    expect(a.level).toBeNull();
    expect(a.inputs.driver!.since).toEqual({ date: '2026-07-14', from: 'irrigation' });
    expect(a.reason).toBe("Planche 2 (tomate) : rien à arroser, consommé 12 mm sur 21 mm de réserve facile depuis l'arrosage du 14 juillet.");
  });

  it('takes the crop with the highest Dr/RAW as the driver', () => {
    const both = [planting('tomate'), planting('salade', { sownOn: '2026-05-15' })];
    const a = waterAdvice(input([...dry(2), ...forecastDry], { plantings: both, today: '2026-07-15' }));
    expect(a.inputs.driver!.species).toBe('salade');
    expect(a.inputs.perCrop.map((c) => c.species)).toEqual(['tomate', 'salade']);
    expect(a.level).toBe('arroser');
    expect(a.inputs.doseMm).toBeCloseTo(10, 10);
    expect(a.reason).toMatch(/^Planche 2 \(salade\) : consommé 10 mm sur 7 mm/);
  });

  it('counts from the state the owner gave', () => {
    const a = waterAdvice(input(dry(5), { start: { date: '2026-07-14', drMm: 4 } }));
    expect(a.inputs.driver!.since).toEqual({ date: '2026-07-14', from: 'start' });
    expect(a.reason).toContain('depuis le 14 juillet (ET0 5 mm/j');
  });

  it('asks for the soil state when the owner answer is older than the weather', () => {
    const a = waterAdvice({ ...input([]), weather: weather('2026-07-08', dry(7)), today: '2026-07-14', start: { date: '2026-07-01', drMm: 0 } });
    expect(a).toMatchObject({ status: 'unknown', level: null });
  });

  it('asks for the soil state when it is unknown', () => {
    const a = waterAdvice({ ...input([]), weather: weather('2026-07-12', dry(6)) });
    expect(a).toMatchObject({ status: 'unknown', level: null });
    expect(a.inputs.unknown).toEqual(['tomate']);
    expect(a.reason).toBe("Planche 2 : réserve du sol inconnue. Indique si le sol est humide aujourd'hui pour lancer le calcul.");
  });

  it('starts from an owner state given this morning', () => {
    const a = waterAdvice(input(dry(5), { start: { date: TODAY, drMm: 0 } }));
    expect(a.status).toBe('ok');
    expect(a.level).toBeNull();
  });

  it('says when there is no water data for the crops', () => {
    const a = waterAdvice(input([...dry(4), ...forecastDry], { plantings: [planting('ail')] }));
    expect(a).toMatchObject({ status: 'no-data', level: null });
    expect(a.inputs.noData).toEqual([{ species: 'ail', name: 'Ail', missing: ['kc', 'kcStages', 'rootDepthM', 'depletionP'] }]);
    expect(a.reason).toBe("Planche 2 : pas de donnée d'arrosage pour ail.");
  });

  it('mentions crops without data next to the advice for the others', () => {
    const a = waterAdvice(input([...dry(4), ...forecastDry], { plantings: [planting('tomate'), planting('ail')] }));
    expect(a.level).toBe('arroser');
    expect(a.reason).toMatch(/pour la planche\. Pas de donnée d'arrosage pour ail\.$/);
  });

  it('leaves out plantings that are done, harvested, unknown or not yet in the ground', () => {
    const list = [
      planting('tomate', { status: 'done' }),
      planting('tomate', { harvestedOn: '2026-07-10' }),
      planting('tomate', { sownOn: '2026-07-20' }),
      planting('tomate', { method: 'pot' }),
      planting('inconnue'),
    ];
    const a = waterAdvice(input([...dry(4), ...forecastDry], { plantings: list }));
    expect(a).toMatchObject({ status: 'no-crop', level: null, crops: [] });
    expect(a.reason).toBe('Planche 2 : rien en place, rien à arroser.');
  });
});

describe('waterAlerts', () => {
  it('keeps the beds that need water, as water alerts', () => {
    const due = waterAdvice(input([...dry(4), ...forecastDry]));
    const fine = waterAdvice(input([...dry(1), ...forecastDry], { today: '2026-07-14' }));
    const alerts = waterAlerts([due, fine]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'water', level: 'arroser', date: TODAY, daysAhead: 0, reason: due.reason, estimate: true });
    expect(alerts[0]!.inputs.bed).toBe('Planche 2');
  });
});
