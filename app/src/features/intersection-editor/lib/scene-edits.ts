import type { SceneComponent } from "./components";

/** A map source feature keeps one editable override, even across stale hits. */
export function findSceneComponent(
  scene: SceneComponent[],
  component: SceneComponent,
) {
  return scene.find(
    (item) =>
      item.id === component.id ||
      (component.osmId !== undefined && item.osmId === component.osmId),
  );
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
          : item.id === component.id ||
              (component.osmId !== undefined && item.osmId === component.osmId)
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
  const remaining = scene.filter(
    (item) =>
      item.id !== current.id &&
      (current.osmId === undefined || item.osmId !== current.osmId),
  );
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
