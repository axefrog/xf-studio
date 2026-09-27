import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { defaultLocalSettings, type LocalSettings, type LocalSettingsDraft } from "./local-settings";
import { evaluateLocalReadiness, packageToolPaths, type HostFeatures, type LocalReadiness } from "./local-settings-readiness";
import { LocalSettingsStore } from "./local-settings-store";
import { EYE_PLATE_HEAD_CHOICES, EYE_PLATE_HEAD_SETTING, type EyePlateHead } from "./eye-plate-head-choice";

export type LocalSetupFields = Pick<LocalSettings, "gameRoot" | "launchRoute" | "mo2Root" | "mo2ProfileId" |
  "manualModRoot" | "wolvenKitCli" | "eyePlateHead" | "savesDirectory">;
/**
 * Where the game's saves are read from (the Save Explorer and its endpoints): the folder the person chose, else the one the host
 * detected, unless a developer override (`XFS_SAVES_DIR`, localhost only) names another. The detected folder is only ever described
 * ("Saved Games › CD Projekt Red › Cyberpunk 2077"); its path, which holds the person's profile folder, never leaves the host.
 */
export type LocalSavesView = {
  source: "chosen" | "detected" | "developer";
  /** The detected folder, described; null where there is nothing to detect (not Windows, or no user profile). */
  detected: { display: string; found: boolean } | null;
  /** Whether the chosen folder is there (null when none is chosen). */
  chosenFound: boolean | null;
};
/** The host's saves folder detection, for the settings view (`saves-host-sources.ts` provides it). */
export type SavesFolderProbe = {
  detected(): Promise<{ path: string; display: string } | null>;
  /** Whether a developer override names the saves folder instead. */
  developerOverride(): boolean;
};
export type LocalSetupView = {
  revision: number;
  source: "new" | "primary" | "backup";
  fields: LocalSetupFields;
  readiness: LocalReadiness;
  overridden: string[];
  /** How the Studio names the eye plate head choice, so its form and Build's messages agree. */
  eyePlateHead: { label: string; options: { value: EyePlateHead; label: string }[] };
  saves: LocalSavesView;
};
const fieldNames = ["gameRoot", "launchRoute", "mo2Root", "mo2ProfileId", "manualModRoot",
  "wolvenKitCli", "eyePlateHead", "savesDirectory"] as const;
const overrideNames = ["XFS_PACKAGE_GAMEPATH", "XFS_PACKAGE_PLATE", "XFS_PACKAGE_WOLVENKIT", "XFS_PACKAGE_BUN"] as const;
const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
/**
 * A newly chosen saves folder, checked before it is saved: a whole path to a folder that is there. The words say what to do
 * (UI-109); other folder settings are only checked for form here, and readiness says what is missing.
 */
function savesFolderRefusal(value: unknown): { code: string; error: string } | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) return { code: "saves_folder_invalid", error: "Type the folder your saves are in." };
  if (!isAbsolute(value.trim())) return { code: "saves_folder_invalid",
    error: "Type the whole folder, starting with its drive, for example D:\\Saves\\Cyberpunk 2077." };
  if (!isDirectory(value.trim())) return { code: "saves_folder_missing",
    error: "XF Studio can't find that folder. Check how it's typed, or copy the folder's address from File Explorer's address bar." };
  return null;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Host-owned configuration endpoint. The browser can edit known fields, never select a settings file. */
export function createLocalSettingsHandler(store = new LocalSettingsStore(), env = process.env,
  host: HostFeatures | ((settings: LocalSettings) => HostFeatures) = { updater: false, installer: false },
  /** XF Studio's own downloaded WolvenKit, used when neither an override nor a setting names one. */
  managedWolvenKit: () => string | null = () => null,
  /** The host's saves folder detection; without it the view says only whether a chosen folder is there. */
  saves: SavesFolderProbe | null = null) {
  const savesView = async (settings: LocalSettings): Promise<LocalSavesView> => {
    const detected = saves ? await saves.detected().catch(() => null) : null;
    return { source: saves?.developerOverride() ? "developer" : settings.savesDirectory ? "chosen" : "detected",
      detected: detected ? { display: detected.display, found: isDirectory(detected.path) } : null,
      chosenFound: settings.savesDirectory ? isDirectory(settings.savesDirectory) : null };
  };
  const view = async (): Promise<LocalSetupView> => {
    const loaded = store.load();
    const paths = packageToolPaths(loaded.settings, env, managedWolvenKit());
    const effective = { ...loaded.settings, gameRoot: paths.gamepath,
      wolvenKitCli: paths.wolvenkit };
    return { revision: loaded.settings.revision, source: loaded.source,
      fields: Object.fromEntries(fieldNames.map(key => [key, loaded.settings[key]])) as unknown as LocalSetupFields,
      readiness: evaluateLocalReadiness(effective, typeof host === "function" ? host(effective) : host),
      overridden: overrideNames.filter(name => !!env[name]),
      eyePlateHead: { label: EYE_PLATE_HEAD_SETTING.label,
        options: EYE_PLATE_HEAD_CHOICES.map(value => ({ value, label: EYE_PLATE_HEAD_SETTING.options[value] })) },
      saves: await savesView(loaded.settings),
    };
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to configure this host." }, 403);
    if (request.method !== "GET" && request.method !== "PATCH" && request.method !== "POST")
      return json({ code: "method", error: "Method not allowed." }, 405);
    if (request.method !== "GET" && (request.headers.get("Origin") !== url.origin ||
        request.headers.get("Content-Type")?.split(";")[0] !== "application/json"))
      return json({ code: "forbidden", error: "Use the local studio to configure this host." }, 403);
    if (request.method === "GET") {
      try { return json(await view()); }
      catch { return json({ code: "settings_unreadable", error: "Local setup is unreadable. Restore its previous copy or repair it on this computer." }, 500); }
    }
    if (Number(request.headers.get("Content-Length")) > 16_384) return json({ code: "too_large", error: "Local setup request is too large." }, 413);
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 16_384) return json({ code: "too_large", error: "Local setup request is too large." }, 413);
      const input = JSON.parse(body);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid local setup action.");
      if (request.method === "POST") {
        if (input.action !== "restorePrevious" || Object.keys(input).length !== 1) throw Error("Invalid recovery action.");
        store.restorePrevious();
        return json(await view());
      }
      if (Object.keys(input).some(key => key !== "revision" && key !== "fields") ||
          !Number.isSafeInteger(input.revision) || !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields) ||
          Object.keys(input.fields).some(key => !fieldNames.includes(key as typeof fieldNames[number])))
        throw Error("Invalid local setup fields.");
      const current = store.load();
      if (current.source === "backup") return json({ code: "recovery_required", error: "Restore the previous settings copy before editing." }, 409);
      // Only a newly chosen saves folder is checked, so a folder that has since gone never blocks saving other fields.
      if ("savesDirectory" in input.fields && input.fields.savesDirectory !== current.settings.savesDirectory) {
        const refusal = savesFolderRefusal(input.fields.savesDirectory);
        if (refusal) return json(refusal, 400);
        if (typeof input.fields.savesDirectory === "string") input.fields.savesDirectory = input.fields.savesDirectory.trim();
      }
      const draft: LocalSettingsDraft = { ...defaultLocalSettings(), ...current.settings, ...input.fields };
      store.save(draft, input.revision);
      return json(await view());
    } catch (error) {
      const message = (error as Error).message;
      return json({ code: message.includes("changed since") ? "stale_revision" : "invalid_settings", error: message },
        message.includes("changed since") ? 409 : 400);
    }
  };
}
