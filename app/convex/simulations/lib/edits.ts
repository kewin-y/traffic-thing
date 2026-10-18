import { v } from "convex/values";
import type { WorkerEdit } from "../../../shared/simulations";
import { EDGE_OVERRIDE_PREFIX } from "../../../shared/simulations";

/** The subset of a scene component this module reads. */
interface SceneLike {
  kind: string;
  width?: number;
  laneCount?: number;
  osmId?: string | number;
}

/** metres of road per lane, matching the editor's lane widths. */
const METRES_PER_LANE = 3.3;

/**
 * SUMO edits implied by an editor scene: an edge whose editable component
 * was deleted closes that direction of travel, and one whose width changed
 * away from its original lane count gets the matching lane-count change.
 */
export function roadEdits(
  scene: SceneLike[],
): Extract<WorkerEdit, { type: "close_edge" | "set_lane_count" }>[] {
  const edits: Extract<WorkerEdit, { type: "close_edge" | "set_lane_count" }>[] =
    [];
  for (const component of scene) {
    if (typeof component.osmId !== "string") continue;
    if (!component.osmId.startsWith(EDGE_OVERRIDE_PREFIX)) continue;
    const edge_id = component.osmId.slice(EDGE_OVERRIDE_PREFIX.length);
    if (!edge_id) continue;
    if (component.kind === "removed_osm") {
      edits.push({ type: "close_edge", edge_id });
      continue;
    }
    if (
      component.kind !== "road" ||
      typeof component.laneCount !== "number" ||
      typeof component.width !== "number"
    )
      continue;
    const lane_count = Math.min(
      8,
      Math.max(1, Math.round(component.width / METRES_PER_LANE)),
    );
    if (lane_count !== component.laneCount)
      edits.push({ type: "set_lane_count", edge_id, lane_count });
  }
  return edits;
}

export const roadEditValidator = v.union(
  v.object({
    type: v.literal("set_speed_limit"),
    edge_id: v.string(),
    speed_mps: v.number(),
  }),
  v.object({
    type: v.literal("set_lane_count"),
    edge_id: v.string(),
    lane_count: v.number(),
  }),
  v.object({ type: v.literal("close_edge"), edge_id: v.string() }),
);
