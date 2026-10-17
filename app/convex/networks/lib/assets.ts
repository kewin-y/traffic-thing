import { z } from "zod";

export const MAX_GEOJSON_BYTES = 4 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 64 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bbox = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([w, s, e, n]) =>
      w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n,
  );
const manifestSchema = z.object({
  network: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
  network_version: z.string().regex(/^[a-f0-9]{16}$/),
  attribution: z.string().min(1).max(1000),
  edge_count: z.number().int().positive().max(50000),
  selection_bbox_wgs84: bbox,
  simulation_bbox_wgs84: bbox,
  location: z.object({ projParameter: z.string(), netOffset: z.string() }),
  sha256: z
    .object({
      "source.osm.xml": hash,
      "network.net.xml": hash,
      "demand.rou.xml": hash,
      "edges.geojson": hash,
    })
    .strict(),
});

export async function digest(bytes: ArrayBuffer): Promise<string> {
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(result, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Validate without cloning the entire road collection in the action's memory.
export async function validateAssets(manifestFile: Blob, geojsonFile: Blob) {
  if (
    manifestFile.size > MAX_MANIFEST_BYTES ||
    geojsonFile.size > MAX_GEOJSON_BYTES
  ) {
    throw new Error("Network assets exceed the publish size limit");
  }
  const manifest = manifestSchema.parse(JSON.parse(await manifestFile.text()));
  const bytes = await geojsonFile.arrayBuffer();
  if ((await digest(bytes)) !== manifest.sha256["edges.geojson"]) {
    throw new Error("GeoJSON checksum does not match the manifest");
  }
  // Match the importer's json.dumps(checksums, sort_keys=True), including spacing.
  const canonical =
    "{" +
    Object.entries(manifest.sha256)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join(", ") +
    "}";
  const version = (
    await digest(new TextEncoder().encode(canonical).buffer)
  ).slice(0, 16);
  if (version !== manifest.network_version) {
    throw new Error("Network version does not match the manifest checksums");
  }
  const geojson: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !object(geojson) ||
    geojson.type !== "FeatureCollection" ||
    !Array.isArray(geojson.features) ||
    geojson.features.length !== manifest.edge_count ||
    geojson.attribution !== manifest.attribution
  ) {
    throw new Error(
      "GeoJSON must match the manifest's edge count and attribution",
    );
  }
  const ids = new Set<string>();
  for (const feature of geojson.features) {
    if (
      !object(feature) ||
      feature.type !== "Feature" ||
      typeof feature.id !== "string" ||
      !feature.id ||
      ids.has(feature.id) ||
      !object(feature.properties) ||
      feature.properties.edge_id !== feature.id ||
      !object(feature.geometry) ||
      feature.geometry.type !== "LineString" ||
      !Array.isArray(feature.geometry.coordinates) ||
      feature.geometry.coordinates.length < 2
    ) {
      throw new Error(
        "Every road must have a unique SUMO edge ID and LineString geometry",
      );
    }
    ids.add(feature.id);
    for (const point of feature.geometry.coordinates) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        typeof point[0] !== "number" ||
        typeof point[1] !== "number" ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90
      ) {
        throw new Error(
          "Road coordinates must be WGS84 longitude/latitude pairs",
        );
      }
    }
  }
  return manifest;
}
