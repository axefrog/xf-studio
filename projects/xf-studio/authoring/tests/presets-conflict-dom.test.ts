/**
 * The Presets panel's conflict notices (style guide t-conflict): one per conflict on the collection or a preset, under the collection's
 * name, with the three ways out (Keep both only where a copy can be made), each sending the typed request with its conflict and choice.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

test("conflict notices show what differs and send the chosen resolution; they go once resolved", async () => {
  const { presetsPanel } = await import("../src/studio-ui/panels/collection");
  const requests: unknown[] = [];
  let conflicts = [
    { id: "c1", message: "You changed the preset “Smoky” here too (its makeup). Which version should it keep?", keepBoth: true },
    { id: "c2", message: "You changed the collection “Night” here too (its name). Which version should it keep?", keepBoth: false },
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
  expect(buttons(notices[0]!)).toEqual(["Keep mine", "Use theirs", "Keep both"]);
  // A collection's name or list can't be kept as a copy: only the first two show.
  expect(buttons(notices[1]!)).toEqual(["Keep mine", "Use theirs"]);
  notices[0]!.querySelectorAll("button")[1]!.click();
  notices[1]!.querySelectorAll("button")[0]!.click();
  expect(requests).toEqual([{ kind: "resolveConflict", conflict: "c1", keep: "theirs" }, { kind: "resolveConflict", conflict: "c2", keep: "mine" }]);
  // Resolved: the notices go and take no room.
  conflicts = [];
  panel.update(frame());
  expect(root.querySelectorAll(".doc-conflict").length).toBe(0);
  expect((root.querySelector(".doc-conflicts") as LightElement).hidden).toBe(true);
});
