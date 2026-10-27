/** G3's independent account. No session/history/dock mutation helpers or implementation checkpoints.
 * Content lives independently of tab slots. Only membership/binding fields enter panel history;
 * scene targets and later per-size membership arrangements survive history passages.
 */
import type { PanelBinding, PanelInstance, ProfileSessionData } from "../../src/app/profiles/profile-session";
import type { ViewRecord } from "../../src/platform/api/view-graph";

const copy = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export type ModelPanel = { -readonly [K in keyof PanelInstance]: PanelInstance[K] } & { open: { wide: boolean; compact: boolean } };
type Tab = { id: string; name: string; content: number };
type Fragment = { tab: Tab; at: number; views: { view: ViewRecord; at: number }[] };
type Structure = { tabs: Tab[]; closed: Fragment[]; views: ViewRecord[] };
type Field = { content: number; id: string; before?: ModelPanel; after?: ModelPanel; binding: boolean };
type Step = { before: Structure; after: Structure; fields: Field[]; tabs: boolean; shownBefore?: string; shownAfter?: string };
type Target = { subject?: { kind: string; id: string }; look?: { collection: string; look: string }; gen: number };

export class SessionModel {
  state: Structure;
  readonly contents = new Map<number, ModelPanel[]>();
  readonly targets = new Map<string, Target>();
  readonly steps: Step[] = [];
  at = 0;
  shown?: string;
  private next = 0;
  readonly initial: ReturnType<SessionModel["account"]>;
  constructor(data: ProfileSessionData) {
    this.state = { tabs: data.tabs.map(tab => ({ id: tab.id, name: tab.name, content: this.content([]) })), closed: [], views: copy(data.views.views) as ViewRecord[] };
    this.shown = data.focus.tab ?? this.state.tabs[0]?.id;
    for (const scene of data.views.scenes) this.targets.set(scene.id, { ...(scene.subject ? { subject: copy(scene.subject) } : {}), ...(scene.look ? { look: copy(scene.look) } : {}), gen: scene.gen });
    this.initial = copy(this.account());
  }
  content(panels: ModelPanel[]) { const id = ++this.next; this.contents.set(id, copy(panels)); return id; }
  panels(tab: Tab) { return this.contents.get(tab.content)!; }
  tab(id: string) { return this.state.tabs.find(tab => tab.id === id)!; }
  begin(panelEdit = true) { return { state: copy(this.state), contents: panelEdit ? copy(this.contents) : new Map<number, ModelPanel[]>(), shown: this.shown }; }
  record(before: ReturnType<SessionModel["begin"]>, panelEdit = false) {
    const fields: Field[] = [];
    if (panelEdit) for (const [content, panels] of this.contents) {
      const old = before.contents.get(content) ?? [];
      for (const id of new Set([...old, ...panels].map(panel => panel.id))) {
        const a = old.find(panel => panel.id === id), b = panels.find(panel => panel.id === id);
        if (same(a, b)) continue;
        // Binding is separate from membership: Add's redo cannot capture a later pin.
        const binding = !!a && !!b && same(a.open, b.open);
        fields.push({ content, id, before: copy(a), after: copy(b), binding });
      }
    }
    if (same(before.state, this.state) && !fields.length) return;
    this.steps.splice(this.at);
    this.steps.push({ before: before.state, after: copy(this.state), fields,
      tabs: !same([before.state.tabs, before.state.closed], [this.state.tabs, this.state.closed]), shownBefore: before.shown, shownAfter: this.shown });
    this.at++;
  }
  move(to: number) {
    if (to === this.at) return false;
    const old = this.state, forward = to > this.at;
    let shown: string | undefined, navigation = this.shown;
    while (this.at !== to) {
      const step = this.steps[forward ? this.at++ : --this.at]!;
      for (const field of step.fields) {
        const panels = this.contents.get(field.content)!, wanted = copy(forward ? field.after : field.before), at = panels.findIndex(panel => panel.id === field.id);
        if (field.binding) {
          if (at < 0) throw Error("model binding without membership");
          delete panels[at]!.binding;
          if (wanted?.binding) panels[at]!.binding = wanted.binding;
        } else if (!wanted) { if (at >= 0) panels.splice(at, 1); }
        else if (at < 0) panels.push(wanted);
        else panels[at] = { ...wanted, ...(panels[at]!.binding ? { binding: panels[at]!.binding } : {}) };
      }
      this.state = forward ? step.after : step.before;
      if (step.tabs) {
        shown = forward ? step.shownAfter : step.shownBefore;
        if (forward) step.shownBefore = navigation; else step.shownAfter = navigation;
        navigation = shown;
      }
    }
    // Intermediate structures are immutable history values; detach only the final reached state.
    this.state = copy(this.state);
    // D15 is evaluated over the whole atomic jump, rather than navigating through intermediate tabs.
    const back = this.state.tabs.filter(tab => !old.tabs.some(item => item.id === tab.id));
    if (shown && back.some(tab => tab.id === shown)) this.shown = shown;
    else if (!this.state.tabs.some(tab => tab.id === this.shown)) {
      const at = Math.max(0, old.tabs.findIndex(tab => tab.id === this.shown));
      this.shown = this.state.tabs.some(tab => tab.id === shown) ? shown : this.state.tabs[Math.min(at, this.state.tabs.length - 1)]?.id;
    }
    return true;
  }
  fragment(id: string) {
    const at = this.state.tabs.findIndex(tab => tab.id === id), tab = copy(this.state.tabs[at]!);
    const views = this.state.views.flatMap((view, at) => view.tab === id ? [{ view: copy(view), at }] : []);
    this.state.closed = [...this.state.closed, { tab, at, views }].slice(-5);
    this.state.views = this.state.views.filter(view => view.tab !== id);
  }
  close(id: string) {
    const at = this.state.tabs.findIndex(tab => tab.id === id);
    this.fragment(id); this.state.tabs.splice(at, 1);
    if (this.shown === id) this.shown = this.state.tabs[Math.min(at, this.state.tabs.length - 1)]?.id;
  }
  reopen(index: number, id: string) {
    const [fragment] = this.state.closed.splice(index, 1);
    this.state.tabs.splice(Math.min(fragment!.at, this.state.tabs.length), 0, { ...fragment!.tab, id });
    for (const { view, at } of [...fragment!.views].sort((a, b) => a.at - b.at)) this.state.views.splice(Math.min(at, this.state.views.length), 0, { ...view, tab: id });
    this.shown = id;
  }
  setBinding(tab: Tab, id: string, binding: PanelBinding) { this.panels(tab).find(panel => panel.id === id)!.binding = copy(binding); }
  /** Independent semantics for chooser/pin/follow commands; never copy the service's result or selected candidate. */
  bindingCommand(tab: Tab, id: string, operation: "choose" | "pin" | "follow", target?: Extract<PanelBinding, { policy: "pinned" }>["target"]) {
    this.setBinding(tab, id, operation === "follow" ? { policy: "follow-focus" } : { policy: "pinned", target: copy(target!) });
  }
  account() {
    const panels = (tab: Tab) => this.panels(tab).map(panel => ({ id: panel.id, type: panel.type, state: panel.state ?? null, binding: panel.binding ?? null, open: panel.open })).sort((a, b) => a.id.localeCompare(b.id));
    const tab = (item: Tab) => ({ id: item.id, name: item.name, panels: panels(item) });
    return { tabs: this.state.tabs.map(tab), closed: this.state.closed.map(item => ({ tab: tab(item.tab), at: item.at,
      views: item.views.map(({ view, at }) => ({ view, at })) })), views: this.state.views,
      shown: this.shown ?? null };
  }
}

/** Read projection only: traverse the trees independently, without openIn/panelDock/locate. */
export function sessionAccount(data: ProfileSessionData) {
  const tab = (item: ProfileSessionData["tabs"][number]) => {
    const open = (size: "wide" | "compact", id: string) => {
      const state = item.dock?.state as unknown as Record<string, { root?: unknown; floating?: { node: unknown }[] }> | undefined;
      const has = (node: unknown): boolean => {
        const n = node as { kind?: string; panels?: string[]; children?: unknown[] } | null;
        return !!n && (n.kind === "group" ? !!n.panels?.includes(id) : !!n.children?.some(has));
      };
      return has(state?.[size]?.root) || !!state?.[size]?.floating?.some(window => has(window.node));
    };
    return { id: item.id, name: item.name, panels: item.panels.map(panel => ({ id: panel.id, type: panel.type, state: panel.state ?? null, binding: panel.binding ?? null,
      open: { wide: open("wide", panel.id), compact: open("compact", panel.id) } })).sort((a, b) => a.id.localeCompare(b.id)) };
  };
  return { tabs: data.tabs.map(tab), closed: data.closed.map(item => ({ tab: tab(item.tab), at: item.at, views: item.views })),
    views: data.views.views, shown: data.focus.tab ?? null };
}

/** Independent P3-ii command account. Whole before/after numeric values, deliberately no production history/chunk helpers. */
export class EditContextModel {
  opacity = 0.85;
  selected = 0;
  private readonly done: { before: number; after: number }[] = [];
  private readonly undone: { before: number; after: number }[] = [];
  private displaced?: { step: { before: number; after: number }; trimmed: boolean };
  trimmed = false;
  private push(step: { before: number; after: number }) {
    this.done.push(step);
    const dropped = this.done.length > 80 ? this.done.shift() : undefined;
    this.displaced = dropped && { step: dropped, trimmed: this.trimmed };
    if (dropped) this.trimmed = true;
  }
  edit(opacity: number) {
    if (opacity === this.opacity) return false;
    this.undone.length = 0;
    this.push({ before: this.opacity, after: opacity }); this.opacity = opacity;
    return true;
  }
  undo() {
    const step = this.done.pop(); if (!step) return false;
    // The immediately displaced oldest step returns when Undo removes the edit that displaced it (history-limit's contract).
    if (this.displaced) { this.done.unshift(this.displaced.step); this.trimmed = this.displaced.trimmed; this.displaced = undefined; }
    this.undone.push(step); this.opacity = step.before; return true;
  }
  redo() { const step = this.undone.pop(); if (!step) return false; this.push(step); this.opacity = step.after; return true; }
  /** Persisted look history keeps completed before-values, with no session-only Redo or displaced-step grace entry. */
  restart() { this.undone.length = 0; this.displaced = undefined; }
  account() { return { opacity: this.opacity, selected: this.selected, depth: this.done.length, redoDepth: this.undone.length, trimmed: this.trimmed }; }
}

/** Async input oracle: a command's destination is its acceptance-time scene, independent of later focus/drawing. */
export class AsyncContextModel {
  private readonly looks = new Map<string, { collection: string; look: string }>();
  constructor(scenes: readonly { id: string; look?: { collection: string; look: string } }[]) {
    for (const scene of scenes) if (scene.look) this.looks.set(scene.id, { ...scene.look });
  }
  target(scene: string) { return { ...this.looks.get(scene)! }; }
  complete(scene: string, ref: { collection: string; look: string }) { this.looks.set(scene, { ...ref }); }
  account() { return [...this.looks].sort(([a], [b]) => a.localeCompare(b)); }
}


/** P3-vi independent retention account. It knows commands and elapsed time, not owner/status/resolver helpers. */
export class RecoveryModel {
  readonly subjects: ("present" | "removed" | "purged")[] = ["present", "present", "present"];
  readonly looks: ("present" | "removed" | "purged")[] = ["present", "present", "present"];
  readonly members = [true, true, true];
  private readonly deletedAt = new Map<string, number>();
  now = 0;
  /** These scenes keep their original assignments through deletion/restart; startup renders only a live assignment. */
  startupSubject(scene: number): number | undefined { return this.subjects[scene] === "present" ? scene : undefined; }
  remove(kind: "subject" | "look", index: number): boolean {
    const states = kind === "subject" ? this.subjects : this.looks;
    if (states[index] !== "present") return false;
    states[index] = "removed"; this.deletedAt.set(`${kind}/${index}`, this.now); return true;
  }
  restore(kind: "subject" | "look", index: number): boolean {
    const states = kind === "subject" ? this.subjects : this.looks;
    if (states[index] !== "removed") return false;
    states[index] = "present"; this.deletedAt.delete(`${kind}/${index}`); return true;
  }
  purge(days: number) {
    this.now += days * 24 * 3600_000;
    for (const [key, time] of this.deletedAt) if (this.now - time >= 30 * 24 * 3600_000) {
      const [kind, index] = key.split("/"); (kind === "subject" ? this.subjects : this.looks)[Number(index)] = "purged";
    }
  }
}
