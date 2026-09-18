/**
 * Decode LangGraph FileCheckpoint memory.json into human-readable summary.
 * @module memory-reader
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AGENTS_DIR } from "./wallet.js";

type RawMessage = {
  lc: number;
  type: string;
  id: string[]; // ["langchain_core","messages","HumanMessage"]
  kwargs: Record<string, unknown>;
};

type Checkpoint = {
  v: number;
  id: string;
  ts: string;
  channel_values: Record<string, unknown>;
  channel_versions: Record<string, number>;
  versions_seen: Record<string, unknown>;
};

type SimplifiedMessage = {
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  content: string;
  name?: string;
  toolCalls?: { name: string; args: unknown }[];
  id?: string;
  ts?: string; // checkpoint timestamp when this message first appeared
};

export type MemorySession = {
  id: string;
  index: number;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  humanCount: number;
  assistantCount: number;
  toolCount: number;
  title: string;
  preview: string; // first user message snippet
  messages: SimplifiedMessage[];
  txHashes: string[];
  recipients: string[];
  summary: string; // e.g. "3 prompts · 2 txs"
};

export type MemorySummary = {
  agent: string;
  exists: boolean;
  empty: boolean;
  threads: string[];
  checkpointCount: number;
  firstActive: string | null;
  lastActive: string | null;
  stats: {
    totalMessages: number;
    humanCount: number;
    aiCount: number;
    toolCount: number;
    toolCallsByName: Record<string, number>;
    uniqueRecipients: string[];
    txHashes: string[];
    totalEthSent: string;
  };
  summary: string;
  preview: SimplifiedMessage[];
  recentTxHashes: string[];
  sessions: MemorySession[];
};

function lcTypeToRole(id: string[]): SimplifiedMessage["role"] {
  const kind = id[2] ?? "";
  if (kind === "HumanMessage") return "user";
  if (kind === "AIMessage") return "assistant";
  if (kind === "ToolMessage") return "tool";
  if (kind === "SystemMessage") return "system";
  return "unknown";
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (Array.isArray(v)) {
    // LangChain content can be array of {type:"text", text:"..."} or similar
    return v
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in (item as Record<string, unknown>)) {
          return String((item as Record<string, unknown>).text);
        }
        if (item && typeof item === "object" && "content" in (item as Record<string, unknown>)) {
          return String((item as Record<string, unknown>).content);
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

function collectMemoryPaths(agentName: string): string[] {
  const isVercel = !!process.env.VERCEL;
  const baseDir = isVercel ? path.join("/tmp", "agents") : AGENTS_DIR;
  const fallback = isVercel ? path.join(path.resolve(process.cwd(), "agents"), agentName, "memory.json") : null;
  const primary = path.join(baseDir, agentName, "memory.json");
  return fallback ? [primary, fallback] : [primary];
}

export function readAgentMemory(agentName: string): MemorySummary {
  const paths = collectMemoryPaths(agentName);
  let raw: { storage?: Record<string, Record<string, Record<string, [string, string, string | null]>>>; writes?: unknown } | null = null;
  let loadedPath: string | null = null;
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      loadedPath = p;
      break;
    } catch {
      continue;
    }
  }

  if (!raw || !raw.storage || Object.keys(raw.storage).length === 0) {
    return {
      agent: agentName,
      exists: loadedPath != null,
      empty: true,
      threads: raw?.storage ? Object.keys(raw.storage) : [],
      checkpointCount: 0,
      firstActive: null,
      lastActive: null,
      stats: {
        totalMessages: 0,
        humanCount: 0,
        aiCount: 0,
        toolCount: 0,
        toolCallsByName: {},
        uniqueRecipients: [],
        txHashes: [],
        totalEthSent: "0",
      },
      summary: "No conversation history yet.",
      preview: [],
      recentTxHashes: [],
      sessions: [],
    };
  }

  const threads = Object.keys(raw.storage);
  const checkpoints: Checkpoint[] = [];
  let totalCheckpointCount = 0;

  for (const tid of threads) {
    for (const ns of Object.keys(raw.storage[tid])) {
      const bucket = raw.storage[tid][ns];
      for (const key of Object.keys(bucket)) {
        totalCheckpointCount++;
        const entry = bucket[key];
        try {
          const b0 = Buffer.from(entry[0], "base64").toString("utf-8");
          const cp = JSON.parse(b0) as Checkpoint;
          checkpoints.push(cp);
        } catch {
          // skip corrupted
        }
      }
    }
  }

  if (checkpoints.length === 0) {
    return {
      agent: agentName,
      exists: true,
      empty: true,
      threads,
      checkpointCount: totalCheckpointCount,
      firstActive: null,
      lastActive: null,
      stats: {
        totalMessages: 0,
        humanCount: 0,
        aiCount: 0,
        toolCount: 0,
        toolCallsByName: {},
        uniqueRecipients: [],
        txHashes: [],
        totalEthSent: "0",
      },
      summary: "No conversation history yet.",
      preview: [],
      recentTxHashes: [],
      sessions: [],
    };
  }

  // Sort by timestamp
  checkpoints.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const firstActive = checkpoints[0]?.ts ?? null;
  const lastActive = checkpoints[checkpoints.length - 1]?.ts ?? null;

  // Build timestamped message list by walking checkpoints in order
  // Each unique message id is assigned the ts of the first checkpoint where it appears.
  const seenIds = new Set<string>();
  const tsById = new Map<string, string>();
  const rawById = new Map<string, RawMessage>();
  const order: string[] = []; // ids in first-seen order

  for (const cp of checkpoints) {
    const rawMsgs = (cp.channel_values as Record<string, unknown>)?.messages as RawMessage[] | undefined;
    if (!Array.isArray(rawMsgs)) continue;
    for (const m of rawMsgs) {
      const kwargs = m.kwargs as Record<string, unknown>;
      const mid = typeof kwargs.id === "string" ? kwargs.id : `${cp.id}:${m.id.join(".")}:${JSON.stringify(kwargs.content).slice(0, 50)}`;
      if (seenIds.has(mid)) continue;
      seenIds.add(mid);
      tsById.set(mid, cp.ts);
      rawById.set(mid, m);
      order.push(mid);
    }
  }

  // Fallback: if order is empty but checkpoints have messages (e.g. duplicate ids fallback failed), use latest
  let rawMsgsFallback: RawMessage[] = [];
  if (order.length === 0) {
    let latestWithMessages: Checkpoint | null = null;
    for (let i = checkpoints.length - 1; i >= 0; i--) {
      const cv = checkpoints[i].channel_values as Record<string, unknown>;
      const msgs = cv?.messages as unknown;
      if (Array.isArray(msgs) && msgs.length > 0) {
        latestWithMessages = checkpoints[i];
        break;
      }
    }
    const latest = latestWithMessages ?? checkpoints[checkpoints.length - 1];
    rawMsgsFallback = ((latest.channel_values as Record<string, unknown>)?.messages as RawMessage[] | undefined) ?? [];
    if (Array.isArray(rawMsgsFallback)) {
      for (const m of rawMsgsFallback) {
        const kwargs = m.kwargs as Record<string, unknown>;
        const mid = typeof kwargs.id === "string" ? kwargs.id : `fallback:${Math.random()}`;
        if (seenIds.has(mid)) continue;
        seenIds.add(mid);
        tsById.set(mid, latest.ts);
        rawById.set(mid, m);
        order.push(mid);
      }
    }
  }

  const simplified: SimplifiedMessage[] = order
    .map((mid) => {
      const m = rawById.get(mid)!;
      const role = lcTypeToRole(m.id);
      const kwargs = m.kwargs as Record<string, unknown>;
      const content = asString(kwargs.content);
      const name = typeof kwargs.name === "string" ? kwargs.name : typeof (kwargs as Record<string, unknown>).name === "string" ? String((kwargs as Record<string, unknown>).name) : undefined;
      const toolCallsRaw = kwargs.tool_calls as Array<{ name: string; args: unknown }> | undefined;
      const toolCalls = Array.isArray(toolCallsRaw) && toolCallsRaw.length
        ? toolCallsRaw.map((tc) => ({ name: String(tc.name), args: tc.args }))
        : undefined;
      const id = typeof kwargs.id === "string" ? kwargs.id : mid;
      const toolName = role === "tool" ? (name ?? (typeof kwargs["name"] === "string" ? String(kwargs["name"]) : undefined)) : undefined;
      return {
        role,
        content: content.slice(0, 4000),
        name: toolName ?? name,
        toolCalls,
        id,
        ts: tsById.get(mid),
      };
    })
    .filter((s) => s.role !== "unknown" || s.content.trim().length > 0);

  let humanCount = 0;
  let aiCount = 0;
  let toolCount = 0;
  const toolCallsByName: Record<string, number> = {};
  const recipientSet = new Set<string>();
  const txSet = new Set<string>();
  let totalEthSent = 0;

  for (const s of simplified) {
    if (s.role === "user") humanCount++;
    else if (s.role === "assistant") aiCount++;
    else if (s.role === "tool") toolCount++;

    if (s.toolCalls) {
      for (const tc of s.toolCalls) {
        toolCallsByName[tc.name] = (toolCallsByName[tc.name] ?? 0) + 1;
        const args = tc.args as Record<string, unknown> | null;
        if (args) {
          const to = args.to ?? args.recipient ?? args.address;
          if (typeof to === "string" && /^0x[a-fA-F0-9]{40}$/.test(to)) {
            recipientSet.add(to);
          }
          const amountRaw = args.amount;
          if (typeof amountRaw === "string" || typeof amountRaw === "number") {
            const n = Number(amountRaw);
            if (Number.isFinite(n) && tc.name === "send_eth") totalEthSent += n;
          }
        }
      }
    }
    // also extract tx hashes and recipients from tool result contents
    if (s.role === "tool" && s.content) {
      // tx hashes 0x + 64 hex
      const m = s.content.match(/\b0x[a-fA-F0-9]{64}\b/g);
      if (m) for (const h of m) txSet.add(h);
      // recipients inside tool message content (addresses)
      const am = s.content.match(/\b0x[a-fA-F0-9]{40}\b/g);
      if (am) for (const a of am) recipientSet.add(a);
    }
    // also assistant messages may contain tx links
    if (s.role === "assistant" && s.content) {
      const m = s.content.match(/\b0x[a-fA-F0-9]{64}\b/g);
      if (m) for (const h of m) txSet.add(h);
      const am = s.content.match(/\b0x[a-fA-F0-9]{40}\b/g);
      if (am) for (const a of am) recipientSet.add(a);
    }
    if (s.role === "user" && s.content) {
      const am = s.content.match(/\b0x[a-fA-F0-9]{40}\b/g);
      if (am) for (const a of am) recipientSet.add(a);
    }
  }

  // Also scan raw simplified user prompts for recipients (already done)
  const uniqueRecipients = [...recipientSet];
  const txHashes = [...txSet];
  // recent txs last 5
  const recentTxHashes = txHashes.slice(-5).reverse();

  // ----- Sessions (group by time gap) -----
  const SESSION_GAP_MS = 20 * 60 * 1000; // 20 min idle => new session
  const sessions: MemorySession[] = [];
  if (simplified.length > 0) {
    // helper to format date for title
    const fmtDate = (iso: string) => {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    let cur: SimplifiedMessage[] = [];
    let curStart = simplified[0].ts ?? firstActive ?? lastActive ?? new Date().toISOString();
    let curEnd = curStart;

    const flushSession = () => {
      if (cur.length === 0) return;
      const humanIn = cur.filter((m) => m.role === "user").length;
      const assistantIn = cur.filter((m) => m.role === "assistant").length;
      const toolIn = cur.filter((m) => m.role === "tool").length;
      const previewFirstUser = cur.find((m) => m.role === "user")?.content ?? cur[0]?.content ?? "";
      const previewSnippet = truncate(previewFirstUser.replace(/\s+/g, " ").trim(), 64) || "—";
      // per-session tx/recipients
      const sTx = new Set<string>();
      const sRec = new Set<string>();
      for (const mm of cur) {
        if (mm.content) {
          const th = mm.content.match(/\b0x[a-fA-F0-9]{64}\b/g);
          if (th) th.forEach((h) => sTx.add(h));
          const ah = mm.content.match(/\b0x[a-fA-F0-9]{40}\b/g);
          if (ah) ah.forEach((a) => sRec.add(a));
        }
        if (mm.toolCalls) {
          for (const tc of mm.toolCalls) {
            const args = tc.args as Record<string, unknown> | null;
            if (args?.to && typeof args.to === "string" && /^0x[a-fA-F0-9]{40}$/.test(args.to)) sRec.add(args.to as string);
            // tx already captured via content
          }
        }
      }
      const idx = sessions.length;
      const title = `${fmtDate(curStart)} · ${humanIn} prompt${humanIn !== 1 ? "s" : ""}`;
      const summaryParts: string[] = [];
      summaryParts.push(`${cur.length} msgs`);
      if (sTx.size) summaryParts.push(`${sTx.size} tx`);
      if (sRec.size) summaryParts.push(`${sRec.size} addr`);
      sessions.push({
        id: `session-${idx}-${curStart}`,
        index: idx,
        startedAt: curStart,
        endedAt: curEnd,
        messageCount: cur.length,
        humanCount: humanIn,
        assistantCount: assistantIn,
        toolCount: toolIn,
        title,
        preview: previewSnippet,
        messages: [...cur],
        txHashes: [...sTx],
        recipients: [...sRec],
        summary: summaryParts.join(" · "),
      });
    };

    for (let i = 0; i < simplified.length; i++) {
      const msg = simplified[i];
      const ts = msg.ts ?? lastActive ?? firstActive ?? new Date().toISOString();
      if (cur.length === 0) {
        cur = [msg];
        curStart = ts;
        curEnd = ts;
        continue;
      }
      const prevTs = cur[cur.length - 1].ts ?? curEnd;
      const gap = new Date(ts).getTime() - new Date(prevTs).getTime();
      if (gap > SESSION_GAP_MS && cur.length >= 2) {
        // gap large enough => new session, but avoid splitting mid-tool burst: if current msg is tool/assistant continuation just after user, don't split
        // Only split if gap > SESSION_GAP and next msg is user (new human prompt after idle)
        // Our simplified already ensures gap measured between consecutive messages regardless of role.
        // To avoid micro-splits inside same exchange (assistant->tool gaps are 1-2s), this threshold handles it naturally.
        flushSession();
        cur = [msg];
        curStart = ts;
        curEnd = ts;
      } else {
        cur.push(msg);
        curEnd = ts;
      }
    }
    flushSession();
  }

  const preview = simplified.slice(-12).map((s) => ({
    ...s,
    content: s.content,
  }));

  // Build human summary
  const parts: string[] = [];
  if (simplified.length === 0) {
    parts.push("No messages yet");
  } else {
    const exchanges = Math.ceil(simplified.length / 2);
    parts.push(`${simplified.length} messages in ${humanCount} exchanges`);
    if (toolCount > 0) parts.push(`${toolCount} tool results`);
    const topTool = Object.entries(toolCallsByName).sort((a, b) => b[1] - a[1])[0];
    if (topTool) parts.push(`top tool: ${topTool[0]} ×${topTool[1]}`);
    if (uniqueRecipients.length) parts.push(`${uniqueRecipients.length} address${uniqueRecipients.length > 1 ? "es" : ""} touched`);
    if (txHashes.length) parts.push(`${txHashes.length} tx${txHashes.length > 1 ? "s" : ""} sent`);
    if (totalEthSent > 0) {
      const ethStr = totalEthSent.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
      parts.push(`≈${ethStr} ETH moved`);
    }
  }

  const timeAgo = (iso: string | null): string => {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000) return "just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  };

  const summary = parts.join(" · ") + (lastActive ? ` · last ${timeAgo(lastActive)}` : "");

  return {
    agent: agentName,
    exists: true,
    empty: simplified.length === 0,
    threads,
    checkpointCount: totalCheckpointCount,
    firstActive,
    lastActive,
    stats: {
      totalMessages: simplified.length,
      humanCount,
      aiCount,
      toolCount,
      toolCallsByName,
      uniqueRecipients,
      txHashes,
      totalEthSent: totalEthSent ? totalEthSent.toString() : "0",
    },
    summary,
    preview,
    recentTxHashes,
    sessions,
  };
}
