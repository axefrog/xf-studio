/**
 * The Save Explorer's module service (profiles design §7, "the Save Explorer's one open save"): one session per panel instance. Every
 * `saves.*` action names the instance it comes from (`instance`), and the instance's session (`SaveExplorerActions`: its saves list, its
 * open save and what is selected in it) is made the first time it is named and let go when the panel closes (`release`). Nothing is
 * "the" open save: two Save Explorer panels show two saves.
 */
import type { Capability } from "../../platform/api";
import { refusal } from "../../platform/api";
import { SAVE_EXPLORER_DESCRIPTORS, SaveExplorerActions, type SaveExplorerAction, type SaveExplorerDevice, type SaveExplorerOutcome,
  type SaveExplorerState } from "./actions";
import type { EntryPage, ModDataView, NodeInspection, ObjectInspection, ObjectRef, TreeRow } from "./explorer";

/** A Save Explorer action as the module's service takes it: the panel instance it comes from, and the action. */
export type SaveExplorerInstanceAction = SaveExplorerAction & { readonly instance: string };
type SessionArguments = ConstructorParameters<typeof SaveExplorerActions>;

export class SaveExplorerSessions {
  private readonly sessions = new Map<string, { actions: SaveExplorerActions; unsubscribe: () => void }>();
  private readonly listeners = new Set<() => void>();
  private readonly made: SessionArguments;

  /** Each session is made with these (see `SaveExplorerActions`): the host device, how long work yields, and the listing's retries. */
  constructor(device: SaveExplorerDevice | null, yieldToHost?: SessionArguments[1], options?: SessionArguments[2]) {
    this.made = [device, yieldToHost, options];
  }

  /** What an instance with no session yet reads as (it is never acted on): an untouched session. */
  private blankSession: SaveExplorerActions | null = null;
  /** The instance's session for reading: its own, or an untouched one (reads never make a session). */
  private peek(instance: string): SaveExplorerActions {
    return this.sessions.get(instance)?.actions ?? (this.blankSession ??= new SaveExplorerActions(...this.made));
  }
  /** The instance's session, made the first time it acts. */
  session(instance: string): SaveExplorerActions {
    let held = this.sessions.get(instance);
    if (!held) {
      const actions = new SaveExplorerActions(...this.made);
      held = { actions, unsubscribe: actions.subscribe(() => this.changed()) };
      this.sessions.set(instance, held);
    }
    return held.actions;
  }
  /** The panel instance closed: its session goes (an open save with it; a read still running publishes nowhere). */
  release(instance: string): void {
    const held = this.sessions.get(instance);
    if (!held) return;
    held.unsubscribe();
    this.sessions.delete(instance);
    void held.actions.dispatch({ kind: "saves.close" });
    this.changed();
  }
  /** The instances with a session (tests and diagnostics). */
  instances(): readonly string[] { return [...this.sessions.keys()]; }

  descriptors() {
    return structuredClone(Object.fromEntries(Object.entries(SAVE_EXPLORER_DESCRIPTORS).map(([kind, descriptor]) =>
      [kind, { ...descriptor, payload: { ...descriptor.payload, instance: "text" } }])));
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of [...this.listeners]) listener(); }

  capability(action: SaveExplorerInstanceAction): Capability {
    if (!action || typeof action.instance !== "string" || !action.instance) return refusal("missing_target", "That isn't a Save Explorer panel.");
    return this.peek(action.instance).capability(withoutInstance(action));
  }
  async dispatch(action: SaveExplorerInstanceAction): Promise<SaveExplorerOutcome> {
    if (!action || typeof action.instance !== "string" || !action.instance) return { ok: false, code: "missing_target", message: "That isn't a Save Explorer panel." };
    return this.session(action.instance).dispatch(withoutInstance(action));
  }

  // ---- Detached reads, per instance ----
  snapshot(instance: string): SaveExplorerState { return this.peek(instance).snapshot(); }
  tree(instance: string): readonly TreeRow[] { return this.peek(instance).tree(); }
  node(instance: string, id: number): NodeInspection | undefined { return this.peek(instance).node(id); }
  entries(instance: string, offset: number, limit: number, filter = ""): EntryPage { return this.peek(instance).entries(offset, limit, filter); }
  object(instance: string, ref: ObjectRef): ObjectInspection | undefined { return this.peek(instance).object(ref); }
  modData(instance: string): ModDataView | undefined { return this.peek(instance).modData(); }
  thumbnail(instance: string, folder: string): string | null { return this.peek(instance).thumbnail(folder); }
}

function withoutInstance(action: SaveExplorerInstanceAction): SaveExplorerAction {
  const { instance: _instance, ...rest } = action;
  return rest as SaveExplorerAction;
}
