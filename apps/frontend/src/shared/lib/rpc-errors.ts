const RATE_LIMIT_RE = /exceeds defined limit|limit exceeded|-32005|\b429\b/i;

/** First line of an error message, without stack or viem's multi-line details. */
export function errorLine(err: unknown, fallback = "Something went wrong"): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : fallback;
  return raw.split("\n")[0] || fallback;
}

/**
 * Map wallet/RPC failures of an ETH transfer to short UI messages.
 * @param payer Who was paying: the server's master wallet or the user's connected wallet.
 * @param networkName Network the transfer ran on, named in the top-up hint.
 */
export function friendlyFundError(
  err: unknown,
  payer: "master" | "wallet" = "wallet",
  networkName = "the agent's network",
): string {
  const line = errorLine(err, "Transfer failed");
  if (/user rejected|denied|rejected the request/i.test(line)) {
    return "Wallet signature rejected.";
  }
  if (/not been authorized|unauthorized|4100/i.test(line)) {
    return "Wallet did not authorize this account. Sign out, sign in again, then retry.";
  }
  if (
    /insufficient funds|insufficient balance|exceeds the balance of the account|total cost \(gas/i.test(
      line,
    )
  ) {
    return payer === "master"
      ? `Master wallet has insufficient ETH. Fund it on ${networkName}, then retry.`
      : "not enough funds";
  }
  if (/out of gas|intrinsic gas too low/i.test(line)) {
    return "Funding transaction ran out of gas. Retry — gas will be re-estimated.";
  }
  if (/reverted|execution reverted|cancelled|transaction creation failed/i.test(line)) {
    return "Funding transaction failed on-chain. Check the explorer link and retry.";
  }
  if (RATE_LIMIT_RE.test(line)) {
    return "RPC rate limit hit. Wait a few seconds and retry.";
  }
  return line;
}

export function isRpcRateLimit(err: unknown): boolean {
  return RATE_LIMIT_RE.test(errorLine(err, ""));
}
