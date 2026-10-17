import { httpAction } from "../_generated/server";

export const generateUploadUrl = httpAction(async (ctx, request) => {
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

  const uploadUrl = await ctx.storage.generateUploadUrl();
  return Response.json(
    { uploadUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
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
