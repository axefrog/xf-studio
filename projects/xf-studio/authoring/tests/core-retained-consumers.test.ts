import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

test("every retained legacy consumer has a live dependency, an owner, a reason and a removal criterion", () => {
  const root = resolve(import.meta.dir, "../src");
  const ledger = readFileSync(resolve(import.meta.dir, "../../../../research/authoring/core-03-s12-remaining-consumers.md"), "utf8");
  const direct = ledger.split("## Direct consumers")[1]!.split("## The one projection")[0]!;
  const rows = direct.split(/\r?\n/).filter(line => line.startsWith("| `"));
  const criteria = ledger.split("## Direct consumers")[0]!;
  for (const key of ["R", "D", "B", "P", "S", "G", "V"]) {
    const row = criteria.split(/\r?\n/).find(line => line.startsWith(`| ${key} |`))!;
    expect(row).toBeDefined(); expect(row.split("|")[2]!.length).toBeGreaterThan(100);
    expect(row).toContain("CORE-249");
  }
  const absent: string[] = [];
  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map(cell => cell.trim());
    const consumer = cells[0]!.slice(1, -1), file = resolve(root, consumer);
    expect(existsSync(file)).toBe(true);
    expect(cells[2]).toMatch(/^[RDBPSGV](?:, [RDBPSGV])*; (?:CORE-249|UI track)/);
    const imports = [...readFileSync(file, "utf8").matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(match => resolve(dirname(file), match[1]!));
    for (const [, target] of cells[1]!.matchAll(/`([^`]+)`/g)) {
      const absolute = resolve(root, target!);
      if (!existsSync(absolute) || !imports.some(path => absolute === path || absolute === `${path}.ts`)) absent.push(`${consumer} -> ${target}`);
    }
  }
  expect(absent).toEqual([]);
  const projections = ledger.split("## The one projection")[1]!.split("## Slice 13d")[0]!.split(/\r?\n/).filter(line => line.startsWith("| `"));
  expect(projections).toHaveLength(6);
  for (const row of projections) { expect(row).toContain("CORE-249"); expect(row.split("|")[2]!.length).toBeGreaterThan(100); }
  console.log(JSON.stringify({ directConsumers: rows.length, projectionGroups: projections.length, criteria: "R/D/B/P/S/G/V", missingDependencies: absent }));
});
