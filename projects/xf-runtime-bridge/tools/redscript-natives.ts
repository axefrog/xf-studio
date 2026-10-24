// Offline native-global contract. No game, compiler or staging side effects.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
export type ScriptSource = { path: string; text: string };
export function testHookSource(text: string, autonomous: boolean): string {
  return text.replace(/\/\/ BEGIN XFB_AUTONOMOUS_TEST_HOOKS\r?\n[\s\S]*?\/\/ END XFB_AUTONOMOUS_TEST_HOOKS/g,
    block => autonomous ? block : "");
}
export function packageScripts(project: string, variant: string, autonomous: boolean): ScriptSource[] {
  const folders = ["redscript", ...(variant === "writes" ? ["redscript-probes", "redscript-dm"] : []),
    ...(autonomous ? ["redscript-input", "redscript-probes/autonomous"] : [])];
  return folders.flatMap(folder => readdirSync(join(project, folder)).filter(name => name.endsWith(".reds") &&
    (autonomous || name !== "XFRuntimeBridgeRecording.reds")).map(name => ({ path: join(project, folder, name),
      text: testHookSource(readFileSync(join(project, folder, name), "utf8"), autonomous) })));
}
// Preserve strings (including register names), erase comments without interpreting commented code.
function uncomment(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('"') ? token : token.replace(/[^\r\n]/g, " "));
}
export function registeredGlobals(cpp: string, autonomous: boolean): Set<string> {
  const enabled = new Set(autonomous ? ["XFB_AUTONOMOUS_TEST_HOOKS"] : []);
  const stack: { parent: boolean; condition: boolean }[] = [];
  let active = true, selected = "";
  for (const line of uncomment(cpp).split(/\r?\n/)) {
    const directive = line.match(/^\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b(.*)/);
    if (!directive) { if (active) selected += line + "\n"; continue; }
    const [, kind, raw = ""] = directive, expr = raw.trim();
    if (kind === "ifdef" || kind === "ifndef" || kind === "if") {
      // Deliberately fail closed if registration gains an unmodelled build flag/expression.
      const flag = kind === "if" ? expr.match(/^defined\s*\(\s*(\w+)\s*\)$/)?.[1] : expr;
      if (flag !== "XFB_AUTONOMOUS_TEST_HOOKS") throw new Error(`Unmodelled native build condition: ${line.trim()}`);
      const condition = kind === "ifndef" ? !enabled.has(flag) : enabled.has(flag);
      stack.push({ parent: active, condition }); active = active && condition;
    } else if (kind === "else") {
      const top = stack.at(-1); if (!top) throw new Error("Unmatched native #else");
      active = top.parent && !top.condition;
    } else if (kind === "endif") {
      const top = stack.pop(); if (!top) throw new Error("Unmatched native #endif"); active = top.parent;
    } else throw new Error(`Unmodelled native build condition: ${line.trim()}`);
  }
  if (stack.length) throw new Error("Unclosed native build condition");
  return new Set([...selected.matchAll(/\bRegisterGlobal(?:Typed)?\s*\(\s*rtti\s*,\s*"([^"]+)"/g)].map(match => match[1]!));
}
export function checkNativeGlobals(sources: ScriptSource[], cpp: string, autonomous: boolean): string[] {
  const registered = registeredGlobals(cpp, autonomous), errors: string[] = [];
  for (const source of sources) {
    const text = uncomment(source.text);
    const module = text.match(/^\s*module\s+([\w.]+)/m)?.[1];
    // Only top-level native funcs: native methods inside classes are engine imports, not globals.
    let depth = 0;
    const tokens = /"(?:\\.|[^"\\])*"|[{}]|\bnative\s+func\s+(\w+)/g;
    for (const token of text.matchAll(tokens)) {
      if (token[0] === "{") depth++;
      else if (token[0] === "}") depth--;
      else if (token[1] && depth === 0) {
        const name = token[1], exact = module ? `${module}.${name}` : name;
        if (module) errors.push(`${source.path}: native global ${name} is in module ${module}; native globals must have no module line`);
        if (!registered.has(exact)) errors.push(`${source.path}: missing native global '${exact}' (XFB_AUTONOMOUS_TEST_HOOKS=${autonomous ? 1 : 0})`);
      }
    }
  }
  return errors;
}
export function assertNativeGlobals(sources: ScriptSource[], cpp: string, autonomous: boolean): number {
  const errors = checkNativeGlobals(sources, cpp, autonomous);
  if (errors.length) throw new Error(errors.join("\n"));
  return registeredGlobals(cpp, autonomous).size;
}
export function stagedScripts(directory: string): ScriptSource[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? stagedScripts(join(directory, entry.name)) : entry.name.endsWith(".reds")
      ? [{ path: join(directory, entry.name), text: readFileSync(join(directory, entry.name), "utf8") }] : []);
}
