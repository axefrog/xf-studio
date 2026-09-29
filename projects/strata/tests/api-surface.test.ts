/**
 * The public API surface (design §1.2): every name exported from `strata` and `strata/testing`, with its declaration as
 * the compiler emits it (the type declarations: public members, signatures, types; private and `@internal` members
 * left out). Any change fails this test until the snapshot is regenerated
 * (`UPDATE_API_SNAPSHOT=1 bun test tests/api-surface.test.ts`) and the change is noted in CHANGELOG.md.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SNAPSHOT = join(import.meta.dir, "api-surface.json");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : name.endsWith(".d.ts") ? [path] : [];
});

/** The names an entry point exports. */
function exported(entry: string): string[] {
  const text = readFileSync(join(ROOT, entry), "utf8");
  return [...text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap(match => match[1].split(",").map(name => name.trim()).filter(Boolean))
    .map(name => name.split(/\s+as\s+/).pop()!).sort();
}

/** Declarations by name from emitted .d.ts text: comments dropped, private and internal members left out, whitespace squashed. */
function declarations(files: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8").replace(/\/\*\*(?:(?!\*\/)[\s\S])*?@internal[\s\S]*?\*\/\s*[^\n]*\n/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const pattern = /export\s+(?:declare\s+)?(?:abstract\s+)?(class|interface|type|function|const|let|enum)\s+([\w$]+)/g;
    for (const match of text.matchAll(pattern)) {
      let depth = 0, end = match.index!;
      for (let i = match.index!; i < text.length; i++) {
        const c = text[i];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") { depth--; if (depth === 0 && c === "}" && (match[1] === "class" || match[1] === "interface" || match[1] === "enum")) { end = i + 1; break; } }
        else if (c === ";" && depth === 0) { end = i; break; }
      }
      const body = text.slice(match.index!, end).split("\n").filter(line => !/^\s*private\s/.test(line)).join(" ").replace(/\s+/g, " ").trim();
      if (!out.has(match[2])) out.set(match[2], body);
    }
  }
  return out;
}

test("the public API surface is as recorded", () => {
  const out = mkdtempSync(join(tmpdir(), "strata-api-"));
  try {
    const compiler = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsc.exe" : "tsc");
    const emitted = Bun.spawnSync([compiler, "-p", join(ROOT, "tsconfig.json"), "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--outDir", out]);
    expect(emitted.exitCode, emitted.stderr.toString() + emitted.stdout.toString()).toBe(0);
    const found = declarations(walk(out));
    const surface: Record<string, Record<string, string>> = {};
    for (const entry of ["index.ts", "testing.ts"]) surface[entry] = Object.fromEntries(exported(entry).map(name => [name, found.get(name) ?? "(not found)"]));
    if (process.env.UPDATE_API_SNAPSHOT) writeFileSync(SNAPSHOT, `${JSON.stringify(surface, null, 2)}\n`);
    for (const names of Object.values(surface)) for (const [name, text] of Object.entries(names)) expect(`${name}: ${text}`).not.toContain("(not found)");
    expect(surface).toEqual(JSON.parse(readFileSync(SNAPSHOT, "utf8")));
  } finally { rmSync(out, { recursive: true, force: true }); }
}, 60_000);
