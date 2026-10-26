import type { NamedTargets } from "../action-targets";
import type { StudioPresentationPort } from "../studio-presentation";
import type { StudioAction } from "../studio-application";
import type { StudioFileOperations, FileWriter, FileWriterCapture, InputCapture } from "../studio-file-operations";
import type { LookRef } from "../../library/collection-documents";
import type { createTrustedAuthoringCore } from "../trusted-authoring-core";
import type { CollectionScenePort } from "../../library/collection-service";
import type { LookEditContexts } from "../../library/look-edit-contexts";
import { lookScope } from "../../platform/core/history-service";
import { characterScope } from "../../character/character-history";
import type { CharacterContextActions } from "../../character/character-context-actions";
import { refusal, type Capability } from "../../platform/api";
import type { PanelContext } from "../../platform/api/subjects";
import type { ProfileSessions } from "./profile-sessions";
import { TabRefusal } from "./profile-sessions";
import type { TargetResolver } from "./targets";

type Core = ReturnType<typeof createTrustedAuthoringCore>;
export type PanelEditingPort<Slot> = {
  /** A refresh reads the current bound facade. An old facade refuses after replacement or release. */
  current(): StudioPresentationPort<Slot>;
  subscribe(listener: () => void): () => void;
};

/** Instance-bound input routing. Resolution happens here; document/collection/character owners never read focus. */
export class PanelEditingContexts<Slot> {
  constructor(private readonly deps: {
    session: ProfileSessions; targets: TargetResolver; looks: LookEditContexts; empty: Core;
    context(type: string): PanelContext;
    available?(type: string): boolean;
    character(id: string): CharacterContextActions | undefined;
    create(input: { core: Core; instance: string; named: NamedTargets; scene: CollectionScenePort; choose(ref: LookRef): StudioAction; check(): Capability;
      fileOwner?: StudioFileOperations; captured: boolean; capture(): InputCapture | FileWriterCapture; capturePort(signal: AbortSignal, fileOwner?: StudioFileOperations): StudioPresentationPort<Slot>; signal: AbortSignal }): { port: StudioPresentationPort<Slot>; writer: FileWriter; files: StudioFileOperations; dispose(): void };
  }) {}
  acquire(instance: string, signal: AbortSignal): PanelEditingPort<Slot> | undefined {
    if (signal.aborted || !this.deps.session.panel(instance)) return undefined;
    const listeners = new Set<() => void>();
    let live: { key: string; port: StudioPresentationPort<Slot>; dispose(): void } | undefined;
    let fileOwner: StudioFileOperations | undefined;
    let reconciling = false;
    const refresh = () => {
      if (signal.aborted || reconciling) return;
      reconciling = true;
      try {
        const { session, targets } = this.deps, panel = session.panel(instance);
        if (!panel) { live?.dispose(); return; }
        const destination = session.panelTarget(instance), resolved = targets.named(instance);
        const { scope: _scope, ...partial } = resolved;
        // A retained direct look pin keeps its collection/recovery surface while removed or missing; it is never a fallback look.
        const pin = panel.binding?.policy === "pinned" && "look" in panel.binding.target ? panel.binding.target.look : undefined;
        const target = pin && !partial.look ? { ...partial, look: pin, collection: pin.collection } : partial;
        // Focus/history navigation is not an edit-context identity change. Binding generations and scene changes are.
        const key = JSON.stringify([destination, target]);
        if (live?.key === key) return;
        const next = this.bind(target, panel.type === "view" ? { kind: "view" } : this.deps.context(panel.type), signal, instance, destination, undefined, fileOwner);
        // The instance keeps one operation/result owner when its input follows another scene or V.
        // New preflight reads the new collection; accepted work retains its captured dependency bundle.
        fileOwner ??= next.files;
        fileOwner.observeInput(next.files);
        const old = live;
        live = { key, port: next.port, dispose: next.retire };
        old?.dispose();
        for (const listener of [...listeners]) listener();
      } finally { reconciling = false; }
    };
    refresh();
    if (signal.aborted) { live?.dispose(); return undefined; }
    const off = this.deps.session.subscribe(refresh);
    const release = () => { off(); live?.dispose(); listeners.clear(); signal.removeEventListener("abort", release); };
    signal.addEventListener("abort", release, { once: true });
    return { current: () => live!.port, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  }
  capturePort(view: string | undefined, signal: AbortSignal, fileOwner?: StudioFileOperations): StudioPresentationPort<Slot> {
    const captured = this.deps.targets.captureView(view, signal);
    return this.bind(captured.named, { kind: "view" }, signal, undefined, undefined, () => this.deps.targets.current(captured), fileOwner).port;
  }
  /** The drawn compatibility input accepts work against one explicit view, with the same writer/lifetime rules as a panel. */
  captureView(view: string | undefined, signal: AbortSignal): FileWriterCapture {
    const scope = this.bind(this.deps.targets.namedView(view), { kind: "view" }, signal);
    const held = scope.capture();
    scope.retire();
    return { ...held, writer: scope.writer };
  }
  private bind(target: NamedTargets, context: PanelContext, signal: AbortSignal, instance?: string,
    destination?: ReturnType<ProfileSessions["panelTarget"]>, extraCheck?: () => Capability, fileOwner?: StudioFileOperations) {
    const { session, targets } = this.deps, life = new AbortController();
    const named: NamedTargets = { ...target, scope: context.kind === "subject" && target.character ? characterScope(target.character)
      : target.look ? lookScope(target.look) : undefined };
    const check = (): Capability => {
      if (signal.aborted || life.signal.aborted) return refusal("missing_target", "This editing context was released.");
      if (extraCheck) { const allowed = extraCheck(); if (!allowed.available) return allowed; }
      if (instance && this.deps.available && !this.deps.available(session.panel(instance)?.type ?? "")) return refusal("missing_target", "This panel was withdrawn.");
      if (destination) try { session.checkPanelTarget(destination); }
      catch (error) { if (error instanceof TabRefusal) return refusal("missing_target", error.message); throw error; }
      return targets.check(named);
    };
    const handle = target.look && (context.kind === "look" || context.kind === "view") ? this.deps.looks.acquire(target.look, life.signal) : undefined;
    const character = (context.kind === "subject" || context.kind === "view") && target.character ? this.deps.character(target.character) : undefined;
    const base = handle?.context ?? this.deps.empty;
    const app = base.app.fork({ input: { check }, characterContext: character, savedV: undefined, characterDetails: undefined,
      collection: undefined, files: undefined });
    const core: Core = { ...this.deps.empty, ...base, app };
    const choose = (ref: LookRef): StudioAction => target.scene !== undefined
      ? { kind: "scene.setLook", scene: target.scene, sceneGen: target.sceneGen!, look: ref }
      : { kind: "panels.setBinding", destination: destination!, binding: { policy: "pinned", target: { look: ref } } };
    const scene: CollectionScenePort = { look: () => target.look, subscribe: listener => session.subscribe(listener), setLook: ref => {
      const allowed = check(); if (!allowed.available) throw Error(allowed.reason);
      if (!ref) return;
      const result = app.dispatch(choose(ref)); if (!result.ok) throw Error(result.message);
    } };
    let made: { port: StudioPresentationPort<Slot>; writer: FileWriter; files: StudioFileOperations; dispose(): void };
    let captures = 0, retired = false, finished = false;
    const destroy = () => {
      if (finished) return;
      finished = true; signal.removeEventListener("abort", retire);
      made?.dispose(); app.dispose(); life.abort();
    };
    const retire = () => { retired = true; if (!captures) destroy(); };
    const capture = (): InputCapture | FileWriterCapture => {
      const accepted = check();
      if (!accepted.available) return { check: () => accepted, release() {} };
      if (extraCheck) {
        // Acceptance transfers out of the shell surface's signal before that menu or palette closes.
        const request = new AbortController(), captured = targets.captureNamed(named, request.signal, instance);
        const current = () => accepted.available ? targets.current(captured) : accepted;
        const operation = this.bind(named, context, request.signal, instance, destination, current);
        return { writer: operation.writer, check: () => {
          if (destination) try { session.checkPanelTarget(destination); }
          catch (error) { if (error instanceof TabRefusal) return refusal("missing_target", error.message); throw error; }
          return current();
        }, release: () => request.abort() };
      }
      captures++;
      const request = new AbortController(), captured = targets.captureNamed(named, request.signal, instance);
      let released = false;
      return { check: () => {
        if (!accepted.available) return accepted;
        const allowed = check(); if (!allowed.available) return allowed;
        if (destination) try { session.checkPanelTarget(destination); }
        catch (error) { if (error instanceof TabRefusal) return refusal("missing_target", error.message); throw error; }
        if (instance && this.deps.available && !this.deps.available(session.panel(instance)?.type ?? "")) return refusal("missing_target", "This panel was withdrawn.");
        return targets.current(captured);
      }, release: () => {
        if (released) return; released = true; request.abort(); if (!--captures && retired) destroy();
      } };
    };
    try { made = this.deps.create({ core, instance: instance ?? "", named, scene, choose, check, signal: life.signal, capture, fileOwner, captured: !!extraCheck,
      capturePort: (signal, fileOwner) => {
        const allowed = check(), captured = targets.captureNamed(named, signal, instance);
        return this.bind(named, context, signal, instance, destination, () => allowed.available ? targets.current(captured) : allowed, fileOwner).port;
      } }); }
    catch (error) { app.dispose(); life.abort(); throw error; }
    signal.addEventListener("abort", retire, { once: true });
    if (signal.aborted) retire();
    return { port: made.port, writer: made.writer, files: made.files, capture, retire };
  }

}
