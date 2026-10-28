import { guidanceEditing } from "./contributions";
import type { NamedTargets } from "../../app/action-targets";
import type { StudioRuntime } from "../runtime";
import type { SingleTourCommand, TourCommand } from "./types";

type Target = { named: NamedTargets; layer: string };
type Creation = { command: Extract<SingleTourCommand, { kind: "studio" }>; named: NamedTargets; ids: readonly string[]; expected?: string };
export const TOUR_TARGET_MISSING = "That tour look or layer is no longer selected or available. Follow this step's instructions yourself, or go back to add the look again.";

/** Per-tour captures and cancellation. These are input targets, never a second owner of authored state. */
export class TourCommandRun {
  private readonly abort = new AbortController();
  readonly signal = this.abort.signal;
  private readonly targets = new Map<string, Target>();
  private creation?: Creation;
  cancel() { this.abort.abort(); this.targets.clear(); this.creation = undefined; }
  target(id: string) { return this.targets.get(id); }
  valid(rt: StudioRuntime, id: string): boolean {
    const target = this.targets.get(id), now = rt.port.focus.targets(), draft = rt.port.library.summary().draft;
    return !this.signal.aborted && !!target && !!draft && draft.id === target.named.look?.collection && draft.presets.some(preset => preset.id === target.named.look?.look)
      && same(target.named, now) && guidanceEditing(rt)?.layer()?.id === target.layer
      && (guidanceEditing(rt)?.layerIds().includes(target.layer) ?? false);
  }
  /** Watch the create action while its step is showing, so pressing the real Add control captures the same targets as the helper. */
  watch(rt: StudioRuntime, command: TourCommand) {
    if (this.signal.aborted) return;
    const first = command.kind === "sequence" ? command.steps[0] : command;
    if (first?.kind !== "studio" || !first.capture || !first.target) return;
    this.creation = { command: first, named: structuredClone(rt.port.focus.targets()), ids: this.ids(rt, first.capture) };
  }
  /** A helper must still be in the context its Add instruction chose, not a newly focused collection or scene. */
  prepare(rt: StudioRuntime, command: Extract<SingleTourCommand, { kind: "studio" }>): boolean {
    if (!this.creation || this.creation.command.target !== command.target || this.creation.command.capture !== command.capture) this.watch(rt, command);
    const chosen = this.creation?.named, now = rt.port.focus.targets();
    return !this.signal.aborted && !!chosen && !this.creation?.expected && chosen.collection === now.collection
      && chosen.view === now.view && chosen.scene === now.scene && chosen.sceneGen === now.sceneGen
      && chosen.look?.look === now.look?.look && chosen.look?.collection === now.look?.collection;
  }
  private ids(rt: StudioRuntime, kind: "preset" | "layer"): string[] {
    return kind === "preset" ? rt.port.library.summary().draft?.presets.map(item => item.id) ?? [] : [...(guidanceEditing(rt)?.layerIds() ?? [])];
  }
  /** Only an added identity qualifies; switching to another existing look cannot satisfy a pending create. */
  observe(rt: StudioRuntime) {
    const pending = this.creation;
    if (!pending || this.signal.aborted) return false;
    const { command, named } = pending, now = rt.port.focus.targets();
    if (named.collection !== now.collection || rt.port.library.summary().draft?.id !== named.collection
      || named.scene !== now.scene || named.view !== now.view) return false;
    const added = this.ids(rt, command.capture!).filter(id => !pending.ids.includes(id));
    if (!pending.expected && added.length === 1) pending.expected = added[0];
    if (!pending.expected) return false;
    if (command.capture === "preset") {
      if (now.look?.look !== pending.expected || now.look.collection !== named.collection) return false;
    } else if (!this.valid(rt, command.target!)) {
      // A new layer becomes selected as part of Add; compare the look and scene, not the previous layer selection.
      const target = this.targets.get(command.target!);
      if (!target || !same(target.named, now)) return false;
    }
    const layer = guidanceEditing(rt)?.layer();
    if (!now.look || !layer || (now.scene !== undefined && now.sceneGen === undefined) || (command.capture === "layer" && layer.id !== pending.expected)) return false;
    if (!guidanceEditing(rt)?.canCapture()) return false;
    this.targets.set(command.target!, { named: structuredClone(now), layer: layer.id });
    this.creation = undefined;
    return true;
  }
  async created(rt: StudioRuntime): Promise<boolean> {
    for (let waited = 0; waited < 1000 && !this.signal.aborted; waited += 25) {
      if (!this.creation || this.observe(rt)) return !this.signal.aborted;
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 25);
        this.signal.addEventListener("abort", done, { once: true });
      });
    }
    // Do not let a timed-out operation adopt a later selection.
    this.creation = undefined;
    return false;
  }
}
function same(a: NamedTargets, b: NamedTargets) {
  return !!a.look && !!b.look && a.look.collection === b.look.collection && a.look.look === b.look.look
    && a.view === b.view && a.scene === b.scene && a.sceneGen === b.sceneGen;
}

