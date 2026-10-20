import { describe, expect, it } from 'vitest';
import {
  adjustedDepletion,
  cropStage,
  effectiveRain,
  readilyAvailableWater,
  SOIL_WATER,
  totalAvailableWater,
  WATER_PARAMS,
  waterBalance,
  type WaterBalance,
} from '../src/index.js';
import { ail, dry, fraise, planting, salade, tomate, weather } from './water-fixtures.js';

const balanced = (b: WaterBalance) => {
  if (b.kind !== 'balance') throw new Error(`expected a balance, got ${b.kind}`);
  return b;
};

describe('effective rain (FAO-56: under 0.2 ET0 it evaporates)', () => {
  it.each([
    [0.9, 5, 0],
    [1, 5, 1],
    [12, 5, 12],
    [0.3, 1, 0.3],
    [0, 0, 0],
  ] as const)('%s mm on a %s mm ET0 day counts %s mm', (rain, et0, expected) => {
    expect(effectiveRain(rain, et0)).toBe(expected);
  });
});

describe('depletion fraction p, adjusted for ETc (FAO-56 table 22 note)', () => {
  it('lowers p on a hot day and raises it on a mild one', () => {
    expect(adjustedDepletion(0.4, 5.75)).toBeCloseTo(0.37, 10);
    expect(adjustedDepletion(0.3, 5)).toBeCloseTo(0.3, 10);
    expect(adjustedDepletion(0.3, 3)).toBeCloseTo(0.38, 10);
  });

  it('stays between 0.1 and 0.8', () => {
    expect(adjustedDepletion(0.8, 0)).toBe(0.8);
    expect(adjustedDepletion(0.1, 12)).toBe(0.1);
  });
});

describe('agronomy 4.2 worked examples (July, ET0 5 mm/day, sand 0.08)', () => {
  const sand = SOIL_WATER.sable.value;

  it('tomato in mid stage: TAW 56 mm, RAW 20.7 mm', () => {
    const taw = totalAvailableWater(sand, 0.7);
    expect(taw).toBeCloseTo(56, 10);
    expect(readilyAvailableWater(taw, 0.4, 5 * 1.15)).toBeCloseTo(20.7, 1);
  });

  it('lettuce: TAW 24 mm, RAW 7.2 mm', () => {
    const taw = totalAvailableWater(sand, 0.3);
    expect(taw).toBeCloseTo(24, 10);
    expect(readilyAvailableWater(taw, 0.3, 5 * 1.0)).toBeCloseTo(7.2, 10);
  });

  it('strawberry: TAW 16 mm, RAW 3.2 mm at the 5 mm reference ETc', () => {
    const taw = totalAvailableWater(sand, 0.2);
    expect(taw).toBeCloseTo(16, 10);
    expect(readilyAvailableWater(taw, 0.2, 5)).toBeCloseTo(3.2, 10);
    // With its own mid Kc (0.85) the p adjustment raises RAW a little.
    expect(readilyAvailableWater(taw, 0.2, 5 * 0.85)).toBeCloseTo(3.68, 10);
  });

  it('the same numbers come out of the daily balance', () => {
    const tomato = balanced(waterBalance({ planting: planting('tomate'), crop: tomate, weather: weather('2026-07-12', [{ rain: 60 }, ...dry(4)]), soil: 'sable' }));
    const last = tomato.days[tomato.days.length - 1]!;
    expect(last).toMatchObject({ date: '2026-07-16', stage: 'mid', kc: 1.15, zrM: 0.7 });
    expect(last.tawMm).toBeCloseTo(56, 10);
    expect(last.rawMm).toBeCloseTo(20.72, 10);
    expect(last.drMm).toBeCloseTo(23, 10);

    const lettuce = balanced(waterBalance({ planting: planting('salade', { sownOn: '2026-05-15' }), crop: salade, weather: weather('2026-07-12', [{ rain: 60 }, ...dry(1)]), soil: 'sable' }));
    expect(lettuce.days[1]).toMatchObject({ stage: 'mid', kc: 1, etcMm: 5 });
    expect(lettuce.days[1]!.rawMm).toBeCloseTo(7.2, 10);
  });
});

describe('cropStage', () => {
  it.each([
    [0, 'init', 0.6, 0],
    [29, 'init', 0.6, 29 / 70],
    [30, 'dev', 0.6, 30 / 70],
    [50, 'dev', 0.875, 50 / 70],
    [70, 'mid', 1.15, 1],
    [109, 'mid', 1.15, 1],
    [110, 'late', 1.15, 1],
    [122.5, 'late', 0.975, 1],
    [200, 'late', 0.8, 1],
  ] as const)('tomato %s days after planting is %s, Kc %s', (days, stage, kc, root) => {
    const s = cropStage(tomate, { days, gddFraction: null });
    expect(s).toMatchObject({ kind: 'stage', stage, from: 'fao56-table11' });
    if (s.kind !== 'stage') return;
    expect(s.kc).toBeCloseTo(kc, 10);
    expect(s.rootFraction).toBeCloseTo(root, 10);
  });

  it('follows the degree-day fractions when the crop has them', () => {
    const s = cropStage(fraise, { days: 10, gddFraction: 0.35 });
    expect(s).toMatchObject({ kind: 'stage', stage: 'dev', from: 'gdd-fraction' });
    if (s.kind !== 'stage') return;
    expect(s.kc).toBeCloseTo(0.4 + 0.45 * 0.5, 10);
    expect(s.rootFraction).toBeCloseTo(0.7, 10);
  });

  it('falls back to the estimated default fractions for a crop with degree-days only', () => {
    const noStages = { ...fraise, kcStages: undefined };
    const s = cropStage(noStages, { days: 10, gddFraction: 0.5 });
    expect(s).toMatchObject({ kind: 'stage', stage: 'mid', from: 'default-fractions', kc: 0.85 });
    expect(WATER_PARAMS.midFrom.estimate).toBe(true);
  });

  it('needs the degree-day progress for a degree-day crop', () => {
    expect(cropStage(fraise, { days: 10, gddFraction: null })).toEqual({ kind: 'no-data', missing: ['gdd'] });
  });

  it('reports gdd missing for degree-day fractions without a degree-day total', () => {
    const noTotal = { ...fraise, gdd: undefined };
    expect(cropStage(noTotal, { days: 10, gddFraction: 0 })).toEqual({ kind: 'no-data', missing: ['gdd'] });
    const tomatoByGdd = {
      ...tomate,
      kcStages: { value: { method: 'gdd-fraction' as const, devFrom: 0.15, midFrom: 0.4, lateFrom: 0.8 }, estimate: true },
      tBaseC: { value: 10, estimate: true },
    };
    expect(cropStage(tomatoByGdd, { days: 90, gddFraction: 0 })).toEqual({ kind: 'no-data', missing: ['gdd'] });
    const b = waterBalance({ planting: planting('tomate'), crop: tomatoByGdd, weather: weather('2026-04-15', dry(90, { tmin: 18, tmax: 30 })), soil: 'sable', start: { date: '2026-04-15', drMm: 0 } });
    expect(b).toEqual({ kind: 'no-data', missing: ['gdd'] });
  });

  it('names what is missing', () => {
    expect(cropStage(ail, { days: 10, gddFraction: null })).toEqual({ kind: 'no-data', missing: ['kc', 'kcStages'] });
  });
});

describe('waterBalance', () => {
  const tomatoIn = (shapes: Parameters<typeof weather>[1], extra: Partial<Parameters<typeof waterBalance>[0]> = {}) =>
    waterBalance({ planting: planting('tomate'), crop: tomate, weather: weather('2026-07-12', shapes), soil: 'sable', ...extra });

  it('waits for a known state: no heavy rain and no start means unknown', () => {
    expect(tomatoIn(dry(5))).toEqual({ kind: 'unknown', missing: ['start'] });
    expect(tomatoIn([{ rain: 40 }, ...dry(3)])).toEqual({ kind: 'unknown', missing: ['start'] });
  });

  it('anchors at field capacity after 20 mm of rain from November to May', () => {
    const b = balanced(waterBalance({ planting: planting('tomate'), crop: tomate, weather: weather('2026-05-02', [{ rain: 22 }, ...dry(2)]), soil: 'sable' }));
    expect(b.anchor).toEqual({ date: '2026-05-02', drMm: 0, from: 'rain' });
    expect(b.days.map((d) => d.date)).toEqual(['2026-05-02', '2026-05-03', '2026-05-04']);
  });

  it('anchors at any season on a rain that refills the whole reserve', () => {
    const b = balanced(tomatoIn([{ rain: 10 }, { rain: 56 }, ...dry(1)]));
    expect(b.anchor).toEqual({ date: '2026-07-13', drMm: 0, from: 'rain' });
  });

  it('starts from the state the owner gave', () => {
    const b = balanced(tomatoIn(dry(3), { start: { date: '2026-07-12', drMm: 10 } }));
    expect(b.anchor).toEqual({ date: '2026-07-12', drMm: 10, from: 'start' });
    expect(b.days.map((d) => d.drMm)).toEqual([10, 15.75, 21.5]);
  });

  it('seeds the first weather day from a start on the day before it', () => {
    const b = balanced(tomatoIn(dry(3), { start: { date: '2026-07-11', drMm: 10 } }));
    expect(b.anchor).toEqual({ date: '2026-07-11', drMm: 10, from: 'start' });
    expect(b.days.map((d) => d.date)).toEqual(['2026-07-12', '2026-07-13', '2026-07-14']);
    expect(b.days.map((d) => d.drMm)).toEqual([15.75, 21.5, 27.25]);
  });

  it('ignores a start the weather cannot reach, before or after it', () => {
    const early = { start: { date: '2026-07-01', drMm: 0 } };
    const late = { start: { date: '2026-07-20', drMm: 0 } };
    expect(tomatoIn(dry(7), early)).toEqual({ kind: 'unknown', missing: ['start'] });
    expect(tomatoIn(dry(7), late)).toEqual({ kind: 'unknown', missing: ['start'] });
    expect(balanced(tomatoIn([...dry(2), { rain: 60 }, ...dry(1)], early)).anchor).toEqual({ date: '2026-07-14', drMm: 0, from: 'rain' });
    expect(balanced(tomatoIn([...dry(2), { rain: 60 }, ...dry(1)], late)).anchor).toEqual({ date: '2026-07-14', drMm: 0, from: 'rain' });
  });

  it('takes a start on the last weather day', () => {
    const b = balanced(tomatoIn(dry(3), { start: { date: '2026-07-14', drMm: 4 } }));
    expect(b.days.map((d) => [d.date, d.drMm])).toEqual([['2026-07-14', 4]]);
  });

  it('ignores rain under 0.2 ET0 and drains what goes past field capacity', () => {
    const b = balanced(tomatoIn([{ rain: 60 }, { rain: 0.9 }, { rain: 3 }, { rain: 30 }]));
    expect(b.days.map((d) => [d.effectiveRainMm, d.drMm, d.drainedMm])).toEqual([
      [60, 0, 0],
      [0, 5.75, 0],
      [3, 8.5, 0],
      [30, 0, 15.75],
    ]);
  });

  it('subtracts logged waterings', () => {
    const b = balanced(tomatoIn([{ rain: 60 }, ...dry(3)], { irrigations: [{ date: '2026-07-14', mm: 10 }, { date: '2026-07-14', mm: 2 }] }));
    expect(b.days.map((d) => [d.irrigationMm, d.drMm])).toEqual([
      [0, 0],
      [0, 5.75],
      [12, 0],
      [0, 5.75],
    ]);
  });

  it('never goes past the total available water', () => {
    const b = balanced(tomatoIn([{ rain: 60 }, ...dry(20, { et0: 7 })]));
    expect(b.days[b.days.length - 1]!.drMm).toBeCloseTo(56, 10);
  });

  it('grows the roots from 0.15 m at planting', () => {
    const young = planting('tomate', { sownOn: '2026-07-12' });
    const b = balanced(waterBalance({ planting: young, crop: tomate, weather: weather('2026-07-12', [{ rain: 60 }, ...dry(35)]), soil: 'sable' }));
    expect(b.days[0]!.zrM).toBeCloseTo(0.15, 10);
    expect(b.days[35]!.zrM).toBeCloseTo(0.15 + 0.55 * (35 / 70), 10);
    expect(b.days[0]!.tawMm).toBeCloseTo(12, 10);
  });

  it('counts a pot sowing from its transplant and treats days before as bare seedbed', () => {
    const pot = planting('tomate', { method: 'pot', sownOn: '2026-05-01', transplantedOn: '2026-07-14' });
    const b = balanced(waterBalance({ planting: pot, crop: tomate, weather: weather('2026-07-12', [{ rain: 60 }, ...dry(3)]), soil: 'sable' }));
    expect(b.days.map((d) => d.stage)).toEqual(['init', 'init', 'init', 'init']);
    expect(b.days.map((d) => Math.round(d.zrM * 10_000) / 10_000)).toEqual([0.15, 0.15, 0.15, Math.round((0.15 + 0.55 / 70) * 10_000) / 10_000]);
    expect(b.inGroundOn).toBe('2026-07-14');
  });

  it('reads the degree-day progress from the weather for a degree-day crop', () => {
    const p = planting('fraise', { sownOn: '2026-07-12' });
    const b = balanced(waterBalance({ planting: p, crop: fraise, weather: weather('2026-07-12', [{ rain: 60 }, ...dry(19)]), soil: 'sable' }));
    // 15 degree-days a day (mean 20 °C, base 5 °C): day 19 has 300 of 1000, so dev.
    expect(b.days[19]).toMatchObject({ stage: 'dev', from: 'gdd-fraction' });
    expect(b.gddComplete).toBe(true);
  });

  it('flags degree-days counted from a later first weather day', () => {
    const p = planting('fraise', { sownOn: '2026-06-01' });
    const b = balanced(waterBalance({ planting: p, crop: fraise, weather: weather('2026-07-12', [{ rain: 60 }, ...dry(2)]), soil: 'sable' }));
    expect(b.gddComplete).toBe(false);
  });

  it('uses the soil type or an explicit water capacity', () => {
    const shapes = [{ rain: 90 }, ...dry(1)];
    const pure = balanced(tomatoIn(shapes, { soil: 'sable-pur' }));
    const amended = balanced(tomatoIn(shapes, { soil: 'sable-amende' }));
    const custom = balanced(tomatoIn(shapes, { soil: { value: 0.12, unit: 'm3/m3', estimate: true } }));
    expect([pure, amended, custom].map((b) => Math.round(b.days[1]!.tawMm * 10) / 10)).toEqual([42, 70, 84]);
    expect(custom.soil.value).toBe(0.12);
  });

  it('lists missing crop data instead of guessing', () => {
    const b = waterBalance({ planting: planting('ail'), crop: ail, weather: weather('2026-07-12', [{ rain: 60 }]), soil: 'sable' });
    expect(b).toEqual({ kind: 'no-data', missing: ['kc', 'kcStages', 'rootDepthM', 'depletionP'] });
  });

  it('is empty for a planting not yet in the ground or without weather', () => {
    expect(waterBalance({ planting: planting('tomate'), crop: tomate, weather: [], soil: 'sable' })).toEqual({ kind: 'unknown', missing: ['weather'] });
    const pot = planting('tomate', { method: 'pot', sownOn: '2026-05-01' });
    expect(waterBalance({ planting: pot, crop: tomate, weather: weather('2026-07-12', [{ rain: 60 }]), soil: 'sable' })).toEqual({ kind: 'unknown', missing: ['inGround'] });
  });
});
