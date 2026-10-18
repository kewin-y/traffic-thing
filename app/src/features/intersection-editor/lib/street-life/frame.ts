// A local metric frame around a mercator origin, so float32 GPU positions
// stay centimetre-precise across the whole downtown network.

import type { Vec2 } from "../geometry";

/** A mercator origin plus mercator units per metre at that latitude. */
export interface Frame {
  originX: number;
  originY: number;
  metre: number;
}

export function mercator(lng: number, lat: number): Vec2 {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    (lng + 180) / 360,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  ];
}

export function makeFrame(lng: number, lat: number): Frame {
  const [originX, originY] = mercator(lng, lat);
  return {
    originX,
    originY,
    metre: 1 / (40_075_016.686 * Math.cos((lat * Math.PI) / 180)),
  };
}

/** Longitude/latitude to frame metres: x east, y north. */
export function toFrame(frame: Frame, lng: number, lat: number): Vec2 {
  const [x, y] = mercator(lng, lat);
  return [
    (x - frame.originX) / frame.metre,
    -(y - frame.originY) / frame.metre,
  ];
}
