import { button, note, section, ChoiceList, SliderWithValue, Toggle } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { moduleView, type ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { ViewContribution } from "../../../studio-ui/views/contribution";
import type { HairDisplay, HairLabFacade } from "../service";

export const HAIR_VIEW = { owner: "hair-lab", panels: [{ id: "hair-lab.groom", title: "Hair Lab", icon: "character", description: "Try a generated groom on V.", order: 190, slot: "inspect" }], activity: [{ pattern: /^hairLab\./, label: "Hair Lab" }] } as const satisfies ViewContribution;
function hairPanel(ctx: ModuleViewContext<HairLabFacade>): PanelController {
  const facade = ctx.facade, target = () => facade.snapshot().sessions[0]?.id;
  const active = new Toggle({ label: "Use Hair Lab", help: "Try this groom in the 3D view. Turn it off to return to your selected hairstyle.", onChange: on => { const id = target(); if (id) void ctx.dispatch({ kind: "hairLab.activate", target: id, active: on }); } });
  const status = h("p", { class: "note muted", role: "status", "aria-live": "polite" });
  const choose = (value: HairDisplay) => { const id = target(); if (id) void ctx.dispatch({ kind: "hairLab.preview", target: id, display: value }); };
  const display = new ChoiceList<HairDisplay>({ label: "Show", layout: "chips", options: [{ value: "cards", label: "Hair cards" }, { value: "volumes", label: "Clumps" }, { value: "strands", label: "Paths" }, { value: "scalp", label: "Scalp" }], onSelect: choose });
  const compare = new ChoiceList<HairDisplay>({ label: "Compare with", layout: "chips", options: [{ value: "reference", label: "Game hair" }, { value: "reference-scalp", label: "Game cap" }], onSelect: choose });
  const ranges = { length: { label: "Length", min: .08, max: .85, step: .01, initial: .55, scale: 100, unit: "cm" }, waves: { label: "Waves", min: 0, max: .035, step: .001, initial: .012, scale: 1000, unit: "mm" }, spread: { label: "Volume", min: 0, max: .065, step: .001, initial: .018, scale: 1000, unit: "mm" } } as const;
  const controls = Object.entries(ranges).map(([field, range]) => {
    let pending: number | undefined;
    return { field, control: new SliderWithValue({ label: range.label, min: range.min, max: range.max, step: range.step, defaultValue: range.initial,
      format: n => `${Math.round(n * range.scale)} ${range.unit}`, transaction: { edit(value) { pending = value; }, commit() { const id = target(); if (id && pending !== undefined) void ctx.dispatch({ kind: "hairLab.set", target: id, field: field as keyof typeof ranges, value: pending }); pending = undefined; }, cancel() { pending = undefined; } } }) };
  });
  const retry = button({ label: "Try again", icon: "refresh", small: true, onClick: () => { const id = target(); if (id) void ctx.dispatch({ kind: "hairLab.retry", target: id }); } });
  const element = h("div", { class: "panel-content" }, section("Preview", h("div", { class: "row" }, active.element), status, h("div", { class: "row wrap gap-s" }, retry), display.element, compare.element), section("Shape", ...controls.map(item => item.control.element)), note("An experiment for the Studio preview. Game export and hair physics aren't available yet."));
  return { spec: { id: "hair-lab.groom", title: "Hair Lab", icon: "character", description: "Try a generated groom on V.", element },
    update() {
      const row = facade.snapshot().sessions[0];
      display.update(row?.display === "reference" || row?.display === "reference-scalp" ? undefined : row?.display === "combined" ? "strands" : row?.display ?? "cards", undefined, { disabled: !row?.active });
      compare.update(row?.display === "reference" || row?.display === "reference-scalp" ? row.display : undefined, undefined, { disabled: !row?.active });
      active.update(row?.active ?? false, { disabled: !row, reason: !row ? "Open the 3D view to try a groom on V." : undefined });
      const description = row?.display === "reference" ? "game hairstyle 01 in V's hair colour" : row?.display === "reference-scalp" ? "game cap 01 in V's hair colour" : row?.display === "scalp" ? "scalp coverage" : row?.display === "strands" || row?.display === "combined" ? "diagnostic strand paths" : row?.display === "volumes" ? "clumps shaded by groom depth" : "hair cards in V's hair colour";
      setText(status, !row ? "Waiting for V…" : !row.active ? "Your selected hairstyle is showing." : row.phase === "failed" ? row.message : `${row.message} · ${description}`);
      for (const { field, control } of controls) {
        const value = row?.groom?.fields[field]; control.update(value?.op === "constant" ? value.value : ranges[field as keyof typeof ranges].initial, { disabled: !row?.document });
      }
      retry.parentElement!.hidden = row?.phase !== "failed";
    } };
}
export const HAIR_VIEW_BINDING = moduleView(HAIR_VIEW, { "hair-lab.groom": hairPanel });
