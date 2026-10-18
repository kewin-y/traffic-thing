import type { SceneComponent } from "./components";

export const SCENE_STORAGE_KEY = "traffic-thing:intersection-scene:v3";
const LEGACY_STORAGE_KEY = "traffic-thing:intersection-scene:v2";

/**
 * Whether a saved component is the user's own. Everything the user adds or
 * converts gets an id from newId ending in eight hex digits; the retired demo
 * intersection, across all its versions, used fixed ids that never do.
 */
function isUserComponent(component: SceneComponent | null): boolean {
  if (!component || !/-[0-9a-f]{8}$/.test(String(component.id))) return false;
  // Deleted map buildings saved without an outline hid every building merged
  // into the same basemap feature, so let those reappear.
  return !(
    component.kind === "removed_osm" &&
    !component.footprint &&
    String(component.id).startsWith("building-")
  );
}

/** Trees were replaced by resizable green areas; keep each where it stood. */
function withoutTrees(component: SceneComponent): SceneComponent {
  if ((component.kind as string) !== "tree") return component;
  return {
    ...component,
    kind: "green_area",
    length: component.length ?? 6,
    width: component.width ?? 6,
  };
}

function read(key: string): SceneComponent[] | null {
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  return Array.isArray(saved) ? saved : null;
}

export function loadEditorScene(): SceneComponent[] {
  try {
    // The current save is filtered too: demo leftovers with older ids were
    // carried into it before this check existed. The legacy key is left intact
    // so the original scene stays recoverable.
    const saved = read(SCENE_STORAGE_KEY) ?? read(LEGACY_STORAGE_KEY) ?? [];
    return saved.filter(isUserComponent).map(withoutTrees);
  } catch {
    return [];
  }
}
