import { isAddress, type Address } from "viem";

type E2EGlobals = {
  __E2E_CONNECTED_ADDRESS?: string;
  __E2E_SEND_TX?: () => string | Promise<string>;
};

function e2eGlobals(): E2EGlobals | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as E2EGlobals);
}

/** Playwright can force the connected wallet address (no real wallet in the browser). */
export function e2eConnectedAddress(): Address | undefined {
  const forced = e2eGlobals()?.__E2E_CONNECTED_ADDRESS;
  return forced && isAddress(forced) ? forced : undefined;
}

/** Playwright can stub transaction sending and settlement. */
export function e2eSendTx(): (() => string | Promise<string>) | undefined {
  return e2eGlobals()?.__E2E_SEND_TX;
}
