/**
 * Renderer style from a progression JSON.
 *
 * Resolution priority:
 *   1. explicit `json.gradient` — the published 4-slot payload
 *      ({color1..color4}, RGBA 0-1 floats, stored edge → interior), driving
 *      every look through lutFor's gradient-wins rule
 *   2. `json.flood` truthy — the built-in Water scheme (its bands are
 *      byte-identical to the legacy published blue gradient, so flag-only
 *      water files and gradient-carrying ones converge on the same look)
 *   3. the Fire scheme defaults.
 *
 * This helper never sets the legacy `isWater` shader uniform — water rides
 * the scheme system; the shader branch is vestigial and dies in cleanup.
 *
 * Results are memoized per (source object, mode, endStyle): the renderer's
 * setStyle re-uploads the LUT texture whenever the `lut` REFERENCE changes,
 * so repeated calls for the same JSON must return the identical object.
 * (Identity, not deep equality: mutating a gradient in place will not bust
 * the cache — republish a new object instead.)
 */

import { SCHEMES, lutFor } from '../colors.js'
import { MODE_SMOOTH } from '../shaders.js'

const FIRE = SCHEMES[0]
const WATER = SCHEMES.find((s) => s.key === 'water')

const isGradientPayload = (g) =>
  g && [g.color1, g.color2, g.color3, g.color4].every((c) => Array.isArray(c) && c.length === 4)

/** source object → Map("mode|endStyle" → resolved style) */
const cache = new WeakMap()

export function styleFromJson(json, mode = MODE_SMOOTH, opts = {}) {
  const g = json?.gradient
  const source = isGradientPayload(g) ? g : (json?.flood ? WATER : FIRE)
  const endStyle = opts.endStyle ?? 'jet'

  let byKey = cache.get(source)
  if (!byKey) { byKey = new Map(); cache.set(source, byKey) }
  const key = `${mode}|${endStyle}`
  if (!byKey.has(key)) {
    const fromGradient = source === g
    const bands = fromGradient ? [g.color1, g.color2, g.color3, g.color4] : source.bands
    const colors = fromGradient
      ? { ramp: FIRE.ramp, bands, publishesGradient: true }  // ramp unreachable: gradient wins
      : source
    // The LUT depends on (source, mode) only — endStyle gates the shader's
    // final-frame branch, not the ramp. Share the array across endStyles so
    // toggling the end style never changes the lut reference (which would
    // trigger a pointless LUT texture re-upload in setStyle).
    const lutKey = `lut|${mode}`
    if (!byKey.has(lutKey)) byKey.set(lutKey, lutFor(colors, mode))
    byKey.set(key, {
      mode,
      lut: byKey.get(lutKey),
      bands,
      isGradient: fromGradient || source.publishesGradient,
      endStyle,
    })
  }
  return byKey.get(key)
}
