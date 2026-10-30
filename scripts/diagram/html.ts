import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Diff } from "./model";

export type PageData = {
  title: string;
  afterRef: string;
  afterSha: string;
  beforeRef: string;
  beforeSha: string;
  order: string[];
  lang: string;
  diff: Diff;
};

function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

function asset(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

function refFlow(data: PageData): string {
  return `<div class="ref-flow" aria-label="Comparison range">
    <span class="ref"><span class="ref-label">base</span><code>${esc(data.beforeRef)}</code><span class="ref-label">${esc(data.beforeSha)}</span></span>
    <svg class="ref-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    <span class="ref"><span class="ref-label">head</span><code>${esc(data.afterRef)}</code><span class="ref-label">${esc(data.afterSha)}</span></span>
  </div>`;
}

function topbar(data: PageData): string {
  return `<header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="#">
        <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7h4M5 17h4M15 7h4M15 17h4M9 7l6 10M15 7L9 17"/><circle cx="5" cy="7" r="1.6"/><circle cx="5" cy="17" r="1.6"/><circle cx="19" cy="7" r="1.6"/><circle cx="19" cy="17" r="1.6"/></svg></span>
        <span>Architecture review</span>
      </a>
      ${refFlow(data)}
      <div class="top-actions">
        <button class="icon-button" id="theme-toggle" type="button" aria-label="Toggle theme"></button>
      </div>
    </div>
  </header>`;
}

function stat(label: string, value: number, tone: string): string {
  return `<li class="stat ${tone}"><span class="stat-label">${label}</span><b data-count="${value}">0</b></li>`;
}

function hero(data: PageData): string {
  return `<section class="hero">
    <div>
      <p class="eyebrow"><span class="pulse"></span> Pull request · diagram diff</p>
      <h1>${esc(data.title)}</h1>
      <p class="lede">Architecture snapshot from <code>${esc(data.beforeRef)}</code> to <code>${esc(
        data.afterRef,
      )}</code>, read by the ${esc(data.lang)} scanner. Boxes are modules, arrows are imports, level 0 is the inner ring. Click a module to isolate its dependencies.</p>
    </div>
    <ul class="stats" aria-label="Change summary">
      ${stat("Added", data.diff.added, "good")}
      ${stat("Removed", data.diff.removed, "bad")}
      ${stat("Unchanged", data.diff.unchanged, "")}
      ${stat("New edges", data.diff.edgesAdded, "good")}
      ${stat("Violations", data.diff.violations, "bad")}
    </ul>
  </section>`;
}

function toolbar(): string {
  return `<section class="toolbar" aria-label="Diagram controls">
    <div class="toolbar-group">
      <div class="segmented" role="group" aria-label="View">
        <button type="button" data-view-button="split" aria-pressed="true">Split</button>
        <button type="button" data-view-button="before" aria-pressed="false">Before</button>
        <button type="button" data-view-button="after" aria-pressed="false">After</button>
      </div>
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input id="search" type="search" placeholder="Filter modules, files, exports…" autocomplete="off" aria-label="Filter modules" />
        <kbd>/</kbd>
        <span class="search-count" id="search-count"></span>
      </label>
      <button class="button ghost" id="clear-filters" type="button">Reset</button>
    </div>
    <div class="toolbar-group">
      <span class="toolbar-label">Edges</span>
      <div class="segmented" role="group" aria-label="Edge filter">
        <button type="button" data-edge-filter="changed" aria-pressed="true">Changed</button>
        <button type="button" data-edge-filter="all" aria-pressed="false">All</button>
      </div>
      <div class="legend" aria-hidden="true">
        <span><i style="--dot: var(--added)"></i>added</span>
        <span><i style="--dot: var(--removed)"></i>removed</span>
        <span><i style="--dot: var(--impl)"></i>implements</span>
        <span><i style="--dot: var(--violation)"></i>outward</span>
      </div>
      <button class="button ghost" id="edges-toggle" type="button" aria-expanded="false" aria-controls="connections">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
        Connections <span class="tag same" id="edge-count"></span>
      </button>
    </div>
  </section>`;
}

function pane(kind: "before" | "after", ref: string, sha: string): string {
  const title = kind === "before" ? "Base branch" : "Head branch";
  return `<article class="pane pane-${kind}">
    <header class="pane-head">
      <div><span class="pane-kicker">${title}</span><h2>${esc(ref)}</h2></div>
      <div class="pane-meta"><code>${esc(sha)}</code><span class="pane-count">${kind === "before" ? "previous" : "current"}</span></div>
    </header>
    <div class="stage" data-stage="${kind}" id="stage-${kind}">
      <div class="canvas">
        <svg class="wires" aria-hidden="true"></svg>
        <div class="board">
          <div class="bands"></div>
          <aside class="rail"><p class="rail-label">External</p><div class="rail-items"></div></aside>
        </div>
      </div>
    </div>
  </article>`;
}

function connections(): string {
  return `<section class="connections" id="connections" data-open="false">
    <div class="connections-inner">
      <header class="connections-head">
        <div><h2>Dependency log</h2><p>Every import on the head branch. Select a module above to filter this list.</p></div>
        <span class="tag same"><span id="edge-total">0</span> edges</span>
      </header>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Change</th><th>From</th><th>To</th><th>Kind</th></tr></thead>
          <tbody id="edges-body"></tbody>
        </table>
      </div>
    </div>
  </section>`;
}

function inspector(): string {
  return `<aside class="inspector" id="inspector" data-open="false" aria-label="Module details">
    <header class="inspector-head">
      <div><span class="inspector-kicker">Module</span><h2 id="ins-name"></h2></div>
      <button class="icon-button" id="ins-close" type="button" aria-label="Close details">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </header>
    <p class="inspector-file" id="ins-file"></p>
    <div class="inspector-tags" id="ins-tags"></div>
    <div class="inspector-section"><h3>Exports</h3><div class="inspector-ops" id="ins-ops"></div></div>
    <div class="inspector-section"><h3>Connections</h3><div class="links" id="ins-links"></div></div>
    <div class="inspector-actions"><button class="button" id="ins-copy" type="button">Copy link</button></div>
  </aside>`;
}

export function renderPage(data: PageData): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} · architecture review</title>
<meta name="color-scheme" content="dark light">
<style>${asset("page.css")}</style>
</head>
<body>
${topbar(data)}
<main class="shell">
  ${hero(data)}
  ${toolbar()}
  <section class="diagram" id="diagram" data-view="split" aria-label="Before and after architecture">
    ${pane("before", data.beforeRef, data.beforeSha)}
    ${pane("after", data.afterRef, data.afterSha)}
  </section>
  ${connections()}
</main>
${inspector()}
<div class="toast" id="toast" role="status"></div>
<script id="diagram-data" type="application/json">${json}</script>
<script>${asset("page.js")}</script>
</body>
</html>
`;
}
