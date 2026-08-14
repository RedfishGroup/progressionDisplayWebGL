# ProgressionDisplayWebGL

WebGL renderer for incident-progression (time-of-arrival) rasters, plus the
format helpers and map-framework adapters every host used to reimplement.
This repo is the shared core of the progression-viewer lineage: the original
renderer here was forked into AnyHazard, rewritten inside Progression Studio,
and that rewrite has now landed back as this package. The consuming apps —
Progression Studio, the published viewerTemplate, and AnyHazard — import it
rather than carrying their own copies.

Plain ESM, zero runtime dependencies, no build step. Works from a bundler or
directly via `<script type="module">`.

```
import { ProgressionRenderer, RendererUnavailable,
         windowFromJson, boundsFromJson, styleFromJson,
         rasterFromImage, acresFromJson,
         paintProgression, endFrameLut, isFinalFrame } from 'ProgressionDisplayWebGL'
import { createProgressionLayer, projectionMatrix } from 'ProgressionDisplayWebGL/adapters/leaflet'
import { paintProgression } from 'ProgressionDisplayWebGL/fallback'
```

## The three things a host supplies

The renderer is deliberately blind to everything app-shaped. A host provides:

1. **A canvas.** `new ProgressionRenderer(canvas)`. It throws
   `RendererUnavailable` when there is no WebGL context, no true `highp` in
   fragment shaders, on shader compile/link failure, or (at `setRaster`) for
   a raster over `MAX_TEXTURE_SIZE`. Treat that as "use the fallback painter",
   never as a crash. The renderer never renames or restyles your canvas
   beyond its backing-store size.
2. **A clock, pushed in.** `renderer.setTime(ms)` with absolute epoch ms.
   There is no global clock, no internal rAF loop, no player — hosts own
   playback and push time down.
3. **A placement.** `setViewport(cssW, cssH, devicePixelRatio)` +
   `setProjection(matrix16)`. For Leaflet hosts `adapters/leaflet` does both;
   the pure `projectionMatrixFromViewportCorners(ul, lr, cssW, cssH)`
   (`adapters/matrix.js`) is shared by all adapters and testable in node.

## Quick start

```js
import {
  ProgressionRenderer, rasterFromImage, windowFromJson, styleFromJson,
  endFrameLut, MODE_SMOOTH,
} from 'ProgressionDisplayWebGL'

const json = await (await fetch(base + '.json')).json()
const img = new Image()
img.crossOrigin = 'anonymous'          // the PNG bytes must survive untouched
img.src = base + '.png'
await img.decode()

const r = new ProgressionRenderer(canvas)   // may throw RendererUnavailable
r.setRaster(rasterFromImage(img))           // uploads once; scrubbing never re-uploads
r.setWindow(windowFromJson(json))           // the union contract, see below
r.setEndLut(endFrameLut())                  // only the 'jet' end style needs this
r.setStyle(styleFromJson(json, MODE_SMOOTH))
r.setViewport(cssW, cssH, devicePixelRatio)
r.setProjection(matrix)                     // from an adapter, or your own placement

r.setTime(timeMs)
r.draw()
```

## Raster orientation

**The progression PNG is human-readable: row 0 is north.** That holds at
every stage — encoder output, the published file, the bytes handed to
`setRaster`, texture memory. Nothing in this package (and nothing in a host)
may flip rows on the way through.

The renderer implements the invariant in exactly one place: **the y-flip
lives in the texture coordinates.** The `QUAD` constant carries `v = 0` at
the quad's *top*, which is where raster row 0 (north) belongs. Consequently
the projection matrix's **vertical scale is positive** and means placement
only (`adapters/matrix.js`).

The legacy pairing — shipped in AnyHazard's `getProjectionMatrix` and the
viewerTemplate's `fireOverlayGL.js` — is the mirror image: un-flipped
texcoords with a negative vertical scale hidden in `phei = ul.y - lr.y`.
Both pairings are self-consistent. **Mixing them renders the map upside
down.** Hosts migrating to this package must take the package's matrices
(or the shared matrix helper) and must NOT feed a legacy-convention matrix
into this renderer. During migration those legacy sites still exist —
Simtable2's `initLeaflet.js` and the template's `fireOverlayGL.js` — and are
retired by their respective integration steps.

Everything that touches placement or row order cites this section:
`QUAD` (shaders.js), `adapters/matrix.js`, `format/raster.js` (no flip on
decode), `fallback/canvasPainter.js` (no flip on paint), and the
`orientation:`-prefixed tests in `test/core-smoke.mjs` and
`test/painter.mjs`. A sign regression is an orientation failure and the
test names say so.

## The data contract

- **Raster in:** `{bytes, width, height}`, RGBA, **base-256** seconds since
  start packed into RGB (`R·65536 + G·256 + B`), white = no data (the shader
  treats `a < 255 || r ≥ 255` as no-data), row 0 = north. `rasterFromImage`
  produces exactly this from a decoded PNG.
- **Window in:** `setWindow({startMs, endMs})`, epoch ms. Deriving it from a
  JSON is `windowFromJson`'s job — **the union contract**: explicit
  `startTime`/`endTime` when both are finite (they may carry the publisher's
  timezone adjustment, so they are the authority), else the `UTC` array's
  endpoints, else it throws. It never returns NaN: the NaN path is the
  legacy frozen-fully-burned-fire bug.
- **Style in:** `styleFromJson(json, mode, {endStyle})` resolves, in order:
  explicit `json.gradient` (4 slots, edge → interior, drives every look) →
  `json.flood` (the built-in Water scheme) → Fire defaults. Results are
  memoized per source so LUT references stay stable — `setStyle` re-uploads
  the LUT texture only when the reference changes.
- **Time base:** plain seconds under `highp` — fp32 is integer-exact to
  2²⁴, precisely the encoding's ceiling (~194 days). The construction check
  refuses to run without real `highp` rather than render quietly-wrong times
  (the legacy `mediump` copies survive only because desktop drivers promote
  to fp32).
- **Blending:** `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` over a transparent clear,
  context created with `premultipliedAlpha: false`. When comparing readback
  pixels, the framebuffer holds `src.rgb × src.a` (Smooth and the jet end
  frame write alpha 1.0 and read back untouched; Bands/Recency/perimeter do
  not).
- **Recency window:** `recencyFadeSeconds(spanS) = max(5222, 0.12·spanS)` —
  the legacy viewer's fixed 5222 s constant survives only as the floor.
- **Band geometry** is a fraction of the *texture* (`percentWide × 0.005`),
  so ring width scales with the raster, and below roughly 256² the inner
  rings are sub-texel and collapse — preserved deliberately so previews
  match what ships.

## Renderer API

| Member | Behavior |
|---|---|
| `new ProgressionRenderer(canvas)` | Context + `highp` check + program; throws `RendererUnavailable` on any of them. |
| `setRaster({bytes,width,height})` | Uploads the arrival texture once; throws `RendererUnavailable` over `MAX_TEXTURE_SIZE`. `renderer.uploads` counts uploads — scrubbing must never increment it. |
| `setWindow({startMs,endMs})` / `setTime(ms)` | Window and clock, both pushed in; elapsed/span computed at draw. |
| `setStyle({mode, lut, bands, isGradient, endStyle?, isWater?})` | Stores style; re-uploads the 256×1 LUT only when `lut`'s reference changed. `styleFromJson` produces this shape. |
| `setEndLut(lut)` | The final-frame ramp (`endFrameLut()`), uploaded once; only the `'jet'` end style reads it. |
| `setViewport(cssW, cssH, dpr)` | Backing store in device pixels; CSS size and the projection stay in CSS px. |
| `setProjection(m)` | Column-major 4×4 from the adapter; positive vertical scale (see orientation). |
| `draw()` | Draws nothing unless raster + projection + style are all present — no identity-matrix fallback stretching the raster across the viewport. |
| `destroy()` | Deletes GL resources and force-releases the context (`WEBGL_lose_context`). |

## Color: two roles, one resolver, one flip

Each scheme in `SCHEMES` carries a 3-stop `ramp` (Smooth's no-gradient
default, 0.55 breakpoint) and 4 RGBA `bands` slots (drives Bands, publishes
as `json.gradient`, feeds `lutFromBands`). `lutFor(colors, mode)` is the one
place color resolves: a published gradient wins for every look; Recency
always reads the slots; Smooth otherwise keeps its ramp. LUTs are indexed by
**time** (0 = earliest); `timeOrder()` is the only place the stored
edge→interior order flips to time order — never inline that reversal.
`lutFromBands` deliberately drops per-slot alpha (alpha is a Bands
affordance; in a continuous ramp it would read as a transparency gradient).

## The end frame

Once `isFinalFrame(elapsedS, spanS)` is true, every mode converges on one
completion state, in one of two host-selectable styles
(`setStyle({endStyle})`, enumerated in `END_FRAME_STYLES`):

- **`'jet'`** (default): the arrival-time map through the end LUT — replaces
  the legacy HSV sweep whose hue wrapped so two very different times could
  share a color. Needs `setEndLut(endFrameLut())`.
- **`'perimeter'`**: the quieter option — the selected ramp's interior slot
  color over the whole burn, opaque at the fire's final data edge. The
  border keys on **no-data adjacency** (not arrival ordering, which would
  smear around the last-arriving pixels). Needs no end LUT.

`isFinalFrame` is exported so host-side legends and canvas paths switch at
the identical boundary.

## The fallback painter

`paintProgression(raster, window, timeMs, lut, {endStyle, bands})`
(`./fallback`) is the CPU twin: Smooth-look semantics, both end styles, same
inclusive gate, same `round(u·255)` LUT indexing, no row flip. It is the
standard fallback when construction throws `RendererUnavailable`, and the
parity reference the GL renderer is tested against — the two must change
together. Placement, opacity policy, and fallback orchestration stay
host-side.

## Adapters

- **`adapters/leaflet`** — `createProgressionLayer(bounds, options)`: a
  viewport-pinned canvas as an `L.Layer` (bounds-anchored canvases break at
  deep zoom; the GPU clips instead), single-path event teardown, zoom
  animation, `RendererUnavailable` surfaced through `options.onUnavailable`.
  Touches the Leaflet global only at first use, so importing it in node is
  safe. Also re-exports the pure `projectionMatrix(nw, se, cssW, cssH)`.
- **`adapters/openlayers2`** — a deferred bridge: today only the shared
  matrix helper. The layer shell gets built at the viewerTemplate
  integration step *only if* the template is still on OpenLayers by then
  (a Leaflet migration is expected; see the TODO in the module).
- **`adapters/matrix.js`** — `projectionMatrixFromViewportCorners`, the one
  placement function both adapters share.

## What stays in hosts

Play loops and clocks, progression list UIs, Firebase/network fetching policy,
Technosylva/ArcGrid ingestion (re-encode to the raster contract and feed
`setRaster`), `.pgw` world-file parsing (legacy path; `boundsFromJson`
covers the JSON-carried shapes), acres *display* (`acresFromJson` does the
arithmetic), opacity policy, and fallback orchestration.

## What this core fixed vs the shipped copies

| Fix | Shipped behavior |
|---|---|
| Base-256 decode | `R·65025 + G·255 + B` read arrival ~0.78 % early (~22 min on a 2-day fire). |
| `highp` + construction check | `mediump` + (in the viewer) a ÷256 time hack; worked only where drivers promote to fp32. |
| Quad uploads once | `bufferData(flatten(quad))` every frame, fresh allocation each time. |
| Inclusive arrival gate | `diff > 0.0` left the last-arriving pixel transparent at the final frame. |
| DPR-aware viewport | 1× on Retina. |
| Non-wrapping end frame | HSV hue wheel wrapped ~every 20 h of arrival spread. |
| Scaled recency window | Fixed 5222 s ≈ 3 % of a two-day run — a flat, unreadable fade. |

## Tests

`npm test` runs the node suites (no dev dependencies): core smoke
(color-table walls, orientation/matrix convention, shader-source
invariants, decode arithmetic), format helpers, the exports map (resolved
through package self-reference), and the fallback painter (exact pixels,
both end styles). GL-vs-painter pixel parity runs in the browser page
`test/browser.html`.

## legacy/

The pre-rebuild renderer, parked for reference while the hosts migrate
(AnyHazard's `Simtable2/src/UI/webgl/` is a line-for-line fork of it).
Nothing imports it except the interim demo; it is deleted once all hosts
are on the new core.
