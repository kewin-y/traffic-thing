import type { ToolSet } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { Agent, createTool } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import { chatOpSchema, type ChatOp } from "../../shared/chat";
import type { ProjectState } from "../../shared/projects";
import { TOOL_BY_KIND } from "../../src/features/intersection-editor/lib/components";
import { applyChatOps } from "../../src/features/intersection-editor/lib/chat-ops";

// Register the provider we use so AI SDK's model IDs do not expand the entire
// gateway catalog inside the Agent constructor's intersected model types.
declare global {
  interface RegisteredProviderModels {
    google: Parameters<ReturnType<typeof createGoogle>>[0];
  }
}

/** Per-turn state includes earlier tool edits and the browser's unsaved changes. */
export function assistantAgent(initialState: ProjectState) {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY)
    throw new ConvexError(
      "The map assistant is not configured. Set GOOGLE_GENERATIVE_AI_API_KEY on the Convex deployment, then retry.",
    );
  let state = initialState;
  const operations: ChatOp[] = [];
  function propose(op: ChatOp) {
    try {
      if (operations.length >= 40)
        return { error: "Limit reached: 40 edits per message." };
      state = applyChatOps(state, [op]);
      operations.push(op);
      return {
        status: "Ready to apply when this reply completes.",
        operation: op,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid map edit.",
      };
    }
  }
  const listScene = createTool({
    inputSchema: z.object({}),
    description:
      "Read the current map, including earlier edits in this turn. Positions are local metres: x east, y north of origin. Does not include unimported basemap features.",
    execute: async () => ({
      origin: state.origin,
      areas: state.areas,
      components: state.scene.filter((c) => c.kind !== "removed_osm"),
      availableKinds: Object.values(TOOL_BY_KIND)
        .filter((t) => t.kind !== "removed_osm")
        .map((t) => ({ kind: t.kind, defaults: t.defaults })),
    }),
  });
  const selectArea = createTool({
    inputSchema: z.object({
      x0: z.number().min(-10000).max(10000),
      y0: z.number().min(-10000).max(10000),
      x1: z.number().min(-10000).max(10000),
      y1: z.number().min(-10000).max(10000),
    }),
    description:
      "Open a rectangle for editing. It must be at least 8 metres wide and tall.",
    execute: async (_ctx, args) => {
      const [left, right] = [
        Math.min(args.x0, args.x1),
        Math.max(args.x0, args.x1),
      ];
      const [bottom, top] = [
        Math.min(args.y0, args.y1),
        Math.max(args.y0, args.y1),
      ];
      if (right - left < 8 || top - bottom < 8)
        return { error: "Choose an area at least 8 metres wide and tall." };
      return propose({
        type: "select_area",
        rings: [
          [
            [left, bottom],
            [right, bottom],
            [right, top],
            [left, top],
          ],
        ],
      });
    },
  });
  const placeComponent = createTool({
    inputSchema: chatOpSchema.options[1].omit({ type: true, id: true }),
    description:
      "Add a component inside an editable area. Rotation is degrees; zero runs east–west. Open an area first if needed. Nearby shapes snap together.",
    execute: async (_ctx, args) =>
      propose({ type: "place_component", id: crypto.randomUUID(), ...args }),
  });
  const deleteComponent = createTool({
    inputSchema: z.object({ id: z.string().min(1).max(200) }),
    description:
      "Delete a component by its ID from listScene, inside an editable area.",
    execute: async (_ctx, args) =>
      propose({ type: "delete_component", id: args.id }),
  });
  const tools: ToolSet = {
    listScene,
    selectArea,
    placeComponent,
    deleteComponent,
  };
  const options = {
    name: "Map assistant",
    languageModel: createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(
      env.CHAT_MODEL ?? "gemini-3.8-flash",
    ),
    instructions: `You help a traffic planner understand and edit a Toronto street map.
Read listScene before editing. Use the current tool snapshot as truth, because older conversation edits may have been undone or not applied.
Coordinates are metres east (x) and north (y) of the returned fixed origin, not longitude/latitude. Ask for clarification when a location is ambiguous.
Only components inside editable areas may change. Use selectArea before placing outside an area. Respect sidewalk overlap errors.
Edits are prepared during this turn and applied by the browser after a successful reply; do not claim they are already saved. The user can undo the batch.
Explain traffic impacts qualitatively; do not invent simulation results or claim to run simulations. Unimported basemap roads and buildings cannot be inspected or deleted by these tools.`,
    tools,
  };
  return {
    operations,
    agent: new Agent<object, ToolSet>(components.agent, options),
  };
}
