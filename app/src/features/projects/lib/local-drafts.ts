import { z } from "zod";
import {
  emptyProjectState,
  projectStateSchema,
  type ProjectState,
} from "../../../../shared/projects";
import { loadEditorScene } from "../../intersection-editor/lib/scene-storage";
import { loadEditAreas } from "../../intersection-editor/lib/edit-areas";

const draftSchema = z.object({
  revision: z.number().int().nonnegative(),
  state: projectStateSchema,
});
export type LocalDraft = z.infer<typeof draftSchema>;
export function draftKey(ownerId: string, projectId: string) {
  return `traffic-thing:project-draft:${ownerId}:${projectId}:v1`;
}
export function readDraft(key: string): LocalDraft | null {
  try {
    const parsed = draftSchema.safeParse(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function writeDraft(key: string, draft: LocalDraft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* Autosave still works without local storage. */
  }
}
export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}
export function readLegacyState(): ProjectState | null {
  try {
    const candidate = {
      ...emptyProjectState(),
      scene: loadEditorScene(),
      areas: loadEditAreas(),
      measurements: JSON.parse(
        localStorage.getItem("traffic-thing:measurements:v1") ?? "[]",
      ),
    };
    const parsed = projectStateSchema.safeParse(candidate);
    if (!parsed.success) return null;
    const state = parsed.data;
    return state.scene.length || state.areas.length || state.measurements.length
      ? state
      : null;
  } catch {
    return null;
  }
}
export function legacyImportedKey(ownerId: string) {
  return `traffic-thing:legacy-imported:${ownerId}`;
}
export function downloadState(state: ProjectState) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
  );
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: "project-recovery.json",
  });
  link.click();
  URL.revokeObjectURL(url);
}
