import type { Geometry, Position } from "geojson";
import type { SceneComponent } from "./components";
import { toLocal, type Vec2 } from "./geometry";
import { newId } from "./scene";

// Approximate carriageway widths by OpenMapTiles `class`.
const ROAD_WIDTHS: Record<string, number> = {
  motorway: 14,
  trunk: 13,
  primary: 12,
  secondary: 10,
  tertiary: 9,
  minor: 7,
  service: 5,
};

export interface BasemapFeature {
  id?: string | number;
  geometry: Geometry;
  properties: Record<string, unknown>;
  layer: "building" | "road";
}

function largestRing(geometry: Geometry): Position[] | null {
  const rings =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0]]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates.map((polygon) => polygon[0])
        : [];
  let best: Position[] | null = null;
  let bestArea = 0;
  for (const ring of rings) {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      area += x1 * y2 - x2 * y1;
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area);
      best = ring;
    }
  }
  return best;
}

function longestLine(geometry: Geometry): Position[] | null {
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  return lines.reduce<Position[] | null>(
    (best, line) => (!best || line.length > best.length ? line : best),
    null,
  );
}

/** Relative coordinates around the points' centroid. */
function centred(points: Vec2[]): { x: number; y: number; relative: Vec2[] } {
  const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const y = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    x: round(x),
    y: round(y),
    relative: points.map(([px, py]) => [round(px - x), round(py - y)]),
  };
}

/**
 * Turn a basemap building or road into an editable component. Geometry from
 * vector tiles is clipped at tile edges, so very large features may be partial.
 */
export function componentFromBasemap(
  feature: BasemapFeature,
): SceneComponent | null {
  if (feature.layer === "building") {
    const ring = largestRing(feature.geometry);
    if (!ring || ring.length < 4) return null;
    // Drop the closing point; parts close rings themselves.
    const local = ring.slice(0, -1).map(([lng, lat]) => toLocal(lng, lat));
    const { x, y, relative } = centred(local);
    const height = Number(feature.properties.render_height ?? 10) || 10;
    return {
      id: newId("building"),
      kind: "building",
      x,
      y,
      rotation: 0,
      height: Math.round(height),
      colour: "#e6dccf",
      footprint: relative,
      osmId: feature.id,
    };
  }
  const line = longestLine(feature.geometry);
  if (!line || line.length < 2) return null;
  const local = line.map(([lng, lat]) => toLocal(lng, lat));
  const { x, y, relative } = centred(local);
  const roadClass = String(feature.properties.class ?? "minor");
  return {
    id: newId("road"),
    kind: "road",
    x,
    y,
    rotation: 0,
    width: ROAD_WIDTHS[roadClass] ?? 7,
    path: relative,
    osmId: feature.id,
  };
}
