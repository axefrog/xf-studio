/**
 * The Presets panel's conflict notices (style guide t-conflict): one per conflict on the collection or a preset, under the collection's
 * name, with the three ways out (Keep both only where a copy can be made), each sending the typed request with its conflict and choice.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

// The confirm popover places itself in the window (the light DOM has none: give it one here).
const globals = globalThis as { window?: unknown };
const had = globals.window;
beforeAll(() => { installLightDom(); globals.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {} }; });
afterAll(() => { uninstallLightDom(); if (had === undefined) delete globals.window; else globals.window = had; });
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("conflict notices show what differs; Keep mine and Use theirs ask first, naming what goes; Keep both acts at once; they go once resolved", async () => {
  const { presetsPanel } = await import("../src/studio-ui/panels/collection");
  const requests: unknown[] = [];
  let conflicts = [
    { id: "c1", message: "You changed the preset “Smoky” here too (its makeup). Which version should it keep?", keepBoth: true, subject: "the preset “Smoky”" },
    { id: "c2", message: "You changed the collection “Night” here too (its name). Which version should it keep?", keepBoth: false, subject: "the collection “Night”" },
  ];
  const draft = () => ({ id: "col", name: "Night", presets: [{ id: "a", name: "Smoky", revision: 1, layers: 2 }], removed: [], recovery: [], conflicts });
  const port = {
    library: { capability: () => ({ available: true }), summary: () => ({ busy: false, summaries: [], draft: draft() }) },
    files: { capability: () => ({ available: true }) },
    authoring: { requestCapability: (request: { keep: string }) => request.keep === "both" ? { available: false, reason: "No copy." } : { available: true },
      contextQuery: () => ({ context: { hit: { kind: "collection" } }, options: [] }) },
  };
  const rt = { port, anchors: { register() {} }, dispatch: () => true, request: async (request: unknown) => { requests.push(request); },
    feedback: { announce() {}, toast() {} }, toolFilter: () => ({}), editor: { recipe: () => ({ layers: [] }) } };
  const panel = presetsPanel(rt as never);
  const frame = () => ({ library: port.library.summary() }) as never;
  panel.update(frame());
  const root = panel.spec.element as unknown as LightElement;
  const notices = root.querySelectorAll(".doc-conflict").filter(notice => !notice.hidden);
  expect(notices.map(notice => notice.querySelector(".doc-conflict-text")!.textContent)).toEqual(conflicts.map(item => `Changed in another window. ${item.message}`));
  const buttons = (notice: LightElement) => notice.querySelectorAll("button").filter(control => !control.hidden).map(control => control.textContent);
  // "Use other window's", never "Use theirs" (UI review item 12): the other version is another window's, not another person's.
  expect(buttons(notices[0]!)).toEqual(["Keep mine", "Use other window's", "Keep both"]);
  // A collection's name or list can't be kept as a copy: only the first two show.
  expect(buttons(notices[1]!)).toEqual(["Keep mine", "Use other window's"]);
  const popover = () => lightDocument.body.querySelector(".confirm-popover");
  // Use other window's discards this window's changes: it asks first, in place, naming the preset and what goes, with focus on Cancel.
  notices[0]!.querySelectorAll("button")[1]!.click();
  await settle();
  expect(requests).toEqual([]);
  expect(popover()!.querySelector(".popover-message")!.textContent).toBe("Use the other window's version of the preset “Smoky”? Your changes to it here are discarded.");
  expect(lightDocument.activeElement!.textContent).toBe("Cancel");
  // Cancel discards nothing.
  lightDocument.activeElement!.click();
  expect(popover()).toBeNull();
  expect(requests).toEqual([]);
  notices[0]!.querySelectorAll("button")[1]!.click();
  popover()!.dispatchEvent(lightEvent("submit"));
  // Keep mine overwrites the other window's version, which the library keeps no copy of: it asks too.
  notices[1]!.querySelectorAll("button")[0]!.click();
  expect(popover()!.querySelector(".popover-message")!.textContent).toBe("Keep this window's version of the collection “Night”? The other window's changes to it are discarded.");
  popover()!.dispatchEvent(lightEvent("submit"));
  expect(requests).toEqual([{ kind: "resolveConflict", conflict: "c1", keep: "theirs" }, { kind: "resolveConflict", conflict: "c2", keep: "mine" }]);
  // An unavailable way out (Keep both here) neither asks nor sends.
  notices[0]!.querySelectorAll("button")[2]!.click();
  expect(popover()).toBeNull();
  expect(requests.length).toBe(2);
  // Resolved: the notices go and take no room.
  conflicts = [];
  panel.update(frame());
  expect(root.querySelectorAll(".doc-conflict").length).toBe(0);
  expect((root.querySelector(".doc-conflicts") as LightElement).hidden).toBe(true);
});
