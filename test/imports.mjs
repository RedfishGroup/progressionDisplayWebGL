/**
 * Import-surface test: resolves the package THROUGH ITS OWN exports map
 * (node package self-reference), so a typo in package.json "exports" or a
 * missing barrel symbol fails here — before any consumer exists. Also proves
 * importing the package has no import-time side effects and needs no map
 * framework present (the Leaflet adapter defers touching the L global).
 * Run: node test/imports.mjs
 */

import * as pkg from 'ProgressionDisplayWebGL'
import * as leafletAdapter from 'ProgressionDisplayWebGL/adapters/leaflet'
import * as ol2Adapter from 'ProgressionDisplayWebGL/adapters/openlayers2'
import * as fallback from 'ProgressionDisplayWebGL/fallback'

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\npackage exports — the "." barrel')

const fns = [
  'ProgressionRenderer', 'RendererUnavailable',
  'recencyFadeSeconds', 'endFrameLut', 'isFinalFrame',
  'rampLutBytes', 'lutFromBands', 'lutFor', 'timeOrder',
  'bandsRampCss', 'rgbCss', 'bandCss', 'rampCss',
  'windowFromJson', 'boundsFromJson', 'styleFromJson', 'rasterFromImage', 'acresFromJson',
  'paintProgression',
]
for (const name of fns) {
  check(`exports function ${name}`, typeof pkg[name] === 'function', typeof pkg[name])
}

check('exports vertexShader/fragmentShader as strings',
  typeof pkg.vertexShader === 'string' && typeof pkg.fragmentShader === 'string')
check('exports mode constants 0/1/2',
  pkg.MODE_SMOOTH === 0 && pkg.MODE_BANDS === 1 && pkg.MODE_RECENCY === 2)
check('exports the recency constants',
  typeof pkg.LEGACY_FADE_S === 'number' && typeof pkg.FADE_SPAN_FRACTION === 'number')
check('exports UNIFORM_NAMES as a non-empty array',
  Array.isArray(pkg.UNIFORM_NAMES) && pkg.UNIFORM_NAMES.length > 0)
check('exports the QUAD as a 24-float Float32Array',
  pkg.QUAD instanceof Float32Array && pkg.QUAD.length === 24)
check('exports the 5-scheme table',
  Array.isArray(pkg.SCHEMES) && pkg.SCHEMES.length === 5)
check('exports MODES and LEGACY_GRADIENTS and END_FRAME_SCHEME',
  Array.isArray(pkg.MODES) && typeof pkg.LEGACY_GRADIENTS === 'object' &&
  typeof pkg.END_FRAME_SCHEME === 'object')
check('exports END_FRAME_STYLES with the jet and perimeter keys',
  Array.isArray(pkg.END_FRAME_STYLES) &&
  pkg.END_FRAME_STYLES.map((s) => s.key).join() === 'jet,perimeter')
check('RendererUnavailable is an Error subclass',
  Object.getPrototypeOf(pkg.RendererUnavailable) === Error ||
  pkg.RendererUnavailable.prototype instanceof Error)

console.log('\npackage exports — "./adapters/leaflet" subpath')

check('subpath resolves and exports projectionMatrix',
  typeof leafletAdapter.projectionMatrix === 'function')
check('subpath exports createProgressionLayer',
  typeof leafletAdapter.createProgressionLayer === 'function')
check('adapter imported without a Leaflet global present (late binding holds)',
  typeof globalThis.L === 'undefined')

console.log('\npackage exports — "./adapters/openlayers2" subpath (deferred bridge)')

check('subpath resolves and exports the shared matrix helper',
  typeof ol2Adapter.projectionMatrixFromViewportCorners === 'function')
check('both adapters expose the same placement function',
  ol2Adapter.projectionMatrixFromViewportCorners === leafletAdapter.projectionMatrix)

console.log('\npackage exports — "./fallback" subpath')

check('subpath resolves and exports paintProgression',
  typeof fallback.paintProgression === 'function')

/* ================================================================= result */
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
