import { pointInRing, type Vec2 } from "./geometry";
import type { PointerRay } from "./osm";

const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Exact roof/wall intersection, including courtyard holes; a miss stays a miss. */
export function intersectBuilding(
  polygons: Vec2[][][],
  ray: PointerRay,
  height: number,
  base = 0,
) {
  if (
    ![...ray.camera, ...ray.ground, ray.altitude, height, base].every(
      Number.isFinite,
    ) ||
    ray.altitude <= 0 ||
    height <= base
  )
    return null;
  const start = Math.max(0, 1 - height / ray.altitude);
  const end = Math.min(1, 1 - Math.max(0, base) / ray.altitude);
  if (start > end) return null;
  const direction = subtract(ray.ground, ray.camera);
  const at = (t: number): Vec2 => [
    ray.camera[0] + direction[0] * t,
    ray.camera[1] + direction[1] * t,
  ];
  let nearest: { ring: Vec2[]; t: number } | null = null;
  for (const rings of polygons) {
    if (!rings[0] || rings[0].length < 3) continue;
    const top = at(start);
    let hit =
      pointInRing(top, rings[0]) &&
      !rings.slice(1).some((hole) => pointInRing(top, hole))
        ? start
        : Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const edge = subtract(ring[(i + 1) % ring.length], a);
        const denominator = cross(direction, edge);
        if (Math.abs(denominator) < 1e-12) continue;
        const delta = subtract(a, ray.camera);
        const t = cross(delta, edge) / denominator;
        const u = cross(delta, direction) / denominator;
        if (t >= start - 1e-9 && t <= end + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9)
          hit = Math.min(hit, Math.max(start, t));
      }
    }
    if (Number.isFinite(hit) && (!nearest || hit < nearest.t))
      nearest = { ring: rings[0], t: hit };
  }
  return nearest;
}
