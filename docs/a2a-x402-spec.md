# Spec: A2A endpoint, x402 payment flow, 8004scan service registration

Status: implemented (commits `17ada84`, `a7b1fbb`, plus the cleanup and completion passes on top, uncommitted).
Scope: everything those commits added. Each numbered requirement is observable
behavior; "Test" names the test that pins it (`—` = not covered by a test).

## 1. Purpose and limits

Goal: an agent created by this app shows **A2A**, **agentWallet** and
**x402** on its 8004scan Services tab, the advertised URLs answer, and a
caller who reaches the agent over A2A gets a real answer from it.

| Limit | Consequence |
|---|---|
| A2A callers are anonymous, so the agent runs with **read-only tools only** (`get_token_balance`, `fetch_contract_abi`). `send_eth` and `call_contract` are never available over A2A. | An agent cannot be asked to move funds by an outside agent. |
| A2A requests are stateless: no conversation memory, and the owner's chat history is neither read nor written. | Each `message/send` is answered on its own. |
| Without `X402_FACILITATOR_URL` payments use `MockFacilitatorClient`: shape checks only, nobody is charged. | "Test mode". The UI, CLI and health descriptor say so. |
| With a facilitator, only the mock-signed and bad-signature paths were exercised. A payment with a real funded signature has not been run end to end. | Treat real settlement as untested. |
| Tasks live in process memory (max 1000 per server, oldest evicted). | Lost on restart. On Vercel the two calls of a payment flow can hit different instances → `UNKNOWN_TASK`. |
| Price and asset are fixed: 0.01 USDC on Base Sepolia, regardless of the agent's own chain. | Not configurable per agent. |
| The generic endpoint (no `?agent=`) is an echo. | It exists for health checks and protocol testing. |

## 2. Files

| File | Role |
|---|---|
| `src/a2a/types.ts` | A2A / x402 / JSON-RPC types, extension URIs, `X402_VERSION` |
| `src/a2a/x402.ts` | Payment requirements builder, metadata read/write helpers, extension-header check |
| `src/a2a/mock-facilitator.ts` | `MockFacilitatorClient`, `buildMockPaymentPayload` |
| `src/a2a/http-facilitator.ts` | `HttpFacilitatorClient`: real verify/settle over HTTP |
| `src/a2a/server.ts` | `A2AServer`: Agent Card, health descriptor, JSON-RPC, payment state machine; work is delegated to an `A2AExecutor` |
| `src/core/action-registry.ts` | `readOnly` flag per tool (decides what A2A may use) |
| `src/core/registration-services.ts` | Canonical service names, A2A URL normalization, URL validation, `services[]` builder |
| `src/core/registry.ts` | Uses the above when registering and when pinning the enriched registration file |
| `src/server/api.ts` | HTTP routes, per-agent server cache, agent executor, facilitator selection, rate limit, `POST /api/agents` inputs |
| `src/cli/create-agent.ts` | `--a2a-endpoint`, `--x402`, prompts |
| `frontend/src/components/CreateAgent.vue` | A2A endpoint field, x402 checkbox, service links |
| `frontend/src/components/AgentPicker.vue` | Services and x402 rows in Agent Info |
| `vercel.json`, `frontend/vite.config.ts` | Route `/a2a` and `/.well-known/agent-card.json` to the API |

## 3. HTTP surface

| # | Route | Behavior | Test |
|---|---|---|---|
| H1 | `GET /.well-known/agent-card.json` | 200, Agent Card (§4) | `api.e2e` "agent-card.json + /api/a2a health" |
| H2 | `GET /api/a2a`, `GET /a2a` | 200, health descriptor (§5) | same |
| H3 | `POST /api/a2a`, `POST /a2a` | JSON-RPC (§6). Always HTTP 200, errors inside the body | `api.e2e` "message/send without extension" |
| H4 | `POST` with unparsable JSON | HTTP 400, `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}` | `api.e2e` "malformed JSON" |
| H5 | Any other method on `/api/a2a`, `/a2a` | HTTP 405 `{error}` (`OPTIONS` is answered by CORS) | — |
| H6 | `?agent=<name>` on H1–H3 | Serves that agent: its LLM answers (§7a), x402 follows its config. Name must match `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$` and have a config, else HTTP 404 `{"error":"Unknown agent: <name>"}` | `api.e2e` "?agent= scopes the Agent Card" |
| H7 | No `?agent=` | Generic echo endpoint, name `web3agent`. Free unless `A2A_PAY_TO` is set (then paid, unless `A2A_X402=0`) | `api.e2e` "generic endpoint is a free echo", "without extension" |
| H11 | `POST` rate limit | Per client IP, same limits as MCP (`MCP_RATE_MAX` per `MCP_RATE_WINDOW_MS`, default 60/min). Over the limit: HTTP 429 with a JSON-RPC error | — |
| H8 | CORS | `X-A2A-Extensions` is an allowed request header | — |
| H9 | Vercel rewrites | `/a2a` and `/.well-known/agent-card.json` → API function | — |
| H10 | Vite dev proxy | `/api`, `/mcp`, `/a2a`, `/.well-known/agent-card.json` → `localhost:${API_PORT:-8787}` | — |

Public URL: `{x-forwarded-proto | "http"}://{x-forwarded-host | host}/api/a2a`,
plus `?agent=<name>` when scoped. It is the card's `url` and the payment `resource`.

Server cache: one `A2AServer` per agent name (one for the generic config).
It is rebuilt, dropping its tasks, when public URL, `x402support`,
`walletAddress`, `active` or `updatedAt` change.

Environment:

| Variable | Default | Effect |
|---|---|---|
| `X402_FACILITATOR_URL` | unset | Base URL of an x402 facilitator (e.g. `https://x402.org/facilitator`). Set → real verify + settle. Unset → mock (test mode) |
| `A2A_PAY_TO` | unset | payTo address for the generic endpoint; setting it makes that endpoint paid |
| `A2A_X402` | on | `0` keeps the generic endpoint free even with `A2A_PAY_TO` |

**x402 is on** for a server only when its config has `x402support: true` **and**
`walletAddress` is a valid `0x` address. Otherwise the endpoint is free. There
is no placeholder payee.

## 4. Agent Card

| # | Field | Value | Test |
|---|---|---|---|
| C1 | `name` | config name | `a2a-server` "builds agent card" |
| C2 | `description` | config description, or `Agent <name>` when empty | — |
| C3 | `url` | public JSON-RPC URL incl. `?agent=` | `a2a-server`, `api.e2e` |
| C4 | `version` / `protocolVersion` | `0.1.0` / `0.3.0` | — |
| C5 | `capabilities` | `streaming: false`, `pushNotifications: false` | — |
| C6 | `capabilities.extensions` | only when x402 is on (§3): one entry, `uri` = v0.2 x402 URI, `required: true` | `a2a-server` both card tests |
| C7 | `defaultInputModes` / `defaultOutputModes` | `text/plain` | — |
| C8 | `skills` for an agent | `chat` (description = agent description), then one `tool:<name>` per read-only tool the agent was given, tags `tool`, `read-only`. Tools that can sign or send are not listed | `api.e2e` "advertises chat plus…" |
| C9 | `skills` for the generic endpoint | single `echo` skill | `a2a-server` "echo is the default skill" |
| C11 | `x402support` set but no valid wallet | no extension, endpoint is free | `a2a-server` "without a payable wallet" |
| C10 | `supportsAuthenticatedExtendedCard` | `false` | — |

## 5. Health descriptor

`{ name, protocol: "a2a", endpoint: "/api/a2a", agentCard: "/.well-known/agent-card.json", active, x402support }`.
When x402 is on it also carries
`x402: { facilitator: "mock" | "<facilitator url>", network, payTo, maxAmountRequired }`.
— Test: `a2a-server` "health descriptor", "health names the facilitator", `api.e2e`.

## 6. JSON-RPC

| # | Input | Result | Test |
|---|---|---|---|
| R1 | Body not an object, `jsonrpc !== "2.0"`, or `method` not a string | error `-32600` Invalid Request | `a2a-server` "invalid JSON-RPC envelope" |
| R2 | Unknown method | error `-32601` | `a2a-server` "unknown method" |
| R3 | `message/send` without `params.message` object with `parts[]` | error `-32602` | `a2a-server` "without a message" |
| R4 | `message/send` | result = Task (§7) | many |
| R5 | `tasks/get` `{id}` | result = stored Task; unknown id → error `-32001` with `data.taskId` | `a2a-server` "tasks/get" |
| R6 | Handler throws | error `-32000` with the message | — |
| R7 | Response `id` | echoes request id, `null` if absent | `a2a-server` |

Task shape: `{ kind: "task", id: "task-<uuid>", contextId, status: { state, message }, artifacts? }`.
`status.message` is an agent message with one text part and, in payment
flows, x402 metadata. `contextId` is the request message's `contextId` or a new UUID.

## 7. `message/send` behavior

Evaluated in this order:

| # | Condition | Outcome | Test |
|---|---|---|---|
| M1 | Agent `active === false` | new task `failed`, text `Agent is inactive`, no x402 metadata | `a2a-server` "inactive agent" |
| M2 | Message is a payment reply (§8) | payment handling | §8 |
| M3 | x402 off | executor runs (§7a); new task `completed` with its answer | `a2a-server` "free task", "delegates the work" |
| M3a | x402 off, executor throws | new task `failed`, text `Agent failed: <message>`, no x402 metadata; the RPC call itself succeeds | `a2a-server` "a failing executor" |
| M4 | x402 on, `X-A2A-Extensions` lacks an x402 URI | new task `failed`, error `EXTENSION_NOT_ACTIVATED` | `combined` "without X-A2A-Extensions", `api.e2e` |
| M5 | x402 on, extension activated | new task `input-required`, status `payment-required`, `x402.payment.required` = `{ x402Version: 1, error, accepts: [requirements] }`. The executor does **not** run yet | `combined` "happy path", "does not run before payment" |

`<text>` = text parts of the message joined by newline, trimmed.

### 7a. Executor

| # | Rule | Test |
|---|---|---|
| E1 | Generic endpoint: echo, answer = `<text>` or `ok` | `api.e2e` "free echo" |
| E2 | Agent endpoint: one LLM turn as that agent. System prompt names the agent, its wallet and network, lists the allowed tools, and states it cannot send funds or sign over A2A | live-checked, no unit test |
| E3 | Allowed tools = the agent's `metadata.tools` that are `readOnly` in the registry. Action bundles and their skill prompts are not loaded | `api.e2e` "read-only tools only", "reports … read-only tools" |
| E4 | No checkpointer: nothing is read from or written to the owner's chat history | — |
| E5 | Recursion limit and the "ran out of steps" fallback are the same as chat | — |

Extension header: comma-separated list; activated when any entry equals the
v0.2 URI `https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2`
or the legacy `https://github.com/google-a2a/a2a-x402/v0.1`.
Test: `x402-helpers` "csv + legacy + empty", `combined` "legacy extension URI".

Payment requirements (M5):

| Field | Value |
|---|---|
| `scheme` | `exact` |
| `network` | `base-sepolia` |
| `asset` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (USDC) |
| `maxAmountRequired` | `10000` (0.01 USDC) |
| `payTo` | agent `walletAddress` (always a valid address, see §3) |
| `resource` | public JSON-RPC URL |
| `description` | `Payment for: <first 80 chars of text, or "A2A skill">` |
| `maxTimeoutSeconds` / `mimeType` | `600` / `application/json` |
| `extra` | `{ name: "USDC", version: "2" }` |

Test: `x402-helpers` "default requirements", `combined` "happy path".

## 8. Payment replies

A message is a payment reply when `metadata["x402.payment.status"]` is
`payment-submitted` or `payment-rejected`, or `metadata["x402.payment.payload"]`
is an object. It must carry `taskId`.

| # | Condition | Outcome | Stored task | Test |
|---|---|---|---|---|
| P1 | `taskId` missing or unknown | new task `failed`, `UNKNOWN_TASK` | new one | `combined` "unknown taskId" |
| P2 | Task already `completed` | `failed`, `DUPLICATE_PAYMENT` | **unchanged** | `combined` "duplicate payment", "payment-rejected after settlement" |
| P3 | Task in any other non-awaiting state (`failed`, `working`, free task) | `failed`, `TASK_NOT_AWAITING_PAYMENT` | **unchanged** | `combined` "payment on a failed task" |
| P4 | `payment-rejected` on an awaiting task | `failed`, status `payment-rejected`, error `PAYMENT_REJECTED` | updated | `combined` "payment-rejected ends task" |
| P5 | Submission without payload | `failed`, `INVALID_PAYMENT` | updated | `combined` "missing payload" |
| P6 | `facilitator.verify` fails | `failed`, facilitator's error code, one receipt `success: false` | updated | `combined` wrong amount / expired / insufficient funds / wrong network |
| P6a | Verify succeeds, executor throws | `failed`, `SERVER_ERROR`, text `Agent failed, payment not settled: …`. **Settle is not called** | updated | `combined` "a failed run is not charged" |
| P7 | `facilitator.settle` fails | `failed`, `SETTLEMENT_FAILED` (or facilitator code), receipt `success: false`; the answer is not returned | updated | `combined` "settle fail" |
| P8 | Verify, executor, settle succeed (in that order) | `completed`, status `payment-completed`, receipt `{success: true, transaction, network, payer}`, text = executor answer for the original request, one artifact `{artifactId, name: "result", parts}`; `contextId` kept | updated | `combined` "happy path", "work runs after verify and before settle" |
| P9 | During P6–P8 | stored status passes through `working` + `payment-submitted`, then `working` + `payment-verified`; a concurrent submission gets P3 | — | — |
| P10 | Independent tasks | paying one does not affect another | — | `combined` "two concurrent unpaid tasks" |

A failed task is terminal: the client starts over with a new request.

Metadata keys written by the server: `x402.payment.status`,
`x402.payment.required`, `x402.payment.receipts`, `x402.payment.error`.
Payment failures carry `x402.payment.status: payment-failed` (or
`payment-rejected` for P4) and `x402.payment.error`. Failures that are not
about payment (M1, M3a) carry no x402 metadata.

## 9. Facilitators

`X402_FACILITATOR_URL` set → `HttpFacilitatorClient`, else `MockFacilitatorClient`.
One instance serves all agents.

### 9.1 HTTP facilitator

| # | Rule | Test |
|---|---|---|
| X1 | `verify` / `settle` = `POST {url}/verify` / `POST {url}/settle` with `{ x402Version: 1, paymentPayload, paymentRequirements }`, 20 s timeout | `http-facilitator` "posts the x402 v1 envelope" |
| X2 | `isValid: true` → valid, with `payer` | same |
| X3 | Invalid → `invalidReason` passed through; error code by reason: `insufficient_funds` → `INSUFFICIENT_FUNDS`, `*signature*` → `INVALID_SIGNATURE`, `valid_before`/`expired` → `EXPIRED_PAYMENT`, `recipient`/`pay_to` → `WRONG_PAYEE`, `network` → `WRONG_NETWORK`, `value`/`amount` → `WRONG_AMOUNT`, else `INVALID_PAYMENT` | "maps facilitator reasons" |
| X4 | HTTP error, timeout or network failure → verify: invalid with `SERVER_ERROR`; settle: failed with `SETTLEMENT_FAILED`. Never treated as paid | "treats HTTP and network failures as failed" |
| X5 | Settle success returns the facilitator's `transaction` hash | "returns the settlement transaction" |

Live check: `https://x402.org/facilitator` rejected a mock-signed payload with
`invalid_exact_evm_signature` → task `failed`, `INVALID_SIGNATURE`, executor not run.

### 9.2 Mock facilitator

`verify(payload, requirements)` checks, first failure wins:

| Order | Check | Error code |
|---|---|---|
| 0 | `forceVerifyFail` option set | its `errorCode`, default `INVALID_PAYMENT` |
| 1 | authorization and signature present | `INVALID_PAYMENT` |
| 2 | `from` / `to` are 0x + 40 hex | `INVALID_PAYMENT` |
| 3 | signature is 0x + at least 130 hex chars | `INVALID_SIGNATURE` |
| 4 | scheme matches | `INVALID_PAYMENT` |
| 5 | network matches | `WRONG_NETWORK` |
| 6 | `to` equals `payTo` (case-insensitive) | `WRONG_PAYEE` |
| 7 | `value` equals `maxAmountRequired` exactly | `WRONG_AMOUNT` |
| 8 | `asset`, when sent, matches (case-insensitive) | `WRONG_ASSET` |
| 9 | `validAfter` / `validBefore` are numbers | `INVALID_PAYMENT` |
| 10 | now ≥ `validAfter` | `INVALID_PAYMENT` |
| 11 | now ≤ `validBefore` | `EXPIRED_PAYMENT` |
| 12 | payer not in `underfundedPayers` | `INSUFFICIENT_FUNDS` (payer returned) |

`settle` re-runs `verify`, then fails with `forceSettleFail` if set (default
code `SETTLEMENT_FAILED`), else returns `transaction` = `0x` + sha256 of the
authorization nonce (same nonce → same hash).

Options: `forceVerifyFail`, `forceSettleFail`, `underfundedPayers: string[]`, `now()`.
`buildMockPaymentPayload({ requirements, from, ...overrides })` returns a
payload that passes all checks; every field can be overridden.

Test: `mock-facilitator.test.ts` (one case per row), `combined` for propagation.

## 10. Service registration (8004scan)

### 10.1 Canonicalization — `canonicalizeEndpoint`

| # | Rule | Test |
|---|---|---|
| S1 | Names, case-insensitive, trimmed: `a2a→A2A`, `mcp→MCP`, `ens→ENS`, `did→DID`, `oasf→oasf`, `wallet`/`agentwallet→agentWallet`, `web→web`, `email→email`; anything else kept as typed | `registration-services` "8004scan casing" |
| S2 | A2A URL whose path ends in `/a2a` → same origin `/.well-known/agent-card.json`; query string kept, fragment dropped; other URLs and non-URLs unchanged | "rewrites /api/a2a", "leaves agent-card URLs", "keeps the ?agent= scope" |
| S3 | Default `version` meta: A2A `0.3.0`, MCP `2025-06-18`; caller-supplied meta wins | "adds default protocol version" |
| S4 | `isAdvertisableUrl`: `https://…` anywhere, `http://` only for `localhost` / `127.0.0.1` | "accepts https and local http only" |

### 10.2 `buildRegistrationServices`

| # | Rule | Test |
|---|---|---|
| B1 | One `{name, endpoint, ...meta}` per endpoint, canonicalized, input order kept | "emits A2A + MCP versions…" |
| B2 | Duplicate names (case-insensitive): first wins | "converts a bare 0x…and dedupes" |
| B3 | An `agentWallet` endpoint given as bare `0x…` becomes `eip155:<chainId>:<address>` when `chainId` is known | same |
| B4 | When `walletAddress` and `chainId` are given and no `agentWallet` endpoint exists, append `{name: "agentWallet", endpoint: "eip155:<chainId>:<address>"}` | "adds agentWallet only when…", "does not duplicate agentWallet" |
| B5 | When `metadata.oasfDomains` or `metadata.oasfSkills` is non-empty and no `oasf` endpoint exists, append the OASF service; its endpoint is `<origin of first http(s) endpoint>/oasf`, fallback `https://example.com/oasf` | "emits … and oasf" |

### 10.3 `registerAgent`

| # | Rule |
|---|---|
| G1 | SDK registration file endpoints = `options.endpoints` canonicalized (§10.1) |
| G2 | `x402support` option → SDK `setX402Support` |
| G3 | IPFS mode re-pins an enriched file with: `services` (§10.2), top-level `x402Support`, `active`, `registrations`, `image`, `supportedTrust` (SDK trust models, default `["reputation"]`), and `metadata` = caller metadata + `updatedAt`. x402 and the wallet are **not** repeated under `metadata`: 8004scan reads the top-level flag and the `agentWallet` service only |
| G4 | If the enriched pin fails, the SDK-pinned URI is kept and a warning is logged |

No unit test: needs chain + IPFS.

## 11. Creating an agent with A2A / x402

### 11.1 `POST /api/agents`

| # | Rule | Test |
|---|---|---|
| A1 | Body accepts `a2aEndpoint` (string) and `x402support` (boolean, default false) next to `mcpEndpoint` / `services` | — |
| A2 | `mcpEndpoint` / `a2aEndpoint` append an `mcp` / `A2A` service unless `services` already has one (case-insensitive) | — |
| A3 | Each service is canonicalized (§10.1) before validation and storage | — |
| A4 | Duplicate canonical names → 400 `duplicate service` | — |
| A5 | `mcp`, `a2a`, `web` endpoints must pass `isAdvertisableUrl`, else 400 `<name> endpoint must be an https:// URL` | `api.e2e` "rejects bad a2a endpoint URL" |
| A6 | `x402support` is stored in the agent config and passed to registration | — |
| A6a | `x402support: true` without an A2A service → 400 `x402support requires an A2A endpoint` | `api.e2e` "rejects x402support without an A2A endpoint" |
| A7 | Agent summaries (`GET /api/agents`, `GET /api/agents/:name`, create response) include `x402support` and, when it is true, `x402Mode` (`mock` / `facilitator`); `services` mirrors stored endpoints | — |
| A8 | `GET /api/catalog` includes `x402: { mode, network, maxAmountRequired }` and `readOnly` per tool | `api.e2e` "reports the x402 mode" |

### 11.2 Web console

| # | Rule | Test |
|---|---|---|
| W1 | "A2A endpoint" field defaults to `${origin}/api/a2a?agent=<name>` and follows the name while it is valid; before a valid name it is `${origin}/api/a2a` | Playwright "a2a endpoint follows the agent name" |
| W2 | Once the user types in the field their value is kept; an empty field means no A2A | same, "web/email-only payload" |
| W3 | Sent as service `{name: "A2A", endpoint}` when non-empty | Playwright `create-agent` |
| W4 | Hint under the field: with A2A, that the agent answers with read-only tools and never sends funds; without, that the agent is unreachable and x402 is off | — |
| W5 | Checkbox "Charge for A2A requests (x402)". Disabled and off without an A2A endpoint. Default: on when the server has a facilitator, off in test mode. The user's choice overrides the default | Playwright "x402 is opt-in in test mode" |
| W6 | Checkbox hint states the mode: real (0.01 USDC on Base Sepolia, paid after answering) or test mode (simulated, nobody charged, 8004scan still shows x402, how to enable) | same |
| W7 | `x402support` in the request = checkbox state | same |
| W8 | Done screen: each service on its own line, http(s) endpoints as links; an `x402` row with the mode when enabled | — |
| W9 | Agent Info (picker): `Services` chips, http(s) ones link to the endpoint; `x402` row with the mode when enabled | — |

### 11.3 CLI `npm run create-agent`

| # | Rule |
|---|---|
| L1 | `--a2a-endpoint <url>` or interactive prompt; empty = not advertised |
| L2 | `--mcp-endpoint` / `--a2a-endpoint` must pass `isAdvertisableUrl`; a bad flag exits 1 |
| L3 | A2A endpoint is stored normalized (§10.1 S2) |
| L4 | `--x402` enables x402 and requires `--a2a-endpoint` (exit 1 otherwise). Without the flag and with an A2A endpoint, a confirm prompt decides; it states the mode and defaults to yes only when `X402_FACILITATOR_URL` is set |
| L5 | Summary prints `A2A` and `x402` lines; x402 shows `test mode, payments simulated` without a facilitator |

## 12. Also shipped in the same commit (not A2A)

Funding from the connected wallet in the create wizard:

| # | Rule | Test |
|---|---|---|
| F1 | Nonce, gas and fees are estimated through the app's `/api/rpc` proxy, then the prepared transaction is sent to the wallet | — |
| F2 | Requires a connected account, else `Connect a wallet first` | — |
| F3 | On an RPC rate-limit error the send is retried up to 3 times (800 ms, 1600 ms backoff) with a `RPC busy, retrying (n/3)…` status | — |
| F4 | Errors are mapped: user rejection → `Wallet signature rejected.`; insufficient funds → `Wallet has insufficient ETH.` (connected wallet) or `Master wallet has insufficient ETH. Fund it on <agent's network>, then retry.` (master wallet); rate limit → `RPC rate limit hit. Wait a few seconds and retry.`; otherwise first line of the message | `rpc-errors.test` |
| F6 | The same mapping is used by the wizard and the picker's fund button; the picker's delete error shows the first line of the server message | Playwright `agent-picker` |
| F5 | Rate limit = `exceeds defined limit`, `limit exceeded`, `-32005`, or standalone `429` | `rpc-errors.test` |

## 13. Public package exports

`A2AServer`, `A2AServerOptions`, `A2AExecutor`, `HttpFacilitatorClient`, `MockFacilitatorClient`,
`buildMockPaymentPayload`, `X402_EXTENSION_URI`, types `AgentCard`,
`FacilitatorClient`, `PaymentPayload`, `PaymentRequirements`,
`buildRegistrationServices`, `canonicalizeServiceName`, `normalizeA2AEndpoint`.
