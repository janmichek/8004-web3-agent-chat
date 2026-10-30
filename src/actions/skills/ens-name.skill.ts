// SPDX-License-Identifier: Apache-2.0

import type { Skill } from "../types.js";

/**
 * @notice Skill context for the ens-name action.
 * Guides the agent through ENS resolve / lookup / registration / primary-name setup.
 */
export const ensNameSkill: Skill = {
  name: "ens-name",
  description:
    "Guidance for resolving ENS names, registering .eth names, and setting the agent primary name",
  context: `
    You have four ENS tools: resolve_ens, lookup_ens, register_ens, and set_primary_ens.
    ENS naming is separate from the agent's local display name.
    "You", "yourself" and "my name" all mean the agent wallet: you can only name your own wallet.

    RESOLVE (resolve_ens):
    - Convert a name like "alice.eth" to an address
    - Use before sending funds when the user gives an ENS name instead of 0x…

    LOOKUP (lookup_ens):
    - Convert an address to its primary ENS name
    - Omit address to check the agent wallet's own primary name
    - If none is set, say so and offer to register one with register_ens

    REGISTER (register_ens):
    - Registers a new .eth name for the agent wallet, points it at the agent, and sets it
      as the primary name, all in one call. Do NOT call set_primary_ens afterwards.
    - Use it whenever the user asks to buy, register, claim, get, or apply an ENS name
      for the agent, e.g. "apply ens name on yourself mybot" means register_ens with name mybot
    - A bare word is a label: "mybot" registers mybot.eth
    - Testnet only: the name lives on Ethereum Sepolia and is paid for with test USDC the
      tool mints itself, so no price confirmation is needed. The wallet only needs Sepolia
      ETH for gas.
    - It takes about a minute. Tell the user it is running a commit-reveal registration.
    - If it returns an error after completing some steps, call it again with the same
      name to resume. Do not retry more than once without telling the user what failed.
    - If the name is taken by someone else, say so and ask for another name
    - If the user did not give a name, ask for one. Never pick a name for them.

    SET PRIMARY (set_primary_ens):
    - Sets the reverse record so the agent wallet displays as the given name
    - Only for a name that ALREADY resolves to the agent wallet but is not its primary
      name yet. For a new name use register_ens instead.
    - The tool verifies forward resolution matches the agent wallet first
    - If the tool returns an error about unsupported chain or mismatched address,
      explain it and do not retry automatically

    AFTER A NAME IS SET (either tool):
    - Remind the user to also advertise the name as an ENS service in ERC-8004
      registration (services entry type ENS, value e.g. myagent.eth) so 8004scan can index it

    SAFETY:
    - Never invent an ENS name or claim one was registered or set without a successful tool result
    - Never ask the user for a private key
  `,
  examples: [
    {
      user: "What's my ENS name?",
      thought: "Check the agent wallet reverse record.",
      action: "Call lookup_ens with no address",
    },
    {
      user: "Resolve vitalik.eth",
      thought: "Forward resolution only.",
      action: "Call resolve_ens with name vitalik.eth",
    },
    {
      user: "apply ens name on yourself mybot",
      thought:
        "The agent has no name yet, so mybot.eth must be registered first. register_ens also sets it as primary.",
      action: "Call register_ens with name mybot, then remind about ENS registration service",
    },
    {
      user: "Can you buy mybot.eth for me?",
      thought: "Buying a .eth name is register_ens. It registers to the agent wallet.",
      action: "Call register_ens with name mybot.eth",
    },
    {
      user: "Set my primary name to mybot.eth",
      thought:
        "The name may already point at the agent wallet; try the reverse record, and register only if it does not resolve.",
      action:
        "Call set_primary_ens with name mybot.eth; if it does not resolve to any address, call register_ens",
    },
  ],
};
