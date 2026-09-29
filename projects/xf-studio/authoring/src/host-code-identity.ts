/**
 * Host adapter: the identity of the host code running now, for answers kept across restarts (installation-snapshot.ts, prepared-answers.ts).
 * An answer the host derived is reused after a restart only when the code that derived it is the same: another version of XF Studio (or,
 * on localhost, any edited source file) derives again instead of serving what an earlier version worked out.
 *
 * Running from source (localhost), it is every `.ts` file's name, size and modification time under the source folder; running bundled (the
 * desktop app), the bundle file's. Both with the Bun version. One walk per process (a few hundred `stat` calls, a few milliseconds).
 */
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

let memo: Promise<string> | null = null;

/** The running host code's identity (memoised for the process). */
export function hostCodeIdentity(): Promise<string> { return memo ??= codeIdentityOf(fileURLToPath(import.meta.url)); }

/** The identity of the code `module` belongs to: its source folder's `.ts` files when it is a source file, else the file itself. */
export async function codeIdentityOf(module: string): Promise<string> {
  const hash = createHash("sha256").update(`bun ${typeof Bun === "undefined" ? "-" : Bun.version}\n`);
  if (!module.endsWith(".ts")) {
    const info = await stat(module);
    hash.update(`bundle|${info.size}|${info.mtimeMs}`);
    return hash.digest("hex").slice(0, 32);
  }
  const root = dirname(module), lines: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") await walk(path); return; }
      if (!entry.name.endsWith(".ts")) return;
      const info = await stat(path);
      lines.push(`${relative(root, path).replaceAll("\\", "/")}|${info.size}|${info.mtimeMs}`);
    }));
  };
  await walk(root);
  hash.update(lines.sort().join("\n"));
  return hash.digest("hex").slice(0, 32);
}
