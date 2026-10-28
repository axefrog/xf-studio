/** What Settings › Game › Mod frameworks shows, derived from the read-only framework check (pure: no DOM, no host).
 *
 * One row per framework the check covers, for the route the person launches with: the version the game will load and where it comes
 * from, and a status. Required frameworks come from every product the person builds; the others are listed as not needed. A problem's one
 * next step is the check's own plain sentence plus links to the framework's official release pages: the page never installs or
 * updates anything (AGENTS.md, "Don't touch users' core mod setups"). Words and rules: research/authoring/framework-version-check.md.
 */
import { requirementsForProducts, frameworkVerdicts, frameworkLinkId, FRAMEWORKS, showVersion, type FrameworkId, type FrameworkLink, type FrameworkLinkId,
  type FrameworkProduct, type FrameworkProvider, type FrameworkRouteReport, type FrameworkVersionCheck, type InstalledFramework } from "./framework-catalogue";

import { frameworkInputKey, type FrameworkInputFields } from "./framework-check-watch";
import type { InstallDetectionState } from "./install-detection-actions";

/** Select only the report and failure belonging to these inputs. A report from another route is never a fallback. */
export function frameworkStatusForInputs(fields: FrameworkInputFields | undefined, read: Readonly<InstallDetectionState>, products: readonly FrameworkProduct[] = [], requirements?: FrameworkRequirementsState): FrameworkStatusView {
  const key = fields ? frameworkInputKey(fields) : undefined;
  const attempt = read.frameworkAttempt?.inputKey === key ? read.frameworkAttempt : undefined;
  const check = key && read.frameworksInputKey === key && read.frameworks?.selectedRoute === fields?.launchRoute ? read.frameworks : undefined;
  return frameworkStatusView({ gameChosen: !!fields?.gameRoot, check, checking: !!attempt?.pending, error: attempt?.error, products, requirements });
}

export type FrameworkRequirementsState = { readonly phase: "ready" | "loading" } | { readonly phase: "failed"; readonly message: string };

export type FrameworkRowStatus = "ok" | "too-old" | "missing" | "unreadable" | "not-needed";
export type FrameworkRowView = {
  readonly id: FrameworkId;
  readonly name: string;
  readonly neededFor: string | null;
  readonly status: FrameworkRowStatus;
  readonly badge: { readonly text: string; readonly tone: "success" | "warning" | "neutral" };
  /** The meta line's facts, in order: the version the game will load, where it comes from. */
  readonly facts: readonly string[];
  /** What to do, in the check's own words (a problem only). */
  readonly message: string | null;
  /** Other things worth knowing (a hidden second copy, Mod Organizer's list disagreeing with the file). */
  readonly notes: readonly string[];
  /** The framework's official release pages (a problem only). */
  readonly links: readonly { readonly id: FrameworkLinkId; readonly label: FrameworkLink["label"]; readonly name: string }[];
};
export type FrameworkStatusView = {
  readonly retryRequirements?: boolean;
  /** Shown once a game folder is chosen. */
  readonly shown: boolean;
  readonly checking: boolean;
  readonly tone: "ready" | "attention" | "checking" | "info";
  /** The one plain line above the rows. */
  readonly line: string;
  readonly rows: readonly FrameworkRowView[];
  /** How many needed frameworks are too old, missing or unreadable. */
  readonly attention: number;
  /** Everything needed is fine: the rows fold under the line. */
  readonly foldable: boolean;
};
export type FrameworkStatusInput = {
  readonly requirements?: FrameworkRequirementsState;
  readonly gameChosen: boolean;
  readonly check: FrameworkVersionCheck | undefined;
  readonly checking: boolean;
  readonly error?: string;
  readonly products?: readonly FrameworkProduct[];
};

export const FRAMEWORKS_CHECKING = "Checking your frameworks…";
export const FRAMEWORKS_UNCHECKED = "Your frameworks haven't been checked yet. Choose Check again.";
export const FRAMEWORKS_ALL_GOOD = "All frameworks up to date";
export const FRAMEWORKS_NOT_NEEDED = "Not needed for what you build";

const sourceWords = (provider: FrameworkProvider) => provider.kind === "game" ? "the game folder"
  : provider.kind === "mo2-overwrite" ? "Mod Organizer 2's overwrite folder" : `the Mod Organizer 2 mod “${provider.name}”`;

function facts(installed: InstalledFramework | undefined): string[] {
  if (!installed?.installed) return ["Not installed"];
  return [installed.version ? showVersion(installed.version) : "Version unknown", ...(installed.provider ? [`from ${sourceWords(installed.provider)}`] : []),
    ...(installed.version && installed.versionSource === "mod-manager" ? ["version from Mod Organizer's list"] : [])];
}

function rowsOf(route: FrameworkRouteReport, products: readonly FrameworkProduct[] = []): FrameworkRowView[] {
  const requirements = requirementsForProducts(products), verdicts = frameworkVerdicts(route.frameworks, route.route, requirements);
  const needed = new Set(requirements.map(requirement => requirement.framework));
  const ordered = [...FRAMEWORKS].sort((a, b) => Number(needed.has(b.id)) - Number(needed.has(a.id)));
  return ordered.map(definition => {
    const installed = route.frameworks.find(row => row.framework === definition.id);
    const verdict = verdicts.find(row => row.framework === definition.id);
    const minimum = (requirements.find(row => row.framework === definition.id)?.minimum) ?? verdict?.minimum;
    const status: FrameworkRowStatus = !verdict ? "not-needed" : verdict.status === "ok" ? "ok" : verdict.status === "outdated" ? "too-old"
      : verdict.status === "missing" ? "missing" : "unreadable";
    const badge = status === "ok" ? { text: "Up to date", tone: "success" as const }
      : status === "too-old" ? { text: `Too old (minimum ${showVersion(minimum ?? "")})`, tone: "warning" as const }
        : status === "missing" ? { text: "Missing", tone: "warning" as const }
          : status === "unreadable" ? { text: "Version unknown", tone: "warning" as const }
            : { text: FRAMEWORKS_NOT_NEEDED, tone: "neutral" as const };
    const problem = status === "too-old" || status === "missing" || status === "unreadable";
    return { id: definition.id, name: definition.name, neededFor: needed.has(definition.id) ? `Needed for ${requirements.find(row => row.framework === definition.id)!.products!.join(" and ")}` : null, status, badge, facts: facts(installed), message: problem ? verdict?.message ?? null : null,
      notes: installed?.notes ?? [],
      links: problem ? definition.links.map(link => ({ id: frameworkLinkId(definition.id, link.label), label: link.label, name: `${definition.name} on ${link.label}` })) : [] };
  });
}

/** The group's content for what the check last said (`check`), whether one is running (`checking`) and whether a game folder is chosen. */
export function frameworkStatusView(input: FrameworkStatusInput): FrameworkStatusView {
  const none = { checking: input.checking, rows: [] as FrameworkRowView[], attention: 0, foldable: false };
  if (!input.gameChosen) return { ...none, shown: false, tone: "info", line: "" };
  if (input.requirements?.phase === "loading") return { ...none, shown: true, tone: "checking", line: "Checking what your mods need…" };
  if (input.requirements?.phase === "failed") return { ...none, shown: true, tone: "info", line: input.requirements.message, retryRequirements: true };
  if (input.error && !input.checking) return { ...none, shown: true, tone: "info", line: input.error };
  const check = input.check;
  const route = check ? check.routes.find(row => row.route === check.selectedRoute) : undefined;
  if (!check || !route || !route.available)
    return { ...none, shown: true, tone: input.checking ? "checking" : "info",
      line: input.checking ? FRAMEWORKS_CHECKING : route?.problem ?? FRAMEWORKS_UNCHECKED };
  const rows = rowsOf(route, [{ name: check.mod, requirements: check.requirements }, ...(input.products ?? [])]);
  const attention = rows.filter(row => row.status === "too-old" || row.status === "missing" || row.status === "unreadable").length;
  return { shown: true, checking: input.checking, rows, attention, foldable: attention === 0,
    tone: input.checking ? "checking" : attention ? "attention" : "ready",
    line: input.checking ? FRAMEWORKS_CHECKING : attention ? `${attention} ${attention === 1 ? "framework needs" : "frameworks need"} attention` : FRAMEWORKS_ALL_GOOD };
}
