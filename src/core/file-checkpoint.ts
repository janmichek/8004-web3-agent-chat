/**
 * File-based checkpoint saver for persistent agent memory.
 *
 * Wraps MemorySaver and syncs to/from a JSON file in the agent's directory.
 * Memory survives process restarts. Where a remote store is configured
 * (Upstash Redis on Vercel), `createPersistentCheckpointer` syncs there instead.
 *
 * @module file-checkpoint
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import { AGENTS_DIR } from "./wallet.js";
import { loadRemoteMemory, remoteMemoryEnabled, saveRemoteMemory } from "./memory-store.js";

/** Fill a MemorySaver from parsed memory.json data. */
function hydrate(saver: MemorySaver, data: any) {
  if (data.storage) {
    for (const threadId of Object.keys(data.storage)) {
      saver.storage[threadId] = {};
      for (const ns of Object.keys(data.storage[threadId])) {
        saver.storage[threadId][ns] = {};
        for (const key of Object.keys(data.storage[threadId][ns])) {
          const entry = data.storage[threadId][ns][key];
          saver.storage[threadId][ns][key] = [
            Uint8Array.from(Buffer.from(entry[0], "base64")),
            Uint8Array.from(Buffer.from(entry[1], "base64")),
            entry[2],
          ];
        }
      }
    }
  }
  if (data.writes) {
    for (const threadId of Object.keys(data.writes)) {
      saver.writes[threadId] = {};
      for (const key of Object.keys(data.writes[threadId])) {
        const entry = data.writes[threadId][key];
        saver.writes[threadId][key] = [
          entry[0],
          entry[1],
          Uint8Array.from(Buffer.from(entry[2], "base64")),
        ];
      }
    }
  }
}

/** Serialize a MemorySaver to memory.json text (Uint8Arrays as base64). */
function serialize(saver: MemorySaver): string {
  const storage: Record<string, Record<string, Record<string, [string, string, string | undefined]>>> = {};
  for (const threadId of Object.keys(saver.storage)) {
    storage[threadId] = {};
    for (const ns of Object.keys(saver.storage[threadId])) {
      storage[threadId][ns] = {};
      for (const key of Object.keys(saver.storage[threadId][ns])) {
        const entry = saver.storage[threadId][ns][key];
        storage[threadId][ns][key] = [
          Buffer.from(entry[0]).toString("base64"),
          Buffer.from(entry[1]).toString("base64"),
          entry[2],
        ];
      }
    }
  }

  const writes: Record<string, Record<string, [string, string, string]>> = {};
  for (const threadId of Object.keys(saver.writes)) {
    writes[threadId] = {};
    for (const key of Object.keys(saver.writes[threadId])) {
      const entry = saver.writes[threadId][key];
      writes[threadId][key] = [
        entry[0],
        entry[1],
        Buffer.from(entry[2]).toString("base64"),
      ];
    }
  }

  return JSON.stringify({ storage, writes });
}

/**
 * Creates a MemorySaver that loads from and saves to disk.
 *
 * On creation, loads existing state from `agents/<agentName>/memory.json`.
 * Call `flush()` after each invoke to persist changes.
 */
export function createFileCheckpointer(agentName: string) {
  // On Vercel the filesystem is read-only except /tmp — use /tmp for ephemeral memory
  // Memory is per-invocation only on Vercel; see createPersistentCheckpointer for the Redis-backed path
  const isVercel = !!process.env.VERCEL;
  const baseDir = isVercel ? path.join(os.tmpdir(), "agents") : AGENTS_DIR;
  const memoryPath = path.join(baseDir, agentName, "memory.json");
  // Also try original AGENTS_DIR as fallback for read (local dev bundle on Vercel)
  const fallbackPath = isVercel ? path.join(AGENTS_DIR, agentName, "memory.json") : null;
  const saver = new MemorySaver();

  // Load existing state — try tmp first, then fallback
  const loadPaths = fallbackPath ? [memoryPath, fallbackPath] : [memoryPath];
  for (const p of loadPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      hydrate(saver, JSON.parse(fs.readFileSync(p, "utf-8")));
      console.log(`[memory] Loaded conversation from ${p}`);
      break;
    } catch {
      console.warn(`[memory] Could not load memory file ${p}, starting fresh.`);
    }
  }

  function flush() {
    try {
      fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
      fs.writeFileSync(memoryPath, serialize(saver), "utf-8");
    } catch (err) {
      // On Vercel the filesystem may be read-only or /tmp may be unavailable — degrade gracefully
      if (isVercel) {
        console.warn(`[memory] Vercel flush skipped (ephemeral): ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  }

  return { saver, flush };
}

/**
 * Like `createFileCheckpointer`, but backed by the remote store when one is
 * configured, so memory survives serverless instances. Falls back to the file
 * checkpointer otherwise. `flush()` is async here — await it.
 */
export async function createPersistentCheckpointer(agentName: string) {
  if (!remoteMemoryEnabled()) {
    const { saver, flush } = createFileCheckpointer(agentName);
    return { saver, flush: async () => flush() };
  }

  const saver = new MemorySaver();
  try {
    const raw = await loadRemoteMemory(agentName);
    if (raw) {
      hydrate(saver, JSON.parse(raw));
      console.log(`[memory] Loaded conversation for ${agentName} from remote store`);
    }
  } catch (err) {
    console.warn(`[memory] Could not load remote memory for ${agentName}, starting fresh: ${(err as Error).message}`);
  }

  async function flush() {
    try {
      await saveRemoteMemory(agentName, serialize(saver));
    } catch (err) {
      console.warn(`[memory] Remote flush failed for ${agentName}: ${(err as Error).message}`);
    }
  }

  return { saver, flush };
}
