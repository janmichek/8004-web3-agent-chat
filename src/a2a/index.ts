// SPDX-License-Identifier: Apache-2.0

/**
 * A2A transport + x402 payment (mock facilitator) public surface.
 *
 * @module a2a
 */

export {
  X402_EXTENSION_URI,
  X402_EXTENSION_URI_LEGACY,
} from "./types.js"
export type {
  A2ATask,
  AgentCard,
  FacilitatorClient,
  JsonRpcRequest,
  JsonRpcResponse,
  PaymentPayload,
  PaymentRequirements,
  PaymentStatus,
  SettlementReceipt,
} from "./types.js"

export { MockFacilitatorClient, buildMockPaymentPayload } from "./mock-facilitator.js"
export type { MockFacilitatorOptions } from "./mock-facilitator.js"

export {
  MOCK_USDC_ASSET,
  MOCK_PAYMENT_NETWORK,
  DEFAULT_PRICE_ATOMIC,
  buildPaymentRequirements,
  buildPaymentRequiredResponse,
  buildAgentPaymentMetadata,
  isX402ExtensionActivated,
  paymentPayloadFromMetadata,
  paymentStatusFromMetadata,
} from "./x402.js"

export { A2AServer, createA2AServer } from "./server.js"
export type { A2AServerOptions } from "./server.js"
