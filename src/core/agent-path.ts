/**
 * Safe per-agent filesystem paths.
 *
 * Agent names reach the filesystem (config, wallet, memory), so they are
 * validated before being joined onto a base directory to rule out path
 * traversal (`../`, absolute paths, separators).
 *
 * @module agent-path
 */

import * as path from "node:path";

/** Same shape the HTTP API accepts when creating an agent. */
export const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export function assertAgentName(agentName: string): string {
  if (!AGENT_NAME_RE.test(agentName) || agentName.includes("..")) {
    throw new Error(`Invalid agent name "${agentName}"`);
  }
  return agentName;
}

/** `<baseDir>/<agentName>` for a validated agent name. */
export function agentDirPath(baseDir: string, agentName: string): string {
  return path.join(baseDir, assertAgentName(agentName));
}
