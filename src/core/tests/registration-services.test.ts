/**
 * 8004scan Services-tab shape for A2A / x402 / agentWallet.
 *
 * Run: npx vitest run src/core/tests/registration-services.test.ts
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildRegistrationServices,
  canonicalizeServiceName,
  normalizeA2AEndpoint,
  buildAgentWalletEndpoint,
  A2A_SERVICE_VERSION,
  MCP_SERVICE_VERSION,
} from "../registration-services.js"

vi.mock("../oasf.js", () => ({
  buildOasfService: async (
    domains: string[],
    skills: string[],
    endpoint: string,
  ) => ({
    name: "oasf",
    endpoint,
    version: "1.1.0",
    skills,
    domains: domains.map((d) => (d === "1" ? "language_processing" : d)),
  }),
}))

describe("canonicalizeServiceName", () => {
  it("maps protocol names to 8004scan casing", () => {
    expect(canonicalizeServiceName("a2a")).toBe("A2A")
    expect(canonicalizeServiceName("A2A")).toBe("A2A")
    expect(canonicalizeServiceName("mcp")).toBe("MCP")
    expect(canonicalizeServiceName("oasf")).toBe("oasf")
    expect(canonicalizeServiceName("wallet")).toBe("agentWallet")
    expect(canonicalizeServiceName("agentWallet")).toBe("agentWallet")
  })
})

describe("normalizeA2AEndpoint", () => {
  it("rewrites /api/a2a and /a2a to well-known agent-card", () => {
    expect(normalizeA2AEndpoint("https://host.example/api/a2a")).toBe(
      "https://host.example/.well-known/agent-card.json",
    )
    expect(normalizeA2AEndpoint("http://localhost:8787/a2a")).toBe(
      "http://localhost:8787/.well-known/agent-card.json",
    )
  })

  it("leaves agent-card URLs unchanged", () => {
    const card = "https://host.example/.well-known/agent-card.json"
    expect(normalizeA2AEndpoint(card)).toBe(card)
  })
})

describe("buildRegistrationServices (8004scan Services tab)", () => {
  it("emits A2A + MCP versions, agentWallet CAIP-10, and oasf", async () => {
    const services = await buildRegistrationServices({
      endpoints: [
        { type: "web", value: "https://example.com" },
        { type: "email", value: "e@mail.fun" },
        { type: "a2a", value: "http://localhost:8787/api/a2a" },
        { type: "mcp", value: "http://localhost:5173/api/mcp" },
      ],
      metadata: {
        oasfDomains: ["1"],
        oasfSkills: ["101", "301"],
      },
      walletAddress: "0x4992cfb9899eade72df11a2ea3b904b39ceaccc7",
      chainId: 421614,
      x402support: true,
    })

    const byName = Object.fromEntries(services.map((s) => [String(s.name), s]))

    expect(byName.A2A).toMatchObject({
      name: "A2A",
      endpoint: "http://localhost:8787/.well-known/agent-card.json",
      version: A2A_SERVICE_VERSION,
    })
    expect(byName.MCP).toMatchObject({
      name: "MCP",
      endpoint: "http://localhost:5173/api/mcp",
      version: MCP_SERVICE_VERSION,
    })
    expect(byName.agentWallet).toMatchObject({
      name: "agentWallet",
      endpoint: buildAgentWalletEndpoint(
        421614,
        "0x4992cfb9899eade72df11a2ea3b904b39ceaccc7",
      ),
    })
    expect(byName.oasf).toMatchObject({
      name: "oasf",
      skills: ["101", "301"],
    })
    expect(byName.web?.endpoint).toBe("https://example.com")
    expect(byName.email?.endpoint).toBe("e@mail.fun")
  })

  it("does not duplicate agentWallet when already provided", async () => {
    const services = await buildRegistrationServices({
      endpoints: [
        {
          type: "agentWallet",
          value: "eip155:421614:0x4992cfb9899eade72df11a2ea3b904b39ceaccc7",
        },
      ],
      walletAddress: "0x4992cfb9899eade72df11a2ea3b904b39ceaccc7",
      chainId: 421614,
      x402support: true,
    })
    expect(services.filter((s) => s.name === "agentWallet")).toHaveLength(1)
  })

  it("matches agent 261 gap: adding A2A+x402 changes supported protocol set", async () => {
    // Baseline like h2000/261 today (no A2A, no agentWallet service).
    const before = await buildRegistrationServices({
      endpoints: [
        { type: "web", value: "https://example.com" },
        { type: "email", value: "e@mail.fun" },
        { type: "MCP", value: "http://localhost:5173/api/mcp" },
      ],
      metadata: { oasfDomains: ["1"], oasfSkills: ["101"] },
      x402support: false,
    })
    expect(before.some((s) => s.name === "A2A")).toBe(false)
    expect(before.some((s) => s.name === "agentWallet")).toBe(false)

    const after = await buildRegistrationServices({
      endpoints: [
        { type: "web", value: "https://example.com" },
        { type: "email", value: "e@mail.fun" },
        { type: "MCP", value: "http://localhost:5173/api/mcp" },
        { type: "A2A", value: "https://public.host/api/a2a" },
      ],
      metadata: { oasfDomains: ["1"], oasfSkills: ["101"] },
      walletAddress: "0x4992cfb9899eade72df11a2ea3b904b39ceaccc7",
      chainId: 421614,
      x402support: true,
    })
    expect(after.map((s) => s.name)).toEqual(
      expect.arrayContaining(["A2A", "MCP", "oasf", "agentWallet", "web", "email"]),
    )
  })
})
