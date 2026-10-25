/** The frameworks the check covers, what XF Eye Artistry needs of them, and the plain-language verdicts (pure: no files, no Node).
 *
 * The page uses this module directly (Settings › Game › Mod frameworks, the Mod package card), and `framework-versions.ts` reads the
 * installed files and fills in the reports these types describe. Evidence rules and the reasoning behind each minimum:
 * research/authoring/framework-version-check.md.
 */
import { EYE_MAKEUP_MOD } from "../legacy/eye-makeup/mod-branding";

export type FrameworkId = "archivexl" | "tweakxl" | "codeware" | "red4ext" | "redscript" | "cet";
export interface FrameworkLink { readonly label: "Nexus Mods" | "GitHub"; readonly url: string }
export interface FrameworkDefinition {
  readonly id: FrameworkId;
  readonly name: string;
  /** A file every install of this framework has, relative to the game folder. */
  readonly marker: string;
  /** Whether the marker carries a Windows version resource that names the release. */
  readonly markerHasVersion: boolean;
  readonly links: readonly FrameworkLink[];
}
const nexus = (id: number): FrameworkLink => ({ label: "Nexus Mods", url: `https://www.nexusmods.com/cyberpunk2077/mods/${id}` });
const github = (repo: string): FrameworkLink => ({ label: "GitHub", url: `https://github.com/${repo}/releases/latest` });

export const FRAMEWORKS: readonly FrameworkDefinition[] = Object.freeze([
  { id: "archivexl", name: "ArchiveXL", marker: "red4ext/plugins/ArchiveXL/ArchiveXL.dll", markerHasVersion: true,
    links: [nexus(4198), github("psiberx/cp2077-archive-xl")] },
  { id: "tweakxl", name: "TweakXL", marker: "red4ext/plugins/TweakXL/TweakXL.dll", markerHasVersion: true,
    links: [nexus(4197), github("psiberx/cp2077-tweak-xl")] },
  { id: "codeware", name: "Codeware", marker: "red4ext/plugins/Codeware/Codeware.dll", markerHasVersion: true,
    links: [nexus(7780), github("psiberx/cp2077-codeware")] },
  { id: "red4ext", name: "RED4ext", marker: "red4ext/RED4ext.dll", markerHasVersion: true,
    links: [nexus(2380), github("wopss/RED4ext")] },
  // The redscript compiler carries no version resource; only mod-manager metadata names its release.
  { id: "redscript", name: "redscript", marker: "engine/tools/scc.exe", markerHasVersion: false,
    links: [nexus(1511), github("jac3km4/redscript")] },
  { id: "cet", name: "Cyber Engine Tweaks", marker: "bin/x64/plugins/cyber_engine_tweaks.asi", markerHasVersion: true,
    links: [nexus(107), github("maximegmd/CyberEngineTweaks")] },
]);

/**
 * The named pages the page may ask a host to open for a framework (`framework-<id>-nexus` and `framework-<id>-github`). The page names
 * a page; it never supplies a URL (`app/project-links.ts` maps these ids to the links above).
 */
export type FrameworkLinkId = `framework-${FrameworkId}-${"nexus" | "github"}`;
const SITE_OF = { "Nexus Mods": "nexus", GitHub: "github" } as const;
export const frameworkLinkId = (framework: FrameworkId, label: FrameworkLink["label"]): FrameworkLinkId => `framework-${framework}-${SITE_OF[label]}`;
export const FRAMEWORK_LINK_URLS: Readonly<Record<FrameworkLinkId, string>> = Object.freeze(Object.fromEntries(
  FRAMEWORKS.flatMap(definition => definition.links.map(link => [frameworkLinkId(definition.id, link.label), link.url]))) as Record<FrameworkLinkId, string>);

export interface FrameworkRequirement { readonly framework: FrameworkId; readonly minimum: string; readonly reason: string; readonly products?: readonly string[] }
export type FrameworkProduct = { readonly name: string; readonly requirements: readonly FrameworkRequirement[] };
/** The strongest minimum per framework, keeping the products that need it. Eye Artistry is always included. */
export function requirementsForProducts(products: readonly FrameworkProduct[] = []): FrameworkRequirement[] {
  const combined = new Map<FrameworkId, FrameworkRequirement>();
  for (const product of [{ name: EYE_MAKEUP_MOD.modName, requirements: EYE_ARTISTRY_REQUIREMENTS }, ...products]) {
    for (const requirement of product.requirements) {
      const previous = combined.get(requirement.framework);
      const strongest = previous && compareVersions(previous.minimum, requirement.minimum) >= 0 ? previous : requirement;
      combined.set(requirement.framework, { ...strongest, products: [...new Set([...(previous?.products ?? []), product.name])] });
    }
  }
  return [...combined.values()];
}
/** Pinned minimums for the eye-makeup package. TweakXL, Codeware and CET are not needed by it. */
export const EYE_ARTISTRY_REQUIREMENTS: readonly FrameworkRequirement[] = Object.freeze([
  { framework: "archivexl", minimum: "1.27.3", reason: "The package's selector, appearance and material wiring was designed and verified against the ArchiveXL 1.27.3 source; no earlier release has been checked." },
  { framework: "red4ext", minimum: "1.29.0", reason: "ArchiveXL 1.27.3 lists RED4ext 1.29.0 or newer as its installation requirement." },
  { framework: "redscript", minimum: "0.5.31", reason: "ArchiveXL 1.27.3 lists redscript 0.5.31 or newer for its bundled scripts." },
]);

export type FrameworkProvider = { readonly kind: "game" | "mo2-mod" | "mo2-overwrite"; readonly name: string };
export interface InstalledFramework {
  readonly framework: FrameworkId;
  readonly name: string;
  readonly installed: boolean;
  /** Normalised major.minor.patch, or null when absent or unreadable. */
  readonly version: string | null;
  /** `file` = version resource of the loaded binary (authoritative); `mod-manager` = MO2 meta.ini. */
  readonly versionSource: "file" | "mod-manager" | null;
  readonly fileVersion: string | null;
  readonly modManagerVersion: string | null;
  /** The copy the game would see through this route. */
  readonly provider: FrameworkProvider | null;
  /** Other enabled copies that the provider hides (MO2 priority). */
  readonly hiddenCopies: readonly string[];
  readonly notes: readonly string[];
}
export type FrameworkVerdictStatus = "ok" | "outdated" | "missing" | "unknown-version";
export interface FrameworkVerdict {
  readonly framework: FrameworkId;
  readonly name: string;
  readonly minimum: string;
  readonly installed: string | null;
  readonly status: FrameworkVerdictStatus;
  /** Plain-language next step; null when nothing needs doing. */
  readonly message: string | null;
  readonly links: readonly FrameworkLink[];
}
export interface FrameworkRouteReport {
  readonly route: "direct" | "mo2";
  readonly label: string;
  readonly profileId: string | null;
  /** False when this route could not be read; `problem` then says why in plain words. */
  readonly available: boolean;
  readonly problem: string | null;
  readonly frameworks: readonly InstalledFramework[];
  readonly verdicts: readonly FrameworkVerdict[];
  readonly ready: boolean;
}
export interface FrameworkVersionCheck {
  readonly schema: "xfs/framework-version-check-1";
  readonly mod: string;
  readonly requirements: readonly FrameworkRequirement[];
  /** The route the user launches with; its verdicts are the ones that matter. */
  readonly selectedRoute: "direct" | "mo2";
  readonly routes: readonly FrameworkRouteReport[];
  readonly limitations: readonly string[];
}

/** Leading major.minor.patch of a version string such as "1.27.3.0", "v1.37.1 [HEAD]" or "1.27.3.17607". */
export function normaliseVersion(text: string | null | undefined): string | null {
  const match = /^\s*v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?/i.exec(text ?? "");
  return match ? `${Number(match[1])}.${Number(match[2] ?? 0)}.${Number(match[3] ?? 0)}` : null;
}
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}
/** A version as a person reads it: whole, as the framework's own releases are named ("RED4ext 1.30.0", "ArchiveXL 1.27.5"). */
export const showVersion = (version: string) => version;

/** Each required framework's verdict, in plain words that name the one next step. */
export function frameworkVerdicts(frameworks: readonly InstalledFramework[], route: "direct" | "mo2", requirements: readonly FrameworkRequirement[] = EYE_ARTISTRY_REQUIREMENTS): FrameworkVerdict[] {
  const where = route === "mo2" ? "Update it in Mod Organizer 2 with the latest release from Nexus Mods or GitHub."
    : "Update it with the latest release from Nexus Mods or GitHub.";
  return requirements.map(requirement => {
    const definition = FRAMEWORKS.find(row => row.id === requirement.framework)!;
    const found = frameworks.find(row => row.framework === requirement.framework)!;
    const names = requirement.products?.join(" and ") ?? EYE_MAKEUP_MOD.modName;
    const subject = names[0]!.toUpperCase() + names.slice(1);
    const needs = `${subject} ${(requirement.products && requirement.products.length > 1) || names === "expression sets" ? "need" : "needs"} ${definition.name} ${showVersion(requirement.minimum)} or newer`;
    const base = { framework: definition.id, name: definition.name, minimum: requirement.minimum,
      installed: found.version, links: definition.links };
    if (!found.installed) return { ...base, status: "missing" as const,
      message: `${needs}, and it isn't installed ${route === "mo2" ? "in this profile" : "in the game folder"}. ` +
        `Install it${route === "mo2" ? " in Mod Organizer 2" : ""} from Nexus Mods or GitHub.` };
    if (!found.version) return { ...base, status: "unknown-version" as const,
      message: `We found ${definition.name} but couldn't tell which version it is. ${needs}; if you're not sure, ` +
        "reinstall the latest release from Nexus Mods or GitHub." };
    if (compareVersions(found.version, requirement.minimum) < 0) return { ...base, status: "outdated" as const,
      message: `${needs}; you have ${showVersion(found.version)}. ${where}` };
    return { ...base, status: "ok" as const, message: null };
  });
}

/**
 * One framework as a route sees it, from what was read: the copy the game would load (`winner`), its file and mod-manager versions and
 * the other enabled copies it hides. The notes are plain sentences about what is odd (a stale mod list, a second copy).
 */
export function describeInstalled(definition: Pick<FrameworkDefinition, "id" | "name">, winner: FrameworkProvider | null, fileVersion: string | null,
  modManagerVersion: string | null, hiddenCopies: readonly string[]): InstalledFramework {
  const version = fileVersion ?? modManagerVersion;
  const notes: string[] = [];
  if (fileVersion && modManagerVersion && compareVersions(fileVersion, modManagerVersion) !== 0)
    notes.push(`Mod Organizer lists ${definition.name} ${showVersion(modManagerVersion)}, but the installed file is ` +
      `${showVersion(fileVersion)}. The file is what the game loads.`);
  if (winner && hiddenCopies.length)
    notes.push(`${definition.name} is installed more than once in this profile. Mod Organizer uses the copy in ` +
      `"${winner.name}"; ${hiddenCopies.map(name => `"${name}"`).join(", ")} ${hiddenCopies.length === 1 ? "is" : "are"} not used.`);
  return { framework: definition.id, name: definition.name, installed: !!winner, version,
    versionSource: fileVersion ? "file" : modManagerVersion ? "mod-manager" : null, fileVersion, modManagerVersion,
    provider: winner ? { kind: winner.kind, name: winner.name } : null, hiddenCopies, notes };
}

/** A route that was read: its frameworks and the verdicts on the ones the package needs. */
export function frameworkRouteReport(route: "direct" | "mo2", label: string, profileId: string | null,
  frameworks: readonly InstalledFramework[]): FrameworkRouteReport {
  const verdicts = frameworkVerdicts(frameworks, route);
  return { route, label, profileId, available: true, problem: null, frameworks, verdicts, ready: verdicts.every(row => row.status === "ok") };
}
/** A route that couldn't be read, with the reason in plain words. */
export const unavailableRouteReport = (route: "direct" | "mo2", label: string, profileId: string | null, problem: string): FrameworkRouteReport =>
  ({ route, label, profileId, available: false, problem, frameworks: [], verdicts: [], ready: false });
