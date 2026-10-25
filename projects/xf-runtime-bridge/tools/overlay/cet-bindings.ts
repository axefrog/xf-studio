// CET's Lua ImGui binding table, read from sol_imgui.h (Cyber Engine Tweaks' src/sol_imgui/sol_imgui.h) into plain data: every
// function the `ImGui` table carries with its overloads (parameter and result kinds, as sol2 checks them), and every enum
// table with its members. tools/test/cet-bindings.test.ts runs the CET layer against it under fengari, so a missing
// binding, a nil enum member or an argument no overload takes fails offline, as it would in the game.
//
// The committed table is CET v1.37.1's (the version the test profile runs):
//   bun tools/overlay/cet-bindings.ts [--header <sol_imgui.h>] [--check]
// Without --header it reads `git show v1.37.1:src/sol_imgui/sol_imgui.h` from the CET clone (XFB_CET_SOURCE, default
// D:/Dev/CyberEngineTweaks). --check compares instead of writing (exit 1 on a difference).
//
// Enum values are not in the header (they are Dear ImGui's constants), so the table keeps member names in order only; the
// harness gives flag enums distinct bits and other enums their index. Only presence and kind are claims about CET.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Kind = "string" | "number" | "integer" | "boolean" | "table" | "drawlist" | "font" | "userdata" | "any";
export type Overload = { params: Kind[]; results: Kind[] };
export type CetBindings = { cet: string; source: string; functions: Record<string, Overload[]>; enums: Record<string, string[]> };

export const CET_TAG = "v1.37.1";
export const CET_SOURCE = process.env.XFB_CET_SOURCE ?? "D:/Dev/CyberEngineTweaks";
export const BINDINGS_OUT = resolve(import.meta.dir, "..", "test", "fixtures", "cet-1.37.1-imgui.json");

/** The kind sol2 checks a C++ parameter against (SOL_ALL_SAFETIES_ON: integers must be integral, bools must be booleans). */
export function paramKind(cpp: string): Kind {
  const t = cpp.replace(/\s+/g, " ").replace(/\b(const|volatile)\b/g, "").replace(/\s*&\s*$/, "").trim();
  if (t === "float" || t === "double") return "number";
  if (t === "int" || t === "unsigned int" || t === "ImU32" || t === "ImGuiID") return "integer";
  if (t === "bool") return "boolean";
  if (t === "std::string" || t === "char*" || t === "char *") return "string";
  if (t === "sol::table") return "table";
  if (t === "ImDrawList*" || t === "ImDrawList *") return "drawlist";
  if (t === "ImFont*" || t === "ImFont *") return "font";
  if (t.startsWith("sol::object") || t.startsWith("sol::variadic")) return "any";
  return "userdata";
}

function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "(") depth++;
    else if (c === ">" || c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** The values a C++ result pushes: a std::tuple pushes each member; void pushes none. */
export function resultKinds(cpp: string): Kind[] {
  const t = cpp.replace(/\s+/g, " ").trim();
  if (t === "void") return [];
  const tuple = /^std::tuple<(.*)>$/.exec(t);
  if (tuple) return splitTop(tuple[1]).flatMap(resultKinds);
  if (t.startsWith("sol::as_table_t")) return ["table"];
  if (t === "ImGuiTableColumnFlags") return ["integer"];
  return [paramKind(t)];
}

function params(list: string): Kind[] {
  const text = list.trim();
  if (!text || text === "void") return [];
  return splitTop(text)
    .map((p) => p.replace(/=.*$/, "").trim())
    // a declaration names its parameter; a sol::resolve signature doesn't
    .map((p) => (/[\w>&*]\s+\w+$/.test(p) && !/^(unsigned|const)\s+\w+$/.test(p) ? p.replace(/\s*\w+$/, "") : p))
    .filter((p) => !/^sol::this_(state|environment)\b/.test(p.replace(/\bconst\b/, "").trim()))
    .map(paramKind);
}

/** Drops the blocks behind macros CET's build leaves undefined (only #ifdef SOL_IMGUI_ENABLE_FONT_MANIPULATORS in 1.37.1). */
function preprocess(header: string): string {
  const lines = header.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const skip: boolean[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^#ifdef\s+SOL_IMGUI_ENABLE_FONT_MANIPULATORS\b/.test(t)) { skip.push(true); continue; }
    if (/^#if/.test(t)) { skip.push(false); continue; }
    if (/^#endif/.test(t)) { skip.pop(); continue; }
    if (skip.some(Boolean)) continue;
    out.push(line.replace(/\/\/.*$/, ""));
  }
  return out.join("\n");
}

function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced call at " + open);
}

export function parseBindings(header: string, cet = CET_TAG, source = "src/sol_imgui/sol_imgui.h"): CetBindings {
  const text = preprocess(header);
  const bindingsAt = text.indexOf("inline void InitBindings(");
  const enumsAt = text.indexOf("inline void InitEnums(");
  if (bindingsAt < 0 || enumsAt < 0) throw new Error("InitBindings or InitEnums not found");

  // Every inline wrapper the bindings name, by name.
  const definitions = new Map<string, Overload[]>();
  const definition = /inline\s+([\w:<>,\s&*]+?)\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  for (const m of text.slice(0, enumsAt).matchAll(definition)) {
    const list = definitions.get(m[2]) ?? [];
    list.push({ params: params(m[3]), results: resultKinds(m[1]) });
    definitions.set(m[2], list);
  }

  const functions: Record<string, Overload[]> = {};
  const body = text.slice(bindingsAt);
  for (const m of body.matchAll(/ImGui\.set_function\(/g)) {
    const inner = balanced(body, m.index! + m[0].length - 1);
    const name = /^\s*"(\w+)"\s*,/.exec(inner);
    if (!name) throw new Error("set_function without a name: " + inner.slice(0, 60));
    const expr = inner.slice(name[0].length).trim();
    const overloads: Overload[] = [];
    if (expr.startsWith("sol::overload")) {
      for (const r of expr.matchAll(/sol::resolve<\s*([\w:<>,\s&*]+?)\s*\(([^)]*)\)\s*>/g)) {
        overloads.push({ params: params(r[2]), results: resultKinds(r[1]) });
      }
    } else if (/^\w+$/.test(expr)) {
      const defs = definitions.get(expr);
      if (!defs || defs.length !== 1) throw new Error(`${name[1]}: ${defs ? "several" : "no"} definitions of ${expr}`);
      overloads.push(...defs);
    } else {
      throw new Error(`${name[1]}: unrecognised binding ${expr.slice(0, 60)}`);
    }
    if (!overloads.length) throw new Error(`${name[1]}: no overloads read`);
    functions[name[1]] = overloads;
  }

  const enums: Record<string, string[]> = {};
  const enumBody = text.slice(enumsAt, bindingsAt > enumsAt ? bindingsAt : undefined);
  for (const m of enumBody.matchAll(/new_enum\(/g)) {
    const items = splitTop(balanced(enumBody, m.index! + m[0].length - 1));
    const enumName = /^"(\w+)"$/.exec(items[0]);
    if (!enumName) throw new Error("enum without a name");
    const members: string[] = [];
    for (let i = 1; i + 1 < items.length; i += 2) {
      const member = /^"(\w+)"$/.exec(items[i]);
      if (!member) throw new Error(`${enumName[1]}: member ${items[i]}`);
      members.push(member[1]);
    }
    enums[enumName[1]] = members;
  }
  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { cet, source, functions: sorted(functions), enums: sorted(enums) };
}

/** CET v1.37.1's sol_imgui.h from the clone, or null without it. */
export function cetHeader(root = CET_SOURCE, tag = CET_TAG): string | null {
  if (!existsSync(join(root, ".git"))) return null;
  const r = spawnSync("git", ["-C", root, "show", `${tag}:src/sol_imgui/sol_imgui.h`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * 0.8.22 (Borg 4: every card drew plain): CET wraps each ImGui function to read its caller's environment (__logger, through
 * sol::this_environment), and LuaJIT drops the frame of a function that tail-calls, so `return ImGui.X(...)` inside a function
 * that pcall (or any C function) called finds pcall's environment and fails with "stack index -1, expected userdata, received
 * nil". The rule: no ImGui call is ever a tail call. Answers the 1-based lines that make one.
 */
export function imguiTailCalls(code: string): number[] {
  const lines: number[] = [];
  const text = code.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, (m) => m.replace(/[^\n]/g, " ")).replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
  const pattern = /\breturn\s+ImGui\s*\.\s*\w+\s*\(/g;
  for (const m of text.matchAll(pattern)) {
    let depth = 0, i = m.index! + m[0].length - 1, quote = "";
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    // A tail call is the whole returned expression: nothing but the end of the statement after its closing parenthesis.
    const rest = text.slice(i + 1).match(/^[ \t]*(\r?\n|;|end\b|else\b|elseif\b|$)/);
    if (rest) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}

export const renderBindings = (b: CetBindings) => JSON.stringify(b, null, 1) + "\n";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--header");
  const header = at >= 0 ? readFileSync(args[at + 1], "utf8") : cetHeader();
  if (header === null) {
    console.error(`CET ${CET_TAG} not found at ${CET_SOURCE} (set XFB_CET_SOURCE or pass --header)`);
    process.exit(2);
  }
  const text = renderBindings(parseBindings(header));
  if (args.includes("--check")) {
    const same = existsSync(BINDINGS_OUT) && readFileSync(BINDINGS_OUT, "utf8").replace(/\r\n/g, "\n") === text;
    console.log(same ? "OK   the committed CET binding table matches" : "FAIL the committed CET binding table differs; run without --check");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(BINDINGS_OUT, text);
  console.log(`wrote ${BINDINGS_OUT}`);
}
