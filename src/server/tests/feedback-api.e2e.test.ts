/**
 * API-level E2E: rate/feedback + reputation endpoints on testnet (spends dust
 * only for gas from RATER_PRIVATE_KEY).
 *
 * Requires:
 *   RUN_E2E=1 RPC_URL=... NETWORK=arbitrum-sepolia RATER_PRIVATE_KEY=...
 *   E2E_AGENT_NAME=<agent to rate, default abcd-agent>
 *
 * Run: RUN_E2E=1 npx vitest run src/server/tests/feedback-api.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";

const RUN_E2E = process.env.RUN_E2E === "1";

describe.runIf(RUN_E2E)("feedback API e2e (testnet)", () => {
  beforeAll(() => {
    // Prevent api.ts from starting an HTTP listener on import.
    process.env.VERCEL = "1";
  });

  it("POST /api/agents/:name/feedback then GET /api/reputation/:agentId", async () => {
    const { app } = await import("../api.js");

    const fromAgent = process.env.E2E_AGENT_NAME || "abcd-agent";
    const targetAgentId = process.env.E2E_RATE_AGENT_ID; // optional override

    // Submit a rating signed by RATER_PRIVATE_KEY (small gas cost).
    const postRes = await app.request(`/api/agents/${encodeURIComponent(fromAgent)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(targetAgentId ? { agentId: targetAgentId } : {}),
        value: 85,
        tag: "starred",
        comment: "e2e api test rating",
      }),
    });
    const postBody = (await postRes.json()) as Record<string, unknown>;
    expect(postRes.status, JSON.stringify(postBody)).toBe(200);
    expect(postBody.ok).toBe(true);
    expect(typeof postBody.txHash).toBe("string");
    expect(typeof postBody.scanUrl).toBe("string");

    const ratedId = (postBody.agentId as string) || targetAgentId!;
    // Reputation summary reflects the rating.
    const getRes = await app.request(`/api/reputation/${encodeURIComponent(ratedId)}`);
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getRes.status, JSON.stringify(getBody)).toBe(200);
    expect(getBody.agentId).toBe(ratedId);
    expect(getBody.count as number).toBeGreaterThanOrEqual(1);
    expect(getBody.averageValue as number).toBeGreaterThan(0);
  }, 180_000);

  it("validates bad input without spending gas", async () => {
    const { app } = await import("../api.js");
    const fromAgent = process.env.E2E_AGENT_NAME || "abcd-agent";

    const missing = await app.request(`/api/agents/${encodeURIComponent(fromAgent)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const badValue = await app.request(`/api/agents/${encodeURIComponent(fromAgent)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "421614:204", value: "high" }),
    });
    expect(badValue.status).toBe(400);
  });
});
