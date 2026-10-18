/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { emptyProjectState } from "../shared/projects";

const modules = import.meta.glob("./**/*.{ts,js}");
async function setup() {
  const t = convexTest(schema, modules);
  const [aliceId, bobId] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { name: "Alice" }),
      ctx.db.insert("users", { name: "Bob" }),
    ]),
  );
  return {
    t,
    alice: t.withIdentity({ subject: `${aliceId}|session` }),
    bob: t.withIdentity({ subject: `${bobId}|session` }),
  };
}
const details = {
  name: "College Street",
  description: "Bike lanes",
  token: "a".repeat(32),
};

test("creates a persistent project atomically and retries without duplicates", async () => {
  const { t, alice } = await setup();
  const first = await alice.mutation(api.projects.mutations.create, details);
  expect(await alice.mutation(api.projects.mutations.create, details)).toEqual(
    first,
  );
  const saved = await alice.query(api.projects.queries.get, {
    slug: first.slug,
  });
  expect(saved?.state).toEqual(emptyProjectState());
  expect(saved?.revision).toBe(0);
  expect(saved?.project.network).toBeNull();
  const rows = await t.run(async (ctx) => ({
    projects: await ctx.db.query("projects").take(10),
    states: await ctx.db.query("projectStates").take(10),
  }));
  expect(rows.projects).toHaveLength(1);
  expect(rows.states).toHaveLength(1);
});

test("private queries and saves enforce ownership and authentication", async () => {
  const { t, alice, bob } = await setup();
  await expect(
    t.mutation(api.projects.mutations.create, details),
  ).rejects.toThrow("Sign in");
  await expect(
    t.query(api.projects.queries.list, {
      paginationOpts: { cursor: null, numItems: 12 },
    }),
  ).rejects.toThrow("Sign in");
  const project = await alice.mutation(api.projects.mutations.create, details);
  expect(
    await bob.query(api.projects.queries.get, { slug: project.slug }),
  ).toBeNull();
  expect(
    (
      await bob.query(api.projects.queries.list, {
        paginationOpts: { cursor: null, numItems: 12 },
      })
    ).page,
  ).toEqual([]);
  for (const client of [t, bob]) {
    await expect(
      client.mutation(api.projects.mutations.save, {
        projectId: project.id,
        expectedRevision: 0,
        state: emptyProjectState(),
      }),
    ).rejects.toThrow();
  }
});

test("state round-trips, empty arrays stay empty, and stale revisions cannot overwrite", async () => {
  const { alice } = await setup();
  const project = await alice.mutation(api.projects.mutations.create, details);
  const state = emptyProjectState();
  state.scene.push({
    id: "bench-12345678",
    kind: "bench",
    x: 1,
    y: 2,
    rotation: 10,
  });
  state.areas.push({
    id: "area",
    rings: [
      [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
    ],
  });
  state.measurements.push({
    id: "measure",
    a: "bench-12345678",
    b: "bench-other",
  });
  state.camera.zoom = 18;
  expect(
    await alice.mutation(api.projects.mutations.save, {
      projectId: project.id,
      expectedRevision: 0,
      state,
    }),
  ).toBe(1);
  expect(
    (await alice.query(api.projects.queries.get, { slug: project.slug }))
      ?.state,
  ).toEqual(state);
  await expect(
    alice.mutation(api.projects.mutations.save, {
      projectId: project.id,
      expectedRevision: 0,
      state: emptyProjectState(),
    }),
  ).rejects.toThrow("CONFLICT");
  expect(
    (await alice.query(api.projects.queries.get, { slug: project.slug }))
      ?.state,
  ).toEqual(state);
  await alice.mutation(api.projects.mutations.save, {
    projectId: project.id,
    expectedRevision: 1,
    state: emptyProjectState(),
  });
  expect(
    (await alice.query(api.projects.queries.get, { slug: project.slug }))
      ?.state,
  ).toEqual(emptyProjectState());
});

test("invalid imports roll back creation, and invalid geometry cannot replace saved work", async () => {
  const { t, alice } = await setup();
  const invalid = {
    ...emptyProjectState(),
    camera: { ...emptyProjectState().camera, zoom: 200 },
  };
  await expect(
    alice.mutation(api.projects.mutations.create, {
      ...details,
      initialState: invalid,
    }),
  ).rejects.toThrow("invalid map data");
  expect(await t.run(async (ctx) => ctx.db.query("projects").take(10))).toEqual(
    [],
  );
  const project = await alice.mutation(api.projects.mutations.create, details);
  await expect(
    alice.mutation(api.projects.mutations.save, {
      projectId: project.id,
      expectedRevision: 0,
      state: invalid,
    }),
  ).rejects.toThrow("invalid map data");
  const duplicate = emptyProjectState();
  duplicate.scene = [0, 1].map(() => ({
    id: "same",
    kind: "bench",
    x: 0,
    y: 0,
    rotation: 0,
  }));
  await expect(
    alice.mutation(api.projects.mutations.save, {
      projectId: project.id,
      expectedRevision: 0,
      state: duplicate,
    }),
  ).rejects.toThrow("unique");
  expect(
    (await alice.query(api.projects.queries.get, { slug: project.slug }))
      ?.revision,
  ).toBe(0);
});

test("projects pin their published network and recent ordering follows saves", async () => {
  const { t, alice } = await setup();
  async function publish(version: string) {
    await t.run(async (ctx) => {
      const file = await ctx.storage.store(new Blob(["roads"]));
      await ctx.db.insert("networks", {
        name: "toronto-downtown",
        version,
        attribution: "OSM",
        edgeCount: 1,
        geojsonSha256: "a".repeat(64),
        geojsonStorageId: file,
        manifestStorageId: file,
      });
    });
  }
  await publish("original");
  const first = await alice.mutation(api.projects.mutations.create, details);
  await publish("newer");
  const second = await alice.mutation(api.projects.mutations.create, {
    ...details,
    token: "b".repeat(32),
  });
  expect(
    (await alice.query(api.projects.queries.get, { slug: first.slug }))?.project
      .network?.version,
  ).toBe("original");
  expect(
    (await alice.query(api.projects.queries.get, { slug: second.slug }))
      ?.project.network?.version,
  ).toBe("newer");
  await alice.mutation(api.projects.mutations.save, {
    projectId: first.id,
    expectedRevision: 0,
    state: emptyProjectState(),
  });
  const list = await alice.query(api.projects.queries.list, {
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(list.page[0]._id).toBe(first.id);
  expect(list.isDone).toBe(false);
});

test("oversized state is rejected before updating the saved revision", async () => {
  const { alice } = await setup();
  const project = await alice.mutation(api.projects.mutations.create, details);
  const state = emptyProjectState();
  state.scene = Array.from({ length: 1200 }, (_, i) => ({
    id: `bench-${i}`,
    kind: "bench",
    x: 0,
    y: 0,
    rotation: 0,
    hours: "x".repeat(500),
    colour: "x".repeat(100),
  }));
  await expect(
    alice.mutation(api.projects.mutations.save, {
      projectId: project.id,
      expectedRevision: 0,
      state,
    }),
  ).rejects.toThrow("too large");
  expect(
    (await alice.query(api.projects.queries.get, { slug: project.slug }))
      ?.revision,
  ).toBe(0);
});
