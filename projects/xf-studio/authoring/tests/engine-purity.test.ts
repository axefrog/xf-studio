import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("engines receive time, randomness and scheduling from their callers", () => {
  const root = resolve(import.meta.dir, "../src/engines");
  const forbidden = /\b(?:Date\s*\.\s*now|performance\s*\.\s*now|Math\s*\.\s*random|setTimeout|setInterval|requestAnimationFrame)\b|\bnew\s+Date\s*\(/g;
  const found = [...new Bun.Glob("**/*.{ts,tsx,js}").scanSync(root)].sort().flatMap(file =>
    readFileSync(resolve(root, file), "utf8").split(/\r?\n/).flatMap((line, i) => {
      forbidden.lastIndex = 0;
      return forbidden.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [];
    }));
  expect(found).toEqual([]);
});
