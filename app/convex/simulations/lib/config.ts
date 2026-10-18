import { env } from "../../_generated/server";

export function workerConfiguration() {
  const address = env.WORKER_URL;
  if (!address || !env.WORKER_API_KEY)
    return {
      ready: false as const,
      message: "The simulation worker is not configured yet.",
      transport: "pull" as const,
      url: null,
    };
  try {
    const url = new URL(address);
    if (url.username || url.password || url.search || url.hash)
      throw new Error("Invalid worker URL");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local && url.protocol !== "https:")
      throw new Error("Worker URL must use HTTPS");
    if (local && !["http:", "https:"].includes(url.protocol))
      throw new Error("Invalid worker URL");
    return {
      ready: true as const,
      message: null,
      transport: local ? ("pull" as const) : ("push" as const),
      url: url.toString().replace(/\/$/, ""),
    };
  } catch {
    return {
      ready: false as const,
      message: "The simulation worker URL is invalid.",
      transport: "pull" as const,
      url: null,
    };
  }
}
