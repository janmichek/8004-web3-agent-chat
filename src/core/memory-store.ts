/**
 * Remote memory store (Upstash Redis) for deployments without a persistent disk.
 *
 * Enabled when the Vercel Marketplace Upstash vars (`KV_REST_API_URL` /
 * `KV_REST_API_TOKEN`) are set. Otherwise callers fall back to memory.json.
 *
 * @module memory-store
 */

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export function remoteMemoryEnabled(): boolean {
  return getClient() !== null;
}

const key = (agentName: string) => `agent-memory:${agentName}`;

/** Raw memory.json text for an agent, or null if none stored. */
export async function loadRemoteMemory(agentName: string): Promise<string | null> {
  const redis = getClient();
  if (!redis) return null;
  const value = await redis.get<string>(key(agentName));
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export async function saveRemoteMemory(agentName: string, json: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  await redis.set(key(agentName), json);
}
