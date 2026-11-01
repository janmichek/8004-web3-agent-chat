import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { resolveAgentSkills } from "../core/agent-skills.js";
import { loadAgentConfig, resolveToolsFromConfig } from "../core/agent-config.js";
import { runWithNetwork } from "../core/config.js";
import { createPersistentCheckpointer } from "../core/file-checkpoint.js";
import { getLLM } from "../core/llm.js";
import { buildAgentSystemPrompt } from "../core/system-prompt.js";
import { getOrCreateAgentWallet } from "../core/wallet.js";
import type { Skill } from "../actions/types.js";
import { a2aToolNames, agentNetwork } from "./agent-catalog.js";
import { errMsg } from "./http-utils.js";
import { withSigningKey } from "./signing-key.js";

export type ChatEvent =
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; content: string }
  | { type: "message"; content: string };

/**
 * @param a2a Request from an anonymous agent over A2A: read-only tools only,
 *   no skill prompts, and no checkpointer, so the caller neither sees nor
 *   writes the owner's conversation history.
 */
export async function runChat(
  agentName: string,
  message: string,
  a2a = false,
): Promise<{
  reply: string;
  events: ChatEvent[];
}> {
  // The agent's tools read the active network, so run the whole turn on its chain,
  // and sign with its key only for the duration of the turn.
  return runWithNetwork(agentNetwork(loadAgentConfig(agentName)), () =>
    withSigningKey(
      () => getOrCreateAgentWallet({ agentName }).privateKey,
      () => runChatOnActiveNetwork(agentName, message, a2a),
    ),
  );
}

async function runChatOnActiveNetwork(
  agentName: string,
  message: string,
  a2a: boolean,
): Promise<{
  reply: string;
  events: ChatEvent[];
}> {
  const wallet = getOrCreateAgentWallet({ agentName });
  let agentConfig = loadAgentConfig(agentName);
  let tools: Awaited<ReturnType<typeof resolveAgentSkills>>;
  let skills: Skill[] = [];

  if (agentConfig && a2a) {
    const allowed = a2aToolNames(agentConfig);
    agentConfig = {
      ...agentConfig,
      metadata: { ...agentConfig.metadata, actions: [], tools: allowed },
    };
    tools = resolveToolsFromConfig(agentConfig).tools;
  } else if (agentConfig) {
    const resolved = resolveToolsFromConfig(agentConfig);
    tools = resolved.tools;
    skills = resolved.skills;
  } else {
    tools = a2a ? [] : await resolveAgentSkills(agentName, wallet.privateKey);
  }

  const { saver, flush } = a2a
    ? { saver: undefined, flush: async () => {} }
    : await createPersistentCheckpointer(agentName);

  const systemMessage = [
    ...buildAgentSystemPrompt({
      agentName,
      walletAddress: wallet.address,
      agentConfig,
      skills,
    }),
    "## Rules",
    "- Call each tool at most once per request unless its result is an error you can fix.",
    "- As soon as a tool gives you the answer (balance, hash, ABI, ...), stop calling tools and reply to the user.",
    "- After send_eth returns a transaction hash, the transfer is done: report it, do not verify or re-check.",
    a2a
      ? "- This request comes from another agent over A2A. You cannot send funds, sign or execute transactions here; say so if asked."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const llm = getLLM();
  const agent = createReactAgent({
    llm,
    tools,
    ...(saver ? { checkpointSaver: saver } : {}),
    prompt: systemMessage,
  });

  const events: ChatEvent[] = [];
  let reply = "";

  // A tool round-trip costs ~2 graph steps (agent + tool node), so a plain
  // balance-check → send → answer flow already needs ~5. 8 blew up on any
  // model hesitation with a raw "recursion limit" error.
  const RECURSION_LIMIT = 25;

  try {
    const stream = await agent.stream(
      { messages: [{ role: "user", content: message }] },
      {
        configurable: { thread_id: agentName },
        recursionLimit: RECURSION_LIMIT,
        streamMode: "updates",
      },
    );

    for await (const update of stream) {
      for (const output of Object.values(update)) {
        const messages = (output as { messages?: unknown[] })?.messages ?? [];
        for (const msg of messages) {
          const m = msg as {
            _getType?: () => string;
            content?: unknown;
            tool_calls?: { name: string; args: unknown }[];
          };
          const role = m._getType?.() ?? "unknown";
          const content =
            typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");

          if (role === "ai") {
            const calls = m.tool_calls ?? [];
            for (const tc of calls) {
              events.push({ type: "tool_call", name: tc.name, args: tc.args });
            }
            if (content.trim()) {
              events.push({ type: "message", content: content.trim() });
              reply = content.trim();
            }
          } else if (role === "tool") {
            events.push({ type: "tool_result", content: content.slice(0, 2000) });
          }
        }
      }
    }
  } catch (err) {
    const msg = errMsg(err);
    if (!/recursion/i.test(msg)) throw err;
    // Ran out of steps: salvage what happened instead of surfacing the
    // raw graph error. A transfer may well have gone through — surface
    // its hash so the user (and the frontend's tx-link detection) sees it.
    const hash = lastTxHash(events);
    reply = hash
      ? `Sent! Transaction hash: ${hash}`
      : "I ran out of steps before finishing — the network may be slow or the request needs breaking down. Please try again or simplify the request.";
    events.push({ type: "message", content: reply });
  }

  await flush();
  return { reply: reply || "(no response)", events };
}

/** Find a mined-tx-looking hash in tool results (not an Error: line). */
function lastTxHash(events: ChatEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "tool_result") continue;
    if (/^\s*Error:/i.test(e.content)) continue;
    const m = e.content.match(/\b(0x[a-fA-F0-9]{64})\b/);
    if (m?.[1]) return m[1];
  }
  return null;
}
