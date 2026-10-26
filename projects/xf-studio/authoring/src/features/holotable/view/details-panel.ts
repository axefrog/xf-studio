/** Details composes existing switches, groups and property lists over the application snapshot. */
import { GroupSection, note, propertyList, Toggle, button } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { HolotableFacade } from "../facade";
import type { HoloLayer, HoloState } from "../service";
import type { AgentItem, AgentLayer } from "../agent-types";
import { HOLOTABLE_PANEL_META } from "./contribution";
import { f1, heading, LAYER_LABELS, vAt } from "./shared";
import { itemTitle, layerCounts } from "./agent-labels";

type Ctx = ModuleViewContext<HolotableFacade>;
export function holotableDetailsPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  const toggles = (Object.keys(LAYER_LABELS) as HoloLayer[]).map(id => ({ id, toggle: new Toggle({ label: LAYER_LABELS[id], onChange: on => { void ctx.dispatch({ kind: "holo.layer", id, on }, { quiet: true }); } }) }));
  const layers = new GroupSection({ title: "Show", key: "holotable:layers", expanded: true });
  const story = new Toggle({ label: "Story content", onChange: on => { void ctx.dispatch({ kind: "holo.level", level: on ? "full" : "structure" }); } });
  layers.body.append(...toggles.map(t => t.toggle.element), story.element);
  const agentGroup = new GroupSection({ title: "Agent layers", key: "holotable:agents", expanded: true });
  const producers = new Map<string, { toggle: Toggle; body: HTMLElement }>();
  const agentRows = new Map<string, Toggle>();
  const inspect = h("div", {}), inspector = new GroupSection({ title: "Selected", key: "holotable:inspector", expanded: true }); inspector.body.append(inspect);
  const limits = note("", "muted");
  const element = h("div", { class: "panel-content holotable-details" }, inspector.element, layers.element, agentGroup.element, limits);
  let inspectKey = "";
  const visible = (state: HoloState) => state.agents.layers.filter(l => state.agentEnabled[l.id] !== false);
  const find = (state: HoloState, key: string) => visible(state).flatMap(l => l.items).find(i => i.key === key);
  const title = (item: AgentItem, state: HoloState, owner?: string) => itemTitle(item, visible(state).flatMap(l => l.items), owner);
  function itemFacts(item: AgentItem, state: HoloState): HTMLElement {
    const facts: [string, string][] = [[item.kind === "relation" ? "Relation" : "Kind", item.kind === "relation" ? title(item, state) : item.kind]];
    if (item.value?.name) facts.push(["Name", item.value.name]);
    if (item.label) facts.push(["Label", item.label]);
    if (item.detail) facts.push(["Detail", item.detail]);
    for (const [name, value] of Object.entries(item.facets ?? item.value?.facets ?? {})) facts.push([name, value]);
    facts.push(["Time span", `${item.t === undefined ? "Beginning" : f1(item.t)} – ${item.until === undefined ? "end" : f1(item.until)}`]);
    if (item.region) facts.push([`Placed by ${item.region.kind}`, item.region.name]);
    if (item.toRegion) facts.push([`Other end by ${item.toRegion.kind}`, item.toRegion.name]);
    if (item.cite) facts.push(["Why", item.cite]);
    const body = h("div", {}, propertyList(facts, { label: "Selected item" }));
    for (const key of item.relations ?? []) { const relation = find(state, key); if (relation) body.append(button({ label: title(relation, state, item.key), small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "holo.select", id: key }); } })); }
    return body;
  }
  function itemList(items: readonly AgentItem[], state: HoloState): HTMLElement {
    return h("div", {}, ...items.map(item => h("div", {}, button({ label: title(item, state), small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "holo.select", id: item.key }); } }), itemFacts(item, state))));
  }
  function rows(state: HoloState): HTMLElement {
    const open = state.open; if (!open) return note("Open a recording to see what it holds.");
    const s = open.session, m = s.meta;
    if (state.position) {
      const body = h("div", {}, propertyList([["What's here", state.position.map(f1).join(", ")]], { label: "Selected place" }));
      for (const group of state.agents.here) if (state.agentEnabled[group.layer] !== false) {
        const section = new GroupSection({ title: group.title, key: `holotable:here:${group.layer}`, level: "section", heading: 5, expanded: true });
        for (const entry of group.items) { section.body.append(itemList([entry.item], state)); if (entry.sample !== undefined) section.body.append(note(`Sample: ${JSON.stringify(entry.sample)}`, "muted")); }
        body.append(section.element);
      }
      if (!state.agents.here.length) body.append(note("No visible items cover this place."));
      return body;
    }
    if (state.selected?.startsWith("cluster:")) return itemList(visible(state).flatMap(l => l.items.filter(i => !l.notPlaced.includes(i.id))).filter(i => ["point", "target", "label", "actor", "influence"].includes(i.kind) && (JSON.stringify(i.place) === state.selected!.slice(8) || JSON.stringify(i.to) === state.selected!.slice(8))), state);
    if (state.selected && state.selected !== "v") {
      const item = find(state, state.selected); if (item) return itemFacts(item, state);
      const e = s.events.find(x => x.id === state.selected); if (!e) return note("That mark isn't visible at this moment.");
      return propertyList([["What", e.summary], ...(e.detail ? [["Said", e.detail] as [string, string]] : []), { term: "When", value: `${f1(e.t - m.from)} s`, mono: true }, ...(e.at ? [{ term: "Where", value: e.at.map(f1).join(", "), mono: true }] : []), { term: "Why", value: e.cite, mono: true }], { label: "Selected mark" });
    }
    const v = vAt(state); if (!v) return note(m.standalone ? "Select an item or a place to inspect it." : "V has no sample yet at this moment.");
    return propertyList([{ term: "Position", value: v.position.map(f1).join(", "), mono: true }, { term: "Heading", value: heading(v.yaw), mono: true }, { term: "Speed", value: `${f1(v.speed)} m/s`, mono: true }, { term: "Health", value: `${v.health} of ${v.healthMax}`, mono: true }, ["State", [v.inCombat ? "in combat" : "", v.vehicle ? "in a vehicle" : "", v.busy].filter(Boolean).join(", ") || "on foot"], { term: "Why", value: `recorder:${m.session}:${m.run}:${v.seq}`, mono: true }], { label: "V" });
  }
  function updateAgents(state: HoloState) {
    const current = new Set(state.agents.layers.map(l => l.id)), names = new Set(state.agents.layers.map(l => l.producer));
    for (const [id, toggle] of agentRows) if (!current.has(id)) { toggle.element.remove(); agentRows.delete(id); }
    for (const [name, producer] of producers) if (!names.has(name)) { producer.toggle.element.remove(); producer.body.remove(); producers.delete(name); }
    for (const name of names) {
      let producer = producers.get(name);
      if (!producer) {
        const toggle = new Toggle({ label: name, mixedLabel: `${name} · some layers`, onChange: on => { void ctx.dispatch({ kind: "holo.producer", producer: name, on }); } });
        const body = h("div", { style: "padding-inline-start:16px" }); producer = { toggle, body }; producers.set(name, producer); agentGroup.body.append(toggle.element, body);
      }
      const owned = state.agents.layers.filter(l => l.producer === name), count = owned.filter(l => state.agentEnabled[l.id] !== false).length;
      producer.toggle.update(count === owned.length, { mixed: count > 0 && count < owned.length });
      for (const l of owned) {
        let toggle = agentRows.get(l.id);
        if (!toggle) { toggle = new Toggle({ label: l.title, onChange: on => { void ctx.dispatch({ kind: "holo.agentLayer", id: l.id, on }); } }); agentRows.set(l.id, toggle); producer.body.append(toggle.element); }
        toggle.update(state.agentEnabled[l.id] !== false, { note: layerCounts(l) });
        toggle.element.title = [l.reason, l.notPlaced.length ? `Not placed: ${l.notPlaced.join(", ")}` : "", l.otherBranches.length ? `Other branches: ${[...new Set(l.otherBranches)].join(", ")}` : ""].filter(Boolean).join("\n");
      }
    }
    agentGroup.element.hidden = !state.agents.layers.length;
  }
  return { dispose() {}, spec: { id: "holotable.details", ...HOLOTABLE_PANEL_META["holotable.details"], element }, update() {
    const state = facade.snapshot(), s = state.open?.session;
    for (const { id, toggle } of toggles) {
      toggle.element.hidden = !!s?.meta.standalone && ["v", "camera", "events", "gaps"].includes(id);
      toggle.update(state.layers[id]);
    }
    story.update(state.level === "full", { disabled: !s, reason: s ? undefined : "Open a recording first." });
    updateAgents(state);
    setText(limits, s ? `${s.meta.standalone ? "Layers only; no recorded observations. Solid shapes are drawn within 350 m of where you're looking. " : `${s.meta.dropped} dropped, ${s.meta.missedDeadlines} missed, largest gap ${f1(s.meta.largestGapS)} s. `}Districts and solid shapes are offline estimates of the live world.` : "");
    inspector.element.hidden = !s;
    const k = JSON.stringify([state.open?.dir, state.selected, state.position, state.level, state.agents, state.agentEnabled, Math.round(state.t * 10)]);
    if (k !== inspectKey) { inspectKey = k; inspect.replaceChildren(rows(state)); }
  } };
}
