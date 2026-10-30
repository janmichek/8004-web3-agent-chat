(() => {
  const DATA = JSON.parse(document.getElementById("diagram-data").textContent);
  const afterClasses = DATA.diff.after;
  const beforeClasses = DATA.diff.before;
  const afterEdges = DATA.diff.afterEdges;
  const beforeEdges = DATA.diff.beforeEdges;
  const allEdges = [...beforeEdges, ...afterEdges];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const state = { view: "split", query: "", pinned: null, hovered: null, edgeFilter: "changed" };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function labelOf(name) {
    return String(name)
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  function seg(id) {
    return String(id).split(".")[0];
  }

  function byOrder(a, b) {
    const order = DATA.order;
    const ia = order.indexOf(seg(a.id));
    const ib = order.indexOf(seg(b.id));
    const left = (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    return left || a.name.localeCompare(b.name);
  }

  function nodeCard(item, index) {
    const classes = ["node", item.change, item.stereotype === "interface" ? "iface" : ""]
      .filter(Boolean)
      .join(" ");
    const change = item.change === "foreign" ? "external" : item.change;
    const card = el("article", classes);
    card.style.setProperty("--i", String(index));
    card.dataset.id = item.id;
    card.dataset.level = String(item.level);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${item.name}, ${change}`);

    const top = el("div", "node-top");
    top.append(el("span", "level-chip", `L${item.level}`));
    const changeChip = el("span", "change-chip");
    changeChip.append(el("i"), document.createTextNode(change));
    top.append(changeChip);
    card.append(top);

    const name = el("h3", "node-name", item.name);
    if (item.stereotype === "interface") {
      const mark = el("span", "iface-mark", "I");
      mark.title = "Interface";
      name.append(mark);
    }
    card.append(name);

    if (item.file) {
      const file = el("p", "node-file", item.file);
      file.title = item.file;
      card.append(file);
    }

    const shown = item.ops.slice(0, 4);
    const extra = item.ops.length - shown.length;
    if (shown.length) {
      const ops = el("ul", "node-ops");
      shown.forEach((op) => ops.append(el("li", "", op)));
      if (extra > 0) ops.append(el("li", "", `+${extra}`));
      card.append(ops);
    } else if (item.note) {
      card.append(el("p", "node-note", item.note));
    }

    return card;
  }

  function bandLabel(level, top, bottom) {
    const suffix = level === 0 ? "inner" : level === top && top !== bottom ? "outer" : "";
    const label = el("div", "band-label");
    label.append(el("b", "", `L${level}`));
    if (suffix) label.append(suffix);
    return label;
  }

  function mount(stage, classes) {
    const project = classes
      .filter((item) => !item.foreign)
      .slice()
      .sort(byOrder);
    const external = classes
      .filter((item) => item.foreign)
      .slice()
      .sort(byOrder);
    const bands = $(".bands", stage);
    bands.replaceChildren();
    if (!project.length) {
      bands.append(el("div", "empty", "No modules on this side of the diff."));
    } else {
      const levels = [...new Set(project.map((item) => item.level))].sort((a, b) => b - a);
      levels.forEach((level) => {
        const here = project.filter((item) => item.level === level);
        const groups = new Map();
        here.forEach((item) => {
          if (!item.group) return;
          const list = groups.get(item.group) ?? [];
          list.push(item);
          groups.set(item.group, list);
        });
        const packed = new Set();
        groups.forEach((list) => {
          if (list.length > 1) list.forEach((item) => packed.add(item.id));
        });
        const loose = here.filter((item) => !packed.has(item.id));
        const row = el("div", "row");
        loose.forEach((item, index) => row.append(nodeCard(item, index)));
        groups.forEach((list, group) => {
          if (list.length <= 1) return;
          const pkg = el("div", "pkg");
          pkg.append(el("span", "", labelOf(group)));
          const stack = el("div", "stack");
          list.forEach((item, index) => stack.append(nodeCard(item, index)));
          pkg.append(stack);
          row.append(pkg);
        });
        const band = el("div", "band");
        band.dataset.level = String(level);
        band.append(bandLabel(level, levels[0], levels[levels.length - 1]), row);
        bands.append(band);
      });
    }
    const rail = $(".rail-items", stage);
    rail.replaceChildren();
    external.forEach((item) => {
      const chip = el("span", "chip", item.name);
      chip.dataset.id = item.id;
      chip.title = item.name;
      rail.append(chip);
    });
    return project.length;
  }

  function rel(stage, element) {
    const stageRect = stage.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top - stageRect.top,
      bottom: rect.bottom - stageRect.top,
      left: rect.left - stageRect.left,
      right: rect.right - stageRect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  function sidePoint(stage, element, side) {
    const rect = rel(stage, element);
    if (side === "top") return { x: rect.left + rect.width / 2, y: rect.top };
    if (side === "bottom") return { x: rect.left + rect.width / 2, y: rect.bottom };
    if (side === "left") return { x: rect.left, y: rect.top + rect.height / 2 };
    return { x: rect.right, y: rect.top + rect.height / 2 };
  }

  function towards(from, to, distance) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
  }

  function orthPath(points, radius = 9) {
    const [first, ...rest] = points;
    let d = `M ${first.x} ${first.y}`;
    rest.forEach((point, index) => {
      const previous = points[index];
      const next = points[index + 2];
      if (!next) {
        d += ` L ${point.x} ${point.y}`;
        return;
      }
      const inLength = Math.hypot(point.x - previous.x, point.y - previous.y);
      const outLength = Math.hypot(next.x - point.x, next.y - point.y);
      const r = Math.min(radius, inLength / 2, outLength / 2);
      const before = towards(point, previous, r);
      const after = towards(point, next, r);
      d += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
    });
    return d;
  }

  function markerFor(edge) {
    if (edge.violating) return "bad";
    if (edge.kind === "implements") return "impl";
    if (edge.change === "unchanged") return "same";
    if (edge.change === "removed") return "removed";
    return "added";
  }

  function wireClass(edge) {
    if (edge.violating) return "bad";
    if (edge.kind === "implements") return "impl";
    if (edge.change === "unchanged") return "same";
    if (edge.change === "removed") return "removed";
    return "";
  }

  function markerDefs(prefix) {
    const colors = {
      added: ["#34d399", "line"],
      same: ["#94a3b8", "line"],
      impl: ["#a78bfa", "triangle"],
      bad: ["#f43f5e", "line"],
      removed: ["#fb7185", "line"],
    };
    return `<defs>${Object.entries(colors)
      .map(([name, [color, shape]]) => {
        const path =
          shape === "triangle"
            ? `<path d="M1,1 L11,5 L1,9 Z" fill="var(--panel-solid)" stroke="${color}" stroke-width="1.4"/>`
            : `<path d="M1,1 L11,5 L1,9" fill="none" stroke="${color}" stroke-width="1.5"/>`;
        return `<marker id="${prefix}-${name}" viewBox="0 0 12 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto">${path}</marker>`;
      })
      .join("")}</defs>`;
  }

  function routesFor(stage, edge, index) {
    const nodes = new Map($$("[data-id]", stage).map((element) => [element.dataset.id, element]));
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (!source || !target) return undefined;
    const rows = $$(".row", stage);
    const levelOf = (element) => Number(element.dataset.level);
    const fromLevel = levelOf(source);
    const toLevel = levelOf(target);
    const start = sidePoint(stage, source, "bottom");
    const foreign = target.classList.contains("chip");
    const sameLevel = fromLevel === toLevel;
    const laneOf = (row) => rel(stage, row);
    const offset = (index % 7) * 4;
    const rail = $(".rail", stage);

    if (foreign) {
      const row = laneOf(rows.find((item) => Number(item.dataset.level) === fromLevel) ?? rows[0]);
      const railRect = rel(stage, rail);
      const below = railRect.top > row.bottom;
      const lane = below ? start.y + 14 + offset : row.bottom + 18 + offset;
      const gutter = below
        ? stage.clientWidth - 14
        : Math.min(Math.max(...rows.map((item) => rel(stage, item).right)) + 18, railRect.left - 8);
      const end = sidePoint(stage, target, "left");
      return [
        start,
        { x: start.x, y: lane },
        { x: gutter, y: lane },
        { x: gutter, y: end.y },
        { x: end.x - 2, y: end.y },
      ];
    }

    const end = sidePoint(stage, target, sameLevel ? "bottom" : "top");
    const targetRow = rows.find((item) => Number(item.dataset.level) === toLevel);
    const sourceRow = rows.find((item) => Number(item.dataset.level) === fromLevel);
    if (!targetRow || !sourceRow) return [start, end];
    const above = rel(stage, sourceRow);
    const below = rel(stage, targetRow);

    if (sameLevel) {
      const lane = above.bottom + 14 + offset;
      return [start, { x: start.x, y: lane }, { x: end.x, y: lane }, { x: end.x, y: end.y + 2 }];
    }

    if (fromLevel - toLevel === 1) {
      const lane = Math.min(above.bottom + 16 + offset, below.top - 9);
      return [start, { x: start.x, y: lane }, { x: end.x, y: lane }, { x: end.x, y: end.y - 2 }];
    }

    const gutter = 10 + (index % 7) * 5;
    return [
      start,
      { x: start.x, y: above.bottom + 9 },
      { x: gutter, y: above.bottom + 9 },
      { x: gutter, y: below.top - 7 },
      { x: end.x, y: below.top - 7 },
      { x: end.x, y: end.y - 2 },
    ];
  }

  function visibleEdges(edges) {
    if (state.edgeFilter === "all") return edges;
    const changed = edges.filter(
      (edge) => edge.change === "added" || edge.change === "removed" || edge.violating,
    );
    if (!state.pinned) return changed;
    return edges.filter(
      (edge) => changed.includes(edge) || edge.from === state.pinned || edge.to === state.pinned,
    );
  }

  function drawStage(stage, edges) {
    const canvas = $(".canvas", stage);
    const svg = $("svg.wires", stage);
    if (!canvas || !svg || !$(".row", stage)) return;
    const prefix = stage.dataset.stage ?? "stage";
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = markerDefs(prefix);
    visibleEdges(edges).forEach((edge, index) => {
      const points = routesFor(canvas, edge, index);
      if (!points) return;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", orthPath(points));
      path.setAttribute("class", `wire ${wireClass(edge)}`);
      path.setAttribute("marker-end", `url(#${prefix}-${markerFor(edge)})`);
      path.style.setProperty("--i", String(index));
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      svg.appendChild(path);
    });
  }

  function drawAll() {
    const before = $("#stage-before");
    const after = $("#stage-after");
    if (before) drawStage(before, beforeEdges);
    if (after) drawStage(after, afterEdges);
    applyFocus();
  }

  function neighborSet(id) {
    const set = new Set([id]);
    allEdges.forEach((edge) => {
      if (edge.from === id) set.add(edge.to);
      if (edge.to === id) set.add(edge.from);
    });
    return set;
  }

  function matches(item) {
    const query = state.query.trim().toLowerCase();
    if (!query) return true;
    return [item.id, item.name, item.file, ...(item.ops ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function applyFocus() {
    const focus = state.hovered ?? state.pinned;
    const related = focus ? neighborSet(focus) : undefined;
    $$(".node, .chip").forEach((element) => {
      const id = element.dataset.id;
      const isRelated = related ? related.has(id) : true;
      element.classList.toggle("is-pinned", id === state.pinned);
      element.classList.toggle("is-related", Boolean(focus) && isRelated && id !== focus);
      element.classList.toggle("is-dim", Boolean(focus) && !isRelated);
    });
    $$("path.wire").forEach((path) => {
      const connected = !focus || path.dataset.from === focus || path.dataset.to === focus;
      path.classList.toggle("is-hot", Boolean(focus) && connected);
      path.classList.toggle("is-dim", Boolean(focus) && !connected);
    });
    $$("#edges-body tr").forEach((row) => {
      const connected = !focus || row.dataset.from === focus || row.dataset.to === focus;
      row.classList.toggle("is-off", Boolean(focus) && !connected);
    });
  }

  function applySearch() {
    const query = state.query.trim();
    const nodes = $$(".node");
    let count = 0;
    nodes.forEach((element) => {
      const item = afterClasses
        .concat(beforeClasses)
        .find((entry) => entry.id === element.dataset.id);
      const ok = !query || (item ? matches(item) : true);
      element.classList.toggle("is-filtered", !ok);
    });
    $$(".chip").forEach((element) => {
      const ok = !query || element.textContent.toLowerCase().includes(query.toLowerCase());
      element.classList.toggle("is-filtered", !ok);
    });
    const seen = new Set();
    afterClasses.forEach((item) => {
      if (matches(item) && !seen.has(item.id)) {
        seen.add(item.id);
        count += 1;
      }
    });
    $("#search-count").textContent = query ? `${count}` : "";
    $("#search-count").classList.toggle("is-visible", Boolean(query));
    $$("#edges-body tr").forEach((row) => {
      const haystack = `${row.dataset.from} ${row.dataset.to}`.toLowerCase();
      row.classList.toggle(
        "is-search-off",
        Boolean(query) && !haystack.includes(query.toLowerCase()),
      );
    });
  }

  function edgeKindCell(edge) {
    if (edge.violating) return el("span", "tag bad", "outward");
    if (edge.kind === "implements") return el("span", "tag impl", "implements");
    return el("span", "tag same", "dependency");
  }

  function fillTable() {
    const body = $("#edges-body");
    $("#edge-total").textContent = String(afterEdges.length);
    $("#edge-count").textContent = String(afterEdges.length);
    body.replaceChildren();
    afterEdges.forEach((edge) => {
      const row = document.createElement("tr");
      row.dataset.from = edge.from;
      row.dataset.to = edge.to;
      const change = el("td", "tr-change");
      change.append(
        edge.change === "added" ? el("span", "tag added", "added") : el("span", "tag same", "same"),
      );
      const kind = el("td");
      kind.append(edgeKindCell(edge));
      row.append(change, el("td", "mono", edge.from), el("td", "mono", edge.to), kind);
      body.append(row);
    });
  }

  function inspectorLinks(id) {
    const rows = [];
    allEdges.forEach((edge) => {
      if (edge.from === id) rows.push(["out", edge.to]);
      if (edge.to === id) rows.push(["in", edge.from]);
    });
    const seen = new Set();
    const links = document.createDocumentFragment();
    rows
      .filter(([, name]) => {
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .slice(0, 12)
      .forEach(([direction, name]) => {
        const row = el("div", "link-row");
        const code = el("code", "", name);
        code.title = name;
        row.append(el("span", "", direction), code);
        links.append(row);
      });
    return links;
  }

  function openInspector(id) {
    const item =
      afterClasses.find((entry) => entry.id === id) ??
      beforeClasses.find((entry) => entry.id === id);
    if (!item) return;
    const inspector = $("#inspector");
    $("#ins-name").textContent = item.name;
    $("#ins-file").textContent = item.file ?? item.id;
    const change = item.change === "foreign" ? "external" : item.change;
    const tags = $("#ins-tags");
    tags.replaceChildren(
      el("span", `tag ${item.change}`, change),
      el("span", "tag same", `L${item.level}`),
      el("span", "tag same", item.id),
    );
    const ops = $("#ins-ops");
    ops.replaceChildren();
    if (item.ops.length) item.ops.forEach((op) => ops.append(el("span", "", op)));
    else ops.append(el("span", "", item.note ?? "No exports"));
    $("#ins-links").replaceChildren(inspectorLinks(id));
    inspector.dataset.open = "true";
  }

  function closeInspector() {
    $("#inspector").dataset.open = "false";
  }

  function setPinned(id) {
    state.pinned = id;
    if (id) openInspector(id);
    else closeInspector();
    const next = id ? `#${encodeURIComponent(id)}` : location.pathname + location.search;
    history.replaceState(null, "", next);
    drawAll();
    applyFocus();
  }

  function togglePinned(id) {
    setPinned(state.pinned === id ? null : id);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.dataset.open = "true";
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.dataset.open = "false";
    }, 1600);
  }

  function animateCounts() {
    $$("[data-count]").forEach((element) => {
      const target = Number(element.dataset.count ?? 0);
      if (reducedMotion || target === 0) {
        element.textContent = String(target);
        return;
      }
      const started = performance.now();
      const duration = 620;
      const tick = (now) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = String(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("diagram-theme", theme);
    $("#theme-toggle").innerHTML =
      theme === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/></svg>';
    $("#theme-toggle").setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
  }

  function setView(view) {
    state.view = view;
    $("#diagram").dataset.view = view;
    $$("[data-view-button]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.viewButton === view));
    });
    requestAnimationFrame(() => requestAnimationFrame(drawAll));
  }

  function initEvents() {
    const diagram = $("#diagram");
    diagram.addEventListener("click", (event) => {
      const target = event.target.closest(".node, .chip");
      if (target) {
        togglePinned(target.dataset.id);
        return;
      }
      if (event.target.closest(".stage")) setPinned(null);
    });
    diagram.addEventListener("mouseover", (event) => {
      const target = event.target.closest(".node, .chip");
      if (!target || target.dataset.id === state.hovered) return;
      state.hovered = target.dataset.id;
      applyFocus();
    });
    diagram.addEventListener("mouseout", (event) => {
      const target = event.target.closest(".node, .chip");
      if (!target) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      state.hovered = null;
      applyFocus();
    });
    diagram.addEventListener("keydown", (event) => {
      const target = event.target.closest(".node");
      if (!target) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        togglePinned(target.dataset.id);
      }
    });
    $("#search").addEventListener("input", (event) => {
      state.query = event.target.value;
      applySearch();
    });
    $("#clear-filters").addEventListener("click", () => {
      state.query = "";
      $("#search").value = "";
      setPinned(null);
      applySearch();
    });
    $$("[data-view-button]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.viewButton));
    });
    $$("[data-edge-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.edgeFilter = button.dataset.edgeFilter;
        $$("[data-edge-filter]").forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button)),
        );
        drawAll();
      });
    });
    $("#edges-toggle").addEventListener("click", () => {
      const panel = $("#connections");
      const open = panel.dataset.open !== "true";
      panel.dataset.open = String(open);
      $("#edges-toggle").setAttribute("aria-expanded", String(open));
      if (open)
        panel.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    });
    $("#ins-close").addEventListener("click", () => setPinned(null));
    $("#ins-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        showToast("Link copied");
      } catch {
        showToast("Copy failed");
      }
    });
    $("#theme-toggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      setTheme(next);
    });
    document.addEventListener("keydown", (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement?.tagName ?? "",
      );
      if (event.key === "/" && !typing) {
        event.preventDefault();
        $("#search").focus();
      }
      if (event.key === "Escape") {
        if (typing && $("#search").value) {
          $("#search").value = "";
          state.query = "";
          applySearch();
        } else {
          setPinned(null);
        }
      }
    });
    window.addEventListener("resize", () => {
      clearTimeout(initEvents.resizeTimer);
      initEvents.resizeTimer = setTimeout(drawAll, 120);
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => drawAll()).observe(diagram);
    }
  }

  function boot() {
    const savedTheme = localStorage.getItem("diagram-theme");
    setTheme(savedTheme === "light" ? "light" : "dark");
    animateCounts();
    mount($("#stage-before"), beforeClasses);
    mount($("#stage-after"), afterClasses);
    fillTable();
    initEvents();
    applySearch();
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && afterClasses.concat(beforeClasses).some((item) => item.id === hash)) {
      state.pinned = hash;
      openInspector(hash);
    }
    requestAnimationFrame(() => {
      drawAll();
      applyFocus();
    });
    if (document.fonts?.ready) document.fonts.ready.then(drawAll);
  }

  boot();
})();
