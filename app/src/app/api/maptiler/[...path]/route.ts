// Server-side proxy for MapTiler so the API key never reaches the browser.
// Styles and TileJSON documents are rewritten to point back at this route.

const UPSTREAM = "https://api.maptiler.com/";
const ALLOWED_PREFIXES = [
  "maps",
  "tiles",
  "fonts",
  "sprites",
  "resources",
  "data",
];
const JSON_TYPES = /json/i;

function failure(status: number, message: string, detail?: unknown) {
  const reference = crypto.randomUUID();
  if (detail !== undefined)
    console.error(`maptiler proxy ${reference}:`, detail);
  return Response.json({ error: message, reference }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const key = process.env.MAPTILER_API_KEY;
  if (!key) {
    return failure(
      503,
      "Map tiles are not configured.",
      "MAPTILER_API_KEY is not set",
    );
  }

  const { path } = await params;
  if (
    !ALLOWED_PREFIXES.includes(path[0]) ||
    path.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return failure(404, "Not found.");
  }

  const incoming = new URL(request.url);
  // Keep "@" literal: MapTiler serves retina sprites as sprite@2x.png.
  const encoded = path.map((segment) =>
    encodeURIComponent(segment).replaceAll("%40", "@"),
  );
  const upstream = new URL(encoded.join("/"), UPSTREAM);
  incoming.searchParams.forEach((value, name) => {
    if (name !== "key") upstream.searchParams.set(name, value);
  });
  upstream.searchParams.set("key", key);

  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { accept: request.headers.get("accept") ?? "*/*" },
    });
  } catch (error) {
    return failure(502, "Map tiles are unavailable.", error);
  }
  if (!response.ok) {
    return failure(
      response.status === 404 ? 404 : 502,
      "Map tiles are unavailable.",
      `upstream ${response.status}`,
    );
  }

  const headers = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
  ]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!JSON_TYPES.test(contentType)) {
    return new Response(response.body, { status: 200, headers });
  }

  // Point nested URLs (sources, tiles, glyphs, sprites) back through the proxy
  // and drop the key from them.
  const local = `${incoming.origin}/api/maptiler/`;
  const body = (await response.text())
    .replaceAll(UPSTREAM, local)
    .replace(/([?&])key=[^&"\\]*(&?)/g, (_, lead: string, tail: string) =>
      tail ? lead : "",
    );
  return new Response(body, { status: 200, headers });
}
