import type {
  Feature,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import type { SceneComponent } from "./components";
import { pointInRing, toLocal, type Vec2 } from "./geometry";
import { newId } from "./scene";
import { intersectBuilding } from "./ray-picking";

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

/** The pointer's ray into the scene, used to tell merged buildings apart. */
export interface PointerRay {
  /** Where the ray meets the ground, in local metres. */
  ground: Vec2;
  /** The camera's position over the ground, in local metres. */
  camera: Vec2;
  /** The camera's height above the ground, in metres. */
  altitude: number;
}

function centroid(points: Vec2[]): Vec2 {
  return [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
  ];
}

/** Resolve only the polygon actually intersected by the pointer. */
export function buildingAtRay(feature: BasemapFeature, ray: PointerRay) {
  const geometry = feature.geometry;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const local = polygons.map((polygon) =>
    polygon.map((ring) => {
      const last = ring[ring.length - 1];
      const open =
        ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1]
          ? ring.slice(0, -1)
          : ring;
      return open.map(([lng, lat]) => toLocal(lng, lat));
    }),
  );
  const height = Number(feature.properties.render_height ?? 10);
  const base = Number(feature.properties.render_min_height ?? 0);
  return intersectBuilding(local, ray, height, base);
}

/** A converted or deleted basemap building, as it stood in the basemap. */
export interface HiddenBuilding {
  osmId: string | number;
  /** Absolute outline in local metres. */
  outline: Vec2[];
}

/**
 * The buildings that share a basemap feature with hidden ones but were not
 * themselves converted or deleted. The whole feature is hidden in the basemap,
 * so these are drawn separately to keep them on the map.
 */
export function remainingBuildings(
  features: Feature[],
  hidden: HiddenBuilding[],
): Feature<Polygon>[] {
  const result: Feature<Polygon>[] = [];
  for (const feature of features) {
    const geometry = feature.geometry as Polygon | MultiPolygon;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    const own = hidden.filter((h) => h.osmId === feature.id);
    for (const coordinates of polygons) {
      const outer = coordinates[0];
      if (!outer || outer.length < 4) continue;
      const middle = centroid(
        outer.slice(0, -1).map(([lng, lat]) => toLocal(lng, lat)),
      );
      if (own.some((h) => pointInRing(middle, h.outline))) continue;
      result.push({
        type: "Feature",
        properties: { ...feature.properties, osmId: feature.id },
        geometry: { type: "Polygon", coordinates },
      });
    }
  }
  return result;
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
  ray: PointerRay,
): SceneComponent | null {
  if (feature.layer === "building") {
    const height = Number(feature.properties.render_height ?? 10) || 10;
    const ring = buildingAtRay(feature, ray)?.ring;
    if (!ring || ring.length < 3) return null;
    const { x, y, relative } = centred(ring);
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
      osmAt: [x, y],
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
