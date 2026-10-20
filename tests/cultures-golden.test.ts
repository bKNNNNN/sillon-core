import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forecastFirstHarvest, getCrop, parseCrops, rotationAdvice, rotationWarning, whatsNext } from '../src/index.js';
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

  it('counts bought garlic cloves and seed potatoes as planted in their window', () => {
    const ail = { ...basePlanting, species: 'ail', method: 'bought' as const, sownOn: '2026-10-18' };
    const garlic = whatsNext(crops, [ail], '2026-10-21').find((a) => a.cropId === 'ail');
    expect(garlic).toMatchObject({ action: 'sow_direct', doneOn: ['2026-10-18'] });
    expect(garlic?.reason).toBe('Fenêtre de semis direct : semaines 41 à 49. Déjà planté le 18 oct.');
    const tubers = { ...basePlanting, species: 'pomme-de-terre', method: 'bought' as const, sownOn: '2026-04-01' };
    const potato = whatsNext(crops, [tubers], '2026-04-08').find((a) => a.cropId === 'pomme-de-terre');
    expect(potato).toMatchObject({ action: 'sow_direct', doneOn: ['2026-04-01'] });
    expect(potato?.reason).toBe('Fenêtre de semis direct : semaines 11 à 17. Déjà planté le 1er avr.');
  });

  it('a bought onion set counts for the onion transplant window, not its sowing', () => {
    const set = { ...basePlanting, species: 'oignon', method: 'bought' as const, sownOn: '2026-04-01' };
    const rows = whatsNext(crops, [set], '2026-04-08').filter((a) => a.cropId === 'oignon');
    expect(rows.map((a) => [a.action, a.doneOn])).toEqual([['sow_direct', []], ['transplant', ['2026-04-01']]]);
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

describe('rotation on sillon-cultures v0.2.0', () => {
  it('warns for winter cabbage after a harvested summer cabbage on the same bed in one year', () => {
    const advice = rotationAdvice([{ species: 'chou-ete', sownOn: '2026-03-01', status: 'done', harvestedOn: '2026-06-10' }], 'chou-hiver', '2026-06-15', crops);
    expect(advice).toMatchObject({ family: 'brassicacees', lastYear: 2026, rotationYears: 4, soilPhAdvice: true });
    expect(advice?.warning).toBe('Brassicacées déjà sur cette planche en 2026 : pense à faire tourner.');
  });

  it('warns for late potatoes after harvested tomatoes and for garlic after harvested onions in one year', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2026-03-01', status: 'done', harvestedOn: '2026-07-15' }], 'pomme-de-terre', '2026-07-20', crops))
      .toBe('Solanacées déjà sur cette planche en 2026 : pense à faire tourner.');
    expect(rotationWarning([{ species: 'oignon', sownOn: '2026-03-01', status: 'done', harvestedOn: '2026-08-20' }], 'ail', '2026-10-18', crops))
      .toBe('Amaryllidacées déjà sur cette planche en 2026 : pense à faire tourner.');
  });

  it('summer and winter cabbage growing side by side stay silent', () => {
    expect(rotationWarning([{ species: 'chou-ete', sownOn: '2026-03-01', status: 'active' }], 'chou-hiver', '2026-06-15', crops)).toBeNull();
  });

  it('a resowing of the same crop in one year stays silent, alias included', () => {
    expect(rotationWarning([{ species: 'chou', sownOn: '2026-03-01', status: 'done', harvestedOn: '2026-05-01' }], 'chou-ete', '2026-05-10', crops)).toBeNull();
    expect(rotationWarning([{ species: 'pomme-de-terre', sownOn: '2026-03-20' }], 'pomme-de-terre', '2026-07-20', crops)).toBeNull();
  });
});
