import { describe, expect, test } from "vitest";
import type { SceneComponent } from "./components";
import { snapComponent, snapTargets } from "./snap";

function road(over: Partial<SceneComponent> = {}): SceneComponent {
  return {
    id: "road-1",
    kind: "road",
    x: 0,
    y: 0,
    rotation: 0,
    length: 40,
    width: 6.6,
    ...over,
  };
}

describe("snapTargets", () => {
  test("collects vertices and edges from the scene, skipping the excluded id", () => {
    const a = road({ id: "a" });
    const b = road({ id: "b", x: 50 });
    const targets = snapTargets([a, b], "b");
    expect(targets.points.length).toBe(4);
    expect(targets.segments.length).toBe(4);
    expect(targets.points.every(([x]) => x <= 20)).toBe(true);
  });
});

describe("snapComponent", () => {
  test("extends a road end-to-end with the angle finished to match", () => {
    // Existing road spans x ∈ [−20, 20] at y = 0; the new one is dropped
    // slightly askew near its east end.
    const existing = road({ id: "a" });
    const dropped = road({ id: "b", x: 38, y: 1.5, rotation: 4 });
    const snapped = snapComponent(dropped, snapTargets([existing]), 3);
    expect(snapped.rotation).toBe(0);
    expect(snapped.x).toBeCloseTo(40, 1);
    expect(snapped.y).toBeCloseTo(0, 1);
    // West end now exactly meets the existing road's east end.
    const westEnd = snapped.x - snapped.length! / 2;
    expect(westEnd).toBeCloseTo(20, 1);
  });

  test("turns a roughly perpendicular drop into a flush T-junction", () => {
    const existing = road({ id: "a" });
    const dropped = road({ id: "b", x: 10, y: 15, rotation: 92 });
    const snapped = snapComponent(dropped, snapTargets([existing]), 3);
    expect(snapped.rotation).toBe(90);
    // South end sits flush on the existing road's south edge (y = −3.3),
    // the nearest edge to the drop.
    const southEnd = snapped.y - snapped.length! / 2;
    expect(southEnd).toBeCloseTo(-3.3, 1);
  });

  test("snaps an end flush onto a road's side edge without rotating", () => {
    const existing = road({ id: "a" });
    // Dropped at 30°: too far from the edge's bearing to align, so the
    // position snaps onto the side edge but the angle stays.
    const dropped = road({ id: "b", x: 12, y: 7, rotation: 30 });
    const snapped = snapComponent(dropped, snapTargets([existing]), 3);
    expect(snapped.rotation).toBe(30);
    expect(snapped.y).not.toBe(7);
  });

  test("ignores targets beyond the tolerance", () => {
    const existing = road({ id: "a" });
    const dropped = road({ id: "b", x: 30, y: 10 });
    const snapped = snapComponent(dropped, snapTargets([existing]), 3);
    expect(snapped).toEqual(dropped);
  });

  test("does not snap to itself while dragging", () => {
    const moved = road({ id: "a", x: 5, y: 5 });
    const snapped = snapComponent(moved, snapTargets([moved], "a"), 3);
    expect(snapped).toEqual(moved);
  });

  test("translation-only mode never changes rotation", () => {
    const existing = road({ id: "a" });
    const dropped = road({ id: "b", x: 38, y: 1.5, rotation: 4 });
    const snapped = snapComponent(dropped, snapTargets([existing]), 3, {
      rotate: false,
    });
    expect(snapped.rotation).toBe(4);
    // Still pulled flush to the existing road's east corners.
    expect(Math.abs(snapped.y)).toBeLessThan(1.5);
  });

  test("snaps a sidewalk to a building's footprint corner", () => {
    const building: SceneComponent = {
      id: "bldg-1",
      kind: "building",
      x: 0,
      y: 0,
      rotation: 0,
      length: 18,
      width: 16,
      height: 15,
    };
    const sidewalk = road({
      id: "walk-1",
      kind: "sidewalk",
      length: 20,
      width: 4,
      x: 14.6,
      y: 13.2,
      rotation: 2,
    });
    const snapped = snapComponent(sidewalk, snapTargets([building]), 3);
    // Its near corner finished its 2° skew and lies flush on the building's
    // top edge (y = 8), with no gap and no overlap.
    expect(snapped.rotation).toBe(0);
    expect(snapped.y - snapped.width! / 2).toBeCloseTo(8, 1);
  });
});
