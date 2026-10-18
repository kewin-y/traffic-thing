import { expect, test } from "vitest";
import { trimIconPadding } from "./icon-image";

test("a narrow traffic-light sprite has a narrow hit box without moving its centre", () => {
  const image = {
    width: 64,
    height: 64,
    data: new Uint8ClampedArray(64 * 64 * 4),
  };
  for (let y = 2; y < 62; y++)
    for (let x = 18; x < 46; x++) image.data[(y * 64 + x) * 4 + 3] = 255;
  const cropped = trimIconPadding(image);
  expect(cropped.width).toBe(28);
  expect(cropped.height).toBe(60);
  expect(
    cropped.data.filter((_, i) => i % 4 === 3 && cropped.data[i] === 255),
  ).toHaveLength(28 * 60);
});

test("asymmetric art keeps enough padding to preserve its original anchor", () => {
  const image = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
  image.data[(5 * 10 + 7) * 4 + 3] = 255;
  const cropped = trimIconPadding(image);
  expect(cropped.width).toBe(6);
  expect(cropped.height).toBe(2);
  expect(cropped.data[(1 * 6 + 5) * 4 + 3]).toBe(255);
  expect(
    trimIconPadding({ width: 2, height: 2, data: new Uint8ClampedArray(16) })
      .width,
  ).toBe(2);
});
