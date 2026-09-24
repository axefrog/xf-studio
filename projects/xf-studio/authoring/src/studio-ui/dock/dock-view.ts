import { clamp, h, setAttr } from "../dom";
import { icon, type IconName } from "../icons";
import { openMenu, type MenuItem } from "../menu";
import { activate, allGroups, applyDrop, closePanel, findGroup, locate, openPanel, raiseWindow, recoverWindows,
  setMaximized, setSizes, setWindowRect, showPanelDocked, MIN_WINDOW, type DockNode, type DockState, type DockTree,
  type DragSource, type DropTarget, type GroupNode, type PanelId, type Rect, type Side, type SizeClass } from "./layout";
import { previewRect, resolveDrop, type DropGeometry, type DropResolution, type TargetGroup } from "./snap";

export type PanelSpec = {
  id: PanelId; title: string; icon: IconName; description: string;
  element: HTMLElement;
  /** Called after each layout when the panel becomes shown or hidden. */
  visibility?(visible: boolean): void;
};
export type DockViewOptions = {
  panels: PanelSpec[];
  state: DockState;
  sizeClass(): SizeClass;
  defaults(sizeClass: SizeClass): DockTree;
  save(state: DockState): void;
  announce(message: string): void;
  beforeLayout?(): void;
  afterLayout?(): void;
};
const MIN_GROUP = { w: 150, h: 96 };
const sideNames: Record<Side, string> = { left: "left", right: "right", top: "above", bottom: "below" };
const edgeNames: Record<Side, string> = { left: "Left edge", right: "Right edge", top: "Top edge", bottom: "Bottom edge" };

/** Renders a DockTree and turns pointer/keyboard input into pure layout operations. */
export class DockView {
  readonly element: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly floatingLayer: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly parking: HTMLElement;
  private readonly panels = new Map<PanelId, PanelSpec>();
  private state: DockState;
  private visible = new Set<PanelId>();
  private drag?: DragSession;
  private moveMode?: { windowId: string; cleanup(): void };

  constructor(private options: DockViewOptions) {
    for (const panel of options.panels) this.panels.set(panel.id, panel);
    this.state = structuredClone(options.state);
    this.surface = h("div", { class: "dock-surface" });
    this.floatingLayer = h("div", { class: "dock-floating" });
    this.overlay = h("div", { class: "dock-overlay", "aria-hidden": "true" });
    this.parking = h("div", { class: "dock-parking", hidden: true });
    this.element = h("div", { class: "dock" }, this.surface, this.floatingLayer, this.overlay, this.parking);
    for (const panel of options.panels) this.parking.append(panel.element);
  }
  get sizeClass() { return this.options.sizeClass(); }
  get tree(): DockTree { return this.state[this.sizeClass]; }
  get dockState(): DockState { return structuredClone(this.state); }
  panel(id: PanelId) { return this.panels.get(id); }
  panelList(): PanelSpec[] { return [...this.panels.values()]; }
  isVisible(id: PanelId) { return this.visible.has(id); }
  isOpen(id: PanelId) { return !!locate(this.tree, id); }

  /** Replace the active size class's tree, render, persist and announce. */
  update(tree: DockTree, message?: string, persist = true) {
    const area = this.area();
    if (area.w > 40 && area.h > 40) tree = recoverWindows(tree, area);
    this.state = { ...this.state, [this.sizeClass]: tree };
    this.render();
    if (persist) this.options.save(this.dockState);
    if (message) this.options.announce(message);
  }
  area(): Rect {
    const rect = this.element.getBoundingClientRect();
    return { x: 0, y: 0, w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }
  /** Re-clamp floating windows (window resize, restored layouts) without persisting noise. */
  recover(persist = false) {
    const area = this.area();
    if (area.w < 40 || area.h < 40) return;
    const tree = recoverWindows(this.tree, area);
    if (JSON.stringify(tree) !== JSON.stringify(this.tree)) this.update(tree, undefined, persist);
  }

  render() {
    this.options.beforeLayout?.();
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const tree = this.tree;
    for (const panel of this.panels.values()) if (panel.element.parentElement !== this.parking) this.parking.append(panel.element);
    const shown = new Set<PanelId>();
    this.surface.replaceChildren();
    this.floatingLayer.replaceChildren();
    const maximized = tree.maximized ? findGroup(tree, tree.maximized)?.group : undefined;
    if (maximized) this.surface.append(this.renderGroup(maximized, false, shown, true));
    else if (tree.root) this.surface.append(this.renderNode(tree.root, false, shown));
    else this.surface.append(h("div", { class: "dock-empty" },
      h("p", { text: "Every panel is floating or closed." }),
      h("p", { class: "muted", text: "Drag a panel onto an edge guide, or reset the layout." }),
      h("button", { class: "btn", type: "button", text: "Reset layout", onclick: () => this.reset() })));
    // Floating windows stay available above a maximized docked group.
    tree.floating.forEach((window, index) => this.floatingLayer.append(this.renderWindow(window, index, shown)));
    const previous = this.visible;
    this.visible = shown;
    this.condenseTabs();
    this.options.afterLayout?.();
    for (const panel of this.panels.values()) {
      const now = shown.has(panel.id);
      if (now !== previous.has(panel.id)) panel.visibility?.(now);
    }
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  /** Inactive tabs collapse to icons when a strip overflows; the active label stays readable. */
  condenseTabs() {
    for (const strip of this.element.querySelectorAll<HTMLElement>(".dock-tabs")) {
      strip.classList.remove("condensed");
      const bar = strip.parentElement!, available = bar.clientWidth - 64;
      if (strip.scrollWidth > available) strip.classList.add("condensed");
    }
  }
  private renderNode(node: DockNode, floating: boolean, shown: Set<PanelId>): HTMLElement {
    if (node.kind === "group") return this.renderGroup(node, floating, shown);
    const element = h("div", { class: "dock-split", "data-axis": node.axis, "data-split": node.id });
    node.children.forEach((child, index) => {
      if (index > 0) element.append(this.splitter(node.id, node.axis, index));
      const cell = h("div", { class: "dock-cell" });
      cell.style.flex = `${node.sizes[index]} 1 0`;
      cell.append(this.renderNode(child, floating, shown));
      element.append(cell);
    });
    return element;
  }

  private renderGroup(group: GroupNode, floating: boolean, shown: Set<PanelId>, maximized = false): HTMLElement {
    const titles = group.panels.map(id => this.panels.get(id)?.title ?? id);
    const bodyId = `dock-body-${group.id}`;
    const tablist = h("div", { class: "dock-tabs", role: "tablist", "aria-label": `${titles.join(", ")} panels` });
    for (const id of group.panels) {
      const spec = this.panels.get(id)!, active = id === group.active;
      const tab = h("button", { class: "dock-tab", type: "button", role: "tab", id: `dock-tab-${id}`,
        "aria-selected": String(active), "aria-controls": bodyId, tabindex: active ? "0" : "-1",
        "data-panel": id, title: `${spec.title} — drag to move, right-click for layout options` },
        icon(spec.icon), h("span", { class: "dock-tab-label", text: spec.title }),
        h("span", { class: "dock-tab-close", "aria-hidden": "true", title: `Close ${spec.title}`,
          onpointerdown: (event: PointerEvent) => event.stopPropagation(),
          onclick: (event: MouseEvent) => { event.stopPropagation(); this.close(id); } }, icon("close")));
      tab.addEventListener("click", () => { if (!active) this.update(activate(this.tree, id), undefined); });
      tab.addEventListener("auxclick", event => { if (event.button === 1) { event.preventDefault(); this.close(id); } });
      tab.addEventListener("keydown", event => this.tabKey(event, group, id));
      tab.addEventListener("contextmenu", event => { event.preventDefault(); this.openPanelMenu(id, { x: event.clientX, y: event.clientY }, tab); });
      tab.addEventListener("pointerdown", event => this.pointerDown(event, { kind: "panel", panelId: id }, tab));
      tablist.append(tab);
    }
    const window = floating ? this.tree.floating.find(item => findGroup({ root: item.node, floating: [], closed: [] }, group.id)) : undefined;
    const soleWindowGroup = window && window.node.kind === "group";
    const fill = h("div", { class: "dock-tabbar-fill", title: soleWindowGroup ? "Drag to move this floating panel" : "Drag to move this whole group" });
    fill.addEventListener("pointerdown", event => this.pointerDown(event,
      soleWindowGroup ? { kind: "window", windowId: window!.id } : { kind: "group", groupId: group.id }, fill));
    if (!floating) fill.addEventListener("dblclick", () => this.toggleMaximize(group.id));
    const menuButton = h("button", { class: "icon-btn dock-menu-btn", type: "button", "aria-label": `Layout options for ${titles.join(", ")}`,
      "aria-haspopup": "menu", title: "Layout options" }, icon("more"));
    menuButton.addEventListener("click", () => this.openPanelMenu(group.active, menuButton, menuButton));
    const restore = maximized ? h("button", { class: "icon-btn", type: "button", "aria-label": "Restore layout", title: "Restore layout",
      onclick: () => this.toggleMaximize(group.id) }, icon("restore")) : null;
    const body = h("div", { class: "dock-body", role: "tabpanel", id: bodyId, "aria-labelledby": `dock-tab-${group.active}` });
    const active = this.panels.get(group.active);
    if (active) { body.append(active.element); shown.add(active.id); }
    const element = h("section", { class: `dock-group${floating ? " floating" : ""}${maximized ? " maximized" : ""}`,
      "data-group": group.id, "aria-label": `${titles.join(", ")} group` },
      h("div", { class: "dock-tabbar" }, tablist, fill, restore, menuButton), body);
    element.addEventListener("focusin", () => element.classList.add("focus-within"));
    element.addEventListener("focusout", () => element.classList.remove("focus-within"));
    return element;
  }

  private renderWindow(window: DockTree["floating"][number], index: number, shown: Set<PanelId>) {
    const composite = window.node.kind === "split";
    const titles = [...allGroups({ root: window.node, floating: [], closed: [] })].flatMap(entry => entry.group.panels)
      .map(id => this.panels.get(id)?.title ?? id);
    const element = h("div", { class: `dock-window${composite ? " composite" : ""}`, "data-window": window.id,
      role: "group", "aria-label": `Floating ${composite ? "composite" : "panel"}: ${titles.join(", ")}` });
    Object.assign(element.style, { left: `${window.x}px`, top: `${window.y}px`, width: `${window.w}px`, height: `${window.h}px`,
      zIndex: String(10 + index) });
    element.addEventListener("pointerdown", () => {
      if (this.tree.floating.at(-1)?.id !== window.id) {
        const tree = raiseWindow(this.tree, window.id);
        this.state = { ...this.state, [this.sizeClass]: tree };
        for (const [i, item] of tree.floating.entries()) {
          const node = this.floatingLayer.querySelector<HTMLElement>(`[data-window="${item.id}"]`);
          if (node) node.style.zIndex = String(10 + i);
        }
      }
    }, { capture: true });
    if (composite) {
      const bar = h("div", { class: "dock-window-bar", title: "Drag to move the composite" },
        icon("grip"), h("span", { text: `${titles.length} panels · magnetic composite` }),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Composite options", "aria-haspopup": "menu",
          onclick: (event: MouseEvent) => this.openWindowMenu(window.id, event.currentTarget as Element) }, icon("more")));
      bar.addEventListener("pointerdown", event => this.pointerDown(event, { kind: "window", windowId: window.id }, bar));
      element.append(bar);
    }
    element.append(h("div", { class: "dock-window-body" }, this.renderNode(window.node, true, shown)));
    for (const edge of ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const) {
      const handle = h("div", { class: `dock-resize ${edge}`, "aria-hidden": "true" });
      handle.addEventListener("pointerdown", event => this.resizeWindow(event, window.id, edge));
      element.append(handle);
    }
    return element;
  }

  private splitter(splitId: string, axis: "row" | "column", index: number) {
    const element = h("div", { class: "dock-splitter", role: "separator", tabindex: "0",
      "aria-orientation": axis === "row" ? "vertical" : "horizontal",
      "aria-label": `Resize ${axis === "row" ? "columns" : "rows"}`,
      title: "Drag to resize · Arrow keys adjust · Double-click to equalize" });
    const find = (node: DockNode | null): DockNode | undefined => {
      if (!node || node.kind === "group") return;
      if (node.id === splitId) return node;
      for (const child of node.children) { const hit = find(child); if (hit) return hit; }
    };
    const sizes = () => {
      const tree = this.tree;
      const node = find(tree.root) ?? tree.floating.map(window => find(window.node)).find(Boolean);
      return node?.kind === "split" ? [...node.sizes] : [];
    };
    const setValue = (values: number[]) => {
      const pct = Math.round(values[index - 1] / (values[index - 1] + values[index]) * 100);
      setAttr(element, "aria-valuenow", String(pct)); setAttr(element, "aria-valuemin", "0"); setAttr(element, "aria-valuemax", "100");
    };
    setValue(sizes());
    const commit = (values: number[]) => this.update(setSizes(this.tree, splitId, values));
    element.addEventListener("keydown", event => {
      const grow: Record<string, number> = axis === "row" ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
      const step = grow[event.key];
      if (step) {
        event.preventDefault();
        const values = sizes(), pair = values[index - 1] + values[index], delta = pair * .04 * step;
        values[index - 1] = clamp(values[index - 1] + delta, pair * .08, pair * .92);
        values[index] = pair - values[index - 1];
        commit(values);
        this.focusSplitter(splitId, index);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const values = sizes(), pair = values[index - 1] + values[index];
        values[index - 1] = values[index] = pair / 2; commit(values); this.focusSplitter(splitId, index);
      }
    });
    element.addEventListener("dblclick", () => {
      const values = sizes(), pair = values[index - 1] + values[index];
      values[index - 1] = values[index] = pair / 2; commit(values);
    });
    element.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      const parent = element.parentElement!, cells = [...parent.children].filter(child => child.classList.contains("dock-cell")) as HTMLElement[];
      const before = cells[index - 1], after = cells[index];
      const rect = parent.getBoundingClientRect(), total = axis === "row" ? rect.width : rect.height;
      const values = sizes(), pair = values[index - 1] + values[index];
      const pairPx = (axis === "row" ? before.getBoundingClientRect().width + after.getBoundingClientRect().width :
        before.getBoundingClientRect().height + after.getBoundingClientRect().height) || total;
      const start = axis === "row" ? event.clientX : event.clientY;
      const firstPx = axis === "row" ? before.getBoundingClientRect().width : before.getBoundingClientRect().height;
      const min = axis === "row" ? MIN_GROUP.w : MIN_GROUP.h;
      element.classList.add("active");
      let latest = values;
      const move = (e: PointerEvent) => {
        const px = clamp(firstPx + (axis === "row" ? e.clientX : e.clientY) - start, Math.min(min, pairPx / 2), Math.max(pairPx - min, pairPx / 2));
        const next = [...values];
        next[index - 1] = pair * px / pairPx; next[index] = pair - next[index - 1];
        before.style.flex = `${next[index - 1]} 1 0`; after.style.flex = `${next[index]} 1 0`;
        latest = next; setValue(next);
        this.options.afterLayout?.();
      };
      const up = () => {
        element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", up); element.classList.remove("active");
        commit(latest);
      };
      element.addEventListener("pointermove", move); element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", up);
    });
    return element;
  }
  private focusSplitter(splitId: string, index: number) {
    const split = this.element.querySelector(`[data-split="${splitId}"]`);
    ([...(split?.children ?? [])].filter(child => child.classList.contains("dock-splitter"))[index - 1] as HTMLElement | undefined)?.focus();
  }

  private tabKey(event: KeyboardEvent, group: GroupNode, id: PanelId) {
    const index = group.panels.indexOf(id);
    const focusTab = (panel: PanelId) => this.element.querySelector<HTMLElement>(`#dock-tab-${panel}`)?.focus();
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && event.altKey && event.shiftKey) {
      event.preventDefault();
      const to = clamp(index + (event.key === "ArrowRight" ? 2 : -1), 0, group.panels.length);
      const moved = applyDrop(this.tree, { kind: "panel", panelId: id }, { kind: "tab", groupId: group.id, index: to });
      this.update(moved, `${this.title(id)} moved to position ${(locate(moved, id)?.index ?? 0) + 1} of ${group.panels.length}`);
      focusTab(id);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? group.panels.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + group.panels.length) % group.panels.length;
      this.update(activate(this.tree, group.panels[next]));
      focusTab(group.panels[next]);
    } else if (event.key === "Delete") { event.preventDefault(); this.close(id); }
    else if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault(); this.focusContent(id);
    } else if (event.key === "F10" && event.shiftKey || event.key === "ContextMenu") {
      event.preventDefault(); this.openPanelMenu(id, event.currentTarget as Element, event.currentTarget as Element);
    }
  }
  focusContent(id: PanelId) {
    const element = this.panels.get(id)?.element;
    const target = element?.querySelector<HTMLElement>("[data-autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']");
    (target ?? element)?.focus();
  }
  private title(id: PanelId) { return this.panels.get(id)?.title ?? id; }
  private describeGroup(group: GroupNode) { return group.panels.map(id => this.title(id)).join(" · "); }

  // ----- Commands usable from menus, shortcuts and the command palette -----
  reveal(id: PanelId, focus = true) {
    const tree = showPanelDocked(this.isOpen(id) ? activate(this.tree, id) : openPanel(this.tree, id, this.siblingsInDefault(id), this.area()), id);
    this.update(tree, this.isOpen(id) ? undefined : `${this.title(id)} opened`);
    if (focus) requestAnimationFrame(() => this.element.querySelector<HTMLElement>(`#dock-tab-${id}`)?.focus());
  }
  close(id: PanelId) {
    const at = locate(this.tree, id);
    if (!at) return;
    this.update(closePanel(this.tree, id), `${this.title(id)} closed. Reopen it from the Panels menu or command palette.`);
  }
  toggle(id: PanelId) { if (this.isOpen(id)) this.close(id); else this.reveal(id); }
  float(id: PanelId) {
    const at = locate(this.tree, id), area = this.area();
    const rect = this.groupRect(at?.group.id) ?? { x: 0, y: 0, w: 340, h: 420 };
    const w = clamp(Math.max(Math.min(rect.w, 400), 340), MIN_WINDOW.w, area.w - 40), hgt = clamp(Math.max(Math.min(rect.h, 480), 380), MIN_WINDOW.h, area.h - 40);
    const offset = (this.tree.floating.length % 5) * 24;
    this.update(applyDrop(this.tree, { kind: "panel", panelId: id },
      { kind: "float", x: clamp(area.w / 2 - w / 2 + offset, 8, area.w - w - 8), y: clamp(80 + offset, 8, area.h - hgt - 8), w, h: hgt }),
    `${this.title(id)} is floating. Use Move window from its menu to reposition it with the keyboard.`);
  }
  moveTo(id: PanelId, target: DropTarget, message: string) {
    this.update(showPanelDocked(applyDrop(this.tree, { kind: "panel", panelId: id }, target, this.groupRect(locate(this.tree, id)?.group.id)), id), message);
    requestAnimationFrame(() => this.element.querySelector<HTMLElement>(`#dock-tab-${id}`)?.focus());
  }
  toggleMaximize(groupId: string) {
    const on = this.tree.maximized !== groupId;
    this.update(setMaximized(this.tree, on ? groupId : undefined), on ? "Group maximized. Double-click its tab bar or use Restore to return." : "Layout restored");
  }
  reset() {
    this.update(this.options.defaults(this.sizeClass), `${this.sizeClass === "wide" ? "Wide" : "Compact"} layout reset`);
  }
  private siblingsInDefault(id: PanelId) {
    const home = locate(this.options.defaults(this.sizeClass), id);
    return home ? home.group.panels.filter(item => item !== id) : [];
  }
  private groupRect(groupId?: string): Rect | undefined {
    if (!groupId) return;
    const element = this.element.querySelector<HTMLElement>(`[data-group="${groupId}"]`);
    if (!element) return;
    const base = this.element.getBoundingClientRect(), rect = element.getBoundingClientRect();
    return { x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height };
  }

  /** Keyboard-accessible alternatives to every drag operation. */
  panelMenuItems(id: PanelId): MenuItem[] {
    const tree = this.tree, at = locate(tree, id);
    if (!at) return [{ kind: "action", label: `Open ${this.title(id)}`, icon: "plus", run: () => this.reveal(id) }];
    const others = allGroups(tree).filter(entry => entry.group.id !== at.group.id);
    const floatingWindow = at.windowId ? tree.floating.find(window => window.id === at.windowId) : undefined;
    const label = (entry: { group: GroupNode; windowId?: string }) => `${this.describeGroup(entry.group)}${entry.windowId ? " (floating)" : ""}`;
    const items: MenuItem[] = [
      { kind: "heading", label: this.title(id), detail: at.windowId ? "Floating" : `Docked${at.group.panels.length > 1 ? ` with ${at.group.panels.filter(p => p !== id).map(p => this.title(p)).join(", ")}` : ""}` },
    ];
    if (!at.windowId || at.group.panels.length > 1 || floatingWindow?.node.kind === "split")
      items.push({ kind: "action", label: "Float panel", icon: "float", run: () => this.float(id) });
    if (floatingWindow) items.push({ kind: "action", label: "Move or resize window…", icon: "layout",
      hint: "Arrow keys move · Shift+Arrow resizes · Enter finishes", run: () => this.startMoveMode(floatingWindow.id) });
    items.push(
      { kind: "submenu", label: "Add as tab to", icon: "layers", capability: others.length ? undefined : { available: false, reason: "No other panel group is open." },
        items: () => others.map(entry => ({ kind: "action", label: label(entry), run: () =>
          this.moveTo(id, { kind: "tab", groupId: entry.group.id, index: entry.group.panels.length }, `${this.title(id)} added as a tab to ${this.describeGroup(entry.group)}`) })) },
      { kind: "submenu", label: "Place beside", icon: "dock", capability: others.length ? undefined : { available: false, reason: "No other panel group is open." },
        items: () => others.map(entry => ({ kind: "submenu", label: label(entry), items: () => (["left", "right", "top", "bottom"] as Side[]).map(side => ({
          kind: "action", label: `${entry.windowId ? "Attach" : "Split"} ${sideNames[side]}`,
          run: () => this.moveTo(id, { kind: "split", groupId: entry.group.id, side },
            `${this.title(id)} ${entry.windowId ? "attached" : "placed"} ${sideNames[side]} ${this.describeGroup(entry.group)}${entry.windowId ? " as a magnetic composite" : ""}`) })) })) },
      { kind: "submenu", label: "Dock to workspace edge", icon: "layout", items: () => (["left", "right", "top", "bottom"] as Side[]).map(side => ({
        kind: "action", label: edgeNames[side], run: () => this.moveTo(id, { kind: "edge", side }, `${this.title(id)} docked to the ${edgeNames[side].toLowerCase()}`) })) },
      { kind: "action", label: tree.maximized === at.group.id ? "Restore group size" : "Maximize group", icon: tree.maximized === at.group.id ? "restore" : "maximize",
        capability: at.windowId ? { available: false, reason: "Floating panels are already above the dock; resize the window instead." } : undefined,
        run: () => this.toggleMaximize(at.group.id) },
      { kind: "separator" },
      { kind: "action", label: `Close ${this.title(id)}`, icon: "close", shortcut: "Del", run: () => this.close(id) },
    );
    if (at.group.panels.length > 1) items.splice(1, 0, { kind: "submenu", label: "Show tab", icon: "chevronRight",
      items: () => at.group.panels.map(panel => ({ kind: "action", label: this.title(panel), checked: panel === at.group.active,
        run: () => { this.update(activate(this.tree, panel)); this.element.querySelector<HTMLElement>(`#dock-tab-${panel}`)?.focus(); } })) });
    return items;
  }
  openPanelMenu(id: PanelId, anchor: Element | { x: number; y: number }, invoker?: Element) {
    openMenu([...this.panelMenuItems(id), { kind: "separator" },
      { kind: "action", label: "Reset layout", icon: "reset", run: () => this.reset() }], anchor, { label: `${this.title(id)} layout options`, invoker });
  }
  private openWindowMenu(windowId: string, anchor: Element) {
    const window = this.tree.floating.find(item => item.id === windowId);
    if (!window) return;
    const others = allGroups(this.tree).filter(entry => entry.windowId !== windowId);
    openMenu([
      { kind: "heading", label: "Magnetic composite" },
      { kind: "action", label: "Move or resize window…", icon: "layout", run: () => this.startMoveMode(windowId) },
      { kind: "submenu", label: "Dock composite to edge", icon: "dock", items: () => (["left", "right", "top", "bottom"] as Side[]).map(side => ({
        kind: "action", label: edgeNames[side], run: () => this.update(applyDrop(this.tree, { kind: "window", windowId }, { kind: "edge", side }), `Composite docked to the ${edgeNames[side].toLowerCase()}`) })) },
      { kind: "submenu", label: "Merge into group as tabs", icon: "layers", capability: others.length ? undefined : { available: false, reason: "No other group is open." },
        items: () => others.map(entry => ({ kind: "action", label: this.describeGroup(entry.group), run: () =>
          this.update(applyDrop(this.tree, { kind: "window", windowId }, { kind: "tab", groupId: entry.group.id, index: entry.group.panels.length }), "Composite merged as tabs") })) },
    ], anchor, { label: "Composite options", invoker: anchor });
  }

  /** Keyboard move/resize for a floating window. */
  startMoveMode(windowId: string) {
    this.moveMode?.cleanup();
    const element = this.element.querySelector<HTMLElement>(`[data-window="${windowId}"]`);
    if (!element) return;
    element.classList.add("moving");
    element.tabIndex = -1; element.focus();
    this.options.announce("Move mode: arrow keys move, Shift with arrows resizes, Enter or Escape finishes.");
    const key = (event: KeyboardEvent) => {
      const window = this.tree.floating.find(item => item.id === windowId);
      if (!window) { cleanup(); return; }
      const step = event.ctrlKey ? 2 : 16;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (dx || dy) {
        event.preventDefault(); event.stopPropagation();
        const rect = event.shiftKey ? { w: Math.max(MIN_WINDOW.w, window.w + dx), h: Math.max(MIN_WINDOW.h, window.h + dy) }
          : { x: window.x + dx, y: window.y + dy };
        this.state = { ...this.state, [this.sizeClass]: recoverWindows(setWindowRect(this.tree, windowId, rect), this.area()) };
        const next = this.tree.floating.find(item => item.id === windowId)!;
        Object.assign(element.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
        this.options.afterLayout?.();
      } else if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cleanup(); }
    };
    const cleanup = () => {
      element.removeEventListener("keydown", key, true); element.classList.remove("moving");
      this.moveMode = undefined; this.options.save(this.dockState); this.options.announce("Window position saved");
      element.querySelector<HTMLElement>(".dock-tab[aria-selected=true]")?.focus();
    };
    element.addEventListener("keydown", key, true);
    element.addEventListener("focusout", event => { if (!element.contains(event.relatedTarget as Node)) this.moveMode?.cleanup(); });
    this.moveMode = { windowId, cleanup };
  }

  private resizeWindow(event: PointerEvent, windowId: string, edge: string) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget as HTMLElement, element = handle.parentElement!;
    handle.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY }, window = this.tree.floating.find(item => item.id === windowId)!;
    let rect = { x: window.x, y: window.y, w: window.w, h: window.h };
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x, dy = e.clientY - start.y, next = { x: window.x, y: window.y, w: window.w, h: window.h };
      if (edge.includes("e")) next.w = Math.max(MIN_WINDOW.w, window.w + dx);
      if (edge.includes("s")) next.h = Math.max(MIN_WINDOW.h, window.h + dy);
      if (edge.includes("w")) { next.w = Math.max(MIN_WINDOW.w, window.w - dx); next.x = window.x + window.w - next.w; }
      if (edge.includes("n")) { next.h = Math.max(MIN_WINDOW.h, window.h - dy); next.y = window.y + window.h - next.h; }
      rect = next;
      Object.assign(element.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
      this.options.afterLayout?.();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      this.update(recoverWindows(setWindowRect(this.tree, windowId, rect), this.area()));
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  }

  // ----- Pointer drag with cursor-position snapping -----
  private pointerDown(event: PointerEvent, source: DragSource, handle: HTMLElement) {
    if (event.button !== 0 || this.drag) return;
    const start = { x: event.clientX, y: event.clientY };
    const pending = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      stop();
      this.beginDrag(e, source, handle, start);
    };
    const stop = () => { window.removeEventListener("pointermove", pending); window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop); };
    window.addEventListener("pointermove", pending);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  private sourceGroups(source: DragSource): Set<string> {
    const tree = this.tree;
    if (source.kind === "group") return new Set([source.groupId]);
    if (source.kind === "window") {
      const window = tree.floating.find(item => item.id === source.windowId);
      return new Set(window ? allGroups({ root: window.node, floating: [], closed: [] }).map(entry => entry.group.id) : []);
    }
    const at = locate(tree, source.panelId);
    return new Set(at && at.group.panels.length === 1 ? [at.group.id] : []);
  }
  private geometry(exclude: Set<string>): DropGeometry {
    const base = this.element.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    const groups: TargetGroup[] = [];
    const windows = [...this.floatingLayer.querySelectorAll<HTMLElement>(".dock-window")]
      .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    const collect = (scope: ParentNode, floating: boolean) => {
      for (const element of scope.querySelectorAll<HTMLElement>(".dock-group")) {
        const id = element.dataset.group!;
        if (exclude.has(id)) continue;
        const strip = element.querySelector<HTMLElement>(".dock-tabbar")!;
        groups.push({ id, floating, rect: rel(element.getBoundingClientRect()), tabStrip: rel(strip.getBoundingClientRect()),
          tabs: [...element.querySelectorAll<HTMLElement>(".dock-tab")].map(tab => rel(tab.getBoundingClientRect())) });
      }
    };
    for (const window of windows) collect(window, true);
    collect(this.surface, false);
    return { workspace: { x: 0, y: 0, w: base.width, h: base.height }, groups };
  }
  private beginDrag(event: PointerEvent, source: DragSource, handle: HTMLElement, start: { x: number; y: number }) {
    const base = this.element.getBoundingClientRect();
    const tree = this.tree;
    const exclude = this.sourceGroups(source);
    const geometry = this.geometry(exclude);
    const windowElement = source.kind === "window" ? this.floatingLayer.querySelector<HTMLElement>(`[data-window="${source.windowId}"]`) : null;
    const window = source.kind === "window" ? tree.floating.find(item => item.id === source.windowId) : undefined;
    const sourceGroupId = source.kind === "panel" ? locate(tree, source.panelId)?.group.id : source.kind === "group" ? source.groupId : undefined;
    const sourceRect = window ? { x: window.x, y: window.y, w: window.w, h: window.h } : this.groupRect(sourceGroupId) ?? { x: 0, y: 0, w: 320, h: 360 };
    const grab = { x: start.x - base.left - sourceRect.x, y: start.y - base.top - sourceRect.y };
    const floatSize = { w: clamp(sourceRect.w, 300, 420), h: clamp(sourceRect.h, 340, 480) };
    const label = source.kind === "panel" ? this.title(source.panelId) : source.kind === "group"
      ? this.describeGroup(findGroup(tree, source.groupId)!.group) : "Composite";
    const ghost = source.kind === "window" ? null : h("div", { class: "dock-ghost" }, icon("grip"), h("span", { text: label }));
    if (ghost) this.overlay.append(ghost);
    const preview = h("div", { class: "dock-preview" });
    const cursorMark = h("div", { class: "dock-cursor-mark" });
    this.overlay.append(preview, cursorMark);
    this.element.classList.add("dragging");
    handle.setPointerCapture?.(event.pointerId);
    const session: DragSession = { source, resolution: undefined, cancel: () => finish(true) };
    this.drag = session;
    let latestCursor = { x: event.clientX - base.left, y: event.clientY - base.top };
    const paint = (cursor: { x: number; y: number }, suppress: boolean) => {
      latestCursor = cursor;
      const resolution = resolveDrop(cursor, geometry, { suppress });
      session.resolution = resolution;
      if (windowElement && window) {
        windowElement.style.left = `${cursor.x - grab.x}px`; windowElement.style.top = `${cursor.y - grab.y}px`;
      }
      if (ghost) { ghost.style.left = `${cursor.x + 22}px`; ghost.style.top = `${cursor.y + 26}px`; }
      cursorMark.style.left = `${cursor.x}px`; cursorMark.style.top = `${cursor.y}px`;
      this.paintGuides(resolution);
      const target = resolution.target;
      if (target.kind === "float") {
        if (source.kind === "window") preview.hidden = true;
        else {
          preview.hidden = false; preview.classList.add("float");
          Object.assign(preview.style, rectStyle({ x: cursor.x - Math.min(grab.x, floatSize.w - 24), y: cursor.y - Math.min(grab.y, 20), ...floatSize }));
        }
      } else {
        preview.hidden = false; preview.classList.remove("float");
        Object.assign(preview.style, rectStyle(previewRect(target, geometry, floatSize)));
      }
      preview.dataset.label = resolution.active?.label ?? (target.kind === "float" ? (source.kind === "window" ? "" : "Float here") : "");
    };
    const move = (e: PointerEvent) => paint({ x: e.clientX - base.left, y: e.clientY - base.top }, e.ctrlKey);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(true); }
      else if (e.key === "Control") paint(latestCursor, e.type === "keydown");
    };
    const up = () => finish(false);
    const finish = (cancel: boolean) => {
      window_.removeEventListener("pointermove", move, true); window_.removeEventListener("pointerup", up, true);
      window_.removeEventListener("pointercancel", cancelDrag, true);
      window_.removeEventListener("keydown", key, true); window_.removeEventListener("keyup", key, true);
      this.overlay.replaceChildren(); this.element.classList.remove("dragging");
      this.drag = undefined;
      if (cancel) {
        if (windowElement && window) Object.assign(windowElement.style, { left: `${window.x}px`, top: `${window.y}px` });
        this.options.announce("Move cancelled");
        return;
      }
      const target = session.resolution?.target ?? { kind: "float", x: latestCursor.x, y: latestCursor.y };
      let drop: DropTarget = target;
      if (target.kind === "float") {
        drop = source.kind === "window"
          ? { kind: "float", x: latestCursor.x - grab.x, y: latestCursor.y - grab.y }
          : { kind: "float", x: latestCursor.x - Math.min(grab.x, floatSize.w - 24), y: latestCursor.y - Math.min(grab.y, 20), ...floatSize };
      }
      this.update(showPanelDocked(applyDrop(this.tree, source, drop, sourceRect), source.kind === "panel" ? source.panelId : ""), describeDrop(label, drop, session.resolution));
    };
    const cancelDrag = () => finish(true);
    const window_ = globalThis.window;
    window_.addEventListener("pointermove", move, true);
    window_.addEventListener("pointerup", up, true);
    window_.addEventListener("pointercancel", cancelDrag, true);
    window_.addEventListener("keydown", key, true);
    window_.addEventListener("keyup", key, true);
    paint(latestCursor, event.ctrlKey);
  }
  private paintGuides(resolution: DropResolution) {
    for (const old of this.overlay.querySelectorAll(".dock-guide")) old.remove();
    for (const guide of resolution.guides) {
      const target = guide.target;
      const kind = target.kind === "split" || target.kind === "edge" ? target.side : "tab";
      const element = h("div", { class: `dock-guide ${guide.target.kind} ${kind}${resolution.active === guide ? " active" : ""}`, title: guide.label });
      Object.assign(element.style, rectStyle(guide.rect));
      this.overlay.append(element);
    }
    if (resolution.active && !resolution.guides.includes(resolution.active)) {
      const element = h("div", { class: "dock-guide band active" });
      Object.assign(element.style, rectStyle(resolution.active.rect));
      this.overlay.append(element);
    }
  }
  cancelDrag() { this.drag?.cancel(); }
  dragging() { return !!this.drag; }
}

type DragSession = { source: DragSource; resolution?: DropResolution; cancel(): void };
const rectStyle = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
function describeDrop(label: string, target: DropTarget, resolution?: DropResolution) {
  if (target.kind === "float") return `${label} floating`;
  return `${label}: ${resolution?.active?.label?.toLowerCase() ?? "moved"}`;
}
