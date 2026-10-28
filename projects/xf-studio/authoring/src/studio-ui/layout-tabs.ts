import { capturedItems } from "./captured-runtime";
import type { LayoutTabsPort } from "../app/profiles/tab-presentation";
import type { LayoutTabAction } from "../app/profiles/tab-defaults";
import type { LayoutDefaultView } from "../app/profiles/layout-defaults";
import type { Substitution, SubstitutionChoice } from "../app/profiles/layout-fragment";
import type { SubjectRef } from "../platform/api/subjects";
import type { LookRef } from "../library/collection-documents";
import { keyBinding } from "../app/input-bindings";
import { h, isTextInput, setAttr } from "./dom";
import { isIconName, type IconName } from "./icons";
import { applyCapability, button, setButtonLabel, TabStrip, openMenu, openValuePopover, openChoicePopover, type ChoicePopoverField,
  recordTime, type MenuItem, type Capability } from "./components";
import type { Feedback } from "./feedback";
import type { Command } from "./commands";

type TabsDeps = { tabs: LayoutTabsPort; signal?: AbortSignal; capability(action: LayoutTabAction): Capability;
  dispatch(action: LayoutTabAction): { ok: true } | { ok: false; message: string };
  feedback: Pick<Feedback, "announce" | "toast">; dock: HTMLElement; changed(): void; moduleIcon(module: string): string | undefined };
const subjectKey = (ref: SubjectRef | undefined) => ref ? JSON.stringify(ref) : "";
const lookKey = (ref: LookRef | undefined) => ref ? JSON.stringify(ref) : "";
const allowed: Capability = { available: true };

/** U1–U5 composition. Only transient form/menu/drag state lives here; the session and defaults own all authored state. */
export function layoutTabs(deps: TabsDeps) {
  const { tabs, feedback } = deps;
  let signature = "", suppressClick = false, naming: string | undefined;
  let cancelDrag: (() => void) | undefined;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  let choiceForm: ReturnType<typeof openChoicePopover> | undefined;
  const cap = (action: LayoutTabAction) => deps.capability(action);
  const run = (action: LayoutTabAction) => {
    const capability = cap(action);
    if (!capability.available) { feedback.announce(capability.reason ?? "That can't be done right now."); return false; }
    const closing = action.kind === "tabs.close" ? tabs.snapshot().tabs.find(tab => tab.id === action.tab) : undefined;
    const result = deps.dispatch(action);
    if (!result.ok) { feedback.toast("warning", "Layout tabs", result.message); return false; }
    sync(); deps.changed();
    if (closing) {
      const closed = tabs.snapshot().closed.at(-1);
      feedback.toast("info", "Layout tabs", `Closed “${closing.name}”.`, closed ? [{ label: "Undo",
        run: () => { run({ kind: "tabs.reopen", closed: closed.id ?? closed.tab.id }); } }] : [], { key: closed?.id ?? closing.id });
    }
    return true;
  };
  function show(id: string, focus = false) {
    if (suppressClick) { suppressClick = false; return; }
    if (run({ kind: "tabs.show", tab: id })) {
      if (focus) strip.tab(id)?.focus();
      feedback.announce(`${tabs.snapshot().tabs.find(tab => tab.id === id)?.name ?? "Tab"} shown`);
    }
  }
  const strip = new TabStrip({ label: "Layout tabs", controls: "layout-dock", idPrefix: "layout-tab-",
    onSelect: id => show(id), onKeyDown: key, onContextMenu: (event, id, tab) => { event.preventDefault(); menu(id, tab, { x: event.clientX, y: event.clientY }); },
    onPointerDown: drag, onAuxClick: event => event.preventDefault() });
  const add = button({ label: "New tab", icon: "plus", variant: "ghost", menu: true, onClick: () => newMenu() });
  const element = h("div", { class: "layout-tabs" }, strip.element, add);
  const iconOf = (view: LayoutDefaultView | undefined): IconName => {
    const name = view?.owner.kind === "module" ? deps.moduleIcon(view.owner.module) : "layouts";
    return name && isIconName(name) ? name : "layouts";
  };
  function sync() {
    const state = tabs.snapshot(), defaults = tabs.defaults(), key = JSON.stringify([state.tabs.map(tab => [tab.id, tab.name, tab.origin]), state.shown, defaults, naming]);
    if (key !== signature) {
      signature = key;
      strip.update(state.tabs.map(tab => {
        const origin = defaults.find(item => item.id === tab.origin), label = `${tab.name}${origin ? `, made from ${origin.name}` : ""}`;
        return { id: tab.id, label: tab.name, name: label, tooltip: label, icon: iconOf(origin) };
      }), state.shown);
      for (const tab of state.tabs) {
        const control = strip.tab(tab.id)!;
        control.setAttribute("aria-description", cap({ kind: "tabs.rename", tab: tab.id, name: tab.name }).reason ?? "Double-click or F2 to rename; right-click for tab commands.");
        control.classList.toggle("naming", tab.id === naming);
        if (!control.dataset.renameBound) { control.dataset.renameBound = "true"; control.addEventListener("dblclick", () => rename(tab.id, control)); }
      }
      fit();
    }
    const first = defaults[0];
    applyCapability(add, first ? cap({ kind: "tabs.new", default: first.id }) : { available: false, reason: "No layout defaults are available in this version." });
    // A newer-build first default must not hide the usable ones from the menu.
    if (first && defaults.some(view => cap({ kind: "tabs.new", default: view.id }).available)) applyCapability(add, allowed);
    setButtonLabel(add, "New tab");
    add.classList.toggle("icon-only", !!state.tabs.length);
    element.classList.toggle("is-empty", !state.tabs.length);
    setAttr(deps.dock, "aria-labelledby", state.shown ? `layout-tab-${state.shown}` : undefined);
    choiceForm?.refresh();
  }
  function fit() { if (strip.element.clientWidth) strip.fit(strip.element.clientWidth); }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : undefined;
  observer?.observe(strip.element);
  function rename(id: string, invoker: HTMLElement = strip.tab(id) ?? add, save = false) {
    const tab = tabs.snapshot().tabs.find(tab => tab.id === id);
    if (!tab) return;
    const captured = tabs.capture?.(id) ?? (() => allowed);
    const action = (name: string): LayoutTabAction => save ? { kind: "tabs.saveAsDefault", tab: id, name } : { kind: "tabs.rename", tab: id, name };
    if (!cap(action(tab.name)).available) { feedback.announce(cap(action(tab.name)).reason ?? "This tab can't be renamed here."); return; }
    naming = id; signature = ""; sync();
    openValuePopover({ kind: "text", label: "Name", value: tab.name, maxLength: 61 }, invoker, {
      title: save ? "Save tab as default" : "Rename tab", apply: save ? "Save" : "Rename", invoker,
      hint: save ? "Saves a default of yours. Feature defaults stay available." : undefined,
      validate: value => captured().available ? cap(action(String(value))) : captured(),
      commit: value => { if (!captured().available) return; run(action(String(value))); invoker.focus(); }, onClose: () => { naming = undefined; signature = ""; sync(); },
    });
  }
  function deleteDefault(view: LayoutDefaultView) {
    if (!run({ kind: "defaults.delete", default: view.id })) return;
    feedback.toast("info", "Default deleted", `${view.name} deleted. Use Undo in this notice to bring it back.`,
      [{ label: "Undo", run: () => { run({ kind: "defaults.restore", default: view.id }); } }]);
  }
  function summary(plan: Substitution): string {
    const shared = plan.scenes.flatMap(scene => { const chosen = scene.shares.find(item => item.scene === scene.chosen); return chosen ? [chosen] : []; });
    return [...new Set([...plan.subjects.map(slot => slot.chosen ? tabs.subject(slot.chosen) : "Leave empty"),
      ...plan.looks.filter(slot => slot.needed).map(slot => slot.chosen ? tabs.look(slot.chosen) : "Leave empty"),
      ...shared.flatMap(scene => scene.look ? [tabs.look(scene.look)] : [])])].join(" · ");
  }
  function defaultAction(view: LayoutDefaultView, reset?: string): Extract<LayoutTabAction, { kind: "tabs.new" | "tabs.reset" }> {
    return reset ? { kind: "tabs.reset", tab: reset, default: view.id } : { kind: "tabs.new", default: view.id };
  }
  function choose(view: LayoutDefaultView, invoker: HTMLElement, reset?: string) {
    const action = defaultAction(view, reset);
    if (!cap(action).available) { feedback.announce(cap(action).reason ?? "This default can't be used here."); return; }
    const plan = tabs.substitution(view.id);
    if (!("subjects" in plan)) return;
    if (plan.oneClick) { run(action); return; }
    substitution(view, invoker, reset);
  }
  function defaultItems(invoker: HTMLElement, reset?: string): MenuItem[] {
    const defaults = tabs.defaults(), last = tabs.snapshot().lastDefault;
    const groups = new Map<string, LayoutDefaultView[]>();
    for (const view of defaults) { const group = view.owner.kind === "user" ? "Yours" : view.owner.label; const list = groups.get(group) ?? []; list.push(view); groups.set(group, list); }
    const row = (view: LayoutDefaultView): MenuItem => {
      const plan = tabs.substitution(view.id), one = "subjects" in plan && plan.oneClick;
      const names = one ? summary(plan) : "";
      const duplicate = view.owner.kind === "user" && defaults.some(other => other.id !== view.id && other.owner.kind === "user" && other.name === view.name);
      const saved = view.owner.kind === "user" ? recordTime(view.owner.savedAt, defaults.some(other => other.id !== view.id && other.owner.kind === "user" &&
        view.owner.kind === "user" && other.name === view.name && Math.floor(other.owner.savedAt / 60_000) === Math.floor(view.owner.savedAt / 60_000))) : "";
      return { kind: "action", label: `${view.name}${names ? ` — ${names}` : ""}${!one ? "…" : ""}`, icon: iconOf(view),
        capability: cap(defaultAction(view, reset)), stage: view.owner.kind === "module" && view.owner.earlyAccess ? "preview" : undefined,
        hint: duplicate ? `Saved ${saved}` : undefined,
        run: () => choose(view, invoker, reset),
        ...(!reset && view.owner.kind === "user" ? { secondary: { icon: "trash" as const, name: `Delete default ${view.name}`,
          capability: cap({ kind: "defaults.delete", default: view.id }), run: () => deleteDefault(view) } } : {}) };
    };
    const origin = reset ? tabs.snapshot().tabs.find(tab => tab.id === reset)?.origin : undefined;
    const first = defaults.find(view => view.id === origin);
    const items: MenuItem[] = first ? [row(first), { kind: "separator" }] : [];
    for (const [label, group] of groups) {
      const values = group.filter(view => view.id !== first?.id).sort((a, b) => Number(b.id === last) - Number(a.id === last));
      if (values.length) items.push({ kind: "heading", label }, ...values.map(row));
    }
    return items;
  }
  function newMenu(invoker: HTMLElement = add) {
    const items = defaultItems(invoker), last = tabs.snapshot().lastDefault;
    const view = last && tabs.defaults().find(view => view.id === last), plan = view && tabs.substitution(view.id);
    const focusLabel = view ? `${view.name}${plan && "subjects" in plan && plan.oneClick ? (summary(plan) ? ` — ${summary(plan)}` : "") : "…"}` : undefined;
    const captured = tabs.capture?.() ?? (() => allowed);
    openMenu(capturedItems(items, () => captured().available), invoker, { label: "New tab", invoker, focusLabel });
  }
  function menuItems(id: string, invoker: HTMLElement): MenuItem[] {
    const state = tabs.snapshot(), tab = state.tabs.find(tab => tab.id === id);
    if (!tab) return [];
    const origin = tabs.defaults().find(view => view.id === tab.origin);
    const command = (label: string, action: LayoutTabAction, icon: IconName): MenuItem => ({ kind: "action", label, icon, capability: cap(action), run: () => { run(action); } });
    const items: MenuItem[] = [{ kind: "heading", label: tab.name },
      { kind: "action", label: "Rename…", icon: "rename", capability: cap({ kind: "tabs.rename", tab: id, name: tab.name }), run: () => rename(id, invoker) }];
    const resets = tabs.defaults().map(view => cap(defaultAction(view, id)));
    if (resets.length) items.push({ kind: "submenu", label: "Reset to default", icon: "reset",
      width: "wide", capability: resets.find(choice => choice.available) ?? resets[0], items: () => defaultItems(invoker, id) });
    items.push({ kind: "action", label: "Save as default…", icon: "save", capability: cap({ kind: "tabs.saveAsDefault", tab: id, name: tab.name }), run: () => rename(id, invoker, true) });
    if (origin?.owner.kind === "user") items.push(command(`Update “${origin.name}”`, { kind: "tabs.updateDefault", tab: id }, "save"));
    items.push(command("Close tab", { kind: "tabs.close", tab: id }, "close"));
    if (state.closed.length) items.push({ kind: "submenu", label: "Reopen closed tab", icon: "undo", capability: cap({ kind: "tabs.reopen" }), items: () => [...tabs.snapshot().closed].reverse().map(closed =>
      command(`${closed.tab.name}${closed.reset ? " before reset" : ""}`, { kind: "tabs.reopen", closed: closed.id ?? closed.tab.id }, "undo")) });
    return items;
  }
  function menu(id: string, invoker: HTMLElement, anchor: HTMLElement | { x: number; y: number } = invoker) {
    const captured = tabs.capture?.(id) ?? (() => allowed);
    openMenu(capturedItems(menuItems(id, invoker), () => { const current = captured(); if (!current.available) feedback.announce(current.reason ?? "That tab changed."); return current.available; }), anchor, { label: tabs.snapshot().tabs.find(tab => tab.id === id)?.name ?? "Tab", invoker });
  }
  function substitution(view: LayoutDefaultView, invoker: HTMLElement, reset?: string) {
    choiceForm?.close(false);
    let choice: SubstitutionChoice = {}, note = "", active = true;
    const captured = tabs.capture?.(reset) ?? (() => allowed);
    const action = () => ({ ...defaultAction(view, reset), choice });
    const snapshot = () => {
      if (!active || !captured().available) return { fields: [], capability: { available: false, reason: "That tab changed. Open the command again." } };
      // Re-read candidates, dropping choices removed by another edit while this form was open.
      let plan = tabs.substitution(view.id, choice);
      if (!("subjects" in plan)) {
        const fresh = tabs.substitution(view.id);
        if (!("subjects" in fresh)) return { fields: [], capability: fresh };
        choice = { subjects: Object.fromEntries(fresh.subjects.map(slot => [slot.key, slot.candidates.find(ref => subjectKey(ref) === subjectKey(choice.subjects?.[slot.key] ?? undefined)) ?? null])),
          looks: Object.fromEntries(fresh.looks.map(slot => [slot.key, slot.candidates.find(ref => lookKey(ref) === lookKey(choice.looks?.[slot.key] ?? undefined)) ?? null])) };
        note = "A choice is no longer available. Choose another, or leave it empty.";
        plan = tabs.substitution(view.id, choice);
        if (!("subjects" in plan)) return { fields: [], capability: plan };
      }
      choice = { subjects: Object.fromEntries(plan.subjects.map(slot => [slot.key, slot.chosen ?? null])),
        looks: Object.fromEntries(plan.looks.map(slot => [slot.key, slot.chosen ?? null])), scenes: Object.fromEntries(plan.scenes.map(scene => [scene.key, scene.chosen ?? null])) };
      const fields: ChoicePopoverField[] = [];
      for (const slot of plan.subjects) fields.push({ key: `subject:${slot.key}`, label: "Show which V?", name: `V ${slot.key} for ${view.name}`,
        value: subjectKey(slot.chosen), options: [...slot.candidates.map(ref => ({ value: subjectKey(ref), label: tabs.subject(ref) })), { value: "", label: "Leave empty" }] });
      for (const scene of plan.scenes) fields.push({ key: `scene:${scene.key}`,
        label: scene.viewTitles.length ? `Scene · ${scene.viewTitles.join(", ")}` : "Scene",
        name: `Scene ${scene.key} for ${view.name}`,
        value: scene.chosen ?? "", options: [...scene.shares.map(item => ({ value: item.scene, label: `Share the scene of ${tabs.snapshot().tabs.find(tab => tab.id === item.tab)?.name ?? "tab"} · ${item.subject ? tabs.subject(item.subject) : "Leave empty"} · ${item.look ? tabs.look(item.look) : "Leave empty"}` })), { value: "", label: "New scene" }] });
      for (const slot of plan.looks.filter(slot => slot.needed)) fields.push({ key: `look:${slot.key}`, label: "Show which look?", name: `Look ${slot.key} for ${view.name}`,
        value: lookKey(slot.chosen), search: slot.candidates.length > 8,
        options: [...slot.candidates.map(ref => ({ value: lookKey(ref), label: tabs.look(ref), group: tabs.collection(ref.collection) })), { value: "", label: "Leave empty" }] });
      return { fields, note: [note, plan.scenes.some(scene => scene.chosen) ? "Sharing a scene means lighting and look changes show in both tabs." : ""].filter(Boolean).join(" "), capability: cap(action()) };
    };
    choiceForm = openChoicePopover(invoker, { title: `${reset ? "Reset tab" : "New tab"}: ${view.name}`, apply: reset ? "Reset" : "Create", invoker, snapshot,
      select: (key, value) => {
        const [kind, slot] = key.split(":") as [string, string];
        if (kind === "subject") choice = { ...choice, subjects: { ...choice.subjects, [slot]: value ? JSON.parse(value) as SubjectRef : null }, scenes: {} };
        else if (kind === "look") choice = { ...choice, looks: { ...choice.looks, [slot]: value ? JSON.parse(value) as LookRef : null } };
        else choice = { ...choice, scenes: { ...choice.scenes, [slot]: value || null } };
      }, commit: () => { if (captured().available) run(action()); }, onClose: () => { active = false; choiceForm = undefined; } });
  }
  function key(event: KeyboardEvent, id: string, tab: HTMLButtonElement) {
    const binding = keyBinding("tabs", event), ids = tabs.snapshot().tabs.map(tab => tab.id), at = ids.indexOf(id);
    if (!binding) return;
    switch (binding.id) {
      case "tabs.switch": event.preventDefault(); event.stopPropagation(); show(ids[event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (at + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]!, true); break;
      case "tabs.reorder": event.preventDefault(); event.stopPropagation(); if (run({ kind: "tabs.move", tab: id, to: at + (event.key === "ArrowRight" ? 1 : -1) })) { strip.tab(id)?.focus(); feedback.announce(`${tabs.snapshot().tabs.find(tab => tab.id === id)?.name} moved to ${tabs.snapshot().tabs.findIndex(tab => tab.id === id) + 1}`); } break;
      case "tabs.rename": event.preventDefault(); event.stopPropagation(); rename(id, tab); break;
      case "tabs.close": event.preventDefault(); event.stopPropagation(); if (run({ kind: "tabs.close", tab: id })) (strip.tab(tabs.snapshot().shown) ?? add).focus(); break;
      case "tabs.menu": event.preventDefault(); event.stopPropagation(); menu(id, tab); break;
      case "tabs.content": event.preventDefault(); event.stopPropagation(); deps.dock.querySelector<HTMLElement>(".dock-tab[aria-selected=true], button, [tabindex='0']")?.focus(); break;
    }
  }
  function globalKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || isTextInput(event.target) || document.querySelector("dialog[open], .popover")) return false;
    const binding = keyBinding("global", event);
    if (!binding?.id.startsWith("layout-tabs.")) return false;
    const state = tabs.snapshot(), ids = state.tabs.map(tab => tab.id), at = ids.indexOf(state.shown);
    const index = binding.id === "layout-tabs.number" ? event.key === "9" ? ids.length - 1 : Number(event.key) - 1
      : (at + (event.key === "PageDown" ? 1 : -1) + ids.length) % ids.length;
    event.preventDefault(); if (ids[index]) show(ids[index]!, true); return true;
  }
  function drag(event: PointerEvent, id: string) {
    if (event.button !== 0 || !cap({ kind: "tabs.move", tab: id, to: 0 }).available) return;
    const start = event.clientX; let dragging = false, to = -1;
    cancelDrag?.();
    const clear = () => { strip.tabs.forEach(tab => { tab.classList.remove("drop-before", "drop-after"); }); };
    const move = (event: PointerEvent) => {
      if (!dragging && Math.abs(event.clientX - start) < 5) return;
      dragging = true; element.classList.add("dragging"); strip.tab(id)?.classList.add("dragging"); clear();
      const rect = element.getBoundingClientRect(); to = -1;
      if (event.clientY < rect.top || event.clientY > rect.bottom || event.clientX < rect.left || event.clientX > rect.right) return;
      const ids = tabs.snapshot().tabs.map(tab => tab.id), others = ids.filter(item => item !== id);
      const target = others.find(other => { const box = strip.tab(other)!.getBoundingClientRect(); return !strip.tab(other)!.hidden && event.clientX < box.left + box.width / 2; });
      to = target ? others.indexOf(target) : others.length;
      if (target) strip.tab(target)?.classList.add("drop-before"); else if (others.length) strip.tab(others.at(-1)!)?.classList.add("drop-after");
    };
    const cancel = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", end);
      clear(); element.classList.remove("dragging"); strip.tab(id)?.classList.remove("dragging");
      cancelDrag = undefined;
    };
    const end = (event: PointerEvent) => {
      cancel();
      if (dragging) { suppressClick = true; clearTimeout(clickTimer); clickTimer = setTimeout(() => { suppressClick = false; }); if (event.type !== "pointercancel" && to >= 0 && run({ kind: "tabs.move", tab: id, to })) feedback.announce("Tab reordered"); }
    };
    cancelDrag = cancel;
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
  }
  function commands(): Command[] {
    const state = tabs.snapshot(), current = state.tabs.find(tab => tab.id === state.shown), defaults = tabs.defaults();
    const captured = tabs.capture?.() ?? (() => allowed);
    const command = (id: string, title: string, action: LayoutTabAction): Command => ({ id, title, group: "Layout tabs", icon: "layouts", capability: () => captured().available ? cap(action) : captured(), run: () => { if (captured().available) run(action); } });
    return [...state.tabs.map(tab => command(`tab.${tab.id}`, `Tab: ${tab.name}`, { kind: "tabs.show", tab: tab.id })),
      ...defaults.map(view => ({ ...command(`tab.new.${view.id}`, `New tab: ${view.name}`, { kind: "tabs.new", default: view.id }), run: () => { if (captured().available) choose(view, add); } })),
      ...(current ? [...defaults.map(view => ({ ...command(`tab.reset.${view.id}`, `Reset tab to ${view.name}`, { kind: "tabs.reset", tab: current.id, default: view.id }), run: () => { if (captured().available) choose(view, strip.tab(current.id) ?? add, current.id); } })),
        { ...command("tab.saveDefault", "Save tab as default…", { kind: "tabs.saveAsDefault", tab: current.id, name: current.name }), run: () => { if (captured().available) rename(current.id, strip.tab(current.id) ?? add, true); } },
        command("tab.close", "Close tab", { kind: "tabs.close", tab: current.id })] : []),
      ...(state.closed.length ? [command("tab.reopen", "Reopen closed tab", { kind: "tabs.reopen" })] : []),
      { id: "tab.new", title: "New tab…", group: "Layout tabs", icon: "plus", capability: () => defaults.some(view => cap({ kind: "tabs.new", default: view.id }).available) ? allowed : { available: false, reason: "No tab can be created here." }, run: () => newMenu() }];
  }
  const off = tabs.subscribe(sync);
  const dispose = () => { off(); observer?.disconnect(); choiceForm?.close(false); cancelDrag?.(); clearTimeout(clickTimer); };
  deps.signal?.addEventListener("abort", dispose, { once: true });
  sync();
  return { dispose, element, strip, add, sync, fit, menu, menuItems, newMenu, rename, commands, globalKey };
}
