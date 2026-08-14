/**
 * The pure placement geometry shared by every map adapter — no map framework,
 * no DOM; node-testable.
 *
 * Affine placement of the shader's fixed ±1 quad onto the raster's on-screen
 * rectangle, as a column-major 4×4 for `uniformMatrix4fv(..., false, m)`.
 *
 * THE VERTICAL SCALE IS POSITIVE (README "Raster orientation"). The raster's
 * y-flip lives in the texture coordinates (QUAD carries v = 0 at the top),
 * so this matrix means placement only. The legacy helpers hid a flip in the
 * sign instead (`phei = ul.y - lr.y` is negative in a y-down pixel space),
 * paired with un-flipped texcoords — self-consistent, but MIXING the two
 * conventions renders the map upside down. Adapters built on this module
 * must pass the corners as named: upper-left = north edge.
 *
 * Inputs are viewport/container pixels in CSS units (y down, origin at the
 * viewport's top-left) — Leaflet's latLngToContainerPoint space, or the
 * OpenLayers viewport-pixel equivalent — because the canvas is pinned to the
 * viewport origin in every adapter.
 *
 * Note this stretches a raster uniform in lat/lon linearly between two
 * Mercator-projected corners — the identical approximation L.ImageOverlay
 * already makes, and well under a pixel at fire-sized extents.
 *
 * @param {{x: number, y: number}} ul - upper-left (north-west) corner, viewport px
 * @param {{x: number, y: number}} lr - lower-right (south-east) corner, viewport px
 * @param {number} cssW - viewport width in CSS px
 * @param {number} cssH - viewport height in CSS px
 * @returns {Float32Array} 16 values, column-major
 */
export function projectionMatrixFromViewportCorners(ul, lr, cssW, cssH) {
  const x0 = (2 * ul.x) / cssW - 1
  const x1 = (2 * lr.x) / cssW - 1
  const y0 = 1 - (2 * ul.y) / cssH
  const y1 = 1 - (2 * lr.y) / cssH
  const sx = (x1 - x0) / 2
  const sy = (y0 - y1) / 2
  const tx = (x0 + x1) / 2
  const ty = (y0 + y1) / 2
  return new Float32Array([
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, 1, 0,
    tx, ty, 0, 1
  ])
}
