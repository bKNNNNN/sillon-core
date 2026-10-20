import { describe, expect, it } from 'vitest';
import {
  assessNights,
  chillAlerts,
  FROST_PARAMS,
  frostAlerts,
  frostClassOf,
  frostNights,
  type Crop,
  type PlantingLike,
} from '../src/index.js';
import { hour, night } from './hourly-fixtures.js';

const crop = (id: string, name: string, extra: Partial<Crop> = {}): Crop => ({
  id,
  name,
  family: 'f',
  frostSensitive: false,
  goodCompanions: [],
  badCompanions: [],
  ...extra,
});
const tomate = crop('tomate', 'Tomate', { frostSensitive: true, frostClass: { value: 'tender', source: 'MSU' } });
const courgette = crop('courgette', 'Courgette', { frostSensitive: true, frostClass: { value: 'tender', source: 'MSU' } });
const patate = crop('pomme-de-terre', 'Pomme de terre', { frostSensitive: true, frostClass: { value: 'semi', source: 'MSU' } });
const fraise = crop('fraise', 'Fraise', { frostClass: { value: 'semi', estimate: true } });
const poireau = crop('poireau', 'Poireau', { frostClass: { value: 'hardy', estimate: true } });
const basilic = crop('basilic', 'Basilic', {
  frostSensitive: true,
  frostClass: { value: 'tender', source: 'MSU' },
  chillC: { value: 5, source: 'Frontiers 2023' },
});
const crops = [tomate, courgette, patate, fraise, poireau, basilic];

const planting = (species: string, extra: Partial<PlantingLike> = {}): PlantingLike => ({
  species,
  sownOn: '2026-05-01',
  method: 'direct',
  status: 'active',
  ...extra,
});
const TODAY = '2026-10-20';

describe('assessNights', () => {
  it('reads the minimum, the 00:00 to 06:00 cloud and wind, and the models', () => {
    const [n] = assessNights(night('2026-10-22', { tmin: 1.2, cloud: 10, wind: 5 }), { today: TODAY });
    expect(n).toMatchObject({
      night: '2026-10-22',
      daysAhead: 2,
      level: 'fort',
      estimate: true,
      inputs: {
        tminC: 1.2,
        tminAt: '2026-10-23T05:00',
        hours: 16,
        complete: true,
        meanCloudPct: 10,
        meanWindKmh: 5,
        clear: true,
        calm: true,
        models: ['meteofrance_arome_france_hd'],
      },
    });
    expect(n!.inputs.params.strongC).toEqual(FROST_PARAMS.strongC);
    expect(n!.reason).toBe('Gel possible la nuit du jeudi 22 au vendredi 23 octobre (mini prévue 1,2 °C, ciel clair, vent faible).');
  });

  it('skips nights before today', () => {
    const hours = [...night('2026-10-19', { tmin: -3 }), ...night('2026-10-20', { tmin: -3 })];
    expect(assessNights(hours, { today: TODAY }).map((n) => n.night)).toEqual(['2026-10-20']);
  });

  it('marks a night cut short by the end of the forecast and leaves cloud and wind unknown', () => {
    const hours = night('2026-10-26', { tmin: 3, cloud: 0, wind: 0 }).slice(0, 5);
    const [n] = assessNights(hours, { today: TODAY });
    expect(n!.inputs).toMatchObject({ complete: false, hours: 5, clear: null, calm: null, meanCloudPct: null });
    expect(n!.level).toBeNull();
    expect(n!.reason).toBe('Pas de gel prévu la nuit du lundi 26 au mardi 27 octobre (mini prévue 6 °C).');
  });

  it('ignores missing cloud or wind values inside the core hours', () => {
    const hours = night('2026-10-22', { tmin: 3.5, cloud: 10, wind: 5 }).map((h) =>
      h.ts === '2026-10-23T02:00' ? { ...h, cloud_cover: null, wind_speed_10m: null } : h,
    );
    expect(assessNights(hours, { today: TODAY })[0]!.level).toBe('fort');
  });

  it('writes the month on both sides when the night crosses a month', () => {
    const [n] = assessNights(night('2026-10-31', { tmin: -1 }), { today: TODAY });
    expect(n!.reason).toBe('Gel annoncé la nuit du samedi 31 octobre au dimanche 1er novembre (mini prévue -1 °C, ciel nuageux, du vent).');
    expect(n!.estimate).toBe(false);
  });

  it('accepts overridden thresholds and reports them', () => {
    const params = { ...FROST_PARAMS, strongC: { ...FROST_PARAMS.strongC, value: 3 } };
    const [n] = assessNights(night('2026-10-22', { tmin: 2.5 }), { today: TODAY, params });
    expect(n!.level).toBe('fort');
    expect(n!.inputs.params.strongC.value).toBe(3);
  });

  it('lists every model that fed the night', () => {
    const hours = night('2026-10-22', { tmin: 5 }).map((h, i) =>
      i > 10 ? { ...h, model: 'meteofrance_arpege_europe' as const, modelOf: { ...h.modelOf, cloud_cover: 'meteofrance_arome_france' as const } } : h,
    );
    expect(assessNights(hours, { today: TODAY })[0]!.inputs.models).toEqual([
      'meteofrance_arome_france_hd',
      'meteofrance_arpege_europe',
      'meteofrance_arome_france',
    ]);
  });

  it('ignores an hour without temperature', () => {
    const hours = [...night('2026-10-22', { tmin: 4 }), hour('2026-10-23T08:30', 0, { temperature_2m: null })];
    expect(assessNights(hours, { today: TODAY })[0]!.inputs.tminC).toBe(4);
  });
});

describe('frostNights', () => {
  it('keeps only nights with a level', () => {
    const hours = [...night('2026-10-21', { tmin: 8 }), ...night('2026-10-22', { tmin: 0 })];
    expect(frostNights(hours, { today: TODAY }).map((n) => [n.night, n.level])).toEqual([['2026-10-22', 'gel']]);
  });
});

describe('frostAlerts', () => {
  const nightsFor = (tmin: number, cloud = 80, wind = 15) => frostNights(night('2026-10-22', { tmin, cloud, wind }), { today: TODAY });

  it('names the tender crops in the ground and tells what to do', () => {
    const alerts = frostAlerts(nightsFor(1), [planting('tomate'), planting('courgette'), planting('poireau')], crops);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'frost', level: 'fort', date: '2026-10-22', daysAhead: 2, estimate: true });
    expect(alerts[0]!.crops.map((c) => c.species)).toEqual(['tomate', 'courgette']);
    expect(alerts[0]!.reason).toBe(
      "Gel possible la nuit du jeudi 22 au vendredi 23 octobre (mini prévue 1 °C, ciel nuageux, du vent). Couvre d'un voile le jeudi soir : tomate, courgette. Arrose le sol l'après-midi : un sol humide garde mieux la chaleur.",
    );
  });

  it('names the evening to cover on from how far ahead the night is', () => {
    const coverOn = (today: string) => frostAlerts(frostNights(night('2026-10-22', { tmin: 1 }), { today }), [planting('tomate')], crops)[0]!;
    expect(coverOn('2026-10-22')).toMatchObject({ daysAhead: 0 });
    expect(coverOn('2026-10-22').reason).toContain("Couvre d'un voile ce soir : tomate.");
    expect(coverOn('2026-10-21')).toMatchObject({ daysAhead: 1 });
    expect(coverOn('2026-10-21').reason).toContain("Couvre d'un voile demain soir : tomate.");
    expect(coverOn('2026-10-20')).toMatchObject({ daysAhead: 2 });
    expect(coverOn('2026-10-20').reason).toContain("Couvre d'un voile le jeudi soir : tomate.");
    expect(coverOn('2026-10-20').reason).not.toContain('ce soir');
  });

  it('tells to hill potatoes instead of covering them', () => {
    const [a] = frostAlerts(nightsFor(0), [planting('pomme-de-terre')], crops);
    expect(a!.reason).toContain('Butte les pommes de terre levées : la terre protège les feuilles.');
    expect(a!.reason).not.toContain('voile');
  });

  it('alerts semi-hardy crops on gel and fort, never on faible', () => {
    expect(frostAlerts(nightsFor(1.5), [planting('fraise')], crops)).toHaveLength(1);
    expect(frostAlerts(nightsFor(5, 10, 5), [planting('fraise')], crops)).toEqual([]);
    expect(frostAlerts(nightsFor(5, 10, 5), [planting('tomate')], crops)[0]!.level).toBe('faible');
  });

  it('never alerts for hardy crops only', () => {
    expect(frostAlerts(nightsFor(-4), [planting('poireau')], crops)).toEqual([]);
  });

  it('stays silent when nothing sensitive is in the ground', () => {
    const plantings = [
      planting('tomate', { status: 'done' }),
      planting('tomate', { harvestedOn: '2026-10-01' }),
      planting('tomate', { method: 'pot', sownOn: '2026-10-01' }),
      planting('tomate', { sownOn: '2026-10-25' }),
      planting('autre'),
    ];
    expect(frostAlerts(nightsFor(-2), plantings, crops)).toEqual([]);
  });

  it('counts a pot sowing once it is transplanted, and a crop harvested after the night', () => {
    const plantings = [
      planting('tomate', { method: 'pot', sownOn: '2026-04-01', transplantedOn: '2026-05-10' }),
      planting('courgette', { harvestedOn: '2026-10-30' }),
    ];
    expect(frostAlerts(nightsFor(-2), plantings, crops)[0]!.crops).toHaveLength(2);
  });

  it('lists a crop once even with several plantings', () => {
    const [a] = frostAlerts(nightsFor(1), [planting('tomate'), planting('tomate', { sownOn: '2026-06-01' })], crops);
    expect(a!.crops).toHaveLength(1);
  });

  it('falls back to frostSensitive when the crop has no frost class', () => {
    const old = crop('haricot', 'Haricot', { frostSensitive: true });
    const [a] = frostAlerts(nightsFor(1), [planting('haricot')], [old]);
    expect(a!.crops).toEqual([{ species: 'haricot', name: 'Haricot', frostClass: 'tender', frostClassFrom: 'frostSensitive' }]);
  });

  it('copies the night inputs into the alert', () => {
    const [a] = frostAlerts(nightsFor(1), [planting('tomate')], crops);
    expect(a!.inputs.tminC).toBe(1);
    expect(a!.inputs.params.strongC.estimate).toBe(true);
  });
});

describe('frostClassOf', () => {
  it('prefers frostClass, then maps frostSensitive', () => {
    expect(frostClassOf(patate)).toEqual({ frostClass: 'semi', from: 'frostClass' });
    expect(frostClassOf(crop('x', 'X', { frostSensitive: true }))).toEqual({ frostClass: 'tender', from: 'frostSensitive' });
    expect(frostClassOf(crop('x', 'X'))).toEqual({ frostClass: 'hardy', from: 'frostSensitive' });
  });
});

describe('chillAlerts', () => {
  const young = planting('basilic', { method: 'bought', sownOn: '2026-10-05' });
  const hours = (tmin: number, cloud = 80, wind = 15) => night('2026-10-22', { tmin, cloud, wind });

  it('warns for a young basil on a cold night without frost', () => {
    const [a] = chillAlerts(hours(4.5), { today: TODAY }, [young], crops);
    expect(a).toMatchObject({ kind: 'chill', level: 'froid', date: '2026-10-22', estimate: true });
    expect(a!.reason).toBe(
      "Nuit froide pour les jeunes plants de basilic du jeudi 22 au vendredi 23 octobre (mini prévue 4,5 °C, seuil 5 °C). Couvre-les d'un voile le jeudi soir.",
    );
    expect(a!.inputs).toMatchObject({ chillC: { value: 5, source: 'Frontiers 2023' }, tminC: 4.5 });
    expect(a!.inputs.params.chillRecentDays.value).toBe(30);
  });

  it('names the evening to cover the basil on from how far ahead the night is', () => {
    const coverOn = (today: string) => chillAlerts(night('2026-10-22', { tmin: 4.5 }), { today }, [young], crops)[0]!.reason;
    expect(coverOn('2026-10-22')).toMatch(/Couvre-les d'un voile ce soir\.$/);
    expect(coverOn('2026-10-21')).toMatch(/Couvre-les d'un voile demain soir\.$/);
    expect(coverOn('2026-10-20')).toMatch(/Couvre-les d'un voile le jeudi soir\.$/);
  });

  it('fires at the threshold and not above it', () => {
    expect(chillAlerts(hours(5), { today: TODAY }, [young], crops)).toHaveLength(1);
    expect(chillAlerts(hours(5.1), { today: TODAY }, [young], crops)).toEqual([]);
  });

  it('stays silent for a basil planted 30 days or more before the night', () => {
    expect(chillAlerts(hours(3), { today: TODAY }, [planting('basilic', { method: 'bought', sownOn: '2026-09-22' })], crops)).toEqual([]);
    expect(chillAlerts(hours(3), { today: TODAY }, [planting('basilic', { method: 'bought', sownOn: '2026-09-23' })], crops)).toHaveLength(1);
  });

  it('leaves the night to the frost alert when it already covers the crop', () => {
    expect(chillAlerts(hours(1.5), { today: TODAY }, [young], crops)).toEqual([]);
    expect(chillAlerts(hours(4, 10, 5), { today: TODAY }, [young], crops)).toEqual([]);
  });

  it('reads the hours itself, so a quiet night that frostNights drops still warns the basil', () => {
    const cloudy = hours(4.5);
    expect(frostNights(cloudy, { today: TODAY })).toEqual([]);
    expect(assessNights(cloudy, { today: TODAY })[0]!.level).toBeNull();
    expect(chillAlerts(cloudy, { today: TODAY }, [young], crops)).toHaveLength(1);
  });

  it('passes the frost params through to the night assessment', () => {
    const params = { ...FROST_PARAMS, strongC: { ...FROST_PARAMS.strongC, value: 5 } };
    expect(chillAlerts(hours(4.5), { today: TODAY, params }, [young], crops)).toEqual([]);
    expect(chillAlerts(hours(4.5), { today: TODAY }, [young], crops)[0]!.inputs.params.strongC.value).toBe(2);
  });

  it('ignores crops without chillC and plantings not in the ground', () => {
    expect(chillAlerts(hours(3), { today: TODAY }, [planting('courgette', { sownOn: '2026-10-10' })], crops)).toEqual([]);
    expect(chillAlerts(hours(3), { today: TODAY }, [planting('basilic', { method: 'pot', sownOn: '2026-10-10' })], crops)).toEqual([]);
  });
});
