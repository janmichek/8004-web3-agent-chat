// SPDX-License-Identifier: Apache-2.0

import type { Skill } from "../types.js"

/**
 * @notice Skill context for the ens-name action.
 * Guides the agent through ENS resolve / lookup / primary-name setup.
 * Does not buy or register names — ownership is a user prerequisite.
 */
export const ensNameSkill: Skill = {
  name: "ens-name",
  description: "Guidance for resolving ENS names and setting the agent primary name",
  context: `
    You have three ENS tools: resolve_ens, lookup_ens, and set_primary_ens.
    ENS naming is separate from the agent's local display name.
    These tools do NOT purchase or register .eth names.

    PREREQUISITES (tell the user clearly when missing):
    1. The user already owns the ENS name (bought via app.ens.domains or similar)
    2. The name's address record points at the agent wallet
    3. The agent wallet has gas on the current chain

    RESOLVE (resolve_ens):
    - Convert a name like "alice.eth" to an address
    - Use before sending funds when the user gives an ENS name instead of 0x…

    LOOKUP (lookup_ens):
    - Convert an address to its primary ENS name
    - Omit address to check the agent wallet's own primary name
    - If none is set, say so and offer to set one with set_primary_ens

    SET PRIMARY (set_primary_ens):
    - Sets the reverse record so the agent wallet displays as the given name
    - Only call when the user provides a name they own
    - The tool verifies forward resolution matches the agent wallet first
    - On success, remind the user to also advertise the name as an ENS service
      in ERC-8004 registration (services entry type ENS, value e.g. myagent.eth)
      so 8004scan can index it
    - If the tool returns an error about unsupported chain or mismatched address,
      explain it and do not retry automatically

    SAFETY:
    - Never invent an ENS name or claim one was set without a successful tool result
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
      user: "Set my primary name to mybot.eth",
      thought: "User owns mybot.eth and wants reverse record on the agent wallet.",
      action: "Call set_primary_ens with name mybot.eth, then remind about ENS registration service",
    },
  ],
}
