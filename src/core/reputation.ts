/**
 * ERC-8004 Reputation Registry integration (feedback / ratings).
 * @module reputation
 */

import { SDK } from "@blockbyvlog/agent0-sdk";
import { encodeFunctionData, keccak256, toBytes } from "viem";
import {
  findNetworkByAgentId,
  getActiveNetwork,
  getNetworkConfig,
  getRpcUrl,
  runWithNetwork,
} from "./config.js";

/**
 * tag1 is always "starred", so the caller's interaction tag (or, without IPFS, the short
 * comment) is kept as tag2 for traceability. Truncated to the 32 chars the contract stores.
 */
export function deriveTag2(
  tag: string | undefined,
  comment: string | undefined,
  hasIpfs: boolean,
): string | undefined {
  return (
    (tag && tag !== "starred" ? tag : comment && !hasIpfs ? comment : undefined)?.slice(0, 32) ||
    undefined
  );
}

export interface GiveFeedbackOptions {
  agentId: string;
  value: number;
  /**
   * Interaction context (e.g. 'transfer', 'execution').
   * Always stored as tag2 — tag1 is forced to 'starred' so feedback
   * counts as an ERC-8004 quality rating (shows as QUALITY RATING x/100 on 8004scan).
   */
  tag?: string;
  endpoint?: string;
  comment?: string;
  /** Defaults to RATER_PRIVATE_KEY env when omitted. */
  privateKey?: string;
}

export interface GiveFeedbackResult {
  txHash: string;
  agentId: string;
  value: number;
  feedbackURI?: string;
}

export interface ReputationSummary {
  count: number;
  averageValue: number;
}

/**
 * Runs `fn` on the chain the agent ID names ("<chainId>:<tokenId>"), so an
 * agent on another supported chain can be rated/read. Bare token IDs and
 * unknown chains stay on the active network.
 */
function onAgentNetwork<T>(agentId: string, fn: () => T): T {
  const network = findNetworkByAgentId(agentId);
  return network ? runWithNetwork(network, fn) : fn();
}

function buildSdk(privateKey: string): SDK {
  const network = getActiveNetwork();
  const config = getNetworkConfig(network);
  const pinataJwt = process.env.PINATA_JWT?.trim();
  const ipfsNodeUrl = process.env.IPFS_NODE_URL?.trim();
  return new SDK({
    chainId: config.chainId,
    rpcUrl: getRpcUrl(),
    privateKey,
    // Without this the SDK has no IPFS client and giveFeedback throws
    // "feedbackFile provided, but no IPFS backend is configured".
    ...(pinataJwt
      ? { ipfs: "pinata" as const, pinataJwt }
      : ipfsNodeUrl
        ? { ipfs: "node" as const, ipfsNodeUrl }
        : {}),
  });
}

/** Clamp rating to ERC-8004 0-100 range. */
export function normalizeRating(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid rating "${value}": must be a number 0-100`);
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Resolve the dedicated rater key (preferred) or fall back to AGENT_PRIVATE_KEY. */
export function resolveRaterPrivateKey(override?: string): string {
  const key = override || process.env.RATER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!key) {
    throw new Error("RATER_PRIVATE_KEY is not set (needed to sign feedback without self-rating)");
  }
  return key;
}

export async function giveFeedback(options: GiveFeedbackOptions): Promise<GiveFeedbackResult> {
  if (!options.agentId) throw new Error("agentId is required");
  return onAgentNetwork(options.agentId, () => giveFeedbackOnActiveNetwork(options));
}

async function giveFeedbackOnActiveNetwork(
  options: GiveFeedbackOptions,
): Promise<GiveFeedbackResult> {
  const { agentId, tag, endpoint, comment } = options;
  const privateKey = resolveRaterPrivateKey(options.privateKey);
  const value = normalizeRating(options.value);

  const sdk = buildSdk(privateKey);
  // Off-chain feedback files need Pinata/IPFS; skip when not configured so ratings still land on-chain.
  const hasIpfs = Boolean(process.env.PINATA_JWT?.trim() || process.env.IPFS_NODE_URL?.trim());
  // SDK expects rich text in `text` (it reads back `feedbackFile.text` into result.text).
  const feedbackFile =
    comment && hasIpfs ? sdk.prepareFeedbackFile({ text: comment } as never) : undefined;
  // Always a quality rating: tag1='starred' (0-100). Keep the caller's
  // interaction tag / short comment as tag2 for traceability.
  const tag1 = "starred";
  const tag2 = deriveTag2(tag, comment, hasIpfs);
  const handle = await sdk.giveFeedback(
    agentId as never,
    value,
    tag1,
    tag2,
    endpoint,
    feedbackFile as never,
  );
  const mined = await handle.waitMined();
  const txHash = (handle as { hash?: string }).hash ?? "unknown";
  // waitMined resolves { receipt, result } where result.fileURI is ipfs://<cid>.
  const feedbackURI = (mined as { result?: { fileURI?: string } })?.result?.fileURI;
  console.log(
    `[reputation] Feedback ${value}/100 [starred] -> ${agentId} tx=${txHash}` +
      (feedbackURI ? ` uri=${feedbackURI}` : ""),
  );
  return { txHash: String(txHash), agentId, value, ...(feedbackURI ? { feedbackURI } : {}) };
}

const GIVE_FEEDBACK_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export interface PreparedFeedback {
  to: string;
  data: string;
  chainId: number;
  agentId: string;
  value: number;
  feedbackURI?: string;
}

export interface PrepareFeedbackOptions extends Omit<GiveFeedbackOptions, "privateKey"> {
  /** The connected wallet that will sign and send the tx (becomes the feedback author). */
  clientAddress: string;
}

/**
 * Builds unsigned giveFeedback calldata so the user's own wallet signs it and
 * the feedback is attributed to that address (no server key involved).
 */
export async function prepareFeedback(options: PrepareFeedbackOptions): Promise<PreparedFeedback> {
  if (!options.agentId) throw new Error("agentId is required");
  return onAgentNetwork(options.agentId, () => prepareFeedbackOnActiveNetwork(options));
}

async function prepareFeedbackOnActiveNetwork(
  options: PrepareFeedbackOptions,
): Promise<PreparedFeedback> {
  const { agentId, tag, endpoint, comment, clientAddress } = options;
  const value = normalizeRating(options.value);
  const config = getNetworkConfig(getActiveNetwork());
  const pinataJwt = process.env.PINATA_JWT?.trim();
  const ipfsNodeUrl = process.env.IPFS_NODE_URL?.trim();
  // Read-only SDK: only needed for the registry address and optional IPFS upload.
  const sdk = new SDK({
    chainId: config.chainId,
    rpcUrl: getRpcUrl(),
    ...(pinataJwt
      ? { ipfs: "pinata" as const, pinataJwt }
      : ipfsNodeUrl
        ? { ipfs: "node" as const, ipfsNodeUrl }
        : {}),
  });
  const tokenId = BigInt(agentId.includes(":") ? agentId.split(":").pop()! : agentId);
  const hasIpfs = Boolean(sdk.ipfsClient);
  const tag1 = "starred";
  const tag2 = deriveTag2(tag, comment, hasIpfs) ?? "";

  let feedbackURI = "";
  let feedbackHash = `0x${"00".repeat(32)}`;
  if (comment && sdk.ipfsClient) {
    const file: Record<string, unknown> = {
      agentRegistry: `eip155:${config.chainId}:${sdk.identityRegistryAddress()}`,
      agentId: tokenId.toString(),
      clientAddress: `eip155:${config.chainId}:${clientAddress}`,
      createdAt: new Date().toISOString(),
      value,
      valueDecimals: 0,
      tag1,
      ...(tag2 ? { tag2 } : {}),
      ...(endpoint ? { endpoint } : {}),
      text: comment,
    };
    const cid = await sdk.ipfsClient.addJson(file, "feedback.json");
    feedbackURI = `ipfs://${cid}`;
    feedbackHash = keccak256(toBytes(JSON.stringify(file, Object.keys(file).sort())));
  }

  const data = encodeFunctionData({
    abi: GIVE_FEEDBACK_ABI,
    functionName: "giveFeedback",
    args: [
      tokenId,
      BigInt(value),
      0,
      tag1,
      tag2,
      endpoint ?? "",
      feedbackURI,
      feedbackHash as `0x${string}`,
    ],
  });
  return {
    to: sdk.reputationRegistryAddress(),
    data,
    chainId: config.chainId,
    agentId,
    value,
    ...(feedbackURI ? { feedbackURI } : {}),
  };
}

export async function getReputationSummary(
  agentId: string,
  tag?: string,
): Promise<ReputationSummary> {
  return onAgentNetwork(agentId, () => getReputationSummaryOnActiveNetwork(agentId, tag));
}

async function getReputationSummaryOnActiveNetwork(
  agentId: string,
  tag?: string,
): Promise<ReputationSummary> {
  const rpcUrl = (() => {
    try {
      return getRpcUrl();
    } catch {
      return undefined;
    }
  })();
  const network = getActiveNetwork();
  const config = getNetworkConfig(network);
  // Read-only SDK: omit privateKey when no signer available.
  const sdk = new SDK({
    chainId: config.chainId,
    rpcUrl: rpcUrl ?? config.defaultRpcUrl,
    ...(process.env.AGENT_PRIVATE_KEY ? { privateKey: process.env.AGENT_PRIVATE_KEY } : {}),
  });
  return sdk.getReputationSummary(agentId as never, tag);
}
