/** Keep the sprite centred while removing transparent pixels from its hit box. */
export function trimIconPadding(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}) {
  const { width, height, data } = image;
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (maxX < 0) return image;
  const x = Math.max(0, Math.floor(Math.min(minX, width - maxX - 1)));
  const y = Math.max(0, Math.floor(Math.min(minY, height - maxY - 1)));
  const croppedWidth = width - 2 * x,
    croppedHeight = height - 2 * y;
  const pixels = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
  for (let row = 0; row < croppedHeight; row++) {
    const start = ((row + y) * width + x) * 4;
    pixels.set(
      data.subarray(start, start + croppedWidth * 4),
      row * croppedWidth * 4,
    );
  }
  return { width: croppedWidth, height: croppedHeight, data: pixels };
}
