# web3Agent

Create AI agents with their own wallets on Arbitrum, register them on
ERC-8004, and talk to them from a CLI or a web console. Each agent can be
reached over chat, MCP and A2A.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](https://www.apache.org/licenses/LICENSE-2.0)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-green.svg?style=flat-square&logo=node.js)](https://nodejs.org)
[![Arbitrum](https://img.shields.io/badge/Network-Arbitrum-28A0F0.svg?style=flat-square)](https://arbitrum.io)

> [!WARNING]
> **Experimental, not for production.** Agent private keys are stored in
> plain files, and x402 payments are simulated unless a facilitator is
> configured. Do not use with real funds.

## Quick start

Requires Node.js 22.

```bash
git clone https://github.com/janmichek/8004-web3-agent-chat.git
cd 8004-web3-agent-chat
npm install

npm run setup          # generates the master wallet, writes MASTER_PRIVATE_KEY to .env, shows a QR code to fund it
# edit .env: RPC_URL and one LLM key (OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)

npm run create-agent   # CLI: pick actions/tools, create wallet, fund, register, chat
# or
npm run dev            # API :8787 + MCP :8788 + web console :5173
```

## What an agent is

| Part | Where | Notes |
|---|---|---|
| Wallet | `agents/<name>/wallet.json` | Own private key, funded from the master wallet or your connected wallet |
| Config | `agents/<name>/agent-config.json` | ERC-8004-shaped: endpoints, selected actions/tools, OASF domains/skills, `x402support` |
| Chat memory | `agents/<name>/` | LangGraph checkpoints, one thread per agent |
| On-chain identity | ERC-8004 Identity Registry | Master wallet is owner, agent wallet is bound as `agentWallet`; registration file pinned to IPFS |

`agents/` is gitignored. On Vercel it lives in `/tmp` and is lost on cold
start; see [Deploying to Vercel](#deploying-to-vercel).

## Capabilities

Actions bundle tools with prompt context; tools can also be picked one by one.
Details in [`src/actions/README.md`](./src/actions/README.md).

| Kind | Name | Does |
|---|---|---|
| Action | `transfer-eth` | `send_eth` + `get_token_balance` with transfer guidance |
| Tool | `send_eth` | Send ETH from the agent wallet |
| Tool | `get_token_balance` | ETH / ERC-20 balance |
| Tool | `fetch_contract_abi` | Fetch a verified contract's ABI (experimental) |
| Tool | `call_contract` | Call any verified contract function (experimental) |

The MCP server additionally exposes `give_feedback`, `get_reputation`,
`search_agents`, `get_agent` and `get_agent_feedbacks`.

LLM providers: OpenRouter (default), Anthropic, OpenAI.

## Web console

```bash
npm run dev            # everything
# or separately
npm run serve          # API on :8787
npm run frontend       # Vite on :5173, proxies /api, /mcp, /a2a and /.well-known/agent-card.json
```

- Sign in with Web3Auth or an injected wallet; see your and the agent's balance.
- Create-agent wizard: name, description, image (IPFS), actions/tools, OASF
  domains and skills, service endpoints (web, email, MCP, A2A), optional x402
  charging for A2A, then fund from the master wallet or your own.
- Agent Info shows the agent's services as links and its x402 mode.
- Chat with tool calls shown inline, conversation history, delete agent.
- Rate an agent on the ERC-8004 Reputation Registry and view its score.

## CLI

| Command | Does |
|---|---|
| `npm run setup` | First run: master wallet + `.env` |
| `npm run create-agent` | Interactive builder. Flags: `--name`, `--fund <eth>`, `--skip-register`, `--mcp-endpoint <url>`, `--a2a-endpoint <url>`, `--x402` |
| `npm run chat -- --agent <name>` | Chat with an existing agent |
| `npm run delete-agent -- --name <name> [--yes]` | Delete the agent's local directory |
| `npm run deploy -- --name <name>` | Legacy flow without action selection |
| `npm run mcp` / `npm run mcp:http` | MCP server over stdio / HTTP on `MCP_PORT` (8788). `--agent <name>` limits tools to that agent's selection |

## HTTP API

Served by `npm run serve` (Hono) and by the Vercel function.

| Route | Does |
|---|---|
| `GET /api/health` | Network, chain id, master wallet |
| `GET /api/catalog` | Available actions and tools |
| `GET /api/agents`, `GET /api/agents/:name` | Agent summaries |
| `POST /api/agents` | Create (wallet, optional funding, config, registration) |
| `DELETE /api/agents/:name` | Delete (disabled on Vercel unless `ALLOW_AGENT_DELETE`) |
| `POST /api/agents/:name/restore` | Re-create an agent on a cold instance from a browser-held backup |
| `POST /api/agents/:name/chat` | One chat turn, returns reply + tool events |
| `POST /api/agents/:name/fund` | Fund from the master wallet (max 1 ETH) |
| `GET /api/agents/:name/memory` | Conversation history |
| `POST /api/agents/:name/feedback`, `GET /api/reputation/:agentId` | ERC-8004 reputation |
| `POST /api/upload/image` | Pin an image to IPFS |
| `POST /api/rpc` | JSON-RPC proxy to `RPC_URL` |
| `/api/mcp`, `/mcp` | MCP over Streamable HTTP |
| `/api/a2a`, `/a2a`, `/.well-known/agent-card.json` | A2A |

### MCP

`GET` returns a small descriptor for health checks. Discovery calls
(`initialize`, `tools/list`, …) are open. Everything else, including
`tools/call`, needs `Authorization: Bearer $MCP_AUTH_TOKEN` and is rate
limited; without `MCP_AUTH_TOKEN` set those calls return 503.
`?agent=<name>` limits tools to that agent's selection.

### A2A and x402

Full behavior: [`docs/a2a-x402-spec.md`](./docs/a2a-x402-spec.md).

- `GET /.well-known/agent-card.json` returns the Agent Card;
  `POST /api/a2a` speaks JSON-RPC (`message/send`, `tasks/get`).
- `?agent=<name>` reaches that agent: its LLM answers the message. Without it
  a generic echo endpoint answers (useful for health checks).
- **Read-only over A2A.** Callers are anonymous, so the agent only gets its
  read-only tools (`get_token_balance`, `fetch_contract_abi`). It never sends
  funds or signs for an outside caller, and it does not see or change the
  owner's chat history. Requests are rate limited per IP.
- **x402 (optional, per agent).** A request needs the `X-A2A-Extensions`
  header and gets back a task in `input-required` with payment requirements
  (0.01 USDC on Base Sepolia, paid to the agent wallet). Sending the payment
  payload for that task verifies it, runs the agent, then settles — a failed
  run is never charged.
- **Test mode vs real payments.** Without `X402_FACILITATOR_URL` payments are
  simulated and nobody is charged; the wizard, CLI and `GET /api/a2a` all say
  so. Set it (e.g. `https://x402.org/facilitator`) for real verification and
  settlement. Real settlement with a funded signature has not been tested yet.
- Tasks are kept in memory only.

```bash
EXT='https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2'
curl -s 'localhost:8787/.well-known/agent-card.json?agent=my-agent'
curl -s 'localhost:8787/api/a2a?agent=my-agent' -H 'content-type: application/json' -H "X-A2A-Extensions: $EXT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"kind":"message","role":"user","parts":[{"kind":"text","text":"What is your ETH balance?"}]}}}'
```

## ERC-8004 registration

Registration runs on agent creation unless skipped. With `PINATA_JWT` (or
`IPFS_NODE_URL`) set, the registration file is pinned to IPFS and contains:

- `services[]`: your endpoints with canonical names (`A2A`, `MCP`, `web`,
  `email`, …), `agentWallet` as `eip155:<chainId>:<address>`, and an `oasf`
  entry when OASF domains/skills were selected. A2A endpoints are stored as
  the Agent Card URL.
- `x402Support`, `active`, `supportedTrust`, and a `metadata` block with the
  selected actions/tools.

Without an IPFS backend the agent is still registered, but 8004scan shows no
name, description or services.

## Environment

Copy `.env.example` to `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `RPC_URL` | yes | RPC endpoint for the active network |
| `MASTER_PRIVATE_KEY` | yes | Owner of registered agents, funds agent wallets. Written by `npm run setup` |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | one | LLM key for the chosen provider |
| `LLM_PROVIDER` | no | `openrouter` (default), `anthropic`, `openai` |
| `LLM_MODEL` | no | Model override |
| `NETWORK` | no | `arbitrum-sepolia` (default), `arbitrum-one`, `robinhood-testnet` |
| `PINATA_JWT` or `IPFS_NODE_URL` | no | IPFS backend for registration files and images |
| `PINATA_GATEWAY_URL` | no | IPFS gateway override |
| `MCP_AUTH_TOKEN` | for MCP tool calls | Bearer token for `tools/call` |
| `MCP_RATE_MAX`, `MCP_RATE_WINDOW_MS` | no | MCP rate limit (60 per 60 s) |
| `MCP_PORT`, `MCP_AGENT` | no | Standalone MCP server port (8788) and agent scope |
| `X402_FACILITATOR_URL` | for real payments | x402 facilitator base URL, e.g. `https://x402.org/facilitator`. Unset = test mode (simulated) |
| `A2A_PAY_TO` | no | Makes the generic (no `?agent=`) A2A endpoint paid, to this address |
| `A2A_X402` | no | `0` keeps the generic endpoint free even with `A2A_PAY_TO` |
| `RATER_PRIVATE_KEY` | for rating | Signs reputation feedback (must not be the agent's owner) |
| `SCAN_API_KEY`, `SCAN_API_BASE` | for scan tools | 8004scan API access |
| `ARBISCAN_API_KEY` / `ETHERSCAN_API_KEY` | no | Higher rate limits for the ABI tool |
| `API_PORT` | no | API port (8787) |
| `CORS_ORIGIN` | no | Comma-separated allowed origins |
| `ALLOW_AGENT_DELETE` | no | Allow `DELETE /api/agents/:name` on Vercel |
| `AGENT_<NAME>_PRIVATE_KEY`, `AGENT_<NAME>_CONFIG` | no | Provide an agent through env vars instead of files (Vercel) |
| `VITE_WEB3AUTH_CLIENT_ID` | frontend | Web3Auth client id (`frontend/.env`) |

`X402_FACILITATOR_URL`, `A2A_PAY_TO` and `A2A_X402` are not yet listed in `.env.example`.

## Networks

| Network | Chain ID | Notes |
|---|---|---|
| Arbitrum Sepolia | 421614 | Default |
| Arbitrum One | 42161 | Mainnet |
| Robinhood Testnet | 46630 | Experimental |

## Deploying to Vercel

Pushing to `main` deploys via `.github/workflows/deploy.yml`. The frontend is
built as static files and `api/index.ts` serves the API.

There is no shared storage: agents created on Vercel live in `/tmp` of one
instance. The create response returns the private key once, the browser keeps
a backup in `localStorage`, and replays it to `/restore` when an instance has
forgotten the agent. For a durable agent set `AGENT_<NAME>_PRIVATE_KEY` and
`AGENT_<NAME>_CONFIG` in the project's environment variables.

## Project layout

```
api/index.ts          Vercel entry (Node → Hono bridge)
src/
  server/api.ts       HTTP API: agents, chat, MCP, A2A, RPC proxy
  a2a/                A2A JSON-RPC server, x402 helpers, mock + HTTP facilitators
  mcp/server.ts       MCP server (stdio + HTTP)
  core/               config, wallets, LLM, agent config, registry, registration services, IPFS, OASF, reputation
  actions/            tools and skills
  cli/                setup, create-agent, chat, delete-agent, deploy
  index.ts            package exports
frontend/             Vue 3 + wagmi console, Playwright e2e in frontend/e2e
docs/                 specs
```

## Development

```bash
npm run typecheck:all    # backend + frontend
npm run lint             # oxlint, warnings are errors
npm run test:unit        # vitest
npm run test:e2e:offline # Playwright, mocked API, chromium
npm run test:e2e:onchain # Playwright against a real chain (needs funded keys)
```

CI runs the first four on every push and pull request. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Security

- Never commit `.env` or anything under `agents/`.
- The master key owns every registered agent and funds their wallets; keep
  only test funds on it.
- Agent keys are plain JSON on disk. On Vercel the key is also returned to the
  browser once and stored in `localStorage`.
- A2A routes are public and unauthenticated, which is why agents only get read-only tools there; MCP tool calls need the bearer token.

## License

Apache 2.0, see [LICENSE](./LICENSE).
