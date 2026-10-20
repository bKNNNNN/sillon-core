const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** "1 °C", "-0,5 °C", "12,3 °C": one decimal at most, French decimal comma. */
export function celsius(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',')} °C`;
}

function dayOfMonth(date: string): string {
  const day = Number(date.slice(8, 10));
  return day === 1 ? '1er' : String(day);
}

/** "22 octobre", "1er novembre" from a YYYY-MM-DD date. */
export function frenchDate(date: string): string {
  return `${dayOfMonth(date)} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/** "jeudi" from a YYYY-MM-DD date. */
export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

/** The evening to act on, from the night's distance: "ce soir", "demain soir", "le jeudi soir". */
export function eveningOf(night: string, daysAhead: number): string {
  if (daysAhead <= 0) return 'ce soir';
  if (daysAhead === 1) return 'demain soir';
  return `le ${weekday(night)} soir`;
}

/** "du jeudi 22 au vendredi 23 octobre", or with both months when the night crosses one. */
export function nightSpan(evening: string, morning: string): string {
  const sameMonth = evening.slice(0, 7) === morning.slice(0, 7);
  const from = sameMonth ? dayOfMonth(evening) : frenchDate(evening);
  return `du ${weekday(evening)} ${from} au ${weekday(morning)} ${frenchDate(morning)}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
