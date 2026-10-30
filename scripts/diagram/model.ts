import { asArray, asBoolean, asMap, asString, asStrings, type EdnValue } from "./edn";

export type ClassIR = {
  id: string;
  name: string;
  ops: string[];
  foreign: boolean;
  file?: string;
  stereotype?: string;
  lang?: string;
};

export type EdgeIR = { from: string; to: string; kind: string };

export type Doc = {
  title: string;
  order: string[];
  levels: string[][];
  classes: ClassIR[];
  edges: EdgeIR[];
};

export type Change = "added" | "removed" | "unchanged" | "foreign";

export type ClassView = {
  id: string;
  name: string;
  level: number;
  ops: string[];
  change: Change;
  file?: string;
  group?: string;
  stereotype?: string;
  foreign?: true;
  note?: string;
};

export type EdgeView = {
  from: string;
  to: string;
  kind: string;
  violating?: true;
  change?: "added" | "unchanged" | "removed";
};

export type Diff = {
  before: ClassView[];
  beforeEdges: EdgeView[];
  after: ClassView[];
  afterEdges: EdgeView[];
  added: number;
  removed: number;
  unchanged: number;
  edgesAdded: number;
  violations: number;
};

function readClass(value: EdnValue): ClassIR | undefined {
  const map = asMap(value);
  if (!map) return undefined;
  const id = asString(map["id"]);
  if (!id) return undefined;
  const ops = asArray(map["ops"])
    .map((op) => asString(asMap(op)?.["name"]))
    .filter((op): op is string => op !== undefined);
  const result: ClassIR = {
    id,
    name: asString(map["name"]) ?? id,
    ops,
    foreign: asBoolean(map["foreign"]) ?? false,
  };
  const file = asString(map["file"]);
  const stereotype = asString(map["stereotype"]);
  const lang = asString(map["lang"]);
  if (file) result.file = file;
  if (stereotype) result.stereotype = stereotype;
  if (lang) result.lang = lang;
  return result;
}

function readEdge(value: EdnValue): EdgeIR | undefined {
  const map = asMap(value);
  if (!map) return undefined;
  const from = asString(map["from"]);
  const to = asString(map["to"]);
  if (!from || !to) return undefined;
  return { from, to, kind: asString(map["kind"]) ?? "dependency" };
}

export function readDoc(value: EdnValue): Doc {
  const map = asMap(value);
  if (!map) throw new Error("The diagram file is not an EDN map");
  return {
    title: asString(map["title"]) ?? "UML",
    order: asStrings(map["order"]),
    levels: asArray(map["levels"]).map((group) => asStrings(group)),
    classes: asArray(map["classes"])
      .map((item) => readClass(item))
      .filter((item): item is ClassIR => item !== undefined),
    edges: asArray(map["edges"])
      .map((item) => readEdge(item))
      .filter((item): item is EdgeIR => item !== undefined),
  };
}

function listedRanks(doc: Doc): Map<string, number> {
  const result = new Map<string, number>();
  doc.levels.forEach((group, index) => {
    group.forEach((segment) => result.set(segment, index));
  });
  return result;
}

function topoRanks(classes: ClassIR[], edges: EdgeIR[]): Map<string, number> {
  const ids = new Set(classes.filter((item) => !item.foreign).map((item) => item.id));
  const outgoing = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return;
    const deps = outgoing.get(edge.from) ?? new Set<string>();
    deps.add(edge.to);
    outgoing.set(edge.from, deps);
  });
  const rank = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    const deps = outgoing.get(id);
    if (!deps || deps.size === 0) return 0;
    const next = new Set(seen).add(id);
    return 1 + Math.max(...[...deps].map((dep) => rank(dep, next)));
  };
  return new Map([...ids].map((id) => [id, rank(id, new Set())]));
}

function ranks(levelDoc: Doc, classes: ClassIR[], edges: EdgeIR[]): Map<string, number> {
  const listed = listedRanks(levelDoc);
  const topo = topoRanks(classes, edges);
  const result = new Map<string, number>();
  classes
    .filter((item) => !item.foreign)
    .forEach((item) => {
      const segment = item.id.split(".")[0] ?? item.id;
      result.set(item.id, listed.get(segment) ?? topo.get(item.id) ?? 0);
    });
  return result;
}

function classView(item: ClassIR, level: number, change: Change): ClassView {
  const view: ClassView = {
    id: item.id,
    name: item.name,
    level,
    ops: item.ops,
    change: item.foreign ? "foreign" : change,
  };
  if (item.file) view.file = item.file;
  if (item.id.includes(".")) view.group = item.id.split(".")[0] ?? item.id;
  if (item.stereotype === "interface") view.stereotype = "interface";
  if (item.foreign) view.foreign = true;
  if (!item.foreign && item.stereotype !== "interface" && item.ops.length === 0) {
    view.note = "script, no exports";
  }
  return view;
}

function violating(edge: EdgeIR, levels: Map<string, number>): boolean {
  const from = levels.get(edge.from);
  const to = levels.get(edge.to);
  return from !== undefined && to !== undefined && from < to && edge.kind !== "implements";
}

function edgeView(edge: EdgeIR, levels: Map<string, number>): EdgeView {
  const view: EdgeView = { from: edge.from, to: edge.to, kind: edge.kind };
  if (violating(edge, levels)) view.violating = true;
  return view;
}

function views(doc: Doc, levelDoc: Doc, changeOf: (id: string) => Change) {
  const levels = ranks(levelDoc, doc.classes, doc.edges);
  return {
    classes: doc.classes.map((item) =>
      classView(item, levels.get(item.id) ?? 0, changeOf(item.id)),
    ),
    edges: doc.edges.map((edge) => edgeView(edge, levels)),
  };
}

function edgeKey(edge: EdgeIR): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
}

export function buildDiff(before: Doc, after: Doc): Diff {
  const oldIds = new Set(before.classes.filter((item) => !item.foreign).map((item) => item.id));
  const newIds = new Set(after.classes.filter((item) => !item.foreign).map((item) => item.id));
  const beforeView = views(before, after, (id) => (newIds.has(id) ? "unchanged" : "removed"));
  const afterView = views(after, after, (id) => (oldIds.has(id) ? "unchanged" : "added"));
  const oldEdges = new Set(before.edges.map(edgeKey));
  const newEdges = new Set(after.edges.map(edgeKey));
  const beforeEdges = beforeView.edges.map((edge) => ({
    ...edge,
    change: newEdges.has(edgeKey({ from: edge.from, to: edge.to, kind: edge.kind }))
      ? ("unchanged" as const)
      : ("removed" as const),
  }));
  const afterEdges = afterView.edges.map((edge) => ({
    ...edge,
    change: oldEdges.has(edgeKey({ from: edge.from, to: edge.to, kind: edge.kind }))
      ? ("unchanged" as const)
      : ("added" as const),
  }));
  return {
    before: beforeView.classes,
    beforeEdges,
    after: afterView.classes,
    afterEdges,
    added: [...newIds].filter((id) => !oldIds.has(id)).length,
    removed: [...oldIds].filter((id) => !newIds.has(id)).length,
    unchanged: [...oldIds].filter((id) => newIds.has(id)).length,
    edgesAdded: afterEdges.filter((edge) => edge.change === "added").length,
    violations: afterView.edges.filter((edge) => edge.violating).length,
  };
}

export function languageOf(doc: Doc): string {
  const languages = [...new Set(doc.classes.map((item) => item.lang).filter(Boolean))];
  const [language] = languages;
  if (languages.length !== 1 || !language) return "source";
  const names: Record<string, string> = {
    typescript: "TypeScript",
    clojure: "Clojure",
    python: "Python",
    rust: "Rust",
  };
  return names[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}
