import { expect } from "bun:test";
import type { launch } from "../../tools/cdp";
import { assertStartupPaint, type StartupPaintLayout } from "./startup-paint";
export async function verifyShellPaint(page: Awaited<ReturnType<typeof launch>>): Promise<void> {
  const settle = () => page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const capture = async () => Buffer.from((await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64");
  const hide = () => page.evaluate(`(() => {
    const style = document.createElement("style"); style.id = "startup-paint-hidden";
    style.textContent = "#studio.studio-ready { opacity: 0 !important; transition: none !important; }";
    document.head.append(style);
  })()`);
  const restore = () => page.evaluate(`document.getElementById("startup-paint-hidden").remove()`);

  // Capture the real page background without changing layout or retaining the boot message.
  await hide();
  let background: Buffer;
  try { await settle(); background = await capture(); } finally { await restore(); }
  await settle();
  const layout = await page.evaluate(`(() => {
    const shown = element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) <= .05) return false;
      }
      return true;
    };
    const measure = (selector, control = false) => {
      const nodes = [...document.querySelectorAll(selector)];
      const visible = node => {
        if (!shown(node)) return false;
        if (!control) return true;
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
        return !!hit && node.contains(hit);
      };
      const node = nodes.find(visible);
      if (!node) return { x: 0, y: 0, width: 0, height: 0, visible: false };
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height, visible: true };
    };
    return { width: innerWidth, height: innerHeight,
      regions: { header: measure("#studio .shell-header"), workspace: measure("#layout-dock"), status: measure("#studio .status-bar") },
      controls: { commands: measure("#studio button.header-commands", true), newTab: measure("#studio .layout-tabs > button", true), panelMenu: measure("#layout-dock button.dock-menu-btn", true) } };
  })()`) as StartupPaintLayout;
  assertStartupPaint(await capture(), background, layout);

  // Negative control: an independently captured transparent mounted shell must fail the same pixel gate,
  // even with the original, still-populated DOM/geometry/visible-control observations.
  await hide();
  try {
    await settle();
    const transparent = await capture();
    expect(() => assertStartupPaint(transparent, background, layout)).toThrow("insufficient non-background pixels");
  } finally { await restore(); }
  await settle();
}
