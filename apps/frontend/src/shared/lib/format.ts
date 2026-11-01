/** Relative timestamp for memory/activity rows; `—` when there is no date. */
export function timeAgo(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

/** `0x1234…cdef` — addresses in tables and chips; short inputs pass through. */
export function shortAddr(a: string): string {
  return a.length > 13 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** `0x12345678…ef1234` — transaction hashes in tables and chips. */
export function shortTx(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}
