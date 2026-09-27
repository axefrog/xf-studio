/**
 * Captures of the Character panel's colour swatches, their swatch card and the contrast-enhanced marker, in an isolated `?verify=1`
 * workspace with a throwaway Chrome profile, against an authoring server already running on its own port (never 4317 or the person's
 * draft). For each scheme and panel width it captures:
 *
 * - Eyebrow Color with a mod's brow style chosen (the brow style row's first choice whose label matches `--style`), its maker group
 *   headed `--group`, and the swatch card on the choice labelled `--hover`;
 * - Eyebrow Color with the game's own style 01 (the base game's group);
 * - Hair Color and Eyelash color.
 *
 *   bun tools/colour-swatch-look.ts <out dir under evidence/screenshots> [port] [--style "Beautiful Eyebrows II"] [--group "Beautiful EYEBROWS"]
 *     [--hover "Purple blonde"] [--schemes light,dark] [--widths 340,620] [--tag after]
 *
 * The rows show installed mods' names and colours, so keep the outputs in the ignored evidence/screenshots tree. It changes the verify
 * workspace's brow style only (its own state), never the person's draft.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, type Session } from "./cdp";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const [outArg, portArg = "4391"] = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!outArg) throw Error("Usage: bun tools/colour-swatch-look.ts <out dir> [port] [--style …] [--group …] [--hover …] [--schemes light,dark] [--widths 340,620] [--tag …]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg, style = flag("style", "Beautiful Eyebrows II"), group = flag("group", "Beautiful EYEBROWS"), hover = flag("hover", "Purple blonde");
const schemes = flag("schemes", "light,dark").split(",") as ("light" | "dark")[], widths = flag("widths", "340,620").split(",").map(Number), tag = flag("tag", "after");

const rowOf = (label: string) => `[...document.querySelectorAll(".cc-row")].find(r => r.querySelector(".cc-row-label")?.textContent === ${JSON.stringify(label)} && !r.hidden)`;
async function open(page: Session, label: string) {
  await page.evaluate(`(() => { const r = ${rowOf(label)}; if (!r) return; const m = r.querySelector(".cc-row-main"); if (m.getAttribute("aria-expanded") !== "true") m.click(); })()`);
  await page.waitFor(`(() => { const r = ${rowOf(label)}; return !!r && r.querySelectorAll(".cc-choice").length > 0; })()`, 60000).catch(() => {});
}
async function close(page: Session, label: string) {
  await page.evaluate(`(() => { const r = ${rowOf(label)}; if (!r) return; const m = r.querySelector(".cc-row-main"); if (m.getAttribute("aria-expanded") === "true") m.click(); })()`);
}
/** Wait until a colour row's swatches have arrived (no waiting placeholders left). */
async function settle(page: Session, label: string) {
  await page.waitFor(`(() => { const r = ${rowOf(label)}; return !!r && r.querySelectorAll('.swatch[data-empty="waiting"]').length === 0 && r.querySelectorAll(".swatch-choice").length > 0; })()`, 120000).catch(() => {});
  await page.wait(800);
}
async function choose(page: Session, row: string, match: string) {
  await open(page, row);
  await page.evaluate(`(() => { const r = ${rowOf(row)}; const c = [...r.querySelectorAll(".cc-choice")].find(e => (e.getAttribute("aria-label") ?? "").includes(${JSON.stringify(match)})); c?.click(); })()`);
  await page.wait(1500);
  await close(page, row);
}
async function shoot(page: Session, file: string, selector: string, pad = 0, maxHeight = 1100) {
  const box = await page.evaluate(`(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: "start" });
    const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), width: Math.min(r.width + ${2 * pad}, innerWidth), height: Math.min(r.height + ${2 * pad}, ${maxHeight}, innerHeight - Math.max(0, r.y)) }; })()`);
  if (box) await page.screenshot(resolve(out, file), box);
  return !!box;
}

const report: Record<string, unknown>[] = [];
for (const scheme of schemes) for (const width of widths) {
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: width + 420, height: 1000, scheme, debugPort: port + 5000 + width % 97 });
  const name = (what: string) => `${tag}-${what}-${scheme}-${width}.png`;
  try {
    await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell", 120000);
    await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
    await page.waitFor(`[...document.querySelectorAll(".cc-row-label")].some(e => e.textContent === "Eyebrow Color")`, 240000);
    // The panel's width: its dock group set directly (the capture's only layout change).
    await page.evaluate(`(() => { const g = document.querySelector(".cc-panel")?.closest(".dock-group, .dock-column, section"); if (g) { g.style.width = "${width}px"; g.style.flex = "none"; } })()`);
    await page.wait(600);
    // A mod's brow style, then its colours.
    await choose(page, "Eyebrows", style);
    await open(page, "Eyebrow Color"); await settle(page, "Eyebrow Color");
    const groupHead = `[...${rowOf("Eyebrow Color")}.querySelectorAll(".cc-maker")].find(g => (g.textContent ?? "").includes(${JSON.stringify(group)}))`;
    const hasGroup = await shoot(page, name("brow-pack"), groupHead, 4, 900);
    await shoot(page, name("brow-pack-row-head"), `${rowOf("Eyebrow Color")}.querySelector(".cc-row-head")`, 2, 60);
    // The card on one of the group's swatches (pointer rest).
    const target = await page.evaluate(`(() => { const g = ${groupHead}; const c = g && [...g.querySelectorAll(".swatch-choice")].find(e => e.getAttribute("aria-label") === ${JSON.stringify(hover)});
      if (!c) return null; c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (target) {
      await page.mouse("mouseMoved", target.x, target.y);
      await page.wait(600);
      const clip = await page.evaluate(`(() => { const c = document.querySelector(".swatch-card:not([hidden])"); const g = ${groupHead}; if (!c || !g) return null;
        const a = c.getBoundingClientRect(), b = g.getBoundingClientRect(); const x = Math.max(0, Math.min(a.x, b.x) - 6), y = Math.max(0, Math.min(a.y, b.y) - 6);
        return { x, y, width: Math.min(innerWidth - x, Math.max(a.right, b.right) - x + 6), height: Math.min(innerHeight - y, Math.max(a.bottom, b.bottom) - y + 6) }; })()`);
      if (clip) await page.screenshot(resolve(out, name("brow-pack-card")), clip);
      await page.mouse("mouseMoved", 5, 5);
    }
    // The contrast marker's help tip (pointer rest), with the row header.
    const markAt = await page.evaluate(`(() => { const m = ${rowOf("Eyebrow Color")}.querySelector(".contrast-mark:not(.empty)"); if (!m) return null; m.scrollIntoView({ block: "center" });
      const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (markAt) {
      await page.wait(300);
      await page.mouse("mouseMoved", markAt.x, markAt.y);
      await page.wait(700);
      const clip = await page.evaluate(`(() => { const t = document.querySelector(".help-bubble:not([hidden])"); const h = ${rowOf("Eyebrow Color")}.querySelector(".cc-row-head"); if (!t || !h) return null;
        const a = t.getBoundingClientRect(), b = h.getBoundingClientRect(); const x = Math.max(0, Math.min(a.x, b.x) - 6), y = Math.max(0, Math.min(a.y, b.y) - 6);
        return { x, y, width: Math.min(innerWidth - x, Math.max(a.right, b.right) - x + 6), height: Math.min(innerHeight - y, Math.max(a.bottom, b.bottom) - y + 6) }; })()`);
      if (clip) await page.screenshot(resolve(out, name("brow-pack-mark-tip")), clip);
      await page.mouse("mouseMoved", 5, 5);
    }
    const packState = await page.evaluate(`(() => { const r = ${rowOf("Eyebrow Color")}; const g = ${groupHead};
      return { mark: !r.querySelector(".contrast-mark")?.classList.contains("empty"), swatches: g ? [...g.querySelectorAll(".swatch-choice .swatch")].map(s => getComputedStyle(s).backgroundColor).slice(0, 40) : [] }; })()`);
    await close(page, "Eyebrow Color");
    // The game's own brow style.
    await choose(page, "Eyebrows", "01");
    await open(page, "Eyebrow Color"); await settle(page, "Eyebrow Color");
    const gameGroup = `(${rowOf("Eyebrow Color")}.querySelector(".cc-maker") ?? ${rowOf("Eyebrow Color")})`;
    await shoot(page, name("brow-game"), gameGroup, 4, 700);
    await close(page, "Eyebrow Color");
    for (const [row, file] of [["Hair Color", "hair"], ["Eyelash color", "lash"]] as const) {
      await open(page, row); await settle(page, row);
      await shoot(page, name(file), rowOf(row), 0, 700);
      await close(page, row);
    }
    report.push({ scheme, width, hasGroup, card: !!target, ...packState });
  } finally { await page.close(); }
}
writeFileSync(resolve(out, `${tag}-run.json`), JSON.stringify({ date: new Date().toISOString(), port, style, group, hover, report }, null, 2));
console.log(`Wrote ${tag} captures to ${out}`);
