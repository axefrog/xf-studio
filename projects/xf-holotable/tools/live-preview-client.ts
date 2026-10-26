// Isolated verification fixture: the real panels, facade and client service over a fake headless source.
import { createHolotable } from "../../xf-studio/authoring/src/features/holotable/service";
import { holotableFacade } from "../../xf-studio/authoring/src/features/holotable/facade";
import { holotablePanel } from "../../xf-studio/authoring/src/features/holotable/view/panel";
import { holotableRecordingsPanel } from "../../xf-studio/authoring/src/features/holotable/view/recordings-panel";
import { button, RecordList, installReasonTips } from "../../xf-studio/authoring/src/studio-ui/components";
import { h } from "../../xf-studio/authoring/src/studio-ui/dom";
import type { ModuleViewContext } from "../../xf-studio/authoring/src/studio-ui/views/feature-view";
import type { HolotableFacade } from "../../xf-studio/authoring/src/features/holotable/facade";

const params = new URLSearchParams(location.search);
if (params.get("verify") !== "1") throw Error("Verification workspace required");
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const ctl = new AbortController();
const service = createHolotable({ transport: async (method, input, signal) => {
  const answer = await fetch(`/fixture?case=${params.get("case")}&variant=${params.get("theme")}-${params.get("width")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params: input }), signal });
  return { ok: answer.ok, status: answer.status, data: await answer.json() };
} }, ctl.signal);
const facade = holotableFacade(service);
const panels: ReturnType<typeof holotablePanel>[] = [];
const paint = () => {
  for (const panel of panels) panel.update(undefined as never);
  document.body.dataset.shapes = String((service.snapshot().open?.world.solids?.length ?? 0) > 0);
};
const context = { facade, changed: paint, dispatch: async action => (await service.dispatch(action)).ok } as ModuleViewContext<HolotableFacade>;
const view = holotablePanel(context), recordings = holotableRecordingsPanel(context); panels.push(view, recordings);
const narrow = params.get("width") === "narrow", stageWidth = narrow ? 360 : 900, listWidth = narrow ? 240 : 400;
function section(title: string, width: number, content: HTMLElement, height?: number) {
  const s = h("section", { style: `width:${width}px;flex:none;min-width:0;background:var(--bg-panel);border:1px solid var(--line)` },
    h("h2", { style: "font:var(--fs-md) var(--font-ui);margin:0;padding:12px;border-bottom:1px solid var(--line)", text: title }),
    h("div", { style: height ? `height:${height}px;min-height:0` : "min-height:0" }, content));
  return s;
}
const reference = new RecordList({ label: "Record list reference" });
reference.update([{ id: "open", name: "Evening collection", meta: ["2 presets", "version 3"], current: true, badge: { text: "Open now", tone: "info" } },
  { id: "saved", name: "Saved collection", meta: ["1 preset", "version 2"], action: button({ label: "Open", small: true, onClick() {} }) }]);
const patterns = h("div", { class: "panel-content" }, reference.element,
  h("p", { class: "note muted", text: "Style guide: Record list, library Button and state badge." }));
document.body.replaceChildren(h("main", { style: "padding:20px;width:max-content" },
  h("h1", { style: "font-size:20px;margin:0 0 8px", text: "Holotable · synthetic live bridge" }),
  h("p", { class: "note muted", text: "Verification workspace · generated observations and shapes · no game or private assets" }),
  h("div", { style: "display:flex;align-items:flex-start;gap:16px" }, section("Holotable", stageWidth, view.spec.element, 540),
    section("Recordings", listWidth, recordings.spec.element), section("Library pattern", listWidth, patterns))));
installReasonTips(document);
service.subscribe(paint); service.shown(); paint();
await new Promise<void>(resolve => { const stop = service.subscribe(() => { if (service.snapshot().live.available) { stop(); resolve(); } }); });
await service.dispatch({ kind: "holo.watch" });
// The first watch may begin before its first catch-up has completed; wait on the real client update.
if (!service.snapshot().open?.session.v.length) await new Promise<void>(resolve => {
  const stop = service.subscribe(() => { if (service.snapshot().open?.session.v.length) { stop(); resolve(); } });
});
if (params.get("case") === "back-to-live") await service.dispatch({ kind: "holo.seek", t: 1001.5 });
paint(); document.body.dataset.ready = "true";
addEventListener("pagehide", () => { service.withdraw(); ctl.abort(); for (const panel of panels) panel.dispose?.(); }, { once: true });
