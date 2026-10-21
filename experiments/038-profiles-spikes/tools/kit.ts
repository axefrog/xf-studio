/** Process plumbing shared by the spike's kill harnesses. */
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const HERE = join(import.meta.dir, "..");
export const BUN = process.execPath;

export type Child = { proc: Bun.Subprocess<"ignore", "pipe", "pipe">; lines: string[]; exited: Promise<number>; killed: boolean;
  wait(match: (line: string) => boolean, ms?: number): Promise<string | null> };

export function spawn(script: string, args: string[], kill?: string): Child {
  const proc = Bun.spawn([BUN, join(HERE, script), ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, XFS_KILL: kill ?? "" } });
  const lines: string[] = [];
  const watchers: { match(line: string): boolean; resolve(line: string | null): void }[] = [];
  const child: Child = { proc, lines, killed: false, exited: proc.exited,
    wait(match, ms = 15_000) {
      const found = lines.find(match);
      if (found) return Promise.resolve(found);
      return new Promise(resolve => {
        const watcher = { match, resolve };
        watchers.push(watcher);
        setTimeout(() => resolve(null), ms);
        proc.exited.then(() => setTimeout(() => resolve(lines.find(match) ?? null), 20));
      });
    } };
  (async () => {
    let rest = "";
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      rest += decoder.decode(chunk);
      const parts = rest.split("\n"); rest = parts.pop()!;
      for (const line of parts) { lines.push(line.trim()); for (const watcher of watchers) if (watcher.match(line.trim())) watcher.resolve(line.trim()); }
    }
  })();
  (async () => { const text = await new Response(proc.stderr).text(); if (text.trim() && !/SIGKILL/.test(text)) process.stderr.write(`[${script}] ${text.slice(0, 2000)}\n`); })();
  return child;
}

/** Starts the host on `library` and points `portFile` at it. */
export async function startHost(library: string, portFile: string, kill?: string, commitLog?: string, staticDir?: string): Promise<Child> {
  const host = spawn("harness/host-server.ts", [library, commitLog ?? "", ...(staticDir ? [staticDir] : [])], kill);
  const line = await host.wait(text => text.startsWith("port "));
  if (!line) throw Error("The host didn't start.");
  writeFileSync(portFile, line.slice(5));
  return host;
}

export const terminate = async (child: Child) => { if (child.proc.exitCode === null) { child.killed = true; child.proc.kill(); } await child.exited; };

export function integrity(library: string): string {
  const db = new Database(library);
  try { return (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check; } finally { db.close(); }
}

export function readDocs(library: string, kind: string): Map<string, { revision: number; value: any }> {
  const db = new Database(library);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    return new Map((db.query("SELECT id, revision, value FROM documents WHERE kind = ?").all(kind) as { id: string; revision: number; value: string }[])
      .map(row => [row.id, { revision: row.revision, value: JSON.parse(row.value) }]));
  } finally { db.close(); }
}

export const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)]; };
