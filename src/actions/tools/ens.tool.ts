// SPDX-License-Identifier: Apache-2.0

import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import {
  concat,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Chain,
  type Hex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet, sepolia } from "viem/chains"
import { labelhash, normalize, packetToBytes, toCoinType } from "viem/ens"
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

/** ENSv2 ETHRegistrar: commit-reveal registration paid in an ERC-20. */
const ethRegistrarAbi = parseAbi([
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function MAX_COMMITMENT_AGE() view returns (uint64)",
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
])

const ethRegistryAbi = parseAbi([
  "function getOwner(uint256 anyId) view returns (address)",
  "function getResolver(string label) view returns (address)",
])

const paymentTokenAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
])

const resolverFactoryAbi = parseAbi([
  "function predictProxyAddress(address deployer, uint256 salt) view returns (address)",
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
])

/** ENSv2 PermissionedResolver: a resolver owned by the wallet that deploys it. */
const permissionedResolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
])

/** EnhancedAccessControl bitmap granting every role and its admin role. */
const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n

const ETH_COIN_TYPE = 60n
const SECONDS_PER_YEAR = 31_536_000n

interface EnsRegistrationContracts {
  registrar: Address
  registry: Address
  resolverFactory: Address
  resolverImplementation: Address
  paymentToken: { address: Address; symbol: string; decimals: number; mintable: boolean }
}

/**
 * .eth registration contracts per L1 chain (ENSv2).
 * Mainnet is absent on purpose: it still registers through the ENSv1 controller
 * and costs real ETH.
 * @see https://docs.ens.domains/learn/deployments/
 */
const ENS_REGISTRATION: Record<number, EnsRegistrationContracts> = {
  11155111: {
    registrar: getAddress("0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3"),
    registry: getAddress("0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4"),
    resolverFactory: getAddress("0xda70306c98e97ece36f997a21368e53298572991"),
    resolverImplementation: getAddress("0x115eb53f0c60696633855f90b138178fb40b2b2c"),
    // MockUSDC: anyone can mint it, so the agent tops itself up.
    paymentToken: {
      address: getAddress("0x240b0316df57887dbbe58b586508b19e633a14aa"),
      symbol: "USDC",
      decimals: 6,
      mintable: true,
    },
  },
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

/** Agent wallet on the L1 ENS chain, where .eth names are registered. */
function ensWalletClients() {
  const privateKey = process.env.AGENT_PRIVATE_KEY
  if (!privateKey) {
    throw new Error("AGENT_PRIVATE_KEY environment variable is not set")
  }
  const chain = ensResolutionChain()
  const transport = http(ensResolutionRpcUrl())
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })
  // Reusing one secret per label lets a retry pick up an earlier commitment.
  const secret = (label: string) => keccak256(concat([privateKey as Hex, toHex(`ens-commit:${label}`)]))
  return { account, publicClient, walletClient, chain, secret }
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reduce "MyBot", "mybot.eth" to the normalized label "mybot". Throws on subnames and other TLDs. */
function parseEthLabel(name: string): string {
  const normalized = normalize(name.trim())
  const label = normalized.endsWith(".eth") ? normalized.slice(0, -".eth".length) : normalized
  if (!label || label.includes(".")) {
    throw new Error(`"${name}" is not a registrable .eth name. Use a single label such as "mybot" or "mybot.eth".`)
  }
  return label
}

/** Write the agent wallet's reverse record on its own chain. Returns the tx hash. */
async function writeReverseRecord(normalized: string, registrar: Address): Promise<Hex> {
  const { account, publicClient, walletClient, chain } = agentWalletClients()
  const hash = await walletClient.writeContract({
    address: registrar,
    abi: reverseRegistrarAbi,
    functionName: "setName",
    args: [normalized],
    account,
    chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
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
 * Does not register names (see register_ens) — the name must already resolve to the agent.
 */
export const setPrimaryEnsTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "set_primary_ens",
  description:
    "Set the agent wallet's primary ENS name (reverse record) on the current chain. " +
    "Requires a name that already resolves to the agent wallet; use register_ens to get a new one. " +
    "Returns the transaction hash on success.",
  schema: z.object({
    name: z.string().describe("ENS name to set as primary, e.g. 'myagent.eth'"),
  }),
  func: async ({ name }): Promise<string> => {
    try {
      const normalized = normalize(name.trim())
      const { account, chainId, explorerUrl } = agentWalletClients()
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

      const hash = await writeReverseRecord(normalized, registrar)

      const txUrl = explorerUrl ? `${explorerUrl}/tx/${hash}` : hash
      return `Primary ENS name set to ${normalized}. tx: ${txUrl}`
    } catch (err) {
      return `Error: ${truncateError(err)}`
    }
  },
})

/**
 * @notice Register a .eth name for the agent wallet and make it resolve to the agent.
 * Runs the ENSv2 commit-reveal flow on the L1 ENS chain, so it blocks for about a
 * minute. Safe to call again after a failure: it resumes from the step that failed.
 */
export const registerEnsTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "register_ens",
  description:
    "Register (buy) a .eth name for the agent wallet, point it at the agent, and by default " +
    "set it as the agent's primary name. Takes about a minute (commit-reveal). " +
    "Testnet agents only: registers on Ethereum Sepolia and pays in test USDC. " +
    "If a previous call failed part-way, call it again with the same name to resume.",
  schema: z.object({
    name: z.string().describe("Name to register, e.g. 'mybot' or 'mybot.eth'"),
    years: z.number().int().min(1).max(5).optional().describe("Registration length in years. Defaults to 1."),
    setPrimary: z
      .boolean()
      .optional()
      .describe("Also set the name as the agent wallet's primary name. Defaults to true."),
  }),
  func: async ({ name, years, setPrimary }): Promise<string> => {
    const steps: string[] = []
    try {
      const label = parseEthLabel(name)
      const fullName = `${label}.eth`
      const { account, publicClient, walletClient, chain, secret } = ensWalletClients()
      const contracts = ENS_REGISTRATION[chain.id]
      if (!contracts) {
        return (
          `Error: Registering .eth names is not supported on ${chain.name}. ` +
          `Only testnet agents can register (on Ethereum Sepolia); register mainnet names at app.ens.domains.`
        )
      }
      const { registrar, registry, resolverFactory, resolverImplementation, paymentToken } = contracts
      const explorer = chain.blockExplorers?.default.url
      const txUrl = (hash: Hex) => (explorer ? `${explorer}/tx/${hash}` : hash)

      const send = async (step: string, request: Parameters<typeof walletClient.writeContract>[0]) => {
        const hash = await walletClient.writeContract(request)
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== "success") {
          throw new Error(`${step} transaction reverted: ${txUrl(hash)}`)
        }
        steps.push(`${step}: ${txUrl(hash)}`)
      }

      const resolver = await publicClient.readContract({
        address: resolverFactory,
        abi: resolverFactoryAbi,
        functionName: "predictProxyAddress",
        args: [account.address, 0n],
      })

      const available = await publicClient.readContract({
        address: registrar,
        abi: ethRegistrarAbi,
        functionName: "isAvailable",
        args: [label],
      })

      if (!available) {
        // Taken. Only carry on if the agent itself registered it in an earlier, interrupted call.
        const owner = await publicClient.readContract({
          address: registry,
          abi: ethRegistryAbi,
          functionName: "getOwner",
          args: [BigInt(labelhash(label))],
        })
        if (getAddress(owner) !== getAddress(account.address)) {
          return `Error: ${fullName} is already registered by ${owner}. Pick a different name.`
        }
        const currentResolver = await publicClient.readContract({
          address: registry,
          abi: ethRegistryAbi,
          functionName: "getResolver",
          args: [label],
        })
        if (getAddress(currentResolver) !== getAddress(resolver)) {
          return (
            `Error: The agent already owns ${fullName}, but its resolver (${currentResolver}) is not the agent's own. ` +
            `Point its address record at ${account.address} at app.ens.dev, then call set_primary_ens.`
          )
        }
        steps.push(`${fullName} was already registered to the agent; finishing setup`)
      } else {
        if ((await publicClient.getBalance({ address: account.address })) === 0n) {
          return `Error: The agent wallet ${account.address} has no ETH on ${chain.name} to pay for gas. Fund it and retry.`
        }

        const duration = BigInt(years ?? 1) * SECONDS_PER_YEAR
        const [base, premium] = await publicClient.readContract({
          address: registrar,
          abi: ethRegistrarAbi,
          functionName: "getRegisterPrice",
          args: [label, duration, paymentToken.address],
        })
        const price = base + premium
        const priceText = `${formatUnits(price, paymentToken.decimals)} ${paymentToken.symbol}`

        const resolverCode = await publicClient.getCode({ address: resolver })
        if (!resolverCode || resolverCode === "0x") {
          await send("Deployed resolver", {
            address: resolverFactory,
            abi: resolverFactoryAbi,
            functionName: "deployProxy",
            args: [
              resolverImplementation,
              0n,
              encodeFunctionData({
                abi: permissionedResolverAbi,
                functionName: "initialize",
                args: [[{ account: account.address, roleBitmap: ALL_ROLES }], []],
              }),
            ],
            account,
            chain,
          })
        }

        const balance = await publicClient.readContract({
          address: paymentToken.address,
          abi: paymentTokenAbi,
          functionName: "balanceOf",
          args: [account.address],
        })
        if (balance < price) {
          if (!paymentToken.mintable) {
            return (
              `Error: ${fullName} costs ${priceText}, but the agent wallet holds ` +
              `${formatUnits(balance, paymentToken.decimals)} ${paymentToken.symbol}.`
            )
          }
          await send(`Minted test ${paymentToken.symbol}`, {
            address: paymentToken.address,
            abi: paymentTokenAbi,
            functionName: "mint",
            args: [account.address, price - balance],
            account,
            chain,
          })
        }

        const allowance = await publicClient.readContract({
          address: paymentToken.address,
          abi: paymentTokenAbi,
          functionName: "allowance",
          args: [account.address, registrar],
        })
        if (allowance < price) {
          await send(`Approved ${priceText}`, {
            address: paymentToken.address,
            abi: paymentTokenAbi,
            functionName: "approve",
            args: [registrar, price],
            account,
            chain,
          })
        }

        const labelSecret = secret(label)
        const commitment = await publicClient.readContract({
          address: registrar,
          abi: ethRegistrarAbi,
          functionName: "makeCommitment",
          args: [label, account.address, labelSecret, zeroAddress, resolver, duration, zeroHash],
        })
        const readRegistrar = (functionName: "MIN_COMMITMENT_AGE" | "MAX_COMMITMENT_AGE") =>
          publicClient.readContract({ address: registrar, abi: ethRegistrarAbi, functionName })
        const readCommittedAt = () =>
          publicClient.readContract({
            address: registrar,
            abi: ethRegistrarAbi,
            functionName: "commitmentAt",
            args: [commitment],
          })
        const [minAge, maxAge] = await Promise.all([
          readRegistrar("MIN_COMMITMENT_AGE"),
          readRegistrar("MAX_COMMITMENT_AGE"),
        ])

        const blockTime = async () => (await publicClient.getBlock()).timestamp
        let committedAt = await readCommittedAt()
        let now = await blockTime()
        // Commit unless an earlier call left a commitment that is still usable.
        if (committedAt === 0n || now >= committedAt + maxAge) {
          await send("Committed", {
            address: registrar,
            abi: ethRegistrarAbi,
            functionName: "commit",
            args: [commitment],
            account,
            chain,
          })
          committedAt = await readCommittedAt()
          now = await blockTime()
        }

        // The registrar rejects a reveal until the commitment has aged.
        const validFrom = committedAt + minAge
        while (now < validFrom) {
          await sleep(Number(validFrom - now + 2n) * 1000)
          now = await blockTime()
        }

        await send(`Registered ${fullName} for ${years ?? 1} year(s), paid ${priceText}`, {
          address: registrar,
          abi: ethRegistrarAbi,
          functionName: "register",
          args: [
            label,
            account.address,
            labelSecret,
            zeroAddress,
            resolver,
            duration,
            paymentToken.address,
            zeroHash,
          ],
          account,
          chain,
        })
      }

      // Records: the L1 address, plus the agent chain's own coin type on an L2.
      const dnsName = toHex(packetToBytes(fullName))
      const agentCoinType = coinTypeForAgentChain()
      for (const coinType of agentCoinType == null ? [ETH_COIN_TYPE] : [ETH_COIN_TYPE, agentCoinType]) {
        await send(`Set address record (coin type ${coinType})`, {
          address: resolver,
          abi: permissionedResolverAbi,
          functionName: "setAddress",
          args: [dnsName, coinType, account.address],
          account,
          chain,
        })
      }

      let primary = ""
      if (setPrimary ?? true) {
        const { chainId, explorerUrl } = agentWalletClients()
        const reverseRegistrar = REVERSE_REGISTRARS[chainId]
        if (reverseRegistrar) {
          const hash = await writeReverseRecord(fullName, reverseRegistrar)
          steps.push(`Set primary name: ${explorerUrl ? `${explorerUrl}/tx/${hash}` : hash}`)
          primary = " and set as the agent's primary name"
        } else {
          primary = `, but primary names are not supported on ${getActiveNetwork()} so none was set`
        }
      }

      return `${fullName} now resolves to ${account.address}${primary}.\n${steps.join("\n")}`
    } catch (err) {
      if (steps.length === 0) return `Error: ${truncateError(err)}`
      return (
        `Error: ${truncateError(err)}\n` +
        `Completed before the failure:\n${steps.join("\n")}\n` +
        `Call register_ens again with the same name to resume.`
      )
    }
  },
})
