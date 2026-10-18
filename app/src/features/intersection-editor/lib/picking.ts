import type { Geometry } from "geojson";
import type { SceneComponent } from "./components";
import { buildingAtRay, type BasemapFeature, type PointerRay } from "./osm";
import {
  CONTROL_ICONS_LAYER,
  SPEED_LIMITS_LAYER,
  SCENE_CONTROL_LAYER,
} from "./traffic-controls";
import { NETWORK_LAYER } from "./network";

export const PICK_LAYERS = [
  SCENE_CONTROL_LAYER,
  CONTROL_ICONS_LAYER,
  SPEED_LIMITS_LAYER,
  "solid",
  "marking",
  "ground",
  "osm-buildings",
  "osm-remainder",
  NETWORK_LAYER,
];
export interface RenderedHit {
  layer: { id: string; type: string };
  geometry: Geometry;
  properties: Record<string, unknown> | null;
  id?: string | number;
}
export type MapPick =
  | { kind: "component"; id: string }
  | { kind: "control"; feature: RenderedHit }
  | { kind: "road"; edgeId: string }
  | { kind: "building"; feature: BasemapFeature };

/** Preserve MapLibre's visible layer/depth order across every selectable type. */
export function resolveMapPick(
  hits: RenderedHit[],
  scene: SceneComponent[],
  ray: PointerRay,
): MapPick | null {
  for (const hit of hits) {
    const properties = hit.properties ?? {};
    if (
      [SCENE_CONTROL_LAYER, "solid", "marking", "ground"].includes(hit.layer.id)
    ) {
      const component = scene.find((c) => c.id === properties.cid);
      if (component && component.kind !== "removed_osm")
        return { kind: "component", id: component.id };
    } else if (
      [CONTROL_ICONS_LAYER, SPEED_LIMITS_LAYER].includes(hit.layer.id)
    ) {
      if (typeof properties.ref !== "string") continue;
      const override = scene.find((c) => c.osmId === properties.ref);
      // A source still finishing a redraw must not select its moved/deleted override elsewhere.
      if (override) continue;
      return { kind: "control", feature: hit };
    } else if (hit.layer.id === NETWORK_LAYER) {
      if (typeof properties.edge_id === "string")
        return { kind: "road", edgeId: properties.edge_id };
    } else if (["osm-buildings", "osm-remainder"].includes(hit.layer.id)) {
      const feature: BasemapFeature = {
        id:
          hit.layer.id === "osm-remainder"
            ? (properties.osmId as string | number | undefined)
            : hit.id,
        geometry: hit.geometry,
        properties,
        layer: "building",
      };
      const intersection = buildingAtRay(feature, ray);
      if (!intersection) continue;
      const ring = intersection.ring;
      const origin = [0, 1].map(
        (axis) =>
          Math.round(
            (ring.reduce((sum, point) => sum + point[axis], 0) / ring.length) *
              10,
          ) / 10,
      );
      const overridden = scene.some(
        (component) =>
          component.footprint &&
          component.osmId === feature.id &&
          (component.osmAt ?? [component.x, component.y]).every(
            (value, axis) => Math.abs(value - origin[axis]) < 0.15,
          ),
      );
      if (!overridden) return { kind: "building", feature };
    }
  }
  return null;
}
