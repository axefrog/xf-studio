/**
 * A GPU-free check of GLSL ES 3.00 text as Three r186 hands it to the driver (PREV-195): the conditional preprocessor evaluated with the
 * program's own defines, then every global declaration, struct and function definition counted. It finds what broke a program before
 * (8474bb3: a skin program declaring its second joint attributes twice), an include left unresolved, a macro redefined with another
 * body and unbalanced conditionals. It is no compiler: types and expressions are not checked (the render smoke test compiles for real).
 */

type Frame = { active: boolean; taken: boolean };

/** Remove comments, keeping line breaks, and join continued lines. */
function stripped(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  return text.replace(/\\\n/g, " ").split("\n");
}

/** Evaluate a `#if` / `#elif` expression over the object-like macros defined so far (undefined identifiers are 0, as in GLSL). */
function evaluate(expression: string, macros: ReadonlyMap<string, string | null>, issues: string[]): boolean {
  let text = expression.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a?: string, b?: string) => macros.has((a ?? b)!) ? "1" : "0");
  for (let round = 0; round < 8 && /[A-Za-z_]/.test(text); round++)
    text = text.replace(/\b[A-Za-z_]\w*\b/g, name => { const value = macros.get(name); return value === undefined || value === null ? "0" : `(${value || "1"})`; });
  if (!/^[\d\s()!&|<>=+\-*/%.]*$/.test(text)) { issues.push(`#if ${expression} can't be evaluated`); return false; }
  try { return !!Function(`"use strict"; return (${text.replace(/(\d+)\.(?!\d)/g, "$1")});`)(); }
  catch { issues.push(`#if ${expression} can't be evaluated`); return false; }
}

/** The lines the preprocessor keeps, and its own issues. */
function preprocess(source: string, issues: string[]): string[] {
  const macros = new Map<string, string | null>(), definitions = new Map<string, string>(), stack: Frame[] = [], kept: string[] = [];
  const active = (frames = stack) => frames.every(frame => frame.active);
  for (const line of stripped(source)) {
    const directive = /^\s*#\s*(\w+)\s*(.*?)\s*$/.exec(line);
    if (!directive) { if (active()) kept.push(line); continue; }
    const [, name, rest] = directive as unknown as [string, string, string];
    if (name === "ifdef" || name === "ifndef" || name === "if") {
      const parent = active();
      const condition = parent && (name === "if" ? evaluate(rest, macros, issues) : macros.has(rest.split(/\s/)[0]!) === (name === "ifdef"));
      stack.push({ active: condition, taken: condition });
    } else if (name === "elif" || name === "else") {
      const top = stack.at(-1);
      if (!top) { issues.push(`#${name} without #if`); continue; }
      const parent = active(stack.slice(0, -1));
      const condition = parent && !top.taken && (name === "else" || evaluate(rest, macros, issues));
      top.active = condition; top.taken ||= condition;
    } else if (name === "endif") {
      if (!stack.pop()) issues.push("#endif without #if");
    } else if (!active()) continue;
    else if (name === "define") {
      const found = /^(\w+)(\()?(.*)$/.exec(rest);
      if (!found) { issues.push(`#define ${rest} is malformed`); continue; }
      const [, macro, call, body] = found as unknown as [string, string, string | undefined, string];
      // A redefinition must have the same body (GLSL ES 3.00 §3.4), whitespace aside; a function-like macro's includes its parameters.
      const definition = `${call ? "(" : ""}${body}`.replace(/\s+/g, " ").trim(), before = definitions.get(macro);
      if (before !== undefined && before !== definition) issues.push(`#define ${macro} redefined`);
      definitions.set(macro, definition);
      macros.set(macro, call ? null : body.trim());
    } else if (name === "undef") { macros.delete(rest.trim()); definitions.delete(rest.trim()); }
    else if (name === "include") issues.push(`#include ${rest} left unresolved`);
    else if (name === "error") issues.push(`#error ${rest}`);
  }
  if (stack.length) issues.push("an #if is never closed");
  return kept;
}

/** Split `text` at top-level commas (outside parentheses and brackets). */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Global names, struct names and function definitions in the kept text, with each one declared more than once. */
function declarations(kept: string[], issues: string[]) {
  const text = kept.join("\n"), variables = new Map<string, number>(), structs = new Map<string, number>(), functions = new Map<string, number>();
  const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  let depth = 0, statement = "", block: "struct" | "function" | "other" | null = null;
  const declare = (raw: string) => {
    const body = raw.replace(/\blayout\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    if (!body || /^precision\b/.test(body) || /^invariant\b/.test(body)) return;
    // A prototype (no body): repeating one is legal.
    if (/^[\w\s]+\s\w+\s*\([^)]*\)$/.test(body) && !body.includes("=")) return;
    const [first, ...rest] = topLevelParts(body);
    const named = (part: string) => /(\w+)\s*(?:\[[^\]]*\])?\s*$/.exec(part.split("=")[0]!.trim())?.[1];
    for (const name of [named(first!), ...rest.map(part => /^\s*(\w+)/.exec(part)?.[1])]) if (name) count(variables, name);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (depth === 0) {
      if (c === ";") {
        declare(block === "struct" ? statement.replace(/^[^}]*}/, "") : statement);
        statement = ""; block = null;
      } else if (c === "{") {
        const header = statement.replace(/\s+/g, " ").trim();
        const struct = /\bstruct\s+(\w+)$/.exec(header), fn = /(\w+)\s*\(([^)]*)\)$/.exec(header);
        if (struct) { count(structs, struct[1]!); block = "struct"; }
        else if (fn) {
          const types = fn[2]!.split(",").map(param => param.trim().replace(/\s*\w+\s*(\[[^\]]*\])?$/, "$1").replace(/\b(in|out|inout|const|highp|mediump|lowp)\b\s*/g, "").trim());
          count(functions, `${fn[1]}(${types.join(",")})`);
          block = "function";
        } else block = "other";
        depth = 1;
        statement = block === "struct" ? statement : "";
      } else statement += c;
    } else {
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        if (block === "function" || block === "other") { statement = ""; block = null; }
        else statement += "}";
      }
    }
  }
  for (const [name, n] of variables) if (n > 1) issues.push(`"${name}" is declared ${n} times`);
  for (const [name, n] of structs) if (n > 1) issues.push(`struct ${name} is defined ${n} times`);
  for (const [name, n] of functions) if (n > 1) issues.push(`${name} is defined ${n} times`);
  return { variables, functions };
}

/** Everything wrong with one shader's final text (empty: nothing this check can find). */
export function glslIssues(source: string): string[] {
  const issues: string[] = [];
  declarations(preprocess(source, issues), issues);
  return issues;
}

/** The global names and function definitions the preprocessed text declares (tests read them to prove a hook's code is live). */
export function glslDeclarations(source: string) {
  return declarations(preprocess(source, []), []);
}
