/**
 * ProgressionDisplayWebGL — the package barrel.
 *
 * The renderer core is host-agnostic: it takes a canvas, a pushed-in clock
 * (setTime), and a placement (setViewport + setProjection). Map-framework
 * adapters live behind subpath exports ("./adapters/leaflet") so Leaflet
 * never becomes a dependency of this root import.
 *
 * Importing this module has no side effects.
 */

export { ProgressionRenderer, RendererUnavailable } from './renderer.js'

export {
  vertexShader,
  fragmentShader,
  MODE_SMOOTH,
  MODE_BANDS,
  MODE_RECENCY,
  recencyFadeSeconds,
  LEGACY_FADE_S,
  FADE_SPAN_FRACTION,
  UNIFORM_NAMES,
  QUAD,
} from './shaders.js'

export {
  SCHEMES,
  MODES,
  LEGACY_GRADIENTS,
  END_FRAME_SCHEME,
  endFrameLut,
  isFinalFrame,
  rampLutBytes,
  lutFromBands,
  lutFor,
  timeOrder,
  bandsRampCss,
  rgbCss,
  bandCss,
  rampCss,
} from './colors.js'
