/**
 * Tools and reputation signing read the agent key from `process.env.AGENT_PRIVATE_KEY`
 * at call time. Turns run in one process, so the key is installed per turn and
 * turns are queued: no turn can observe another agent's key, and the variable
 * is put back (or removed) when the turn ends.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Run `fn` strictly after every earlier queued turn; a failed turn does not stall the queue. */
export function serializeTurn<T>(fn: () => Promise<T>): Promise<T> {
  const turn = queue.then(fn);
  queue = turn.catch(() => undefined);
  return turn;
}

/**
 * Queue a turn that runs `fn` with `privateKey` exposed as `AGENT_PRIVATE_KEY`.
 * Pass a thunk — not a pre-resolved key — when the key is loaded from the same
 * ambient variable (see `getOrCreateAgentWallet`), so the load happens inside
 * the queue and cannot read another turn's key.
 */
export function withSigningKey<T>(
  privateKey: string | (() => string),
  fn: () => Promise<T>,
): Promise<T> {
  return serializeTurn(async () => {
    const key = typeof privateKey === "function" ? privateKey() : privateKey;
    const previous = process.env.AGENT_PRIVATE_KEY;
    process.env.AGENT_PRIVATE_KEY = key;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.AGENT_PRIVATE_KEY;
      else process.env.AGENT_PRIVATE_KEY = previous;
    }
  });
}
