import { afterEach, expect, test, vi } from "vitest";
import { loadEditorScene, SCENE_STORAGE_KEY } from "./scene-storage";

afterEach(() => vi.unstubAllGlobals());

// Ids the retired demo used across its versions; none come from newId.
const demo = [
  "intersection",
  "car_lane-north-a",
  "sidewalk-corner-11",
  "tree-yard-11-3",
  "speed_sign-north",
  "streetcar-west",
].map((id) => ({ id, kind: "tree", x: 0, y: 0, rotation: 0 }));

function storage(items: Record<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items[key] ?? null,
  });
}

test("new scenes start empty", () => {
  storage({});
  expect(loadEditorScene()).toEqual([]);
});

test("legacy demo is removed while user-added objects and the old save survive", () => {
  const custom = {
    id: "tree-1a2b3c4d",
    kind: "tree",
    x: 10,
    y: 10,
    rotation: 0,
  };
  const legacy = JSON.stringify([...demo, custom]);
  const items = { "traffic-thing:intersection-scene:v2": legacy };
  storage(items);
  expect(loadEditorScene()).toEqual([custom]);
  expect(items["traffic-thing:intersection-scene:v2"]).toBe(legacy);
});

test("an intentionally empty current scene does not restore the old demo", () => {
  storage({
    [SCENE_STORAGE_KEY]: "[]",
    "traffic-thing:intersection-scene:v2": JSON.stringify(demo),
  });
  expect(loadEditorScene()).toEqual([]);
});

test("demo leftovers already carried into the current save are removed", () => {
  const custom = {
    id: "bench-9f8e7d6c",
    kind: "bench",
    x: 4,
    y: 2,
    rotation: 0,
  };
  storage({ [SCENE_STORAGE_KEY]: JSON.stringify([...demo, custom]) });
  expect(loadEditorScene()).toEqual([custom]);
});

test("deleted map buildings saved without an outline reappear", () => {
  const placeholder = {
    id: "building-0a1b2c3d",
    kind: "removed_osm",
    x: 0,
    y: 0,
    rotation: 0,
    osmId: 2152,
  };
  const kept = { ...placeholder, id: "building-4e5f6a7b", footprint: [[0, 0]] };
  storage({ [SCENE_STORAGE_KEY]: JSON.stringify([placeholder, kept]) });
  expect(loadEditorScene()).toEqual([kept]);
});

test("unavailable or corrupt storage does not prevent opening the map", () => {
  storage({ [SCENE_STORAGE_KEY]: "{broken" });
  expect(loadEditorScene()).toEqual([]);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Storage blocked");
    },
  });
  expect(loadEditorScene()).toEqual([]);
});
