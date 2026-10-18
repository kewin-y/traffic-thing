/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import agentTest from "@convex-dev/agent/test";
import { expect, test, vi } from "vitest";
import { mockModel } from "@convex-dev/agent";
import { createGoogle } from "@ai-sdk/google";
import { APICallError } from "ai";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { emptyProjectState } from "../shared/projects";

const model = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof mockModel> | undefined,
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogle: vi.fn(() => () => model.current),
}));
const modules = import.meta.glob("./**/*.{ts,js}");
async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const [aliceId, bobId] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { name: "Alice" }),
      ctx.db.insert("users", { name: "Bob" }),
    ]),
  );
  const alice = t.withIdentity({ subject: `${aliceId}|session` });
  const bob = t.withIdentity({ subject: `${bobId}|session` });
  const project = await alice.mutation(api.projects.mutations.create, {
    name: "Chat test",
    description: "",
    token: "a".repeat(32),
  });
  return { t, alice, bob, project };
}

test("threads persist per project and enforce ownership before reading history", async () => {
  const { t, alice, bob, project } = await setup();
  for (const client of [t, bob]) {
    await expect(
      client.query(api.assistant.queries.thread, { projectId: project.id }),
    ).rejects.toThrow();
    await expect(
      client.mutation(internal.assistant.mutations.begin, {
        projectId: project.id,
        requestId: "bad",
      }),
    ).rejects.toThrow();
  }
  const args = { projectId: project.id, requestId: "one" };
  const threadId = await alice.mutation(
    internal.assistant.mutations.begin,
    args,
  );
  await expect(
    alice.mutation(internal.assistant.mutations.begin, {
      ...args,
      requestId: "two",
    }),
  ).rejects.toThrow("already replying");
  await alice.mutation(internal.assistant.mutations.finish, {
    ...args,
    requestId: "wrong",
  });
  await expect(
    alice.mutation(internal.assistant.mutations.begin, {
      ...args,
      requestId: "two",
    }),
  ).rejects.toThrow("already replying");
  await alice.mutation(internal.assistant.mutations.finish, args);
  expect(
    await alice.mutation(internal.assistant.mutations.begin, {
      ...args,
      requestId: "two",
    }),
  ).toBe(threadId);
  expect(
    await alice.query(api.assistant.queries.thread, { projectId: project.id }),
  ).toBe(threadId);
  for (const client of [t, bob]) {
    await expect(
      client.query(api.assistant.queries.listMessages, {
        projectId: project.id,
        threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow();
  }
  await expect(
    alice.query(api.assistant.queries.listMessages, {
      projectId: project.id,
      threadId: "other",
      paginationOpts: { cursor: null, numItems: 30 },
    }),
  ).rejects.toThrow("Conversation not found");
});

test("chat streams tool turns, sees earlier tool edits, and persists messages", async () => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  model.current = mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "area",
          toolName: "selectArea",
          input: JSON.stringify({ x0: -50, y0: -50, x1: 50, y1: 50 }),
        },
      ],
      [
        {
          type: "tool-call",
          toolCallId: "bench",
          toolName: "placeComponent",
          input: JSON.stringify({ kind: "bench", x: 0, y: 0, rotation: 90 }),
        },
      ],
      [{ type: "text", text: "A bench is ready to place in the new area." }],
    ],
  });
  try {
    const { alice, bob, project } = await setup();
    const args = {
      projectId: project.id,
      prompt: "Open an area and add a bench",
      state: emptyProjectState(),
    };
    await expect(
      bob.action(api.assistant.actions.sendChat, args),
    ).rejects.toThrow("Project not found");
    const operations = JSON.parse(
      await alice.action(api.assistant.actions.sendChat, args),
    );
    expect(createGoogle).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(operations.map((op: { type: string }) => op.type)).toEqual([
      "select_area",
      "place_component",
    ]);
    const threadId = await alice.query(api.assistant.queries.thread, {
      projectId: project.id,
    });
    const history = await alice.query(api.assistant.queries.listMessages, {
      projectId: project.id,
      threadId: threadId!,
      paginationOpts: { cursor: null, numItems: 30 },
    });
    expect(JSON.stringify(history.page)).toContain("A bench is ready");
    await expect(
      alice.action(api.assistant.actions.sendChat, { ...args, prompt: " " }),
    ).rejects.toThrow("1–4000");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("missing provider configuration leaves no locked conversation", async () => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  try {
    const { alice, project } = await setup();
    await expect(
      alice.action(api.assistant.actions.sendChat, {
        projectId: project.id,
        prompt: "Hello",
        state: emptyProjectState(),
      }),
    ).rejects.toThrow("not configured");
    expect(
      await alice.query(api.assistant.queries.thread, {
        projectId: project.id,
      }),
    ).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

test("provider failure releases the project lock and does not return partial edits", async () => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  model.current = mockModel({ fail: true });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { alice, project } = await setup();
    await expect(
      alice.action(api.assistant.actions.sendChat, {
        projectId: project.id,
        prompt: "Hello",
        state: emptyProjectState(),
      }),
    ).rejects.toThrow("could not complete");
    const threadId = await alice.query(api.assistant.queries.thread, {
      projectId: project.id,
    });
    expect(
      await alice.mutation(internal.assistant.mutations.begin, {
        projectId: project.id,
        requestId: "retry",
      }),
    ).toBe(threadId);
  } finally {
    logged.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("Gemini quota failures explain the problem and release the lock", async () => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  model.current = mockModel({
    doStream: async () => {
      throw new APICallError({
        message: "Quota exceeded",
        url: "https://generativelanguage.googleapis.com",
        requestBodyValues: {},
        statusCode: 429,
        isRetryable: false,
      });
    },
  });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { alice, project } = await setup();
    await expect(
      alice.action(api.assistant.actions.sendChat, {
        projectId: project.id,
        prompt: "Hello",
        state: emptyProjectState(),
      }),
    ).rejects.toThrow("quota");
    await expect(
      alice.mutation(internal.assistant.mutations.begin, {
        projectId: project.id,
        requestId: "retry-quota",
      }),
    ).resolves.toBeTypeOf("string");
  } finally {
    logged.mockRestore();
    vi.unstubAllEnvs();
  }
});

test("streaming subscriptions accept the hook's zero-item page", async () => {
  const { alice, project } = await setup();
  const threadId = await alice.mutation(internal.assistant.mutations.begin, {
    projectId: project.id,
    requestId: "stream",
  });
  const page = await alice.query(api.assistant.queries.listMessages, {
    projectId: project.id,
    threadId,
    paginationOpts: { cursor: null, numItems: 0 },
    streamArgs: { kind: "list", startOrder: 0 },
  });
  expect(page.page).toEqual([]);
  expect(page.streams).toBeDefined();
  await expect(
    alice.query(api.assistant.queries.listMessages, {
      projectId: project.id,
      threadId,
      paginationOpts: { cursor: null, numItems: 101 },
    }),
  ).rejects.toThrow("between 0 and 100");
});
