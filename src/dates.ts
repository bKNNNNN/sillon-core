/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30, 2026-13-45). */
export function isValidCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** More than one day after `today`: one day of slack absorbs a phone clock or time zone off by a few hours. */
export function isTooFarInFuture(date: string, today: string): boolean {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return date > d.toISOString().slice(0, 10);
}

/** Adds `n` calendar days (negative to go back) to a YYYY-MM-DD date. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
