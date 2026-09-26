/**
 * Import scanning shared by the boundary tests (`architecture-import-boundary.test.ts`,
 * `studio-ui-boundary.test.ts`). Comments and strings are not stripped, so keep such text out of prose.
 */

/** The specifier recorded for an `import(…)` or `require(…)` whose argument is not one literal; the rules refuse it (CORE-87). */
export const COMPUTED = "<computed>";

/** A literal module specifier: a quoted string, or a template literal without an interpolation. */
const LITERAL = String.raw`(?:"([^"]+)"|'([^']+)'|` + "`([^`$]+)`" + ")";
/** A call argument that is not one literal and not empty: a variable, an expression, an interpolated template, a comment. */
const NOT_LITERAL = String.raw`(?!\s*(?:"[^"]*"|'[^']*'|` + "`[^`$]*`" + String.raw`)\s*\))(?!\s*\))`;
/** `import(` or `require(` as a call (not a member such as `x.import(`; `import.meta.require(` is a require). */
const CALL = { import: String.raw`(?<![\w$.])import\s*\(`, require: String.raw`(?<![\w$])require\s*\(` };

/**
 * Every module specifier a source names: `import … from` and `export … from`, bare `import "…"`, dynamic
 * `import("…")`, inline type references `import("…").T` (CORE-43), `require("…")` and
 * `import.meta.require("…")` (UI-74), each with a quoted or template-literal specifier; and every computed
 * `import(…)` or `require(…)` call, as `COMPUTED` (CORE-87).
 */
export const IMPORT_FORMS = new RegExp([
  String.raw`\bfrom\s+["']([^"']+)["']`,
  String.raw`\bimport\s+["']([^"']+)["']`,
  String.raw`${CALL.import}\s*${LITERAL}\s*\)`,
  String.raw`${CALL.require}\s*${LITERAL}\s*\)`,
  String.raw`(?:${CALL.import}|${CALL.require})${NOT_LITERAL}()`,
].join("|"), "g");
/** The specifiers a source names, in source order. */
export const imports = (text: string) => [...text.matchAll(IMPORT_FORMS)].map(match =>
  match[9] !== undefined ? COMPUTED : match.slice(1, 9).find(group => group !== undefined)!);

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
 * `<require>`, `<computed>`). `typeOnly` imports take nothing at run time; so do inline type references.
 */
export type ImportUse = { specifier: string; typeOnly: boolean; names: readonly string[] };

const CLAUSE = String.raw`(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
const STATIC = new RegExp(String.raw`\b(import|export)\s+(${CLAUSE})\s*from\s+["']([^"']+)["']`, "g");
const SIDE_EFFECT = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC = new RegExp(String.raw`(\btypeof\s+)?${CALL.import}\s*${LITERAL}\s*\)(\s*\.\s*[A-Z][\w$]*)?`, "g");
const REQUIRE = new RegExp(String.raw`${CALL.require}\s*${LITERAL}\s*\)`, "g");
const COMPUTED_CALL = new RegExp(String.raw`(?:${CALL.import}|${CALL.require})${NOT_LITERAL}`, "g");

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
  for (const [, typeOf, a, b, c, member] of text.matchAll(DYNAMIC))
    uses.push({ specifier: (a ?? b ?? c)!, typeOnly: !!typeOf || !!member, names: ["<dynamic>"] });
  for (const [, a, b, c] of text.matchAll(REQUIRE)) uses.push({ specifier: (a ?? b ?? c)!, typeOnly: false, names: ["<require>"] });
  // A computed call loads something at run time that no scan can name: a value import of `COMPUTED`.
  for (const _ of text.matchAll(COMPUTED_CALL)) uses.push({ specifier: COMPUTED, typeOnly: false, names: ["<computed>"] });
  return uses;
}
