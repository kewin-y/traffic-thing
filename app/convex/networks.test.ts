/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { digest } from "./networks/lib/assets";
import { internalMutation } from "./_generated/server";

const modules = import.meta.glob("./**/*.{ts,js}");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function assets() {
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    attribution: "© OpenStreetMap contributors",
    features: [
      {
        type: "Feature",
        id: "-123#0",
        properties: { edge_id: "-123#0" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-79.4, 43.64],
            [-79.39, 43.65],
          ],
        },
      },
    ],
  });
  const checksums = {
    "demand.rou.xml": "a".repeat(64),
    "edges.geojson": await digest(new TextEncoder().encode(geojson).buffer),
    "network.net.xml": "b".repeat(64),
    "source.osm.xml": "c".repeat(64),
  };
  const canonical =
    "{" +
    Object.entries(checksums)
      .map(([k, v]) => `"${k}": "${v}"`)
      .join(", ") +
    "}";
  const manifest = {
    network: "toronto-downtown",
    network_version: (
      await digest(new TextEncoder().encode(canonical).buffer)
    ).slice(0, 16),
    attribution: "© OpenStreetMap contributors",
    edge_count: 1,
    selection_bbox_wgs84: [-79.405, 43.635, -79.37, 43.66],
    simulation_bbox_wgs84: [-79.415, 43.625, -79.36, 43.67],
    location: { projParameter: "+proj=utm +zone=17", netOffset: "0,0" },
    sha256: checksums,
  };
  return { geojson, manifest };
}

function body(data: Awaited<ReturnType<typeof assets>>) {
  const form = new FormData();
  form.set(
    "manifest",
    new Blob([JSON.stringify(data.manifest)], { type: "application/json" }),
    "manifest.json",
  );
  form.set(
    "geojson",
    new Blob([data.geojson], { type: "application/geo+json" }),
    "edges.geojson",
  );
  return form;
}

test("publish, query, and retry preserve the original files without duplicates", async () => {
  vi.stubEnv("WORKER_API_KEY", "test-key");
  const t = convexTest(schema, modules);
  const data = await assets();
  const send = () =>
    t.fetch("/networks/publish", {
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
      body: body(data),
    });
  const first = await send();
  expect(first.status).toBe(201);
  const published = await first.json();
  const snapshot = await t.run(async (ctx) => ({
    rows: await ctx.db.query("networks").take(10),
    files: await ctx.db.system.query("_storage").take(10),
  }));
  expect(snapshot.rows).toHaveLength(1);
  expect(snapshot.files).toHaveLength(2);
  const content = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(snapshot.rows[0].geojsonStorageId);
    return blob?.text();
  });
  expect(content).toBe(data.geojson);
  expect(await (await send()).json()).toEqual({ ...published, created: false });
  expect(
    await t.run(async (ctx) => ctx.db.system.query("_storage").take(10)),
  ).toHaveLength(2);
  await expect(
    t.query(api.networks.queries.get, { name: "toronto-downtown" }),
  ).rejects.toThrow("Not authenticated");
  const viewer = t.withIdentity({ subject: "viewer" });
  const network = await viewer.query(api.networks.queries.get, {
    name: "toronto-downtown",
    version: data.manifest.network_version,
  });
  expect(network?.version).toBe(data.manifest.network_version);
  expect(network?.geojsonUrl).toBeTruthy();
  expect(
    await viewer.query(api.networks.queries.get, { name: "missing" }),
  ).toBeNull();
  expect(
    await viewer.query(api.networks.queries.get, {
      name: "toronto-downtown",
      version: "missing",
    }),
  ).toBeNull();
});

test("publishing requires configured worker credentials before reading uploads", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WORKER_API_KEY", "");
  expect((await t.fetch("/networks/publish", { method: "POST" })).status).toBe(
    503,
  );
  vi.stubEnv("WORKER_API_KEY", "test-key");
  for (const headers of [
    new Headers(),
    new Headers({ Authorization: "Bearer wrong-key" }),
  ]) {
    expect(
      (await t.fetch("/networks/publish", { method: "POST", headers })).status,
    ).toBe(401);
  }
});

test("latest means publication time and exact versions remain available", async () => {
  const t = convexTest(schema, modules);
  vi.useFakeTimers();
  await t.run(async (ctx) => {
    const file = await ctx.storage.store(new Blob(["map"]));
    const fields = {
      name: "toronto-downtown",
      attribution: "OSM",
      edgeCount: 1,
      geojsonSha256: "a".repeat(64),
      geojsonStorageId: file,
      manifestStorageId: file,
    };
    vi.setSystemTime(1000);
    await ctx.db.insert("networks", { ...fields, version: "f".repeat(16) });
    vi.setSystemTime(2000);
    await ctx.db.insert("networks", { ...fields, version: "0".repeat(16) });
  });
  const viewer = t.withIdentity({ subject: "viewer" });
  expect(
    (await viewer.query(api.networks.queries.get, { name: "toronto-downtown" }))
      ?.version,
  ).toBe("0".repeat(16));
  expect(
    (
      await viewer.query(api.networks.queries.get, {
        name: "toronto-downtown",
        version: "f".repeat(16),
      })
    )?.version,
  ).toBe("f".repeat(16));
});

test("registration failure removes uploaded files", async () => {
  vi.stubEnv("WORKER_API_KEY", "test-key");
  const t = convexTest(schema, {
    ...modules,
    "./networks/mutations.ts": async () => ({
      register: internalMutation({
        handler: () => {
          throw new Error("Database unavailable");
        },
      }),
    }),
  });
  await expect(
    t.fetch("/networks/publish", {
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
      body: body(await assets()),
    }),
  ).rejects.toThrow("Database unavailable");
  expect(
    await t.run(async (ctx) => ctx.db.system.query("_storage").take(10)),
  ).toHaveLength(0);
});

test("malformed and oversized requests do not create files", async () => {
  vi.stubEnv("WORKER_API_KEY", "test-key");
  const t = convexTest(schema, modules);
  const headers = { Authorization: "Bearer test-key" };
  expect(
    (
      await t.fetch("/networks/publish", {
        method: "POST",
        headers,
        body: "not multipart",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await t.fetch("/networks/publish", {
        method: "POST",
        headers,
        body: new Uint8Array(5 * 1024 * 1024),
      })
    ).status,
  ).toBe(413);
  expect(
    await t.run(async (ctx) => ctx.db.system.query("_storage").take(10)),
  ).toHaveLength(0);
});

test.each(["checksum", "version", "count", "geometry", "duplicate"])(
  "rejects invalid %s before storing files",
  async (failure) => {
    vi.stubEnv("WORKER_API_KEY", "test-key");
    const t = convexTest(schema, modules);
    const data = await assets();
    if (failure === "checksum") data.geojson += " ";
    if (failure === "version") data.manifest.network_version = "0".repeat(16);
    if (failure === "count") data.manifest.edge_count = 2;
    if (failure === "geometry" || failure === "duplicate") {
      const collection = JSON.parse(data.geojson);
      if (failure === "geometry")
        collection.features[0].geometry.coordinates[0][0] = 300;
      else collection.features.push(collection.features[0]);
      data.geojson = JSON.stringify(collection);
      data.manifest.edge_count = collection.features.length;
      data.manifest.sha256["edges.geojson"] = await digest(
        new TextEncoder().encode(data.geojson).buffer,
      );
      const canonical =
        "{" +
        Object.entries(data.manifest.sha256)
          .map(([k, v]) => `"${k}": "${v}"`)
          .join(", ") +
        "}";
      data.manifest.network_version = (
        await digest(new TextEncoder().encode(canonical).buffer)
      ).slice(0, 16);
    }
    expect(
      (
        await t.fetch("/networks/publish", {
          method: "POST",
          headers: { Authorization: "Bearer test-key" },
          body: body(data),
        })
      ).status,
    ).toBe(400);
    expect(
      await t.run(async (ctx) => ctx.db.system.query("_storage").take(10)),
    ).toHaveLength(0);
  },
);
