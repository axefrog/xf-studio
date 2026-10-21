/**
 * Captures of the conflict and unprotected-changes states (style guide t-conflict and t-unprotected, phase 1 chunk 1c) in light and
 * dark, at a narrow and a wide window, from the built style guide (`bun tools/build-style-guide.ts` in the authoring project first).
 *   bun tools/conflict-captures.ts <out-dir>
 * The style guide's specimens use the Studio's own stylesheet and classes, and the Character panel builds the same elements.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "../../../projects/xf-studio/authoring/tools/cdp";

const out = process.argv[2];
if (!out) throw Error("Usage: bun tools/conflict-captures.ts <out-dir>");
mkdirSync(out, { recursive: true });
const guide = `file:///${resolve(import.meta.dir, "..", "..", "..", "projects", "xf-studio", "authoring", "public", "style-guide.html").replaceAll("\\", "/")}`;
const shots: string[] = [];
for (const [label, width] of [["narrow", 420], ["wide", 1440]] as const) {
  const page = await launch(`${guide}#t-conflict`, { width, height: 1000, scheme: "light" });
  try {
    await page.waitFor(`!!document.querySelector("#t-conflict .doc-conflict")`, 30_000);
    for (const scheme of ["light", "dark"] as const) {
      await page.colorScheme(scheme);
      await page.evaluate(`(() => { const root = document.documentElement; root.dataset.theme = ${JSON.stringify(scheme)}; root.style.colorScheme = ${JSON.stringify(scheme)}; })()`);
      await page.wait(300);
      for (const id of ["t-conflict", "t-unprotected"]) {
        await page.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "start" })`);
        await page.wait(300);
        const clip = await page.evaluate(`(() => { const r = document.querySelector("#${id} .specimen").getBoundingClientRect(); /* document coordinates: a capture's clip is */ return { x: Math.max(0, r.x) + scrollX, y: Math.max(0, r.y) + scrollY, width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`) as { x: number; y: number; width: number; height: number };
        const name = `${id.slice(2)}-${scheme}-${label}`;
        await page.screenshot(resolve(out, `${name}.png`), clip);
        shots.push(name);
      }
    }
  } finally { await page.close(); }
}
console.log(JSON.stringify({ out, shots }));
