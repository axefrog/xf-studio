// Syntax-checks the CET Lua layer offline with luaparse 0.3.1 (LuaJIT grammar) and flags a few
// CET-specific mistakes found while reading CET v1.37.1: `spdlog.warn` does not exist
// (it is spdlog.warning) and `table.unpack` is not Lua 5.1 (the sandbox whitelists `unpack`).
//
//   bun tools/lint-lua.ts [--luaparse <path to luaparse.js>]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const index = args.indexOf("--luaparse");
const luaparsePath =
  (index >= 0 ? args[index + 1] : undefined) ??
  process.env.XFB_LUAPARSE ??
  "D:/Dev/tools/luaparse/0.3.1/package/luaparse.js";

const require = createRequire(import.meta.url);
let luaparse: { parse: (code: string, options: Record<string, unknown>) => unknown };
try {
  luaparse = require(luaparsePath);
} catch {
  console.error(`luaparse not found at ${luaparsePath} (npm luaparse 0.3.1; see docs/toolchain.md)`);
  process.exit(2);
}

const root = resolve(import.meta.dir, "..", "cet");
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".lua")) files.push(path);
  }
};
walk(root);

const forbidden: Array<[RegExp, string]> = [
  [/\bspdlog\.warn\s*\(/, "CET has spdlog.warning, not spdlog.warn"],
  [/\btable\.unpack\b/, "LuaJIT (Lua 5.1): use unpack"],
  [/\brequire\s*\(\s*["']socket/, "CET has no socket library"],
];

let failures = 0;
for (const file of files) {
  const code = readFileSync(file, "utf8");
  try {
    luaparse.parse(code, { luaVersion: "LuaJIT", comments: false });
  } catch (error) {
    failures++;
    console.log(`FAIL ${file}: ${(error as Error).message}`);
    continue;
  }
  const lines = code.split(/\r?\n/);
  lines.forEach((line, i) => {
    const code = line.replace(/--.*$/, "");
    for (const [pattern, why] of forbidden) {
      if (pattern.test(code)) {
        failures++;
        console.log(`FAIL ${file}:${i + 1}: ${why}`);
      }
    }
  });
  console.log(`OK   ${file}`);
}
process.exit(failures === 0 ? 0 : 1);
