import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findNetworkByAgentId,
  getActiveNetwork,
  getAgentScanUrl,
  getChainId,
  getRpcUrl,
  getSupportedNetworkByChainId,
  getSupportedNetworks,
  runWithNetwork,
} from "../config.js";

afterEach(() => vi.unstubAllEnvs());

describe("network scoping", () => {
  it("defaults to NETWORK and switches inside runWithNetwork only", async () => {
    vi.stubEnv("NETWORK", "");
    expect(getActiveNetwork()).toBe("arbitrum-sepolia");
    const inside = await runWithNetwork("ethereum-sepolia", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return [getActiveNetwork(), getChainId()];
    });
    expect(inside).toEqual(["ethereum-sepolia", 11155111]);
    expect(getActiveNetwork()).toBe("arbitrum-sepolia");
  });

  it("keeps concurrent scopes apart", async () => {
    const seen = await Promise.all(
      (["arbitrum-sepolia", "ethereum-sepolia"] as const).map((network, i) =>
        runWithNetwork(network, async () => {
          await new Promise((r) => setTimeout(r, 5 * (2 - i)));
          return getChainId();
        }),
      ),
    );
    expect(seen).toEqual([421614, 11155111]);
  });

  it("lists the default network first, without duplicates", () => {
    vi.stubEnv("NETWORK", "ethereum-sepolia");
    expect(getSupportedNetworks()).toEqual(["ethereum-sepolia", "arbitrum-sepolia"]);
    vi.stubEnv("NETWORK", "arbitrum-one");
    expect(getSupportedNetworks()).toEqual(["arbitrum-one", "arbitrum-sepolia", "ethereum-sepolia"]);
    expect(getSupportedNetworkByChainId("11155111")).toBe("ethereum-sepolia");
    expect(getSupportedNetworkByChainId(1)).toBeUndefined();
  });
});

describe("getRpcUrl", () => {
  it("prefers RPC_URL_<NETWORK>, then RPC_URL for the default network", () => {
    vi.stubEnv("NETWORK", "arbitrum-sepolia");
    vi.stubEnv("RPC_URL", "https://default.example");
    vi.stubEnv("RPC_URL_ETHEREUM_SEPOLIA", "https://sepolia.example");
    expect(getRpcUrl()).toBe("https://default.example");
    expect(getRpcUrl("ethereum-sepolia")).toBe("https://sepolia.example");
    vi.stubEnv("RPC_URL_ARBITRUM_SEPOLIA", "https://arb.example");
    expect(getRpcUrl()).toBe("https://arb.example");
  });

  it("never hands RPC_URL to another network: falls back to its public RPC", () => {
    vi.stubEnv("NETWORK", "arbitrum-sepolia");
    vi.stubEnv("RPC_URL", "https://default.example");
    vi.stubEnv("RPC_URL_ETHEREUM_SEPOLIA", "");
    expect(getRpcUrl("ethereum-sepolia")).toBe("https://ethereum-sepolia-rpc.publicnode.com");
  });

  it("throws for the default network when nothing is configured", () => {
    vi.stubEnv("NETWORK", "arbitrum-sepolia");
    vi.stubEnv("RPC_URL", "");
    vi.stubEnv("RPC_URL_ARBITRUM_SEPOLIA", "");
    expect(() => getRpcUrl()).toThrow(/RPC_URL or RPC_URL_ARBITRUM_SEPOLIA/);
  });
});

describe("agent IDs", () => {
  it("resolves the chain an agent ID names", () => {
    expect(findNetworkByAgentId("11155111:7")).toBe("ethereum-sepolia");
    expect(findNetworkByAgentId("7")).toBeUndefined();
    expect(findNetworkByAgentId("999999:7")).toBeUndefined();
  });

  it("builds 8004scan URLs per network", () => {
    expect(getAgentScanUrl("11155111:7")).toBe("https://testnet.8004scan.io/agents/sepolia/7");
    expect(getAgentScanUrl("42", "arbitrum-sepolia")).toBe(
      "https://testnet.8004scan.io/agents/arbitrum-sepolia/42",
    );
    expect(getAgentScanUrl("42161:3")).toBe("https://8004scan.io/agents/arbitrum-one/3");
  });
});
