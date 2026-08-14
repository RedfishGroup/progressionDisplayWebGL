/**
 * Fallback painter tests: paint a synthetic raster with hand-computed
 * base-256 arrival bytes and assert exact output pixels at three times —
 * mid-run, an exact-tie arrival (pinning the inclusive gate), and the final
 * frame (pinning the end-LUT switch). Plus the no-data contract and the
 * no-row-flip orientation rule.
 * Run: node test/painter.mjs
 */

import { paintProgression } from '../src/fallback/canvasPainter.js'
import { SCHEMES, lutFor, endFrameLut } from '../src/colors.js'
import { MODE_SMOOTH } from '../src/shaders.js'

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

/* The synthetic raster: 4×3, span 255 s so that arrival-second === LUT index
 * (u = sec/255 → round(u·255) = sec). Row 0 (north) burns early, row 2 late.
 *
 *   layout (arrival seconds; W = white no-data, T = transparent no-data):
 *     row 0:   0    10    20    W
 *     row 1:  50   100   150    T
 *     row 2: 200   254   255→W  30
 */
const W = 4
const H = 3
const START = Date.UTC(2026, 0, 1)
const SPAN_S = 255
const WINDOW = { startMs: START, endMs: START + SPAN_S * 1000 }

const px = (sec) => [Math.floor(sec / 65536), Math.floor(sec / 256) % 256, sec % 256, 255]
const WHITE = [255, 255, 255, 255]
const TRANS = [0, 0, 0, 200]           // non-opaque alpha = no-data too
const grid = [
  px(0), px(10), px(20), WHITE,
  px(50), px(100), px(150), TRANS,
  px(200), px(254), WHITE, px(30),     // sec 255 would encode r=0,g=0,b=255 — fine;
]                                      // the third cell is literal white instead
const bytes = new Uint8ClampedArray(grid.flat())
const raster = { bytes, width: W, height: H }

const LUT = lutFor(SCHEMES[0], MODE_SMOOTH)   // fire Smooth — the parity look
const END = endFrameLut()

const rgba = (img, i) => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]]
const lutRgb = (lut, sec) => [lut[sec * 4], lut[sec * 4 + 1], lut[sec * 4 + 2], 255]
const eq = (a, b) => a.every((v, i) => v === b[i])
const CLEAR = [0, 0, 0, 0]

console.log('\ncanvasPainter — mid-run (t = start + 100 s)')
{
  const img = paintProgression(raster, WINDOW, START + 100 * 1000, LUT)
  check('returns ImageData-shaped {data,width,height} in node',
    img.data instanceof Uint8ClampedArray && img.width === W && img.height === H)
  check('an early pixel is colored from the LUT at its arrival index',
    eq(rgba(img, 0), lutRgb(LUT, 0)), rgba(img, 0).join())
  check('a mid pixel indexes the LUT by arrival seconds (sec 50 → entry 50)',
    eq(rgba(img, 4), lutRgb(LUT, 50)))
  check('the inclusive gate: a pixel arriving EXACTLY now draws (sec 100 at t=100)',
    eq(rgba(img, 5), lutRgb(LUT, 100)))
  check('a future pixel stays transparent (sec 150 at t=100)', eq(rgba(img, 6), CLEAR))
  check('white is no-data, not "burned at 2^24-1"', eq(rgba(img, 3), CLEAR))
  check('non-opaque alpha is no-data', eq(rgba(img, 7), CLEAR))
  check('burned pixels paint opaque regardless of LUT alpha', rgba(img, 0)[3] === 255)

  // ORIENTATION (README "Raster orientation"): published bytes are row 0 =
  // north and the painter must NOT flip — north stays the first output row.
  check('orientation: no row flip — bytes row 0 is output row 0 (north)',
    eq(rgba(img, 0), lutRgb(LUT, 0)) && eq(rgba(img, 8), CLEAR))  // sec 200 unburned at t=100
}

console.log('\ncanvasPainter — final frame (t = end)')
{
  const img = paintProgression(raster, WINDOW, WINDOW.endMs, LUT)
  check('at the end of the run every burned pixel switches to the end LUT',
    eq(rgba(img, 0), lutRgb(END, 0)) && eq(rgba(img, 8), lutRgb(END, 200)))
  check('the end frame is an arrival map, not a flat fill',
    !eq(rgba(img, 0), rgba(img, 8)))
  check('no-data stays transparent at the final frame too', eq(rgba(img, 3), CLEAR))
  check('the last-arriving pixel is PRESENT at the final frame (the gate fix)',
    eq(rgba(img, 9), lutRgb(END, 254)))
}

console.log('\ncanvasPainter — perimeter end style')
{
  /* 100×100 so the texture-fraction edge offset (1.5·0.005·100 = 0.75) lands
   * on the 1-px neighbors (floor(x+0.5±0.75) = x±1). White frame, burned
   * block in [10,90) with arrival-sec = column x; span 255 s as above. */
  const W2 = 100
  const mk = (mutate) => {
    const b = new Uint8ClampedArray(W2 * W2 * 4).fill(255)   // all white no-data
    for (let y = 10; y < 90; y++) {
      for (let x = 10; x < 90; x++) {
        const i = (y * W2 + x) * 4
        b[i] = 0; b[i + 1] = 0; b[i + 2] = x; b[i + 3] = 255  // sec = x (< 256)
      }
    }
    if (mutate) mutate(b)
    return { bytes: b, width: W2, height: W2 }
  }
  const at = (img, x, y) => rgba(img, y * W2 + x)
  const BANDS = SCHEMES[0].bands
  const INTERIOR = [51, 26, 0]                    // bands[3] rgb ×255, rounded
  const A_INT = Math.round(BANDS[3][3] * 255)     // 0.7 → 179
  const opts = { endStyle: 'perimeter', bands: BANDS }

  const img = paintProgression(mk(), WINDOW, WINDOW.endMs, LUT, opts)
  check('the burn fills with the interior slot colour at its own alpha',
    eq(at(img, 50, 50), [...INTERIOR, A_INT]), at(img, 50, 50).join())
  check('the final data edge is the same colour, opaque',
    eq(at(img, 10, 50), [...INTERIOR, 255]) && eq(at(img, 50, 89), [...INTERIOR, 255]))
  check('no-data stays transparent', eq(at(img, 5, 50), CLEAR))
  check('one flat mass — interior carries no arrival gradient',
    eq(at(img, 20, 50), at(img, 70, 50)))

  const hole = paintProgression(mk((b) => { b.fill(255, (50 * W2 + 50) * 4, (50 * W2 + 50) * 4 + 4) }),
    WINDOW, WINDOW.endMs, LUT, opts)
  check('an interior no-data hole grows an opaque edge around it',
    eq(at(hole, 49, 50), [...INTERIOR, 255]) && eq(at(hole, 50, 50), CLEAR))

  // The semantic the shader must share: the border keys on NO-DATA adjacency.
  // A last-arriving pixel (arrival == span, diff == 0 at the final frame)
  // must NOT smear a border around itself.
  const late = paintProgression(mk((b) => { b[(50 * W2 + 70) * 4 + 2] = 255; b[(50 * W2 + 70) * 4 + 1] = 0 }),
    WINDOW, WINDOW.endMs, LUT, opts)
  check('a last-arriving pixel draws (inclusive gate) without smearing a border',
    eq(at(late, 70, 50), [...INTERIOR, A_INT]) && eq(at(late, 69, 50), [...INTERIOR, A_INT]))

  const jet = paintProgression(mk(), WINDOW, WINDOW.endMs, LUT)
  check('without opts the final frame stays the jet arrival map',
    eq(at(jet, 50, 50), lutRgb(END, 50)))
  check('perimeter before the end frame is just the normal look (style only gates atEnd)',
    eq(rgba(paintProgression(raster, WINDOW, START + 100 * 1000, LUT, opts), 5), lutRgb(LUT, 100)))
  check('perimeter without bands throws a descriptive error',
    (() => { try { paintProgression(mk(), WINDOW, WINDOW.endMs, LUT, { endStyle: 'perimeter' }); return false }
      catch (e) { return /bands/.test(e.message) } })())
}

console.log('\ncanvasPainter — edges')
{
  const before = paintProgression(raster, WINDOW, START - 1000, LUT)
  check('before the fire nothing draws',
    Array.from({ length: W * H }, (_, i) => rgba(before, i)).every((p) => eq(p, CLEAR)))

  const degenerate = paintProgression(
    { bytes: new Uint8ClampedArray(px(0)), width: 1, height: 1 },
    { startMs: START, endMs: START }, START, LUT)
  check('a degenerate window does not divide by zero',
    degenerate.data[3] === 255 && Number.isFinite(degenerate.data[0]))
}

/* ================================================================= result */
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
