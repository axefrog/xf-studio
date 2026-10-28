/** Framework checks for specimens and verification (pure; no files, no host): the same reports the real check makes, built from what
 * a read would have found, through the same wording (`describeInstalled`, `frameworkRouteReport`). The style guide's specimen, the
 * `?verify=1` hooks (tools/framework-status-look.ts) and the tests use them; nothing here reads a computer.
 */
import { describeInstalled, frameworkRouteReport, FRAMEWORKS, normaliseVersion, unavailableRouteReport, type FrameworkId,
  type FrameworkProvider, type FrameworkVersionCheck } from "./framework-catalogue";
import { EYE_ARTISTRY_REQUIREMENTS } from "../legacy/eye-makeup/mod-branding";
import { EYE_MAKEUP_MOD } from "../legacy/eye-makeup/mod-branding";

/** What one framework looks like on a route: absent, or a version found in a copy (with the mod manager's version and other copies). */
export type FrameworkSample = { version: string; provider?: FrameworkProvider; modManagerVersion?: string; hidden?: readonly string[] } | null;
export const FRAMEWORK_PROFILE = "Play";

const mod = (name: string): FrameworkProvider => ({ kind: "mo2-mod", name });
const GAME: FrameworkProvider = { kind: "game", name: "Game folder" };
/** Every framework installed and current, the way a Mod Organizer 2 setup keeps them (three in mods, two in the game folder). */
export const CURRENT_FRAMEWORKS: Readonly<Record<FrameworkId, FrameworkSample>> = Object.freeze({
  archivexl: { version: "1.27.5", provider: mod("ArchiveXL") }, tweakxl: { version: "1.11.5", provider: mod("TweakXL") },
  codeware: { version: "1.20.6", provider: mod("Codeware") }, red4ext: { version: "1.30.0", provider: GAME },
  // The redscript compiler has no version resource: only Mod Organizer's list names its release.
  redscript: { version: "0.5.31", provider: mod("redscript"), modManagerVersion: "0.5.31" }, cet: { version: "1.37.1", provider: GAME },
});

/** A check on the Mod Organizer 2 route, with `changes` laid over the current set (null: not installed). */
export function frameworkCheckSample(changes: Partial<Record<FrameworkId, FrameworkSample>> = {}): FrameworkVersionCheck {
  const sample = { ...CURRENT_FRAMEWORKS, ...changes };
  const frameworks = FRAMEWORKS.map(definition => {
    const found = sample[definition.id];
    const provider = found ? found.provider ?? GAME : null;
    // A version resource names the release; redscript's only names it through the mod manager.
    const file = found && definition.markerHasVersion ? normaliseVersion(found.version) : null;
    return describeInstalled(definition, provider, file, found?.modManagerVersion ? normaliseVersion(found.modManagerVersion)
      : found && !definition.markerHasVersion ? normaliseVersion(found.version) : null, found?.hidden ?? []);
  });
  return { schema: "xfs/framework-version-check-1", mod: EYE_MAKEUP_MOD.modName, requirements: EYE_ARTISTRY_REQUIREMENTS, selectedRoute: "mo2",
    routes: [frameworkRouteReport("mo2", `Mod Organizer 2 profile "${FRAMEWORK_PROFILE}"`, FRAMEWORK_PROFILE, frameworks, EYE_ARTISTRY_REQUIREMENTS, EYE_MAKEUP_MOD.modName)], limitations: [] };
}

/** The states a person meets (the `?verify=1` hook `xfStudioFrameworkStatus.state(name)` names them). "checking" and "no-game" need no
 * check of their own: the first holds a request open, the second has no game folder. */
export const FRAMEWORK_SAMPLE_STATES = ["all-ok", "too-old", "missing", "expressions-ok", "expressions-too-old", "expressions-missing", "requirements-loading", "requirements-failed", "failed", "hidden-duplicate", "checking", "no-game"] as const;
export type FrameworkSampleState = typeof FRAMEWORK_SAMPLE_STATES[number];

export function frameworkCheckFor(state: Exclude<FrameworkSampleState, "no-game">): FrameworkVersionCheck {
  switch (state) {
    case "too-old": return frameworkCheckSample({ archivexl: { version: "1.26.3", provider: mod("ArchiveXL") } });
    case "missing": return frameworkCheckSample({ redscript: null });
    case "expressions-too-old": return frameworkCheckSample({ tweakxl: { version: "1.11.3", provider: mod("TweakXL") } });
    case "expressions-missing": case "requirements-loading": case "requirements-failed": return frameworkCheckSample({ tweakxl: null });
    // Mod Organizer uses the first copy in its list; a second, older ArchiveXL further down is never loaded.
    case "hidden-duplicate": return frameworkCheckSample({ archivexl: { version: "1.27.5", provider: mod("ArchiveXL"), hidden: ["Old ArchiveXL"] } });
    default: return frameworkCheckSample();
  }
}

/** A route that couldn't be read, as the check words it (the Mod Organizer 2 instance isn't chosen yet). */
export function frameworkCheckUnreadable(): FrameworkVersionCheck {
  return { ...frameworkCheckSample(), routes: [unavailableRouteReport("mo2", "Mod Organizer 2", null, "Choose your Mod Organizer 2 folder and profile in Settings › Game.")] };
}
