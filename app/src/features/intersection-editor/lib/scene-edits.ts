import type { SceneComponent } from "./components";

/** Tile features can merge several buildings under one source ID. */
function sameComponent(a: SceneComponent, b: SceneComponent) {
  if (a.id === b.id) return true;
  if (a.osmId === undefined || a.osmId !== b.osmId) return false;
  if (!a.footprint && !b.footprint) return true;
  if (!a.footprint || !b.footprint) return false;
  const originA = a.osmAt ?? [a.x, a.y];
  const originB = b.osmAt ?? [b.x, b.y];
  return originA.every((value, i) => Math.abs(value - originB[i]) < 0.15);
}

/** A source object keeps one editable override, even across stale hits. */
export function findSceneComponent(
  scene: SceneComponent[],
  component: SceneComponent,
) {
  return scene.find((item) => sameComponent(item, component));
}

export function updateSceneComponent(
  scene: SceneComponent[],
  component: SceneComponent,
  patch: Partial<SceneComponent>,
) {
  const existing = findSceneComponent(scene, component);
  if (existing?.kind === "removed_osm") return scene;
  const updated = { ...(existing ?? component), ...patch };
  return existing
    ? scene.flatMap((item) =>
        item === existing
          ? [updated]
          : sameComponent(item, component)
            ? []
            : [item],
      )
    : [...scene, updated];
}

export function removeSceneComponent(
  scene: SceneComponent[],
  component: SceneComponent,
) {
  const existing = findSceneComponent(scene, component);
  const current = existing ?? component;
  const remaining = scene.filter((item) => !sameComponent(item, current));
  if (current.osmId === undefined) return remaining;
  return [
    ...remaining,
    {
      id: current.id,
      kind: "removed_osm" as const,
      x: current.x,
      y: current.y,
      rotation: 0,
      osmId: current.osmId,
      footprint: current.footprint,
      osmAt:
        current.osmAt ??
        (current.footprint ? [current.x, current.y] : undefined),
    },
  ];
}
