/** Coordinator-only: bun tools/polish5-look.ts <output-folder-on-C> [port=4565]. Never uses the person's server or draft. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "./cdp";

const [output, portText] = process.argv.slice(2), port = Number(portText ?? 4565);
if (!output) throw Error("Usage: bun tools/polish5-look.ts <output-folder-on-C> [port=4565]");
if (!Number.isInteger(port) || port < 1024 || port > 60000 || [port, port + 1000, port + 1001].some(p => [4317, 4331].includes(p)))
  throw Error("Choose a dedicated capture port.");
const out = resolve(output), root = resolve(import.meta.dir, "..");
if (process.platform === "win32" && !/^C:[\\/]/i.test(out)) throw Error("Keep capture work on C.");
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "polish5-data-")), origin = `http://127.0.0.1:${port}`;
const server = Bun.spawn([process.execPath, "server.ts"], { cwd: root, windowsHide: true, stdout: "ignore", stderr: "inherit",
  env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data, XFS_SETTINGS_DIR: data, XFS_MOD_INSTALL: "off" } });
let app: Session | undefined, guide: Session | undefined;
const rows: { label: string; app: string; guide: string }[] = [];
try {
  let ready = false;
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw Error("Capture server exited before readiness.");
    try { if ((await fetch(`${origin}/health`)).ok) { ready = true; break; } } catch { /* Starting. */ }
    await Bun.sleep(250);
  }
  if (!ready) throw Error("Capture server did not become ready.");
  app = await launch(`${origin}/?verify=1`, { width: 1200, height: 900, debugPort: port + 1000, scheme: "light" });
  guide = await launch(`${origin}/style-guide.html`, { width: 1200, height: 900, debugPort: port + 1001, scheme: "light" });
  await app.waitFor("!!window.xfStudioPolish5 && !!window.xfStudioPresentation.library.summary().draft && !window.xfStudioPresentation.library.summary().busy", 120_000);
  await guide.waitFor("!!document.getElementById('c-progress')");
  for (const width of [300, 620]) {
    await app.evaluate(`window.xfStudioShell.dock.moveTo('package', {kind:'float',x:24,y:24,w:${width},h:680}, 'Capture Build Stop')`);
    for (const state of ["running", "stopped"] as const) {
      await app.evaluate(`window.xfStudioPolish5.${state}()`);
      await app.waitFor(state === "running" ? "window.xfStudioPresentation.files.activity().some(e => e.kind === 'package.build' && e.cancellable)"
        : "window.xfStudioPresentation.files.snapshot().last?.code === 'package_build_cancelled'");
      await app.wait(400);
      for (const theme of ["light", "dark"] as const) {
        await app.colorScheme(theme); await guide.colorScheme(theme);
        await app.evaluate(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.colorScheme='${theme}'`);
        await guide.evaluate(`document.querySelector('[data-theme-choice="${theme}"]')?.click();document.getElementById('c-progress').scrollIntoView({block:'start'})`);
        await app.wait(200); await guide.wait(200);
        const actual = `${state}-${theme}-${width}.png`, pattern = `guide-${state}-${theme}-${width}.png`;
        await app.screenshot(join(out, actual)); await guide.screenshot(join(out, pattern));
        rows.push({ label: `${state} · ${theme} · ${width}px panel`, app: actual, guide: pattern });
      }
    }
  }
} finally {
  const errors = app?.console.filter(entry => entry.type === "error" || entry.type === "exception") ?? [];
  await app?.close(); await guide?.close(); server.kill(); await server.exited;
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  writeFileSync(join(out, "console.json"), JSON.stringify(errors, null, 2));
  writeFileSync(join(out, "review.html"), `<!doctype html><meta charset="utf-8"><title>Polish 5 review</title><style>body{font:14px system-ui;margin:24px}section{margin-bottom:32px}div{display:flex;gap:16px}figure{margin:0;width:50%}img{width:100%;border:1px solid #888}</style><h1>Build Stop · app and guide</h1>${rows.map(row => `<section><h2>${row.label}</h2><div><figure><figcaption>App</figcaption><a href="${row.app}"><img src="${row.app}"></a></figure><figure><figcaption>Guide</figcaption><a href="${row.guide}"><img src="${row.guide}"></a></figure></div></section>`).join("")}`);
}
