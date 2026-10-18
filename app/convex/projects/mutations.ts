import { ConvexError, getConvexSize, v } from "convex/values";
import { mutation } from "../_generated/server";
import {
  emptyProjectState,
  projectDetailsSchema,
  projectStateSchema,
} from "../../shared/projects";
import { projectState } from "./schema";
import { requireProject, requireUser } from "./lib/access";

function validatedState(value: unknown) {
  const parsed = projectStateSchema.safeParse(value);
  if (!parsed.success)
    throw new ConvexError("The project contains invalid map data.");
  // Leave room for document metadata below Convex's 1 MiB limit.
  if (getConvexSize(parsed.data) > 750_000)
    throw new ConvexError(
      "This project is too large to save. Export a recovery copy before reducing its size.",
    );
  const { scene, areas, measurements } = parsed.data;
  for (const items of [scene, areas, measurements]) {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new ConvexError("Project item IDs must be unique.");
  }
  return parsed.data;
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    token: v.string(),
    initialState: v.optional(projectState),
  },
  returns: v.object({ id: v.id("projects"), slug: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    const details = projectDetailsSchema.safeParse(args);
    if (!details.success)
      throw new ConvexError(details.error.issues[0].message);
    if (!/^[a-f0-9]{32}$/.test(args.token))
      throw new ConvexError("Invalid project creation token.");
    const prefix =
      details.data.name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60)
        .replace(/-$/, "") || "project";
    const slug = `${prefix}-${args.token}`;
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) {
      if (existing.ownerId !== ownerId)
        throw new ConvexError("Could not create project. Please try again.");
      return { id: existing._id, slug };
    }
    const network = await ctx.db
      .query("networks")
      .withIndex("by_name", (q) => q.eq("name", "toronto-downtown"))
      .order("desc")
      .first();
    const id = await ctx.db.insert("projects", {
      ...details.data,
      slug,
      ownerId,
      updatedAt: Date.now(),
      network: network
        ? { name: network.name, version: network.version }
        : null,
    });
    await ctx.db.insert("projectStates", {
      projectId: id,
      revision: 0,
      state: validatedState(args.initialState ?? emptyProjectState()),
    });
    return { id, slug };
  },
});

export const save = mutation({
  args: {
    projectId: v.id("projects"),
    expectedRevision: v.number(),
    state: projectState,
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId);
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0
    )
      throw new ConvexError("Invalid revision.");
    const saved = await ctx.db
      .query("projectStates")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!saved) throw new ConvexError("Project not found.");
    if (saved.revision !== args.expectedRevision)
      throw new ConvexError({
        code: "CONFLICT",
        message:
          "This project changed in another tab. Download your changes, then reload the project.",
      });
    const state = validatedState(args.state);
    const revision = saved.revision + 1;
    await ctx.db.patch("projectStates", saved._id, { state, revision });
    await ctx.db.patch("projects", args.projectId, { updatedAt: Date.now() });
    return revision;
  },
});
