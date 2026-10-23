/**
 * The browser's storage commit window (profiles design §2.3, phase 1f): how much of what a page wrote to `localStorage` is lost when the
 * whole browser process tree is killed, against a renderer crash. A real headless Chrome (no window, so nothing takes focus) runs a page
 * that writes one `localStorage` key every 50 ms, about 100 KB like an outbox key, and reports each write to this process right after
 * `setItem` returns. The harness kills the tree (`taskkill /T /F` on the browser's own PID) after a varied time, starts the browser again
 * on the same profile and reads which write survived.
 *   bun tools/storage-tree-kill.ts <scratch-dir> [tree-kills=8] [renderer-kills=2]   (about 4 minutes)
 *
 * Window = the time between the last write reported before the kill and the write that survived (the page's writes the browser had
 * accepted but not yet committed to disk; when none of this launch's survived, from its first write). Renderer kills end only the page
 * renderers (Chrome's storage service is its own process and lives on); 12 s later the browser's tree is killed, so what survives is what the browser committed after its renderer died.
 * Only processes this run starts are stopped, by PID.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [scratch, treeArg, rendererArg] = process.argv.slice(2);
if (!scratch) throw Error("Usage: bun tools/storage-tree-kill.ts <scratch-dir> [tree-kills] [renderer-kills]");
const profile = join(scratch, "chrome-profile");
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });

const page = `<!doctype html><meta charset="utf-8"><title>Storage kill</title><script>
const pad = "x".repeat(100000), key = "xfs.outbox.kill-test";
const held = localStorage.getItem(key), survived = held ? JSON.parse(held).seq : 0;
fetch("/read?seq=" + survived, { method: "POST" }).then(() => {
  let seq = survived;
  setInterval(() => { seq++; localStorage.setItem(key, JSON.stringify({ seq, pad })); fetch("/w?seq=" + seq + "&at=" + Date.now(), { method: "POST", keepalive: true }); }, 50);
});
</script>`;
/** One browser launch: the write that survived from the launch before, and when (the page's clock) each of its own writes was made. */
type Launch = { read?: number; reads: (seq: number) => void; writes: Map<number, number> };
let current: Launch | null = null;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const url = new URL(request.url), seq = Number(url.searchParams.get("seq"));
  if (url.pathname === "/") return new Response(page, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  if (url.pathname === "/read" && current) { current.read = seq; current.reads(seq); }
  if (url.pathname === "/w" && current) current.writes.set(seq, Number(url.searchParams.get("at")));
  return new Response("ok");
} });

const run = (args: string[]) => Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", windowsHide: true });
function start(): { proc: Bun.Subprocess; launch: Launch; ready: Promise<number> } {
  let reads!: (seq: number) => void;
  const ready = new Promise<number>(resolve => { reads = resolve; });
  const launch: Launch = { reads, writes: new Map() };
  current = launch;
  const proc = Bun.spawn([CHROME, "--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--disable-background-networking", "--disable-component-update", `http://127.0.0.1:${server.port}/`], { stdout: "ignore", stderr: "ignore", windowsHide: true });
  return { proc, launch, ready };
}
/** This browser's page renderers (its spare renderer too; not its own UI's or extensions'): children whose command line says so. */
function renderersOf(browser: number): number[] {
  const listed = run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${browser}" | Where-Object { $_.CommandLine -like '*--type=renderer*' -and $_.CommandLine -notlike '*--extension-process*' -and $_.CommandLine -notlike '*--top-chrome-webui*' } | ForEach-Object { $_.ProcessId }`]);
  return listed.stdout.toString().trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
}
const treeKill = (pid: number) => run(["taskkill", "/PID", String(pid), "/T", "/F"]);

const results: { kind: string; ranMs: number; lastReported: number; survived: number; lostWrites: number; windowMs: number }[] = [];
/** How long each launch writes before its kill: short runs, then long ones that meet Chrome's commit rate limits. */
const TREE_MS = [800, 2_600, 4_300, 6_100, 9_200, 13_500, 40_000, 75_000];
const plan = [...TREE_MS.slice(0, Number(treeArg ?? TREE_MS.length)).map(ms => ({ kind: "tree", ms })),
  ...Array.from({ length: Number(rendererArg ?? 2) }, (_, i) => ({ kind: "renderer", ms: 1_500 + i * 1_100 }))];
// A first launch so every kill starts from a committed value.
let first = start();
await first.ready;
await Bun.sleep(1_000);
treeKill(first.proc.pid); await first.proc.exited; await Bun.sleep(500);
let pending = start();
for (const step of plan) {
  await pending.ready;
  await Bun.sleep(step.ms);
  const launch = pending.launch;
  if (step.kind === "tree") { treeKill(pending.proc.pid); await pending.proc.exited; }
  else {
    const renderers = renderersOf(pending.proc.pid);
    if (!renderers.length) throw Error("The page's renderer process wasn't found.");
    for (const renderer of renderers) run(["taskkill", "/PID", String(renderer), "/F"]);
    // The browser outlives its renderer; once it has had time to commit, the whole tree is killed (headless Chrome has no window to close).
    await Bun.sleep(12_000);
    treeKill(pending.proc.pid); await pending.proc.exited;
  }
  const lastReported = Math.max(0, ...launch.writes.keys()), firstWrite = Math.min(...launch.writes.values());
  await Bun.sleep(500);
  pending = start();
  const survived = await pending.ready;
  // None of this launch's writes survived: everything it wrote since its first write (one interval before it) was lost.
  const windowMs = survived >= lastReported ? 0 : launch.writes.get(lastReported)! - (launch.writes.get(survived) ?? firstWrite - 50);
  results.push({ kind: step.kind, ranMs: step.ms, lastReported, survived, lostWrites: Math.max(0, lastReported - survived), windowMs: Math.round(windowMs) });
}
treeKill(pending.proc.pid); await pending.proc.exited;
server.stop(true);
const tree = results.filter(result => result.kind === "tree");
console.log(JSON.stringify({ browser: CHROME.split("/").at(-1), results,
  treeWindowMs: { max: Math.max(...tree.map(result => result.windowMs)), min: Math.min(...tree.map(result => result.windowMs)) } }, null, 1));
rmSync(profile, { recursive: true, force: true });
process.exit(0);
