/** Captured empty/recovery choices. U5 owns presentation; all mutations stay with the existing owners. */
import { refusal, type Capability } from "../../platform/api/capability";
import type { SubjectRef } from "../../platform/api/subjects";
import type { BoundTargetStatus } from "../../platform/api/target-status";
import type { ViewGraphData } from "../../platform/api/view-graph";
import type { LookRef } from "../../library/collection-documents";
import type { LookInput } from "../../library/collection-owner";
import type { StudioDispatchResult } from "../studio-application";
import { EMPTY_CHOICE_DESCRIPTORS } from "../studio-action-descriptors";
import { captureCurrent, resolveBinding, type Requirement, type Target } from "./bindings";
import type { ProfileServices } from "./profile-window";
import { TabRefusal, type PanelTarget, type ProfileSessions } from "./profile-sessions";
import type { PanelBinding } from "./profile-session";
import type { PanelActions } from "./panel-actions";
import { openIn } from "./panel-dock";
import type { SceneAction } from "./scene-commands";
import type { TargetResolver } from "./targets";

export type EmptyDestination = { readonly instance: string; readonly tab: string; readonly route: Requirement; readonly target: Target;
  readonly origin: PanelTarget; readonly mode: "scene" | "pin" | "view"; readonly status: BoundTargetStatus;
  readonly ownerType?: string; readonly chooser?: PanelTarget; readonly registration?: unknown; readonly collectionBase?: number };
export type EmptyChoiceValue = { readonly subject: SubjectRef } | { readonly look: LookRef } | { readonly defaultV: "female" | "male" }
  | { readonly createLook: true } | { readonly restore: true } | { readonly follow: true } | { readonly pin: PanelBinding } | { readonly showOwner: true };
export type EmptyChoiceRequest = { readonly kind: "empty.choose"; readonly destination: EmptyDestination; readonly choice: EmptyChoiceValue };
export type EmptyChoiceSnapshot = { readonly title: string; readonly body: string; readonly capability: Capability;
  /** U5 seam: distinguish retained work, unavailable data and ordinary unassigned slots. */
  readonly status?: BoundTargetStatus; readonly recovery?: boolean;
  readonly owner?: { readonly panel?: string; readonly label: string; readonly prompt: string; readonly action?: EmptyChoiceRequest };
  readonly choices: readonly { readonly id: string; readonly label: string; readonly name: string; readonly action: EmptyChoiceRequest; readonly capability?: Capability }[] };
export type EmptyChoicesPort = {
  snapshot(panel: string): EmptyChoiceSnapshot | null;
  capability(action: EmptyChoiceRequest): Capability;
  execute(action: EmptyChoiceRequest): Promise<StudioDispatchResult>;
  descriptors(): typeof EMPTY_CHOICE_DESCRIPTORS;
};
type Deps = { readonly session: ProfileSessions; readonly resolver: TargetResolver;
  readonly services: Pick<ProfileServices, "profiles" | "characters" | "collections">;
  readonly panels?: PanelActions;
  /** From the live contribution catalogue, not a second owner catalogue. */
  ownerType?(instance: string, route: Requirement): string | undefined;
  registration?(): unknown;
  starter(): LookInput["parts"];
  createLookCapability(collection: string): Capability;
  access(): Capability; baseline(): ViewGraphData; dispatch(action: SceneAction): StudioDispatchResult };
const failed = (allowed: Capability): StudioDispatchResult => ({ ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "That choice is unavailable." });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function emptyChoicesPort(deps: Deps): EmptyChoicesPort {
  const { session, resolver, services } = deps;
  const profile = () => services.profiles.profile(session.profile);
  const subjects = () => (profile()?.subjects ?? []).filter(ref => ref.kind === "character" && !!services.characters.document(ref.id));
  const looks = () => (profile()?.collections ?? []).flatMap(collection => (services.collections.collection(collection)?.looks ?? [])
    .map(look => ({ collection, look }))).filter(ref => services.collections.targetStatus(ref).state === "present");
  const known = (panel: string) => session.panel(panel) ? panel : session.instance(panel);
  const open = (id: string, tab: string) => (["wide", "compact"] as const).some(size => openIn(session.dock(tab), id, size));
  const key = (d: EmptyDestination) => JSON.stringify([d.route, d.mode, d.target.scene ?? null,
    d.mode === "pin" ? [d.target.view, d.target.subject, d.target.look] : null]);
  function ownerType(d: EmptyDestination): string | undefined {
    const preferred = deps.ownerType?.(d.instance, d.route);
    if (preferred !== "view" || d.route !== "subject" || session.instances("view", d.tab).some(peer => {
      const candidate = destination(peer.id); return candidate && key(candidate) === key(d);
    })) return preferred;
    // A graph view need not have a pane. A scene-bound subject inspector can own this chooser without duplicating the graph view.
    const kind = d.target.subject?.kind ?? resolver.world().scenes[d.target.scene ?? ""]?.kind;
    return deps.panels?.types().find(type => type.context?.kind === "subject" && kind && type.context.subjects.includes(kind))?.id;
  }
  function destination(instance: string, info = resolver.describe(instance)): EmptyDestination | undefined {
    const panel = session.panel(instance); if (!panel) return;
    const r = info.resolution;
    if (r.state === "resolved") return;
    const context = resolver.context(instance), route = r.missing ?? (context.kind === "profile" ? undefined : context.kind);
    if (!route) return;
    const mode = r.state === "empty" && !r.missing && panel.binding?.policy === "pinned" ? "pin" : info.target.scene && info.statuses.scene.state === "present" ? "scene"
      : panel.binding?.policy === "pinned" ? "pin" : "view";
    return { instance, tab: panel.tab, route, mode, origin: session.panelTarget(instance), target: info.target, status: info.statuses[route],
      ...(info.target.look ? { collectionBase: services.collections.collection(info.target.look.collection)?.revision } : {}), registration: deps.registration?.() };
  }
  function current(d: EmptyDestination): Capability {
    if (!d?.origin || !d.status || !["scene", "pin", "view"].includes(d.mode)) return refusal("missing_target", "Capture a current destination first.");
    if (d.origin) try { session.checkPanelTarget(d.origin); }
    catch (error) { if (error instanceof TabRefusal) return refusal("missing_target", error.message); throw error; }
    const panel = session.panel(d.instance);
    if (!panel || panel.tab !== d.tab || !resolver.available(d.instance) || !same(d.registration, deps.registration?.()))
      return refusal("missing_target", "That panel changed or its contribution was withdrawn. Choose again.");
    // Recovery choices validate the scene, without requiring the deliberately missing document to exist.
    const { view, scene, sceneGen } = d.target;
    const world = resolver.world(), record = scene ? world.scenes[scene] : undefined;
    if (d.mode === "scene" && (!record || !same(record.subject, d.target.subject) || !same(record.look, d.target.look)))
      return refusal("missing_target", "What this scene references changed. Choose again.");
    if (d.mode === "pin") {
      const pin = panel.binding?.policy === "pinned" ? panel.binding.target : undefined;
      if (!pin || record && d.status.state !== "unavailable" || Object.entries(pin).some(([key, value]) => !same(value, d.target[key as keyof Target])))
        return refusal("missing_target", "This panel's pin changed. Choose again.");
    }
    const chain = captureCurrent(world, { target: d.mode === "pin" ? {} : { view, scene, sceneGen }, revisions: {} }, () => undefined);
    if (!chain.available) return chain;
    if (d.route === "subject" || d.route === "look") {
      const now = d.route === "subject" && d.target.subject ? world.subject(d.target.subject)
        : d.route === "look" && d.target.look ? world.look(d.target.look) : undefined;
      if (now && (d.status.state !== "unavailable" && now.state !== d.status.state || now.revision !== d.status.revision))
        return refusal("missing_target", "That target changed. Choose again.");
    }
    // A focus move does not retarget a captured scene. A no-view request must still be empty.
    if (d.mode === "view") {
      const now = destination(d.instance);
      if (!now || key(now) !== key(d)) return refusal("missing_target", "What this panel shows changed. Choose again.");
    }
    return { available: true };
  }
  function binding(d: EmptyDestination, value: PanelBinding): Capability {
    if (!deps.panels) return refusal("unavailable", "Panel binding commands are unavailable.");
    const allowed = deps.panels.capability({ kind: "panels.setBinding", destination: d.origin, binding: value });
    if (!allowed.available || value.policy === "follow-focus") return allowed;
    const candidate = resolveBinding(resolver.world(), { tab: d.tab, binding: value, context: resolver.context(d.instance) });
    return candidate.target ? resolver.accepts(d.instance, candidate.target) : refusal("missing_target", "That target is no longer available.");
  }
  function restore(d: EmptyDestination): Capability {
    if (d.route === "subject" && d.target.subject?.kind === "character")
      return services.characters.restoreCapability(d.target.subject.id, d.status?.revision ?? -1);
    if (d.route === "look" && d.target.look) {
      const c = services.collections.collection(d.target.look.collection);
      return c ? services.collections.capability({ kind: "collection.restoreLook", collection: c.id, base: d.collectionBase ?? -1, look: d.target.look.look })
        : refusal("missing_target", "That collection is no longer available.");
    }
    return refusal("missing_target", "This target has no retained restore action.");
  }
  function ownerCapability(d: EmptyDestination): Capability {
    if (!deps.panels || !d.ownerType || d.ownerType !== ownerType(d)) return refusal("unavailable", "This chooser's contribution is unavailable.");
    if (d.chooser) {
      const live = session.panel(d.chooser.instance), peer = live && destination(live.id);
      if (!live || live.type !== d.ownerType || !peer || key(peer) !== key(d)) return refusal("missing_target", "That chooser changed. Choose again.");
      return deps.panels.capability({ kind: open(live.id, live.tab) ? "panels.reveal" : "panels.show", destination: d.chooser });
    }
    const access = deps.access(); if (!access.available) return access;
    return deps.panels.capability({ kind: "panels.add", destination: session.panelTabTarget(d.tab), type: d.ownerType,
      binding: d.mode === "view" ? { policy: "follow-focus" } : { policy: "pinned", target: { scene: d.target.scene! } } });
  }
  function capability(action: EmptyChoiceRequest): Capability {
    const { destination: d, choice } = action;
    const active = current(d); if (!active.available) return active;
    // Revealing an already open chooser is navigation, including in a read-only window.
    if ("showOwner" in choice && d.chooser && open(d.chooser.instance, d.tab)) return ownerCapability(d);
    const access = deps.access(); if (!access.available) return access;
    if ("showOwner" in choice) return ownerCapability(d);
    if ("restore" in choice) return restore(d);
    if ("follow" in choice) return binding(d, { policy: "follow-focus" });
    if ("pin" in choice) return binding(d, choice.pin);
    if (d.status?.state === "pending") return refusal("unavailable", d.status.reason ?? "This target is not available yet.");
    if ("subject" in choice) {
      if (d.route !== "look" && subjects().some(ref => same(ref, choice.subject)))
        return d.mode === "pin" ? binding(d, { policy: "pinned", target: { subject: choice.subject } }) : resolver.accepts(d.instance, { ...d.target, subject: choice.subject });
      return refusal("missing_target", "That V is no longer in this profile. Choose another V.");
    }
    if ("look" in choice) {
      if (d.route === "look" && looks().some(ref => same(ref, choice.look)))
        return d.mode === "pin" ? binding(d, { policy: "pinned", target: { look: choice.look } }) : resolver.accepts(d.instance, { ...d.target, look: choice.look });
      return refusal("missing_target", "That look is no longer in this profile. Choose another look.");
    }
    if ("defaultV" in choice && (d.route === "subject" || d.mode === "view") && (choice.defaultV === "female" || choice.defaultV === "male")) {
      const context = resolver.context(d.instance);
      return context.kind !== "subject" || context.subjects.includes("character") ? { available: true }
        : refusal("incompatible_mode", "This panel cannot show a V.");
    }
    if ("createLook" in choice && d.route === "look" && d.status?.state === "empty") {
      const existing = (profile()?.collections ?? []).map(id => services.collections.collection(id)).find(Boolean);
      return existing ? deps.createLookCapability(existing.id) : { available: true };
    }
    return refusal("invalid_value", "Choose one of the available options.");
  }
  function snapshot(panel: string): EmptyChoiceSnapshot | null {
    const instance = known(panel), info = resolver.describe(instance), d = destination(instance, info); if (!d) return null;
    const { route, mode } = d, recovery = d.status?.state !== "empty";
    const choices: EmptyChoiceSnapshot["choices"][number][] = [];
    const add = (id: string, label: string, name: string, choice: EmptyChoiceValue) => {
      const action: EmptyChoiceRequest = { kind: "empty.choose", destination: d, choice };
      choices.push({ id, label, name, action, capability: capability(action) });
    };
    if (info.available) {
      if (d.status?.state === "removed" && d.status.restore) add("restore", "Restore", `Restore ${d.status.label ?? "the removed target"}`, { restore: true });
      if (session.panel(instance)?.type !== "view" && session.panel(instance)?.binding?.policy === "pinned" && (recovery || mode === "pin"))
        add("follow", "Follow focus", "Let this panel follow focus in its own tab", { follow: true });
      if (mode === "pin" && (route === "view" || route === "scene")) {
        const offered = new Set<string>();
        for (const [id, view] of Object.entries(resolver.world().views)) {
          const key = route === "view" ? id : view.scene;
          if (offered.has(key)) continue;
          offered.add(key);
          const value: PanelBinding = { policy: "pinned", target: route === "view" ? { view: id } : { scene: view.scene } };
          if (binding(d, value).available) add(`${route}:${key}`, key, `Pin this panel to ${key}`, { pin: value });
        }
      } else if (route === "look") {
        for (const ref of looks()) { const name = services.collections.look(ref)!.name; add(`look:${ref.collection}/${ref.look}`, name,
          mode === "pin" ? `Pin this panel to ${name}` : `Show ${name} in this scene`, { look: ref }); }
        if (!choices.length && !recovery) add("create-look", "Create a look", "Create a look and show it in this scene", { createLook: true });
      } else if (route === "subject" || mode === "view") {
        for (const ref of subjects()) { const name = services.characters.character(ref.id)!.label; add(`subject:${ref.id}`, name,
          mode === "view" ? `Open a 3D view showing ${name} in this tab` : mode === "pin" ? `Pin this panel to ${name}` : `Show ${name} in this 3D view`, { subject: ref }); }
        const empty = !choices.length;
        add("default-female", empty && mode === "view" ? "Use the default V" : "Default V (feminine)", "Use the default feminine V", { defaultV: "female" });
        if (!empty || route === "subject") add("default-male", "Default V (masculine)", "Use the default masculine V", { defaultV: "male" });
      }
    }
    const type = mode !== "pin" ? ownerType(d) : undefined;
    const peers = type ? session.instances(type, d.tab).filter(peer => {
      const candidate = destination(peer.id); return candidate && key(candidate) === key(d);
    }) : [];
    const owner = peers.find(peer => open(peer.id, d.tab)) ?? peers[0];
    // Without owner creation support the first compatible inspector is the single chooser. No paint allocates an instance.
    const leader = !type ? session.tab(d.tab)?.panels.find(peer => {
      const candidate = destination(peer.id); return candidate && open(peer.id, d.tab) && key(candidate) === key(d);
    }) : undefined;
    const pointer = mode !== "pin" && (owner ? owner.id !== instance : type ? true : !!leader && leader.id !== instance);
    const ownerDestination = { ...d, ownerType: type, ...(owner ? { chooser: session.panelTarget(owner.id) } : {}) };
    const body = !info.available ? info.resolution.state === "dangling" ? info.resolution.reason : "This contribution is unavailable."
      : recovery ? d.status?.reason ?? `This ${route} was removed. Its reference is kept.` : route === "look" ? (looks().length ? "This scene has no look yet." : "There are no looks in this profile yet.")
        : mode === "view" ? "This tab has no 3D view." : "This 3D view has no V yet.";
    return { title: recovery ? `Missing ${route}` : mode === "view" ? "Open a 3D view" : route === "look" ? "Show which look?" : "Show which V?",
      body, choices, recovery, status: d.status, capability: !info.available ? refusal("unavailable", body)
        : choices.length === 1 && "createLook" in choices[0]!.action.choice ? choices[0]!.capability! : deps.access(),
      ...(pointer ? { owner: { panel: owner?.id ?? leader?.id, label: deps.panels?.types().find(item => item.id === type)?.title ?? "chooser",
        prompt: route === "look" ? "No look in this scene. Choose one in" : mode === "view" ? "No 3D view in this tab. Open one in" : "Choose a V in",
        ...(type ? { action: { kind: "empty.choose" as const, destination: ownerDestination, choice: { showOwner: true as const } } } : {}) } } : {}) };
  }
  async function execute(action: EmptyChoiceRequest): Promise<StudioDispatchResult> {
    const allowed = capability(action); if (!allowed.available) return failed(allowed);
    const { destination: d, choice } = action;
    try {
      if ("showOwner" in choice) {
        // Recheck before allocation; concurrent invokers converge on the same owner.
        const matching = () => session.instances(d.ownerType!, d.tab).find(peer => { const candidate = destination(peer.id); return candidate && key(candidate) === key(d); });
        let exact = d.chooser?.instance ?? matching()?.id;
        if (exact && !open(exact, d.tab)) deps.panels!.dispatch({ kind: "panels.show", destination: d.chooser ?? session.panelTarget(exact) });
        if (!exact) {
          deps.panels!.dispatch({ kind: "panels.add", destination: session.panelTabTarget(d.tab), type: d.ownerType!, binding: d.mode === "view" ? { policy: "follow-focus" } : { policy: "pinned", target: { scene: d.target.scene! } } });
          exact = matching()?.id;
        }
        if (!exact) return failed(refusal("missing_target", "That chooser is no longer available."));
        deps.panels!.dispatch({ kind: "panels.reveal", destination: session.panelTarget(exact) });
        return { ok: true };
      }
      if ("restore" in choice) {
        const answer = d.route === "subject" ? services.characters.restore(d.target.subject!.id, d.status!.revision!)
          : services.collections.dispatch({ kind: "collection.restoreLook", collection: d.target.look!.collection,
            base: d.collectionBase!, look: d.target.look!.look });
        return answer.ok ? { ok: true } : failed({ available: false, code: answer.code, reason: answer.reason });
      }
      if ("follow" in choice || "pin" in choice) {
        deps.panels!.dispatch({ kind: "panels.setBinding", destination: d.origin!, binding: "pin" in choice ? choice.pin : { policy: "follow-focus" } });
        return { ok: true };
      }
      let subject = "subject" in choice ? choice.subject : undefined, look = "look" in choice ? choice.look : undefined;
      if ("defaultV" in choice) {
        const p = profile(); if (!p) return failed(refusal("missing_target", "This profile is no longer available."));
        const made = services.characters.create({ source: { kind: "default", bodyGender: choice.defaultV }, profile: { id: p.id, base: p.revision } });
        if (!made.ok) return failed({ available: false, code: made.code, reason: made.reason });
        subject = { kind: "character", id: made.character };
      }
      if ("createLook" in choice) {
        const existing = (profile()?.collections ?? []).map(id => services.collections.collection(id)).find(Boolean), starter = { name: "Look 1", parts: deps.starter() };
        const made = services.collections.dispatch(existing ? { kind: "collection.addLook", collection: existing.id, base: existing.revision, look: starter }
          : { kind: "collection.create", name: "My looks", looks: [starter] },
          { also: collection => { const edit = services.profiles.collectionMembership(session.profile, collection); return edit ? [edit] : []; } });
        if (!made.ok) return failed({ available: false, code: made.code, reason: made.reason });
        look = made.look ?? { collection: made.collection, look: services.collections.collection(made.collection)!.looks[0]! };
      }
      const still = current(d), access = deps.access();
      if (!still.available || !access.available) return failed(!still.available ? still : access);
      const compatible = deps.resolver.accepts(d.instance, { ...(d.mode === "pin" ? {} : d.target), ...(look ? { look } : {}), ...(subject ? { subject } : {}) });
      if (!compatible.available) return failed(compatible);
      if (d.mode === "pin") { deps.panels!.dispatch({ kind: "panels.setBinding", destination: d.origin!, binding: { policy: "pinned", target: look ? { look } : { subject: subject! } } }); return { ok: true }; }
      if (d.mode === "view" && subject) { session.openView(d.tab, deps.baseline(), subject); return { ok: true }; }
      const t = d.target;
      if (t.scene === undefined || t.sceneGen === undefined) return failed(refusal("missing_target", "That scene is no longer available."));
      return deps.dispatch(look ? { kind: "scene.setLook", scene: t.scene, sceneGen: t.sceneGen, look }
        : { kind: "scene.setSubject", scene: t.scene, sceneGen: t.sceneGen, subject: subject! });
    } catch (error) { if (error instanceof TabRefusal) return failed(refusal(error.code, error.message)); throw error; }
  }
  return Object.freeze({ snapshot, capability, execute, descriptors: () => EMPTY_CHOICE_DESCRIPTORS });
}
