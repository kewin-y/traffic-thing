import { ConvexError, getConvexSize, v } from "convex/values";
import { stepCountIs } from "@convex-dev/agent";
import { APICallError } from "ai";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { projectState } from "../projects/schema";
import { projectStateSchema } from "../../shared/projects";
import { assistantAgent } from "./agent";

export const sendChat = action({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
    state: projectState,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(api.projects.queries.getById, {
      id: args.projectId,
    });
    if (!project) throw new ConvexError("Project not found.");
    const prompt = args.prompt.trim();
    if (!prompt || prompt.length > 4000)
      throw new ConvexError("Enter a message of 1–4000 characters.");
    const parsed = projectStateSchema.safeParse(args.state);
    if (!parsed.success || getConvexSize(args.state) > 750_000)
      throw new ConvexError(
        "The map is invalid or too large to send to the assistant.",
      );
    const { agent, operations } = assistantAgent(parsed.data);
    const requestId = crypto.randomUUID();
    const threadId: string = await ctx.runMutation(
      internal.assistant.mutations.begin,
      { projectId: args.projectId, requestId },
    );
    let streamError: unknown;
    try {
      const signal = AbortSignal.timeout(90_000);
      const stream = await agent.streamText(
        ctx,
        { threadId, userId: project.project.ownerId },
        {
          prompt,
          onError: ({ error }) => {
            streamError = error;
          },
          stopWhen: stepCountIs(8),
          maxOutputTokens: 4096,
          abortSignal: signal,
          providerOptions: {
            google: { thinkingConfig: { thinkingLevel: "low" } },
          },
        },
        { saveStreamDeltas: { throttleMs: 100 } },
      );
      await stream.consumeStream();
      // Awaiting the result propagates provider failures instead of applying partial edits.
      signal.throwIfAborted();
      if ((await stream.finishReason) !== "stop")
        throw new Error(
          "The assistant could not complete its reply. Please retry.",
        );
      return JSON.stringify(operations);
    } catch (error) {
      console.error("Assistant generation failed", error);
      const providerError = streamError ?? error;
      if (
        APICallError.isInstance(providerError) &&
        providerError.statusCode === 429
      )
        throw new ConvexError(
          "Gemini is rate limited or its free quota is exhausted. Check your Google AI Studio quota before retrying.",
        );
      throw new ConvexError(
        "The assistant could not complete its reply. Check the model configuration and try again.",
      );
    } finally {
      await ctx.runMutation(internal.assistant.mutations.finish, {
        projectId: args.projectId,
        requestId,
      });
    }
  },
});
