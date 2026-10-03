/** Map wallet/RPC failures to short UI messages. */
export function friendlyFundError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Transfer failed'
  const line = raw.split('\n')[0] || raw
  if (/user rejected|denied|rejected the request/i.test(line)) {
    return 'Wallet signature rejected.'
  }
  if (/insufficient funds|insufficient balance/i.test(line)) {
    return 'Wallet has insufficient ETH.'
  }
  if (/exceeds defined limit|limit exceeded|-32005|429/i.test(line)) {
    return 'RPC rate limit hit. Wait a few seconds and retry.'
  }
  return line
}

export function isRpcRateLimit(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err)
  return /exceeds defined limit|limit exceeded|-32005|429/i.test(raw)
}
