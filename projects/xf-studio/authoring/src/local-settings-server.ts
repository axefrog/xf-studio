import { defaultLocalSettings, type LocalSettings, type LocalSettingsDraft } from "./local-settings";
import { evaluateLocalReadiness, packageToolPaths, type HostFeatures, type LocalReadiness } from "./local-settings-readiness";
import { LocalSettingsStore } from "./local-settings-store";
import { EYE_PLATE_HEAD_CHOICES, EYE_PLATE_HEAD_SETTING, type EyePlateHead } from "./eye-plate-head-choice";

export type LocalSetupFields = Pick<LocalSettings, "gameRoot" | "launchRoute" | "mo2Root" | "mo2ProfileId" |
  "manualModRoot" | "wolvenKitCli" | "bunExecutable" | "eyePlateHead">;
export type LocalSetupView = {
  revision: number;
  source: "new" | "primary" | "backup";
  fields: LocalSetupFields;
  readiness: LocalReadiness;
  overridden: string[];
  /** How the Studio names the eye plate head choice, so its form and Build's messages agree. */
  eyePlateHead: { label: string; options: { value: EyePlateHead; label: string }[] };
};
const fieldNames = ["gameRoot", "launchRoute", "mo2Root", "mo2ProfileId", "manualModRoot",
  "wolvenKitCli", "bunExecutable", "eyePlateHead"] as const;
const overrideNames = ["XFS_PACKAGE_GAMEPATH", "XFS_PACKAGE_PLATE", "XFS_PACKAGE_WOLVENKIT"] as const;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Host-owned configuration endpoint. The browser can edit known fields, never select a settings file. */
export function createLocalSettingsHandler(store = new LocalSettingsStore(), env = process.env,
  host: HostFeatures | ((settings: LocalSettings) => HostFeatures) = { updater: false, installer: false },
  /** XF Studio's own downloaded WolvenKit, used when neither an override nor a setting names one. */
  managedWolvenKit: () => string | null = () => null) {
  const view = (): LocalSetupView => {
    const loaded = store.load();
    const paths = packageToolPaths(loaded.settings, env, managedWolvenKit());
    const effective = { ...loaded.settings, gameRoot: paths.gamepath,
      wolvenKitCli: paths.wolvenkit, bunExecutable: paths.bun };
    return { revision: loaded.settings.revision, source: loaded.source,
      fields: Object.fromEntries(fieldNames.map(key => [key, loaded.settings[key]])) as unknown as LocalSetupFields,
      readiness: evaluateLocalReadiness(effective, typeof host === "function" ? host(effective) : host),
      overridden: overrideNames.filter(name => !!env[name]),
      eyePlateHead: { label: EYE_PLATE_HEAD_SETTING.label,
        options: EYE_PLATE_HEAD_CHOICES.map(value => ({ value, label: EYE_PLATE_HEAD_SETTING.options[value] })) },
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
      try { return json(view()); }
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
        return json(view());
      }
      if (Object.keys(input).some(key => key !== "revision" && key !== "fields") ||
          !Number.isSafeInteger(input.revision) || !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields) ||
          Object.keys(input.fields).some(key => !fieldNames.includes(key as typeof fieldNames[number])))
        throw Error("Invalid local setup fields.");
      const current = store.load();
      if (current.source === "backup") return json({ code: "recovery_required", error: "Restore the previous settings copy before editing." }, 409);
      const draft: LocalSettingsDraft = { ...defaultLocalSettings(), ...current.settings, ...input.fields };
      store.save(draft, input.revision);
      return json(view());
    } catch (error) {
      const message = (error as Error).message;
      return json({ code: message.includes("changed since") ? "stale_revision" : "invalid_settings", error: message },
        message.includes("changed since") ? 409 : 400);
    }
  };
}
