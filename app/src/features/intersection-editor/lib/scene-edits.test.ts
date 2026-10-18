import { expect, test } from "vitest";
import { componentFromControl, resolveControl } from "./traffic-controls";
import { removeSceneComponent, updateSceneComponent } from "./scene-edits";
import { componentFromDrop } from "./scene";
import type { SceneComponent } from "./components";

const at = { lng: -79.4003, lat: 43.6578 };
const props = { kind: "traffic_light", ref: "node/2", heading: 0 } as const;

test("repeated inspection leaves the project unchanged and resolves the same map feature", () => {
  const scene: SceneComponent[] = [];
  const first = resolveControl(scene, props, at);
  const second = resolveControl(scene, props, at);
  expect(second).toEqual(first);
  expect(scene).toEqual([]);
  expect(first.x).toBe(0);
  expect(first.y).toBe(0);
});

test("editing an inspected feature creates one override and stale reference clicks reuse it", () => {
  const inspected = resolveControl([], props, at);
  const scene = updateSceneComponent([], inspected, { rotation: 90 });
  expect(scene).toHaveLength(1);
  // Resolving the reference again must retain the edited value and position.
  const reopened = resolveControl(scene, props, at);
  expect(reopened).toBe(scene[0]);
  expect(reopened.rotation).toBe(90);
  const moved = updateSceneComponent(scene, inspected, { x: 20, y: 10 });
  expect(moved).toHaveLength(1);
  expect(resolveControl(moved, props, at)).toMatchObject({
    x: 20,
    y: 10,
    rotation: 90,
  });
});

test("source identity also reuses older overrides with randomly generated IDs", () => {
  const old = {
    ...componentFromControl(props, at),
    id: "traffic_light-12345678",
    rotation: 15,
  };
  expect(resolveControl([old], props, at)).toBe(old);
  const scene = updateSceneComponent([old], componentFromControl(props, at), {
    rotation: 45,
  });
  expect(scene).toHaveLength(1);
  expect(scene[0]).toMatchObject({ id: old.id, rotation: 45 });
});

test("repeated speed-limit icons on one road edit the same source feature", () => {
  const limit = { kind: "speed_limit", ref: "way/4", speedKmh: 40 } as const;
  const first = resolveControl([], limit, at);
  const edited = updateSceneComponent([], first, { speedKmh: 30 });
  const otherIcon = resolveControl(edited, limit, {
    lng: at.lng + 0.001,
    lat: at.lat,
  });
  expect(otherIcon).toBe(edited[0]);
  expect(otherIcon.speedKmh).toBe(30);
  expect(
    updateSceneComponent(edited, otherIcon, { speedKmh: 50 }),
  ).toHaveLength(1);
});

test("deleting an unedited map feature leaves one tombstone and stale clicks do not resurrect it", () => {
  const original = resolveControl([], props, at);
  const scene = removeSceneComponent([], original);
  expect(scene).toHaveLength(1);
  expect(scene[0]).toMatchObject({ kind: "removed_osm", osmId: props.ref });
  expect(resolveControl(scene, props, at)).toBe(scene[0]);
  expect(updateSceneComponent(scene, original, { rotation: 15 })).toBe(scene);
  expect(removeSceneComponent(scene, original)).toHaveLength(1);
});

test("toolbox additions remain separate objects alongside edited map features", () => {
  const original = resolveControl([], props, at);
  const placed = componentFromDrop("traffic_light", 10, 10);
  const scene = updateSceneComponent([placed], original, { rotation: 15 });
  expect(scene).toHaveLength(2);
  expect(placed.osmId).toBeUndefined();
  expect(resolveControl(scene, props, at)).toBe(scene[1]);
  expect(removeSceneComponent(scene, placed)).toEqual([scene[1]]);
});

test("editing or deleting a source collapses duplicates left by the old click behavior", () => {
  const original = componentFromControl(props, at);
  const duplicate = { ...original, id: "traffic_light-87654321" };
  const edited = updateSceneComponent([original, duplicate], original, {
    rotation: 90,
  });
  expect(edited).toHaveLength(1);
  expect(edited[0].rotation).toBe(90);
  expect(removeSceneComponent([original, duplicate], original)).toEqual([
    expect.objectContaining({ kind: "removed_osm", osmId: props.ref }),
  ]);
});

test("separate buildings merged into the same tile feature remain independently editable", () => {
  const footprint: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const first: SceneComponent = {
    id: "building-a",
    kind: "building",
    x: 0,
    y: 0,
    rotation: 0,
    osmId: 42,
    osmAt: [0, 0],
    footprint,
  };
  const second: SceneComponent = {
    ...first,
    id: "building-b",
    x: 20,
    osmAt: [20, 0],
  };
  const edited = updateSceneComponent([first, second], second, { height: 30 });
  expect(edited).toHaveLength(2);
  expect(edited[0]).toBe(first);
  expect(edited[1].height).toBe(30);
  const removed = removeSceneComponent(edited, second);
  expect(removed).toHaveLength(2);
  expect(removed[0]).toBe(first);
  expect(removed[1].kind).toBe("removed_osm");
});
