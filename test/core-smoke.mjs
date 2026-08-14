/**
 * Core smoke tests — the pure seams, everything testable without a GL context:
 * the color tables, the projection matrix (incl. the y-flip convention), the
 * recency window, the decode arithmetic, and shader-source invariants.
 * Run: node test/core-smoke.mjs
 *
 * Extracted from Progression Studio's test/gl-g0-smoke.mjs at the core lift.
 * The Studio-coupled sections (io/exports additive JSON fields, pipeline
 * encode round-trip against encodeToaRGBA, store/buildController discipline)
 * stayed behind; the encode round-trip survives here against a local
 * reference encoder that mirrors the published base-256 contract.
 * Actual pixels are the job of test/browser.html, which needs a browser.
 */

import { SCHEMES, LEGACY_GRADIENTS, rampLutBytes, lutFromBands, lutFor, timeOrder } from '../src/colors.js'
import { projectionMatrix } from '../src/adapters/leaflet.js'
import {
  fragmentShader, vertexShader, recencyFadeSeconds, LEGACY_FADE_S, FADE_SPAN_FRACTION,
  QUAD, MODE_SMOOTH, MODE_BANDS, MODE_RECENCY
} from '../src/shaders.js'

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/* ================================================================= colors */
console.log('\ncolors.js — the published-byte constraints')

// Verbatim copy of what Studio's exports.js held before the render core
// existed. If anyone edits the scheme table, this is the wall the published
// bytes hit.
const FROZEN_GRADIENTS = {
  1: { color1: [0.0, 0.0, 1.0, 0.5], color2: [0.0, 0.0, 1.0, 0.5], color3: [0.0, 0.0, 1.0, 0.5], color4: [0.0, 0.0, 1.0, 0.5] },
  2: { color1: [0.4, 0.9, 0.1, 0.7], color2: [0.7, 0.9, 0.1, 0.7], color3: [0.85, 0.9, 0.1, 0.7], color4: [0.3, 0.3, 0.05, 0.7] },
  3: { color1: [0.9, 0.1, 0.9, 0.7], color2: [0.75, 0.1, 0.9, 0.7], color3: [0.6, 0.1, 0.9, 0.7], color4: [0.3, 0.05, 0.45, 0.7] }
}
// The wall protects PUBLISHED BYTES for the schemes that already shipped.
// Adding a new scheme at a new index changes none of them, so the check is
// per-key rather than whole-object — a stricter check would forbid growth
// while a looser one would let an existing palette drift.
check('every pre-existing LEGACY_GRADIENTS entry is byte-identical',
  Object.keys(FROZEN_GRADIENTS).every((k) =>
    JSON.stringify(LEGACY_GRADIENTS[k]) === JSON.stringify(FROZEN_GRADIENTS[k])))
check('fire (scheme 0) publishes no gradient key', !(0 in LEGACY_GRADIENTS))
check('fire is the only scheme that publishes nothing',
  SCHEMES.filter((s) => !s.publishesGradient).length === 1 && !SCHEMES[0].publishesGradient)
check('scheme indices are stable — jet was appended, not inserted',
  SCHEMES[0].key === 'fire' && SCHEMES[1].key === 'water' &&
  SCHEMES[2].key === 'green' && SCHEMES[3].key === 'pink' && SCHEMES[4].key === 'jet')

// AnyHazard's hardcoded band defaults, from its progressionShaders.js. Fire
// publishes no gradient, so these are literally what AnyHazard draws — which
// is the only reason Bands mode can be an honest preview for the fire scheme.
const ANYHAZARD_DEFAULT_BANDS = [
  [0.9, 0.9, 0.1, 0.7], [0.9, 0.3, 0.1, 0.7], [0.7, 0.1, 0.1, 0.7], [0.2, 0.1, 0.0, 0.7]
]
check("fire bands equal AnyHazard's shader defaults",
  SCHEMES[0].bands.every((slot, i) => eqArr(slot, ANYHAZARD_DEFAULT_BANDS[i])))

check('every scheme has 3 ramp stops and 4 band slots',
  SCHEMES.every((s) => s.ramp.length === 3 && s.bands.length === 4 &&
    s.bands.every((b) => b.length === 4)))

/* ---- the LUT: independent reimplementation of the legacy schemeLut ---- */
{
  const stops = SCHEMES[0].ramp
  const expect = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const u = i / 255
    const seg = u < 0.55 ? [stops[0], stops[1], u / 0.55] : [stops[1], stops[2], (u - 0.55) / 0.45]
    for (let c = 0; c < 3; c++) {
      expect[i * 4 + c] = Math.round(seg[0][c] + (seg[1][c] - seg[0][c]) * seg[2])
    }
    expect[i * 4 + 3] = 255
  }
  const got = rampLutBytes(stops)
  check('rampLutBytes reproduces the legacy 0.55-breakpoint LUT byte for byte',
    got.length === expect.length && got.every((v, i) => v === expect[i]))
  check('LUT endpoints are the ramp endpoints',
    got[0] === stops[0][0] && got[255 * 4] === stops[2][0])
  check('LUT is fully opaque', Array.from({ length: 256 }, (_, i) => got[i * 4 + 3]).every((a) => a === 255))
}

/* ---- the four published slots as a ramp ---- */
{
  const bands = SCHEMES[2].bands                 // Toxic: four distinct slots
  const lut = lutFromBands(bands)
  const at = (pct) => {
    const i = Math.round((pct / 100) * 255) * 4
    return [lut[i], lut[i + 1], lut[i + 2]]
  }
  const slot = (n) => bands[n].slice(0, 3).map((v) => Math.round(v * 255))

  check('lutFromBands returns a 256×4 LUT', lut.length === 256 * 4)
  // THE ORIENTATION RULE: the LUT is indexed by TIME, earliest first, and the
  // interior is the oldest burn while the edge band is the active front. So
  // 0 % → color4 (interior), then color3, color2, and 100 % → color1 (edge).
  check('orientation: 0 % is color4 — the interior, i.e. the start of the fire',
    eqArr(at(0), slot(3)), JSON.stringify(at(0)))
  check('33.33 % is color3', eqArr(at(33.33), slot(2)), JSON.stringify(at(33.33)))
  check('66.67 % is color2', eqArr(at(66.67), slot(1)), JSON.stringify(at(66.67)))
  check('orientation: 100 % is color1 — the edge band, i.e. the newest burn',
    eqArr(at(100), slot(0)), JSON.stringify(at(100)))
  // …and it interpolates between them rather than stepping
  const mid = at(16.67)
  check('it interpolates between stops (a ramp, not four blocks)',
    mid.some((v, i) => v !== slot(3)[i]) && mid.some((v, i) => v !== slot(2)[i]),
    JSON.stringify(mid))
  check('timeOrder is the single place the flip happens',
    eqArr(timeOrder(bands)[0], bands[3]) && eqArr(timeOrder(bands)[3], bands[0]))
  check('the LUT is fully opaque — per-slot alpha belongs to Bands, not a ramp',
    Array.from({ length: 256 }, (_, i) => lut[i * 4 + 3]).every((a) => a === 255))
}

/* ---- lutFor: a gradient drives every look; otherwise the default stands ---- */
{
  // Every scheme that publishes json.gradient renders all three looks from
  // its four slots — that is the whole point of the unification.
  for (const [i, s] of SCHEMES.entries()) {
    const got = lutFor(s, MODE_SMOOTH)
    const want = s.publishesGradient ? lutFromBands(s.bands) : rampLutBytes(s.ramp)
    check(`Smooth/${s.key} uses ${s.publishesGradient ? 'the published slots' : 'its own ramp'}`,
      got.length === want.length && got.every((v, k) => v === want[k]), 'scheme ' + i)
    // Recency ALWAYS reads the slots, so with no gradient it lands on the
    // Fire bands — the same colours Bands falls back to.
    const rec = lutFor(s, MODE_RECENCY)
    const wantRec = lutFromBands(s.bands)
    check(`Recency/${s.key} reads the four slots even without a gradient`,
      rec.every((v, k) => v === wantRec[k]))
  }
  // Fire is the default case and must be untouched, 0.55 breakpoint and all.
  const fire = lutFor(SCHEMES[0], MODE_SMOOTH)
  check('the Fire default keeps the historical 0.55 breakpoint',
    fire[Math.round(0.55 * 255) * 4] === SCHEMES[0].ramp[1][0])
  check('the Fire default still starts dark and ends bright',
    fire[0] === SCHEMES[0].ramp[0][0] && fire[255 * 4] === SCHEMES[0].ramp[2][0])

  // A custom ramp is just a resolved scheme with slots — no second definition
  const custom = {
    ramp: SCHEMES[0].ramp,
    bands: [[1, 0, 0, 1], [0.8, 0.4, 0, 1], [0.4, 0.2, 0.6, 1], [0, 0, 0.2, 1]],
    publishesGradient: true
  }
  const cl = lutFor(custom, MODE_SMOOTH)
  check('a custom ramp drives the looks from its OWN slots, not its source preset',
    cl[255 * 4] === 255 && cl[255 * 4 + 1] === 0 && cl[2] === 51,
    `first=${cl[0]},${cl[1]},${cl[2]} last=${cl[255 * 4]},${cl[255 * 4 + 1]},${cl[255 * 4 + 2]}`)
}

/* ====================================================== projection matrix */
console.log('\nadapters/leaflet.js — placement geometry')
{
  // Viewport 1000×800; raster occupying container x 200…600, y 100…500.
  const nw = { x: 200, y: 100 }
  const se = { x: 600, y: 500 }
  const m = projectionMatrix(nw, se, 1000, 800)
  const [sx, , , , , sy, , , , , , , tx, ty] = m

  check('horizontal scale is the NDC half-width', Math.abs(sx - 0.4) < 1e-6, `sx=${sx}`)
  check('translation is the rect centre in NDC',
    Math.abs(tx - -0.2) < 1e-6 && Math.abs(ty - 0.25) < 1e-6, `tx=${tx} ty=${ty}`)

  // THE FLIP CONVENTION (README "Raster orientation"). We flip in the texture
  // coordinates, so this matrix must NOT also flip: a negative sy here would
  // pair with our v=0-at-top texcoords to render the map upside down. The
  // legacy AnyHazard helper returns -0.5 for this same input because it flips
  // in the matrix instead.
  check('orientation: vertical scale is POSITIVE — the flip lives in the texcoords',
    sy > 0 && Math.abs(sy - 0.5) < 1e-6, `sy=${sy} (the legacy helper's would be -0.5)`)

  // The quad corner carrying texcoord v=0 is (x=-1, y=+1) — the TOP — and it
  // must land on the raster's NORTH edge.
  const northNdc = 1 - (2 * nw.y) / 800
  check('orientation: quad top (v=0, raster row 0) lands on the north edge',
    Math.abs((sy * 1 + ty) - northNdc) < 1e-6)
  const southNdc = 1 - (2 * se.y) / 800
  check('orientation: quad bottom (v=1, last raster row) lands on the south edge',
    Math.abs((sy * -1 + ty) - southNdc) < 1e-6)

  check('matrix is a 16-float column-major Float32Array',
    m instanceof Float32Array && m.length === 16 && m[15] === 1)
}
{
  // A raster filling the viewport exactly maps to the identity-ish quad
  const m = projectionMatrix({ x: 0, y: 0 }, { x: 640, y: 480 }, 640, 480)
  check('full-viewport raster maps to the whole clip space',
    Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[5] - 1) < 1e-6 &&
    Math.abs(m[12]) < 1e-6 && Math.abs(m[13]) < 1e-6)
}
{
  // Off-screen bounds still produce a finite matrix — the GPU clips
  const m = projectionMatrix({ x: -5000, y: -4000 }, { x: -4000, y: -3000 }, 800, 600)
  check('off-screen bounds stay finite (GPU clips, we do not special-case)',
    Array.from(m).every(Number.isFinite))
}

/* ======================================================== recency window */
console.log('\nshaders.js — the recency window')
check('short runs keep the legacy fade exactly',
  recencyFadeSeconds(3600) === LEGACY_FADE_S)
check('the floor holds right up to the crossover',
  recencyFadeSeconds(LEGACY_FADE_S / FADE_SPAN_FRACTION - 1) === LEGACY_FADE_S)
{
  const twoDays = 172800
  const fade = recencyFadeSeconds(twoDays)
  check('a 2-day run scales past the floor', fade > LEGACY_FADE_S)
  check('a 2-day run fades over the specified fraction',
    Math.abs(fade - FADE_SPAN_FRACTION * twoDays) < 1e-9, `fade=${fade}`)
  // The bug this constant exists to prevent: the legacy fixed window is 3% of
  // a two-day span, which clamps every older pixel to one LUT entry.
  check('the legacy constant would have been under 5% of a 2-day run',
    LEGACY_FADE_S / twoDays < 0.05)
}

/* ==================================================== shader source rules */
console.log('\nshaders.js — source invariants')
check('fragment shader is highp', /precision\s+highp\s+float/.test(fragmentShader))
check('vertex shader is highp', /precision\s+highp\s+float/.test(vertexShader))
check('the base-256 decode is present',
  /65536\.0/.test(fragmentShader) && /256\.0/.test(fragmentShader))
check('the base-255 decode is gone (no 255.0*255.0*255.0 packing)',
  !/255\.0\s*\*\s*255\.0\s*\*\s*255\.0/.test(fragmentShader) &&
  !/bs\s*\*\s*bs\s*\*\s*bs/.test(fragmentShader))
check('the final-frame rainbow divisor moved off 255²',
  !/diff\s*\/\s*\(255\.0\s*\*\s*255\.0\)/.test(fragmentShader))
check('the arrival gate is inclusive (diff < 0.0 discards; no exclusive diff > 0.0 gate)',
  /diff\s*<\s*0\.0/.test(fragmentShader) && !/if\s*\(\s*diff\s*>\s*0\.0\s*\)/.test(fragmentShader))
check('AnyHazard uniform names are the ones declared',
  /uniform bool isGradient/.test(fragmentShader) &&
  /uniform vec4 gradientColor1/.test(fragmentShader) &&
  !/useGradient|gradColor/.test(fragmentShader))
check('the recency window is a uniform, not a baked constant',
  /uniform float recencyFadeS/.test(fragmentShader))
check('all three modes are branched', /mode == 0/.test(fragmentShader) && /mode == 1/.test(fragmentShader))
check('mode constants are 0/1/2',
  MODE_SMOOTH === 0 && MODE_BANDS === 1 && MODE_RECENCY === 2)
check('the y-flip convention is documented in the source',
  /Y-FLIP CONVENTION/.test(fragmentShader) || /v = 0/.test(fragmentShader) ||
  /texcoord/i.test(fragmentShader))

/* ---- the quad: v = 0 must sit at the TOP (y = +1) ---- */
{
  let ok = true
  for (let i = 0; i < 6; i++) {
    const y = QUAD[i * 4 + 1]
    const v = QUAD[i * 4 + 3]
    if (y === 1 && v !== 0) ok = false     // top vertex must carry v=0
    if (y === -1 && v !== 1) ok = false    // bottom vertex must carry v=1
  }
  check('orientation: quad texcoords put v=0 at the top (the flip lives here)', ok)
  check('quad is 6 vertices × 4 floats', QUAD.length === 24)
}

/* ================================================ the decode, arithmetically */
console.log('\nthe 255/256 fix — against a local reference encoder')
{
  // The published contract, in miniature: seconds-since-start packed base-256
  // into RGB. This mirrors Studio's Number2RGB / AnyHazard's number2RGB /
  // the viewer pipeline's RGBnumber.js — all base-256. If the shader decode
  // ever diverges from this again, the regression must be legible here.
  const referenceEncode = (sec) => [Math.floor(sec / 65536), Math.floor(sec / 256) % 256, sec % 256]
  const shaderDecode256 = (r, g, b) => r * 65536 + g * 256 + b
  const legacyDecode255 = (r, g, b) => r * 65025 + g * 255 + b   // what shipped

  let exact = true
  let worstLegacyErr = 0
  for (const sec of [0, 1, 255, 256, 257, 65535, 65536, 65537, 100000, 1000000, 16777215]) {
    const [r, g, b] = referenceEncode(sec)
    if (shaderDecode256(r, g, b) !== sec) exact = false
    if (sec > 0) worstLegacyErr = Math.max(worstLegacyErr, (sec - legacyDecode255(r, g, b)) / sec)
  }
  check('the shader decode round-trips the base-256 contract exactly, 0 → 2²⁴−1', exact)

  // The bug's magnitude, pinned so the regression is legible if it returns.
  const skew = 1 - 65025 / 65536
  check('the legacy base-255 decode read ~0.78 % low',
    Math.abs(skew - 0.0078) < 0.0002, `skew=${(skew * 100).toFixed(3)}%`)
  check('…which the round-trip confirms on real encoded bytes',
    Math.abs(worstLegacyErr - skew) < 0.001, `worst=${(worstLegacyErr * 100).toFixed(3)}%`)
  const twoDay = 2 * 24 * 3600
  check('…= ~22 min on a 2-day fire',
    Math.abs(twoDay * skew / 60 - 22) < 1.5, `${(twoDay * skew / 60).toFixed(1)} min`)

  // 2²⁴−1 seconds is simultaneously the encoding's ceiling and fp32's exact
  // integer limit — which is why highp lets us drop the viewer's ÷256 hack.
  check('the encoding ceiling equals fp32’s exact-integer limit', 16777215 === 2 ** 24 - 1)
}

/* ================================================================= result */
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
