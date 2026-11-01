import * as readline from "node:readline";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

type StreamedMessage = {
  _getType?: () => string;
  content: unknown;
  tool_calls?: { name: string; args: unknown }[];
};

type ChatAgent = ReturnType<typeof createReactAgent>;

/**
 * Shared REPL used by `chat` and `create-agent` after the agent is built.
 * Prints tool calls and agent text as the graph streams updates.
 */
export function runChatLoop(agent: ChatAgent, threadId: string, flush: () => void): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("close", () => {
    flush();
    console.log("\nGoodbye!\n");
    process.exit(0);
  });

  const prompt = (): void => {
    rl.question("you > ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();
      if (trimmed.toLowerCase() === "exit") {
        rl.close();
        return;
      }

      try {
        const stream = await agent.stream(
          { messages: [{ role: "user", content: trimmed }] },
          { configurable: { thread_id: threadId }, recursionLimit: 25, streamMode: "updates" },
        );

        for await (const update of stream) {
          // Each update is { nodeName: nodeOutput }
          for (const output of Object.values(update)) {
            const messages =
              (output as { messages?: StreamedMessage[] } | undefined)?.messages ?? [];

            for (const msg of messages) {
              const role = msg._getType?.() ?? "unknown";
              const content =
                typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

              if (role === "ai") {
                const calls = msg.tool_calls ?? [];
                for (const tc of calls) {
                  console.log(`\n  [calling ${tc.name}] ${JSON.stringify(tc.args)}`);
                }
                if (content.trim()) {
                  console.log(`\nagent > ${content}`);
                }
              } else if (role === "tool") {
                console.log(`  [result] ${content.slice(0, 500)}`);
              }
            }
          }
        }

        console.log();
        flush();
      } catch (err: unknown) {
        console.error(`\n[error] ${err instanceof Error ? err.message : String(err)}\n`);
      }
      prompt();
    });
  };
  prompt();
}
