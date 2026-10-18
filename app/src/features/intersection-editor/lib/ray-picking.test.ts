import { expect, test } from "vitest";
import { intersectBuilding } from "./ray-picking";
import { componentFromBasemap } from "./osm";
import { toLngLat, type Vec2 } from "./geometry";
const rect = (x: number, y: number, width: number, depth: number): Vec2[] => [
  [x, y],
  [x + width, y],
  [x + width, y + depth],
  [x, y + depth],
];
const down = (x: number, y: number) => ({
  camera: [x, y] as Vec2,
  ground: [x, y] as Vec2,
  altitude: 100,
});

test("a miss stays null for both a single building and a merged feature", () => {
  const a = rect(0, 0, 10, 10),
    b = rect(30, 0, 10, 10);
  expect(intersectBuilding([[a]], down(20, 5), 20)).toBeNull();
  expect(intersectBuilding([[a], [b]], down(20, 5), 20)).toBeNull();
  const coordinates = [a, b].map((ring) => [[...ring, ring[0]].map(toLngLat)]);
  expect(
    componentFromBasemap(
      {
        id: 1,
        layer: "building",
        properties: { render_height: 20 },
        geometry: { type: "MultiPolygon", coordinates },
      },
      down(20, 5),
    ),
  ).toBeNull();
});

test("roof picking selects only the polygon under the ray", () => {
  const a = rect(0, 0, 10, 10),
    b = rect(30, 0, 10, 10);
  expect(intersectBuilding([[a], [b]], down(35, 5), 20)?.ring).toBe(b);
});

test("slanted rays select the nearest wall instead of a ground-level building behind it", () => {
  const front = rect(18, -1, 2, 2),
    rear = rect(0, -1, 10, 2);
  const ray = {
    camera: [100, 0] as Vec2,
    ground: [0, 0] as Vec2,
    altitude: 100,
  };
  expect(intersectBuilding([[rear], [front]], ray, 30)?.ring).toBe(front);
});

test("thin walls between the old sample steps are still hit exactly", () => {
  const thin = rect(13.41, -1, 0.001, 2);
  expect(
    intersectBuilding(
      [[thin]],
      { camera: [100, 0], ground: [0, 0], altitude: 100 },
      30,
    )?.ring,
  ).toBe(thin);
});

test("courtyards and empty space below raised buildings do not hit", () => {
  const outer = rect(0, 0, 20, 20),
    hole = rect(5, 5, 10, 10);
  expect(intersectBuilding([[outer, hole]], down(10, 10), 20)).toBeNull();
  expect(intersectBuilding([[outer, hole]], down(2, 2), 20)?.ring).toBe(outer);
  expect(
    intersectBuilding(
      [[rect(0, -1, 5, 2)]],
      { camera: [100, 0], ground: [0, 0], altitude: 100 },
      30,
      10,
    ),
  ).toBeNull();
});

test("a ray can hit a courtyard wall and rejects invalid camera/height data", () => {
  const outer = rect(0, 0, 20, 20),
    hole = rect(5, 5, 10, 10);
  expect(
    intersectBuilding(
      [[outer, hole]],
      { camera: [100, 10], ground: [10, 10], altitude: 100 },
      20,
    ),
  ).not.toBeNull();
  expect(intersectBuilding([[outer]], down(2, 2), NaN)).toBeNull();
  expect(
    intersectBuilding([[outer]], { ...down(2, 2), altitude: 0 }, 20),
  ).toBeNull();
});

test("closing a GeoJSON ring does not shift the editable building's origin", () => {
  const ring = rect(-5, -5, 10, 10);
  const building = componentFromBasemap(
    {
      id: 42,
      layer: "building",
      properties: { render_height: 20 },
      geometry: {
        type: "Polygon",
        coordinates: [[...ring, ring[0]].map(toLngLat)],
      },
    },
    down(0, 0),
  );
  expect(building?.x).toBeCloseTo(0);
  expect(building?.y).toBeCloseTo(0);
  expect(building?.osmAt?.[0]).toBeCloseTo(0);
  expect(building?.osmAt?.[1]).toBeCloseTo(0);
  expect(building?.footprint).toHaveLength(4);
});
