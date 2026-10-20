const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** "18 oct.", "1er mars" from a YYYY-MM-DD date. */
export function shortFrenchDate(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  return `${day === 1 ? '1er' : day} ${month}`;
}

/** " Déjà semé le 18 oct." appended to a window reason, or "" when nothing was done. */
export function doneSuffix(verb: 'semé' | 'planté', dates: readonly string[]): string {
  if (dates.length === 0) return '';
  const last = shortFrenchDate(dates[dates.length - 1]!);
  const text =
    dates.length === 1
      ? `Déjà ${verb} le ${last}`
      : dates.length === 2
        ? `Déjà ${verb} le ${shortFrenchDate(dates[0]!)} et le ${last}`
        : `Déjà ${verb} ${dates.length} fois, le dernier le ${last}`;
  // An abbreviated month already ends the sentence with its own period.
  return ` ${text.endsWith('.') ? text : `${text}.`}`;
}
