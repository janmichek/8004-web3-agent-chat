// Runs only the Playwright specs that cover the frontend files in the current diff.
//
// Usage:
//   npm run test:e2e:related                 # diff against HEAD (uncommitted work)
//   npm run test:e2e:related -- --list       # print the selected specs, run nothing
//   npm run test:e2e:related -- --all        # escape hatch: full offline suite
//   E2E_BASE=origin/main npm run test:e2e:related
//
// Any extra flags after `--` are forwarded to Playwright.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const FRONTEND = "apps/frontend";
const E2E_DIR = `${FRONTEND}/e2e`;
const CONFIG = "config/playwright.config.ts";

// Touching any of these changes what every screen renders, so run every spec.
const GLOBAL_PATHS = [
  `${FRONTEND}/src/main.ts`,
  `${FRONTEND}/src/app/`,
  `${FRONTEND}/src/shared/`,
  `${FRONTEND}/src/pages/home/ui/HomePage.vue`,
  `${FRONTEND}/index.html`,
  `${FRONTEND}/vite.config.ts`,
  `${FRONTEND}/tsconfig`,
  `${FRONTEND}/package.json`,
  `${E2E_DIR}/helpers.ts`,
];

// Changes that cannot affect browser behavior.
const IGNORED_PATHS = [`${FRONTEND}/README.md`, `${E2E_DIR}/README.md`];

// First matching rule wins. Paths are substrings of the changed file path.
const RULES = [
  // UI slices
  {
    match: "pages/home/ui/agent-chat/",
    specs: [
      "chat.spec.ts",
      "chat-extras.spec.ts",
      "rate-agent.spec.ts",
      "rate-extras.spec.ts",
      "reputation-chat.spec.ts",
    ],
  },
  {
    match: "pages/home/ui/agent-picker/",
    specs: ["agent-picker.spec.ts", "picker-extras.spec.ts", "app-shell.spec.ts"],
  },
  {
    match: "pages/home/ui/agent-card/",
    specs: [
      "agent-picker.spec.ts",
      "picker-extras.spec.ts",
      "create-agent.spec.ts",
      "app-shell.spec.ts",
    ],
  },
  {
    match: "pages/home/ui/agent-memory/",
    specs: ["memory-stats.spec.ts", "memory-extras.spec.ts"],
  },
  { match: "pages/home/ui/agent-stats/", specs: ["memory-stats.spec.ts"] },
  {
    match: "pages/home/ui/create-agent/",
    specs: ["create-agent.spec.ts", "upload-errors.spec.ts", "app-shell.spec.ts"],
  },
  {
    match: "pages/home/ui/wallet-bar/",
    specs: ["wallet-bar.spec.ts", "app-shell.spec.ts", "a11y.spec.ts"],
  },
  { match: "pages/home/ui/memory/", specs: ["memory-stats.spec.ts", "memory-extras.spec.ts"] },
  // Composables
  {
    match: "pages/home/model/use-agent-memory",
    specs: ["memory-stats.spec.ts", "memory-extras.spec.ts"],
  },
  {
    match: "pages/home/model/use-agent-image",
    specs: ["create-agent.spec.ts", "upload-errors.spec.ts"],
  },
  {
    match: "pages/home/model/use-agent-funding",
    specs: ["agent-picker.spec.ts", "picker-extras.spec.ts"],
  },
  { match: "pages/home/model/use-oasf-taxonomy", specs: ["create-agent.spec.ts"] },
  { match: "pages/home/model/chat-composer-keys", specs: ["chat.spec.ts", "chat-extras.spec.ts"] },
  // Static assets are covered by the document/a11y checks.
  { match: "/public/", specs: ["a11y.spec.ts"] },
];

const argv = process.argv.slice(2);
const passthroughAt = argv.indexOf("--");
const ownArgs = passthroughAt === -1 ? argv : argv.slice(0, passthroughAt);
const playwrightArgs = passthroughAt === -1 ? [] : argv.slice(passthroughAt + 1);

const runAll = ownArgs.includes("--all");
const listOnly = ownArgs.includes("--list");
const baseIndex = ownArgs.indexOf("--base");
if (baseIndex !== -1 && !ownArgs[baseIndex + 1]) {
  console.error("--base needs a git ref, e.g. --base origin/main");
  process.exit(1);
}
const base = baseIndex !== -1 ? ownArgs[baseIndex + 1] : (process.env.E2E_BASE ?? "HEAD");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const tracked = git(["diff", "--name-only", base, "--", FRONTEND]);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", FRONTEND]);
const changed = [...new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean))]
  .filter((file) => existsSync(file))
  .sort();

if (changed.length === 0 && !runAll) {
  console.log(`No frontend changes since ${base}. Nothing to run.`);
  process.exit(0);
}

function allSpecs() {
  const listing = git(["ls-files", `${E2E_DIR}/*.spec.ts`]);
  return listing
    .split("\n")
    .filter((file) => file.endsWith(".spec.ts") && existsSync(file))
    .sort();
}

const selected = new Set();
const unmapped = [];
let global = runAll;

for (const file of changed) {
  if (IGNORED_PATHS.some((prefix) => file === prefix || file.startsWith(prefix))) continue;

  const spec = file.match(/^apps\/frontend\/e2e\/(.+)\.spec\.ts$/);
  if (spec) {
    selected.add(file);
    continue;
  }

  if (GLOBAL_PATHS.some((prefix) => file === prefix || file.startsWith(prefix))) {
    global = true;
    continue;
  }

  const rule = RULES.find((candidate) => file.includes(candidate.match));
  if (rule) {
    for (const name of rule.specs) selected.add(path.join(E2E_DIR, name));
  } else {
    unmapped.push(file);
  }
}

if (unmapped.length > 0) {
  global = true;
}

const specs = global
  ? allSpecs()
  : [...selected].filter((file) => existsSync(file)).sort((a, b) => a.localeCompare(b));

if (global) {
  const reason = runAll
    ? "--all requested"
    : unmapped.length > 0
      ? `no mapping for ${unmapped.length} file(s): ${unmapped.slice(0, 3).join(", ")}${
          unmapped.length > 3 ? ", …" : ""
        }`
      : "global file changed";
  console.log(`Running the full offline e2e suite (${reason}).`);
} else {
  console.log(`Changed frontend files: ${changed.join(", ")}`);
}

if (specs.length === 0) {
  console.log("No e2e specs matched the diff. Nothing to run.");
  process.exit(0);
}

console.log(
  `Running ${specs.length} spec(s):\n  ${specs.map((file) => path.basename(file)).join("\n  ")}`,
);

if (listOnly) process.exit(0);

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", "-c", CONFIG, "--grep-invert", "@onchain", ...specs, ...playwrightArgs],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
