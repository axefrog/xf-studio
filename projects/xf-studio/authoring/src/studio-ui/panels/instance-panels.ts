/** Controller lifetime follows shown-tab instance membership, independently of document/outbox lifetime. */
import type { PanelInstance } from "../../app/profiles/profile-session";
import type { Port, StudioRuntime } from "../runtime";
import { Frame, StudioRuntime as Runtime } from "../runtime";
import type { PanelController } from "./collection";
import type { ViewCatalogue } from "../views/contribution";
import { allGroups, type DockState } from "../dock/layout";

type Mounted = { panel: PanelController; port: Port; life: AbortController; inputLife: AbortController; captureLife: AbortController; destination: string; generation: unknown;
  current(): Port; runtime?: StudioRuntime; off(): void };
export class InstancePanels {
  private mounted = new Map<string, Mounted>();
  constructor(private readonly root: StudioRuntime, private readonly deps: {
    catalogue(): ViewCatalogue;
    generation?(type: string): unknown;
    make(instance: PanelInstance, runtime: StudioRuntime): PanelController;
    changed(): void;
  }) {}
  controllers() { return [...this.mounted.values()].map(entry => entry.panel); }
  runtime(id: string) { return this.mounted.get(id)?.port; }
  controllerRuntime(id: string) { return this.mounted.get(id)?.runtime; }
  sync(): boolean {
    const { port } = this.root, snapshot = port.tabs?.snapshot(), tab = snapshot?.tabs.find(tab => tab.id === snapshot.shown);
    const catalogue = this.deps.catalogue();
    const wanted = (tab?.panels ?? []).filter(panel => panel.type !== "view" && catalogue.ids.includes(panel.type)
      && (["wide", "compact"] as const).some(size => { const tree = (tab!.dock?.state as unknown as DockState | undefined)?.[size]; return tree && (allGroups(tree).some(({ group }) => group.panels.includes(panel.id)) || !!tree.parked?.[panel.id]); }));
    const ids = new Set(wanted.map(panel => panel.id));
    let changed = false;
    for (const [id, entry] of this.mounted) if (!ids.has(id)) {
      this.release(entry); this.mounted.delete(id); changed = true;
    }
    for (const instance of wanted) {
      let entry = this.mounted.get(instance.id);
      const generation = this.deps.generation?.(instance.type);
      if (entry && entry.generation !== generation) { this.release(entry); this.mounted.delete(instance.id); entry = undefined; changed = true; }
      if (!entry) {
        const inputLife = new AbortController(), input = catalogue.context(instance.type).kind === "profile" ? undefined : port.editing?.acquire(instance.id, inputLife.signal);
        const current = () => input?.current() ?? port;
        entry = { inputLife, captureLife: new AbortController(), destination: JSON.stringify(port.panels.target?.(instance.id)), generation, current, off: input?.subscribe(this.deps.changed) ?? (() => {}), port: current(),
          life: new AbortController(), panel: undefined! };
        this.mounted.set(instance.id, entry);
      } else if (entry.port === entry.current()) continue;
      else { const destination = JSON.stringify(port.panels.target?.(instance.id));
        if (destination !== entry.destination) { entry.captureLife.abort(); entry.captureLife = new AbortController(); entry.destination = destination; }
        entry.life.abort(); entry.panel.dispose?.(); entry.panel.spec.element.remove(); entry.port = entry.current(); entry.life = new AbortController(); }
      const rt = new Runtime(entry.port, this.root.feedback, catalogue, { id: instance.id, type: instance.type, signal: entry.life.signal, captureSignal: entry.captureLife.signal },
        this.root.anchors.scoped(instance.id, entry.life.signal));
      Object.defineProperty(rt, "dock", { get: () => this.root.dock });
      Object.defineProperty(rt, "settings", { get: () => this.root.settings });
      rt.subscribe(this.deps.changed);
      entry.runtime = rt;
      let panel: PanelController;
      try { panel = this.deps.make(instance, rt); panel.bind?.(instance.id); }
      catch (error) { entry.off(); entry.life.abort(); entry.captureLife.abort(); entry.inputLife.abort(); this.mounted.delete(instance.id); throw error; }
      const signal = entry.life.signal;
      entry.panel = { ...panel, commands: panel.commands ? () => panel.commands!().map(command => ({ ...command, id: `${instance.id}:${command.id}`,
        capability: () => signal.aborted ? { available: false, reason: "This panel changed. Open the command again." } : command.capability(),
        run: () => { if (!signal.aborted) command.run(); } })) : undefined,
        spec: { ...panel.spec, id: instance.id }, update: () => panel.update(new Frame(entry!.port, catalogue, this.root.dock?.tree)) };
      rt.anchors.register(`panel.${instance.type}`, panel.spec.element);
      changed = true;
    }
    return changed;
  }
  private release(entry: Mounted) { entry.off(); entry.captureLife.abort(); entry.life.abort(); entry.panel.spec.visibility?.(false); entry.panel.dispose?.(); entry.panel.bind?.(undefined); entry.inputLife.abort(); entry.panel.spec.element.remove(); }
  dispose() { for (const entry of this.mounted.values()) this.release(entry); this.mounted.clear(); }
}
