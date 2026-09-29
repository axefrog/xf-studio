/**
 * The inspector's data model (read-only): rows for every node, their edges, and a small query language. A panel
 * receives detached pages of rows; it never sees the graph, the store or an editable body.
 *
 * Query language: free words match name, type and ID (all must match, case-insensitive), plus facets that combine:
 * `type:<type>` (prefix match), `id:<id>` (prefix), `name:<word>`, `is:trashed|constant|forked|fed|unused|orphaned|conflicted|live`,
 * `sev:blocking|warning|notice`, and numeric comparisons `used`, `uses`, `depth` with `:`, `=`, `>`, `<`, `>=`, `<=`
 * (`used:0`, `uses>2`, `depth>3`). `used` counts referrers; `uses` counts references held; `depth` is the layer chain depth.
 */
import type { Conflict, Layer, NodeRef, OwnValues, Path, Severity } from "./types";

export type InspectorRow = {
  readonly ref: NodeRef; readonly name: string; readonly constant: boolean; readonly trashed: boolean;
  /** How many nodes reference it. */
  readonly used: number;
  /** How many references it holds. */
  readonly uses: number;
  readonly layer: "fork" | "fed" | "fork+fed" | null;
  readonly depth: number;
  /** The worst severity among its conflicts. */
  readonly conflict: Severity | null;
  /** It holds a reference to a node that doesn't exist. */
  readonly orphaned: boolean;
  readonly seq: number;
};
export type InspectorEdge = { readonly from: NodeRef; readonly to: NodeRef; readonly path?: Path; readonly kind: "ref" | "base" | "feed"; readonly pinned?: number };
export type InspectorPage = {
  readonly rows: readonly InspectorRow[]; readonly total: number; readonly offset: number; readonly next?: number;
  readonly query: InspectorQuery;
};
export type InspectorDetail = {
  readonly row: InspectorRow;
  readonly uses: readonly InspectorEdge[]; readonly usedBy: readonly InspectorEdge[];
  readonly basedOn: readonly InspectorEdge[]; readonly feedsFrom: readonly InspectorEdge[]; readonly fedInto: readonly InspectorEdge[];
  readonly conflicts: readonly Conflict[];
  /** Research view: the stored own values and layers, detached. */
  readonly own: OwnValues; readonly layers: readonly Layer[];
};

type Comparison = { readonly field: "used" | "uses" | "depth"; readonly op: "=" | ">" | "<" | ">=" | "<="; readonly value: number };
export type InspectorQuery = {
  readonly words: readonly string[]; readonly types: readonly string[]; readonly ids: readonly string[]; readonly names: readonly string[];
  readonly is: readonly string[]; readonly severities: readonly Severity[]; readonly comparisons: readonly Comparison[];
  /** Tokens the parser didn't understand, kept so a panel can say so. */
  readonly unknown: readonly string[];
};

const IS = new Set(["trashed", "constant", "forked", "fed", "unused", "orphaned", "conflicted", "live"]);
const SEVERITIES = new Set<Severity>(["blocking", "warning", "notice"]);

/** Parses a query string. */
export function parseQuery(text: string): InspectorQuery {
  const query = { words: [] as string[], types: [] as string[], ids: [] as string[], names: [] as string[], is: [] as string[],
    severities: [] as Severity[], comparisons: [] as Comparison[], unknown: [] as string[] };
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const numeric = token.match(/^(used|uses|depth)(:|=|>=|<=|>|<)(\d+)$/i);
    if (numeric) {
      query.comparisons.push({ field: numeric[1].toLowerCase() as Comparison["field"], op: numeric[2] === ":" ? "=" : numeric[2] as Comparison["op"], value: Number(numeric[3]) });
      continue;
    }
    const facet = token.match(/^(type|id|name|is|sev):(.+)$/i);
    if (!facet) { if (/^[a-z]+[:<>=]/i.test(token)) query.unknown.push(token); else query.words.push(token.toLowerCase()); continue; }
    const [, key, value] = facet, lower = value.toLowerCase();
    switch (key.toLowerCase()) {
      case "type": query.types.push(lower); break;
      case "id": query.ids.push(lower); break;
      case "name": query.names.push(lower); break;
      case "is": IS.has(lower) ? query.is.push(lower) : query.unknown.push(token); break;
      case "sev": SEVERITIES.has(lower as Severity) ? query.severities.push(lower as Severity) : query.unknown.push(token); break;
    }
  }
  return query;
}

const compare = (actual: number, { op, value }: Comparison) =>
  op === "=" ? actual === value : op === ">" ? actual > value : op === "<" ? actual < value : op === ">=" ? actual >= value : actual <= value;

/** Whether a row matches a parsed query. */
export function matches(row: InspectorRow, query: InspectorQuery): boolean {
  const name = row.name.toLowerCase(), type = row.ref.type.toLowerCase(), id = row.ref.id.toLowerCase();
  if (!query.words.every(word => name.includes(word) || type.includes(word) || id.includes(word))) return false;
  if (query.types.length && !query.types.some(prefix => type.startsWith(prefix))) return false;
  if (query.ids.length && !query.ids.some(prefix => id.startsWith(prefix))) return false;
  if (!query.names.every(word => name.includes(word))) return false;
  for (const flag of query.is) {
    const ok = flag === "trashed" ? row.trashed : flag === "constant" ? row.constant : flag === "live" ? !row.trashed
      : flag === "forked" ? row.layer === "fork" || row.layer === "fork+fed" : flag === "fed" ? row.layer === "fed" || row.layer === "fork+fed"
        : flag === "unused" ? row.used === 0 : flag === "orphaned" ? row.orphaned : row.conflict !== null;
    if (!ok) return false;
  }
  if (query.severities.length && !(row.conflict && query.severities.includes(row.conflict))) return false;
  return query.comparisons.every(comparison => compare(row[comparison.field], comparison));
}

export const INSPECTOR_PAGE = 200;

/** A page of matching rows, in the order given, `limit` at a time (200 by default). */
export function page(rows: readonly InspectorRow[], text: string, offset = 0, limit = INSPECTOR_PAGE): InspectorPage {
  const query = parseQuery(text);
  const found = rows.filter(row => matches(row, query));
  const slice = found.slice(offset, offset + limit);
  return { rows: slice, total: found.length, offset, ...(offset + limit < found.length ? { next: offset + limit } : {}), query };
}
