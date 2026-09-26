/**
 * "Add to my mod manager" (UI-82): the host service that places one verified build into the person's mod manager or game
 * folder, only after they have read and accepted its plan. Both hosts serve it (`/api/mod-install`); the page names a build
 * by its candidate ID and never supplies a path.
 *
 * - **Plan first.** `plan` says in plain words exactly what would be added and where: the mod's two files into its own Mod
 *   Organizer 2 folder (or the game's `archive\pc\mod` folder on the direct route), and on MO2 the one row added to the
 *   chosen profile's mod list, placed by the MO2 placement rule (mo2-placement.ts: the separator sections are respected,
 *   the file is the reverse of MO2's left pane, frameworks' sections are skipped). Nothing else in the list moves.
 * - **Consent is to that plan.** `install` takes the plan's token and refuses, with nothing changed, when anything the plan
 *   named has changed since (the mod list, an earlier install, the settings, the build).
 * - **Ours only.** The trusted transport (mod-install-transport.ts) copies only the verified pair, never into a folder XF
 *   Studio didn't create, never over a file it didn't put there, and keeps a receipt and backup to undo an update. The
 *   user's frameworks and other mods are never installed, replaced, switched off or moved (AGENTS.md). A predecessor still
 *   switched on is named in the plan for the person to decide.
 * - **Mod Organizer 2 open.** MO2 rewrites its mod list when it closes, so a running MO2 blocks the install with the one
 *   next step (close it), rather than writing a change it would undo.
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { LocalSettings } from "./local-settings";
import { readConfiguredMo2Instance } from "./install-detection-host";
import { applyMo2Placement, planMo2Placement, type Mo2Placement } from "./mo2-placement";
import { createModInstallTransport, inspectLocalPackageCandidate, installedDuplicates } from "./mod-install-transport";
import { EYE_MAKEUP_MOD, eyeMakeupRelatedEntries } from "./mod-branding";
import { modNameIssue } from "./platform/api";
import { MOD_INSTALL_PLAN, MOD_INSTALL_RESULT, type ModInstallPlan, type ModInstallResult, type ModInstallRoute } from "./mod-install-actions";

export type { ModInstallPlan, ModInstallResult, ModInstallRoute } from "./mod-install-actions";

export type ModInstallPorts = {
  /** The host's verified builds (`package-candidates` on desktop, `dist` on localhost). */
  candidateStore: string;
  /** Private receipts, backups and journals; never inside the store or a target. */
  receiptsRoot: string;
  settings(): LocalSettings;
  /** Whether Mod Organizer 2 is running (it rewrites its mod list when it closes). */
  mo2Running?(): boolean;
  /** The profile's framework mod folders, whose section the placement keeps out of. */
  frameworkMods?(settings: LocalSettings): Iterable<string>;
  /** Opens the file manager at `path` with it selected; false when it couldn't. */
  reveal?(path: string): boolean;
  /** Runs an install as one host transaction (desktop: so an update restart waits for it). */
  transaction?<T>(work: () => T): T;
};

/** A refusal with plain words and a code; the endpoint answers it as JSON, never as a bare error. */
export class ModInstallError extends Error {
  constructor(readonly code: "install_blocked" | "stale_plan" | "candidate_missing" | "install_unavailable" | "install_failed", message: string) { super(message); }
}

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const quoted = (name: string) => `“${name}”`;
const safeCandidate = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);

/**
 * The transport's and file system's refusals in plain words (the person reads these in the Studio): what happened, that
 * nothing was changed, and the one next step.
 */
export function plainInstallIssue(error: unknown, modName: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/unowned or changed/i.test(message)) return `There are already files named like ${quoted(modName)}'s that XF Studio didn't put there, ` +
    "so nothing was added. Remove or rename those files, or rename your mod in Mod package, then try again.";
  if (/Owned installed file is missing/i.test(message)) return `Files XF Studio added for ${quoted(modName)} before have been removed or moved, ` +
    "so nothing was changed. Reinstall it by hand, or remove what is left of it, then try again.";
  if (/interrupted install|recover the pending/i.test(message)) return "An earlier install was interrupted and needs to be finished first. " +
    "Restart XF Studio and try again.";
  if (/already active|lock needs review/i.test(message)) return "Another install is running. Wait for it to finish, then try again.";
  if (/Linked path|symlink|junction/i.test(message)) return "That folder is a link to somewhere else, so XF Studio won't write into it. " +
    "Choose the real folder in Game & tools, then try again.";
  if (/Changing the installed namespace/i.test(message)) return `A different collection's ${quoted(modName)} is installed there. ` +
    "Remove it in your mod manager first, or rename this mod in Mod package, then try again.";
  if (/Configured game root|game root is missing|Cyberpunk2077\.exe|archive\/pc|Expected a real directory|Expected a regular file/i.test(message))
    return "XF Studio couldn't find your game or mod manager where Game & tools says they are. Check Game & tools, then try again.";
  // The transport's own refusals about duplicates, other mods and legacy folders are already plain.
  if (/nothing was installed|Nothing was installed|Mod Organizer 2 already has|already installed|legacy folder|Roll back/i.test(message)) return message;
  return "XF Studio couldn't add this mod safely, so nothing was changed. Try again, or report the problem from Help.";
}

export class ModInstallHost {
  constructor(private readonly ports: ModInstallPorts) {}

  /** The plan for one build: what would change and where, or why it can't now. Reads only; changes nothing. */
  plan(candidateId: string): ModInstallPlan {
    return this.prepare(candidateId).plan;
  }

  /** Install exactly the accepted plan; refused (nothing changed) when it no longer matches or is blocked. */
  install(candidateId: string, token: string): ModInstallResult {
    const run = () => {
      const { plan, transport, modlist } = this.prepare(candidateId);
      if (plan.blocked) throw new ModInstallError("install_blocked", plan.blocked);
      if (plan.token !== token) throw new ModInstallError("stale_plan",
        "Something changed since you reviewed this (your mod list, an earlier install or Game & tools), so nothing was changed. Review it again.");
      try { transport!.install(candidateId); }
      catch (error) { throw new ModInstallError("install_blocked", plainInstallIssue(error, plan.modName)); }
      if (plan.route === "direct" || !modlist) return result(plan, `${quoted(plan.modName)} is in your game's archive\\pc\\mod folder. ` +
        "Start the game to see it in the character creator.");
      try { writeModlist(modlist, this.ports.receiptsRoot); }
      catch {
        throw new ModInstallError("install_failed", `${quoted(plan.modName)}'s files were added, but XF Studio couldn't add it to your mod list. ` +
          `Open Mod Organizer 2, switch on ${quoted(plan.modName)} in the profile ${quoted(modlist.profile)}, then start the game from there.`);
      }
      return result(plan, `${quoted(plan.modName)} is in Mod Organizer 2 and switched on in the profile ${quoted(modlist.profile)}. ` +
        "Start the game from Mod Organizer 2 to see it in the character creator.");
    };
    return this.ports.transaction ? this.ports.transaction(run) : run();
  }

  /** Show a build's files in the file manager (its `archive` folder, selected), for a manual install. */
  reveal(candidateId: string): void {
    const { root } = this.candidate(candidateId);
    if (!this.ports.reveal) throw new ModInstallError("install_unavailable", "This version of XF Studio can't open a folder for you.");
    if (!this.ports.reveal(join(root, "archive"))) throw new ModInstallError("install_failed", "XF Studio couldn't open that folder. Try again.");
  }

  private candidate(candidateId: string) {
    if (!safeCandidate(candidateId)) throw new ModInstallError("candidate_missing", "That build isn't one XF Studio made. Build your mod again.");
    try { return inspectLocalPackageCandidate(resolve(this.ports.candidateStore), candidateId); }
    catch { throw new ModInstallError("candidate_missing", "This build's files are no longer there, or were changed. Build your mod again."); }
  }

  private prepare(candidateId: string): { plan: ModInstallPlan; transport?: ReturnType<typeof createModInstallTransport>; modlist?: ModlistChange } {
    const { root, manifest } = this.candidate(candidateId);
    const modName = manifest.modName ?? EYE_MAKEUP_MOD.modName;
    const settings = this.ports.settings(), route: ModInstallRoute = settings.launchRoute;
    const profile = settings.mo2ProfileId ?? "";
    const place = route === "mo2" ? `Mod Organizer 2 (profile ${quoted(profile)})` : "your game folder";
    const base = { schema: MOD_INSTALL_PLAN, candidateId, modName, route, place, notes: [] as string[], replacing: false };
    const blocked = (why: string, changes: string[] = []): { plan: ModInstallPlan } =>
      ({ plan: { ...base, changes, blocked: why, token: sha(JSON.stringify([candidateId, route, why])) } });
    if (modName !== modName.trim() || modNameIssue(modName) !== undefined)
      return blocked("This mod's name can't be used as a folder name. Rename it in Mod package, then build it again.");
    if (!settings.gameRoot) return blocked("Choose your Cyberpunk 2077 folder in Game & tools first.");
    if (route === "mo2" && (!settings.mo2Root || !settings.mo2ProfileId))
      return blocked("Choose your Mod Organizer 2 instance and profile in Game & tools first.");
    let transport: ReturnType<typeof createModInstallTransport>;
    try {
      transport = createModInstallTransport({ candidateStore: resolve(this.ports.candidateStore), receiptsRoot: this.ports.receiptsRoot,
        settings: { ...settings, installMode: route }, modName });
    } catch (error) { return blocked(plainInstallIssue(error, modName)); }
    let target: string, replacing: boolean, files: number;
    try {
      const preflight = transport.preflight(candidateId);
      target = preflight.target; replacing = preflight.replacingOwned; files = preflight.files.length;
    } catch (error) { return blocked(plainInstallIssue(error, modName)); }
    base.replacing = replacing;
    const fileWords = `${files} file${files === 1 ? "" : "s"}`;
    const changes: string[] = [];
    const notes: string[] = [];
    let modlist: ModlistChange | undefined;
    let why: string | null = null;
    // Part of this build already installed somewhere else (another stage, a split mod, a copy by hand): the person decides.
    const xl = manifest.files[1]!;
    const places = installPlaces(settings, route === "mo2" ? readConfiguredMo2Instance(settings.mo2Root!).paths.mods : null)
      .filter(entry => !(replacing && resolve(entry.folder) === resolve(target)) && !(route === "mo2" && resolve(entry.folder) === resolve(target)));
    const duplicates = installedDuplicates(readFileSync(join(root, ...xl.path.split("/")), "utf8"), places);
    if (duplicates.length) why = `Part of this mod is already installed in ${duplicates.join(" and ")}. Remove or switch that off first, then try again.`;
    if (route === "direct") {
      changes.push(replacing ? `Replace the ${fileWords} XF Studio added for ${quoted(modName)} before, in ${target}.`
        : `Copy ${fileWords} into your game's mod folder: ${target}.`);
      notes.push("Mods in the game folder are shared with every mod you install there by hand or with Vortex. XF Studio only ever adds or replaces its own files.");
    } else {
      const { paths } = readConfiguredMo2Instance(settings.mo2Root!);
      const file = join(paths.profiles, profile, "modlist.txt");
      const text = readFileSync(file, "utf8");
      const frameworks = this.ports.frameworkMods?.(settings) ?? [];
      const placement = planMo2Placement(text, modName, { related: eyeMakeupRelatedEntries, frameworkMods: frameworks });
      modlist = { file, text, placement, profile };
      changes.push(replacing ? `Replace the ${fileWords} of the mod ${quoted(modName)} that XF Studio added before, in ${target}.`
        : `Add the mod ${quoted(modName)} to Mod Organizer 2, with its ${fileWords} in ${target}.`);
      const listed = mo2Entry(text, modName);
      changes.push(placement.rule === "existing"
        ? listed === "+" ? `${quoted(modName)} is already switched on in the profile ${quoted(profile)}; it stays where it is.`
          : `${quoted(modName)} is already in the profile ${quoted(profile)}; switch it on where it is.`
        : `Add ${quoted(modName)} to the profile ${quoted(profile)}, switched on. ${placement.description}`);
      changes.push("Nothing else in your mod list changes.");
      for (const older of EYE_MAKEUP_MOD.predecessorMods) if (mo2Entry(text, older) === "+")
        notes.push(`${quoted(older)} is also switched on. It's an older eye makeup mod: switch it off in Mod Organizer 2 if the two clash.`);
      if (this.ports.mo2Running?.()) why ??= "Mod Organizer 2 is open. Close it first, then try again: it rewrites its mod list when it closes, and would undo this.";
    }
    const receipt = transport.receipt();
    const token = sha(JSON.stringify([candidateId, route, target, settings.revision, modlist ? sha(modlist.text) : null,
      receipt ? [receipt.candidateId, receipt.installedAt] : null]));
    return { plan: { ...base, changes, notes, blocked: why, token }, transport, modlist };
  }
}

type ModlistChange = { file: string; text: string; placement: Mo2Placement; profile: string };

/** A mod's row in a mod list: "+" on, "-" off, null when it isn't listed. */
function mo2Entry(text: string, name: string): "+" | "-" | null {
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if ((line[0] === "+" || line[0] === "-") && line.slice(1).trim().toLowerCase() === name.toLowerCase()) return line[0];
  }
  return null;
}

/** Every installed place a duplicate of the build could be: each MO2 mod folder, and the game's own mod folder. */
function installPlaces(settings: LocalSettings, mods: string | null): { label: string; folder: string }[] {
  const places: { label: string; folder: string }[] = [];
  if (mods) {
    let names: string[] = [];
    try { names = readdirSync(mods).filter(name => !name.startsWith(".xfs-")); } catch { /* No mods folder. */ }
    for (const name of names) places.push({ label: `the Mod Organizer 2 mod ${quoted(name)}`, folder: join(mods, name, "archive", "pc", "mod") });
  }
  if (settings.gameRoot) places.push({ label: "your game's archive\\pc\\mod folder", folder: join(settings.gameRoot, "archive", "pc", "mod") });
  return places;
}

/**
 * Add the one row to the profile's mod list: checked against the text the plan read, the previous list kept in the private
 * receipts folder, written beside it and moved into place so MO2 never sees half a file.
 */
function writeModlist(change: ModlistChange, receiptsRoot: string) {
  const now = readFileSync(change.file, "utf8");
  if (now !== change.text) throw Error("The mod list changed.");
  const stat = lstatSync(change.file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error("The mod list is not a plain file.");
  const next = applyMo2Placement(change.text, change.placement, true);
  mkdirSync(join(receiptsRoot, "modlists"), { recursive: true });
  copyFileSync(change.file, join(receiptsRoot, "modlists", `${sha(resolve(change.file)).slice(0, 16)}-${Date.now()}.txt`));
  const temp = join(dirname(change.file), `.${basename(change.file)}.${randomUUID()}.tmp`);
  try { writeFileSync(temp, next, { flag: "wx" }); renameSync(temp, change.file); }
  finally { if (existsSync(temp)) rmSync(temp); }
}

const result = (plan: ModInstallPlan, message: string): ModInstallResult =>
  ({ schema: MOD_INSTALL_RESULT, candidateId: plan.candidateId, modName: plan.modName, route: plan.route, message });

/** Whether a Windows process with this image name is running (tasklist); false where that can't be read. */
export function windowsProcessRunning(image: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    const run = Bun.spawnSync(["tasklist", "/FI", `IMAGENAME eq ${image}`, "/NH", "/FO", "CSV"], { stdout: "pipe", stderr: "ignore" });
    return run.exitCode === 0 && run.stdout.toString().toLowerCase().includes(`"${image.toLowerCase()}"`);
  } catch { return false; }
}

/** Opens Windows Explorer with `path` selected (localhost; the desktop uses its native call). */
export function explorerReveal(path: string): boolean {
  if (process.platform !== "win32") return false;
  try { Bun.spawn(["explorer.exe", `/select,${path}`], { stdio: ["ignore", "ignore", "ignore"] }); return true; } catch { return false; }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const STATUS: Record<ModInstallError["code"], number> = { install_blocked: 409, stale_plan: 409, candidate_missing: 404, install_unavailable: 503, install_failed: 500 };

/**
 * The endpoint both hosts mount at `/api/mod-install`: POST `{ action: "plan" | "install" | "reveal", candidateId, token? }`
 * from the loopback page only. Every answer is JSON with plain words; failures are logged by `log`.
 */
export function createModInstallHandler(host: () => ModInstallHost, log?: (code: string, message: string, error: unknown) => void) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || request.headers.get("Origin") !== url.origin ||
        request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ code: "forbidden", error: "Use XF Studio itself to add a mod." }, 403);
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    let input: { action?: unknown; candidateId?: unknown; token?: unknown };
    try {
      const body = await request.text();
      if (body.length > 4096) throw Error("too large");
      input = JSON.parse(body);
    } catch { return json({ code: "invalid_request", error: "That request wasn't understood." }, 400); }
    const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
    const { action, candidateId, token } = input ?? {};
    if (!["plan", "install", "reveal"].includes(action as string) || typeof candidateId !== "string" ||
        keys.some(key => !["action", "candidateId", "token"].includes(key)) || (action === "install") !== (typeof token === "string"))
      return json({ code: "invalid_request", error: "That request wasn't understood." }, 400);
    try {
      const service = host();
      if (action === "plan") return json(service.plan(candidateId));
      if (action === "install") return json(service.install(candidateId, token as string));
      service.reveal(candidateId);
      return json({ ok: true });
    } catch (error) {
      if (error instanceof ModInstallError) {
        if (error.code === "install_failed") log?.(error.code, error.message, error);
        return json({ code: error.code, error: error.message }, STATUS[error.code]);
      }
      log?.("install_failed", "Adding a mod failed.", error);
      return json({ code: "install_failed", error: "XF Studio couldn't add this mod, so nothing was changed. Try again, or report the problem from Help." }, 500);
    }
  };
}

/** Where a host keeps its install receipts: private, beside its other data, never inside a candidate store or a target. */
export const installReceiptsRoot = (dataRoot: string) => resolve(dataRoot, "install-receipts");
