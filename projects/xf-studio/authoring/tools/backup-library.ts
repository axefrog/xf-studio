import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(process.env.XFAS_DATA_DIR ?? resolve(import.meta.dir, "../data"));
const destination = resolve(root, "backups", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(destination, { recursive: true });
for (const name of ["library.sqlite", "verification.sqlite"]) {
  const input = resolve(root, name); if (!(await Bun.file(input).exists())) continue;
  const db = new Database(input, { readonly: true });
  try { db.query("VACUUM INTO ?").run(resolve(destination, name)); }
  finally { db.close(); }
  const copy = new Database(resolve(destination, name), { readonly: true });
  try {
    if (JSON.stringify(copy.query("PRAGMA integrity_check").all()) !== JSON.stringify([{ integrity_check: "ok" }]))
      throw Error(`Backup integrity check failed for ${name}`);
  } finally { copy.close(); }
}
console.log(`Consistent SQLite backups verified at ${destination}`);
