// Filesystem adapter for the pre-pack archive gate (see archive-inventory.ts).
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { inventoryFromFiles, type GeneratedFile, type InventoryEntry, type InventoryPlan } from "./archive-inventory";

/** Hash every regular file below `root`; symlinks and junctions are refused, not followed. */
export function generatedFiles(root: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Generated archive tree contains a symlink: ${path}`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push({
        path: relative(root, path).split(sep).join("/"), bytes: stat.size,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    }
  };
  if (lstatSync(root).isSymbolicLink()) throw new Error(`Generated archive tree contains a symlink: ${root}`);
  walk(root);
  return files;
}

/** Return hashed generated files only if the physical tree equals the plan. */
export function archiveInventory(root: string, plan: InventoryPlan): InventoryEntry[] {
  return inventoryFromFiles(generatedFiles(root), plan);
}
