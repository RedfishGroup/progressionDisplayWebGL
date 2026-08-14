/**
 * Progression shaders — one program, one decode, one time base, three
 * mappings (spec §3.3, §3.5). Host-agnostic GLSL strings, no side effects.
 *
 * Provenance. Descended from RedfishGroup/progressionDisplayWebGL via the
 * AnyHazard fork (src/webgl/progressionShaders.js), which is the reference
 * implementation wherever the two disagree — that is where the maintenance
 * actually happened. Uniform names follow AnyHazard's shipped set
 * (`isGradient`, `gradientColor1..4`); the never-landed `upstream/` patch's
 * `useGradient`/`gradColor1..4` are retired (D1).
 *
 * Three deliberate departures from the shipped shader:
 *
 * 1. THE DECODE IS FIXED. `color2number` computed
 *    floor(c.r·255³) + floor(c.g·255²) + floor(c.b·255) = R·65025 + G·255 + B,
 *    against an encoder that packs R·65536 + G·256 + B. Arrival times read
 *    ~0.78 % early — ~22 min on a 2-day fire, ~67 min on a 6-day one. The
 *    final-frame rainbow's divisor moves from 255² to 65536 to match.
 * 2. `highp` EVERYWHERE, which retires the viewer's ÷256 time hack: fp32's
 *    24-bit mantissa represents every integer to 2²⁴, and 2²⁴−1 seconds
 *    (~194 days) is exactly the encoding's ceiling. So the time base is plain
 *    seconds-since-start. (`mediump` never helped anyway — true fp16 is exact
 *    only to 2048, so the ÷256 values overflowed it too; it worked because
 *    desktop drivers promote mediump to fp32.)
 * 3. The recency fade window is a UNIFORM, not the viewer's fixed constant.
 *    See RECENCY_* below.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y-FLIP CONVENTION (D8) — read before touching the quad or the matrix.
 *
 * The flip lives in the TEXTURE COORDINATES: v = 0 is the quad's TOP, which
 * is where row 0 of the raster (= north, per encodeToaRGBA) belongs. The
 * projection matrix's vertical scale is therefore POSITIVE and means
 * placement only.
 *
 * AnyHazard's shipped pairing is the mirror image — un-flipped texcoords with
 * a negative `ry` hidden inside `getProjectionMatrix`'s `phei = ul.y - lr.y`.
 * Both are self-consistent; MIXING THEM RENDERS THE MAP UPSIDE DOWN. If you
 * ever "fix" a sign in one file, fix the other.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Legacy recency fade extent: the viewer's `rat = 1.7` in its 256-second
 *  time base = 5222 s ≈ 87 min. Used as a FLOOR, not the value (D16). */
export const LEGACY_FADE_S = 5222

/** Fraction of the run the recency fade spans once it exceeds the floor.
 *  The viewer's fixed constant is 3 % of a two-day progression, which renders
 *  the whole fire one flat color; on the short simulation runs it was tuned
 *  for it lands nearer a quarter of the span. Taste call — see D16. */
export const FADE_SPAN_FRACTION = 0.12

/** Effective recency fade window in seconds for a run of `spanSeconds`. */
export function recencyFadeSeconds(spanSeconds) {
  return Math.max(LEGACY_FADE_S, FADE_SPAN_FRACTION * spanSeconds)
}

/** Mode uniform values. */
export const MODE_SMOOTH = 0
export const MODE_BANDS = 1
export const MODE_RECENCY = 2

export const vertexShader = `
precision highp float;
attribute vec2 aPos;
attribute vec2 aTex;
uniform mat4 projection;
varying vec2 v_texCoord;
void main() {
  v_texCoord = aTex;
  gl_Position = projection * vec4(aPos, 0.0, 1.0);
}
`

export const fragmentShader = `
precision highp float;

uniform sampler2D u_image;      // arrival raster, row 0 = north
uniform sampler2D u_lut;        // 256x1 ramp, time order (Smooth, Recency)
uniform sampler2D u_endLut;     // 256x1 ramp for the final frame (Jet)
varying vec2 v_texCoord;

uniform float timeSeconds;      // elapsed since start -- plain seconds
uniform float lastTime;         // total span -- plain seconds
uniform float recencyFadeS;     // Recency fade window (D16)
uniform int mode;               // 0 Smooth . 1 Bands . 2 Recency

uniform bool isGradient;
uniform vec4 gradientColor1;    // outermost ring
uniform vec4 gradientColor2;    // middle ring
uniform vec4 gradientColor3;    // inner ring
uniform vec4 gradientColor4;    // interior
uniform bool isWater;           // legacy json.flood only; Studio never sets it

// Base-256, matching encodeToaRGBA exactly. See departure 1 in the header.
float arrivalSeconds(vec4 c) {
  return floor(c.r * 255.0 + 0.5) * 65536.0
       + floor(c.g * 255.0 + 0.5) * 256.0
       + floor(c.b * 255.0 + 0.5);
}

// White (255,255,255) = never burned. Unchanged from the shipped contract.
bool noData(vec4 c) { return c.a < 1.0 || c.r >= 1.0; }

// Sample the ramp at normalized position u.
//
// The index is computed explicitly rather than left to NEAREST's own
// mapping: sampling a 256-texel LUT at u picks floor(u*256), while the canvas
// renderer picks round(u*255). Those disagree on a quarter of all u, which
// would put a one-entry colour difference between the two renderers and cost
// us the Smooth-mode pixel-parity guarantee (spec §7.3). Index the same texel
// the CPU would, then hit its centre.
vec3 rampColor(float u) {
  float texel = floor(clamp(u, 0.0, 1.0) * 255.0 + 0.5);
  return texture2D(u_lut, vec2((texel + 0.5) / 256.0, 0.5)).rgb;
}

// The final-frame ramp (Jet), sampled identically.
vec3 endColor(float u) {
  float texel = floor(clamp(u, 0.0, 1.0) * 255.0 + 0.5);
  return texture2D(u_endLut, vec2((texel + 0.5) / 256.0, 0.5)).rgb;
}

float getDiff(vec2 tc) {
  vec4 d = texture2D(u_image, tc);
  if (noData(d)) { return -1.0; }
  return timeSeconds - arrivalSeconds(d);
}

// Ring test: samples at a fraction of the TEXTURE, so band width scales with
// the fire's bounding box rather than screen pixels. Preserved deliberately
// (D15) so Studio previews the geometry AnyHazard actually draws.
int isFireBorder(float percentWide) {
  float dd = percentWide * 0.005;
  float up    = getDiff(v_texCoord + dd * vec2(0.0,  1.0));
  float dn    = getDiff(v_texCoord + dd * vec2(0.0, -1.0));
  float left  = getDiff(v_texCoord + dd * vec2(-1.0, 0.0));
  float right = getDiff(v_texCoord + dd * vec2( 1.0, 0.0));
  if (up <= 0.0 || dn <= 0.0 || left <= 0.0 || right <= 0.0) { return 1; }
  return 0;
}

void main() {
  gl_FragColor = vec4(0.0);

  vec4 data = texture2D(u_image, v_texCoord);
  if (noData(data)) { return; }

  float arrival = arrivalSeconds(data);
  float diff = timeSeconds - arrival;
  // Inclusive: a pixel arriving exactly now HAS burned. The shipped shader
  // gates on diff > 0.0, which leaves the last-arriving pixel transparent at
  // the final frame — a one-pixel hole, and a disagreement with the canvas
  // renderer (which draws when t <= cur) that would cost us Smooth-mode
  // parity. Only exact ties are affected, i.e. the first and last frames.
  if (diff < 0.0) { return; }

  float span = max(lastTime, 1.0);
  float uArr = clamp(arrival / span, 0.0, 1.0);
  bool atEnd = (timeSeconds >= lastTime - 1.0) || (lastTime <= 0.0);

  // THE FINAL FRAME IS SHARED. Once the fire is over, recency has nothing
  // left to say and band rings only restate the last perimeter, so all three
  // looks converge on one arrival-time map in the Jet ramp. This replaces the
  // shipped HSV sweep, whose hue wrapped (…red -> blue -> cyan again) so two
  // very different times could land on the same colour.
  if (atEnd) {
    gl_FragColor = vec4(endColor(uArr), 1.0);
    return;
  }

  if (mode == 0) {
    /* ---- Smooth: arrival ramp. Pixel-parity target: RasterOverlay ---- */
    gl_FragColor = vec4(rampColor(uArr), 1.0);

  } else if (mode == 1) {
    /* ---- Bands: the shipped AnyHazard mapping ---- */
    if (isFireBorder(1.5) == 1)      { gl_FragColor = gradientColor1; }
    else if (isFireBorder(3.5) == 1) { gl_FragColor = gradientColor2; }
    else if (isFireBorder(6.5) == 1) { gl_FragColor = gradientColor3; }
    else                             { gl_FragColor = gradientColor4; }
    // isGradient wins over isWater, matching shipped precedence (D5)
    if (isWater && !isGradient) { gl_FragColor = vec4(0.0, 0.0, 1.0, 0.5); }

  } else {
    /* ---- Recency: leading edge, in scheme colors (round-1 note 2) ---- */
    {
      // Age within the fade window; anything older clamps to the far end,
      // which is what paints the already-covered area a single flat colour.
      float age = clamp(diff / recencyFadeS, 0.0, 1.0);
      // The LUT is always in TIME order (0 = earliest, 1 = newest), so the
      // leading edge — the newest burn — is 1 - age. No branch on where the
      // colours came from: a gradient's edge slot and the default ramp's top
      // stop both live at the same end of the texture.
      gl_FragColor = vec4(rampColor(1.0 - age), 0.85);
    }
  }
}
`

/** Every uniform the program declares — the renderer caches locations from this. */
export const UNIFORM_NAMES = [
  'u_image', 'u_lut', 'u_endLut', 'projection',
  'timeSeconds', 'lastTime', 'recencyFadeS', 'mode',
  'isGradient', 'gradientColor1', 'gradientColor2', 'gradientColor3', 'gradientColor4',
  'isWater'
]

/**
 * The unit quad: positions (±1) interleaved with texture coordinates.
 * v = 0 sits at the quad's TOP — the y-flip lives here (D8).
 */
export const QUAD = new Float32Array([
  -1, -1, 0, 1,
  -1, 1, 0, 0,
  1, 1, 1, 0,
  -1, -1, 0, 1,
  1, 1, 1, 0,
  1, -1, 1, 1
])
