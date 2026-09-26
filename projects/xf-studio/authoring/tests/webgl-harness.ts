import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "../tools/cdp";

/** The Chrome the real-GPU probes run in (tests/webgl-*.test.ts). Public CI has none and skips. */
export const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const chromeInstalled = () => existsSync(CHROME);

/**
 * Bundle a probe page, serve it on a loopback port, open it in headless Chrome (a real WebGL 2 context), wait for `window.probe`
 * and return it. `query` is appended to the page URL (the page reads it, for example to hide extensions).
 */
export async function runProbePage<T>(entry: string, query = "", timeout = 60_000): Promise<T> {
  const out = mkdtempSync(join(tmpdir(), "xfs-webgl-probe-"));
  let server: ReturnType<typeof Bun.serve> | undefined, page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const build = await Bun.build({ entrypoints: [entry], outdir: out, target: "browser", naming: "probe.js" });
    if (!build.success) throw Error(build.logs.map(String).join("\n"));
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new URL(request.url).pathname === "/probe.js"
      ? new Response(Bun.file(join(out, "probe.js")), { headers: { "content-type": "text/javascript" } })
      : new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/probe.js"></script>`, { headers: { "content-type": "text/html" } }) });
    // Chrome picks its own debugging port and a slow start is waited for and retried (tools/cdp.ts `launch`).
    page = await launch(`http://127.0.0.1:${server.port}/${query}`, { width: 200, height: 200 });
    try { await page.waitFor("window.probe", timeout); }
    catch (error) { throw Error([(error as Error).message, ...page.console.map(line => `${line.type}: ${line.text}`)].join("\n")); }
    return await page.evaluate("window.probe") as T;
  } finally {
    await page?.close(); server?.stop(true); rmSync(out, { recursive: true, force: true });
  }
}
