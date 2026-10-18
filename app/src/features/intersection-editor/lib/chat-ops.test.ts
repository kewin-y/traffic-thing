import { expect, test } from "vitest";
import { emptyProjectState } from "../../../../shared/projects";
import { applyChatOps, applyChatOpsToCurrent, type ChatOp } from "./chat-ops";

const area: ChatOp = {
  type: "select_area",
  rings: [
    [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ],
  ],
};
const bench: ChatOp = {
  type: "place_component",
  id: "bench-a",
  kind: "bench",
  x: 0,
  y: 0,
  rotation: 90,
};

test("a batch opens an area, places and deletes using stable tool IDs", () => {
  const initial = emptyProjectState();
  const placed = applyChatOps(initial, [area, bench]);
  expect(placed.scene[0]).toMatchObject({
    id: "bench-a",
    kind: "bench",
    rotation: 90,
  });
  expect(initial.scene).toEqual([]);
  expect(initial.areas).toEqual([]);
  const deleted = applyChatOps(initial, [
    area,
    bench,
    { type: "delete_component", id: "bench-a" },
  ]);
  expect(deleted.scene).toEqual([]);
  expect(deleted.areas).toHaveLength(1);
});

test("invalid or read-only edits reject the entire batch without changing the source", () => {
  const initial = emptyProjectState();
  expect(() => applyChatOps(initial, [bench])).toThrow("editable area");
  expect(() =>
    applyChatOps(initial, [area, bench, { ...bench, x: 200 }]),
  ).toThrow();
  expect(() => applyChatOps(initial, [{ ...bench, x: Infinity }])).toThrow();
  expect(initial.areas).toEqual([]);
  expect(initial.scene).toEqual([]);
});

test("sidewalk rules apply to assistant edits and imported deletions retain tombstones", () => {
  const state = applyChatOps(emptyProjectState(), [area]);
  state.scene.push({
    id: "sidewalk",
    kind: "sidewalk",
    x: 0,
    y: 0,
    rotation: 0,
    width: 4,
    length: 30,
  });
  expect(() => applyChatOps(state, [{ ...bench, kind: "road" }])).toThrow(
    "overlap sidewalks",
  );
  state.scene.push({
    id: "imported",
    kind: "building",
    x: 50,
    y: 50,
    rotation: 0,
    osmId: 123,
  });
  const deleted = applyChatOps(state, [
    { type: "delete_component", id: "imported" },
  ]);
  expect(deleted.scene.find((c) => c.id === "imported")).toMatchObject({
    kind: "removed_osm",
    osmId: 123,
  });
});

test("in-flight map changes are protected, while camera changes do not discard edits", () => {
  const base = emptyProjectState();
  const changed = applyChatOps(base, [area, bench]);
  expect(() => applyChatOpsToCurrent(base, changed, [area])).toThrow(
    "map changed",
  );
  const panned = { ...base, camera: { ...base.camera, zoom: 18 } };
  const result = applyChatOpsToCurrent(base, panned, [area, bench]);
  expect(result.camera.zoom).toBe(18);
  expect(result.scene).toHaveLength(1);
});
