// SPDX-License-Identifier: Apache-2.0

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { parseEther, formatEther } from "viem";
import { getAgentPublicClient, getAgentWalletClient } from "./viem-clients.js";
import { toolError } from "./errors.js";

/**
 * @notice Sends ETH from the agent wallet to a destination address.
 * Reads AGENT_PRIVATE_KEY from environment. Never throws, returns a string
 * containing the transaction hash on success or an error message on failure.
 */
export const sendEthTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "send_eth",
  description:
    "Send ETH from the agent wallet to a destination address. " +
    "Returns the transaction hash on success or an error message on failure.",
  schema: z.object({
    to: z.string().describe("Destination wallet address (0x...)"),
    amount: z.string().describe("Amount of ETH to send as decimal string e.g. '0.01'"),
  }),
  func: async ({ to, amount }): Promise<string> => {
    try {
      const privateKey = process.env.AGENT_PRIVATE_KEY;
      if (!privateKey) {
        return "Error: AGENT_PRIVATE_KEY environment variable is not set";
      }

      const { account, walletClient } = getAgentWalletClient(privateKey as `0x${string}`);
      const publicClient = getAgentPublicClient();

      const value = parseEther(amount);

      const balance = await publicClient.getBalance({ address: account.address });
      if (balance < value) {
        return `Error: Insufficient balance. Have ${formatEther(balance)} ETH, need ${amount} ETH.`;
      }

      const hash = await walletClient.sendTransaction({
        to: to as `0x${string}`,
        value,
      });

      return hash;
    } catch (err) {
      return toolError(err);
    }
  },
});
