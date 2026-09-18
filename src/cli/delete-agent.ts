/**
 * Delete an agent's local directory (config, wallet, memory).
 *
 * Usage:
 *   npm run delete-agent -- --name my-agent
 *   npm run delete-agent -- --name my-agent --yes
 */
import dotenv from "dotenv"
import * as p from "@clack/prompts"
import { deleteAgentConfig, loadAgentConfig } from "../core/agent-config.js"

dotenv.config()

const args = process.argv.slice(2)
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : undefined
}

async function main(): Promise<void> {
  p.intro("Delete Agent")
  let name = getFlag("name")
  if (!name) {
    const result = await p.text({ message: "Agent name", validate: (v) => (!v?.trim() ? "Name is required" : undefined) })
    if (p.isCancel(result)) { p.cancel("Cancelled."); process.exit(0) }
    name = result as string
  }
  name = name.trim()
  const config = loadAgentConfig(name)
  if (!config) {
    p.cancel(`Agent "${name}" not found.`)
    process.exit(1)
  }
  if (!args.includes("--yes")) {
    const confirm = await p.confirm({ message: `Delete agent "${name}" (config, wallet, memory)? This cannot be undone.` })
    if (p.isCancel(confirm) || !confirm) { p.cancel("Cancelled."); process.exit(0) }
  }
  const removed = deleteAgentConfig(name)
  if (removed) p.outro(`Deleted agent "${name}".`)
  else p.cancel(`Nothing deleted for "${name}".`)
}

main().catch((err) => {
  p.cancel(`Fatal: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
