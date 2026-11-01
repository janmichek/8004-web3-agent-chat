import type { Context } from "hono";

const RATE_WINDOW_MS = Number(process.env.MCP_RATE_WINDOW_MS || 60_000);
/** Per-IP budget for routes that spend master funds or call the LLM. */
const SPEND_RATE_MAX = Number(process.env.SPEND_RATE_MAX || 20);
const rateHits = new Map<string, number[]>();

export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** First line of an error's message, falling back to a stringified throw. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parses a JSON request body; `null` means the body was not valid JSON. */
export async function readJsonBody<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

export const RATE_LIMITED = "rate limited, try again later";

/** Anonymous routes that move master funds or run the LLM: per-IP budget, checked before any work. */
export function overSpendBudget(c: Context, route: string): boolean {
  return !checkRateLimit(`${route}:${getClientIp(c)}`, SPEND_RATE_MAX);
}

/** Sliding-window counter per key (e.g. `mcp:<ip>`, `fund:<ip>`). */
export function checkRateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(key, hits);
  // Prevent unbounded growth across many IPs (serverless instance memory).
  if (rateHits.size > 1000) {
    const oldest = [...rateHits.keys()].slice(0, rateHits.size - 1000);
    for (const k of oldest) rateHits.delete(k);
  }
  return hits.length <= max;
}
