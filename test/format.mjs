/**
 * Format-helper tests: the union window contract, bounds shapes, style
 * resolution priority + memoization, and acres interpolation.
 * (rasterFromImage is browser-only — exercised by the demo and
 * test/browser.html, not here.)
 * Run: node test/format.mjs
 */

import { windowFromJson } from '../src/format/window.js'
import { boundsFromJson } from '../src/format/bounds.js'
import { styleFromJson } from '../src/format/style.js'
import { acresFromJson } from '../src/format/acres.js'
import { SCHEMES, lutFromBands, rampLutBytes } from '../src/colors.js'
import { MODE_SMOOTH, MODE_RECENCY } from '../src/shaders.js'

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const throws = (fn, re) => {
  try { fn(); return false } catch (e) { return re ? re.test(String(e.message ?? e)) : true }
}
const eqLut = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/* ======================================================== windowFromJson */
console.log('\nwindow.js — the union contract')

const T0 = Date.UTC(2026, 5, 1)
const H = 3_600_000
{
  const w = windowFromJson({ startTime: T0, endTime: T0 + 48 * H })
  check('explicit startTime/endTime are used',
    w.startMs === T0 && w.endMs === T0 + 48 * H)
}
{
  const w = windowFromJson({ UTC: [T0, T0 + 6 * H, T0 + 24 * H] })
  check('UTC-only files derive from the endpoints',
    w.startMs === T0 && w.endMs === T0 + 24 * H)
}
{
  // Explicit fields may carry a timezone adjustment the UTC array lacks a
  // right to override — when both are present and disagree, explicit wins.
  const w = windowFromJson({ startTime: T0 + H, endTime: T0 + 50 * H, UTC: [T0, T0 + 48 * H] })
  check('explicit fields win over a disagreeing UTC array',
    w.startMs === T0 + H && w.endMs === T0 + 50 * H)
}
check('neither → throws (never NaN — the frozen-fire path)',
  throws(() => windowFromJson({ name: 'no window' }), /startTime.*UTC|UTC.*startTime/))
check('a lone startTime without endTime falls through to UTC',
  windowFromJson({ startTime: T0, UTC: [T0 + H, T0 + 2 * H] }).startMs === T0 + H)
check('an empty UTC array throws rather than yielding undefined',
  throws(() => windowFromJson({ UTC: [] })))
check('non-finite explicit fields (NaN) fall through rather than poisoning the window',
  windowFromJson({ startTime: NaN, endTime: T0 + H, UTC: [T0, T0 + H] }).startMs === T0)

/* ======================================================== boundsFromJson */
console.log('\nbounds.js — JSON-carried shapes')

{
  const b = boundsFromJson({ bounds: { minlat: 35.8, minlon: -106.6, maxlat: 35.9, maxlon: -106.5 } })
  check('json.bounds {minlat,minlon,maxlat,maxlon} maps to N/S/E/W',
    b.north === 35.9 && b.south === 35.8 && b.east === -106.5 && b.west === -106.6)
}
{
  // Legacy worldfile4326 line order A D B E C F: x-scale, rot, rot,
  // y-scale (negative), UL lon, UL lat. 100×200 px at 0.001°/px.
  const wf = '0.001 0 0 -0.001 -106.6 35.9'
  const b = boundsFromJson({ worldfile4326: wf, width: 100, height: 200 })
  check('worldfile4326 (space-separated) derives all four edges',
    b.north === 35.9 && b.west === -106.6 &&
    Math.abs(b.east - -106.5) < 1e-9 && Math.abs(b.south - 35.7) < 1e-9)
  const b2 = boundsFromJson({ worldfile4326: wf.split(' ').join('\n'), width: 100, height: 200 })
  check('newline-separated worldfile parses the same', b2.north === b.north && b2.south === b.south)
  const b3 = boundsFromJson({ worldfile4326: wf }, { width: 100, height: 200 })
  check('dimensions can come from opts instead of the JSON', b3.east === b.east)
}
check('worldfile without dimensions throws, naming what is missing',
  throws(() => boundsFromJson({ worldfile4326: '0.001 0 0 -0.001 -106.6 35.9' }), /dimensions|width/))
check('no bounds at all throws, naming the accepted shapes',
  throws(() => boundsFromJson({ name: 'nothing' }), /bounds/))
check('a malformed bounds object is not silently accepted',
  throws(() => boundsFromJson({ bounds: { minlat: 35.8 } })))

/* ========================================================= styleFromJson */
console.log('\nstyle.js — resolution priority and memoization')

const FIRE = SCHEMES[0]
const WATER = SCHEMES.find((s) => s.key === 'water')
const gradientJson = {
  gradient: {
    color1: [0.9, 0.1, 0.9, 0.7], color2: [0.75, 0.1, 0.9, 0.7],
    color3: [0.6, 0.1, 0.9, 0.7], color4: [0.3, 0.05, 0.45, 0.7]
  }
}
{
  const s = styleFromJson(gradientJson, MODE_SMOOTH)
  const g = gradientJson.gradient
  check('an explicit gradient wins and drives the LUT through its four slots',
    eqLut(s.lut, lutFromBands([g.color1, g.color2, g.color3, g.color4])))
  check('gradient bands are edge→interior [color1..color4]',
    s.bands[0] === g.color1 && s.bands[3] === g.color4)
  check('gradient marks isGradient', s.isGradient === true)
}
{
  const s = styleFromJson({ flood: true }, MODE_SMOOTH)
  check('flood defers to the built-in Water scheme',
    s.bands === WATER.bands && eqLut(s.lut, lutFromBands(WATER.bands)))
  check('water rides the scheme system as a gradient (legacy isWater stays unset)',
    s.isGradient === true && !('isWater' in s))
}
{
  const both = styleFromJson({ flood: true, ...gradientJson }, MODE_SMOOTH)
  check('an explicit gradient beats the flood flag',
    both.bands[0] === gradientJson.gradient.color1)
}
{
  const s = styleFromJson({}, MODE_SMOOTH)
  check('no gradient, no flood → Fire defaults (3-stop ramp for Smooth)',
    eqLut(s.lut, rampLutBytes(FIRE.ramp)) && s.isGradient === false)
  const rec = styleFromJson({}, MODE_RECENCY)
  check('Recency reads the slots even for the Fire default',
    eqLut(rec.lut, lutFromBands(FIRE.bands)))
}
{
  const a = styleFromJson(gradientJson, MODE_SMOOTH)
  const b = styleFromJson(gradientJson, MODE_SMOOTH)
  check('same source + mode → the SAME lut reference (renderer re-upload check is identity)',
    a === b && a.lut === b.lut)
  const other = styleFromJson({ gradient: { ...gradientJson.gradient, color1: [1, 0, 0, 1] } }, MODE_SMOOTH)
  check('a different gradient object → a new reference', other.lut !== a.lut)
  const fire1 = styleFromJson({}, MODE_SMOOTH)
  const fire2 = styleFromJson({ name: 'another json, same fire default' }, MODE_SMOOTH)
  check('scheme-sourced styles memoize across JSONs (stable scheme object is the key)',
    fire1 === fire2)
}
check('endStyle defaults to jet and passes through',
  styleFromJson({}, MODE_SMOOTH).endStyle === 'jet' &&
  styleFromJson({}, MODE_SMOOTH, { endStyle: 'perimeter' }).endStyle === 'perimeter')
check('endStyle never changes the lut reference (it gates the end frame, not the ramp)',
  styleFromJson({}, MODE_SMOOTH).lut === styleFromJson({}, MODE_SMOOTH, { endStyle: 'perimeter' }).lut &&
  styleFromJson(gradientJson, MODE_SMOOTH).lut === styleFromJson(gradientJson, MODE_SMOOTH, { endStyle: 'perimeter' }).lut)

/* ========================================================= acresFromJson */
console.log('\nacres.js — interpolation, clamps, and the legacy regression')

const acresJson = { UTC: [T0, T0 + 10 * H, T0 + 20 * H], acres: [0, 100, 400] }
check('below the first entry clamps to acres[0]', acresFromJson(acresJson, T0 - H) === 0)
check('above the last entry clamps to acres[last]', acresFromJson(acresJson, T0 + 30 * H) === 400)
check('exact entries return exactly', acresFromJson(acresJson, T0 + 10 * H) === 100)
check('midpoints interpolate linearly',
  acresFromJson(acresJson, T0 + 5 * H) === 50 && acresFromJson(acresJson, T0 + 15 * H) === 250)
{
  // The legacy upstream formula used the ABSOLUTE time as the numerator:
  // t/(t1-t0)·Δacres + a0. With epoch-scale t that is astronomically wrong;
  // pin the correct value AND that it differs from what legacy computed.
  const t = T0 + 5 * H
  const legacy = (t / (10 * H)) * (100 - 0) + 0
  check('the legacy-formula regression: correct value, not the legacy one',
    acresFromJson(acresJson, t) === 50 && legacy !== 50, `legacy would be ${legacy.toExponential(2)}`)
}
check('missing acres → null', acresFromJson({ UTC: [T0] }, T0) === null)
check('missing UTC → null', acresFromJson({ acres: [0] }, T0) === null)
check('length mismatch → null', acresFromJson({ UTC: [T0, T0 + H], acres: [0] }, T0) === null)
check('non-finite time → null', acresFromJson(acresJson, NaN) === null)
check('duplicate timestamps do not divide by zero',
  acresFromJson({ UTC: [T0, T0, T0 + H], acres: [0, 10, 20] }, T0 + 1) > 0)

/* ================================================================= result */
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
