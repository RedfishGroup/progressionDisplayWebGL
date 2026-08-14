/**
 * OpenLayers 2 adapter — DEFERRED BRIDGE.
 *
 * Only the pure placement math ships today. The viewerTemplate (the one OL2
 * host) is likely to migrate to Leaflet; per the plan, the layer shell here
 * is built at the template-integration step ONLY IF the template is still on
 * OL2 when that step starts — otherwise the template adopts
 * ./adapters/leaflet and this shell is never written.
 *
 * TODO(viewerTemplate step): layer shell — an OpenLayers.Layer subclass
 * owning a viewport-pinned canvas (fireOverlayGL.js's origin-offset trick),
 * constructing ProgressionRenderer in try/catch with RendererUnavailable
 * reported through an onUnavailable callback, and on moveTo/resize calling
 * setViewport(cssW, cssH, devicePixelRatio) + setProjection from the
 * viewport-pixel corners. Corner ordering per README "Raster orientation":
 * upper-left = north edge, positive vertical scale — do NOT carry over the
 * legacy negative-phei pairing.
 */

export { projectionMatrixFromViewportCorners } from './matrix.js'
