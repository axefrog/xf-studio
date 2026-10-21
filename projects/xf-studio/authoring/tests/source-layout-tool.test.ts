import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { moduleSpecifiers, rewriteSpecifiers } from "../tools/source-layout";
import { imports } from "./fixtures/import-scan";
import { sourceFiles, sourceText } from "./fixtures/source-files";

const values = (text: string) => moduleSpecifiers(text).map(span => span.value);

test("the tool finds every module specifier form", () => {
  expect(values([`import { a } from "./a";`, `export { b } from './b';`, `export * from "./c";`, `import "./d";`,
    `const e = await import("./e");`, `type F = import("./f").F;`, "const g = await import(`./g`);", `const h = require("./h");`,
    `const i = import.meta.require("./i");`, `const w = new Worker(new URL("./j.ts", import.meta.url));`].join("\n")))
    .toEqual(["./a", "./b", "./c", "./d", "./e", "./f", "./g", "./h", "./i", "./j.ts"]);
  // Members that only share a name are not imports.
  expect(values(`x.import("./w"); store.require("./q"); const u = new URLish("./v");`)).toEqual([]);
});

test("a path-like data string is not an import, even beside the same import (duplicate data string)", () => {
  const text = [`import { readRecipe } from "../src/recipe-schema";`, `const fixture = "../src/recipe-schema";`,
    `expect(paths).toContain("../src/recipe-schema");`].join("\n");
  const result = rewriteSpecifiers(text, specifier => specifier === "../src/recipe-schema" ? "../src/legacy/eye-makeup/recipe-schema" : undefined);
  expect(result.changed).toBe(1);
  expect(result.text).toBe([`import { readRecipe } from "../src/legacy/eye-makeup/recipe-schema";`, `const fixture = "../src/recipe-schema";`,
    `expect(paths).toContain("../src/recipe-schema");`].join("\n"));
});

test("an import inside a comment is not an import", () => {
  expect(values([`// import { a } from "./a";`, `/* import "./b"; const c = require("./c"); */`, "/**", ` * export * from "./d";`, " */",
    `import { e } from "./e";`].join("\n"))).toEqual(["./e"]);
});

test("import text inside a template is not an import, across lines and around substitutions; code in a substitution is", () => {
  const text = ["const probe = `", `import { a } from "./a";`, "export const b = 1;", "`;",
    "const mixed = `before ${await import(\"./real\")} middle ${`nested ${x} from \"./nested\"`} import(\"./c\") after`;",
    `const regex = /from "\\.\\/d"/g, ratio = total / count / 2;`, `import { e } from "./e";`].join("\n");
  expect(values(text)).toEqual(["./real", "./e"]);
  const result = rewriteSpecifiers(text, specifier => `${specifier}-moved`);
  expect(result.changed).toBe(2);
  expect(result.text).toContain(`import { a } from "./a";`);
  expect(result.text).toContain(`await import("./real-moved")`);
  expect(result.text).toContain(`import { e } from "./e-moved";`);
});

test("the tool sees the same relative imports as the boundary scan in every source module", () => {
  const root = resolve(import.meta.dir, "..", "src");
  const differences = [...sourceFiles(root)].flatMap(file => {
    const text = sourceText(file);
    const scanned = imports(text).filter(path => path.startsWith(".")), found = values(text).filter(path => path.startsWith("."));
    return JSON.stringify(scanned) === JSON.stringify(found) ? [] : [`${file}: ${JSON.stringify(scanned)} vs ${JSON.stringify(found)}`];
  });
  expect(differences).toEqual([]);
});

const scratch = mkdtempSync(join(tmpdir(), "xfs-source-layout-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("--imports-only rewrites only the imports a move broke, and a second run changes nothing", () => {
  // A tree after the move: recipe-schema went to legacy/eye-makeup/, and a branch's own module still names the old place.
  mkdirSync(join(scratch, "src", "legacy", "eye-makeup"), { recursive: true });
  writeFileSync(join(scratch, "src", "legacy", "eye-makeup", "recipe-schema.ts"), "export const readRecipe = 1;\n");
  writeFileSync(join(scratch, "src", "platform.ts"), "export const api = 1;\n");
  // The old path is built, not written out, so the tool's own text pass over tracked files never rewrites this fixture.
  const old = "recipe-schema";
  writeFileSync(join(scratch, "map.json"), JSON.stringify({ [`src/${old}.ts`]: "src/legacy/eye-makeup/recipe-schema.ts" }));
  const branch = [`import { readRecipe } from "./recipe-schema";`, `import { api } from "./platform";`, `const data = "./recipe-schema";`,
    `// import { readRecipe } from "./recipe-schema";`, "const probe = `", `import { readRecipe } from "./recipe-schema";`, "`;", ""].join("\n");
  writeFileSync(join(scratch, "src", "hair.ts"), branch);
  const run = () => {
    const done = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "..", "tools", "source-layout.ts"), "--root", scratch,
      "--map", join(scratch, "map.json"), "--imports-only", join(scratch, "src")], { stdout: "pipe", stderr: "pipe" });
    expect(done.exitCode, done.stderr.toString()).toBe(0);
    return done.stdout.toString();
  };
  expect(run()).toContain("Rewrote 1 imports in 1 files.");
  expect(readFileSync(join(scratch, "src", "hair.ts"), "utf8"))
    .toBe(branch.replace(`import { readRecipe } from "./recipe-schema";\nimport { api }`, `import { readRecipe } from "./legacy/eye-makeup/recipe-schema";\nimport { api }`));
  const after = readFileSync(join(scratch, "src", "hair.ts"), "utf8");
  expect(run()).toContain("Rewrote 0 imports in 0 files.");
  expect(readFileSync(join(scratch, "src", "hair.ts"), "utf8")).toBe(after);
});
