import { outlines, type SceneComponent } from "./components";
import type { Vec2 } from "./geometry";

/** Snap destinations: the outline vertices and edges of the rest of the scene. */
export interface SnapTargets {
  points: Vec2[];
  segments: [Vec2, Vec2][];
  /** Segments grouped by rounded endpoint, so corner snaps can align to them. */
  byPoint: Map<string, [Vec2, Vec2][]>;
}

/** Largest angle change, in degrees, an end snap may "finish" to align. */
const ROTATION_SNAP = 15;

function pointKey([x, y]: Vec2): string {
  return `${Math.round(x * 100)}:${Math.round(y * 100)}`;
}

/** Collect snap destinations from the scene, skipping `excludeId`. */
export function snapTargets(
  scene: SceneComponent[],
  excludeId?: string,
): SnapTargets {
  const targets: SnapTargets = { points: [], segments: [], byPoint: new Map() };
  for (const component of scene) {
    if (component.id === excludeId) continue;
    for (const outline of outlines(component)) {
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        targets.points.push(a);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) continue;
        targets.segments.push([a, b]);
        for (const point of [a, b]) {
          const group = targets.byPoint.get(pointKey(point));
          if (group) group.push([a, b]);
          else targets.byPoint.set(pointKey(point), [[a, b]]);
        }
      }
    }
  }
  return targets;
}

function closestOnSegment([px, py]: Vec2, [ax, ay]: Vec2, [bx, by]: Vec2): Vec2 {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return [ax + t * dx, ay + t * dy];
}

function bearingDeg([ax, ay]: Vec2, [bx, by]: Vec2): number {
  return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
}

/** Rotation change (−45..45) that aligns with `bearing` modulo 90°. */
function alignmentDelta(bearing: number, rotation: number): number {
  let delta = (((bearing - rotation) % 90) + 90) % 90;
  if (delta > 45) delta -= 90;
  return delta;
}

function nearestPoint(
  point: Vec2,
  points: Vec2[],
): { at: Vec2; gap: number } | null {
  let best: { at: Vec2; gap: number } | null = null;
  for (const candidate of points) {
    const gap = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
    if (!best || gap < best.gap) best = { at: candidate, gap };
  }
  return best;
}

function nearestSegment(
  point: Vec2,
  segments: [Vec2, Vec2][],
): { at: Vec2; gap: number; seg: [Vec2, Vec2] } | null {
  let best: { at: Vec2; gap: number; seg: [Vec2, Vec2] } | null = null;
  for (const seg of segments) {
    const at = closestOnSegment(point, seg[0], seg[1]);
    const gap = Math.hypot(at[0] - point[0], at[1] - point[1]);
    if (!best || gap < best.gap) best = { at, gap, seg };
  }
  return best;
}

interface Candidate {
  x: number;
  y: number;
  rotation: number;
  /** Distance from the snapped vertex to its target before snapping. */
  gap: number;
  aligned: boolean;
  /** Corner-to-corner joins outrank lying flush on an edge. */
  direct: boolean;
}

const ROUND = (v: number) => Math.round(v * 10) / 10;

function outranks(a: Candidate, b: Candidate): number {
  return (
    (a.direct ? 0 : 1) - (b.direct ? 0 : 1) ||
    (a.aligned ? 0 : 1) - (b.aligned ? 0 : 1) ||
    a.gap - b.gap
  );
}

/**
 * Snap a moving component to nearby scene outlines so joints come out
 * seamless: corners meet corners, ends sit flush on edges, and an end that
 * is nearly parallel or perpendicular to the edge it touches finishes its
 * angle. Returns `component` unchanged when nothing is within `tolerance`.
 * Pass `{ rotate: false }` for translation-only snapping, as when resizing.
 */
export function snapComponent(
  component: SceneComponent,
  targets: SnapTargets,
  tolerance: number,
  { rotate = true }: { rotate?: boolean } = {},
): SceneComponent {
  if (!targets.points.length) return component;
  const rad = (component.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const half = (component.length ?? 0) / 2;
  const canAlign =
    rotate && !component.path && !component.footprint && half > 0;
  const candidates: Candidate[] = [];
  const offerAlignment = (
    target: Vec2,
    gap: number,
    local: Vec2,
    bearings: number[],
    direct: boolean,
  ) => {
    for (const bearing of bearings) {
      const delta = alignmentDelta(bearing, component.rotation);
      if (Math.abs(delta) > ROTATION_SNAP || Math.abs(delta) < 1e-9) continue;
      const next = ((component.rotation + delta) * Math.PI) / 180;
      candidates.push({
        x: target[0] - (local[0] * Math.cos(next) - local[1] * Math.sin(next)),
        y: target[1] - (local[0] * Math.sin(next) + local[1] * Math.cos(next)),
        rotation: component.rotation + delta,
        gap,
        aligned: true,
        direct,
      });
    }
  };
  for (const outline of outlines(component)) {
    for (const world of outline) {
      const dx = world[0] - component.x;
      const dy = world[1] - component.y;
      const local: Vec2 = [dx * cos + dy * sin, -dx * sin + dy * cos];
      // Only a long-axis end may trigger an alignment; side corners join
      // flush without rotating.
      const isEnd = Math.abs(Math.abs(local[0]) - half) < 0.05;
      const point = nearestPoint(world, targets.points);
      if (point) {
        candidates.push({
          x: component.x + (point.at[0] - world[0]),
          y: component.y + (point.at[1] - world[1]),
          rotation: component.rotation,
          gap: point.gap,
          aligned: false,
          direct: true,
        });
        if (canAlign && isEnd)
          offerAlignment(
            point.at,
            point.gap,
            local,
            (targets.byPoint.get(pointKey(point.at)) ?? []).map(([a, b]) =>
              bearingDeg(a, b),
            ),
            true,
          );
      }
      const segment = nearestSegment(world, targets.segments);
      if (segment) {
        candidates.push({
          x: component.x + (segment.at[0] - world[0]),
          y: component.y + (segment.at[1] - world[1]),
          rotation: component.rotation,
          gap: segment.gap,
          aligned: false,
          direct: false,
        });
        if (canAlign && isEnd)
          offerAlignment(
            segment.at,
            segment.gap,
            local,
            [bearingDeg(segment.seg[0], segment.seg[1])],
            false,
          );
      }
    }
  }
  const best = candidates
    .filter((c) => c.gap <= tolerance)
    .reduce<Candidate | undefined>(
      (a, b) => (a === undefined || outranks(b, a) < 0 ? b : a),
      undefined,
    );
  if (!best) return component;
  return {
    ...component,
    x: ROUND(best.x),
    y: ROUND(best.y),
    rotation: ROUND(best.rotation),
  };
}

/**
 * Snap a bare point (as when dragging a resize handle): corners grab corners
 * first, otherwise the point lands flush on the nearest edge. Returns null
 * when nothing is within `tolerance`.
 */
export function snapPoint(
  point: Vec2,
  targets: SnapTargets,
  tolerance: number,
): Vec2 | null {
  const direct = nearestPoint(point, targets.points);
  if (direct && direct.gap <= tolerance) return direct.at;
  const segment = nearestSegment(point, targets.segments);
  if (segment && segment.gap <= tolerance) return segment.at;
  return null;
}
