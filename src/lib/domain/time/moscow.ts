/** Europe/Moscow has no daylight-saving time. Forum fixture clocks use this fixed offset. */
export const MOSCOW_OFFSET_MINUTES = 180;

/**
 * A timezone-less forum fixture clock is Moscow local time.
 * The conversion does not use the host or browser timezone.
 */
export function moscowWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - MOSCOW_OFFSET_MINUTES * 60_000);
}

/** Render an absolute instant in Moscow time. The stored instant is not shifted. */
export function formatMoscow(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} UTC+3`;
}

/**
 * A stored kickoff is corrected only when it is exactly the Moscow wall clock
 * saved as if it were UTC. A second run sees the corrected instant and stops.
 * Any other stored instant is left alone.
 */
export function correctedMoscowKickoff(stored: Date | null, moscowInstant: Date): Date | null {
  if (stored == null) {
    return moscowInstant;
  }
  if (stored.getTime() === moscowInstant.getTime()) {
    return null;
  }
  const misreadAsUtc = new Date(moscowInstant.getTime() + MOSCOW_OFFSET_MINUTES * 60_000);
  if (stored.getTime() === misreadAsUtc.getTime()) {
    return moscowInstant;
  }
  return null;
}
