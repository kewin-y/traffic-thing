import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  MAX_GEOJSON_BYTES,
  MAX_MANIFEST_BYTES,
  validateAssets,
} from "./lib/assets";

async function authenticateWorker(request: Request): Promise<Response | null> {
  const apiKey = process.env.WORKER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Worker uploads are not configured" },
      { status: 503 },
    );
  }

  const credentials = /^Bearer (\S+)$/i.exec(
    request.headers.get("Authorization") ?? "",
  );
  if (!credentials || !(await secretsMatch(credentials[1], apiKey))) {
    return Response.json(
      { error: "Invalid worker credentials" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  return null;
}

export const generateUploadUrl = httpAction(async (ctx, request) => {
  const denied = await authenticateWorker(request);
  if (denied) return denied;
  const uploadUrl = await ctx.storage.generateUploadUrl();
  return Response.json(
    { uploadUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const publish = httpAction(async (ctx, request) => {
  const denied = await authenticateWorker(request);
  if (denied) return denied;

  // Bound the entire body, including multipart headers, even without Content-Length.
  const limit = MAX_GEOJSON_BYTES + MAX_MANIFEST_BYTES + 64 * 1024;
  const chunks: Uint8Array[] = [];
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json({ error: "Missing publish body" }, { status: 400 });
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return Response.json(
        { error: "Network assets are too large" },
        { status: 413 },
      );
    }
    chunks.push(value);
  }
  let files: FormData;
  try {
    files = await new Response(new Blob(chunks as BlobPart[]), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return Response.json(
      { error: "Expected multipart manifest and geojson files" },
      { status: 400 },
    );
  }
  const manifestFile = files.get("manifest");
  const geojsonFile = files.get("geojson");
  if (!(manifestFile instanceof Blob) || !(geojsonFile instanceof Blob)) {
    return Response.json(
      { error: "Missing manifest or geojson file" },
      { status: 400 },
    );
  }
  let manifest;
  try {
    manifest = await validateAssets(manifestFile, geojsonFile);
  } catch {
    return Response.json(
      {
        error:
          "Invalid network assets: check manifest, checksums, version, and GeoJSON",
      },
      { status: 400 },
    );
  }

  const uploaded: Id<"_storage">[] = [];
  try {
    const geojsonStorageId = await ctx.storage.store(
      new Blob([geojsonFile], { type: "application/geo+json" }),
    );
    uploaded.push(geojsonStorageId);
    const manifestStorageId = await ctx.storage.store(
      new Blob([manifestFile], { type: "application/json" }),
    );
    uploaded.push(manifestStorageId);
    const result = await ctx.runMutation(internal.networks.mutations.register, {
      name: manifest.network,
      version: manifest.network_version,
      attribution: manifest.attribution,
      edgeCount: manifest.edge_count,
      geojsonSha256: manifest.sha256["edges.geojson"],
      geojsonStorageId,
      manifestStorageId,
    });
    return Response.json(
      {
        ...result,
        network: manifest.network,
        version: manifest.network_version,
      },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    // Files are not transactional with actions. Remove files if registration fails.
    await Promise.all(uploaded.map((id) => ctx.storage.delete(id)));
    throw error;
  }
});

async function secretsMatch(
  actual: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all(
    [actual, expected].map(
      async (value) =>
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", encoder.encode(value)),
        ),
    ),
  );
  let difference = 0;
  for (let i = 0; i < actualHash.length; i++) {
    difference |= actualHash[i] ^ expectedHash[i];
  }
  return difference === 0;
}
