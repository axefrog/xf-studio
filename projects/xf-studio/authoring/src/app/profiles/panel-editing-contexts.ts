import type { NamedTargets } from "../action-targets";
import type { StudioPresentationPort } from "../studio-presentation";
import type { StudioAction } from "../studio-application";
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
    character(id: string): CharacterContextActions | undefined;
    create(input: { core: Core; instance: string; named: NamedTargets; scene: CollectionScenePort; choose(ref: LookRef): StudioAction; check(): Capability;
      capture(): { check(): Capability; release(): void }; signal: AbortSignal }): { port: StudioPresentationPort<Slot>; dispose(): void };
  }) {}
  acquire(instance: string, signal: AbortSignal): PanelEditingPort<Slot> | undefined {
    if (signal.aborted || !this.deps.session.panel(instance)) return undefined;
    const listeners = new Set<() => void>();
    const retained = new Set<() => void>();
    let live: { key: string; port: StudioPresentationPort<Slot>; dispose(): void } | undefined;
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
        const life = new AbortController();
        const context = this.deps.context(panel.type);
        const named: NamedTargets = { ...target, scope: context.kind === "subject" && target.character ? characterScope(target.character)
          : target.look ? lookScope(target.look) : undefined };
        const check = (): Capability => {
          if (signal.aborted || life.signal.aborted) return refusal("missing_target", "This panel editing context was released.");
          try { session.checkPanelTarget(destination); }
          catch (error) { if (error instanceof TabRefusal) return refusal("missing_target", error.message); throw error; }
          // Follow focus changing elsewhere never retargets a captured facade. The scene itself must still name its original chain.
          return targets.check(named);
        };
        const handle = target.look && (context.kind === "look" || context.kind === "view") ? this.deps.looks.acquire(target.look, life.signal) : undefined;
        const character = context.kind === "subject" && target.character ? this.deps.character(target.character) : undefined;
        const base = handle?.context ?? this.deps.empty;
        const app = base.app.fork({ input: { check }, characterContext: character, savedV: undefined, characterDetails: undefined,
          collection: undefined, files: undefined });
        const core: Core = { ...this.deps.empty, ...base, app };
        const choose = (ref: LookRef): StudioAction => target.scene !== undefined
          ? { kind: "scene.setLook", scene: target.scene, sceneGen: target.sceneGen!, look: ref }
          : { kind: "panels.setBinding", destination, binding: { policy: "pinned", target: { look: ref } } };
        const scene: CollectionScenePort = { look: () => target.look, subscribe: listener => session.subscribe(listener), setLook: ref => {
          const allowed = check();
          if (!allowed.available) throw Error(allowed.reason);
          if (!ref) return; // Last removal keeps the exact removed look reference for Restore.
          const result = app.dispatch(choose(ref));
          if (!result.ok) throw Error(result.message);
        } };
        let made: { port: StudioPresentationPort<Slot>; dispose(): void };
        let captures = 0, retired = false, finished = false;
        const destroy = () => { if (finished) return; finished = true; retained.delete(destroy); made?.dispose(); app.dispose(); life.abort(); };
        try {
          made = this.deps.create({ core, instance, named, scene, choose, check, signal: life.signal, capture: () => {
            captures++;
            const request = new AbortController(), abort = () => request.abort();
            life.signal.addEventListener("abort", abort, { once: true });
            const captured = targets.capture(instance, request.signal);
            return { check: () => { const current = check(); return current.available ? targets.current(captured) : current; },
              release: () => { life.signal.removeEventListener("abort", abort); request.abort(); if (!--captures && retired) destroy(); } };
          } });
        } catch (error) { app.dispose(); life.abort(); throw error; }
        const old = live;
        live = { key, port: made.port, dispose: () => {
          retired = true;
          if (captures && check().available) retained.add(destroy); else destroy();
        } };
        old?.dispose();
        for (const listener of [...listeners]) listener();
      } finally { reconciling = false; }
    };
    refresh();
    if (signal.aborted) { live?.dispose(); return undefined; }
    const off = this.deps.session.subscribe(refresh);
    const release = () => { off(); live?.dispose(); for (const destroy of [...retained]) destroy(); listeners.clear(); signal.removeEventListener("abort", release); };
    signal.addEventListener("abort", release, { once: true });
    return { current: () => live!.port, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  }
}
