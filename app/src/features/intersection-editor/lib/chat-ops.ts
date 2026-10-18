import { chatOpSchema, type ChatOp } from "../../../../shared/chat";
import {
  projectStateSchema,
  type ProjectState,
} from "../../../../shared/projects";
import { addArea, isEditable } from "./edit-areas";
import { componentFromDrop } from "./scene";
import { removeSceneComponent } from "./scene-edits";
import { snapComponent, snapTargets } from "./snap";
import { breaksSidewalkRule } from "./spatial";
export type { ChatOp };

/** Shared by tools and editor: validate the whole batch before committing it. */
export function applyChatOps(
  state: ProjectState,
  operations: ChatOp[],
): ProjectState {
  let { scene, areas } = state;
  if (operations.length > 40)
    throw new Error("Ask for 40 map edits or fewer at a time.");
  for (const operation of operations) {
    const op = chatOpSchema.parse(operation);
    if (op.type === "select_area") {
      areas = addArea(areas, { id: crypto.randomUUID(), rings: op.rings });
    } else if (op.type === "place_component") {
      const created = snapComponent(
        {
          ...componentFromDrop(op.kind, op.x, op.y),
          rotation: op.rotation,
          id: op.id,
        },
        snapTargets(scene),
        5,
      );
      if (!isEditable(areas, [created.x, created.y]))
        throw new Error("Open an editable area at that position first.");
      if (breaksSidewalkRule([...scene, created], new Set([created.id])))
        throw new Error("Roads and lanes cannot overlap sidewalks.");
      if (scene.some((c) => c.id === created.id))
        throw new Error("That component ID already exists.");
      scene = [...scene, created];
    } else {
      const target = scene.find(
        (c) => c.id === op.id && c.kind !== "removed_osm",
      );
      if (!target) throw new Error("That component no longer exists.");
      if (!isEditable(areas, [target.x, target.y]))
        throw new Error("That component is outside the editable areas.");
      scene = removeSceneComponent(scene, target);
    }
  }
  return projectStateSchema.parse({ ...state, scene, areas });
}

/** A reply must not overwrite work done while its model call was in flight. */
export function applyChatOpsToCurrent(
  base: ProjectState,
  current: ProjectState,
  operations: ChatOp[],
): ProjectState {
  if (
    JSON.stringify([base.scene, base.areas]) !==
    JSON.stringify([current.scene, current.areas])
  ) {
    throw new Error(
      "The map changed while the assistant was replying. Ask again to apply edits to the current map.",
    );
  }
  return applyChatOps(current, operations);
}
