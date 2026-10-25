import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installLightDom, uninstallLightDom, lightDocument, lightEvent, type LightElement } from "./light-dom";
import { Callout } from "../src/studio-ui/guidance/overlay";
import { helpMarkup } from "../src/studio-ui/guidance/render";

test("shared callouts focus the title without a pointer ring, preserve keyboard focus and open Help references", () => {
  installLightDom();
  try {
    const opened: string[] = [];
    const callout = new Callout({ className: "guidance-tour", closeLabel: "Skip tour", onClose() {}, openTopic: id => opened.push(id) });
    lightDocument.body.append(callout.element as unknown as LightElement);
    callout.update({ eyebrow: "Getting started", title: "Looks are made of layers", body: "If the row isn't there: [[help:install|Installing your mod]] in Help.", actions: [] });
    const search = lightDocument.createElement("input"); lightDocument.body.append(search); search.focus();
    lightDocument.dispatchEvent(lightEvent("pointerdown")); callout.focusTitle();
    expect(lightDocument.activeElement).toBe(callout.title as never);
    expect(callout.title.hasAttribute("data-pointer-focus")).toBe(true);
    expect(callout.title.getAttribute("tabindex")).toBe("-1");
    expect(callout.element.getAttribute("aria-labelledby")).toBe(callout.title.id);
    lightDocument.dispatchEvent(lightEvent("keydown", { key: "Enter" })); callout.focusTitle();
    expect(callout.title.hasAttribute("data-pointer-focus")).toBe(false);
    lightDocument.dispatchEvent(lightEvent("pointerdown")); callout.focusTitle();
    (callout.title as unknown as LightElement).dispatchEvent(lightEvent("keydown", { key: "Tab" }));
    expect(callout.title.hasAttribute("data-pointer-focus")).toBe(false);
    const link = callout.element.querySelector<HTMLButtonElement>(".link-button")!;
    expect(link.textContent).toBe("Installing your mod"); link.click();
    expect(opened).toEqual(["install"]);
    link.setAttribute("aria-disabled", "true"); link.click();
    expect(opened).toEqual(["install"]);
    const css = readFileSync(new URL("../public/studio.css", import.meta.url), "utf8");
    expect(css).toContain('.guidance-title:focus-visible { outline: 2px solid var(--focus)');
    expect(css).toContain('.guidance-title[data-pointer-focus]:focus { outline: none; }');
    expect(helpMarkup("[[help:install|<Installing & more>]]")).toContain("&lt;Installing &amp; more&gt;</button>");
  } finally { uninstallLightDom(); }
});
