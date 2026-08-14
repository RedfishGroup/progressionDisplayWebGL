/**
 * Leaflet adapter — places a ProgressionRenderer's canvas on a Leaflet map
 * (spec §3.6, D7).
 *
 * ARCHITECTURE: AnyHazard's, not round-1's. The canvas covers the whole
 * VIEWPORT and is pinned to the screen; the geography lives in the vertex
 * shader's projection matrix. A bounds-anchored canvas (sized to the raster's
 * projected box, like L.ImageOverlay) is the intuitive design and it breaks:
 * an <img> scales to 20,000 px because the browser allocates no backing
 * store, but a canvas cannot — usable canvas/WebGL dimensions cap near
 * 16,384 px and cost is quadratic, so zooming far enough in fails to allocate
 * or silently clamps. The full-viewport canvas is bounded by construction and
 * the GPU clips the rest for free. Leaflet's own L.Renderer works this way.
 *
 * IMPLEMENTATION: Leaflet 1.9 idioms, not AnyHazard's class hierarchy. Theirs
 * is L.ImageOverlay → L.ElementOverlay → L.StaticLayer, two 2016-era shims
 * carrying a comment that they can go "with 1.0", reaching into
 * `map._panes` and inheriting machinery a viewport-pinned element never uses.
 * Extending L.Layer directly is a third of the code and fixes three real bugs
 * along the way (see _reset, _animateZoom, onRemove).
 *
 * Requires the Leaflet global `L`. The pure geometry (projectionMatrix) is
 * exported separately so it can be tested in node without a browser.
 */

import { ProgressionRenderer } from '../renderer.js'

/**
 * Affine placement of the shader's fixed ±1 quad onto the raster's on-screen
 * rectangle, as a column-major 4×4 for `uniformMatrix4fv(..., false, m)`.
 *
 * The vertical scale is POSITIVE. AnyHazard's helper returns a negative one,
 * because its `phei = ul.y - lr.y` is negative in a y-down coordinate space —
 * a y-flip hidden in the sign, paired with un-flipped texture coordinates.
 * We flip in the texcoords instead (D8), so this matrix means placement only.
 *
 * Inputs are CONTAINER pixels (CSS px), matching latLngToContainerPoint,
 * because the canvas is pinned to the viewport origin.
 *
 * Note this stretches a raster uniform in lat/lon linearly between two
 * Mercator-projected corners — the identical approximation L.ImageOverlay
 * already makes, and well under a pixel at fire-sized extents.
 *
 * @param {{x: number, y: number}} nw - north-west corner, container px
 * @param {{x: number, y: number}} se - south-east corner, container px
 * @param {number} cssW - viewport width in CSS px
 * @param {number} cssH - viewport height in CSS px
 * @returns {Float32Array} 16 values, column-major
 */
export function projectionMatrix(nw, se, cssW, cssH) {
  const x0 = (2 * nw.x) / cssW - 1
  const x1 = (2 * se.x) / cssW - 1
  const y0 = 1 - (2 * nw.y) / cssH
  const y1 = 1 - (2 * se.y) / cssH
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

let LayerClass = null

function defineLayer() {
  return L.Layer.extend({

    /**
     * @param {L.LatLngBounds|Array} bounds - the raster's geographic extent
     * @param {{id?: string, onReady?: Function, onDraw?: Function,
     *          onUnavailable?: Function}} options
     */
    initialize(bounds, options) {
      this._bounds = L.latLngBounds(bounds)
      L.setOptions(this, options || {})
      this.renderer = null
    },

    onAdd(map) {
      const canvas = L.DomUtil.create('canvas', 'leaflet-image-layer leaflet-zoom-animated')
      // The renderer never names the caller's canvas. In the shipped code
      // progressionLayer.js sets can.id = "progression-layer" and
      // staticProgression.initialize() overwrites it on the next line —
      // dead code that proves the point (comparison §10.3.1).
      if (this.options.id) canvas.id = this.options.id
      canvas.style.position = 'absolute'
      // .leaflet-image-layer carries pointer-events: none, which is what
      // stops a full-viewport overlay swallowing every click meant for the
      // bounds editor and origin tool
      map.getPane('overlayPane').appendChild(canvas)
      this._canvas = canvas

      try {
        this.renderer = new ProgressionRenderer(canvas)
      } catch (err) {
        this._teardownCanvas()
        if (this.options.onUnavailable) this.options.onUnavailable(err)
        return
      }

      this._onLost = (e) => {
        e.preventDefault()
        if (this.options.onUnavailable) {
          this.options.onUnavailable(new Error('WebGL context lost'))
        }
      }
      canvas.addEventListener('webglcontextlost', this._onLost)

      if (this.options.onReady) this.options.onReady(this.renderer)
      this._reset()
    },

    onRemove() {
      // ONE teardown path. Leaflet unbinds getEvents() itself, which is
      // exactly what the shipped wrapper never does: it registers handlers in
      // three places (ElementOverlay.onAdd, StaticLayer.registerMyEvents,
      // progressionLayer.installEvents) and unregisters in none, so every
      // add/remove cycle leaks (comparison §10.3.4).
      if (this._canvas && this._onLost) {
        this._canvas.removeEventListener('webglcontextlost', this._onLost)
        this._onLost = null
      }
      if (this.renderer) {
        this.renderer.destroy()
        this.renderer = null
      }
      this._teardownCanvas()
    },

    _teardownCanvas() {
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas)
      }
      this._canvas = null
    },

    getEvents() {
      // One handler resets the transform AND redraws, so the counter-transform
      // and the draw can never land a frame apart. The shipped code binds
      // 'move' twice across two files with no ordering guarantee between the
      // reset and the redraw (comparison §10.3.3).
      //
      // 'move'/'zoom' are suppressed during a zoom animation (Map._animateZoom
      // calls _move(..., supressEvent = true)), so zoomanim cannot fight this.
      const ev = {
        viewreset: this._reset,
        move: this._reset,
        moveend: this._reset,
        zoomend: this._reset,
        resize: this._reset
      }
      if (this._map.options.zoomAnimation && L.Browser.any3d) {
        ev.zoomanim = this._animateZoom
      }
      return ev
    },

    /**
     * Track the map through its zoom animation with a CSS scale+offset, the
     * way Leaflet's own L.Renderer does — this canvas is viewport-pinned
     * (geography lives in the projection matrix), which is exactly
     * L.Renderer's situation, so its math applies verbatim (padding 0): the
     * transform is computed FROM THE VIEW THE CANVAS WAS LAST DRAWN AT
     * (_drawCenter/_drawZoom, captured in _reset). The previous version
     * derived the offset from the map pane alone and overwrote the canvas's
     * setPosition translation, so the layer jumped to a corner for the
     * duration of the animation and snapped back on zoomend (polish r2 #12).
     */
    _animateZoom(e) {
      if (!this._canvas || this._drawZoom == null) return
      const scale = this._map.getZoomScale(e.zoom, this._drawZoom)
      const offset = this._map.getSize().multiplyBy(-scale / 2)
        .add(this._map.project(this._drawCenter, e.zoom))
        .subtract(this._map._getNewPixelOrigin(e.center, e.zoom))
      L.DomUtil.setTransform(this._canvas, offset, scale)
    },

    _reset() {
      if (!this._map || !this.renderer) return
      const size = this._map.getSize()
      if (size.x <= 0 || size.y <= 0) return

      // Pin the canvas to the viewport origin (the counter-transform), which
      // also clears any scale left over from a zoom animation
      L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]))
      // the view this draw is valid for — _animateZoom's reference frame
      this._drawCenter = this._map.getCenter()
      this._drawZoom = this._map.getZoom()

      const dpr = window.devicePixelRatio || 1
      this.renderer.setViewport(size.x, size.y, dpr)

      const nw = this._map.latLngToContainerPoint(this._bounds.getNorthWest())
      const se = this._map.latLngToContainerPoint(this._bounds.getSouthEast())
      this.renderer.setProjection(projectionMatrix(nw, se, size.x, size.y))
      this.renderer.draw()
      if (this.options.onDraw) this.options.onDraw()
    },

    /** Re-render with whatever state the caller just pushed into the renderer. */
    redraw() {
      this._reset()
      return this
    },

    setBounds(bounds) {
      this._bounds = L.latLngBounds(bounds)
      this._reset()
      return this
    },

    setOpacity(opacity) {
      if (this._canvas) this._canvas.style.opacity = opacity
      return this
    }
  })
}

/**
 * Create the progression GL layer. A factory rather than an exported class so
 * that importing this module in node (for the pure geometry tests) does not
 * require the Leaflet global to exist.
 */
export function createProgressionLayer(bounds, options) {
  if (!LayerClass) LayerClass = defineLayer()
  return new LayerClass(bounds, options)
}
