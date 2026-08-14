/**
 * Progression color contract — host-agnostic (spec §3.4, D13).
 *
 * Each scheme carries TWO color roles, because the three looks encode
 * genuinely different things and one shared table would either flatten the
 * ramp or invent band colors:
 *
 *   ramp  — 3 stops → 256-entry LUT   (Smooth, Recency)
 *   bands — 4 RGBA slots              (Bands; published verbatim as json.gradient)
 *
 * Two constraints bind this table, both enforced by test/gl-g0-smoke.mjs:
 *
 *   1. bands[1..3] are byte-identical to the legacy LEGACY_GRADIENTS values.
 *      They publish as json.gradient and the release invariant forbids
 *      changing published bytes.
 *   2. bands[0] (fire) equals AnyHazard's hardcoded shader defaults, because
 *      the fire scheme publishes NO gradient field — those defaults are
 *      literally what AnyHazard draws. That is what makes Bands mode an
 *      honest preview for every scheme.
 *
 * No imports beyond the sibling shaders.js (the mode constants — one source
 * of truth now that the two files ship in the same package); no globals.
 */

import { MODE_RECENCY } from './shaders.js'

/**
 * @typedef {Object} Scheme
 * @property {string} key
 * @property {string} label
 * @property {number[][]} ramp - 3 stops, each [r,g,b] 0-255
 * @property {number[][]} bands - 4 slots, each [r,g,b,a] 0-1
 * @property {boolean} publishesGradient - false for fire (legacy contract)
 */

/** @type {Scheme[]} */
export const SCHEMES = [
  {
    key: 'fire',
    label: 'Fire',
    ramp: [[66, 20, 18], [142, 43, 39], [190, 58, 52]],
    // AnyHazard's hardcoded band defaults — see progressionShaders.js
    bands: [[0.9, 0.9, 0.1, 0.7], [0.9, 0.3, 0.1, 0.7], [0.7, 0.1, 0.1, 0.7], [0.2, 0.1, 0.0, 0.7]],
    publishesGradient: false
  },
  {
    key: 'water',
    label: 'Water',
    ramp: [[13, 40, 77], [38, 84, 145], [120, 170, 220]],
    bands: [[0.0, 0.0, 1.0, 0.5], [0.0, 0.0, 1.0, 0.5], [0.0, 0.0, 1.0, 0.5], [0.0, 0.0, 1.0, 0.5]],
    publishesGradient: true
  },
  {
    key: 'green',
    label: 'Hazmat (green)',
    ramp: [[42, 58, 22], [87, 120, 40], [168, 190, 60]],
    bands: [[0.4, 0.9, 0.1, 0.7], [0.7, 0.9, 0.1, 0.7], [0.85, 0.9, 0.1, 0.7], [0.3, 0.3, 0.05, 0.7]],
    publishesGradient: true
  },
  {
    key: 'pink',
    label: 'Hazmat (pink)',
    ramp: [[70, 15, 60], [140, 30, 120], [220, 90, 200]],
    bands: [[0.9, 0.1, 0.9, 0.7], [0.75, 0.1, 0.9, 0.7], [0.6, 0.1, 0.9, 0.7], [0.3, 0.05, 0.45, 0.7]],
    publishesGradient: true
  },
  {
    // Jet — the conventional arrival-time colormap, cool → hot with time.
    // Stored edge → interior like every scheme, so in TIME order it reads
    // blue → cyan → yellow → red. Appended at index 4 because the earlier
    // indices are load-bearing (LEGACY_GRADIENTS keys, the schemeIdx > 0
    // publish gate, and any custom ramp's stored `source`).
    key: 'jet',
    label: 'Jet',
    ramp: [[0, 0, 200], [0, 220, 220], [220, 30, 20]],
    bands: [[1.0, 0.1, 0.05, 0.7], [1.0, 0.95, 0.1, 0.7], [0.1, 0.85, 0.95, 0.7], [0.0, 0.1, 0.75, 0.7]],
    publishesGradient: true
  }
]

/**
 * The scheme every look falls back to for its FINAL frame — the "the fire is
 * over" view. Once the progression is complete, recency is meaningless and
 * band rings only restate the last perimeter, so all three looks converge on
 * one readable arrival-time map instead of three different end states.
 *
 * Jet because it is the conventional colormap for this and reads
 * unambiguously cool → hot with time; the shipped alternative was an HSV
 * sweep whose hue wrapped (…red → blue → cyan again), so two very different
 * times could land on the same colour.
 */
export const END_FRAME_SCHEME = SCHEMES[SCHEMES.findIndex((s) => s.key === 'jet')]

/** The 256-entry LUT for that final-frame view, in time order. */
export function endFrameLut() {
  return lutFromBands(END_FRAME_SCHEME.bands)
}

/**
 * Is this the final frame? Shared so the GPU and canvas renderers agree about
 * where the end-frame view begins — the shader's own test, in JS.
 * @param {number} elapsedS seconds since start  @param {number} spanS total
 */
export function isFinalFrame(elapsedS, spanS) {
  return elapsedS >= spanS - 1 || spanS <= 0
}

/**
 * End-frame styles — the `endStyleMode` uniform's values, for host UIs and
 * legends to enumerate. 'jet' is the default (the end-LUT arrival map);
 * 'perimeter' is the quieter completion state added at the core rebuild:
 * the selected ramp's interior colour over the whole burn with an opaque
 * border of the same colour at the final data edge.
 */
export const END_FRAME_STYLES = [
  { key: 'jet', label: 'Arrival map', sub: 'end-LUT ramp' },
  { key: 'perimeter', label: 'Final perimeter', sub: 'interior colour, opaque edge' }
]

/** Render modes — the `mode` uniform's values (spec §3.5). */
export const MODES = [
  { key: 'smooth', label: 'Smooth', sub: 'arrival ramp' },
  { key: 'bands', label: 'Bands', sub: 'distance rings' },
  { key: 'recency', label: 'Recency', sub: 'leading edge' }
]

/**
 * The legacy `json.gradient` payload per scheme index — fire absent, exactly
 * as `_generateJSON` has always emitted it. exports.js re-exports this so no
 * published byte moves (spec §5).
 */
export const LEGACY_GRADIENTS = SCHEMES.reduce((acc, s, i) => {
  if (s.publishesGradient) {
    acc[i] = { color1: s.bands[0], color2: s.bands[1], color3: s.bands[2], color4: s.bands[3] }
  }
  return acc
}, {})

/**
 * 256-entry RGBA LUT over a 3-stop ramp.
 *
 * The 0.55 breakpoint is load-bearing: it is what rasterOverlay.js's
 * schemeLut() has always used, and Smooth mode's pixel-parity acceptance
 * criterion (§7.3) compares against that function's output.
 *
 * @param {number[][]} stops - 3 stops, each [r,g,b] 0-255
 * @returns {Uint8Array} 256×4 RGBA
 */
export function rampLutBytes(stops) {
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const u = i / 255
    const seg = u < 0.55
      ? [stops[0], stops[1], u / 0.55]
      : [stops[1], stops[2], (u - 0.55) / 0.45]
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round(seg[0][c] + (seg[1][c] - seg[0][c]) * seg[2])
    }
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * The four gradient slots as an evenly-spaced 256-entry LUT, **in time
 * order**: 0 % → color4, 33.3 % → color3, 66.7 % → color2, 100 % → color1.
 *
 * THE ORIENTATION RULE, which every surface in the app now obeys: time runs
 * left → right (or top → bottom), earliest first. In band terms the interior
 * is the oldest burn and the edge band is the active front, so
 *
 *     color4 (interior) = earliest        color1 (edge) = newest
 *
 * Storage stays edge → interior because that is the published
 * `json.gradient.color1..4` order and must not move; the reversal happens
 * here, once, so that a LUT index always means "how far through the fire".
 * Any surface that draws slots for a human — legend bar, gallery strip,
 * editor rows — reverses the same way.
 *
 * This is what makes `json.gradient` drive every look rather than only Bands
 * (gradient-picker decision 4). The same four numbers that publish are the
 * ones the ramp reads, so a custom ramp needs no second definition and no new
 * JSON field — which is also why the published viewer can adopt these looks
 * with zero format change.
 *
 * Alpha is deliberately dropped: the ramp looks composite per-pixel against
 * the map, and per-slot alpha is a Bands affordance (each ring is a flat fill
 * that can be individually see-through). Blending it into a continuous ramp
 * would make the fade read as a transparency gradient instead of a colour one.
 *
 * @param {number[][]} bands - 4 slots, each [r,g,b,a] 0-1, edge → interior
 * @returns {Uint8Array} 256×4 RGBA, index 0 = earliest
 */
export function lutFromBands(bands) {
  const stops = timeOrder(bands).map((v) => [
    Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255)
  ])
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * 3            // 0…3 across four evenly spaced stops
    const s = Math.min(2, Math.floor(pos))
    const k = pos - s
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round(stops[s][c] + (stops[s + 1][c] - stops[s][c]) * k)
    }
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * Slots as a human/LUT reads them: earliest first. Storage is edge → interior
 * (the published order); time order is its reverse. Every surface that draws
 * slots left→right or top→bottom goes through here, so "which end is the
 * start of the fire" is answered in exactly one place.
 */
export function timeOrder(bands) {
  return [...bands].reverse()
}

/**
 * The LUT a look reads, for a resolved scheme.
 *
 * 1. **A gradient wins.** Any scheme that publishes `json.gradient` — every
 *    preset but Fire, and every custom ramp — drives all three looks from its
 *    four slots. One definition, one set of published bytes, three looks.
 * 2. **Recency always uses the slots**, gradient or not, so with no gradient
 *    selected it draws the Fire *bands* — the same colors Bands falls back to
 *    — rather than the arrival ramp. The two looks that describe the fire
 *    front agree about what a fire front looks like.
 * 3. **Smooth otherwise keeps its own default.** The Fire preset's 3-stop
 *    ramp and 0.55 breakpoint are what Studio has always drawn for arrival.
 *
 * Always indexed by time: 0 = earliest, 1 = newest.
 *
 * @param {{ramp: number[][], bands: number[][], publishesGradient: boolean}} colors
 * @param {number} [mode] - MODE_SMOOTH | MODE_BANDS | MODE_RECENCY
 */
export function lutFor(colors, mode) {
  if (mode === MODE_RECENCY || colors.publishesGradient) return lutFromBands(colors.bands)
  return rampLutBytes(colors.ramp)
}

/** CSS gradient for a 4-slot ramp, evenly spaced and in TIME order — the
 *  legend's mirror of lutFromBands, so the bar and the pixels cannot drift. */
export function bandsRampCss(bands) {
  return 'linear-gradient(90deg,' + timeOrder(bands)
    .map((b, i) => bandCss([b[0], b[1], b[2], 1]) + ' ' + ((i / 3) * 100).toFixed(2) + '%')
    .join(',') + ')'
}

/** CSS `rgb()` for a ramp stop. */
export function rgbCss(stop) {
  return 'rgb(' + stop[0] + ',' + stop[1] + ',' + stop[2] + ')'
}

/** CSS `rgba()` for a band slot (0-1 floats, as the shader takes them). */
export function bandCss(slot) {
  return 'rgba(' + Math.round(slot[0] * 255) + ',' + Math.round(slot[1] * 255) + ',' +
    Math.round(slot[2] * 255) + ',' + slot[3] + ')'
}

/** The legend/preview gradient for a scheme's ramp, honoring the 0.55 stop. */
export function rampCss(stops) {
  return 'linear-gradient(90deg,' + rgbCss(stops[0]) + ' 0%,' +
    rgbCss(stops[1]) + ' 55%,' + rgbCss(stops[2]) + ' 100%)'
}
