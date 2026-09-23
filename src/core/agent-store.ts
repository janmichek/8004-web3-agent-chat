/**
 * Persistent agent store for serverless deployments.
 *
 * Problem: on Vercel the filesystem is ephemeral (`/tmp` per instance).
 * An agent created on instance A is invisible on instance B → chat/fund
 * return 404 "Agent not found".
 *
 * Solution: when a Vercel KV store is bound (KV_REST_API_URL +
 * KV_REST_API_TOKEN), every created agent's config + wallet is written
 * through to KV, and cold instances hydrate `/tmp` from KV on demand.
 * Without KV configured every function below is a safe no-op and the
 * previous filesystem + `AGENT_*` env-var behavior is unchanged.
 *
 * Keys:
 *   agent:<name>:config  -> AgentConfig JSON
 *   agent:<name>:wallet  -> { address, privateKey } JSON
 *   agents:index          -> SET of agent names
 *
 * @module agent-store
 */

import * as fs from "node:fs";
import * as path from "node:path";

const INDEX_KEY = "agents:index";
const keyPrefix = (name: string) => `agent:${name}`;

function kvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kv() {
  // Dynamic import so local dev / bundles without KV still work.
  const mod = await import("@vercel/kv");
  return mod.kv;
}

/** Write-through of a freshly created agent. Never throws. */
export async function persistAgentToStore(
  name: string,
  config: unknown,
  wallet: unknown,
): Promise<void> {
  if (!kvEnabled()) return;
  try {
    const store = await kv();
    const prefix = keyPrefix(name);
    await Promise.all([
      store.set(`${prefix}:config`, JSON.stringify(config)),
      store.set(`${prefix}:wallet`, JSON.stringify(wallet)),
      store.sadd(INDEX_KEY, name),
    ]);
    console.log(`[store] Persisted agent "${name}" to KV`);
  } catch (err) {
    console.warn(`[store] KV persist failed for "${name}" (ephemeral only):`, err);
  }
}

/** Names of agents persisted in KV. Empty array when KV is not configured. */
export async function listStoredAgents(): Promise<string[]> {
  if (!kvEnabled()) return [];
  try {
    const store = await kv();
    const members = await store.smembers(INDEX_KEY);
    return Array.isArray(members) ? (members as string[]) : [];
  } catch (err) {
    console.warn("[store] KV list failed:", err);
    return [];
  }
}

function tmpAgentDir(name: string): string {
  const base = process.env.VERCEL ? path.join("/tmp", "agents") : path.resolve(process.cwd(), "agents");
  return path.join(base, name);
}

/**
 * Hydrate `/tmp` files for an agent from KV so the existing synchronous
 * `loadAgentConfig` / `getOrCreateAgentWallet` filesystem paths keep working
 * on cold instances. Returns true when KV had the agent.
 */
export async function hydrateAgentFromStore(name: string): Promise<boolean> {
  if (!kvEnabled()) return false;
  try {
    const store = await kv();
    const prefix = keyPrefix(name);
    const [configRaw, walletRaw] = await Promise.all([
      store.get<string>(`${prefix}:config`),
      store.get<string>(`${prefix}:wallet`),
    ]);
    if (!configRaw && !walletRaw) return false;
    const dir = tmpAgentDir(name);
    fs.mkdirSync(dir, { recursive: true });
    if (configRaw) {
      const configStr = typeof configRaw === "string" ? configRaw : JSON.stringify(configRaw);
      fs.writeFileSync(path.join(dir, "agent-config.json"), configStr, "utf-8");
    }
    if (walletRaw) {
      const walletStr = typeof walletRaw === "string" ? walletRaw : JSON.stringify(walletRaw);
      fs.writeFileSync(path.join(dir, "wallet.json"), walletStr, "utf-8");
    }
    console.log(`[store] Hydrated agent "${name}" from KV`);
    return true;
  } catch (err) {
    console.warn(`[store] KV hydrate failed for "${name}":`, err);
    return false;
  }
}

/** Remove an agent from KV. Never throws. */
export async function deleteAgentFromStore(name: string): Promise<void> {
  if (!kvEnabled()) return;
  try {
    const store = await kv();
    const prefix = keyPrefix(name);
    await Promise.all([
      store.del(`${prefix}:config`),
      store.del(`${prefix}:wallet`),
      store.srem(INDEX_KEY, name),
    ]);
  } catch (err) {
    console.warn(`[store] KV delete failed for "${name}":`, err);
  }
}

export { kvEnabled as isStoreEnabled };
