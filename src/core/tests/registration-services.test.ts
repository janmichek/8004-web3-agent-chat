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
  canonicalizeEndpoint,
  isAdvertisableUrl,
  A2A_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
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
    expect(canonicalizeServiceName(" Web ")).toBe("web")
    expect(canonicalizeServiceName("custom-Thing")).toBe("custom-Thing")
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

  it("keeps the ?agent= scope and leaves non-URLs alone", () => {
    expect(normalizeA2AEndpoint("https://host.example/api/a2a?agent=bob")).toBe(
      "https://host.example/.well-known/agent-card.json?agent=bob",
    )
    expect(normalizeA2AEndpoint(" not a url ")).toBe("not a url")
  })
})

describe("canonicalizeEndpoint", () => {
  it("adds default protocol version without overriding caller meta", () => {
    expect(canonicalizeEndpoint({ type: "a2a", value: " https://h.example/a2a " })).toEqual({
      type: "A2A",
      value: "https://h.example/.well-known/agent-card.json",
      meta: { version: A2A_PROTOCOL_VERSION },
    })
    expect(
      canonicalizeEndpoint({ type: "mcp", value: "https://h.example/mcp", meta: { version: "x" } }).meta,
    ).toEqual({ version: "x" })
    expect(canonicalizeEndpoint({ type: "email", value: "e@mail.fun" })).toEqual({
      type: "email",
      value: "e@mail.fun",
    })
  })
})

describe("isAdvertisableUrl", () => {
  it("accepts https and local http only", () => {
    expect(isAdvertisableUrl("https://host.example/api/a2a")).toBe(true)
    expect(isAdvertisableUrl("http://localhost:8787")).toBe(true)
    expect(isAdvertisableUrl("http://127.0.0.1:5173/api/mcp")).toBe(true)
    expect(isAdvertisableUrl("http://host.example/api/a2a")).toBe(false)
    expect(isAdvertisableUrl("ftp://not-allowed/a2a")).toBe(false)
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
    })

    const byName = Object.fromEntries(services.map((s) => [String(s.name), s]))

    expect(byName.A2A).toMatchObject({
      name: "A2A",
      endpoint: "http://localhost:8787/.well-known/agent-card.json",
      version: A2A_PROTOCOL_VERSION,
    })
    expect(byName.MCP).toMatchObject({
      name: "MCP",
      endpoint: "http://localhost:5173/api/mcp",
      version: MCP_PROTOCOL_VERSION,
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
    })
    expect(services.filter((s) => s.name === "agentWallet")).toHaveLength(1)
  })

  it("adds agentWallet only when wallet + chainId are known", async () => {
    const endpoints = [{ type: "MCP", value: "http://localhost:5173/api/mcp" }]
    const without = await buildRegistrationServices({ endpoints })
    expect(without.map((s) => s.name)).toEqual(["MCP"])

    const withWallet = await buildRegistrationServices({
      endpoints,
      walletAddress: "0x4992cfb9899eade72df11a2ea3b904b39ceaccc7",
      chainId: 421614,
    })
    expect(withWallet.map((s) => s.name)).toEqual(["MCP", "agentWallet", "DID"])
  })

  it("converts a bare 0x agentWallet endpoint to CAIP-10 and dedupes names", async () => {
    const services = await buildRegistrationServices({
      endpoints: [
        { type: "wallet", value: "0x4992cfb9899eade72df11a2ea3b904b39ceaccc7" },
        { type: "mcp", value: "https://a.example/mcp" },
        { type: "MCP", value: "https://b.example/mcp" },
      ],
      chainId: 421614,
    })
    expect(services).toEqual([
      { name: "agentWallet", endpoint: "eip155:421614:0x4992cfb9899eade72df11a2ea3b904b39ceaccc7" },
      { name: "MCP", endpoint: "https://a.example/mcp", version: MCP_PROTOCOL_VERSION },
    ])
  })
})
