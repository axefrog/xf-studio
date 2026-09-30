/**
 * Source instrumentation for the engine's own quality tools: branch coverage probes and single mutants. A file is
 * transpiled from TypeScript to JavaScript with Bun's transpiler, parsed with acorn, and rewritten by text splicing.
 * Probes and mutants are located back in the TypeScript source by matching their code text, so reports name real
 * lines. Test tooling only: nothing here is part of the engine or its public API.
 *
 * acorn is not a dependency of the package: set STRATA_ACORN to acorn's `dist/acorn.mjs` (npm `acorn`, MIT).
 */
import { relative, resolve } from "node:path";

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Acorn = { parse(text: string, options: Record<string, unknown>): Node };

let acorn: Acorn | undefined;
export async function loadParser(): Promise<Acorn> {
  if (acorn) return acorn;
  const path = process.env.STRATA_ACORN;
  if (!path) throw new Error("Set STRATA_ACORN to acorn's dist/acorn.mjs (the npm package acorn, MIT) to run coverage or mutation testing.");
  acorn = (await import(resolve(path))) as Acorn;
  return acorn;
}

export const ROOT = resolve(import.meta.dir, "..");
/** The engine files the tools look at: the source without the test harness, plus the simulated store (a store adapter). */
export const isEngineFile = (path: string) => /[\\/]src[\\/]/.test(path) && path.endsWith(".ts") && resolve(path).startsWith(resolve(ROOT, "src")) &&
  (!/[\\/]src[\\/]testing[\\/]/.test(path) || /[\\/]sim-store\.ts$/.test(path));
export const relativeName = (path: string) => relative(ROOT, path).replaceAll("\\", "/");

const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false, inline: false, trimUnusedImports: false } as never);
export const toJs = (ts: string) => transpiler.transformSync(ts);

function* children(node: Node): Iterable<Node> {
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item === "object" && typeof item.type === "string") yield item; }
    else if (value && typeof value === "object" && typeof (value as Node).type === "string") yield value as Node;
  }
}

/**
 * Walks the tree depth first in source order, with each node's parent, the name of the function it is in and the
 * node that names it (the function, method, property, variable or class; the program at the top level).
 */
function walk(root: Node, visit: (node: Node, parent: Node | undefined, fn: string, owner: Node) => void): void {
  const go = (node: Node, parent: Node | undefined, fn: string, owner: Node) => {
    let name = fn, named = owner;
    if (node.type === "FunctionDeclaration" && node.id) { name = (node.id as { name: string }).name; named = node; }
    else if (node.type === "MethodDefinition" || node.type === "PropertyDefinition" || node.type === "Property") {
      const key = node.key as { name?: string; value?: unknown };
      name = `${fn ? `${fn}.` : ""}${key.name ?? String(key.value ?? "?")}`;
      named = node;
    } else if (node.type === "VariableDeclarator" && (node.id as Node).type === "Identifier") { name = (node.id as unknown as { name: string }).name; named = node; }
    else if (node.type === "ClassDeclaration" && node.id) { name = (node.id as { name: string }).name; named = node; }
    visit(node, parent, name, named);
    for (const child of children(node)) go(child, node, name, named);
  };
  go(root, undefined, "", root);
}

/**
 * Maps JavaScript code snippets back to TypeScript lines: the snippet's words must appear in order within a short
 * window of the source's words (type annotations and assertions only add words), searching forward from the last hit.
 */
const WORDS = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
class LineFinder {
  private words: string[] = [];
  private lines: number[] = [];
  private cursor = 0;
  constructor(ts: string) {
    ts.split("\n").forEach((text, index) => {
      const code = text.replace(/\/\/.*$/, "");
      for (const match of code.matchAll(WORDS)) { this.words.push(match[0].replaceAll("'", "\"")); this.lines.push(index + 1); }
    });
  }
  find(snippet: string): number {
    const normal = snippet.replace(/!0\b/g, " true ").replace(/!1\b/g, " false ").replace(/void 0\b/g, " undefined ");
    const wanted = [...normal.matchAll(WORDS)].map(match => match[0].replaceAll("'", "\"")).slice(0, 10);
    if (!wanted.length) return this.lines[this.cursor] ?? 1;
    const matchAt = (from: number): boolean => {
      let j = 0;
      for (let i = from; i < this.words.length && i < from + wanted.length * 3 + 4 && j < wanted.length; i++) if (this.words[i] === wanted[j]) j++;
      return j === wanted.length;
    };
    for (const [from, to] of [[this.cursor, this.words.length], [0, this.cursor]]) {
      for (let i = from; i < to; i++) if (this.words[i] === wanted[0] && matchAt(i)) { this.cursor = i; return this.lines[i]; }
    }
    return this.lines[this.cursor] ?? 1;
  }
}

const snippetOf = (js: string, node: Node) => js.slice(node.start, node.end).replace(/\s+/g, " ").slice(0, 90);

// ---------------------------------------------------------------------------------------------------------------
// Branch coverage
// ---------------------------------------------------------------------------------------------------------------

export type Probe = { readonly id: number; readonly kind: string; readonly line: number; readonly fn: string; readonly code: string; readonly outcomes: readonly string[] };
type Splice = { start: number; end: number; before: string; after: string };

/** Probes for every branch: if and ternary tests, both outcomes; &&, || and ?? right sides, taken or not; switch cases; defaults. */
export async function coverageProbes(ts: string): Promise<{ js: string; probes: Probe[]; instrumented: (global: string) => string }> {
  const parser = await loadParser();
  const js = toJs(ts);
  const tree = parser.parse(js, { ecmaVersion: "latest", sourceType: "module" });
  const finder = new LineFinder(ts);
  const probes: Probe[] = [];
  const splices: Splice[] = [];
  const add = (kind: string, node: Node, fn: string, outcomes: string[], code = snippetOf(js, node)) => {
    const id = probes.length;
    probes.push({ id, kind, line: finder.find(code), fn, code, outcomes });
    return id;
  };
  walk(tree, (node, _parent, fn) => {
    switch (node.type) {
      case "IfStatement": case "ConditionalExpression": {
        const test = node.test as Node;
        const id = add(node.type === "IfStatement" ? "if" : "ternary", test, fn, ["true", "false"]);
        splices.push({ start: test.start, end: test.end, before: `__sc$t(${id},`, after: ")" });
        break;
      }
      case "LogicalExpression": {
        const left = node.left as Node, op = node.operator as string;
        const id = add(op, node, fn, ["right evaluated", "short-circuited"]);
        splices.push({ start: left.start, end: left.end, before: `__sc$${op === "&&" ? "and" : op === "||" ? "or" : "nul"}(${id},`, after: ")" });
        break;
      }
      case "SwitchCase": {
        const consequent = node.consequent as Node[];
        const label = node.test ? `case ${snippetOf(js, node.test as Node)}` : "default";
        const id = add("case", node, fn, ["entered"], label);
        const at = consequent.length ? consequent[0].start : node.end;
        splices.push({ start: at, end: at, before: `__sc$h(${id});`, after: "" });
        break;
      }
      case "AssignmentPattern": {
        const right = node.right as Node;
        const id = add("default", node, fn, ["default used"]);
        splices.push({ start: right.start, end: right.end, before: `(__sc$h(${id}),`, after: ")" });
        break;
      }
    }
  });
  const instrumented = (global: string) => {
    const header = `const __sc$c = ${global}(${probes.length});` +
      "const __sc$t = (i, v) => (__sc$c[2 * i + (v ? 0 : 1)]++, v);" +
      "const __sc$and = (i, v) => (__sc$c[2 * i + (v ? 0 : 1)]++, v);" +
      "const __sc$or = (i, v) => (__sc$c[2 * i + (v ? 1 : 0)]++, v);" +
      "const __sc$nul = (i, v) => (__sc$c[2 * i + (v == null ? 0 : 1)]++, v);" +
      "const __sc$h = i => { __sc$c[2 * i]++; };";
    return spliceAll(js, splices, header);
  };
  return { js, probes, instrumented };
}

/** Applies wrapping splices (nested ones inside out) and puts `header` after the imports. */
function spliceAll(js: string, splices: readonly Splice[], header: string): string {
  type Event = { pos: number; text: string; closing: boolean; span: number; start: number };
  const events: Event[] = [];
  for (const item of splices) {
    // A statement inserted before a node (no closing part) goes outside anything that starts there.
    events.push({ pos: item.start, text: item.before, closing: false, span: item.after ? item.end - item.start : Number.MAX_SAFE_INTEGER, start: item.start });
    if (item.after) events.push({ pos: item.end, text: item.after, closing: true, span: item.end - item.start, start: item.start });
  }
  // At one position: closings first (innermost first), then openings (outermost first).
  events.sort((a, b) => a.pos - b.pos || (a.closing === b.closing ? (a.closing ? a.span - b.span : b.span - a.span) : a.closing ? -1 : 1));
  let out = "", at = 0;
  for (const event of events) { out += js.slice(at, event.pos) + event.text; at = event.pos; }
  out += js.slice(at);
  // Imports are hoisted anyway; the header goes first so probes exist before any module code runs.
  return `${header}\n${out}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Mutants
// ---------------------------------------------------------------------------------------------------------------

/** A mutant; `fnHash` is a hash of the JavaScript text of the function (method, property, variable or class) it is in. */
export type Mutant = { readonly id: number; readonly line: number; readonly fn: string; readonly fnHash: string; readonly operator: string; readonly original: string; readonly replacement: string; readonly start: number; readonly end: number };

const SWAP: Readonly<Record<string, readonly string[]>> = {
  "===": ["!=="], "!==": ["==="], "==": ["!="], "!=": ["=="],
  "<": ["<=", ">="], "<=": ["<", ">"], ">": [">=", "<="], ">=": [">", "<"],
  "+": ["-"], "-": ["+"], "*": ["/"], "/": ["*"], "%": ["*"],
  "&&": ["||"], "||": ["&&"], "??": ["&&"],
};
const METHOD_SWAP: Readonly<Record<string, string>> = { some: "every", every: "some", max: "min", min: "max", find: "findLast", push: "unshift", shift: "pop", slice: "splice" };

/**
 * The mutants of a file: relational, equality, arithmetic and logical operator swaps; negation removed; if and ternary
 * tests forced true and false; expression statements removed; ++/-- swapped; numbers and booleans changed; and a few
 * method swaps (some/every, min/max, find/findLast). Deterministic: the same source gives the same list.
 */
export async function mutants(ts: string): Promise<{ js: string; mutants: Mutant[] }> {
  const parser = await loadParser();
  const js = toJs(ts);
  const tree = parser.parse(js, { ecmaVersion: "latest", sourceType: "module" });
  const finder = new LineFinder(ts);
  const out: Mutant[] = [];
  const hashes = new Map<Node, string>();
  let owner: Node = tree;
  const fnHashOf = (named: Node) => { let hash = hashes.get(named); if (!hash) hashes.set(named, hash = Bun.hash(js.slice(named.start, named.end)).toString(16)); return hash; };
  const add = (node: Node, fn: string, operator: string, start: number, end: number, replacement: string, line = finder.find(snippetOf(js, node))) =>
    out.push({ id: out.length, line, fn, fnHash: fnHashOf(owner), operator, original: js.slice(start, end).replace(/\s+/g, " ").slice(0, 90), replacement: replacement.replace(/\s+/g, " ").slice(0, 90), start, end });
  const isStringy = (node: Node) => (node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral";
  walk(tree, (node, parent, fn, named) => {
    owner = named;

    // Nothing in import/export plumbing or class field declarations' names.
    switch (node.type) {
      case "BinaryExpression": case "LogicalExpression": {
        const op = node.operator as string, left = node.left as Node, right = node.right as Node;
        if (op === "+" && (isStringy(left) || isStringy(right))) break;
        const line = finder.find(snippetOf(js, node));
        const opStart = js.indexOf(op, left.end);
        for (const next of SWAP[op] ?? []) add(node, fn, `${op} → ${next}`, opStart, opStart + op.length, next, line);
        break;
      }
      case "UnaryExpression": {
        if (node.operator !== "!") break;
        const arg = node.argument as Node;
        if (arg.type === "Literal") { add(node, fn, "boolean flip", node.start, node.end, (arg.value as number) ? "!0" : "!1"); break; }
        add(node, fn, "negation removed", node.start, node.end, `(${js.slice(arg.start, arg.end)})`);
        break;
      }
      case "IfStatement": case "ConditionalExpression": {
        const test = node.test as Node;
        const line = finder.find(snippetOf(js, test));
        add(test, fn, "test → true", test.start, test.end, "true", line);
        add(test, fn, "test → false", test.start, test.end, "false", line);
        break;
      }
      case "ExpressionStatement": {
        if (parent?.type === "Program") break;
        const expression = node.expression as Node;
        if (expression.type === "Literal") break;
        add(node, fn, "statement removed", node.start, node.end, ";");
        break;
      }
      case "ReturnStatement": {
        // An early `return;` removed lets the rest run.
        if (!node.argument) add(node, fn, "early return removed", node.start, node.end, ";");
        break;
      }
      case "ContinueStatement": case "BreakStatement": {
        if (parent?.type === "SwitchCase") break;
        add(node, fn, `${node.type === "ContinueStatement" ? "continue" : "break"} removed`, node.start, node.end, ";");
        break;
      }
      case "UpdateExpression": {
        const text = js.slice(node.start, node.end);
        add(node, fn, "++/-- swapped", node.start, node.end, text.includes("++") ? text.replace("++", "--") : text.replace("--", "++"));
        break;
      }
      case "Literal": {
        // Small integers only (off-by-one territory); not the 0 and 1 of the transpiler's `!0`, `!1` and `void 0`.
        if (typeof node.value === "number" && Number.isInteger(node.value) && Math.abs(node.value) <= 2 && parent?.type !== "Property" &&
          parent?.type !== "MemberExpression" && parent?.type !== "UnaryExpression") {
          const value = node.value as number;
          add(node, fn, "number changed", node.start, node.end, value === 0 ? "1" : value === 1 ? "0" : String(value + 1));
        }
        break;
      }
      case "MemberExpression": {
        const property = node.property as Node & { name?: string };
        if (node.computed || property.type !== "Identifier" || !property.name || !(property.name in METHOD_SWAP)) break;
        if (parent?.type !== "CallExpression" || (parent.callee as Node) !== node) break;
        add(node, fn, `${property.name} → ${METHOD_SWAP[property.name]}`, property.start, property.end, METHOD_SWAP[property.name]);
        break;
      }
    }
  });
  return { js, mutants: out };
}

/** The file's JavaScript with one mutant applied. */
export const applyMutant = (js: string, mutant: Pick<Mutant, "start" | "end" | "replacement">) =>
  js.slice(0, mutant.start) + mutant.replacement + js.slice(mutant.end);
