import { outlines, ROADWAY_KINDS, type SceneComponent } from "./components";
import type { Vec2 } from "./geometry";

/**
 * True when two convex polygons overlap by more than `tolerance` metres
 * (separating-axis test). Edges that merely touch do not count.
 */
export function convexOverlap(a: Vec2[], b: Vec2[], tolerance = 0.05): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < 1e-9) continue;
      const nx = (y1 - y2) / length;
      const ny = (x2 - x1) / length;
      const project = (points: Vec2[]) => {
        let min = Infinity;
        let max = -Infinity;
        for (const [x, y] of points) {
          const d = x * nx + y * ny;
          min = Math.min(min, d);
          max = Math.max(max, d);
        }
        return [min, max] as const;
      };
      const [aMin, aMax] = project(a);
      const [bMin, bMax] = project(b);
      if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= tolerance)
        return false;
    }
  }
  return true;
}

export function componentsOverlap(
  a: SceneComponent,
  b: SceneComponent,
  tolerance = 0.05,
): boolean {
  return outlines(a).some((pa) =>
    outlines(b).some((pb) => convexOverlap(pa, pb, tolerance)),
  );
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq),
        );
  return [a[0] + t * dx, a[1] + t * dy];
}

export interface Gap {
  /** Closest point on the first component's outline. */
  from: Vec2;
  /** Closest point on the second component's outline. */
  to: Vec2;
  /** Edge-to-edge distance in metres; 0 when the outlines overlap. */
  distance: number;
}

/** Shortest edge-to-edge gap between two components' outlines. */
export function gapBetween(a: SceneComponent, b: SceneComponent): Gap | null {
  const polysA = outlines(a);
  const polysB = outlines(b);
  if (!polysA.length || !polysB.length) return null;
  let best: Gap | null = null;
  for (const pa of polysA) {
    for (const pb of polysB) {
      for (let i = 0; i < pa.length; i++) {
        const a1 = pa[i];
        const a2 = pa[(i + 1) % pa.length];
        for (let j = 0; j < pb.length; j++) {
          const b1 = pb[j];
          const b2 = pb[(j + 1) % pb.length];
          // The closest pair between two segments always involves an endpoint
          // unless they cross, which the overlap test below covers.
          const candidates: [Vec2, Vec2][] = [
            [a1, closestOnSegment(a1, b1, b2)],
            [a2, closestOnSegment(a2, b1, b2)],
            [closestOnSegment(b1, a1, a2), b1],
            [closestOnSegment(b2, a1, a2), b2],
          ];
          for (const [from, to] of candidates) {
            const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
            if (!best || distance < best.distance)
              best = { from, to, distance };
          }
        }
      }
    }
  }
  if (best && componentsOverlap(a, b, 0)) best = { ...best, distance: 0 };
  return best;
}

/** Distance between component centres. */
export function centreDistance(a: SceneComponent, b: SceneComponent) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Whether `next` puts a changed sidewalk on a roadway, or a changed roadway under a sidewalk. */
export function breaksSidewalkRule(
  next: SceneComponent[],
  changed: Set<string>,
): boolean {
  const sidewalks = next.filter((c) => c.kind === "sidewalk");
  const roadway = next.filter(
    (c) => ROADWAY_KINDS.includes(c.kind) && !c.osmId,
  );
  return sidewalks.some((s) =>
    roadway.some(
      (r) =>
        (changed.has(s.id) || changed.has(r.id)) &&
        componentsOverlap(s, r, 0.05),
    ),
  );
}
