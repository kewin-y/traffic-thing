import { pointInRing, type Vec2 } from "./geometry";

/**
 * A section of the map the user has opened for editing. Everything outside
 * every area is greyed out and read-only. Areas may overlap or stand apart;
 * where they touch they read as one region.
 */
export interface EditArea {
  id: string;
  /**
   * Outlines on the ground, in local metres, that together make the area: the
   * selected rectangle, plus whole footprints of anything its edge cut through.
   */
  rings: Vec2[][];
}

export const EDIT_AREAS_STORAGE_KEY = "traffic-thing:edit-areas:v1";

type ScreenRing = readonly (readonly [number, number])[];

function isRing(value: unknown): value is Vec2[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
  );
}

/** A saved area, including the single-`ring` shape saved before snapping. */
function toArea(value: unknown): EditArea | null {
  const area = value as {
    id?: unknown;
    ring?: unknown;
    rings?: unknown;
  } | null;
  if (typeof area?.id !== "string") return null;
  const rings = Array.isArray(area.rings) ? area.rings : [area.ring];
  return rings.length && rings.every(isRing) ? { id: area.id, rings } : null;
}

export function loadEditAreas(): EditArea[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(EDIT_AREAS_STORAGE_KEY) ?? "null",
    );
    return Array.isArray(saved)
      ? saved.flatMap((value) => toArea(value) ?? [])
      : [];
  } catch {
    return [];
  }
}

export function isEditable(areas: readonly EditArea[], point: Vec2): boolean {
  return areas.some((area) =>
    area.rings.some((ring) => pointInRing(point, ring)),
  );
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const turn = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return turn(a, b, c) !== turn(a, b, d) && turn(c, d, a) !== turn(c, d, b);
}

function edgesCross(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const [p, q] = [a[i], a[(i + 1) % a.length]];
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(p, q, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/**
 * The outlines among `candidates` that the selection's edge cuts through:
 * overlapping it without lying wholly inside it. Includes outlines with no
 * corner inside, such as a long building crossing a thin selection.
 */
export function cutByEdge(selection: Vec2[], candidates: Vec2[][]): Vec2[][] {
  return candidates.filter((ring) => {
    const inside = ring.filter((p) => pointInRing(p, selection)).length;
    if (inside === ring.length) return false;
    return (
      inside > 0 ||
      selection.some((p) => pointInRing(p, ring)) ||
      edgesCross(selection, ring)
    );
  });
}

/**
 * One SVG path for many screen-space rings, each wound the same way so that,
 * filled with the default non-zero rule, overlapping rings merge.
 */
export function unionPath(rings: readonly ScreenRing[]): string {
  return rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => {
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        area += x1 * y2 - x2 * y1;
      }
      const ordered = area < 0 ? [...ring].reverse() : ring;
      return `M${ordered.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
    })
    .join("");
}

/**
 * An SVG image, as a CSS url(), that is opaque everywhere except inside the
 * given screen-space rings. Used as a mask, it cuts holes in the grey overlay.
 */
export function holeMask(
  width: number,
  height: number,
  holes: readonly ScreenRing[],
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><mask id="m"><rect width="100%" height="100%" fill="white"/>` +
    `<path d="${unionPath(holes)}" fill="black"/></mask></defs>` +
    `<rect width="100%" height="100%" mask="url(#m)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * The compass bearing, between -45° and 45°, that lines the dominant street
 * direction of `lines` (as [lng, lat] coordinates) up with the screen.
 * Street grids are near-perpendicular, so directions are folded onto 90°
 * and weighted by length. Null when there are no streets to go by.
 */
export function dominantBearing(lines: readonly number[][][]): number | null {
  const bins = new Array<number>(90).fill(0);
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [lng1, lat1] = line[i - 1];
      const [lng2, lat2] = line[i];
      const dx = (lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180);
      const dy = lat2 - lat1;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const bearing = (((Math.atan2(dx, dy) * 180) / Math.PI) % 90) + 90;
      bins[Math.round(bearing) % 90] += length;
      total += length;
    }
  }
  if (!total) return null;
  // Smooth over neighbouring degrees so a slightly bent street still counts,
  // weighting the centre most, then refine to a length-weighted average.
  let best = 0;
  let bestWeight = -1;
  for (let d = 0; d < 90; d++) {
    let weight = 0;
    for (let k = -2; k <= 2; k++)
      weight += bins[(d + k + 90) % 90] * (3 - Math.abs(k));
    if (weight > bestWeight) {
      bestWeight = weight;
      best = d;
    }
  }
  let sum = 0;
  let mass = 0;
  for (let k = -2; k <= 2; k++) {
    sum += (best + k) * bins[(best + k + 90) % 90];
    mass += bins[(best + k + 90) % 90];
  }
  best = sum / mass;
  return best > 45 ? best - 90 : best;
}

function signedArea(ring: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** A convex ring grown outward by `margin` metres on every side. */
export function expandConvex(ring: readonly Vec2[], margin: number): Vec2[] {
  const sign = signedArea(ring) >= 0 ? 1 : -1;
  // Each edge shifted outward along its normal, as a point and a direction.
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const [nx, ny] = [(sign * dy) / length, (-sign * dx) / length];
    return { p: [a[0] + nx * margin, a[1] + ny * margin], d: [dx, dy] };
  });
  return edges.map((edge, i) => {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const cross = prev.d[0] * edge.d[1] - prev.d[1] * edge.d[0];
    if (Math.abs(cross) < 1e-9) return [edge.p[0], edge.p[1]];
    const t =
      ((edge.p[0] - prev.p[0]) * edge.d[1] -
        (edge.p[1] - prev.p[1]) * edge.d[0]) /
      cross;
    return [prev.p[0] + t * prev.d[0], prev.p[1] + t * prev.d[1]];
  });
}

/** The part of `subject` inside the convex ring `clip` (Sutherland–Hodgman). */
export function clipToConvex(
  subject: readonly Vec2[],
  clip: readonly Vec2[],
): Vec2[] {
  const sign = signedArea(clip) >= 0 ? 1 : -1;
  let output: Vec2[] = [...subject];
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p: Vec2) =>
      sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j - 1 + input.length) % input.length];
      const sc = side(current);
      const sp = side(previous);
      if (sc >= 0 !== sp >= 0) {
        const t = sp / (sp - sc);
        output.push([
          previous[0] + t * (current[0] - previous[0]),
          previous[1] + t * (current[1] - previous[1]),
        ]);
      }
      if (sc >= 0) output.push(current);
    }
  }
  return output;
}

/**
 * The outlines a new selection should take on so its edge does not slice
 * things in two. Buildings and components cut by the edge are taken whole;
 * open ground (grass, parks) is taken up to `margin` metres past the edge,
 * so a sliver is included without swallowing a whole park.
 */
export function fitEdges(
  selection: Vec2[],
  whole: Vec2[][],
  ground: Vec2[][],
  margin = 20,
): Vec2[][] {
  const reach = expandConvex(selection, margin);
  const bands = cutByEdge(selection, ground)
    .map((ring) => clipToConvex(ring, reach))
    .filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 1);
  return [...cutByEdge(selection, whole), ...bands];
}

function distanceToSegment([px, py]: Vec2, [ax, ay]: Vec2, [bx, by]: Vec2) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

/** Distance from a point to a ring's area: zero inside it. */
function distanceToRing(point: Vec2, ring: readonly Vec2[]): number {
  if (pointInRing(point, ring as Vec2[])) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(
      best,
      distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]),
    );
  }
  return best;
}

function distanceToRings(point: Vec2, rings: readonly Vec2[][]): number {
  return Math.min(...rings.map((ring) => distanceToRing(point, ring)));
}

/** Points every `step` metres around a ring, corners included. */
function perimeter(ring: readonly Vec2[], step: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step),
    );
    for (let k = 0; k < n; k++)
      points.push([
        a[0] + ((b[0] - a[0]) * k) / n,
        a[1] + ((b[1] - a[1]) * k) / n,
      ]);
  }
  return points;
}

/** Convex hull (monotone chain); fewer than three points give no ring. */
function hull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return [];
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      )
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const ring = [...half(sorted), ...half([...sorted].reverse())];
  return ring.length >= 3 ? ring : [];
}

const SAMPLE_STEP_M = 2;

/**
 * The strip that joins two sets of rings across a gap of at most `gap`
 * metres: the hull of every edge point on either side within `gap` of the
 * other. For two blocks across a street, that is the street between them.
 */
function bridge(a: Vec2[][], b: Vec2[][], gap: number): Vec2[] {
  const near = [
    ...a
      .flatMap((ring) => perimeter(ring, SAMPLE_STEP_M))
      .filter((p) => distanceToRings(p, b) <= gap),
    ...b
      .flatMap((ring) => perimeter(ring, SAMPLE_STEP_M))
      .filter((p) => distanceToRings(p, a) <= gap),
  ];
  return hull(near);
}

function gapBetween(a: Vec2[][], b: Vec2[][]): number {
  let best = Infinity;
  for (const ring of a)
    for (const p of perimeter(ring, SAMPLE_STEP_M))
      best = Math.min(best, distanceToRings(p, b));
  for (const ring of b)
    for (const p of perimeter(ring, SAMPLE_STEP_M))
      best = Math.min(best, distanceToRings(p, a));
  return best;
}

/** Roughly one arterial road, kerb to kerb, plus sidewalk. */
export const MERGE_GAP_M = 35;

/**
 * Add `added` to `areas`, merging it with every area that overlaps it or
 * lies within `gap` metres (one road apart). Merged areas become a single
 * section, with the gaps between them filled in.
 */
export function addArea(
  areas: readonly EditArea[],
  added: EditArea,
  gap = MERGE_GAP_M,
): EditArea[] {
  let rings = added.rings;
  let rest = [...areas];
  for (let merged = true; merged;) {
    merged = false;
    for (const area of rest) {
      if (gapBetween(rings, area.rings) > gap) continue;
      const strip = bridge(rings, area.rings, gap);
      rings = [...rings, ...area.rings, ...(strip.length ? [strip] : [])];
      rest = rest.filter((other) => other !== area);
      merged = true;
      break;
    }
  }
  return [...rest, { id: added.id, rings }];
}
