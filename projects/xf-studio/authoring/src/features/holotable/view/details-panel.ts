import { baseCard, baseItem, baseLayerItems, poiGlyph } from "./base-layers";
import { uid } from "../../../studio-ui/dom";
import { icon, isIconName } from "../../../studio-ui/icons";
import { cardDetail, facetTitle, humanSpan, plainCounts } from "./friendly";
import { glyphIcon } from "./glyphs";
import { unknownGlyphs } from "./glyphs";
/** Details composes existing switches, groups and property lists over the application snapshot. */
import { expander, expanderLabel, setExpanded, GroupSection, note, propertyList, Toggle, button, type Property } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { HolotableFacade } from "../facade";
import type { HoloLayer, HoloState } from "../service";
import type { AgentItem, AgentLayer } from "../agent-types";
import { HOLOTABLE_PANEL_META } from "./contribution";
import { f1, heading, LAYER_LABELS, vAt } from "./shared";
import { peopleAt } from "./projection";
import { itemTitle } from "./agent-labels";

type Ctx = ModuleViewContext<HolotableFacade>;
export function holotableDetailsPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  const toggles = (Object.keys(LAYER_LABELS) as HoloLayer[]).map(id => ({ id, toggle: new Toggle({ label: LAYER_LABELS[id], onChange: on => { void ctx.dispatch({ kind: "holo.layer", id, on }, { quiet: true }); } }) }));
  const layers = new GroupSection({ title: "Show", key: "holotable:layers", expanded: true });
  const story = new Toggle({ label: "Story content", onChange: on => { void ctx.dispatch({ kind: "holo.level", level: on ? "full" : "structure" }); } });
  const contentHint=note("World content for this district hasn't been prepared","muted");contentHint.hidden=true;
  layers.body.append(...toggles.map(t => t.toggle.element), contentHint, story.element);
  const agentGroup = new GroupSection({ title: "Agent layers", key: "holotable:agents", expanded: true });
  const producers = new Map<string, { toggle: Toggle; body: HTMLElement; title: string }>();
  const agentRows = new Map<string, Toggle>();
  const producerNotes = new Map<string, HTMLElement>();
  function focusItem(id:string) {
    const view=ctx.targets().view;
    void ctx.dispatch({kind:"holo.select",id});
    if(view)void ctx.dispatch({kind:"holo.view.focus",view,id});
  }
  const inspect = h("div", {}), inspector = new GroupSection({ title: "Selected", key: "holotable:inspector", expanded: true }); inspector.body.append(inspect);
  const limits = note("", "muted");
  const element = h("div", { class: "panel-content holotable-details" }, inspector.element, layers.element, agentGroup.element, limits);
  let inspectKey = "", inspectContent:unknown;
  const visible = (state: HoloState) => state.agents.layers.filter(l => state.agentEnabled[l.id] !== false);
  const find = (state: HoloState, key: string) => visible(state).flatMap(l => l.items).find(i => i.key === key);
  const title = (item: AgentItem, state: HoloState, owner?: string) => itemTitle(item, visible(state).flatMap(l => l.items), owner);
  function itemFacts(item: AgentItem, state: HoloState): HTMLElement {
    const owner=state.agents.layers.find(l=>l.items.some(i=>i.key===item.key));
    const facts: (Property|[string, string])[] = [["Kind", item.kind], ["Id",item.id]];
    if(item.cite)facts.push(["Citation",item.cite]);
    facts.push(["Clock",state.open?.session.meta.standalone?.clock??"recording"], ["Raw times",`${item.t??"Beginning"} – ${item.until??"end"}`]);
    for (const [name,value] of Object.entries(item.facets??item.value?.facets??{})) facts.push([facetTitle(name,owner?.facet_titles),value]);
    if(item.region)facts.push([`Placed by ${item.region.kind}`,item.region.name]);
    if(item.toRegion)facts.push([`Other end by ${item.toRegion.kind}`,item.toRegion.name]);
    const glyph=glyphIcon(item.glyph,isIconName),plate=h("span",{style:"display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border:1.5px solid var(--signal);border-radius:50%;background:var(--pv-ground);color:var(--signal)","aria-hidden":"true"},icon(glyph.icon&&isIconName(glyph.icon)?glyph.icon:"dot"));
    const body=h("div",{"data-holo-card":item.key},h("h4",{style:"display:flex;gap:8px;align-items:center;overflow-wrap:anywhere"},plate,title(item,state)));
    const detail=cardDetail(item.detail);
    if(detail.summary)body.append(h("p",{style:"white-space:pre-line;overflow-wrap:anywhere",text:detail.summary}));
    body.append(note(humanSpan(item,state.open?.session.meta.standalone?.clock==="game",state.open?.session.meta.from),"muted"));
    const involved=h("div",{class:"control-line",style:"flex-wrap:wrap"});
    for(const key of item.relations??[]) {
      const relation=find(state,key);if(!relation)continue;
      const end=relation.links?.from===item.key?relation.links.to:relation.links?.from;
      involved.append(button({label:title(relation,state,item.key),small:true,variant:"quiet",onClick:()=>focusItem(end??key)}));
    }
    if(involved.childNodes.length)body.append(h("h5",{text:"Involved"}),involved);
    if(detail.why)body.append(h("h5",{text:"Why"}),h("p",{style:"white-space:pre-line;overflow-wrap:anywhere",text:detail.why}));
    const open=facade.preference("technical"),id=uid("holotable-technical"),technical=propertyList(facts,{label:"Technical details"});technical.id=id;technical.hidden=!open;
    const disclosure=expander("row",{expanded:open,controls:id},expanderLabel("Technical"));
    disclosure.addEventListener("click",()=>{const expanded=disclosure.getAttribute("aria-expanded")!=="true";facade.remember("technical",expanded);setExpanded(disclosure,expanded);technical.hidden=!expanded;});
    body.append(disclosure,technical);
    return body;
  }
  function itemList(items: readonly AgentItem[], state: HoloState): HTMLElement {
    return h("div", {}, ...items.map(item => h("div", {}, button({ label: title(item, state), small: true, variant: "quiet", onClick: () => { focusItem(item.key); } }), itemFacts(item, state))));
  }
  function staticFacts(state:HoloState,key:string):HTMLElement|undefined {
    const card=baseCard(state.open?.world.content,key);if(!card)return;
    const poi=state.open?.world.content?.pois.find(p=>`base:pois:${p.id}`===key),glyph=poi?glyphIcon(poiGlyph(poi),isIconName):undefined;
    const title=h("h4",{style:"display:flex;gap:8px;align-items:center;overflow-wrap:anywhere"});
    if(glyph)title.append(h("span",{style:"display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border:1.5px solid var(--signal);border-radius:50%;background:var(--pv-ground);color:var(--signal)","aria-hidden":"true"},icon(glyph.icon&&isIconName(glyph.icon)?glyph.icon:"dot")));
    title.append(card.title);
    const body=h("div",{"data-holo-card":key},title,h("p",{style:"white-space:pre-line;overflow-wrap:anywhere",text:card.summary}));
    if(card.when)body.append(h("h5",{text:"When"}),note(card.when,"muted"));
    if(card.involved.length){const chips=h("div",{class:"control-line",style:"flex-wrap:wrap"});for(const chip of card.involved)chips.append(button({label:chip.label,small:true,variant:"quiet",onClick:()=>focusItem(chip.key)}));if(card.more)chips.append(note(`+${card.more} more`,"muted"));body.append(h("h5",{text:"Involved"}),chips);}
    const open=facade.preference("technical"),id=uid("holotable-base-technical"),technical=propertyList(card.technical,{label:"Technical details"});technical.id=id;technical.hidden=!open;
    const disclosure=expander("row",{expanded:open,controls:id},expanderLabel("Technical"));disclosure.addEventListener("click",()=>{const expanded=disclosure.getAttribute("aria-expanded")!=="true";facade.remember("technical",expanded);setExpanded(disclosure,expanded);technical.hidden=!expanded;});body.append(disclosure,technical);return body;
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
    if (state.selected?.startsWith("cluster:")) {
      const members=state.selectedCluster ? new Set(state.selectedCluster) : undefined;
      const base=members?[...members].flatMap(key=>{const item=baseItem(state.open?.world.content,key);return item?[item]:[];}):baseLayerItems(state.open?.world.content,state.layers);
      const items=[...visible(state).flatMap(l=>l.items.filter(i=>!l.notPlaced.includes(i.id))),...base].filter(i=>members ? members.has(i.key) : ["point","target","label","actor","influence"].includes(i.kind)&&(JSON.stringify(i.place)===state.selected!.slice(8)||JSON.stringify(i.to)===state.selected!.slice(8)));
      return h("div",{},h("h4",{text:`${items.length} at this spot`}),...items.map(item=>button({label:title(item,state),small:true,variant:"quiet",onClick:()=>focusItem(item.key)})));
    }
    if (state.selected && state.selected !== "v") {
      const base=staticFacts(state,state.selected);if(base)return base;
      if (state.selected.startsWith("person:") && state.layers.people) {
        const actor = peopleAt(s, state.t).get(state.selected.slice(7))?.at(-1);
        if (actor?.valid && actor.position && state.t - actor.t <= 0.5) return propertyList([
          ["Kind", "Recorded person"], ["Handle", actor.who], ["Command state", actor.command_state ?? "Not recorded"],
          ["Where", actor.position.map(f1).join(", ")],
        ], { label: "Selected person" });
      }
      const item = find(state, state.selected); if (item) return itemFacts(item, state);
      const e = s.events.find(x => x.id === state.selected); if (!e) return note("That mark isn't visible at this moment.");
      return itemFacts({id:e.id,key:e.id,kind:e.incident?`${e.kind} · ${e.incident.kind??e.incident.event}`:e.kind,label:e.summary,detail:e.detail,anchor:{at:e.at??[0,0,0]},place:e.at,t:e.t,until:e.t,cite:e.cite,glyph:"warning"},state);
    }
    const v = vAt(state); if (!v) return note(m.standalone ? "Select an item or a place to inspect it." : "V has no sample yet at this moment.");
    return propertyList([{ term: "Position", value: v.position.map(f1).join(", "), mono: true }, { term: "Heading", value: heading(v.yaw), mono: true }, { term: "Speed", value: `${f1(v.speed)} m/s`, mono: true }, { term: "Health", value: `${v.health} of ${v.healthMax}`, mono: true }, ["State", [v.inCombat ? "in combat" : "", v.vehicle ? "in a vehicle" : "", v.busy].filter(Boolean).join(", ") || "on foot"], { term: "Why", value: `recorder:${m.session}:${m.run}:${v.seq}`, mono: true }], { label: "V" });
  }
  function updateAgents(state: HoloState) {
    const current = new Set(state.agents.layers.map(l => l.id)), names = new Set(state.agents.layers.map(l => l.producer));
    for (const [id, toggle] of agentRows) if (!current.has(id)) { toggle.element.remove(); producerNotes.get(id)?.remove();producerNotes.delete(id);agentRows.delete(id); }
    for (const [name, producer] of producers) if (!names.has(name)) { producer.toggle.element.remove(); producer.body.remove(); producers.delete(name); }
    for (const name of names) {
      const owned = state.agents.layers.filter(l => l.producer === name), count = owned.filter(l => state.agentEnabled[l.id] !== false).length;
      const title = owned.find(l => l.producer_title)?.producer_title ?? name;
      let producer = producers.get(name);
      if (!producer || producer.title !== title) {
        const toggle = new Toggle({ label: title, mixedLabel: `${title} · some layers`, onChange: on => { void ctx.dispatch({ kind: "holo.producer", producer: name, on }); } });
        if (producer) {
          const focused = producer.toggle.input === document.activeElement;
          producer.toggle.element.replaceWith(toggle.element); producer.toggle = toggle; producer.title = title;
          if (focused) toggle.input.focus();
        } else {
          const body = h("div", { style: "padding-inline-start:16px" }); producer = { toggle, body, title }; producers.set(name, producer); agentGroup.body.append(toggle.element, body);
        }
      }
      producer.toggle.update(count === owned.length, { mixed: count > 0 && count < owned.length });
      for (const l of owned) {
        const unknown = unknownGlyphs(l.items);
        let toggle = agentRows.get(l.id);
        if (!toggle) {
          toggle = new Toggle({ label: l.title, onChange: on => { void ctx.dispatch({ kind: "holo.agentLayer", id: l.id, on }); } });
          const row=toggle.element;
          row.dataset.holotableLayer=l.id;
          const menu=(anchor:HTMLElement|{x:number;y:number})=>ctx.targetMenu({title:`${l.title} layer actions`,label:l.title,items:[{label:"Step through this layer",action:{kind:"holo.change.scope",layer:l.id}},{label:"Focus on this layer",action:{kind:"holo.view.focus",view:ctx.targets().view??"",layer:l.id}}]},anchor,row.querySelector("button,input")??row);
          row.addEventListener("contextmenu",event=>{event.preventDefault();event.stopPropagation();menu(event.clientX||event.clientY?{x:event.clientX,y:event.clientY}:row);});
          row.addEventListener("keydown",event=>{if(event.key==="ContextMenu"||event.key==="F10"&&event.shiftKey){event.preventDefault();event.stopPropagation();menu(row);}});
          agentRows.set(l.id, toggle);const notes=h("div",{});producerNotes.set(l.id,notes);producer.body.append(row,notes);
        }
        toggle.update(state.agentEnabled[l.id] !== false, { note: plainCounts(l,state.agentEnabled[l.id]!==false) });
        const notes=producerNotes.get(l.id)!;
        const content=[l.refused?`${l.refused} refused${l.reason?`: ${l.reason}`:""}`:"",unknown.count?`${unknown.count} unknown ${unknown.count===1?"glyph":"glyphs"}: ${unknown.names.join(", ")}`:"",l.notPlaced.length?`${l.notPlaced.length} not placed: ${l.notPlaced.join(", ")}`:"",l.otherBranches.length?`${l.otherBranches.length} on other branches: ${[...new Set(l.otherBranches)].join(", ")}`:""].filter(Boolean).join("\n");
        if(notes.dataset.content!==content){notes.dataset.content=content;notes.replaceChildren();if(content){
          const section=new GroupSection({title:"Producer notes",key:`holotable:producer-notes:${l.id}`,level:"maker",expanded:false});
          section.body.append(note(content,"muted"));section.body.style.whiteSpace="pre-line";notes.append(section.element);
        }}
        toggle.element.title="";
      }
    }
    agentGroup.element.hidden = !state.agents.layers.length;
  }
  return { dispose() {}, spec: { id: "holotable.details", ...HOLOTABLE_PANEL_META["holotable.details"], element }, update() {
    const state = facade.snapshot(), s = state.open?.session, baseCounts=facade.visibleBaseCounts(ctx.targets().view),contentAvailable=baseCounts?.available??state.open?.world.content?.available;
    for (const { id, toggle } of toggles) {
      toggle.element.hidden = !!s?.meta.standalone && ["v", "camera", "people", "events", "gaps"].includes(id);
      const content=state.open?.world.content,isBase=["pois","spots","communities"].includes(id);
      const counts=baseCounts;
      const count=isBase?counts?.[id as "pois"|"spots"|"communities"]??0:0;
      toggle.update(state.layers[id],isBase?{note:content&&contentAvailable===false?"Not built yet":`${state.layers[id]?id==="spots"?Math.min(2000,count):count:0} on the map now`}:{});
      toggle.element.title=isBase&&content&&contentAvailable===false?"World content for this district hasn't been prepared":"";
    }
    contentHint.hidden=contentAvailable!==false;
    story.update(state.level === "full", { disabled: !s, reason: s ? undefined : "Open a recording first." });
    updateAgents(state);
    setText(limits, s ? `${s.meta.standalone ? "Layers only; no recorded observations. Solid shapes are drawn within 350 m of where you're looking. " : `${s.meta.dropped} dropped, ${s.meta.missedDeadlines} missed, largest gap ${f1(s.meta.largestGapS)} s. `}Districts and solid shapes are offline estimates of the live world.` : "");
    inspector.element.hidden = !s;
    const k = JSON.stringify([state.open?.dir, state.selected, state.selectedCluster, state.position, state.level, state.layers, state.agents, state.agentEnabled, state.selected&&(state.selected.startsWith("base:")||find(state,state.selected))?null:Math.round(state.t * 10)]);
    if (k !== inspectKey || inspectContent!==state.open?.world.content) { inspectKey = k;inspectContent=state.open?.world.content; inspect.replaceChildren(rows(state)); }
  } };
}
export const detailText=(text:string)=>h("span",{style:"white-space:pre-line",text});
