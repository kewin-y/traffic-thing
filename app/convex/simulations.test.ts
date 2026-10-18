/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workpool from "@convex-dev/workpool/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { emptyProjectState } from "../shared/projects";
import { parseWorkerResult, workerRequest } from "./simulations/lib/result";

const modules = import.meta.glob("./**/*.{ts,js}");
beforeEach(() => {
  vi.stubEnv("WORKER_URL", "http://localhost:8000");
  vi.stubEnv("WORKER_API_KEY", "test-worker-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function setup() {
  const t = convexTest(schema, modules);
  workpool.register(t, "simulationPool");
  const [aliceId, bobId] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { name: "Alice" }),
      ctx.db.insert("users", { name: "Bob" }),
    ]),
  );
  const alice = t.withIdentity({ subject: `${aliceId}|session` });
  const bob = t.withIdentity({ subject: `${bobId}|session` });
  const project = await alice.mutation(api.projects.mutations.create, {
    name: "Toronto",
    description: "",
    token: "a".repeat(32),
  });
  await t.run((ctx) =>
    ctx.db.patch("projects", project.id, {
      network: { name: "toronto-downtown", version: "1234567890abcdef" },
    }),
  );
  const args = {
    projectId: project.id,
    requestId: "baseline-request-1234",
    expectedRevision: 0,
    settings: { durationSeconds: 200, seed: 42, record: false },
  };
  return { t, alice, bob, project, args };
}
function result(runId: string) {
  return {
    request_id: runId,
    network: "toronto-downtown",
    network_version: "1234567890abcdef",
    seed: 42,
    sumo_version: "1.28.0",
    simulation_time_seconds: 200,
    completed: 5,
    departed: 20,
    running: 15,
    pending: 0,
    average_trip_duration_seconds: 100,
    average_waiting_time_seconds: 2,
    average_time_loss_seconds: 4,
    applied_edits: [],
  };
}
const auth = {
  Authorization: "Bearer test-worker-secret",
  "Content-Type": "application/json",
};
test("start is private, idempotent, captures an immutable full snapshot, and prevents concurrent runs", async () => {
  const { t, alice, bob, args, project } = await setup();
  for (const client of [t, bob])
    await expect(
      client.mutation(api.simulations.mutations.start, args),
    ).rejects.toThrow();
  const runId = await alice.mutation(api.simulations.mutations.start, args);
  expect(await alice.mutation(api.simulations.mutations.start, args)).toBe(
    runId,
  );
  await expect(
    alice.mutation(api.simulations.mutations.start, {
      ...args,
      requestId: "another-request-1234",
    }),
  ).rejects.toThrow("active");
  await expect(
    alice.mutation(api.simulations.mutations.start, {
      ...args,
      settings: { ...args.settings, seed: 43 },
    }),
  ).rejects.toThrow("token");
  for (const client of [t, bob]) {
    await expect(
      client.query(api.simulations.queries.list, {
        projectId: project.id,
        paginationOpts: { cursor: null, numItems: 8 },
      }),
    ).rejects.toThrow();
    await expect(
      client.query(api.simulations.queries.snapshot, { runId }),
    ).rejects.toThrow();
    await expect(
      client.query(api.simulations.queries.recordingUrl, { runId }),
    ).rejects.toThrow();
  }
  const original = emptyProjectState();
  const changed = emptyProjectState();
  changed.scene.push({
    id: "building",
    kind: "building",
    x: 2,
    y: 3,
    rotation: 0,
    height: 35,
  });
  await alice.mutation(api.projects.mutations.save, {
    projectId: project.id,
    expectedRevision: 0,
    state: changed,
  });
  expect(
    await alice.query(api.simulations.queries.snapshot, { runId }),
  ).toEqual(original);
  expect(
    await t.run((ctx) => ctx.db.query("simulationSnapshots").collect()),
  ).toHaveLength(1);
  const run = await t.query(internal.simulations.queries.get, { runId });
  expect(workerRequest(run!)).toMatchObject({
    edits: [],
    network_version: "1234567890abcdef",
    request_id: runId,
  });
});
test("settings, stale revisions, and missing configuration are rejected", async () => {
  const { alice, args } = await setup();
  for (const settings of [
    { ...args.settings, durationSeconds: 0 },
    { ...args.settings, seed: -1 },
    { ...args.settings, durationSeconds: 1.5 },
  ])
    await expect(
      alice.mutation(api.simulations.mutations.start, { ...args, settings }),
    ).rejects.toThrow("settings");
  await expect(
    alice.mutation(api.simulations.mutations.start, {
      ...args,
      expectedRevision: 10,
    }),
  ).rejects.toThrow("Save");
  vi.stubEnv("WORKER_URL", "");
  await expect(
    alice.mutation(api.simulations.mutations.start, args),
  ).rejects.toThrow("configured");
});
test("authenticated local worker claims once, completes, and cannot overwrite a terminal run", async () => {
  const { t, alice, args } = await setup();
  const runId = await alice.mutation(api.simulations.mutations.start, args);
  expect((await t.fetch("/simulations/claim", { method: "POST" })).status).toBe(
    401,
  );
  const claim = await (
    await t.fetch("/simulations/claim", { method: "POST", headers: auth })
  ).json();
  expect(claim.request.edits).toEqual([]);
  expect(claim.runId).toBe(runId);
  expect(
    await (
      await t.fetch("/simulations/claim", { method: "POST", headers: auth })
    ).json(),
  ).toBeNull();
  const finish = {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      runId,
      leaseId: claim.leaseId,
      result: result(runId),
    }),
  };
  expect((await t.fetch("/simulations/complete", finish)).status).toBe(200);
  await t.fetch("/simulations/complete", {
    ...finish,
    body: JSON.stringify({
      runId,
      leaseId: claim.leaseId,
      error: "Late failure",
    }),
  });
  const run = await t.query(internal.simulations.queries.get, { runId });
  expect(run?.status).toBe("succeeded");
  expect(run?.result?.completed).toBe(5);
});
test("mismatched result versions fail permanently", async () => {
  const { t, alice, args } = await setup();
  const runId = await alice.mutation(api.simulations.mutations.start, args);
  const run = await t.mutation(internal.simulations.mutations.claim, {});
  expect(() =>
    parseWorkerResult(
      { ...result(runId), network_version: "abcdef1234567890" },
      run!,
    ),
  ).toThrow("match");
  await t.fetch("/simulations/complete", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      runId,
      leaseId: 1,
      result: { ...result(runId), seed: 43 },
    }),
  });
  expect(
    (await t.query(internal.simulations.queries.get, { runId }))?.status,
  ).toBe("failed");
});
test("busy retries are bounded; expired leases recover and stale completions are ignored", async () => {
  const { t, alice, args } = await setup();
  const runId = await alice.mutation(api.simulations.mutations.start, args);
  await t.mutation(internal.simulations.mutations.claim, {});
  await t.run((ctx) =>
    ctx.db.patch("simulationRuns", runId, { leaseExpiresAt: Date.now() - 1 }),
  );
  const resumed = await t.mutation(internal.simulations.mutations.claim, {});
  expect(resumed?.attempts).toBe(2);
  await t.mutation(internal.simulations.mutations.finish, {
    runId,
    leaseId: 1,
    error: "stale",
  });
  expect(
    (await t.query(internal.simulations.queries.get, { runId }))?.status,
  ).toBe("running");
  for (let attempt = 2; attempt <= 5; attempt++) {
    if (attempt > 2) await t.mutation(internal.simulations.mutations.claim, {});
    await t.mutation(internal.simulations.mutations.finish, {
      runId,
      leaseId: attempt,
      error: "Worker busy",
      retryable: true,
    });
  }
  expect(
    (await t.query(internal.simulations.queries.get, { runId }))?.status,
  ).toBe("failed");
  expect(await t.mutation(internal.simulations.mutations.claim, {})).toBeNull();
});
test("push dispatch uses server credentials and persists results", async () => {
  const { t, alice, args } = await setup();
  vi.stubEnv("WORKER_URL", "https://worker.example.com");
  const runId = await alice.mutation(api.simulations.mutations.start, args);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json(result(runId)));
  await t.action(internal.simulations.actions.dispatch, { runId });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://worker.example.com/simulate",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer test-worker-secret",
      }),
      redirect: "error",
    }),
  );
  expect(
    (await t.query(internal.simulations.queries.get, { runId }))?.status,
  ).toBe("succeeded");
});

test("recordings require an uploaded file and remain owner scoped", async () => {
  const { t, alice, bob, args } = await setup();
  const runId = await alice.mutation(api.simulations.mutations.start, {
    ...args,
    settings: { ...args.settings, record: true },
  });
  const claim = await t.mutation(internal.simulations.mutations.claim, {});
  const storageId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob(["compressed recording"], { type: "application/gzip" }),
    ),
  );
  const parsed = parseWorkerResult(
    {
      ...result(runId),
      timeline: {
        storage_id: storageId,
        format: "application/gzip",
        filename: "timeline.json.gz",
        sample_interval_seconds: 5,
      },
    },
    claim!,
  );
  await t.mutation(internal.simulations.mutations.finish, {
    runId,
    leaseId: 1,
    ...parsed,
  });
  expect(
    await alice.query(api.simulations.queries.recordingUrl, { runId }),
  ).toBeTruthy();
  await expect(
    bob.query(api.simulations.queries.recordingUrl, { runId }),
  ).rejects.toThrow();
});
test("push busy responses retry; mismatched network errors fail without retrying", async () => {
  const { t, alice, args } = await setup();
  vi.stubEnv("WORKER_URL", "https://worker.example.com");
  const runId = await alice.mutation(api.simulations.mutations.start, args);
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 503 }));
  await expect(
    t.action(internal.simulations.actions.dispatch, { runId }),
  ).rejects.toThrow("unavailable");
  expect(
    (await t.query(internal.simulations.queries.get, { runId }))?.status,
  ).toBe("queued");
  mock.mockResolvedValue(new Response(null, { status: 409 }));
  await t.action(internal.simulations.actions.dispatch, { runId });
  expect(
    (await t.query(internal.simulations.queries.get, { runId }))?.status,
  ).toBe("failed");
});
