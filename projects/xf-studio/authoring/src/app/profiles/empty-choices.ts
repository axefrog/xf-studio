/** U6: profile candidates and captured Choose routes. Owners keep all documents, scene targets and structure. */
import { refusal, type Capability } from "../../platform/api/capability";
import type { SubjectRef } from "../../platform/api/subjects";
import type { ViewGraphData } from "../../platform/api/view-graph";
import type { LookRef } from "../../library/collection-documents";
import type { LookInput } from "../../library/collection-owner";
import type { StudioDispatchResult } from "../studio-application";
import { EMPTY_CHOICE_DESCRIPTORS } from "../studio-action-descriptors";
import { captureCurrent, type Target } from "./bindings";
import type { ProfileServices } from "./profile-window";
import { TabRefusal, type PanelTarget, type ProfileSessions } from "./profile-sessions";
import { openIn } from "./panel-dock";
import type { SceneAction } from "./scene-commands";
import type { TargetResolver } from "./targets";

export type EmptyDestination = { readonly instance: string; readonly tab: string; readonly route: "subject" | "look" | "view"; readonly target: Target; readonly origin?: PanelTarget };
export type EmptyChoiceValue = { readonly subject: SubjectRef } | { readonly look: LookRef } | { readonly defaultV: "female" | "male" } | { readonly createLook: true };
export type EmptyChoiceRequest = { readonly kind: "empty.choose"; readonly destination: EmptyDestination; readonly choice: EmptyChoiceValue };
export type EmptyChoiceSnapshot = { readonly title: string; readonly body: string; readonly capability: Capability;
  readonly owner?: { readonly panel: string; readonly label: string; readonly prompt: string };
  readonly choices: readonly { readonly id: string; readonly label: string; readonly name: string; readonly action: EmptyChoiceRequest }[] };
export type EmptyChoicesPort = {
  snapshot(panel: string): EmptyChoiceSnapshot | null;
  capability(action: EmptyChoiceRequest): Capability;
  execute(action: EmptyChoiceRequest): Promise<StudioDispatchResult>;
  descriptors(): typeof EMPTY_CHOICE_DESCRIPTORS;
};
type Deps = { readonly session: ProfileSessions; readonly resolver: TargetResolver;
  readonly services: Pick<ProfileServices, "profiles" | "characters" | "collections">;
  starter(): LookInput["parts"];
  createLookCapability(collection: string): Capability;
  access(): Capability; baseline(): ViewGraphData; dispatch(action: SceneAction): StudioDispatchResult };
const failed = (allowed: Capability): StudioDispatchResult => ({ ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "That choice is unavailable." });

export function emptyChoicesPort(deps: Deps): EmptyChoicesPort {
  const { session, resolver, services } = deps;
  const profile = () => services.profiles.profile(session.profile);
  const subjects = () => (profile()?.subjects ?? []).filter(ref => ref.kind === "character" && !!services.characters.document(ref.id));
  const looks = () => (profile()?.collections ?? []).flatMap(collection => (services.collections.collection(collection)?.looks ?? [])
    .map(look => ({ collection, look }))).filter(ref => services.collections.look(ref)?.state === "live");
  function current(destination: EmptyDestination): Capability {
    if (destination.origin) try { session.checkPanelTarget(destination.origin); }
    catch (error) { if (error instanceof TabRefusal) return refusal("missing_target", error.message); throw error; }
    const panel = session.panel(destination.instance);
    if (!panel || panel.tab !== destination.tab) return refusal("missing_target", "That panel's tab changed or closed. Choose again.");
    const chain = captureCurrent(resolver.world(), { target: destination.target, revisions: {} }, () => undefined);
    if (!chain.available) return chain;
    // A focus move does not retarget a choice. A captured scene remains the destination until its own chain changes.
    if (destination.target.scene !== undefined) return { available: true };
    const resolved = resolver.resolve(destination.instance);
    if (resolved.state !== "empty" || resolved.missing !== destination.route)
      return refusal("missing_target", "What this panel shows changed. Choose again.");
    const target = resolved.target ?? {}, before = destination.target;
    if (target.view !== before.view || target.scene !== before.scene || target.sceneGen !== before.sceneGen)
      return refusal("missing_target", "This panel now follows another 3D view. Choose again.");
    return { available: true };
  }
  function capability(action: EmptyChoiceRequest): Capability {
    const access = deps.access(); if (!access.available) return access;
    const same = current(action.destination); if (!same.available) return same;
    const { choice, destination } = action;
    if ("subject" in choice) return destination.route !== "look" && subjects().some(ref => ref.kind === choice.subject.kind && ref.id === choice.subject.id)
      ? { available: true } : refusal("missing_target", "That V is no longer in this profile. Choose another V.");
    if ("look" in choice) return destination.route === "look" && looks().some(ref => ref.collection === choice.look.collection && ref.look === choice.look.look)
      ? { available: true } : refusal("missing_target", "That look is no longer in this profile. Choose another look.");
    if ("defaultV" in choice && destination.route !== "look" && (choice.defaultV === "female" || choice.defaultV === "male")) return { available: true };
    if ("createLook" in choice && destination.route === "look") {
      const existing = (profile()?.collections ?? []).map(id => services.collections.collection(id)).find(Boolean);
      return existing ? deps.createLookCapability(existing.id) : { available: true };
    }
    return refusal("invalid_value", "Choose one of the available options.");
  }
  function snapshot(panel: string): EmptyChoiceSnapshot | null {
    if (!session.tabId()) return null;
    const instance = session.instance(panel), resolved = resolver.resolve(instance);
    if (resolved.state !== "empty" || !resolved.missing || !["subject", "look", "view"].includes(resolved.missing)) return null;
    const route = resolved.missing as EmptyDestination["route"], tab = session.panel(instance)?.tab;
    if (!tab) return null;
    const destination: EmptyDestination = { instance, tab, route, origin: session.panelTarget(instance), target: structuredClone(resolved.target ?? {}) };
    const choices: EmptyChoiceSnapshot["choices"][number][] = [];
    const add = (id: string, label: string, name: string, choice: EmptyChoiceValue) => choices.push({ id, label, name, action: { kind: "empty.choose", destination, choice } });
    let body: string;
    if (route === "look") {
      for (const ref of looks()) { const name = services.collections.look(ref)!.name; add(`look:${ref.collection}/${ref.look}`, name, `Show ${name} in this scene`, { look: ref }); }
      body = choices.length ? "This scene has no look yet." : "There are no looks in this profile yet.";
      if (!choices.length) add("create-look", "Create a look", "Create a look and show it in this scene", { createLook: true });
    } else {
      for (const ref of subjects()) { const name = services.characters.character(ref.id)!.label;
        add(`subject:${ref.id}`, name, route === "view" ? `Open a 3D view showing ${name} in this tab` : `Show ${name} in this 3D view`, { subject: ref }); }
      const empty = !choices.length;
      body = route === "view" ? "This tab has no 3D view." : "This 3D view has no V yet.";
      if (empty) body += " There are no Vs in this profile yet.";
      // No-candidate panels need one next step; a V-less view always offers both game defaults.
      add("default-female", empty && route === "view" ? "Use the default V" : "Default V (feminine)",
        route === "view" ? "Open a 3D view showing the default feminine V in this tab" : "Show the default feminine V in this 3D view", { defaultV: "female" });
      if (!empty || route === "subject") add("default-male", "Default V (masculine)",
        route === "view" ? "Open a 3D view showing the default masculine V in this tab" : "Show the default masculine V in this 3D view", { defaultV: "male" });
    }
    const owner = route === "look" ? session.instances("presets", tab).find(peer => {
      if (!(openIn(session.dock(tab), peer.id, "wide") || openIn(session.dock(tab), peer.id, "compact"))) return false;
      const result = resolver.resolve(peer.id);
      return result.state === "empty" && result.missing === route && result.target?.scene === destination.target.scene;
    }) : undefined;
    return { title: route === "view" ? "Open a 3D view" : route === "look" ? "Show which look?" : "Show which V?", body, choices, capability: choices.length === 1 && "createLook" in choices[0]!.action.choice ? capability(choices[0]!.action) : deps.access(),
      ...((owner || !session.panel(panel) && route === "look") ? { owner: { panel: owner && session.panel(panel) ? owner.id : "presets", label: "Presets", prompt: "No look in this scene. Choose one in" } } : {}) };
  }
  async function execute(action: EmptyChoiceRequest): Promise<StudioDispatchResult> {
    const allowed = capability(action); if (!allowed.available) return failed(allowed);
    const { destination, choice } = action;
    let subject = "subject" in choice ? choice.subject : undefined;
    let look = "look" in choice ? choice.look : undefined;
    if ("defaultV" in choice) {
      const p = profile(); if (!p) return failed(refusal("missing_target", "This profile is no longer available."));
      const made = services.characters.create({ source: { kind: "default", bodyGender: choice.defaultV }, profile: { id: p.id, base: p.revision } });
      if (!made.ok) return failed({ available: false, code: made.code, reason: made.reason });
      subject = { kind: "character", id: made.character };
      const access = deps.access(); if (!access.available) return failed(access);
      const still = current(destination); if (!still.available) return failed(still);
    }
    if ("createLook" in choice) {
      const existing = (profile()?.collections ?? []).map(id => services.collections.collection(id)).find(Boolean);
      const starter = { name: "Look 1", parts: deps.starter() };
      const made = services.collections.dispatch(existing ? { kind: "collection.addLook", collection: existing.id, base: existing.revision, look: starter }
        : { kind: "collection.create", name: "My looks", looks: [starter] },
      { also: collection => { const edit = services.profiles.collectionMembership(session.profile, collection); return edit ? [edit] : []; } });
      if (!made.ok) return failed({ available: false, code: made.code, reason: made.reason });
      look = made.look ?? { collection: made.collection, look: services.collections.collection(made.collection)!.looks[0]! };
    }
    if (destination.route === "view" && subject) {
      try { session.openView(destination.tab, deps.baseline(), subject); return { ok: true }; }
      catch (error) { return { ok: false, code: "missing_target", message: (error as Error).message }; }
    }
    const target = destination.target;
    if (target.scene === undefined || target.sceneGen === undefined) return failed(refusal("missing_target", "That scene is no longer available."));
    return deps.dispatch(look ? { kind: "scene.setLook", ...target, scene: target.scene, sceneGen: target.sceneGen, look }
      : { kind: "scene.setSubject", ...target, scene: target.scene, sceneGen: target.sceneGen, subject: subject! });
  }
  return Object.freeze({ snapshot, capability, execute, descriptors: () => EMPTY_CHOICE_DESCRIPTORS });
}
