// SPDX-License-Identifier: Apache-2.0

/**
 * Build ERC-8004 `services[]` entries in the shape 8004scan indexes
 * (Services tab: A2A/MCP/OASF/agentWallet).
 *
 * Spec refs:
 * - https://eips.ethereum.org/EIPS/eip-8004
 * - https://best-practices.8004scan.io/docs/01-agent-metadata-standard.html
 * - https://best-practices.8004scan.io/docs/implementation/agent-metadata-parsing.md
 *
 * @module registration-services
 */

import { buildOasfService } from "./oasf.js"

export const A2A_PROTOCOL_VERSION = "0.3.0"
export const MCP_PROTOCOL_VERSION = "2025-06-18"

/** Default `version` advertised per canonical service name. */
const SERVICE_VERSIONS: Record<string, string> = {
  A2A: A2A_PROTOCOL_VERSION,
  MCP: MCP_PROTOCOL_VERSION,
}

/** Lowercased alias → name 8004scan matches on (`oasf` stays lowercase, see oasf.ts). */
const CANONICAL_SERVICE_NAMES: Record<string, string> = {
  a2a: "A2A",
  mcp: "MCP",
  ens: "ENS",
  did: "DID",
  oasf: "oasf",
  agentwallet: "agentWallet",
  wallet: "agentWallet",
  web: "web",
  email: "email",
}

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
}

/** Canonical service name for 8004scan FindService matching. */
export function canonicalizeServiceName(raw: string): string {
  const trimmed = raw.trim()
  return CANONICAL_SERVICE_NAMES[trimmed.toLowerCase()] ?? trimmed
}

/**
 * Prefer the well-known Agent Card URL for A2A services: a URL whose path ends
 * in `/a2a` is rewritten to `/.well-known/agent-card.json` on the same origin.
 * The query string is kept so `?agent=<name>` still selects that agent's card.
 */
export function normalizeA2AEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim()
  try {
    const url = new URL(trimmed)
    if (!url.pathname.replace(/\/$/, "").endsWith("/a2a")) return trimmed
    url.pathname = "/.well-known/agent-card.json"
    url.hash = ""
    return url.toString()
  } catch {
    return trimmed
  }
}

/** https anywhere, or http on localhost/127.0.0.1 (local dev). */
export function isAdvertisableUrl(url: string): boolean {
  return (
    /^https:\/\/.+/i.test(url) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(url)
  )
}

/**
 * Canonical name, normalized A2A URL and default protocol `version` meta for
 * one endpoint. Single source of truth for the API, the SDK registration file
 * and the enriched `services[]`.
 */
export function canonicalizeEndpoint(ep: RegistrationEndpoint): RegistrationEndpoint {
  const type = canonicalizeServiceName(ep.type)
  const value = type === "A2A" ? normalizeA2AEndpoint(ep.value) : ep.value.trim()
  const version = SERVICE_VERSIONS[type]
  const meta = { ...(version ? { version } : {}), ...ep.meta }
  return { type, value, ...(Object.keys(meta).length > 0 ? { meta } : {}) }
}

export function buildAgentWalletEndpoint(chainId: number, walletAddress: string): string {
  return `eip155:${chainId}:${walletAddress}`
}

/**
 * Build the decentralized identifier (DID) for an agent wallet.
 * Uses `did:pkh` (CAIP-10 based, EVM-native) so resolvers can map it
 * back to `eip155:{chainId}:{address}` without extra lookup.
 */
export function buildDID(chainId: number, walletAddress: string): string {
  return `did:pkh:eip155:${chainId}:${walletAddress}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

/**
 * Build the `services` array pinned into agentURI for 8004scan Services tab.
 * Duplicate service names (case-insensitive) keep the first entry.
 */
export async function buildRegistrationServices(
  options: BuildRegistrationServicesOptions,
): Promise<Record<string, unknown>[]> {
  const { walletAddress, chainId } = options
  const seen = new Set<string>()
  const services: Record<string, unknown>[] = []

  for (const ep of options.endpoints) {
    const { type: name, value, meta } = canonicalizeEndpoint(ep)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    // Prefer CAIP-10 when caller passed a bare 0x address.
    const endpoint =
      name === "agentWallet" && chainId != null && /^0x[a-fA-F0-9]{40}$/.test(value)
        ? buildAgentWalletEndpoint(chainId, value)
        : value
    services.push({ name, endpoint, ...meta })
  }

  // x402 readiness on 8004scan needs an agentWallet service next to the
  // top-level x402Support flag.
  if (walletAddress && chainId != null && !seen.has("agentwallet")) {
    services.push({
      name: "agentWallet",
      endpoint: buildAgentWalletEndpoint(chainId, walletAddress),
    })
  }

  // Decentralized identity: always advertise the agent wallet as a DID
  // service (`did:pkh:eip155:{chainId}:{address}`) so creation metadata
  // carries a self-sovereign identifier alongside agentWallet.
  if (walletAddress && chainId != null && !seen.has("did")) {
    services.push({ name: "DID", endpoint: buildDID(chainId, walletAddress) })
  }

  const domains = stringArray(options.metadata?.oasfDomains)
  const skills = stringArray(options.metadata?.oasfSkills)
  if ((domains.length > 0 || skills.length > 0) && !seen.has("oasf")) {
    // 8004scan does not health-check `oasf` services, so anchor the descriptor
    // URL on the agent's first http(s) endpoint (origin + /oasf).
    const anchor = options.endpoints.find((ep) => /^https?:\/\/.+/i.test(ep.value))?.value
    let oasfEndpoint = "https://example.com/oasf"
    if (anchor) {
      try {
        oasfEndpoint = `${new URL(anchor).origin}/oasf`
      } catch {
        oasfEndpoint = anchor
      }
    }
    services.push(await buildOasfService(domains, skills, oasfEndpoint))
  }

  return services
}
