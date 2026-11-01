/** Longest error message a tool result carries before truncation. */
const MAX_ERROR_CHARS = 300;

/** Truncates an unknown thrown value to a short single-line message. */
export function truncateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_ERROR_CHARS ? message.slice(0, MAX_ERROR_CHARS) + "..." : message;
}

/** Tool-facing error string: `Error: <truncated message>`. */
export function toolError(err: unknown): string {
  return `Error: ${truncateError(err)}`;
}
