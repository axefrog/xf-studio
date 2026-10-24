/** Isolated U1–U5 capture fixtures. Installed only by the composition root under ?verify=1. */
import type { ProfileServices } from "../app/profiles/profile-window";
import type { ProfileSessions } from "../app/profiles/profile-sessions";
import type { DocumentOutbox } from "../platform/core/document-outbox";

export function tabVerification(session: ProfileSessions, services: ProfileServices, outbox: DocumentOutbox, writable: () => boolean) {
  const check = () => { if (!writable()) throw Error("Create fixtures in the writable verification workspace first."); };
  return {
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
