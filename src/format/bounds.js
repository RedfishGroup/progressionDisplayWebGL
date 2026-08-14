/**
 * Geographic bounds from a progression JSON — JSON-carried shapes only.
 *
 * Primary shape (Studio publishes it; the legacy hosts read it):
 *   json.bounds = { minlat, minlon, maxlat, maxlon }
 *
 * Legacy fallback: the `worldfile4326` string — six affine parameters in the
 * legacy line order A D B E C F (x-scale, rotation, rotation, y-scale
 * [negative], upper-left lon, upper-left lat), split on space, newline, or a
 * literal '↵'. Deriving the lower-right corner needs the raster dimensions,
 * taken from json.width/json.height or opts.{width,height}.
 *
 * Full .pgw FILE parsing deliberately does not live here — that is a host
 * concern (viewerTemplate's worldFile2) on a path being retired; this module
 * only reads what the JSON itself carries.
 */

export function boundsFromJson(json, opts = {}) {
  const b = json?.bounds
  if (b && [b.minlat, b.minlon, b.maxlat, b.maxlon].every(Number.isFinite)) {
    return { north: b.maxlat, south: b.minlat, east: b.maxlon, west: b.minlon }
  }

  const wf = json?.worldfile4326
  const width = Number.isFinite(opts.width) ? opts.width : json?.width
  const height = Number.isFinite(opts.height) ? opts.height : json?.height
  if (typeof wf === 'string') {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error('worldfile4326 bounds need raster dimensions (json.width/json.height or opts.{width,height})')
    }
    let parts = wf.trim().split(' ')
    if (parts.length !== 6) parts = wf.trim().split('\n')
    if (parts.length !== 6) parts = wf.trim().split('↵')
    const n = parts.map(Number)
    if (n.length !== 6 || !n.every(Number.isFinite)) {
      throw new Error('worldfile4326 did not parse as six numbers')
    }
    const [A, , , E, C, F] = n   // legacy order A D B E C F; rotation terms unused
    // Upper-left is (lat F, lon C); y-scale E is negative, so F + height·E is south.
    return { north: F, south: F + height * E, east: C + width * A, west: C }
  }

  throw new Error('progression JSON has no usable bounds ' +
    '(need json.bounds{minlat,minlon,maxlat,maxlon} or worldfile4326 + dimensions)')
}
