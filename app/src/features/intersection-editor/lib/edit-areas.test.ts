import { afterEach, expect, test, vi } from "vitest";
import type { Vec2 } from "./geometry";
import {
  addArea,
  clipToConvex,
  cutByEdge,
  dominantBearing,
  EDIT_AREAS_STORAGE_KEY,
  expandConvex,
  fitEdges,
  holeMask,
  isEditable,
  loadEditAreas,
  unionPath,
  type EditArea,
} from "./edit-areas";

afterEach(() => vi.unstubAllGlobals());

const square = (x: number, y: number, size: number): Vec2[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

function stored(value: unknown) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === EDIT_AREAS_STORAGE_KEY ? JSON.stringify(value) : null,
  });
}

test("nothing is editable until an area is selected", () => {
  expect(isEditable([], [0, 0])).toBe(false);
});

test("separate and overlapping areas are all editable", () => {
  const areas: EditArea[] = [
    { id: "a", rings: [square(0, 0, 10)] },
    { id: "b", rings: [square(5, 5, 10)] },
    { id: "c", rings: [square(100, 100, 10)] },
  ];
  expect(isEditable(areas, [2, 2])).toBe(true);
  expect(isEditable(areas, [7, 7])).toBe(true); // inside both a and b
  expect(isEditable(areas, [12, 12])).toBe(true);
  expect(isEditable(areas, [105, 105])).toBe(true);
  expect(isEditable(areas, [50, 50])).toBe(false);
});

test("a footprint snapped onto an area is editable beyond the rectangle", () => {
  const areas: EditArea[] = [
    { id: "a", rings: [square(0, 0, 10), square(8, 8, 6)] },
  ];
  expect(isEditable(areas, [13, 13])).toBe(true);
});

test("saved areas load, including the older single-ring shape", () => {
  const good = { id: "a", rings: [square(0, 0, 10)] };
  stored([
    good,
    { id: "old", ring: square(20, 20, 5) },
    { id: "b", rings: [[[0, 0]]] },
    null,
  ]);
  expect(loadEditAreas()).toEqual([
    good,
    { id: "old", rings: [square(20, 20, 5)] },
  ]);
});

test("corrupt storage leaves the whole map read-only", () => {
  vi.stubGlobal("localStorage", { getItem: () => "{broken" });
  expect(loadEditAreas()).toEqual([]);
});

test("only outlines the selection's edge cuts through are snapped on", () => {
  const selection = square(0, 0, 10);
  const straddling = square(8, 2, 4);
  const inside = square(2, 2, 3);
  const outside = square(20, 20, 3);
  expect(cutByEdge(selection, [straddling, inside, outside])).toEqual([
    straddling,
  ]);
});

test("rings are wound the same way so overlaps merge", () => {
  const clockwise: [number, number][] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];
  const anticlockwise = [...clockwise].reverse();
  const path = unionPath([clockwise, anticlockwise]);
  const [first, second] = path.split("M").filter(Boolean);
  expect(first).toBe(second);
});

test("the mask cuts one hole per ring", () => {
  const mask = decodeURIComponent(
    holeMask(200, 100, [
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      [
        [50, 50],
        [60, 50],
        [60, 60],
      ],
    ]),
  );
  expect(mask).toContain('width="200" height="100"');
  expect(mask.match(/M/g)).toHaveLength(2);
});

test("bird's-eye bearing follows the local street grid", () => {
  // Streets running 20° east of north and their perpendicular cross streets.
  const along = (deg: number, length: number) => {
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos((43.65 * Math.PI) / 180);
    return [
      [-79.4, 43.65],
      [-79.4 + (Math.sin(r) * length) / cos, 43.65 + Math.cos(r) * length],
    ];
  };
  const bearing = dominantBearing([
    along(20, 0.01),
    along(110, 0.006),
    along(200, 0.004),
    along(63, 0.001), // a short diagonal lane should not win
  ]);
  expect(bearing).toBeCloseTo(20, 0);
  expect(dominantBearing([along(-16.7, 0.01)])).toBeCloseTo(-17, 0);
  expect(dominantBearing([])).toBeNull();
});

test("an outline crossing a thin selection with no corner inside is cut", () => {
  const thin: Vec2[] = [
    [0, 0],
    [2, 0],
    [2, 10],
    [0, 10],
  ];
  const long: Vec2[] = [
    [-5, 4],
    [7, 4],
    [7, 6],
    [-5, 6],
  ];
  expect(cutByEdge(thin, [long])).toEqual([long]);
});

test("expanding a square moves every side out by the margin", () => {
  const grown = expandConvex(square(0, 0, 10), 2);
  const xs = grown.map((p) => p[0]);
  const ys = grown.map((p) => p[1]);
  expect(Math.min(...xs)).toBeCloseTo(-2);
  expect(Math.max(...xs)).toBeCloseTo(12);
  expect(Math.min(...ys)).toBeCloseTo(-2);
  expect(Math.max(...ys)).toBeCloseTo(12);
  // Winding does not matter.
  const reversed = expandConvex([...square(0, 0, 10)].reverse(), 2);
  expect(Math.min(...reversed.map((p) => p[0]))).toBeCloseTo(-2);
});

test("clipping keeps only the part inside the convex ring", () => {
  const clipped = clipToConvex(square(5, 5, 10), square(0, 0, 10));
  const xs = clipped.map((p) => p[0]);
  const ys = clipped.map((p) => p[1]);
  expect(Math.min(...xs)).toBeCloseTo(5);
  expect(Math.max(...xs)).toBeCloseTo(10);
  expect(Math.min(...ys)).toBeCloseTo(5);
  expect(Math.max(...ys)).toBeCloseTo(10);
});

test("grass cut by the edge is included up to the margin, buildings whole", () => {
  const selection = square(0, 0, 100);
  // A grass strip from inside the selection to 15 m past its right edge.
  const strip = square(90, 40, 25);
  // A park reaching 500 m beyond the edge.
  const park: Vec2[] = [
    [50, 0],
    [600, 0],
    [600, 30],
    [50, 30],
  ];
  const building = square(95, 70, 20);
  const rings = fitEdges(selection, [building], [strip, park]);
  expect(rings[0]).toEqual(building);
  const [stripBand, parkBand] = rings.slice(1);
  expect(Math.max(...stripBand.map((p) => p[0]))).toBeCloseTo(115);
  expect(Math.max(...parkBand.map((p) => p[0]))).toBeCloseTo(120);
  // Inside the band, the grass is editable.
  expect(
    isEditable([{ id: "a", rings: [selection, ...rings] }], [110, 50]),
  ).toBe(true);
});

test("sections one road apart merge into one, with the road filled in", () => {
  const west = { id: "west", rings: [square(0, 0, 100)] };
  const far = { id: "far", rings: [square(500, 500, 50)] };
  // 25 m east of the west block: a street apart.
  const east = { id: "east", rings: [square(125, 0, 100)] };
  const areas = addArea([west, far], east);
  expect(areas.map((a) => a.id)).toEqual(["far", "east"]);
  const merged = areas[1];
  // The street between the blocks is now part of the section.
  expect(isEditable([merged], [112, 50])).toBe(true);
  // But nothing beyond the facing edges was filled in.
  expect(isEditable([merged], [112, 120])).toBe(false);
});

test("sections further apart than a road stay separate", () => {
  const a = { id: "a", rings: [square(0, 0, 100)] };
  const b = { id: "b", rings: [square(160, 0, 100)] };
  const areas = addArea([a], b);
  expect(areas).toHaveLength(2);
  expect(isEditable(areas, [130, 50])).toBe(false);
});

test("a new section can join two existing ones on either side", () => {
  const left = { id: "left", rings: [square(0, 0, 100)] };
  const right = { id: "right", rings: [square(240, 0, 100)] };
  const middle = { id: "middle", rings: [square(120, 0, 100)] };
  const areas = addArea([left, right], middle);
  expect(areas).toHaveLength(1);
  expect(isEditable(areas, [110, 50])).toBe(true);
  expect(isEditable(areas, [230, 50])).toBe(true);
});

test("offset blocks are only joined along the stretch where they face", () => {
  const a = { id: "a", rings: [square(0, 0, 100)] };
  const b = { id: "b", rings: [square(120, 50, 100)] };
  const [merged] = addArea([a], b);
  expect(isEditable([merged], [110, 75])).toBe(true);
  expect(isEditable([merged], [110, 10])).toBe(false);
});
