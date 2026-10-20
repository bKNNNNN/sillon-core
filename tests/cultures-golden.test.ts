import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forecastFirstHarvest, getCrop, parseCrops, whatsNext } from '../src/index.js';
import { basePlanting } from './fixtures.js';

const crops = parseCrops(readFileSync(new URL('./fixtures/cultures-v0.2.0.yaml', import.meta.url), 'utf8'));

const DATES = ['2026-02-10', '2026-03-18', '2026-05-20', '2026-08-26', '2026-10-21'];

describe('whatsNext on sillon-cultures v0.2.0', () => {
  it.each(DATES)('golden plan for %s', (today) => {
    const lines = whatsNext(crops, [], today).map((a) => `${a.cropId} ${a.action}${a.estimate ? ' ~' : ''}: ${a.reason}`);
    expect(lines).toMatchSnapshot();
  });

  it('keeps chou plantings attached to chou-ete', () => {
    expect(getCrop(crops, 'chou')?.id).toBe('chou-ete');
    const stored = { ...basePlanting, species: 'chou', method: 'pot' as const, sownOn: '2026-03-01' };
    const plan = whatsNext(crops, [stored], '2026-03-18');
    const row = plan.find((a) => a.cropId === 'chou-ete' && a.action === 'sow_under_cover');
    expect(row?.doneOn).toEqual(['2026-03-01']);
  });

  it('keeps the garlic window after the planting of 18 October', () => {
    const ail = { ...basePlanting, species: 'ail', sownOn: '2026-10-18' };
    const row = whatsNext(crops, [ail], '2026-10-21').find((a) => a.cropId === 'ail');
    expect(row).toMatchObject({ action: 'sow_direct', doneOn: ['2026-10-18'] });
    expect(row?.reason).toBe('Fenêtre de semis direct : semaines 41 à 49. Déjà semé le 18 oct.');
  });

  it('gives a bought courgette plant a harvest counted from planting', () => {
    const courgette = getCrop(crops, 'courgette')!;
    const plant = { ...basePlanting, species: 'courgette', method: 'bought' as const, sownOn: '2026-05-10' };
    expect(forecastFirstHarvest(plant, courgette)?.expected).toBe('2026-06-14');
  });

  it('labels the concombre transplant end as an estimate, not a quote', () => {
    const source = getCrop(crops, 'concombre')?.transplant?.source ?? '';
    expect(getCrop(crops, 'concombre')?.transplant?.value).toEqual({ from: 19, to: 27 });
    expect(source).toContain('to: estimation');
    expect(source).toContain('pas avant le mois de mai');
    expect(source).not.toContain('jusque fin juin');
  });
});
