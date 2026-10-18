// The scene is authored in local metres around a fixed origin, with axes along
// Toronto's street grid (x "east" along College St, y "north" along Spadina Ave),
// and projected to longitude/latitude only when handed to MapLibre.

export type Vec2 = [number, number];

// Spadina Ave & College St, Toronto.
export const ORIGIN = { lng: -79.4003, lat: 43.6578 };

/** Toronto's grid "north" is about 16.7° west of true north. */
export const GRID_BEARING = -16.7;
const GRID_RADIANS = (-GRID_BEARING * Math.PI) / 180;
const GRID_COS = Math.cos(GRID_RADIANS);
const GRID_SIN = Math.sin(GRID_RADIANS);

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toLngLat([gx, gy]: Vec2): Vec2 {
  // Grid frame -> true east/north metres.
  const x = gx * GRID_COS - gy * GRID_SIN;
  const y = gx * GRID_SIN + gy * GRID_COS;
  return [
    ORIGIN.lng + x / METRES_PER_DEGREE_LNG,
    ORIGIN.lat + y / METRES_PER_DEGREE_LAT,
  ];
}

export function toLocal(lng: number, lat: number): Vec2 {
  const x = (lng - ORIGIN.lng) * METRES_PER_DEGREE_LNG;
  const y = (lat - ORIGIN.lat) * METRES_PER_DEGREE_LAT;
  return [x * GRID_COS + y * GRID_SIN, -x * GRID_SIN + y * GRID_COS];
}

/** Axis-aligned rectangle centred on (cx, cy), as an open ring. */
export function rect(cx: number, cy: number, w: number, h: number): Vec2[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];
}

/** Regular polygon, used for tree crowns and stop signs. */
export function polygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  phase = 0,
): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = phase + (i / sides) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

/** Rotate a ring about the origin (degrees, counter-clockwise), then translate. */
export function place(
  ring: Vec2[],
  x: number,
  y: number,
  rotationDeg: number,
  scale = 1,
): Vec2[] {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return ring.map(([px, py]) => [
    x + (px * cos - py * sin) * scale,
    y + (px * sin + py * cos) * scale,
  ]);
}

/** Whether `point` lies inside the ring (even-odd rule). */
export function pointInRing(point: Vec2, ring: Vec2[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
