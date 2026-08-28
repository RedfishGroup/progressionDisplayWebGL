/**
 * fetchProgression decode-fallback contract (stubbed globals — no browser).
 * The real byte-exactness is exercised by test/browser.html's color-tagged
 * PNG check; what no single browser can show is the fallback CHAIN, pinned
 * here instead:
 *   1. createImageBitmap is asked for an untagged decode
 *      (colorSpaceConversion/premultiplyAlpha 'none')
 *   2. an options-bag rejection (Firefox < 98 has createImageBitmap but
 *      rejects any options argument) retries bare instead of failing the
 *      load — the shared fork's vendored fix got exactly this wrong
 *   3. with no createImageBitmap at all, an Image element decodes the blob
 *      through an object URL, which is revoked afterwards
 * Run: node test/loader.mjs
 */

import { fetchProgression } from '../src/loaders/fetchProgression.js'

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const JSON_BODY = { name: 'stub fire' }
const PNG_BYTES = new Uint8Array([137, 80, 78, 71])   // stubs never parse it

/** fetch stub: records urls, serves .json/.png; `bad` fails that suffix. */
const stubFetch = (urls, bad) => async (url) => {
  urls.push(url)
  if (bad && url.endsWith(bad)) return { ok: false, status: 503 }
  if (url.endsWith('.json')) return { ok: true, json: async () => JSON_BODY }
  return { ok: true, blob: async () => new Blob([PNG_BYTES], { type: 'image/png' }) }
}

const realFetch = globalThis.fetch
const cleanup = () => {
  globalThis.fetch = realFetch
  delete globalThis.createImageBitmap
  delete globalThis.Image
}

/* ============================= 1. the untagged-decode options are exact */
console.log('\nfetchProgression — decode fallback chain')
try {
  const urls = []
  const calls = []
  globalThis.fetch = stubFetch(urls)
  const bitmap = { stub: 'bitmap' }
  globalThis.createImageBitmap = async (blob, opts) => { calls.push(opts); return bitmap }

  const { json, image } = await fetchProgression('fire/base')
  check('a string source derives .json and .png urls',
    urls.join() === 'fire/base.json,fire/base.png', urls.join())
  check('the json rides along untouched', json === JSON_BODY)
  check('the bitmap decode is asked for exactly {colorSpaceConversion, premultiplyAlpha} = none',
    calls.length === 1 &&
    calls[0].colorSpaceConversion === 'none' &&
    calls[0].premultiplyAlpha === 'none' &&
    Object.keys(calls[0]).length === 2,
    JSON.stringify(calls))
  check('the decoded bitmap is returned as image', image === bitmap)
} finally { cleanup() }

/* ================== 2. Firefox < 98: options rejected → bare retry wins */
try {
  const calls = []
  globalThis.fetch = stubFetch([])
  const bare = { stub: 'bare bitmap' }
  globalThis.createImageBitmap = async (blob, opts) => {
    calls.push(opts)
    if (opts !== undefined) throw new TypeError('operation not supported')
    return bare
  }

  const { image } = await fetchProgression('fire/base')
  check('an options-bag rejection retries bare instead of failing the load',
    calls.length === 2 && calls[0] !== undefined && calls[1] === undefined,
    JSON.stringify(calls.map((c) => c && Object.keys(c))))
  check('the bare decode is returned as image', image === bare)
} finally { cleanup() }

/* ==================== 3. no createImageBitmap at all: Image + object URL */
try {
  globalThis.fetch = stubFetch([])
  const revoked = []
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  URL.createObjectURL = () => 'blob:stub-url'
  URL.revokeObjectURL = (u) => revoked.push(u)
  class StubImage {
    async decode() { this.decodedFrom = this.src }
  }
  globalThis.Image = StubImage

  try {
    const { image } = await fetchProgression('fire/base')
    check('without createImageBitmap the blob decodes through an Image element',
      image instanceof StubImage && image.decodedFrom === 'blob:stub-url')
    check('the object URL is revoked after decode', revoked.join() === 'blob:stub-url')
  } finally {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  }
} finally { cleanup() }

/* ======================================= 4. error paths carry url + status */
try {
  globalThis.fetch = stubFetch([], '.json')
  let err = null
  try { await fetchProgression('fire/base') } catch (e) { err = e }
  check('a failing json fetch rejects with its url and status',
    /fire\/base\.json.*503/.test(String(err)), String(err))

  globalThis.fetch = stubFetch([], '.png')
  err = null
  try { await fetchProgression('fire/base') } catch (e) { err = e }
  check('a failing png fetch rejects with its url and status',
    /fire\/base\.png.*503/.test(String(err)), String(err))
} finally { cleanup() }

/* ============================================== 5. explicit-urls source */
try {
  const urls = []
  globalThis.fetch = stubFetch(urls)
  globalThis.createImageBitmap = async () => ({})
  await fetchProgression({ jsonUrl: 'meta.json', pngUrl: 'raster.png' })
  check('an explicit {jsonUrl, pngUrl} source is fetched verbatim',
    urls.join() === 'meta.json,raster.png', urls.join())
} finally { cleanup() }

/* ================================================================= result */
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
