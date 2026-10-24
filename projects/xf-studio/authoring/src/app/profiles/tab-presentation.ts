import type { DockLayout } from "../ui-preferences";
import type { LayoutTab, ClosedTab } from "./profile-session";
import type { LayoutDefaultView } from "./layout-defaults";
import type { SubstitutionChoice } from "./layout-fragment";
import type { TabDefaults } from "./tab-defaults";
import type { ProfileSessions } from "./profile-sessions";
import type { ProfileServices } from "./profile-window";
import type { SubjectRef } from "../../platform/api/subjects";
import type { LookRef } from "../../library/collection-documents";

/** Read-only input for layout-tab presentation. Mutations go through the registered actions. */
export type LayoutTabsPort = {
  snapshot(): { tabs: readonly LayoutTab[]; shown: string; closed: readonly ClosedTab[]; lastDefault?: string };
  dock(tab?: string): DockLayout | null;
  defaults(): readonly LayoutDefaultView[];
  substitution(id: string, choice?: SubstitutionChoice): ReturnType<TabDefaults["substitution"]>;
  subject(ref: SubjectRef): string;
  look(ref: LookRef): string;
  collection(id: string): string;
  subscribe(listener: () => void): () => void;
};
export function layoutTabsPort(session: ProfileSessions, defaults: TabDefaults,
  services: Pick<ProfileServices, "defaults" | "characters" | "collections" | "profiles">): LayoutTabsPort {
  return Object.freeze({
    snapshot: () => ({ tabs: session.tabList(), shown: session.tabId(), closed: session.closedTabs(), lastDefault: session.lastDefault() }),
    dock: (tab?: string) => session.dock(tab), defaults: () => services.defaults.list(),
    substitution: (id: string, choice?: SubstitutionChoice) => defaults.substitution(id, choice),
    subject: (ref: SubjectRef) => ref.kind === "character" ? services.characters.character(ref.id)?.label ?? "Unnamed V" : ref.kind,
    look: (ref: LookRef) => services.collections.look(ref)?.name ?? "Unnamed look",
    collection: (id: string) => services.collections.collection(id)?.name ?? "Collection",
    subscribe: (listener: () => void) => {
      const off = [session.subscribe(listener), services.defaults.subscribe(listener), services.characters.subscribe(listener),
        services.collections.subscribe(listener), services.profiles.subscribe(listener)];
      return () => off.forEach(stop => stop());
    },
  });
}
