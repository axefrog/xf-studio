/**
 * The layout tabs' actions over the window's session and the default layouts (profiles design §4.1, §4.2; experiment 044 chunk P2-ii):
 * the `tabs.*` operations `ProfileSessions` runs alone, and those that name a default, which this joins to `LayoutDefaults`.
 *
 * - **`tabs.new`** makes a tab from a default: its substitution (`substitutionOf`) over the profile's subjects and looks and the session's
 *   scenes, with the person's choices, instantiated with the session's fresh IDs. A V another tab shows is shared by default (M2).
 * - **`tabs.reset`** fills a tab with a default again (default: the one it was made from); what it held is kept as a closed fragment.
 *   Until P2-iii, the tab holding the drawn view can't be reset, and the refusal says so.
 * - **`tabs.saveAsDefault`** saves a tab as an own default (a `layout-default` document, through the outbox) and makes it the tab's
 *   origin; **`tabs.updateDefault`** saves the tab over the own default it was made from (never a module's).
 * - **`defaults.rename`, `defaults.delete`, `defaults.restore`** act on own defaults; a module's are read-only.
 *
 * It holds no state of its own: the session owns the tabs, `LayoutDefaults` the own defaults.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import type { DefaultLayoutContribution } from "../../platform/api/layout-fragment";
import { ViewGraphError } from "../../platform/core/view-graph";
import { buildIssues, fillOf, fragmentIssues, fragmentOfTab, instantiateFragment, substitutionOf, type FragmentKnowledge, type Substitution,
  type SubstitutionChoice, type SubstitutionContext } from "./layout-fragment";
import type { LayoutDefaults, LayoutDefaultView } from "./layout-defaults";
import type { TabId } from "./profile-session";
import { TabRefusal, type ProfileSessions, type TabAction } from "./profile-sessions";

/** The actions that name a default (experiment 044 §2.2, §2.4). */
export type DefaultsAction =
  | { kind: "tabs.new"; default: string; choice?: SubstitutionChoice }
  | { kind: "tabs.reset"; tab: TabId; default?: string; choice?: SubstitutionChoice }
  | { kind: "tabs.saveAsDefault"; tab: TabId; name: string }
  | { kind: "tabs.updateDefault"; tab: TabId }
  | { kind: "defaults.rename"; default: string; name: string }
  | { kind: "defaults.delete"; default: string }
  | { kind: "defaults.restore"; default: string };
/** Every layout tab action. */
export type LayoutTabAction = TabAction | DefaultsAction;
const DEFAULTS_KINDS: ReadonlySet<string> = new Set(["tabs.new", "tabs.reset", "tabs.saveAsDefault", "tabs.updateDefault", "defaults.rename", "defaults.delete", "defaults.restore"]);

export type TabDefaultsDeps = {
  readonly sessions: ProfileSessions;
  readonly defaults: LayoutDefaults;
  /**
   * What the profile and the session offer a new tab, read when an action needs it: the profile's subjects, its live looks (collection
   * order) and the scenes the session shows (the input layer orders them, the most recently focused first: the scene shared by default).
   */
  candidates(): SubstitutionContext;
  /** Panel types whose state a default keeps (`stateInDefaults`). */
  keepsState?(type: string): boolean;
  /** What this build has (the verification command checks a printed default against it). */
  readonly known?: FragmentKnowledge;
};

/** A new tab from a default (or a reset), worked out without changing anything: the default, its substitution, the tab's name and origin. */
type Plan = { readonly view: LayoutDefaultView; readonly substitution: Substitution };

export class TabDefaults {
  constructor(private readonly deps: TabDefaultsDeps) {}

  /** The substitution New tab ▸ (or Reset to default ▸) offers for a default, with `choice` applied, as data (P2-iv presents it). */
  substitution(defaultId: string, choice?: SubstitutionChoice): Substitution | Capability {
    try { return this.plan(defaultId, choice).substitution; } catch (error) { return refusalOf(error); }
  }

  capability(action: LayoutTabAction): Capability {
    if (!DEFAULTS_KINDS.has(action.kind)) return this.deps.sessions.capability(action as TabAction);
    try { this.check(action as DefaultsAction); return { available: true }; } catch (error) { return refusalOf(error); }
  }
  dispatch(action: LayoutTabAction): undefined {
    if (!DEFAULTS_KINDS.has(action.kind)) return this.deps.sessions.dispatch(action as TabAction);
    const { sessions, defaults } = this.deps, act = action as DefaultsAction;
    switch (act.kind) {
      case "tabs.new": {
        const { view, substitution } = this.plan(act.default, act.choice);
        sessions.newTab(instantiateFragment(view.fragment, fillOf(substitution), sessions, { name: view.name, origin: view.id }));
        break;
      }
      case "tabs.reset": {
        const id = this.resetDefault(act.tab, act.default);
        sessions.checkClosable(act.tab, "reset");
        const { view, substitution } = this.plan(id, act.choice);
        sessions.reset(act.tab, instantiateFragment(view.fragment, fillOf(substitution), sessions, { name: sessions.tab(act.tab)!.name, origin: view.id }));
        break;
      }
      case "tabs.saveAsDefault": {
        const made = defaults.dispatch({ kind: "create", name: act.name, fragment: this.fragment(act.tab, act.name) });
        if (!made.ok) throw refused(made.code, made.reason);
        sessions.setOrigin(act.tab, made.id);
        break;
      }
      case "tabs.updateDefault": {
        const origin = this.ownOrigin(act.tab), done = defaults.dispatch({ kind: "update", id: origin.id, fragment: this.fragment(act.tab, origin.name) });
        if (!done.ok) throw refused(done.code, done.reason);
        break;
      }
      default: {
        const done = defaults.dispatch(act.kind === "defaults.rename" ? { kind: "rename", id: act.default, name: act.name }
          : { kind: act.kind === "defaults.delete" ? "delete" : "restore", id: act.default });
        if (!done.ok) throw refused(done.code, done.reason);
      }
    }
    return undefined;
  }
  private check(action: DefaultsAction) {
    const { sessions, defaults } = this.deps;
    switch (action.kind) {
      case "tabs.new": this.plan(action.default, action.choice); return;
      case "tabs.reset": sessions.checkClosable(this.existing(action.tab), "reset"); this.plan(this.resetDefault(action.tab, action.default), action.choice); return;
      case "tabs.saveAsDefault": throwIf(defaults.capability({ kind: "create", name: action.name, fragment: this.fragment(action.tab, action.name) })); return;
      case "tabs.updateDefault": { const origin = this.ownOrigin(action.tab); throwIf(defaults.capability({ kind: "update", id: origin.id, fragment: this.fragment(action.tab, origin.name) })); return; }
      case "defaults.rename": throwIf(defaults.capability({ kind: "rename", id: action.default, name: action.name })); return;
      case "defaults.delete": throwIf(defaults.capability({ kind: "delete", id: action.default })); return;
      case "defaults.restore": throwIf(defaults.capability({ kind: "restore", id: action.default })); return;
    }
  }

  /**
   * A tab as a module's default, for the verification-only command that prints it (decision M1 of experiment 044): arrange a tab in the
   * Studio, print it, and paste it into the module's defaults. Refused when this build couldn't make a tab from it.
   */
  contributionOf(tab: TabId, meta: { id: string; name: string; description: string }): DefaultLayoutContribution {
    const fragment = this.fragment(tab, meta.name), structure = fragmentIssues(fragment);
    const issues = structure.length || !this.deps.known ? structure : buildIssues(fragment, this.deps.known);
    if (issues.length) throw new TabRefusal("invalid_value", `This tab can't be a default: ${issues.join("; ")}.`);
    return { id: meta.id, name: meta.name, description: meta.description, fragment };
  }

  private existing(tab: TabId): TabId {
    if (typeof tab !== "string" || !this.deps.sessions.tab(tab)) throw new TabRefusal("missing_target", "That tab is closed.");
    return tab;
  }
  /** The default a reset fills the tab with: the one named, else the one the tab was made from. */
  private resetDefault(tab: TabId, named: string | undefined): string {
    const origin = this.deps.sessions.tab(this.existing(tab))!.origin;
    if (named !== undefined) return named;
    if (!origin) throw new TabRefusal("missing_target", "This tab wasn't made from a default. Choose one to reset it to.");
    return origin;
  }
  private plan(id: string, choice: SubstitutionChoice | undefined): Plan {
    const view = typeof id === "string" ? this.deps.defaults.get(id) : undefined;
    // A module's default this build doesn't have (a tab made in another version), or an own default deleted since.
    if (!view) throw new TabRefusal("missing_target", typeof id === "string" && id.includes("/") ? "That default isn't in this version of XF Studio."
      : "That default was deleted.");
    if (view.unavailable) throw new TabRefusal("incompatible_mode", view.unavailable);
    if (choice !== undefined && (typeof choice !== "object" || !choice)) throw new TabRefusal("invalid_value", "Those choices can't be read.");
    const substitution = substitutionOf(view.fragment, this.deps.candidates(), choice);
    if ("issue" in substitution) throw new TabRefusal("missing_target", substitution.issue);
    return { view, substitution };
  }
  /** A tab as a fragment named `name` (refused when it can't be one). */
  private fragment(tab: TabId, name: string) {
    const { sessions } = this.deps;
    const fragment = fragmentOfTab(sessions.session(), this.existing(tab), { name: typeof name === "string" ? name.trim() : "", ...(this.deps.keepsState ? { keepsState: this.deps.keepsState } : {}) });
    // Its name and what it holds are checked by the default it makes (`LayoutDefaults`), which says which is wrong.
    if (!fragment) throw new TabRefusal("invalid_value", "This tab can't be saved as a default.");
    return fragment;
  }
  /** The own default a tab was made from (Update "<name>" saves over only that). */
  private ownOrigin(tab: TabId): LayoutDefaultView {
    const origin = this.deps.sessions.tab(this.existing(tab))!.origin, view = origin ? this.deps.defaults.get(origin) : undefined;
    if (!view || view.owner.kind !== "user") throw new TabRefusal("invalid_value", "This tab wasn't made from a default of yours. Save it as a new default instead.");
    return view;
  }
}

const refused = (code: Capability["code"], reason: string | undefined) =>
  new TabRefusal(code === "missing_target" || code === "incompatible_mode" || code === "unavailable" ? code : "invalid_value", reason ?? "That can't be done.");
function throwIf(capability: Capability) { if (!capability.available) throw refused(capability.code, capability.reason); }
function refusalOf(error: unknown): Capability {
  if (error instanceof TabRefusal || error instanceof ViewGraphError) return refusal(error.code, error.message);
  throw error;
}
