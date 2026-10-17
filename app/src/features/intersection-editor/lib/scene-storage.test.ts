import { afterEach, expect, test, vi } from "vitest";
import { defaultScene } from "./scene";
import { loadEditorScene, SCENE_STORAGE_KEY } from "./scene-storage";

afterEach(() => vi.unstubAllGlobals());

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
  const custom = { id: "user-tree", kind: "tree", x: 10, y: 10, rotation: 0 };
  const legacy = JSON.stringify([...defaultScene(), custom]);
  const items = { "traffic-thing:intersection-scene:v2": legacy };
  storage(items);
  expect(loadEditorScene()).toEqual([custom]);
  expect(items["traffic-thing:intersection-scene:v2"]).toBe(legacy);
});

test("an intentionally empty current scene does not restore the old demo", () => {
  storage({
    [SCENE_STORAGE_KEY]: "[]",
    "traffic-thing:intersection-scene:v2": JSON.stringify(defaultScene()),
  });
  expect(loadEditorScene()).toEqual([]);
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
