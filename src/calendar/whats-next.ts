import { addWeeks, differenceInCalendarDays, format, getISOWeek, getISOWeekYear, parseISO, startOfISOWeek } from 'date-fns';
import { isCrop, windowsOf, type Crop, type Sourced, type WeekWindow, type WeekWindows } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';

/** The planting fields `whatsNext` reads. */
export type CalendarPlanting = Pick<PlantingLike, 'species' | 'sownOn' | 'status'>;

export type WeeklyAction = {
  cropId: string;
  cropName: string;
  action: 'sow_under_cover' | 'sow_direct' | 'transplant' | 'succession';
  estimate: boolean;
  reason: string;
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

function lastSownOn(plantings: CalendarPlanting[]): string | undefined {
  return plantings.reduce<string | undefined>((max, p) => (!max || p.sownOn > max ? p.sownOn : max), undefined);
}

function action(crop: Crop, kind: WeeklyAction['action'], w: Sourced<WeekWindows>, reason: string): WeeklyAction {
  return { cropId: crop.id, cropName: crop.name, action: kind, estimate: !!w.estimate, reason };
}

function sowActions(crop: Crop, mine: CalendarPlanting[], week: number, today: string): WeeklyAction[] {
  const windows: [Sow, string, Sourced<WeekWindows> | undefined][] = [
    ['sow_under_cover', 'semis sous abri', crop.sowUnderCover],
    ['sow_direct', 'semis direct', crop.sowDirect],
  ];
  const out: WeeklyAction[] = [];
  let succeeded = false;
  for (const [kind, label, w] of windows) {
    const current = w && currentWindow(week, w.value);
    if (!w || !current) continue;
    const start = occurrenceStart(current, today);
    const last = lastSownOn(mine.filter((p) => p.sownOn >= start));
    const every = crop.successionDays?.value;
    if (!last) {
      out.push(action(crop, kind, w, windowReason(label, current)));
      continue;
    }
    if (every === undefined || succeeded) continue;
    const since = differenceInCalendarDays(parseISO(today), parseISO(last));
    if (since < every) continue;
    succeeded = true;
    out.push(action(crop, 'succession', w, `Dernier semis il y a ${since} jours, à renouveler tous les ${every} jours.`));
  }
  return out;
}

export function whatsNext(crops: Crop[], active: CalendarPlanting[], today: string): WeeklyAction[] {
  const week = getISOWeek(parseISO(today));
  return crops.flatMap((crop) => {
    const mine = active.filter((p) => p.status === 'active' && isCrop(crop, p.species));
    const out = sowActions(crop, mine, week, today);
    const t = crop.transplant;
    const current = t && currentWindow(week, t.value);
    if (t && current) out.push(action(crop, 'transplant', t, windowReason('plantation', current)));
    return out;
  });
}
