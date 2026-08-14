/**
 * CPU fallback painter — the pure half of Studio's canvas RasterOverlay,
 * extracted so all hosts converge on ONE fallback when the GL renderer
 * throws RendererUnavailable (no context, no highp, oversized raster,
 * context lost). Placement (image overlay / layer), opacity policy, and
 * fallback orchestration stay host-side.
 *
 * It is also the shipped parity reference: Smooth-mode semantics here are
 * the ones the GL shader is tested against, so the two must move together —
 *   - inclusive arrival gate: a pixel arriving exactly now HAS burned
 *   - LUT index Math.round(u * 255), matching the shader's floor(u*255+0.5)
 *   - burned pixels write alpha 255; the host applies overlay opacity
 *   - once isFinalFrame, every look shows the shared end-frame ramp
 *
 * INPUT ORIENTATION (README "Raster orientation"): this painter takes the
 * PUBLISHED raster bytes — row 0 = north, base-256 seconds-since-start in
 * RGB, white = no data — and performs NO row flip; output row 0 is north.
 * (Studio's in-app painter flips because it reads the pipeline's
 * row-0-south `times` buffer; that flip must NOT be copied here.)
 *
 * Returns a real ImageData in the browser; in node (tests) an
 * ImageData-shaped {data, width, height}.
 */

import { endFrameLut, isFinalFrame } from '../colors.js'

// The shared final-frame ramp, built once — the GPU switches to this at the
// end of the run and so must this painter, or parity breaks there.
const END_LUT = endFrameLut()

// no-data: the white contract (r = 255), plus anything non-opaque —
// byte form of the shader's `c.a < 1.0 || c.r >= 1.0`
const noData = (bytes, i) => bytes[i * 4 + 3] < 255 || bytes[i * 4] >= 255

// The perimeter end style's edge test, mirroring the shader's isDataEdge:
// neighbors at ±1.5·0.005 of the TEXTURE (so edge width scales with the
// raster, same as the rings), NEAREST-sampled with CLAMP_TO_EDGE. The GL
// texel index for texcoord (x+0.5)/W ± dd is floor(x + 0.5 ± dd·W) —
// reproduced exactly so GPU/CPU parity holds for this style too. Below
// roughly 67 px the offset is sub-texel and the edge collapses, exactly as
// the sub-256² ring collapse the geometry rule preserves.
function isDataEdge(bytes, width, height, x, y) {
  const ddx = 1.5 * 0.005 * width
  const ddy = 1.5 * 0.005 * height
  const cl = (v, max) => Math.max(0, Math.min(max, v))
  const x1 = cl(Math.floor(x + 0.5 + ddx), width - 1)
  const x2 = cl(Math.floor(x + 0.5 - ddx), width - 1)
  const y1 = cl(Math.floor(y + 0.5 + ddy), height - 1)
  const y2 = cl(Math.floor(y + 0.5 - ddy), height - 1)
  return noData(bytes, y * width + x1) || noData(bytes, y * width + x2) ||
         noData(bytes, y1 * width + x) || noData(bytes, y2 * width + x)
}

/**
 * @param {{bytes: Uint8Array|Uint8ClampedArray, width: number, height: number}} raster
 * @param {{startMs: number, endMs: number}} window
 * @param {number} timeMs - absolute epoch ms (same clock as the window)
 * @param {Uint8Array|Uint8ClampedArray} lut - 256×4 RGBA from lutFor/styleFromJson
 * @param {{endStyle?: 'jet'|'perimeter', bands?: number[][]}} [opts] -
 *   endStyle 'perimeter' draws the final frame as the interior slot colour
 *   (bands[3], RGBA 0-1 — pass style.bands from styleFromJson) with an
 *   opaque border at the final data edge; default 'jet' uses the end LUT.
 */
export function paintProgression(raster, window, timeMs, lut, opts = {}) {
  const { bytes, width, height } = raster
  const { startMs, endMs } = window
  const spanMs = (endMs - startMs) || 1
  const atEnd = isFinalFrame((timeMs - startMs) / 1000, spanMs / 1000)
  const activeLut = atEnd ? END_LUT : lut

  const perimeter = atEnd && opts.endStyle === 'perimeter'
  let pR = 0, pG = 0, pB = 0, pA = 0
  if (perimeter) {
    if (!opts.bands) throw new Error("endStyle 'perimeter' needs opts.bands (pass style.bands)")
    const interior = opts.bands[3]   // gradientColor4 — the interior slot
    pR = Math.round(interior[0] * 255)
    pG = Math.round(interior[1] * 255)
    pB = Math.round(interior[2] * 255)
    pA = Math.round(interior[3] * 255)
  }

  const n = width * height
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const si = i * 4
    if (noData(bytes, i)) continue
    const arrivalMs = startMs + (bytes[si] * 65536 + bytes[si + 1] * 256 + bytes[si + 2]) * 1000
    if (arrivalMs > timeMs) continue   // inclusive gate: arrival <= now draws
    if (perimeter) {
      out[si] = pR
      out[si + 1] = pG
      out[si + 2] = pB
      out[si + 3] = isDataEdge(bytes, width, height, i % width, (i / width) | 0) ? 255 : pA
      continue
    }
    const u = Math.max(0, Math.min(1, (arrivalMs - startMs) / spanMs))
    const li = Math.round(u * 255) * 4
    out[si] = activeLut[li]
    out[si + 1] = activeLut[li + 1]
    out[si + 2] = activeLut[li + 2]
    out[si + 3] = 255   // LUT alpha is a Bands affordance; Smooth paints opaque
  }

  return typeof ImageData !== 'undefined'
    ? new ImageData(out, width, height)
    : { data: out, width, height }
}
