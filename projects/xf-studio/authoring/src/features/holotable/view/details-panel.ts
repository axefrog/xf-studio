/**
 * The Holotable details panel: what the replay shows (one switch per layer), story content behind a confirmation, the selected mark or
 * V with the record each fact came from, and what this recording can't prove.
 */
import { applyCapability, button, GroupSection, note, openConfirmPopover, propertyList, setButtonLabel, Toggle } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { HolotableFacade } from "../facade";
import type { HoloLayer, HoloState } from "../service";
import { HOLOTABLE_PANEL_META } from "./contribution";
import { f1, heading, LAYER_LABELS, vAt } from "./shared";

type Ctx = ModuleViewContext<HolotableFacade>;

export function holotableDetailsPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  const toggles = (Object.keys(LAYER_LABELS) as HoloLayer[]).map(id => ({ id, toggle: new Toggle({ label: LAYER_LABELS[id],
    onChange: on => { void ctx.dispatch({ kind: "holo.layer", id, on }, { quiet: true }); } }) }));
  const layers = new GroupSection({ title: "Show", key: "holotable:layers", expanded: true });
  layers.body.append(...toggles.map(t => t.toggle.element));
  const story = button({ label: "Show story content…", icon: "eye", small: true, variant: "quiet", onClick: event => {
    if (facade.snapshot().level === "full") { void ctx.dispatch({ kind: "holo.level", level: "structure" }); return; }
    openConfirmPopover(event.currentTarget as Element, { title: "Show story content?", confirm: "Show story",
      message: "Spoken lines and names appear in the replay and here. Hiding them again takes one click.",
      onConfirm: () => { void ctx.dispatch({ kind: "holo.level", level: "full" }); } });
  } });
  const storyNote = note("", "muted");
  const inspect = h("div", {});
  const inspector = new GroupSection({ title: "Selected", key: "holotable:inspector", expanded: true });
  inspector.body.append(inspect);
  const limits = note("", "muted");
  const element = h("div", { class: "panel-content holotable-details" }, inspector.element, layers.element,
    h("div", { class: "control-line" }, story, storyNote), limits);
  let inspectKey = "";

  function rows(state: HoloState): HTMLElement {
    const open = state.open; if (!open) return note("Open a recording to see what it holds.");
    const s = open.session, m = s.meta;
    if (state.selected && state.selected !== "v") {
      const e = s.events.find(x => x.id === state.selected);
      if (!e) return note("That mark isn't in this recording.");
      return propertyList([["What", e.summary], ...(e.detail ? [["Said", e.detail] as [string, string]] : []),
        { term: "When", value: `${f1(e.t - m.from)} s`, mono: true },
        ...(e.at ? [{ term: "Where", value: e.at.map(f1).join(", "), mono: true }] : []),
        { term: "Why", value: e.cite, mono: true }], { label: "Selected mark" });
    }
    const v = vAt(state);
    if (!v) return note("V has no sample yet at this moment.");
    return propertyList([
      { term: "Position", value: v.position.map(f1).join(", "), mono: true },
      { term: "Heading", value: heading(v.yaw), mono: true },
      { term: "Speed", value: `${f1(v.speed)} m/s`, mono: true },
      { term: "Health", value: `${v.health} of ${v.healthMax}`, mono: true },
      ["State", [v.inCombat ? "in combat" : "", v.vehicle ? "in a vehicle" : "", v.busy].filter(Boolean).join(", ") || "on foot"],
      { term: "Why", value: `recorder:${m.session}:${m.run}:${v.seq}`, mono: true },
    ], { label: "V" });
  }

  return {
    spec: { id: "holotable.details", ...HOLOTABLE_PANEL_META["holotable.details"], element },
    update() {
      const state = facade.snapshot(), s = state.open?.session;
      for (const { id, toggle } of toggles) toggle.update(state.layers[id], {});
      setButtonLabel(story, state.level === "full" ? "Hide story content" : "Show story content…");
      applyCapability(story, facade.capability({ kind: "holo.level", level: "full" }));
      setText(storyNote, state.level === "full" ? "Story shown" : "Story hidden");
      setText(limits, s ? `${s.meta.problems.length ? `This recording is damaged: ${s.meta.problems.join("; ")}. ` : ""}This recording: ${s.meta.dropped} dropped, ${s.meta.missedDeadlines} missed, largest gap ${f1(s.meta.largestGapS)} s. Districts and cells come from offline game data, an estimate of the live world. Solid shapes are the game's collision data near the path, read from the installed game without mods. About half of it is stored as meshes, which aren't drawn yet.` : "");
      inspector.element.hidden = !s;
      const k = JSON.stringify([state.open?.dir, state.selected, state.level, Math.round(state.t * 10)]);
      if (k !== inspectKey) { inspectKey = k; inspect.replaceChildren(rows(state)); }
    },
  };
}
