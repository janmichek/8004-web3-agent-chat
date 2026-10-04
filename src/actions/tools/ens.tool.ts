// SPDX-License-Identifier: Apache-2.0

import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Chain,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet, sepolia } from "viem/chains"
import { normalize, toCoinType } from "viem/ens"
import { getActiveNetwork, getChainId, getNetworkConfig, getRpcUrl } from "../../core/config.js"

/** L1 ReverseRegistrar.setName — also present on ENS L2 reverse registrars. */
const reverseRegistrarAbi = parseAbi([
  "function setName(string name) returns (bytes32)",
])

/**
 * Chain-specific reverse registrars (ENSIP-19).
 * @see https://docs.ens.domains/learn/deployments/
 */
const REVERSE_REGISTRARS: Record<number, Address> = {
  // Ethereum mainnet (addr.reverse)
  1: getAddress("0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb"),
  // Ethereum Sepolia (addr.reverse)
  11155111: getAddress("0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6"),
  // Arbitrum One
  42161: getAddress("0x0000000000D8e504002cC26E3Ec46D81971C1664"),
  // Arbitrum Sepolia
  421614: getAddress("0x00000BeEF055f7934784D6d81b6BC86665630dbA"),
}

function isTestnetAgent(): boolean {
  return Boolean(getNetworkConfig().testnet)
}

/** L1 chain used for ENS forward/reverse resolution (Universal Resolver). */
function ensResolutionChain(): Chain {
  return isTestnetAgent() ? sepolia : mainnet
}

/**
 * RPC for the L1 ENS resolution chain.
 * Order: ENS_RPC_URL, then network-specific RPC, then a public fallback.
 */
function ensResolutionRpcUrl(): string {
  const override = process.env.ENS_RPC_URL?.trim()
  if (override) return override
  if (isTestnetAgent()) {
    try {
      return getRpcUrl("ethereum-sepolia")
    } catch {
      return "https://ethereum-sepolia-rpc.publicnode.com"
    }
  }
  return "https://ethereum.publicnode.com"
}

function ensPublicClient() {
  const chain = ensResolutionChain()
  return createPublicClient({
    chain,
    transport: http(ensResolutionRpcUrl()),
  })
}

function agentWalletClients() {
  const privateKey = process.env.AGENT_PRIVATE_KEY
  if (!privateKey) {
    throw new Error("AGENT_PRIVATE_KEY environment variable is not set")
  }
  const rpcUrl = getRpcUrl()
  const config = getNetworkConfig()
  const chain = defineChain({
    id: getChainId(),
    name: config.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
  return { account, publicClient, walletClient, chain, chainId: chain.id, explorerUrl: config.explorerUrl }
}

function agentAddress(): Address {
  const pk = process.env.AGENT_PRIVATE_KEY
  if (!pk) throw new Error("AGENT_PRIVATE_KEY environment variable is not set")
  return privateKeyToAccount(pk as `0x${string}`).address
}

function truncateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.length > 300 ? message.slice(0, 300) + "..." : message
}

function coinTypeForAgentChain(): bigint | undefined {
  const chainId = getChainId()
  // L1 addr records use the default coin type; L2 needs ENSIP-19 coinType.
  if (chainId === 1 || chainId === 11155111) return undefined
  return toCoinType(chainId)
}

/**
 * @notice Resolve an ENS name to an address (forward resolution via L1 Universal Resolver).
 * Never throws; returns the address or an error string.
 */
export const resolveEnsTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "resolve_ens",
  description:
    "Resolve an ENS name (e.g. 'alice.eth') to an Ethereum address. " +
    "Uses the agent's chain coin type when not on Ethereum L1.",
  schema: z.object({
    name: z.string().describe("ENS name to resolve, e.g. 'myagent.eth'"),
  }),
  func: async ({ name }): Promise<string> => {
    try {
      const normalized = normalize(name.trim())
      const client = ensPublicClient()
      const coinType = coinTypeForAgentChain()
      const address = await client.getEnsAddress({
        name: normalized,
        ...(coinType != null ? { coinType } : {}),
      })
      if (!address) {
        return `Error: ${normalized} does not resolve to an address on ${ensResolutionChain().name}`
      }
      return address
    } catch (err) {
      return `Error: ${truncateError(err)}`
    }
  },
})

/**
 * @notice Look up the primary ENS name for an address (reverse resolution).
 * Defaults to the agent wallet when address is omitted.
 */
export const lookupEnsTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "lookup_ens",
  description:
    "Look up the primary ENS name for a wallet address. " +
    "Omit address to use the agent's own wallet.",
  schema: z.object({
    address: z
      .string()
      .optional()
      .describe("Wallet address (0x...). If omitted, uses the agent wallet."),
  }),
  func: async ({ address: addressInput }): Promise<string> => {
    try {
      let address: Address
      if (addressInput?.trim()) {
        address = getAddress(addressInput.trim())
      } else {
        address = agentAddress()
      }
      const client = ensPublicClient()
      const coinType = coinTypeForAgentChain()
      const name = await client.getEnsName({
        address,
        ...(coinType != null ? { coinType } : {}),
      })
      if (!name) {
        return `No primary ENS name for ${address}`
      }
      return name
    } catch (err) {
      return `Error: ${truncateError(err)}`
    }
  },
})

/**
 * @notice Set the agent wallet's primary ENS name via the chain reverse registrar.
 * Does not buy or register names — the name must already be owned and resolve to the agent.
 */
export const setPrimaryEnsTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "set_primary_ens",
  description:
    "Set the agent wallet's primary ENS name (reverse record) on the current chain. " +
    "Requires owning the name already; does not purchase or register .eth names. " +
    "Returns the transaction hash on success.",
  schema: z.object({
    name: z.string().describe("ENS name to set as primary, e.g. 'myagent.eth'"),
  }),
  func: async ({ name }): Promise<string> => {
    try {
      const normalized = normalize(name.trim())
      const { account, publicClient, walletClient, chain, chainId, explorerUrl } = agentWalletClients()
      const registrar = REVERSE_REGISTRARS[chainId]
      if (!registrar) {
        return (
          `Error: Primary ENS name is not supported on chain ${chainId} (${getActiveNetwork()}). ` +
          `Supported: Ethereum Sepolia, Arbitrum Sepolia, Arbitrum One, Ethereum mainnet.`
        )
      }

      // Require forward resolution to match so reverse records verify as primary names.
      const ensClient = ensPublicClient()
      const coinType = coinTypeForAgentChain()
      const resolved = await ensClient.getEnsAddress({
        name: normalized,
        ...(coinType != null ? { coinType } : {}),
      })
      if (!resolved) {
        return (
          `Error: ${normalized} does not resolve to any address. ` +
          `Set the name's address record to ${account.address} first (e.g. via app.ens.domains), then retry.`
        )
      }
      if (getAddress(resolved) !== getAddress(account.address)) {
        return (
          `Error: ${normalized} resolves to ${resolved}, but the agent wallet is ${account.address}. ` +
          `Update the name's address record to the agent wallet before setting the primary name.`
        )
      }

      const hash = await walletClient.writeContract({
        address: registrar,
        abi: reverseRegistrarAbi,
        functionName: "setName",
        args: [normalized],
        account,
        chain,
      })
      await publicClient.waitForTransactionReceipt({ hash })

      const txUrl = explorerUrl ? `${explorerUrl}/tx/${hash}` : hash
      return `Primary ENS name set to ${normalized}. tx: ${txUrl}`
    } catch (err) {
      return `Error: ${truncateError(err)}`
    }
  },
})
