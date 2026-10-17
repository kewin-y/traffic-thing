import type { SceneComponent } from "./components";
import { defaultScene } from "./scene";

export const SCENE_STORAGE_KEY = "traffic-thing:intersection-scene:v3";

export function loadEditorScene(): SceneComponent[] {
  try {
    const current = JSON.parse(
      localStorage.getItem(SCENE_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(current)) return current;
    const legacy = JSON.parse(
      localStorage.getItem("traffic-thing:intersection-scene:v2") ?? "null",
    );
    if (!Array.isArray(legacy)) return [];
    // Retire the automatic demo, preserving objects the user added themselves.
    // Leave the old storage key intact so the original scene is recoverable.
    const demoIds = new Set(defaultScene().map((component) => component.id));
    return legacy.filter(
      (component) => component && !demoIds.has(component.id),
    );
  } catch {
    return [];
  }
}
