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

/**
 * @param {{bytes: Uint8Array|Uint8ClampedArray, width: number, height: number}} raster
 * @param {{startMs: number, endMs: number}} window
 * @param {number} timeMs - absolute epoch ms (same clock as the window)
 * @param {Uint8Array|Uint8ClampedArray} lut - 256×4 RGBA from lutFor/styleFromJson
 * @param {{endStyle?: string}} [opts] - endStyle lands with the selectable
 *   end-frame feature; until then the final frame is the shared end LUT
 */
export function paintProgression(raster, window, timeMs, lut, opts = {}) {
  const { bytes, width, height } = raster
  const { startMs, endMs } = window
  const spanMs = (endMs - startMs) || 1
  const activeLut = isFinalFrame((timeMs - startMs) / 1000, spanMs / 1000) ? END_LUT : lut

  const n = width * height
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const si = i * 4
    const r = bytes[si]
    // no-data: the white contract (r = 255), plus anything non-opaque —
    // byte form of the shader's `c.a < 1.0 || c.r >= 1.0`
    if (bytes[si + 3] < 255 || r >= 255) continue
    const arrivalMs = startMs + (r * 65536 + bytes[si + 1] * 256 + bytes[si + 2]) * 1000
    if (arrivalMs > timeMs) continue   // inclusive gate: arrival <= now draws
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
