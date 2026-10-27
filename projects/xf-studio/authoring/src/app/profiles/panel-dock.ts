/** Instance membership changes use the shared dock model, preserving every surviving panel's current arrangement. */
import { applyDrop, closePanel, closePanels, detachPanel, locate, revealPanel, summonPanel, unparkPanels, type DockState, type DockTree, type ParkedPlace } from "../../platform/core/dock-layout";
import type { DockLayout, JsonValue } from "../ui-preferences";

const empty = (): DockTree => ({ root: null, floating: [], closed: [] });
export function panelDock(layout: DockLayout | null): DockState {
  const state = layout?.state as Partial<DockState> | undefined;
  return structuredClone({ wide: { ...empty(), ...state?.wide }, compact: { ...empty(), ...state?.compact } });
}
export function dockWith(layout: DockLayout | null, state: DockState): DockLayout {
  const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  for (const size of ["wide", "compact"] as const) {
    if (state[size].lastPlace) state[size].lastPlace = sorted(state[size].lastPlace!);
    if (state[size].parked) state[size].parked = sorted(state[size].parked!);
  }
  return { format: layout?.format ?? "xfs/dock", version: layout?.version ?? 1, state: state as unknown as JsonValue };
}
export function openIn(layout: DockLayout | null, instance: string, size: keyof DockState): boolean {
  const tree = (layout?.state as Partial<DockState> | undefined)?.[size];
  return !!tree && !!locate({ ...empty(), ...tree }, instance);
}
export function changePanelDock(layout: DockLayout | null, instance: string, mode: "show" | "remove" | "reveal" | "erase",
  factory: DockLayout | null = null): DockLayout {
  const state = panelDock(layout), fallback = panelDock(factory);
  for (const size of ["wide", "compact"] as const) {
    const tree = state[size];
    state[size] = mode === "remove" ? closePanel(tree, instance) : mode === "erase" ? detachPanel(tree, instance)
      : mode === "reveal" ? revealPanel(tree, instance)
      : summonPanel(tree, instance, fallback[size], { x: 40, y: 40, w: 400, h: 560 });
    if (mode === "erase" && state[size].parked?.[instance]) {
      const { [instance]: _removed, ...kept } = state[size].parked;
      if (Object.keys(kept).length) state[size].parked = kept; else delete state[size].parked;
    }
  }
  return dockWith(layout, state);
}
export function removePanelsDock(layout: DockLayout | null, instances: readonly string[]): DockLayout {
  const state = panelDock(layout);
  for (const size of ["wide", "compact"] as const) state[size] = closePanels(state[size], instances);
  return dockWith(layout, state);
}
/** Membership replay closes the complete set before reopening any member; existing places take priority over old history places. */
export function replayPanelsDock(layout: DockLayout | null, members: readonly { instance: string; recordedPlace: boolean; open: Record<keyof DockState, boolean>;
  closed: Record<keyof DockState, boolean>; closedIndex: Record<keyof DockState, number>; parked: Partial<Record<keyof DockState, ParkedPlace>>; places: Partial<Record<keyof DockState, ParkedPlace>>; latest?: Partial<Record<keyof DockState, ParkedPlace>> }[]): DockLayout {
  const state = panelDock(layout), fallback: DockTree = { root: null, floating: [], closed: [] };
  for (const size of ["wide", "compact"] as const) {
    state[size] = closePanels(state[size], members.filter(member => !member.open[size]).map(member => member.instance));
    for (const { instance, recordedPlace, open, closed, parked, places, latest } of members) if (!open[size]) {
      if (closed[size]) {
        if (!state[size].closed.includes(instance)) state[size].closed.push(instance);
        const place = !recordedPlace && latest?.[size] || places[size];
        if ((recordedPlace || latest?.[size] || !state[size].lastPlace?.[instance]) && place && !("closed" in place)) state[size].lastPlace = { ...state[size].lastPlace, [instance]: place };
      } else {
        state[size] = detachPanel(state[size], instance);
        if (parked[size]) state[size].parked = { ...state[size].parked, [instance]: parked[size]! };
      }
    }
    const ordered = members.filter(member => member.closed[size] && member.recordedPlace).sort((a, b) => a.closedIndex[size] - b.closedIndex[size]);
    for (const member of ordered) state[size].closed = state[size].closed.filter(id => id !== member.instance);
    for (const member of ordered) state[size].closed.splice(member.closedIndex[size], 0, member.instance);
    const returning = members.filter(member => member.open[size] && !locate(state[size], member.instance));
    for (const { instance, recordedPlace, places, latest } of returning) {
      let place = recordedPlace ? places[size] ?? state[size].lastPlace?.[instance] : latest?.[size] ?? state[size].lastPlace?.[instance] ?? places[size];
      const complete = latest?.[size];
      // A snapshot taken while its split peer was closed sees only the surviving window.
      // The unchanged arrangement still owns the complete topology, needed when both return.
      if (place && !("closed" in place) && complete && !("closed" in complete) && !place.anchor && complete.anchor
        && place.groupId === complete.groupId && place.windowId && place.windowId === complete.windowId) place = complete;
      state[size] = detachPanel(state[size], instance);
      if (state[size].parked) { delete state[size].parked[instance]; if (!Object.keys(state[size].parked).length) delete state[size].parked; }
      if (place && !("closed" in place)) state[size].parked = { ...state[size].parked, [instance]: place };
    }
    // Unlike explicit Show, a replay restores the remembered active tab/collapse instead of revealing every returning member in turn.
    if (returning.length) state[size] = unparkPanels(state[size], returning.map(member => member.instance), fallback, { x: 40, y: 40, w: 400, h: 560 });
  }
  return dockWith(layout, state);
}
/** Add another beside its first open sibling independently in each size class, otherwise at its factory home. */
export function addPanelDock(layout: DockLayout | null, instance: string, siblings: readonly string[], factory: DockLayout | null): DockLayout {
  const state = panelDock(changePanelDock(layout, instance, "show", factory)), current = panelDock(layout);
  for (const size of ["wide", "compact"] as const) {
    const sibling = siblings.map(id => locate(current[size], id)).find(Boolean);
    if (sibling) state[size] = applyDrop(state[size], { kind: "panel", panelId: instance }, { kind: "tab", groupId: sibling.group.id, index: sibling.index + 1 });
  }
  return dockWith(layout, state);
}
