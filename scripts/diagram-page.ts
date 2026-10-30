import { readFile, writeFile } from "node:fs/promises";

import { parseEdn } from "./diagram/edn";
import { renderPage } from "./diagram/html";
import { buildDiff, languageOf, readDoc, type Doc } from "./diagram/model";

function shortSha(value: string | undefined): string {
  const sha = value ?? "";
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

async function readDiagram(path: string): Promise<Doc> {
  return readDoc(parseEdn(await readFile(path, "utf8")));
}

async function main(): Promise<void> {
  const [afterPath, beforePath, outPath, afterRef, afterSha, beforeRef, beforeSha] =
    process.argv.slice(2);
  if (!afterPath || !beforePath || !outPath) {
    console.error(
      "Usage: bun scripts/diagram-page.ts <after.edn> <before.edn|-> <out.html> [after-ref] [after-sha] [before-ref] [before-sha]",
    );
    process.exitCode = 1;
    return;
  }

  const after = await readDiagram(afterPath);
  const before =
    beforePath === "-"
      ? { title: "", order: [], levels: [], classes: [], edges: [] }
      : await readDiagram(beforePath);

  const html = renderPage({
    title: after.title || before.title || "Architecture",
    afterRef: afterRef ?? "head",
    afterSha: shortSha(afterSha),
    beforeRef: beforeRef ?? "base",
    beforeSha: shortSha(beforeSha),
    order: after.order.length > 0 ? after.order : before.order,
    lang: languageOf(after),
    diff: buildDiff(before, after),
  });

  await writeFile(outPath, html);
  console.log(`Wrote ${outPath}`);
}

await main();
