import { expect, test } from "vitest";
import { resolveMapPick, type RenderedHit } from "./picking";
import { toLngLat, type Vec2 } from "./geometry";
import type { SceneComponent } from "./components";
import { CONTROL_ICONS_LAYER, SCENE_CONTROL_LAYER } from "./traffic-controls";
import { NETWORK_LAYER } from "./network";
const ray = { camera: [0, 0] as Vec2, ground: [0, 0] as Vec2, altitude: 100 };
const component: SceneComponent = {
  id: "lane",
  kind: "road",
  x: 0,
  y: 0,
  rotation: 0,
};
function hit(layer: string, properties: Record<string, unknown>): RenderedHit {
  return {
    layer: { id: layer, type: "symbol" },
    geometry: { type: "Point", coordinates: toLngLat([0, 0]) },
    properties,
  };
}
function building(): RenderedHit {
  const ring: Vec2[] = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
    [-5, -5],
  ];
  return {
    id: 42,
    layer: { id: "osm-buildings", type: "fill-extrusion" },
    geometry: { type: "Polygon", coordinates: [ring.map(toLngLat)] },
    properties: { render_height: 20 },
  };
}

test("a visible reference icon wins over the road underneath it", () => {
  const icon = hit(CONTROL_ICONS_LAYER, {
    ref: "node/1",
    kind: "traffic_light",
  });
  expect(
    resolveMapPick([icon, hit("ground", { cid: "lane" })], [component], ray),
  ).toEqual({ kind: "control", feature: icon });
});

test("a nearer building blocks selection of scene ground behind it", () => {
  expect(
    resolveMapPick(
      [building(), hit("ground", { cid: "lane" })],
      [component],
      ray,
    )?.kind,
  ).toBe("building");
});

test("empty hits and a missed merged building do not select anything", () => {
  expect(resolveMapPick([], [], ray)).toBeNull();
  expect(
    resolveMapPick([building()], [], {
      ...ray,
      camera: [50, 50],
      ground: [50, 50],
    }),
  ).toBeNull();
});

test("stale scene/control hits cannot select deleted or moved objects elsewhere", () => {
  expect(resolveMapPick([hit("solid", { cid: "gone" })], [], ray)).toBeNull();
  const moved: SceneComponent = {
    ...component,
    id: "signal",
    kind: "traffic_light",
    osmId: "node/1",
    x: 500,
  };
  expect(
    resolveMapPick([hit(CONTROL_ICONS_LAYER, { ref: "node/1" })], [moved], ray),
  ).toBeNull();
  expect(
    resolveMapPick([hit(SCENE_CONTROL_LAYER, { cid: "signal" })], [moved], ray),
  ).toEqual({ kind: "component", id: "signal" });
  expect(
    resolveMapPick(
      [hit(SCENE_CONTROL_LAYER, { cid: "signal" })],
      [{ ...moved, kind: "removed_osm" }],
      ray,
    ),
  ).toBeNull();
});

test("an actually rendered imported road keeps its network identity", () => {
  expect(
    resolveMapPick([hit(NETWORK_LAYER, { edge_id: "edge-42" })], [], ray),
  ).toEqual({ kind: "road", edgeId: "edge-42" });
});

test("a stale basemap building cannot select a moved override somewhere else", () => {
  const moved: SceneComponent = {
    ...component,
    id: "building-moved",
    kind: "building",
    osmId: 42,
    x: 500,
    y: 500,
    osmAt: [0, 0],
    footprint: [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
  };
  expect(resolveMapPick([building()], [moved], ray)).toBeNull();
  expect(
    resolveMapPick([building()], [{ ...moved, kind: "removed_osm" }], ray),
  ).toBeNull();
  // Another footprint sharing the tile feature's ID must remain selectable.
  expect(
    resolveMapPick([building()], [{ ...moved, osmAt: [50, 50] }], ray)?.kind,
  ).toBe("building");
});
