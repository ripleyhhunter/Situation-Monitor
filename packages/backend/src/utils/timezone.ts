/**
 * Timezone helpers for feeds that publish zone-less wall-clock times.
 * Node's `new Date(string)` interprets those in the HOST zone, which is wrong
 * whenever the host isn't in the feed's zone (e.g. a Mountain-time machine
 * ingesting DC feeds).
 */

/** Offset of a zone from UTC at a given instant (zone wall-clock minus UTC). */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    parts[p.type] = p.value;
  }
  const zoneAsUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second,
  );
  return zoneAsUtc - utcMs;
}

/** Convert a wall-clock time in a zone (month is 1-12) to a UTC epoch ms. */
export function wallClockToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two-pass resolution: the offset sampled at the naive guess can be wrong
  // when a DST transition falls between the guess and the true instant
  // (several hours around each transition would otherwise convert 1h off).
  const firstPass = utcGuess - zoneOffsetMs(utcGuess, timeZone);
  return utcGuess - zoneOffsetMs(firstPass, timeZone);
}

/** Today's calendar date as seen in a zone (month is 1-12). */
export function todayInZone(timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date())) {
    parts[p.type] = p.value;
  }
  return { year: +parts.year, month: +parts.month, day: +parts.day };
}
