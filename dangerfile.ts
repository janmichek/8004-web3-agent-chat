import { existsSync, readFileSync, readdirSync } from "node:fs";
import { danger, fail, markdown, message, schedule, warn } from "danger";

const MAX_PR_LINES = 800;
const MAX_VUE_LINES = 800;

// Danger loads this file as CommonJS, so top-level await is not allowed: use schedule().
schedule(async () => {
  const touched = [...danger.git.created_files, ...danger.git.modified_files];
  const isTest = (f: string) => /(\.test\.ts|\.spec\.ts|\/tests\/|\/e2e\/)/.test(f);
  const isSource = (f: string) =>
    /^(src|frontend\/src)\/.*\.(ts|vue)$/.test(f) && !isTest(f) && !f.endsWith(".d.ts");

  // ── PR hygiene ────────────────────────────────────────────────────────────
  // Lockfile churn is machine-generated noise, so it does not count towards PR size.
  const lockLines = (await danger.git.linesOfCode("package-lock.json")) ?? 0;
  const size = danger.github.pr.additions + danger.github.pr.deletions - lockLines;
  if (size > MAX_PR_LINES) {
    warn(`Large PR (${size} changed lines). Consider splitting it (limit ${MAX_PR_LINES}).`);
  }

  if (!danger.github.pr.body || danger.github.pr.body.trim().length < 20) {
    warn("Add a PR description: what changed and why.");
  }

  // ── Tests & dependencies ──────────────────────────────────────────────────
  if (touched.some(isSource) && !touched.some(isTest)) {
    warn("Source files changed but no tests were added or updated.");
  }

  if (touched.includes("package.json") && !touched.includes("package-lock.json")) {
    fail(
      "`package.json` changed without `package-lock.json`. Run `npm install` and commit the lockfile.",
    );
  }

  // ── Size / smell checks on touched files ──────────────────────────────────
  for (const file of touched.filter((f) => f.endsWith(".vue") && existsSync(f))) {
    const lines = readFileSync(file, "utf8").split("\n").length;
    if (lines > MAX_VUE_LINES) {
      warn(
        `\`${file}\` is ${lines} lines (limit ${MAX_VUE_LINES}). Extract composables or sub-components.`,
      );
    }
  }

  const SMELLS = /(:\s*any\b|\bas any\b|@ts-ignore|@ts-nocheck|oxlint-disable|eslint-disable)/;
  // The dangerfile itself spells out the patterns it looks for, so it is exempt.
  const scanned = (f: string) => /\.(ts|vue)$/.test(f) && !isTest(f) && f !== "dangerfile.ts";
  for (const file of touched.filter(scanned)) {
    const diff = await danger.git.diffForFile(file);
    const hit = diff?.added.split("\n").find((l) => l.startsWith("+") && SMELLS.test(l));
    if (hit) warn(`\`${file}\` adds a type/lint escape hatch: \`${hit.slice(1).trim()}\``);
  }

  // ── Coverage (from `npm run test:coverage`) ───────────────────────────────
  const coveragePath = "coverage/coverage-summary.json";
  if (existsSync(coveragePath)) {
    const { total } = JSON.parse(readFileSync(coveragePath, "utf8")) as {
      total: Record<"lines" | "statements" | "functions" | "branches", { pct: number }>;
    };
    const row = (k: keyof typeof total) => `${total[k].pct}%`;
    message(
      [
        "### Coverage",
        "| Lines | Statements | Functions | Branches |",
        "| --- | --- | --- | --- |",
        `| ${row("lines")} | ${row("statements")} | ${row("functions")} | ${row("branches")} |`,
      ].join("\n"),
    );
  } else {
    warn("No coverage report found (`coverage/coverage-summary.json`).");
  }

  // ── Lighthouse (from `lhci autorun`) ──────────────────────────────────────
  const lhDir = ".lighthouseci";
  if (existsSync(lhDir)) {
    const report = readdirSync(lhDir).find((f) => /^lhr-.*\.json$/.test(f));
    if (report) {
      const lhr = JSON.parse(readFileSync(`${lhDir}/${report}`, "utf8")) as {
        categories: Record<string, { title: string; score: number | null }>;
      };
      const cats = Object.values(lhr.categories);
      message(
        [
          "### Lighthouse",
          `| ${cats.map((c) => c.title).join(" | ")} |`,
          `| ${cats.map(() => "---").join(" | ")} |`,
          `| ${cats.map((c) => Math.round((c.score ?? 0) * 100)).join(" | ")} |`,
        ].join("\n"),
      );
    }
  }

  // ── Architecture diagram (from `npm run diagram`) ─────────────────────────
  if (existsSync("diagram.mmd")) {
    const mmd = readFileSync("diagram.mmd", "utf8").trim();
    markdown(
      [
        "<details><summary>Architecture (module graph)</summary>",
        "",
        "```mermaid",
        mmd,
        "```",
        "",
        "</details>",
      ].join("\n"),
    );
  }
});
