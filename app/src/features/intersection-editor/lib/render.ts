import type { FeatureCollection, Polygon } from "geojson";
import { componentParts, type Part, type SceneComponent } from "./components";
import { toLngLat } from "./geometry";

export interface FeatureProps {
  cid: string;
  colour: string;
  base: number;
  height: number;
}

export type SceneLayers = Record<
  Part["layer"],
  FeatureCollection<Polygon, FeatureProps>
>;

/** Split the scene into the flat ground, paint and extruded MapLibre sources. */
export function renderScene(
  scene: SceneComponent[],
  scales: ReadonlyMap<string, number>,
): SceneLayers {
  const layers: SceneLayers = {
    ground: { type: "FeatureCollection", features: [] },
    marking: { type: "FeatureCollection", features: [] },
    solid: { type: "FeatureCollection", features: [] },
  };
  for (const c of scene) {
    for (const part of componentParts(c, scales.get(c.id) ?? 1)) {
      const ring = part.ring.map(toLngLat);
      layers[part.layer].features.push({
        type: "Feature",
        properties: {
          cid: c.id,
          colour: part.colour,
          base: part.base ?? 0,
          height: part.height ?? 0,
        },
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      });
    }
  }
  return layers;
}
