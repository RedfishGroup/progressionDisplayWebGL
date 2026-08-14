/**
 * Acreage readout from the JSON's acres/UTC arrays — linear interpolation,
 * clamped at both ends. Display (and whether to display at all) is the
 * host's decision; this is only the arithmetic.
 *
 * One correct implementation, replacing two shipped ones: the legacy
 * upstream copy's interpolation was arithmetically wrong (it used
 * `t / (t1 - t0)` — the absolute epoch time as the numerator — instead of
 * `(t - t0) / (t1 - t0)`, producing garbage whenever it hit the
 * interpolation branch), and the published viewer carried its own local
 * copy of the correct formula.
 *
 * Returns null when the JSON lacks usable acres/UTC arrays.
 */

export function acresFromJson(json, timeMs) {
  const acres = json?.acres
  const utc = json?.UTC
  if (!Array.isArray(acres) || !Array.isArray(utc) ||
      acres.length !== utc.length || acres.length === 0 ||
      !Number.isFinite(timeMs)) {
    return null
  }
  const last = utc.length - 1
  if (timeMs <= utc[0]) return acres[0]
  if (timeMs >= utc[last]) return acres[last]
  for (let i = 1; i <= last; i++) {
    if (timeMs <= utc[i]) {
      const t0 = utc[i - 1]
      const t1 = utc[i]
      if (t1 === t0) return acres[i]
      return acres[i - 1] + ((timeMs - t0) / (t1 - t0)) * (acres[i] - acres[i - 1])
    }
  }
  return acres[last]
}
