// SPDX-License-Identifier: Apache-2.0

/**
 * Build ERC-8004 `services[]` entries in the shape 8004scan indexes
 * (Services tab: A2A/MCP/OASF/agentWallet + top-level x402Support).
 *
 * Spec refs:
 * - https://eips.ethereum.org/EIPS/eip-8004
 * - https://best-practices.8004scan.io/docs/01-agent-metadata-standard.html
 * - https://best-practices.8004scan.io/docs/implementation/agent-metadata-parsing.md
 *
 * @module registration-services
 */

import { buildOasfService } from "./oasf.js"

export const A2A_SERVICE_VERSION = "0.3.0"
export const MCP_SERVICE_VERSION = "2025-06-18"

export interface RegistrationEndpoint {
  type: string
  value: string
  meta?: Record<string, unknown>
}

export interface BuildRegistrationServicesOptions {
  endpoints: RegistrationEndpoint[]
  metadata?: Record<string, unknown>
  /** Operational agent wallet (0x…). Becomes services[].name === "agentWallet". */
  walletAddress?: string
  /** Chain id for CAIP-10 agentWallet endpoint (eip155:{chainId}:{address}). */
  chainId?: number
  /** When true, ensure agentWallet is present (x402 readiness on 8004scan). */
  x402support?: boolean
}

/** Canonical service name for 8004scan FindService matching. */
export function canonicalizeServiceName(raw: string): string {
  const lower = raw.trim().toLowerCase()
  switch (lower) {
    case "a2a":
      return "A2A"
    case "mcp":
      return "MCP"
    case "ens":
      return "ENS"
    case "did":
      return "DID"
    case "oasf":
      // 8004scan OASF card matches lowercase `oasf` (see oasf.ts + agent 261).
      return "oasf"
    case "agentwallet":
    case "wallet":
      return "agentWallet"
    case "web":
      return "web"
    case "email":
      return "email"
    default:
      return raw.trim()
  }
}

/**
 * Prefer the well-known Agent Card URL for A2A services.
 * `/api/a2a` and `/a2a` are rewritten to `/.well-known/agent-card.json`.
 */
export function normalizeA2AEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed) return trimmed
  if (/\/\.well-known\/agent-card\.json\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/$/, "")
  }
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/$/, "") || "/"
    if (
      path === "/api/a2a" ||
      path === "/a2a" ||
      path.endsWith("/api/a2a") ||
      path.endsWith("/a2a")
    ) {
      url.pathname = "/.well-known/agent-card.json"
      url.search = ""
      url.hash = ""
      return url.toString().replace(/\/$/, "")
    }
  } catch {
    /* keep original */
  }
  return trimmed
}

export function buildAgentWalletEndpoint(chainId: number, walletAddress: string): string {
  return `eip155:${chainId}:${walletAddress}`
}

/**
 * Build the `services` array pinned into agentURI for 8004scan Services tab.
 */
export async function buildRegistrationServices(
  options: BuildRegistrationServicesOptions,
): Promise<Record<string, unknown>[]> {
  const seen = new Set<string>()
  const services: Record<string, unknown>[] = []

  for (const ep of options.endpoints) {
    const name = canonicalizeServiceName(ep.type)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    let endpoint = ep.value.trim()
    const entry: Record<string, unknown> = {
      name,
      endpoint,
      ...(ep.meta ?? {}),
    }

    if (name === "A2A") {
      endpoint = normalizeA2AEndpoint(endpoint)
      entry.endpoint = endpoint
      if (entry.version == null) entry.version = A2A_SERVICE_VERSION
    } else if (name === "MCP") {
      if (entry.version == null) entry.version = MCP_SERVICE_VERSION
    } else if (name === "agentWallet") {
      // Prefer CAIP-10 when caller passed a bare 0x address.
      if (
        options.chainId != null &&
        /^0x[a-fA-F0-9]{40}$/.test(endpoint) &&
        !endpoint.startsWith("eip155:")
      ) {
        entry.endpoint = buildAgentWalletEndpoint(options.chainId, endpoint)
      }
    }

    services.push(entry)
  }

  // x402 readiness on 8004scan: top-level x402Support + agentWallet service.
  const wantWallet =
    Boolean(options.x402support) ||
    Boolean(options.walletAddress && options.chainId != null)
  if (
    wantWallet &&
    options.walletAddress &&
    options.chainId != null &&
    !seen.has("agentwallet")
  ) {
    services.push({
      name: "agentWallet",
      endpoint: buildAgentWalletEndpoint(options.chainId, options.walletAddress),
    })
    seen.add("agentwallet")
  }

  const domains = Array.isArray(options.metadata?.oasfDomains)
    ? (options.metadata!.oasfDomains as unknown[]).filter((d): d is string => typeof d === "string")
    : []
  const skills = Array.isArray(options.metadata?.oasfSkills)
    ? (options.metadata!.oasfSkills as unknown[]).filter((s): s is string => typeof s === "string")
    : []

  if ((domains.length > 0 || skills.length > 0) && !seen.has("oasf")) {
    const httpsEndpoint = options.endpoints.find((ep) =>
      /^https?:\/\/.+/i.test(ep.value),
    )?.value
    let oasfEndpoint = "https://example.com/oasf"
    if (httpsEndpoint) {
      try {
        oasfEndpoint = `${new URL(httpsEndpoint).origin}/oasf`
      } catch {
        oasfEndpoint = httpsEndpoint
      }
    }
    services.push(await buildOasfService(domains, skills, oasfEndpoint))
  }

  return services
}
