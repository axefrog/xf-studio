/**
 * Host adapter: the identity of the host code running now, for answers kept across restarts (installation-snapshot.ts, prepared-answers.ts).
 * An answer the host derived is reused after a restart only when the code that derived it is the same: another version of XF Studio (or,
 * on localhost, any edited source or data file) derives again instead of serving what an earlier version worked out.
 *
 * Running from source (localhost), it is every `.ts` and `.json` file's name, size and modification time under the source folder (the
 * resource reader's type tables and the eye plate's recipe are JSON beside the code; PIPE-129); running bundled (the desktop app), the
 * bundle file's, and every other file the host runs code from (`includeHostCode`: the decode worker's bundle). Both with the Bun version.
 * One walk per process (a few hundred `stat` calls, a few milliseconds); a walk that fails is not remembered, so the next ask walks again
 * (PIPE-128).
 */
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `read`, memoised once it succeeds: a read that fails is forgotten, so the next ask reads again (PIPE-128: a rejected read kept for the
 * process made every installation open fail until a restart). `forget` drops what was read.
 */
export function memoisedRead(read: () => Promise<string>): { get(): Promise<string>; forget(): void } {
  let memo: Promise<string> | null = null;
  return {
    get() {
      if (memo) return memo;
      const reading = read();
      memo = reading;
      reading.catch(() => { if (memo === reading) memo = null; });
      return reading;
    },
    forget() { memo = null; },
  };
}

const extra = new Set<string>();
const running = memoisedRead(() => codeIdentityOf(fileURLToPath(import.meta.url), [...extra]));

/** The running host code's identity (memoised for the process once it was read). */
export function hostCodeIdentity(): Promise<string> { return running.get(); }

/**
 * Count another file the host runs code from in its identity (a packaged host's decode worker bundle, which is built separately from the
 * main bundle). Forgets an identity already read, so it is read again with the file.
 */
export function includeHostCode(file: string): void {
  const path = resolve(file);
  if (extra.has(path)) return;
  extra.add(path);
  running.forget();
}

/** Source-folder files that are part of the code: the modules and the data they load (JSON). */
const CODE_FILE = /\.(?:ts|json)$/;

/**
 * The identity of the code `module` belongs to: its source folder's `.ts` and `.json` files when it is a source file, else the file itself;
 * with each of `others` (its size and time; one that is missing counts as missing).
 */
export async function codeIdentityOf(module: string, others: readonly string[] = []): Promise<string> {
  const hash = createHash("sha256").update(`bun ${typeof Bun === "undefined" ? "-" : Bun.version}\n`);
  for (const other of [...others].sort()) {
    let line: string;
    try { const info = await stat(other); line = `${info.size}|${info.mtimeMs}`; } catch { line = "missing"; }
    hash.update(`also|${basename(other)}|${line}\n`);
  }
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
      if (!CODE_FILE.test(entry.name)) return;
      const info = await stat(path);
      lines.push(`${relative(root, path).replaceAll("\\", "/")}|${info.size}|${info.mtimeMs}`);
    }));
  };
  await walk(root);
  hash.update(lines.sort().join("\n"));
  return hash.digest("hex").slice(0, 32);
}
