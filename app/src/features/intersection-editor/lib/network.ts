import type { FeatureCollection, LineString } from "geojson";

export const NETWORK_NAME = "toronto-downtown";
export const NETWORK_SOURCE = "imported-network";
export const NETWORK_LAYER = "imported-roads";

export interface RoadProperties {
  edge_id: string;
  name: string;
  lane_count: number;
  speed_mps: number;
  length_metres: number;
}

export interface PublishedNetwork {
  id: string;
  name: string;
  version: string;
  attribution: string;
  edgeCount: number;
  geojsonUrl: string;
  manifestUrl: string;
}

export interface LoadedNetwork extends PublishedNetwork {
  roads: FeatureCollection<LineString, RoadProperties>;
  bounds: [[number, number], [number, number]];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function loadNetwork(
  network: PublishedNetwork,
  signal: AbortSignal,
): Promise<LoadedNetwork> {
  const [mapResponse, manifestResponse] = await Promise.all([
    fetch(network.geojsonUrl, { signal }),
    fetch(network.manifestUrl, { signal }),
  ]);
  if (!mapResponse.ok || !manifestResponse.ok)
    throw new Error("Network download failed");
  const [bytes, manifest] = await Promise.all([
    mapResponse.arrayBuffer(),
    manifestResponse.json() as Promise<unknown>,
  ]);
  if (
    !object(manifest) ||
    manifest.network !== network.name ||
    manifest.network_version !== network.version ||
    !object(manifest.sha256)
  ) {
    throw new Error("Network manifest does not match the published version");
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = Array.from(hash, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (checksum !== manifest.sha256["edges.geojson"])
    throw new Error("Network checksum mismatch");
  const bbox = manifest.simulation_bbox_wgs84;
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((n) => typeof n === "number" && Number.isFinite(n)) ||
    bbox[0] < -180 ||
    bbox[2] > 180 ||
    bbox[1] < -90 ||
    bbox[3] > 90 ||
    bbox[0] >= bbox[2] ||
    bbox[1] >= bbox[3]
  ) {
    throw new Error("Network bounds are invalid");
  }
  const roads: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !object(roads) ||
    roads.type !== "FeatureCollection" ||
    !Array.isArray(roads.features) ||
    roads.features.length !== network.edgeCount ||
    manifest.edge_count !== network.edgeCount
  ) {
    throw new Error("Network roads do not match the published import");
  }
  // The publisher validates coordinates and unique edge IDs. Check the fields
  // consumed by the inspector too, before trusting data downloaded from storage.
  for (const feature of roads.features) {
    const props = object(feature) ? feature.properties : null;
    if (
      !object(feature) ||
      feature.type !== "Feature" ||
      !object(props) ||
      typeof props.edge_id !== "string" ||
      feature.id !== props.edge_id ||
      typeof props.name !== "string" ||
      !Number.isInteger(props.lane_count) ||
      Number(props.lane_count) < 1 ||
      typeof props.speed_mps !== "number" ||
      !Number.isFinite(props.speed_mps) ||
      props.speed_mps < 0 ||
      typeof props.length_metres !== "number" ||
      !Number.isFinite(props.length_metres) ||
      props.length_metres < 0 ||
      !object(feature.geometry) ||
      feature.geometry.type !== "LineString"
    ) {
      throw new Error("Network road properties are invalid");
    }
  }
  return {
    ...network,
    roads: roads as unknown as LoadedNetwork["roads"],
    bounds: [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ],
  };
}
