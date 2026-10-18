import { afterEach, expect, test, vi } from "vitest";
import { componentFromNetworkEdge, loadNetwork, type PublishedNetwork } from "./network";

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const published: PublishedNetwork = {
    id: "network-id",
    name: "toronto-downtown",
    version: "version-a",
    attribution: "© OpenStreetMap contributors",
    edgeCount: 1,
    geojsonUrl: "https://storage.example/roads",
    manifestUrl: "https://storage.example/manifest",
  };
  const roads = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "-123#0",
        properties: {
          edge_id: "-123#0",
          name: "Bremner Boulevard",
          lane_count: 2,
          speed_mps: 13.89,
          length_metres: 200,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [-79.39, 43.64],
            [-79.38, 43.65],
          ],
        },
      },
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(roads));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const manifest = {
    network: published.name,
    network_version: published.version,
    edge_count: 1,
    simulation_bbox_wgs84: [-79.4, 43.63, -79.37, 43.66],
    sha256: {
      "edges.geojson": Array.from(hash, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    },
  };
  const fetcher = vi.fn(async (url: string) =>
    url === published.geojsonUrl
      ? new Response(bytes)
      : Response.json(manifest),
  );
  vi.stubGlobal("fetch", fetcher);
  return { published, roads, manifest, fetcher };
}

test("loads version-matched roads with SUMO IDs and geographic bounds", async () => {
  const { published, roads, fetcher } = await fixture();
  const signal = new AbortController().signal;
  const result = await loadNetwork(published, signal);
  expect(result.roads).toEqual(roads);
  expect(result.bounds).toEqual([
    [-79.4, 43.63],
    [-79.37, 43.66],
  ]);
  expect(fetcher).toHaveBeenCalledWith(published.geojsonUrl, { signal });
  expect(fetcher).toHaveBeenCalledWith(published.manifestUrl, { signal });
});

test.each(["version", "checksum", "bounds", "count"])(
  "rejects mismatched %s",
  async (failure) => {
    const { published, manifest } = await fixture();
    if (failure === "version") manifest.network_version = "different-version";
    if (failure === "checksum")
      manifest.sha256["edges.geojson"] = "0".repeat(64);
    if (failure === "bounds")
      manifest.simulation_bbox_wgs84 = [-300, 43.63, -79.37, 43.66];
    if (failure === "count") manifest.edge_count = 2;
    await expect(
      loadNetwork(published, new AbortController().signal),
    ).rejects.toThrow();
  },
);

test("failed downloads do not return a partial network", async () => {
  const { published } = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await expect(
    loadNetwork(published, new AbortController().signal),
  ).rejects.toThrow("download failed");
});

test("network edges convert to editable road components", () => {
  const feature: Parameters<typeof componentFromNetworkEdge>[0] = {
    type: "Feature",
    id: "-123#0",
    properties: {
      edge_id: "-123#0",
      name: "Bremner Boulevard",
      lane_count: 2,
      speed_mps: 13.89,
      length_metres: 200,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [-79.39, 43.64],
        [-79.38, 43.65],
      ],
    },
  };
  const component = componentFromNetworkEdge(feature);
  expect(component.kind).toBe("road");
  expect(component.osmId).toBe("edge/-123#0");
  expect(component.laneCount).toBe(2);
  // Two lanes at 3.3 m each, keyed off the edge's own centreline.
  expect(component.width).toBe(6.6);
  expect(component.path?.length).toBe(2);
  // The path is centred on the edge, in local grid metres.
  const centre = component.path!.reduce(
    ([x, y], [px, py]) => [x + px / 2, y + py / 2] as [number, number],
    [0, 0],
  );
  expect(centre[0]).toBeCloseTo(0, 1);
  expect(centre[1]).toBeCloseTo(0, 1);
});
