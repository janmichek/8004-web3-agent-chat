// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest"

const getEnsAddress = vi.fn()
const getEnsName = vi.fn()
const writeContract = vi.fn()
const waitForTransactionReceipt = vi.fn()

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem")
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getEnsAddress,
      getEnsName,
      waitForTransactionReceipt,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract,
      chain: { id: 421614 },
    })),
    http: vi.fn(),
    defineChain: vi.fn((chain: unknown) => chain),
  }
})

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0x1234567890AbcdEF1234567890aBcdef12345678",
  })),
}))

vi.mock("../../core/config.js", () => ({
  getRpcUrl: () => "http://localhost:8545",
  getChainId: () => 421614,
  getActiveNetwork: () => "arbitrum-sepolia",
  getNetworkConfig: () => ({
    name: "Arbitrum Sepolia",
    chainId: 421614,
    testnet: true,
    explorerUrl: "https://sepolia.arbiscan.io",
  }),
}))

describe("ens tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("AGENT_PRIVATE_KEY", "0x0000000000000000000000000000000000000000000000000000000000000001")
    getEnsAddress.mockResolvedValue("0x1234567890AbcdEF1234567890aBcdef12345678")
    getEnsName.mockResolvedValue("mybot.eth")
    writeContract.mockResolvedValue("0xabc123")
    waitForTransactionReceipt.mockResolvedValue({ status: "success" })
  })

  it("resolve_ens returns an address", async () => {
    const { resolveEnsTool } = await import("../tools/ens.tool.js")
    const result = await resolveEnsTool.invoke({ name: "mybot.eth" })
    expect(result).toBe("0x1234567890AbcdEF1234567890aBcdef12345678")
    expect(getEnsAddress).toHaveBeenCalled()
  })

  it("lookup_ens returns primary name for agent wallet", async () => {
    const { lookupEnsTool } = await import("../tools/ens.tool.js")
    const result = await lookupEnsTool.invoke({})
    expect(result).toBe("mybot.eth")
  })

  it("lookup_ens reports when no primary name is set", async () => {
    getEnsName.mockResolvedValueOnce(null)
    const { lookupEnsTool } = await import("../tools/ens.tool.js")
    const result = await lookupEnsTool.invoke({
      address: "0x1234567890AbcdEF1234567890aBcdef12345678",
    })
    expect(result).toContain("No primary ENS name")
  })

  it("set_primary_ens rejects mismatched forward resolution", async () => {
    getEnsAddress.mockResolvedValueOnce("0x0000000000000000000000000000000000000001")
    const { setPrimaryEnsTool } = await import("../tools/ens.tool.js")
    const result = await setPrimaryEnsTool.invoke({ name: "mybot.eth" })
    expect(result).toContain("Error")
    expect(result).toContain("resolves to")
    expect(writeContract).not.toHaveBeenCalled()
  })

  it("set_primary_ens writes reverse record when resolution matches", async () => {
    const { setPrimaryEnsTool } = await import("../tools/ens.tool.js")
    const result = await setPrimaryEnsTool.invoke({ name: "mybot.eth" })
    expect(result).toContain("Primary ENS name set to mybot.eth")
    expect(result).toContain("0xabc123")
    expect(writeContract).toHaveBeenCalled()
  })

  it("set_primary_ens returns error without private key", async () => {
    vi.stubEnv("AGENT_PRIVATE_KEY", "")
    const { setPrimaryEnsTool } = await import("../tools/ens.tool.js")
    const result = await setPrimaryEnsTool.invoke({ name: "mybot.eth" })
    expect(result).toContain("Error")
    expect(result).toContain("AGENT_PRIVATE_KEY")
  })
})

describe("ens-name skill", () => {
  it("has name, description, and context fields", async () => {
    const { ensNameSkill } = await import("../skills/ens-name.skill.js")
    expect(ensNameSkill.name).toBe("ens-name")
    expect(ensNameSkill.description).toBeTruthy()
    expect(ensNameSkill.context).toContain("set_primary_ens")
  })
})

describe("EnsNameAction factory", () => {
  it("returns object with tools and skill", async () => {
    const { EnsNameAction } = await import("../index.js")
    const action = EnsNameAction()
    expect(action.name).toBe("ens-name")
    expect(action.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["resolve_ens", "lookup_ens", "set_primary_ens"]),
    )
    expect(action.skill.name).toBe("ens-name")
  })
})
