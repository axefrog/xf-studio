import { TabRefusal } from "./profile-sessions";
import type { Capability } from "../../platform/api";
import type { DockLayout } from "../ui-preferences";
import type { LayoutTab, ClosedTab } from "./profile-session";
import type { LayoutDefaultView } from "./layout-defaults";
import type { SubstitutionChoice } from "./layout-fragment";
import type { TabDefaults } from "./tab-defaults";
import type { ProfileSessions, ViewOpening } from "./profile-sessions";
import type { ProfileServices } from "./profile-window";
import type { SubjectRef } from "../../platform/api/subjects";
import type { LookRef } from "../../library/collection-documents";
import { frozenData } from "./frozen-data";

/** Read-only input for layout-tab presentation. Mutations go through the registered actions. */
export type LayoutTabsPort = {
  snapshot(): { tabs: readonly LayoutTab[]; shown: string; closed: readonly ClosedTab[]; lastDefault?: string; opening?: ViewOpening };
  dock(tab?: string): DockLayout | null;
  /** Detached structural capture: navigation/progress do not invalidate it; replacement and reset do. */
  capture?(tab?: string): () => Capability;
  defaults(): readonly LayoutDefaultView[];
  substitution(id: string, choice?: SubstitutionChoice): ReturnType<TabDefaults["substitution"]>;
  defaultSave?(tab: string): ReturnType<TabDefaults["defaultSave"]>;
  subject(ref: SubjectRef): string;
  look(ref: LookRef): string;
  collection(id: string): string;
  subscribe(listener: () => void): () => void;
};
export function layoutTabsPort(session: ProfileSessions, defaults: TabDefaults,
  services: Pick<ProfileServices, "defaults" | "characters" | "collections" | "profiles">): LayoutTabsPort {
  let snapshot: ReturnType<LayoutTabsPort["snapshot"]> | undefined;
  session.subscribe(() => { snapshot = undefined; });
  return Object.freeze({
    snapshot: () => {
      if (snapshot) return snapshot;
      const opening = session.viewOpening();
      return snapshot = frozenData({ tabs: session.tabList(), shown: session.tabId(), closed: session.closedTabs(), lastDefault: session.lastDefault(),
        opening });
    },
    capture: (tab = session.tabId()) => {
      const destination = tab ? session.panelTabTarget(tab) : undefined;
      return () => {
        try { if (destination) session.checkPanelTarget(destination); else if (session.tabId()) return { available: false, reason: "The tab list changed. Open the command again." };
          return { available: true }; }
        catch (error) { if (error instanceof TabRefusal) return { available: false, reason: error.message }; throw error; }
      };
    },
    dock: (tab?: string) => session.dock(tab), defaults: () => services.defaults.list(),
    substitution: (id: string, choice?: SubstitutionChoice) => defaults.substitution(id, choice),
    defaultSave: (tab: string) => defaults.defaultSave(tab),
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
