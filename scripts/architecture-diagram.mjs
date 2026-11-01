// Prints a Mermaid module graph (FSD layers/slices + backend modules) to stdout.
import { execFileSync } from "node:child_process";

const mermaid = execFileSync(
  "npx",
  [
    "depcruise",
    "apps/frontend/src",
    "src",
    "--no-config",
    "--include-only",
    "^(apps/frontend/src|src)/",
    "--exclude",
    String.raw`\.test\.ts$|/tests/`,
    "--collapse",
    "^(apps/frontend/src/[^/]+/[^/]+|src/[^/]+)",
    "--output-type",
    "mermaid",
  ],
  { encoding: "utf8" },
);

process.stdout.write(mermaid);
