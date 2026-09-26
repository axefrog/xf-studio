// NATIVE-17: the native reader's import boundary. Its format and decoding modules are pure (no file system, process, FFI, host
// globals or host adapters), its host adapters are named, and nothing outside src/native imports it except the allow-listed host
// modules (none until integration; page code never).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { codeOnly } from "./fixtures/code-scan";
import { imports } from "./fixtures/import-scan";

const SRC = join(import.meta.dir, "..", "src");
const NATIVE = join(SRC, "native");
const read = (path: string) => readFileSync(path, "utf8");
const nativeModules = readdirSync(NATIVE).filter(file => file.endsWith(".ts")).map(file => file.slice(0, -3)).sort();

/** Modules that touch the host (files, FFI, processes, workers). Everything else in src/native is pure. */
const HOST_ADAPTERS = ["archive-reader", "native-decode", "native-decode-serve", "native-decode-worker", "native-fetch-port", "oodle"];
/**
 * Modules outside src/native allowed to import it: the resolver host at integration (research/backlog/native-archive-reader.md), and the
 * clothing host, which decodes the one resource WolvenKit 9.0.1 doesn't serialize, the game's cooked visual-tag preset (clothing-host.ts).
 */
const ALLOWED_IMPORTERS: readonly string[] = ["clothing-host"];
/**
 * Host and page globals (code-scan.ts PAGE_GLOBALS, except that `document` is the red model's own word here, a decoded resource,
 * so only the DOM's members of it count).
 */
const HOST_GLOBALS = /(?<![.\w$])window\b(?!\s*\??:)|(?<![.\w$])self\s*\.|\b(?:localStorage|sessionStorage|navigator|globalThis|indexedDB)\b|(?<![.\w$])fetch\s*\(|\bprocess\s*\.\s*env\b|\bBun\s*\.\s*env\b|(?<![.\w$])document\s*\.\s*(?:getElementById|querySelector|createElement|body|cookie|addEventListener)\b/;
const HOST_IMPORTS = /^(?:node:(?:fs|child_process|os|worker_threads|net|http|https)|bun:ffi|bun)$|(?:^|\/)(?:archive-reader|native-decode|native-decode-serve|native-decode-worker|native-fetch-port|oodle|resolver-host|process-tree|wolvenkit-cli)$/;

test("every native module is classed as pure or as a host adapter", () => {
  expect(nativeModules.length).toBeGreaterThan(15);
  for (const adapter of HOST_ADAPTERS) expect(nativeModules).toContain(adapter);
  // The host-global scan sees what it names.
  for (const text of ["window.x", "self.postMessage(1)", "process.env.X", "globalThis.y", "await fetch('/x')", "document.body"]) expect(text).toMatch(HOST_GLOBALS);
  for (const text of ["document.root", "readDocument(x)", "this.fetcher.fetch(x)", "options.self.x"]) expect(text).not.toMatch(HOST_GLOBALS);
});

test("pure native modules import no host modules and read no host globals", () => {
  const pure = nativeModules.filter(name => !HOST_ADAPTERS.includes(name));
  expect(pure).toContain("red-values");
  expect(pure).toContain("limits");
  for (const name of pure) {
    const text = read(join(NATIVE, `${name}.ts`));
    for (const dependency of imports(text)) expect(dependency, `${name} imports ${dependency}`).not.toMatch(HOST_IMPORTS);
    const code = codeOnly(text);
    expect(code.match(HOST_GLOBALS)?.[0] ?? null, `${name} reads host or page globals`).toBeNull();
    expect(code, `${name} reaches the host`).not.toMatch(/\bBun\s*\.\s*(?:spawn|spawnSync|file|write)\b|import\.meta\.require|\bnew\s+Worker\b/);
  }
});

test("only the adapters' own modules start processes, load libraries or spawn workers", () => {
  for (const name of nativeModules) {
    const text = read(join(NATIVE, `${name}.ts`)), code = codeOnly(text);
    if (imports(text).includes("node:child_process") || /\bBun\s*\.\s*spawn/.test(code)) expect(name, "starts a process").toBe("oodle");
    if (/import\.meta\.require\s*\(\s*["']bun:ffi/.test(text) || imports(text).includes("bun:ffi")) expect(name, "loads native code").toBe("oodle");
    if (/\bnew\s+Worker\b/.test(code)) expect(name, "starts a worker").toBe("native-decode");
  }
});

test("nothing outside src/native imports the native reader, and page code never does", () => {
  const offenders: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) { if (full !== NATIVE) walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const name = relative(SRC, full).split("\\").join("/").replace(/\.tsx?$/, "");
      for (const dependency of imports(read(full)))
        if (/(?:^|\/)native\/[\w-]+$/.test(dependency) && !ALLOWED_IMPORTERS.includes(name)) offenders.push(`${name} -> ${dependency}`);
    }
  };
  walk(SRC);
  expect(offenders).toEqual([]);
});
