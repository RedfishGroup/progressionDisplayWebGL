/**
 * ProgressionRenderer — the GL half of progression rendering (spec §3.2).
 *
 * Owns a context, a program, two textures, and the uniform state. It does not
 * read the DOM beyond its own canvas, does not know about Leaflet, and does
 * not read a clock: time is pushed in with setTime(ms) (D2). That is the one
 * fork from AnyHazard's class that has to be undone before this code can be
 * shared — theirs reads the global `st.clock.UTC` in three methods, which is
 * ergonomic for one app and fatal for a module three apps import.
 *
 * Construction throws RendererUnavailable rather than alerting or rendering
 * garbage; callers treat that as "use the canvas fallback".
 */

import {
  vertexShader, fragmentShader, UNIFORM_NAMES, QUAD, recencyFadeSeconds
} from './shaders.js'

export class RendererUnavailable extends Error {
  constructor(message) {
    super(message)
    this.name = 'RendererUnavailable'
  }
}

export class ProgressionRenderer {
  /**
   * @param {HTMLCanvasElement} canvas - the caller's canvas; never renamed
   *        (the shipped class hardcodes canvas.id = 'progression-canvas',
   *        which collides with its own caller — comparison §10.3.1)
   */
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false })
    if (!gl) throw new RendererUnavailable('WebGL context unavailable')

    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
    if (!hp || hp.precision === 0) {
      // Without highp the time base is not exact and the render would be
      // quietly wrong rather than absent — fall back instead (spec §3.3)
      throw new RendererUnavailable('highp float unsupported in fragment shaders')
    }

    this.canvas = canvas
    this.gl = gl
    this.uploads = 0            // asserted by the acceptance criteria (§7.5)

    this._raster = null
    this._window = { startMs: 0, endMs: 1 }
    this._timeMs = 0
    this._projection = null
    this._style = null
    this._cssW = 0
    this._cssH = 0
    this._dpr = 1

    this.program = this._buildProgram()
    gl.useProgram(this.program)

    this._u = {}
    for (const name of UNIFORM_NAMES) {
      this._u[name] = gl.getUniformLocation(this.program, name)
    }
    gl.uniform1i(this._u.u_image, 0)
    gl.uniform1i(this._u.u_lut, 1)
    gl.uniform1i(this._u.u_endLut, 2)

    // The quad is constant, so it is uploaded ONCE. Both shipped copies
    // re-upload it every frame through a fresh flatten() allocation — pure
    // GC churn during playback (comparison §10.6.2).
    this._buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(this.program, 'aPos')
    const aTex = gl.getAttribLocation(this.program, 'aTex')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aTex)
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)

    this._rasterTex = this._makeTexture()
    this._lutTex = this._makeTexture()
    this._endLutTex = this._makeTexture()
  }

  _buildProgram() {
    const gl = this.gl
    const compile = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new RendererUnavailable('shader compile failed: ' + log)
      }
      return s
    }
    const vs = compile(gl.VERTEX_SHADER, vertexShader)
    const fs = compile(gl.FRAGMENT_SHADER, fragmentShader)
    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog)
      gl.deleteProgram(prog)
      throw new RendererUnavailable('program link failed: ' + log)
    }
    return prog
  }

  _makeTexture() {
    const gl = this.gl
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // NEAREST is what makes draft rasters read as pixelated for free, and
    // what keeps Smooth mode byte-comparable to the canvas renderer
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return t
  }

  /**
   * Upload the arrival raster. Once per result — scrubbing never re-uploads.
   * @param {{bytes: Uint8Array|Uint8ClampedArray, width: number, height: number}} r
   *        exactly encodeToaRGBA's output: base-256 seconds, white = no data,
   *        row 0 = north. No PNG round-trip.
   */
  setRaster(r) {
    const gl = this.gl
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    if (Math.max(r.width, r.height) > max) {
      throw new RendererUnavailable(
        `raster ${r.width}×${r.height} exceeds MAX_TEXTURE_SIZE ${max}`)
    }
    // texImage2D wants a Uint8Array view; Uint8ClampedArray is not accepted
    // by every driver, so normalize without copying when we can
    const bytes = r.bytes instanceof Uint8Array
      ? r.bytes
      : new Uint8Array(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength)
    this._raster = r
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this._rasterTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, r.width, r.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
    this.uploads++
    return this
  }

  /** @param {{startMs: number, endMs: number}} w - explicit; §3.8's union
   *  contract (explicit fields when present, derived from UTC[] when absent)
   *  is the caller's job, not the renderer's. */
  setWindow(w) { this._window = w; return this }

  /** @param {number} ms - absolute epoch ms. No global clock (D2). */
  setTime(ms) { this._timeMs = ms; return this }

  /**
   * The final-frame ramp (Jet). Constant for the life of the renderer, so it
   * uploads once rather than riding setStyle.
   * @param {Uint8Array} lut - 256×4 RGBA, time order
   */
  setEndLut(lut) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this._endLutTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
    return this
  }

  /**
   * @param {{mode: number, lut: Uint8Array, bands: number[][],
   *          isGradient: boolean, isWater?: boolean}} s
   */
  setStyle(s) {
    const gl = this.gl
    const lutChanged = !this._style || this._style.lut !== s.lut
    this._style = s
    if (lutChanged) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this._lutTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.lut)
    }
    return this
  }

  /**
   * Backing store in DEVICE pixels; the projection matrix stays in CSS pixels
   * (that is `latLngToContainerPoint`'s space). AnyHazard conflates the two
   * and renders at 1× on Retina (comparison §10.5).
   */
  setViewport(cssW, cssH, dpr) {
    if (this._cssW === cssW && this._cssH === cssH && this._dpr === dpr) return this
    this._cssW = cssW
    this._cssH = cssH
    this._dpr = dpr
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    return this
  }

  /** @param {Float32Array} m - column-major 4×4, from the host adapter. */
  setProjection(m) { this._projection = m; return this }

  draw() {
    const gl = this.gl
    if (!gl) return this
    gl.clear(gl.COLOR_BUFFER_BIT)
    // No identity fallback: without a raster, a projection, or a style we
    // draw nothing rather than stretching the raster across the whole
    // viewport, which is what the shipped helper does (comparison §10.5)
    if (!this._raster || !this._projection || !this._style) return this

    const s = this._style
    const elapsedS = (this._timeMs - this._window.startMs) / 1000
    const spanS = (this._window.endMs - this._window.startMs) / 1000

    gl.useProgram(this.program)
    gl.uniform1f(this._u.timeSeconds, elapsedS)
    gl.uniform1f(this._u.lastTime, spanS)
    gl.uniform1f(this._u.recencyFadeS, recencyFadeSeconds(spanS))
    gl.uniform1i(this._u.mode, s.mode)
    gl.uniform1i(this._u.isGradient, s.isGradient ? 1 : 0)
    gl.uniform1i(this._u.isWater, s.isWater ? 1 : 0)
    gl.uniform4fv(this._u.gradientColor1, s.bands[0])
    gl.uniform4fv(this._u.gradientColor2, s.bands[1])
    gl.uniform4fv(this._u.gradientColor3, s.bands[2])
    gl.uniform4fv(this._u.gradientColor4, s.bands[3])
    gl.uniformMatrix4fv(this._u.projection, false, this._projection)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this._rasterTex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this._lutTex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this._endLutTex)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return this
  }

  destroy() {
    const gl = this.gl
    if (!gl) return
    gl.deleteTexture(this._rasterTex)
    gl.deleteTexture(this._lutTex)
    gl.deleteTexture(this._endLutTex)
    gl.deleteBuffer(this._buf)
    gl.deleteProgram(this.program)
    // Release the context outright — browsers cap live WebGL contexts, and
    // Studio adds/removes this layer routinely (§7.7)
    const ext = gl.getExtension('WEBGL_lose_context')
    if (ext) ext.loseContext()
    this.gl = null
    this._raster = null
    this._style = null
  }
}
