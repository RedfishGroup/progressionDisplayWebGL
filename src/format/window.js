/**
 * The time window a progression JSON describes — THE UNION CONTRACT.
 *
 * The two shipped host generations each implemented half of this and each
 * fails on the other's files: AnyHazard's renderer reads only explicit
 * startTime/endTime (a JSON without them renders a frozen, fully-burned
 * fire), while the published viewer derives only from the UTC perimeter
 * timestamps. This helper is the one place both halves live:
 *
 *   1. explicit `startTime`/`endTime` win when both are finite
 *      (Studio publishes them; they may carry a timezone adjustment, so
 *      when present they are the authority — do not "correct" them from UTC)
 *   2. else the UTC array's endpoints
 *   3. else throw — never return NaN; the NaN path IS the frozen-fire bug.
 *
 * All values are epoch milliseconds, matching the renderer's
 * setWindow({startMs, endMs}) / setTime(ms) contract.
 */

export function windowFromJson(json) {
  if (Number.isFinite(json?.startTime) && Number.isFinite(json?.endTime)) {
    return { startMs: json.startTime, endMs: json.endTime }
  }
  const utc = json?.UTC
  if (Array.isArray(utc) && utc.length > 0 &&
      Number.isFinite(utc[0]) && Number.isFinite(utc[utc.length - 1])) {
    return { startMs: utc[0], endMs: utc[utc.length - 1] }
  }
  throw new Error('progression JSON has no startTime/endTime and no UTC array')
}
