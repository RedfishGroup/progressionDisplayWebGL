/**
 * Generates the offline sample progression the demo ships with:
 *   sample/sample.png            the arrival raster (base-256 seconds, white
 *                                = no data, row 0 = north)
 *   sample/sample.json           metadata: bounds, UTC, acres, explicit
 *                                startTime/endTime AND UTC (both window-
 *                                contract branches exercisable)
 *   sample/sample-gradient.json  the same fire publishing a json.gradient
 *
 * Fully deterministic (fixed start time, no randomness) so the committed
 * artifacts are reproducible; run `node tools/makeSample.mjs` to regenerate.
 * The PNG is written with a minimal hand-rolled encoder (node:zlib deflate +
 * IHDR/IDAT/IEND chunks) and self-verified by decoding it back.
 *
 * The burn scar is an anisotropic ellipse with a narrow FINGER REACHING
 * NORTH from the ignition point (the north marker: if the render shows the
 * finger pointing down, someone broke the orientation rule — README "Raster
 * orientation") and an interior no-data lake (exercises the perimeter end
 * style's hole edge).
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_GRADIENTS } from '../src/colors.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample')
mkdirSync(OUT, { recursive: true })

/* ============================================================ the fire */

const W = 128
const H = 128
const SPAN_S = 259200                       // 3 days
const START = Date.UTC(2026, 5, 1, 18, 0)   // fixed — deterministic output
const BOUNDS = { minlat: 35.8, minlon: -106.6, maxlat: 35.9, maxlon: -106.5 }

// Ignition NW-of-center; spread stretched east-southeast. Row 0 = NORTH.
const CX = 46
const CY = 48
const arrival = new Float64Array(W * H).fill(-1)   // seconds, -1 = never

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - CX
    const dy = y - CY
    // anisotropic distance: fire runs ~1.6× faster east, ~1.25× south, and
    // only half as fast north — the northern gap is what makes the finger
    // marker legible against white
    const ex = dx > 0 ? dx / 1.6 : dx
    const ey = dy > 0 ? dy / 1.25 : dy * 2
    const d = Math.sqrt(ex * ex + ey * ey)
    if (d <= 52) arrival[y * W + x] = SPAN_S * (d / 52)
  }
}

// The north marker: a narrow finger from the ignition toward the top edge,
// burning northward through the middle third of the run. It protrudes well
// past the ellipse's compressed northern boundary (~y 22), so it reads as an
// unmistakable spike against white.
for (let y = 4; y <= CY; y++) {
  const half = y < 16 ? 2 : 3
  for (let x = CX - half; x <= CX + half; x++) {
    const frac = (CY - y) / (CY - 4)                 // 0 at ignition, 1 at tip
    const t = SPAN_S * (0.25 + 0.45 * frac)
    const i = y * W + x
    if (arrival[i] === -1 || t < arrival[i]) arrival[i] = t
  }
}

// The lake: an interior no-data hole southeast of ignition.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - 78
    const dy = y - 66
    if (dx * dx + dy * dy <= 49) arrival[y * W + x] = -1
  }
}

/* ================================================== encode to RGBA bytes */

const rgba = new Uint8Array(W * H * 4)
for (let i = 0; i < W * H; i++) {
  const t = arrival[i]
  if (t === -1) {
    rgba.set([255, 255, 255, 255], i * 4)            // white = no data
  } else {
    const sec = Math.round(t)
    rgba.set([Math.floor(sec / 65536), Math.floor(sec / 256) % 256, sec % 256, 255], i * 4)
  }
}

/* ========================================================== PNG encoding */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const be32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
const chunk = (type, data) => {
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  return Buffer.concat([be32(data.length), td, be32(crc32(td))])
}

function encodePng(bytes, w, h) {
  const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0])])
  const raw = Buffer.alloc((w * 4 + 1) * h)          // filter byte 0 + row
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(bytes.buffer, bytes.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync(join(OUT, 'sample.png'), encodePng(rgba, W, H))

/* ============================================================ the JSONs */

// Acreage: pixel counts at each perimeter time × acres per pixel.
const latMid = (BOUNDS.minlat + BOUNDS.maxlat) / 2
const mPerDegLat = 111132
const mPerDegLon = 111320 * Math.cos((latMid * Math.PI) / 180)
const areaM2 = (BOUNDS.maxlat - BOUNDS.minlat) * mPerDegLat *
               (BOUNDS.maxlon - BOUNDS.minlon) * mPerDegLon
const acresPerPixel = areaM2 / 4046.86 / (W * H)

const N_PERIMS = 7
const UTC = Array.from({ length: N_PERIMS }, (_, i) => START + Math.round((SPAN_S * 1000 * i) / (N_PERIMS - 1)))
const acres = UTC.map((t) => {
  let n = 0
  const sec = (t - START) / 1000
  for (const a of arrival) if (a !== -1 && a <= sec) n++
  return Math.round(n * acresPerPixel)
})

const json = {
  name: 'Sample Progression (synthetic)',
  bounds: BOUNDS,
  width: W,
  height: H,
  UTC,
  acres,
  timezone: 'America/Denver',
  timezoneOffset: -6,
  startTime: UTC[0],
  endTime: UTC[N_PERIMS - 1],
}
writeFileSync(join(OUT, 'sample.json'), JSON.stringify(json, null, 2) + '\n')
writeFileSync(join(OUT, 'sample-gradient.json'),
  JSON.stringify({ ...json, name: json.name + ' — published gradient', gradient: LEGACY_GRADIENTS[2] }, null, 2) + '\n')

/* ======================================================== self-verify */

{
  const png = readFileSync(join(OUT, 'sample.png'))
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  // collect IDAT payloads
  let off = 8
  const idat = []
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const type = png.toString('ascii', off + 4, off + 8)
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const probe = (x, y) => {
    const row = y * (w * 4 + 1)
    if (raw[row] !== 0) throw new Error('unexpected filter type')
    return [raw[row + 1 + x * 4], raw[row + 1 + x * 4 + 1], raw[row + 1 + x * 4 + 2], raw[row + 1 + x * 4 + 3]]
  }
  const decode = ([r, g, b]) => r * 65536 + g * 256 + b
  const ok = (name, cond) => { if (!cond) throw new Error('self-verify failed: ' + name); console.log('  ok  ' + name) }

  ok('dimensions round-trip', w === W && h === H)
  ok('ignition decodes to ~0 s', decode(probe(CX, CY)) === Math.round(arrival[CY * W + CX]))
  ok('a mid pixel round-trips exactly', decode(probe(70, 48)) === Math.round(arrival[48 * W + 70]))
  ok('the lake is white', probe(78, 66).join() === '255,255,255,255')
  ok('outside the scar is white', probe(2, 2).join() === '255,255,255,255')
  ok('the north finger burns in row 10 (row 0 = north)', decode(probe(CX, 10)) > 0 && probe(CX, 10)[0] < 255)
  ok('acres are monotonic and end past 10k', acres.every((a, i) => i === 0 || a >= acres[i - 1]) && acres[N_PERIMS - 1] > 10000)
  console.log(`\nwrote sample/sample.png (${png.length} bytes), sample.json, sample-gradient.json`)
}
