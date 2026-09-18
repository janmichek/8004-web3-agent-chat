# web3Agent frontend

Vue 3 + wagmi console for wallet balances and agent chat.

## Run

From the repo root (two terminals):

```bash
# API — lists agents + chat (needs .env + an agent)
npm run serve

# UI
npm run frontend
```

Open http://localhost:5173 — Vite proxies `/api` to `http://localhost:8787`.

## Features

- Connect injected wallet (MetaMask, etc.) via `@wagmi/vue`
- ETH balances for your wallet and the selected agent
- Transfer ETH from your wallet to the agent wallet
- Chat with local agents (same tools/skills as `npm run chat`)
