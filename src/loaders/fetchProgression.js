/**
 * Convenience loader for the published progression pair — browser-only.
 * Replaces the legacy misc.js loaders (whose XHR error path called an
 * undefined callback, so network failures threw instead of rejecting).
 *
 * The PNG is fetched as a blob and decoded with colorSpaceConversion:'none':
 * the RGB triples ARE the arrival times, and a color-managed decode corrupts
 * them silently — Firefox converts color-tagged PNGs to the display profile
 * by default, and a ±1 shift in the red channel is an 18-hour error. CORS is
 * enforced by the fetch itself, so the decoded image never taints a canvas.
 *
 * @param {string|{jsonUrl: string, pngUrl: string}} source - a base URL
 *   ('.json'/'.png' are appended) or explicit URLs
 * @returns {Promise<{json: Object, image: ImageBitmap|HTMLImageElement}>}
 *   feed `image` to rasterFromImage and `json` to windowFromJson/
 *   styleFromJson/boundsFromJson/acresFromJson
 */
export async function fetchProgression(source) {
  const jsonUrl = typeof source === 'string' ? source + '.json' : source.jsonUrl
  const pngUrl = typeof source === 'string' ? source + '.png' : source.pngUrl

  const resp = await fetch(jsonUrl)
  if (!resp.ok) {
    throw new Error(`fetchProgression: ${jsonUrl} responded ${resp.status}`)
  }
  const json = await resp.json()

  const pngResp = await fetch(pngUrl)
  if (!pngResp.ok) {
    throw new Error(`fetchProgression: ${pngUrl} responded ${pngResp.status}`)
  }
  const blob = await pngResp.blob()

  return { json, image: await decodeUntagged(blob) }
}

/**
 * Decode a PNG blob with color management off wherever the browser allows.
 * Fallbacks, in order: Firefox < 98 has createImageBitmap but rejects any
 * options bag — retry bare (renders, but tagged PNGs decode color-managed
 * there; keep published PNGs untagged to cover that tier). With no
 * createImageBitmap at all, decode through an Image element, which is
 * equally at the mercy of the browser's color management.
 */
async function decodeUntagged(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      })
    } catch {
      return await createImageBitmap(blob)
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()   // rejects on decode failure
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}
