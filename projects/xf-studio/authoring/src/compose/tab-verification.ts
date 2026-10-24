/** Isolated U1–U6 capture fixtures. Installed only by the composition root under ?verify=1. */
import type { ProfileServices } from "../app/profiles/profile-window";
import type { ProfileSessions } from "../app/profiles/profile-sessions";
import type { DocumentOutbox } from "../platform/core/document-outbox";
import { tabDefaults } from "../app/profiles/profile-window";
import { viewPanelId } from "../platform/api/view-graph";
import type { Capability } from "../platform/api/capability";

export function tabVerification(session: ProfileSessions, services: ProfileServices, outbox: DocumentOutbox, writable: () => boolean, changed: () => void = () => {}) {
  const check = () => { if (!writable()) throw Error("Create fixtures in the writable verification workspace first."); };
  let readOnlyChoices = false;
  return {
    /** U6-only lease specimen; the real lease still fences every write. */
    u6ReadOnly(enabled = true) { check(); readOnlyChoices = enabled; changed(); },
    choiceAccess: (): Capability => readOnlyChoices ? { available: false, code: "unavailable", reason: "This workspace is open in another window." } : { available: true },
    /** Replace verification-profile memberships with an exact candidate count and open the requested U6 route. */
    async u6(route: "subject" | "look" | "view", count = 0) {
      check(); readOnlyChoices = false;
      if (!["subject", "look", "view"].includes(route) || !Number.isInteger(count) || count < 0 || count > 12) throw Error("Choose a U6 route and 0–12 candidates.");
      const profile = () => services.profiles.profile(session.profile)!;
      for (const subject of profile().subjects) {
        const p = profile(), result = await services.profiles.dispatch({ kind: "profile.removeSubject", profile: p.id, base: p.revision, subject });
        if (!result.ok) throw Error(result.reason);
      }
      for (const collection of profile().collections) {
        for (const look of services.collections.collection(collection)?.looks ?? []) {
          const held = services.collections.collection(collection)!, result = services.collections.dispatch({ kind: "collection.removeLook", collection, base: held.revision, look });
          if (!result.ok) throw Error(result.reason);
        }
      }
      const subjects: string[] = [];
      for (let i = 0; i < count; i++) {
        const p = profile(), result = await services.characters.create({ name: `ManualSave-${i + 1}`, profile: { id: p.id, base: p.revision } });
        if (!result.ok) throw Error(result.reason); subjects.push(result.character);
      }
      let collection: string | undefined;
      if (count) {
        const result = services.collections.dispatch({ kind: "collection.create", name: "U6 looks", looks: Array.from({ length: count }, (_, i) => ({ name: `Look ${i + 1}` })) },
          { also: id => { const edit = services.profiles.collectionMembership(session.profile, id); return edit ? [edit] : []; } });
        if (!result.ok) throw Error(result.reason); collection = result.collection;
      }
      const commands = tabDefaults(session, services), plan = commands.substitution("eye-makeup/default");
      if (!("subjects" in plan)) throw Error(plan.reason);
      commands.dispatch({ kind: "tabs.new", default: "eye-makeup/default", choice: {
        subjects: Object.fromEntries(plan.subjects.map(slot => [slot.key, null])), looks: Object.fromEntries(plan.looks.map(slot => [slot.key, null])),
        scenes: Object.fromEntries(plan.scenes.map(slot => [slot.key, null])),
      } });
      const tab = session.tabId(), view = session.graph.viewIds().find(view => session.viewTab(view) === tab)!;
      const scene = session.graph.node(view, "scene").id;
      if (route === "view") session.closeView(view);
      else {
        // A look-less scene still shows a V, even in the zero-member specimen (an orphan, not a profile candidate).
        if (route === "look") {
          let character = subjects[0];
          if (!character) { const made = await services.characters.create(); if (!made.ok) throw Error(made.reason); character = made.character; }
          session.setSubject(scene, { kind: "character", id: character });
        }
        session.focus.focusView(view);
      }
      return { tab, view: route === "view" ? undefined : view, scene: route === "view" ? undefined : scene,
        panel: route === "subject" ? viewPanelId(view) : "layers", subjects, collection,
        looks: collection ? services.collections.collection(collection)!.looks : [] };
    },
    async seed() {
      check();
      const profile = () => {
        const found = services.profiles.profile(session.profile);
        if (!found) throw Error("The verification profile is missing.");
        return found;
      };
      const subjects: string[] = [];
      for (const name of ["Capture V A", "Capture V B"]) {
        const p = profile(), made = await services.characters.create({ name, profile: { id: p.id, base: p.revision } });
        if (!made.ok) throw Error(made.reason);
        subjects.push(made.character);
      }
      const made = services.collections.dispatch({ kind: "collection.create", name: "Capture looks",
        looks: Array.from({ length: 10 }, (_, n) => ({ name: `Capture look ${n + 1}` })) });
      if (!made.ok) throw Error(made.reason);
      const p = profile(), added = await services.profiles.dispatch({ kind: "profile.addCollection", profile: p.id, base: p.revision, collection: made.collection });
      if (!added.ok) throw Error(added.reason);
      return { subjects, collection: made.collection, looks: services.collections.collection(made.collection)!.looks };
    },
    removeSubject(id: string) {
      check(); const p = services.profiles.profile(session.profile)!;
      return services.profiles.dispatch({ kind: "profile.removeSubject", profile: p.id, base: p.revision, subject: { kind: "character", id } });
    },
    removeLook(collection: string, look: string) {
      check(); const held = services.collections.collection(collection)!;
      return services.collections.dispatch({ kind: "collection.removeLook", collection, base: held.revision, look });
    },
    async unavailableDefault() {
      check();
      const source = services.defaults.list().find(view => !view.unavailable)!;
      const id = `d-${crypto.randomUUID().replaceAll("-", "")}`;
      // Deliberately model a document from a newer build; the real reader supplies its unavailable reason.
      const fragment = { ...source.fragment, panels: [...source.fragment.panels, { key: "future", type: "future.panel" }] };
      outbox.commit("verification.newerDefault", [{ kind: "layout-default", id, value: {
        schema: "xfs/layout-default-1", id, name: "From a newer Studio", owner: "user", fragment, createdAt: Date.now(),
      } }]);
      await services.defaults.load();
      return id;
    },
  };
}
