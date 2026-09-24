/** Asset-free visual check of the desktop first-run flow through its real loopback host. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { launch } from "../../tools/cdp";
import { createDesktopServer } from "../server";

const directory = mkdtempSync(resolve(tmpdir(), "xfs-desktop-first-run-"));
const screenshots = resolve(import.meta.dir, "../../evidence/screenshots");
const game = resolve(directory, "sample-game");
mkdirSync(resolve(game, "bin", "x64"), { recursive: true });
mkdirSync(resolve(game, "archive", "pc"), { recursive: true });
writeFileSync(resolve(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
const server = createDesktopServer(resolve(import.meta.dir, "../static"), resolve(directory, "user-data"),
  { version: "0.1.0", channel: "dev", buildHash: "fixture", metadataStatus: "ready" });
let browser: Awaited<ReturnType<typeof launch>> | undefined;
try {
  browser = await launch(server.url, { width: 900, height: 650, debugPort: 9438, scheme: "dark" });
  await browser.waitFor("document.querySelector('#desktop-setup-open-inline')");
  await browser.screenshot(resolve(screenshots, "desktop-first-run.png"));
  await browser.evaluate("document.querySelector('#desktop-setup-open-inline').click()");
  await browser.waitFor("document.querySelector('#desktop-setup').open && document.querySelector('#desktop-setup-status').textContent.includes('Cyberpunk')");
  await browser.screenshot(resolve(screenshots, "desktop-local-setup.png"));
  await browser.evaluate(`document.querySelector('input[name="gameRoot"]').value = ${JSON.stringify(game)};
    document.querySelector('#desktop-setup-save').click()`);
  await browser.waitFor("document.querySelector('#desktop-setup-status').textContent.includes('presence checks')");
  const state = await browser.evaluate(`({
    intro: document.querySelector('.boot')?.textContent,
    setup: document.querySelector('#desktop-setup-status')?.textContent,
    game: document.querySelector('input[name="gameRoot"]')?.value,
    errors: document.querySelectorAll('.boot-error').length
  })`);
  if (state.game !== game || state.errors || !state.setup.includes("Mod export checks and builds are unavailable"))
    throw Error("Desktop first-run setup did not render and persist accurately.");
  await browser.screenshot(resolve(screenshots, "desktop-local-setup-saved.png"));
  await browser.viewport(390, 700);
  await browser.screenshot(resolve(screenshots, "desktop-local-setup-narrow.png"));
  await browser.colorScheme("light");
  await browser.screenshot(resolve(screenshots, "desktop-local-setup-light.png"));
  if (browser.console.some(entry => entry.type === "exception")) throw Error("Desktop first run raised a browser exception.");
  console.log("Desktop first-run browser review passed; screenshots are in the ignored evidence directory.");
} finally {
  await browser?.close();
  server.stop();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected temporary review directory.");
  rmSync(directory, { recursive: true, force: true });
}
