/**
 * Raster bytes from a decoded progression PNG — browser-only.
 *
 * The single PNG → RGBA decode. The legacy hosts each did this differently
 * and some did it twice per load (AnyHazard decoded the same PNG base-256 on
 * the CPU and base-255 on the GPU; the viewer fetched it twice): this helper
 * plus ProgressionRenderer.setRaster is the whole path now.
 *
 * ORIENTATION (README "Raster orientation"): the PNG is human-readable —
 * row 0 is north — and this function performs NO y-manipulation; the bytes
 * go out in the same row order getImageData returns. The y-flip belongs to
 * the renderer's texture coordinates, nowhere else.
 *
 * The 2D-canvas route also sidesteps GL-side color management: the encoded
 * time bytes must arrive untouched, so the image must be same-origin or
 * loaded with crossOrigin='anonymous' over CORS (a tainted canvas throws
 * here, with a message saying exactly that).
 */

export function rasterFromImage(img) {
  const width = img.naturalWidth ?? img.width
  const height = img.naturalHeight ?? img.height
  if (!width || !height) {
    throw new Error('rasterFromImage: image has zero dimensions (not loaded yet?)')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  let imageData
  try {
    imageData = ctx.getImageData(0, 0, width, height)
  } catch (err) {
    throw new Error('rasterFromImage: canvas is tainted — the progression PNG must be ' +
      "served with CORS headers and loaded with crossOrigin='anonymous'", { cause: err })
  }
  return { bytes: imageData.data, width, height }
}
