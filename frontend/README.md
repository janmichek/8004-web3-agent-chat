# web3Agent frontend

Vue 3 + wagmi console. Overview and API in the [root README](../README.md).

## Run

From the repo root:

```bash
npm run dev        # API :8787, MCP :8788, UI :5173
# or
npm run serve      # API only
npm run frontend   # UI only
```

Open http://localhost:5173. Vite proxies `/api`, `/mcp`, `/a2a` and
`/.well-known/agent-card.json` to the API (`API_PORT`, default 8787).
Set `VITE_WEB3AUTH_CLIENT_ID` in `frontend/.env` for Web3Auth sign-in.

## Features

- Sign in with Web3Auth or an injected wallet; balances for you and the agent
- Create-agent wizard: details, image, actions/tools, OASF, service endpoints
  (web, email, MCP, A2A), optional x402 charging for A2A, funding
- Agent Info: ERC-8004 id, metadata, wallet, rating, services, x402 mode
- Chat with tool calls shown inline, conversation history
- Fund from the master wallet, rate an agent, delete an agent

## Tests

```bash
npm run test:e2e:offline   # Playwright with a mocked API
```
