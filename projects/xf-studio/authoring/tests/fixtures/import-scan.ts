/**
 * Import scanning shared by the boundary tests (`architecture-import-boundary.test.ts`,
 * `studio-ui-boundary.test.ts`). Comments and strings are not stripped, so keep such text out of prose.
 */

/**
 * Every module specifier a source names: `import … from` and `export … from`, bare `import "…"`, dynamic
 * `import("…")`, inline type references `import("…").T` (CORE-43), and `require("…")` and
 * `import.meta.require("…")` (UI-74).
 */
export const IMPORT_FORMS = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?<![\w$])require\s*\(\s*["']([^"']+)["']\s*\)/g;
/** The specifiers a source names, in source order. */
export const imports = (text: string) => [...text.matchAll(IMPORT_FORMS)].map(match => match[1] ?? match[2] ?? match[3] ?? match[4]);

/** A relative specifier as a src-relative module name (`platform/api`, `studio-ui/controls`) from module `from`; bare names unchanged. */
export function resolveFrom(from: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) part === ".." ? parts.pop() : part !== "." && parts.push(part);
  return parts.join("/").replace(/\.ts$/, "");
}

/**
 * One import or re-export and the names it takes at run time: `default`, `*` (a namespace, `export *`), the
 * imported name of each `{ a as b }` entry, or a marker for forms without names (`<side effect>`, `<dynamic>`,
 * `<require>`). `typeOnly` imports take nothing at run time; so do inline type references.
 */
export type ImportUse = { specifier: string; typeOnly: boolean; names: readonly string[] };

const CLAUSE = String.raw`(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
const STATIC = new RegExp(String.raw`\b(import|export)\s+(${CLAUSE})\s*from\s+["']([^"']+)["']`, "g");
const SIDE_EFFECT = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC = /(\btypeof\s+)?\bimport\s*\(\s*["']([^"']+)["']\s*\)(\s*\.\s*[A-Z][\w$]*)?/g;
const REQUIRE = /(?<![\w$])require\s*\(\s*["']([^"']+)["']\s*\)/g;

function clauseNames(kind: string, clause: string): ImportUse {
  const typeOnly = /^type\s/.test(clause), body = clause.replace(/^type\s+/, "");
  const names: string[] = [];
  const lead = body.match(/^[\w$]+/);
  if (lead && kind === "import") names.push("default");
  if (/\*/.test(body)) names.push("*");
  const braces = body.match(/\{([^}]*)\}/);
  if (braces) for (const entry of braces[1].split(",").map(item => item.trim()))
    if (entry && !/^type\s/.test(entry)) names.push(entry.split(/\s+as\s+/)[0]);
  return { specifier: "", typeOnly, names };
}

/** Every import and re-export in a source, with what it takes at run time. */
export function importUses(text: string): ImportUse[] {
  const uses: ImportUse[] = [];
  for (const [, kind, clause, specifier] of text.matchAll(STATIC)) uses.push({ ...clauseNames(kind, clause), specifier });
  for (const [, specifier] of text.matchAll(SIDE_EFFECT)) uses.push({ specifier, typeOnly: false, names: ["<side effect>"] });
  for (const [, typeOf, specifier, member] of text.matchAll(DYNAMIC))
    uses.push({ specifier, typeOnly: !!typeOf || !!member, names: ["<dynamic>"] });
  for (const [, specifier] of text.matchAll(REQUIRE)) uses.push({ specifier, typeOnly: false, names: ["<require>"] });
  return uses;
}
