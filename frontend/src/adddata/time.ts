/** Local wall-clock value for a datetime-local input, to the minute. */
export function localNow(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** A datetime-local value as an absolute ISO timestamp, or null when it is empty or not a date. */
export function toIso(local: string): string | null {
  if (!local) return null
  const t = new Date(local)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
