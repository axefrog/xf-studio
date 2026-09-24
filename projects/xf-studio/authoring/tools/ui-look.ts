/** Exploratory screenshot helper: bun tools/ui-look.ts [width] [height] [scheme] [out] */
import { launch, startServer } from "./cdp";
const [width = "1600", height = "1000", scheme = "dark", out = "evidence/screenshots/look.png"] = process.argv.slice(2);
const port = 4391;
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: +width, height: +height, scheme: scheme as "dark" | "light", debugPort: 9341 });
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 90000).catch(e => console.log("wait:", e.message));
  await page.wait(2500);
  await page.screenshot(out);
  console.log(JSON.stringify(page.console.slice(0, 30), null, 1));
} finally { await page.close(); server.kill(); }
