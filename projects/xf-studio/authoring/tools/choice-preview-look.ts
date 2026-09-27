/**
 * Captures of the Character panel's hairstyle pictures (choice previews phase 1) in an isolated `?verify=1` workspace with a throwaway
 * Chrome profile, against an authoring server already running on its own port (never 4317 or the person's draft), beside the style
 * guide's reference specimen. For each scheme and panel width: the Hairstyle row at size M once its pictures have settled (and S and L at
 * the first width), and the style guide's Choice preview and Preview tokens entries.
 *
 *   bun tools/choice-preview-look.ts <out dir under evidence/screenshots> [port] [--schemes light,dark] [--widths 300,480] [--tag after]
 *
 * The rows show installed mods' hairstyles, so keep the outputs in the ignored evidence/screenshots tree. It changes the verify workspace's
 * picture size preference (its own state), never the person's draft.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, type Session } from "./cdp";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const [outArg, portArg = "4391"] = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!outArg) throw Error("Usage: bun tools/choice-preview-look.ts <out dir> [port] [--schemes light,dark] [--widths 300,480] [--tag after]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg, schemes = flag("schemes", "light,dark").split(",") as ("light" | "dark")[], widths = flag("widths", "300,480").split(",").map(Number);
const tag = flag("tag", "after");
const ROW = `[...document.querySelectorAll(".cc-row")].find(r => r.querySelector(".cc-row-label")?.textContent === "Hairstyle" && !r.hidden)`;

async function shoot(page: Session, file: string, selector: string, pad = 0, maxHeight = 900) {
  const box = await page.evaluate(`(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: "start" });
    const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), width: Math.min(r.width + ${2 * pad}, innerWidth), height: Math.min(r.height + ${2 * pad}, ${maxHeight}, innerHeight - Math.max(0, r.y)) }; })()`);
  if (box) await page.screenshot(resolve(out, file), box);
  return !!box;
}
async function size(page: Session, value: "s" | "m" | "l") {
  await page.evaluate(`(() => { const b = [...${ROW}.querySelectorAll(".cc-choice-tools .segment")].find(e => e.textContent.trim() === ${JSON.stringify(value.toUpperCase())}); b?.click(); })()`);
  await page.wait(700);
}

const report: Record<string, unknown>[] = [];
for (const scheme of schemes) for (const width of args.includes("--guide-only") ? [] : widths) {
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: width + 420, height: 1000, scheme, debugPort: port + 5100 + width % 97 });
  const name = (what: string) => `${tag}-${what}-${scheme}-${width}.png`;
  try {
    await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 120000);
    await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
    await page.waitFor(`!!(${ROW})`, 240000);
    await page.evaluate(`(() => { const g = document.querySelector(".cc-panel")?.closest(".dock-group, .dock-column, section"); if (g) { g.style.width = "${width}px"; g.style.flex = "none"; } })()`);
    await page.wait(600);
    await page.evaluate(`(() => { const m = ${ROW}.querySelector(".cc-row-main"); if (m.getAttribute("aria-expanded") !== "true") m.click(); })()`);
    await page.waitFor(`${ROW}.querySelectorAll(".pv-tile").length > 0`, 60000);
    await size(page, "m");
    // Settled: no tile waiting in the first screenful, or two minutes.
    await page.waitFor(`(() => { const r = ${ROW}; const tiles = [...r.querySelectorAll(".pv-tile")].slice(0, 24); return tiles.length > 0 && tiles.every(t => t.dataset.state !== "waiting"); })()`, 120000).catch(() => {});
    await page.wait(800);
    await shoot(page, name("hairstyle-m"), ROW, 2);
    if (width === widths[0]) for (const value of ["s", "l"] as const) { await size(page, value); await shoot(page, name(`hairstyle-${value}`), ROW, 2); }
    await size(page, "m");
    const state = await page.evaluate(`(() => { const tiles = [...${ROW}.querySelectorAll(".pv-tile")]; const count = s => tiles.filter(t => t.dataset.state === s).length;
      return { tiles: tiles.length, ready: count("ready"), waiting: count("waiting"), none: count("none"), size: ${ROW}.querySelector(".choices")?.dataset.size }; })()`);
    report.push({ scheme, width, ...state as object });
  } finally { await page.close(); }
}
// The reference patterns, light and dark side by side (the guide's comparison mode), in each page scheme.
for (const scheme of schemes) {
  const page = await launch(`http://127.0.0.1:${port}/style-guide.html`, { width: 1440, height: 1000, scheme, debugPort: port + 5300 });
  try {
    await page.waitFor("document.querySelector('#live-dock .dock')", 30000);
    await page.evaluate(`document.getElementById('compare-themes').click()`);
    await page.wait(500);
    for (const id of ["lib-choice-preview", "f-preview-tokens"]) {
      await page.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' }); window.scrollBy(0, -64)`);
      await page.wait(400);
      await page.screenshot(resolve(out, `${tag}-guide-${id}-${scheme}.png`));
    }
  } finally { await page.close(); }
}
writeFileSync(resolve(out, `${tag}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
