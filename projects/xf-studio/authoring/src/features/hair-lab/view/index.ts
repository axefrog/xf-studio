import { button, note, section, Segmented, SliderWithValue, Toggle } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { moduleView, type ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { ViewContribution } from "../../../studio-ui/views/contribution";
import type { HairDisplay, HairLabFacade } from "../service";

export const HAIR_VIEW = { owner: "hair-lab", panels: [{ id: "hair-lab.groom", title: "Hair Lab", icon: "character", description: "Try a generated groom on V.", order: 190, slot: "inspect" }], activity: [{ pattern: /^hairLab\./, label: "Hair Lab" }] } as const satisfies ViewContribution;
function hairPanel(ctx: ModuleViewContext<HairLabFacade>): PanelController {
  const facade = ctx.facade, target = () => facade.snapshot().sessions[0]?.id;
  const dispatch = (kind: "hairLab.undo" | "hairLab.redo" | "hairLab.retry") => { const id = target(); if (id) void ctx.dispatch({ kind, target: id }); };
  const active = new Toggle({ label: "Use Hair Lab", help: "Try this groom in the 3D view. Turn it off to return to your selected hairstyle.", onChange: on => { const id = target(); if (id) void ctx.dispatch({ kind: "hairLab.activate", target: id, active: on }); } });
  const status = h("p", { class: "note muted", role: "status", "aria-live": "polite" });
  const display = new Segmented<HairDisplay>({ label: "Diagnostic view", options: [{ value: "combined", label: "Together" }, { value: "strands", label: "Paths only" }, { value: "scalp", label: "Scalp only" }, { value: "reference", label: "Game reference" }, { value: "reference-scalp", label: "Game cap" }], onSelect: value => { const id = target(); if (id) void ctx.dispatch({ kind: "hairLab.preview", target: id, display: value }); } });
  const diagnostic = note("Preview: strand paths. Hair cards come next.");
  const ranges = { length: { label: "Length", min: .08, max: .85, step: .01, initial: .55, scale: 100, unit: "cm" }, waves: { label: "Waves", min: 0, max: .035, step: .001, initial: .012, scale: 1000, unit: "mm" }, spread: { label: "Volume", min: 0, max: .065, step: .001, initial: .018, scale: 1000, unit: "mm" } } as const;
  const controls = Object.entries(ranges).map(([field, range]) => {
    let pending: number | undefined;
    return { field, control: new SliderWithValue({ label: range.label, min: range.min, max: range.max, step: range.step, defaultValue: range.initial,
      format: n => `${Math.round(n * range.scale)} ${range.unit}`, transaction: { edit(value) { pending = value; }, commit() { const id = target(); if (id && pending !== undefined) void ctx.dispatch({ kind: "hairLab.set", target: id, field: field as keyof typeof ranges, value: pending }); pending = undefined; }, cancel() { pending = undefined; } } }) };
  });
  const undo = button({ label: "Undo hair change", icon: "undo", small: true, variant: "quiet", onClick: () => dispatch("hairLab.undo") });
  const redo = button({ label: "Redo", icon: "redo", small: true, variant: "quiet", onClick: () => dispatch("hairLab.redo") });
  const retry = button({ label: "Try again", icon: "refresh", small: true, onClick: () => dispatch("hairLab.retry") });
  const element = h("div", { class: "panel-content" }, section("Preview", h("div", { class: "row" }, active.element), status, diagnostic, display.element), section("Shape", ...controls.map(item => item.control.element)), h("div", { class: "row wrap gap-s" }, undo, redo, retry), note("An experiment for the Studio preview. Game export and moving hair aren't available yet."));
  return { spec: { id: "hair-lab.groom", title: "Hair Lab", icon: "character", description: "Try a generated groom on V.", element },
    update() {
      const row = facade.snapshot().sessions[0];
      display.update(row?.display ?? "combined", undefined, { disabled: !row?.active });
      setText(diagnostic, row?.display === "reference" ? "Reference: base-game hairstyle 01, with V's hair colour." : row?.display === "reference-scalp" ? "Reference: base-game hairstyle 01 cap only, with V's hair colour." : row?.display === "scalp" ? "Preview: scalp coverage only. Hair cards come next." : row?.display === "strands" ? "Preview: strand paths only. Hair cards come next." : "Preview: strand paths and scalp coverage. Hair cards come next.");
      active.update(row?.active ?? false, { disabled: !row, reason: !row ? "Open the 3D view to try a groom on V." : undefined });
      setText(status, !row ? "Waiting for V…" : !row.active ? "Your selected hairstyle is showing." : row.message);
      for (const { field, control } of controls) {
        const value = row?.result?.groom.fields[field]; control.update(value?.op === "constant" ? value.value : ranges[field as keyof typeof ranges].initial, { disabled: !row?.document });
      }
      retry.hidden = row?.phase !== "failed"; undo.disabled = redo.disabled = !row?.document;
    } };
}
export const HAIR_VIEW_BINDING = moduleView(HAIR_VIEW, { "hair-lab.groom": hairPanel });
