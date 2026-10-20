import { addWeeks, differenceInCalendarDays, format, getISOWeek, getISOWeekYear, parseISO, startOfISOWeek } from 'date-fns';
import { isCrop, windowsOf, type Crop, type Sourced, type WeekWindow, type WeekWindows } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';
import { doneSuffix } from './done-text.js';

/**
 * The planting fields `whatsNext` reads. `method` and `transplantedOn` are optional:
 * without a method, a sowing counts for every sowing window.
 */
export type CalendarPlanting = Pick<PlantingLike, 'species' | 'sownOn' | 'status'> &
  Partial<Pick<PlantingLike, 'method' | 'transplantedOn'>>;

export type WeeklyAction = {
  cropId: string;
  cropName: string;
  action: 'sow_under_cover' | 'sow_direct' | 'transplant' | 'succession';
  estimate: boolean;
  reason: string;
  /** Dates (YYYY-MM-DD, ascending) this window was already done in its current occurrence. Empty when not yet. */
  doneOn: string[];
};

type Sow = 'sow_under_cover' | 'sow_direct';

function inWindow(week: number, { from, to }: WeekWindow): boolean {
  return from <= to ? week >= from && week <= to : week >= from || week <= to;
}

function currentWindow(week: number, windows: WeekWindows): WeekWindow | undefined {
  return windowsOf(windows).find((w) => inWindow(week, w));
}

function windowReason(label: string, { from, to, note }: WeekWindow): string {
  const qualifier = note ? ` (${note})` : '';
  return `Fenêtre de ${label}${qualifier} : semaines ${from} à ${to}.`;
}

function occurrenceStart(window: WeekWindow, today: string): string {
  const now = parseISO(today);
  const wrapped = window.from > window.to && getISOWeek(now) <= window.to;
  const isoYear = getISOWeekYear(now) - (wrapped ? 1 : 0);
  const weekOne = startOfISOWeek(new Date(isoYear, 0, 4));
  return format(addWeeks(weekOne, window.from - 1), 'yyyy-MM-dd');
}

const SOW_METHOD: Record<Sow, PlantingLike['method']> = { sow_under_cover: 'pot', sow_direct: 'direct' };

/** Sorted unique dates. */
const dates = (list: (string | null | undefined)[]): string[] =>
  [...new Set(list.filter((d): d is string => Boolean(d)))].sort();

function action(
  crop: Crop,
  kind: WeeklyAction['action'],
  w: Sourced<WeekWindows>,
  reason: string,
  doneOn: string[],
): WeeklyAction {
  return { cropId: crop.id, cropName: crop.name, action: kind, estimate: !!w.estimate, reason, doneOn };
}

function sowActions(crop: Crop, mine: CalendarPlanting[], week: number, today: string): WeeklyAction[] {
  const windows: [Sow, string, Sourced<WeekWindows> | undefined][] = [
    ['sow_under_cover', 'semis sous abri', crop.sowUnderCover],
    ['sow_direct', 'semis direct', crop.sowDirect],
  ];
  const sowings = mine.filter((p) => p.method !== 'bought');
  const out: WeeklyAction[] = [];
  let succeeded = false;
  for (const [kind, label, w] of windows) {
    const current = w && currentWindow(week, w.value);
    if (!w || !current) continue;
    const start = occurrenceStart(current, today);
    const inOccurrence = sowings.filter((p) => p.sownOn >= start);
    const all = dates(inOccurrence.map((p) => p.sownOn));
    const reason = windowReason(label, current);
    const last = all[all.length - 1];
    const every = crop.successionDays?.value;
    if (!last) {
      out.push(action(crop, kind, w, reason, []));
      continue;
    }
    if (succeeded) continue;
    const since = differenceInCalendarDays(parseISO(today), parseISO(last));
    if (every !== undefined && since >= every) {
      succeeded = true;
      const text = `Dernier semis il y a ${since} jours, à renouveler tous les ${every} jours.`;
      out.push(action(crop, 'succession', w, text, all));
      continue;
    }
    const done = dates(inOccurrence.filter((p) => !p.method || p.method === SOW_METHOD[kind]).map((p) => p.sownOn));
    out.push(action(crop, kind, w, `${reason}${doneSuffix('semé', done)}`, done));
  }
  return out;
}

function transplantAction(crop: Crop, mine: CalendarPlanting[], week: number, today: string): WeeklyAction | null {
  const t = crop.transplant;
  const current = t && currentWindow(week, t.value);
  if (!t || !current) return null;
  const start = occurrenceStart(current, today);
  const planted = mine.map((p) => p.transplantedOn ?? (p.method === 'bought' ? p.sownOn : null));
  const done = dates(planted.filter((d) => d && d >= start));
  return action(crop, 'transplant', t, `${windowReason('plantation', current)}${doneSuffix('planté', done)}`, done);
}

export function whatsNext(crops: Crop[], active: CalendarPlanting[], today: string): WeeklyAction[] {
  const week = getISOWeek(parseISO(today));
  return crops.flatMap((crop) => {
    const mine = active.filter((p) => p.status === 'active' && isCrop(crop, p.species));
    const transplant = transplantAction(crop, mine, week, today);
    return transplant ? [...sowActions(crop, mine, week, today), transplant] : sowActions(crop, mine, week, today);
  });
}
