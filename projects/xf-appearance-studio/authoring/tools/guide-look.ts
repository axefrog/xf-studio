/** Screenshot sections of the self-contained guide from file:// : bun tools/guide-look.ts [scheme] [ids...] */
import { resolve } from "node:path";
import { launch } from "./cdp";
const [scheme = "dark", ...ids] = process.argv.slice(2);
const url = "file:///" + resolve(import.meta.dir, "../public/style-guide.html").replaceAll("\\", "/");
const page = await launch(url, { width: 1440, height: 1000, scheme: scheme as "dark" | "light", debugPort: 9344 });
try {
  await page.waitFor("document.querySelector('#live-dock .dock')", 20000);
  for (const id of ids.length ? ids : ["top"]) {
    if (id === "compare") { await page.evaluate(`document.getElementById('compare-themes').click()`); await page.wait(300); continue; }
    if (id !== "top") await page.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' }); window.scrollBy(0, -64)`);
    await page.wait(250);
    await page.screenshot(`evidence/screenshots/guide-${scheme}-${id}.png`);
  }
  console.log(JSON.stringify(page.console.filter(e => e.type !== "log:verbose"), null, 1));
} finally { await page.close(); }
