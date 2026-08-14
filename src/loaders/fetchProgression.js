/**
 * Convenience loader for the published progression pair — browser-only.
 * Replaces the legacy misc.js loaders (whose XHR error path called an
 * undefined callback, so network failures threw instead of rejecting).
 *
 * The Image is loaded with crossOrigin='anonymous' so rasterFromImage can
 * read the bytes back — the encoded arrival times must survive untouched,
 * and a canvas tainted by a non-CORS image cannot be read at all.
 *
 * @param {string|{jsonUrl: string, pngUrl: string}} source - a base URL
 *   ('.json'/'.png' are appended) or explicit URLs
 * @returns {Promise<{json: Object, image: HTMLImageElement}>} feed `image`
 *   to rasterFromImage and `json` to windowFromJson/styleFromJson/
 *   boundsFromJson/acresFromJson
 */
export async function fetchProgression(source) {
  const jsonUrl = typeof source === 'string' ? source + '.json' : source.jsonUrl
  const pngUrl = typeof source === 'string' ? source + '.png' : source.pngUrl

  const resp = await fetch(jsonUrl)
  if (!resp.ok) {
    throw new Error(`fetchProgression: ${jsonUrl} responded ${resp.status}`)
  }
  const json = await resp.json()

  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = pngUrl
  await image.decode()   // rejects on network/decode failure

  return { json, image }
}
