# progression-render — porting notes

This directory is the progression renderer. It is written to be lifted out of
Progression Studio and dropped into AnyHazard or `viewerTemplate/` with the
host supplying only three things: a canvas, a clock, and a placement.

**It imports nothing from the rest of Studio and touches no globals.** That is
a rule, not an accident — check it before you add an import:

```
shaders.js          GLSL strings + the recency window. No side effects.
colors.js           The scheme table (two colour roles) and LUT builders.
renderer.js         ProgressionRenderer: gl, program, textures, uniforms.
adapters/leaflet.js Placement on a Leaflet map + the pure projectionMatrix.
```

Everything Studio-specific lives one level up in
`src/map/glRasterOverlay.js` — draft/full opacity, the acres readout, the
canvas fallback. That file is the example of what a host adapter looks like,
not part of the core.

## The three things a host supplies

**1. A canvas.** `new ProgressionRenderer(canvas)`. It throws
`RendererUnavailable` when there is no context, no `highp` in fragment
shaders, or (at `setRaster`) a raster over `MAX_TEXTURE_SIZE`. Treat that as
"use whatever you had before", never as a crash. The renderer never renames
your canvas — the class this descends from hardcodes
`canvas.id = 'progression-canvas'`, which collides with its own caller in
`progressionLayer.js`.

**2. A clock, pushed in.** `renderer.setTime(ms)`. The AnyHazard fork reads the
global `st.clock.UTC` inside `getAcres()`, `timeAsRatio()` and `draw()`; that
is ergonomic for one app and fatal for a module three apps import. Porting it
back means a ~3-line adapter that subscribes to `st.clock` and calls
`setTime()` — every existing call site keeps its behaviour.

**3. A placement.** `setViewport(cssW, cssH, dpr)` +
`setProjection(matrix16)`. For Leaflet hosts `adapters/leaflet.js` does this
already; `projectionMatrix(nw, se, cssW, cssH)` is pure and testable without a
browser.

## Two conventions that will bite you

**The y-flip lives in the texture coordinates.** `v = 0` is the quad's top,
where raster row 0 (north) belongs, so the projection matrix's vertical scale
is **positive** and means placement only.

AnyHazard's shipped pairing is the mirror image: un-flipped texcoords with a
negative `ry` hidden inside `getProjectionMatrix`'s `phei = ul.y - lr.y`. Both
are self-consistent. **Mixing them renders the map upside down.** If you take
this renderer but keep `st.leafletHelpers.getProjectionMatrix`, you must flip
one of them.

**Colour has two roles per scheme, not one.** `ramp` (3 stops) is Smooth's
no-gradient default; `bands` (4 RGBA slots) drives Bands, drives Recency
always, drives Smooth whenever a gradient exists, and is what publishes as
`json.gradient`. They are not interchangeable — a continuous ramp and four
discrete rings encode different things.

## `json.gradient` drives every look

**`lutFor(colors, mode)`** is the one place colour is resolved:

- **A published gradient wins.** Any scheme carrying four slots — every preset
  but Fire, and every custom ramp — feeds all three looks through
  `lutFromBands()`: an evenly-spaced ramp **in time order**, so 0 % is
  `color4` (the interior, i.e. the oldest burn), then `color3`, `color2`, and
  100 % is `color1` (the edge band, i.e. the newest).
- **Recency always reads the slots**, gradient or not, so with no gradient it
  draws the Fire *bands* — the same fallback Bands uses.
- **Smooth otherwise keeps its own default.** Fire's 3-stop ramp and the 0.55
  breakpoint are what Studio has always drawn for arrival.

Where each look reads that ramp:

| Look | Reads the ramp over | Ends |
|---|---|---|
| Smooth | arrival time across the whole run | earliest = `color4`, latest = `color1` |
| Bands | not the ramp — the four slots as discrete rings | `color4` interior, `color1` outermost |
| Recency | the fade window only (12 % of the run, floored at the legacy 5222 s) | `color1` at the burning edge; everything older clamps to `color4` |

**The final frame is shared.** Once `isFinalFrame(elapsed, span)` is true, all
three looks draw the same arrival map through a second LUT (`endFrameLut()`,
the built-in Jet ramp) uploaded once via `setEndLut`. It replaces the shipped
HSV sweep, whose hue wrapped so two very different times could share a colour.
A host that adopts this core gets that end frame too — and any host with its
own canvas path must switch at the same boundary, which is why `isFinalFrame`
is exported rather than inlined in the shader alone.

**THE ORIENTATION RULE.** Time runs left → right and top → bottom, earliest
first, on every surface — pixels, legend bars, gallery strips, editor rows.
The LUT is indexed by time (0 = earliest), so the shader needs no branch on
where the colours came from: Smooth samples `arrival/span` and Recency samples
`1 - age`, both against the same texture.

`timeOrder()` is the ONLY place the flip happens. Storage stays edge →
interior because that is the published `json.gradient.color1..4` order; if you
add a surface that draws slots for a human, reverse it through that helper
rather than inline, or the app grows a second opinion about which end is the
start of the fire.

> **The published viewer can gain scheme colours with zero protocol change.**
> Today's files already carry `json.gradient`. Feed those four slots through
> `lutFromBands`, and the recency look renders in the incident's colours
> instead of the hardcoded orange — no new JSON field, no re-publish, no
> coordination with the encoder. That is round-1 note 2, and Studio now proves
> the mechanism rather than merely reserving it.

One judgement call worth knowing: `lutFromBands` **drops per-slot alpha**.
Alpha is a Bands affordance — each ring is a flat fill that can be
individually see-through — and blending it into a continuous ramp would make
the fade read as a transparency gradient rather than a colour one.

## What the port fixes on arrival

Carrying this core across also carries four fixes the shipped copies lack:

1. **The base-255 decode.** `color2number` computes `R·65025 + G·255 + B`
   against an encoder packing `R·65536 + G·256 + B`, so arrival times read
   ~0.78 % early — ~22 min on a 2-day fire, ~67 min on a 6-day one.
2. **`highp` everywhere**, which retires the viewer's ÷256 time hack: fp32's
   mantissa is exact to 2²⁴, precisely the encoding's ceiling. (`mediump`
   never helped — true fp16 is exact only to 2048, so the ÷256 values
   overflowed it too; it worked because desktop drivers promote to fp32.)
3. **The quad uploads once.** Both shipped copies call
   `bufferData(flatten(this.points))` every frame on a constant quad, through
   a fresh allocation each time.
4. **An inclusive arrival gate.** `diff > 0.0` leaves the last-arriving pixel
   transparent at the final frame.

## Contract notes

- **Raster in:** `{bytes, width, height}`, RGBA, base-256 seconds since start,
  white = no data, **row 0 = north**. In Studio that is `result.rgba`
  unchanged — the exact bytes that publish as the PNG.
- **Window in:** `setWindow({startMs, endMs})`. Reading it from a progression
  JSON is the host's job, and the contract is a union: use explicit
  `startTime`/`endTime` when present, else derive from `UTC[0]` and
  `UTC[n-1]`. AnyHazard's player reads the explicit fields and derives
  nothing, so a JSON without them renders a fully-burned, frozen fire.
- **Recency window:** `recencyFadeSeconds(spanSeconds)` — floored at the
  legacy 5222 s, scaled to a fraction of the run above it. The legacy fixed
  constant is 3 % of a two-day span and renders such a fire flat.
- **Blending:** `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` over a transparent clear, so
  the framebuffer holds `src.rgb × src.a`. Matters when you compare pixels:
  Smooth writes alpha 1.0 and reads back untouched, Bands (0.7) and Recency
  (0.85) do not.
- **Band geometry** is a fraction of the *texture* (`percentWide × 0.005`), so
  below roughly 256² the inner two rings are sub-texel and collapse into the
  interior. Preserved deliberately so Studio previews what AnyHazard draws.
