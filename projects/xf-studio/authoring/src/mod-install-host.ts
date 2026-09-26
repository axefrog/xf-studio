/**
 * "Add to my mod manager" (UI-82): the host service that places one verified build into the person's mod manager or game
 * folder, only after they have read and accepted its plan. Both hosts serve it (`/api/mod-install`); the page names a build
 * by its candidate ID and never supplies a path.
 *
 * - **Plan first.** `plan` says in plain words exactly what would be added and where: the mod's two files into its own Mod
 *   Organizer 2 folder (or the game's `archive\pc\mod` folder on the direct route), and on MO2 the one row added to the
 *   chosen profile's mod list, placed by the MO2 placement rule (mo2-placement.ts: the separator sections are respected,
 *   the file is the reverse of MO2's left pane, frameworks' sections are skipped). Nothing else in the list moves. A plan
 *   changes nothing of the person's, with one exception: an earlier install that was interrupted is finished or undone
 *   first, following its journal, and the plan says so (INSTALL-02).
 * - **Consent is to that plan.** `install` takes the plan's token and refuses, with nothing changed, when anything the plan
 *   named has changed since (the mod list and where the row would go, an earlier install, the settings, the build).
 * - **Ours only.** The trusted transport (mod-install-transport.ts) copies only the verified pair, never into a folder XF
 *   Studio didn't create, never over a file it didn't put there, and keeps a receipt and backup to undo an update. The
 *   receipts are per user on this computer, shared by every XF Studio host (INSTALL-04). The user's frameworks and other
 *   mods are never installed, replaced, switched off or moved (AGENTS.md). A predecessor still switched on is named in the
 *   plan for the person to decide.
 * - **Mod Organizer 2 or the game open.** MO2 rewrites its mod list when it closes, and a running game holds the mod's
 *   `.archive` open, so either blocks the change it would undo or break, with the one next step (close it). Where XF Studio
 *   can't tell whether they run, it waits too (INSTALL-10).
 * - **Test copies never write.** A verification workspace and a test server with its own data folder get `readOnly`: plans
 *   still read, every change is refused (INSTALL-01).
 */
import { createHash, randomUUID } from "node:crypto";
import { accessSync, closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { LocalSettings } from "./local-settings";
import { readConfiguredMo2Instance } from "./install-detection-host";
import { parseMo2Modlist } from "./mo2-instance";
import { decodeModlist, encodeModlist, type ModlistEncoding } from "./mo2-modlist-text";
import { applyMo2Placement, mo2ModlistEntry, planMo2Placement, type Mo2Placement } from "./mo2-placement";
import { createModInstallTransport, findInstalledDuplicates, inspectLocalPackageCandidate } from "./mod-install-transport";
import { EYE_MAKEUP_MOD, eyeMakeupRelatedEntries } from "./mod-branding";
import { modNameIssue } from "./platform/api";
import { attributeVortexFile } from "./vortex-deployment";
import { readVortexManifests } from "./vortex-host";
import { MOD_INSTALL_PLAN, MOD_INSTALL_RESULT, type ModInstallNextStep, type ModInstallPlan, type ModInstallResult,
  type ModInstallRoute } from "./mod-install-actions";

export type { ModInstallPlan, ModInstallResult, ModInstallRoute } from "./mod-install-actions";

/** Whether Mod Organizer 2 and the game are running; null where that couldn't be read. */
export type RunningApps = { mo2: boolean | null; game: boolean | null };

export type ModInstallPorts = {
  /** The host's verified builds (`package-candidates` on desktop, `dist` on localhost). */
  candidateStore: string;
  /** Private receipts, backups and journals, per user on this computer (host-state.ts `machineInstallReceiptsRoot`); never inside the store or a target. */
  receiptsRoot: string;
  /** Earlier per-host receipts folders: a record found there for the same target is taken over once (INSTALL-04). */
  legacyReceiptsRoots?: readonly string[];
  settings(): LocalSettings;
  /** Whether Mod Organizer 2 (it rewrites its mod list when it closes) and the game (it holds the `.archive` open) are running. */
  running?(): RunningApps | Promise<RunningApps>;
  /** The profile's framework mod folders, whose section the placement keeps out of. */
  frameworkMods?(settings: LocalSettings): Iterable<string>;
  /** The system ANSI code page, for a mod list an older MO2 or an editor stored in it; null or absent: UTF-8 lists only. */
  ansiCodePage?(): number | null;
  /** Opens the file manager at `path` with it selected; false when it couldn't. */
  reveal?(path: string): boolean;
  /** Runs an install as one host transaction (desktop: so an update restart waits for it). */
  transaction?<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Refuse every change with this plain reason (a verification workspace, or a test server with its own data folder): plans
   * are still made, reading only, and interrupted installs are left for a normal session to finish (INSTALL-01).
   */
  readOnly?: string;
};

/** A refusal with plain words and a code; the endpoint answers it as JSON, never as a bare error. */
export class ModInstallError extends Error {
  constructor(readonly code: "install_blocked" | "stale_plan" | "candidate_missing" | "install_unavailable" | "install_failed", message: string) { super(message); }
}

/** What a verification workspace and a test server say instead of adding a mod (INSTALL-01, UI-98). */
export const READ_ONLY_VERIFICATION = "This is a test workspace, so XF Studio doesn't add mods from it. Open XF Studio normally to add your mod.";
export const READ_ONLY_TEST_SERVER = "This copy of XF Studio runs with its own test settings, so it doesn't add mods. Open XF Studio normally to add your mod.";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const quoted = (name: string) => `“${name}”`;
const safeCandidate = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const CHECK_AGAIN = "then choose Check again.";

/** Where the file a refusal names came from, when that changes the advice (a file Vortex deployed must be changed in Vortex). */
export type InstallIssueContext = { vortexOwner?(file: string): string | null };

/**
 * The transport's and file system's refusals in plain words (the person reads these in the Studio): what happened, that
 * nothing was changed, and the one next step, with the button that goes with it (UI-99, UI-100).
 */
export function installIssue(error: unknown, modName: string, context: InstallIssueContext = {}): { text: string; next: ModInstallNextStep } {
  const message = error instanceof Error ? error.message : String(error);
  const unowned = /unowned or changed: (.+)$/i.exec(message);
  if (unowned) {
    // Renaming a file Vortex deployed would break Vortex's own record of it: the change is made in Vortex.
    const owner = context.vortexOwner?.(unowned[1]!.trim()) ?? null;
    if (owner) return { next: "rename", text: `Vortex has already put a file named like ${quoted(modName)}'s into your game folder (the Vortex mod ` +
      `${quoted(owner)}), so nothing was added. Remove or disable that mod in Vortex and deploy, or rename your mod in Mod package, then try again.` };
    return { next: "rename", text: `There are already files named like ${quoted(modName)}'s that XF Studio didn't put there, so nothing was added. ` +
      "Remove those files, or rename your mod in Mod package, then try again." };
  }
  if (/Owned installed file is missing/i.test(message)) return { next: "retry", text: `Files XF Studio added for ${quoted(modName)} before have been ` +
    `removed or moved, so nothing was changed. Remove what is left of ${quoted(modName)} in your mod manager, ${CHECK_AGAIN}` };
  if (/interrupted install|recover the pending/i.test(message)) return { next: "retry", text: "An earlier install was interrupted before it " +
    `finished. XF Studio finishes or undoes it when you check again: close the game if it's running, ${CHECK_AGAIN}` };
  if (/already active|lock needs review/i.test(message)) return { next: "retry", text: `Another install is running. Wait for it to finish, ${CHECK_AGAIN}` };
  if (/Linked path|symlink|junction/i.test(message)) return { next: "setup", text: "That folder is a link to somewhere else, so XF Studio won't " +
    "write into it. Choose the real folder in Game & tools, then try again." };
  if (/Changing the installed namespace/i.test(message)) return { next: "rename", text: `A different collection's ${quoted(modName)} is installed ` +
    "there. Remove it in your mod manager first, or rename this mod in Mod package, then try again." };
  const legacy = /legacy folder "([^"]+)"/.exec(message);
  if (legacy) return { next: "retry", text: `Mod Organizer 2 still has an early test copy of this mod: the mod ${quoted(legacy[1]!)}. ` +
    `Remove that mod in Mod Organizer 2 (right-click it, then Remove mod), ${CHECK_AGAIN}` };
  if (/Configured game root|game root is missing|Cyberpunk2077\.exe|archive\/pc|Expected a real directory|Expected a regular file|MO2 instance and profile/i.test(message))
    return { next: "setup", text: "XF Studio couldn't find your game or mod manager where Game & tools says they are. Check Game & tools, then try again." };
  // The transport's own refusals about another XF mod and a foreign MO2 folder are already plain.
  if (/nothing was installed|Nothing was installed|Mod Organizer 2 already has/i.test(message)) return { next: "rename", text: message };
  return { next: "retry", text: "XF Studio couldn't add this mod safely, so nothing was changed. Try again, or report the problem from Help." };
}
/** `installIssue`'s words only. */
export const plainInstallIssue = (error: unknown, modName: string, context?: InstallIssueContext) => installIssue(error, modName, context).text;

const gameOpen = (game: boolean | null) => game === null
  ? `XF Studio couldn't check whether Cyberpunk 2077 is running. Close the game if it is, ${CHECK_AGAIN}`
  : `Cyberpunk 2077 is running. Close the game, ${CHECK_AGAIN} Windows won't let XF Studio replace a mod file the game is using.`;
const mo2Open = (mo2: boolean | null) => mo2 === null
  ? `XF Studio couldn't check whether Mod Organizer 2 is open. Close it if it is, ${CHECK_AGAIN}`
  : "Mod Organizer 2 is open. Close it first, then try again: it rewrites its mod list when it closes, and would undo this.";

/** A place a copy of the build could already be loaded from, and what to do about it there. */
type Place = { label: string; folder: string; kind: "mo2" | "overwrite" | "game" };

export class ModInstallHost {
  constructor(private readonly ports: ModInstallPorts) {}

  /** The plan for one build: what would change and where, or why it can't now. Changes nothing but an interrupted install (see above). */
  async plan(candidateId: string): Promise<ModInstallPlan> {
    const running = await this.running();
    return this.prepare(candidateId, running).plan;
  }

  /** Install exactly the accepted plan; refused (nothing changed) when it no longer matches or is blocked. */
  async install(candidateId: string, token: string): Promise<ModInstallResult> {
    if (this.ports.readOnly !== undefined) throw new ModInstallError("install_unavailable", this.ports.readOnly);
    const running = await this.running();
    // Everything from here is synchronous, so nothing else runs between the checks and the change.
    const run = async () => {
      const { plan, transport, modlist } = this.prepare(candidateId, running);
      if (plan.blocked) throw new ModInstallError("install_blocked", plan.blocked);
      if (plan.token !== token) throw new ModInstallError("stale_plan",
        "Something changed since you reviewed this (your mod list, an earlier install or Game & tools), so nothing was changed. Review it again.");
      // The new mod list is written beside the old one first, so a list XF Studio can't write stops the install before any file
      // is copied (INSTALL-08).
      let staged: StagedModlist | undefined;
      if (modlist) {
        try { staged = stageModlist(modlist); }
        catch (error) {
          if (error instanceof ModInstallError) throw error;
          throw new ModInstallError("install_blocked", `XF Studio can't change your mod list for the profile ${quoted(modlist.profile)}, so nothing was ` +
            `added. Make sure the profile's folder isn't read-only, ${CHECK_AGAIN}`);
        }
      }
      try { transport!.install(candidateId); }
      catch (error) { staged?.discard(); throw new ModInstallError("install_blocked", installIssue(error, plan.modName, this.issueContext()).text); }
      if (plan.route === "direct" || !staged || !modlist) return result(plan, `${quoted(plan.modName)} is in your game's archive\\pc\\mod folder. ` +
        "Start the game to see it in the character creator.");
      try { staged.commit(this.ports.receiptsRoot); }
      catch {
        staged.discard();
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

  private async running(): Promise<RunningApps> {
    try { return await (this.ports.running?.() ?? { mo2: false, game: false }); }
    catch { return { mo2: null, game: null }; }
  }

  private issueContext(): InstallIssueContext {
    const settings = this.ports.settings();
    return { vortexOwner: file => settings.gameRoot ? vortexOwner(settings.gameRoot, file) : null };
  }

  private candidate(candidateId: string) {
    if (!safeCandidate(candidateId)) throw new ModInstallError("candidate_missing", "That build isn't one XF Studio made. Build your mod again.");
    try { return inspectLocalPackageCandidate(resolve(this.ports.candidateStore), candidateId); }
    catch { throw new ModInstallError("candidate_missing", "This build's files are no longer there, or were changed. Build your mod again."); }
  }

  private prepare(candidateId: string, running: RunningApps): { plan: ModInstallPlan; transport?: ReturnType<typeof createModInstallTransport>; modlist?: ModlistChange } {
    const { root, manifest } = this.candidate(candidateId);
    const modName = manifest.modName ?? EYE_MAKEUP_MOD.modName;
    const settings = this.ports.settings(), route: ModInstallRoute = settings.launchRoute;
    const profile = settings.mo2ProfileId ?? "";
    const readOnly = this.ports.readOnly;
    const place = route === "mo2" ? `Mod Organizer 2 (profile ${quoted(profile)})` : "your game folder";
    const notes: string[] = [];
    const base = { schema: MOD_INSTALL_PLAN, candidateId, modName, route, place, notes, replacing: false };
    const blocked = (why: string, next: ModInstallNextStep = "retry", changes: string[] = []): { plan: ModInstallPlan } =>
      ({ plan: { ...base, changes, blocked: readOnly ?? why, next: readOnly !== undefined ? null : next,
        token: sha(JSON.stringify([candidateId, route, why])) } });
    if (modName !== modName.trim() || modNameIssue(modName) !== undefined)
      return blocked("This mod's name can't be used as a folder name. Rename it in Mod package, then build it again.", "rename");
    if (route === "mo2" && /_separator$/i.test(modName))
      return blocked(`Mod Organizer 2 treats a name ending in “_separator” as a section heading, so ${quoted(modName)} can't be a mod's name there. ` +
        "Rename it in Mod package, then build it again.", "rename");
    if (!settings.gameRoot) return blocked("Choose your Cyberpunk 2077 folder in Game & tools first.", "setup");
    if (route === "mo2" && (!settings.mo2Root || !settings.mo2ProfileId))
      return blocked("Choose your Mod Organizer 2 instance and profile in Game & tools first.", "setup");
    const context = this.issueContext();
    const refused = (error: unknown) => { const issue = installIssue(error, modName, context); return blocked(issue.text, issue.next); };
    let mo2: ReturnType<typeof readConfiguredMo2Instance>["paths"] | null = null, modlistFile = "";
    if (route === "mo2") {
      try { mo2 = readConfiguredMo2Instance(settings.mo2Root!).paths; } catch (error) { return refused(error); }
      modlistFile = join(mo2.profiles, profile, "modlist.txt");
      if (!existsSync(modlistFile)) return blocked(`The profile ${quoted(profile)} has no mod list yet. Open Mod Organizer 2 with that profile once and ` +
        `close it, ${CHECK_AGAIN}`);
    }
    const open = (receiptsRoot: string) => createModInstallTransport({ candidateStore: resolve(this.ports.candidateStore), receiptsRoot,
      settings: { ...settings, installMode: route }, modName });
    let transport: ReturnType<typeof createModInstallTransport>;
    try { transport = open(this.ports.receiptsRoot); } catch (error) { return refused(error); }

    // An install interrupted earlier (here, or in an earlier per-host receipts folder) is finished or undone first (INSTALL-02).
    const settle = (store: ReturnType<typeof createModInstallTransport>): { plan: ModInstallPlan } | null => {
      if (!store.pending()) return null;
      if (readOnly !== undefined) return blocked(readOnly);
      if (running.game !== false) return blocked(running.game === null ? gameOpen(null)
        : `Cyberpunk 2077 is running, and an earlier install of ${quoted(modName)} needs finishing. Close the game, ${CHECK_AGAIN}`);
      let outcome: ReturnType<typeof store.recover>;
      try { outcome = store.recover(); } catch (error) { return refused(error); }
      if (outcome.conflicts.length) return blocked(`An earlier install of ${quoted(modName)} was interrupted, and its files were changed after that, ` +
        `so XF Studio won't touch them (${outcome.conflicts.map(file => quoted(basename(file))).join(", ")}). Remove ${quoted(modName)} ` +
        `${route === "mo2" ? "in Mod Organizer 2" : "from your game's archive\\pc\\mod folder"}, ${CHECK_AGAIN}`);
      notes.push(outcome.direction === "forward" ? `An earlier install of ${quoted(modName)} was interrupted; XF Studio has finished it.`
        : outcome.direction === "back" ? `An earlier install of ${quoted(modName)} was interrupted; XF Studio has put back the copy from before it.`
          : `An earlier install of ${quoted(modName)} was interrupted, and its files have been removed since; XF Studio has forgotten it.`);
      return null;
    };
    const unsettled = settle(transport);
    if (unsettled) return unsettled;
    // Install ownership is per user on this computer: a record an earlier per-host receipts folder kept is taken over (INSTALL-04).
    if (readOnly === undefined && !transport.record()) for (const legacy of this.ports.legacyReceiptsRoots ?? []) {
      if (resolve(legacy) === resolve(this.ports.receiptsRoot) || !existsSync(legacy)) continue;
      let earlier: ReturnType<typeof createModInstallTransport>;
      try { earlier = open(legacy); } catch { continue; }
      const waiting = settle(earlier);
      if (waiting) return waiting;
      const record = earlier.record();
      if (record && transport.adopt(record)) { earlier.retire(); break; }
    }

    let target: string, replacing: boolean, reinstalling: boolean, files: number;
    try {
      const preflight = transport.preflight(candidateId);
      target = preflight.target; replacing = preflight.replacingOwned; reinstalling = preflight.reinstalling; files = preflight.files.length;
    } catch (error) { return refused(error); }
    base.replacing = replacing;
    if (reinstalling) notes.push(`${quoted(modName)} was removed after XF Studio added it, so it is added again as new.`);
    const fileWords = `${files} file${files === 1 ? "" : "s"}`;
    const changes: string[] = [];
    let modlist: ModlistChange | undefined;
    let why: string | null = null, next: ModInstallNextStep = null;
    const wait = (text: string, step: ModInstallNextStep = "retry") => { if (why === null) { why = text; next = step; } };

    let text: string | null = null;
    if (mo2) {
      const read = readModlist(modlistFile, this.ports.ansiCodePage?.() ?? null, profile);
      if ("blocked" in read) return blocked(read.blocked);
      text = read.text;
      let placement: Mo2Placement;
      try {
        placement = planMo2Placement(read.text, modName, { related: eyeMakeupRelatedEntries, frameworkMods: this.ports.frameworkMods?.(settings) ?? [] });
      } catch (error) { return refused(error); }
      modlist = { file: modlistFile, bytes: read.bytes, text: read.text, encoding: read.encoding, placement, profile };
    }

    // Part of this build already loaded from somewhere else (another stage, a split mod, a copy by hand): the person decides.
    // Only what the game would load counts: the profile's switched-on mods, MO2's Overwrite and the game's own folder (INSTALL-06).
    const xl = manifest.files[1]!;
    // This mod's own MO2 folder, and its own `.archive.xl` in the game folder, are what the transport checks by hash.
    const places = installPlaces(settings, mo2, text).filter(entry => !(route === "mo2" && resolve(entry.folder) === resolve(target)));
    const ownXl = join(target, basename(xl.path)).toLowerCase();
    const duplicates = findInstalledDuplicates(readFileSync(join(root, ...xl.path.split("/")), "utf8"), places, file => resolve(file).toLowerCase() === ownXl);
    if (duplicates.length) wait(duplicateAdvice(duplicates, settings.gameRoot, profile));

    if (route === "direct") {
      changes.push(replacing ? `Replace the ${fileWords} XF Studio added for ${quoted(modName)} before, in ${target}.`
        : `Copy ${fileWords} into your game's mod folder: ${target}.`);
      notes.push("Mods in the game folder are shared with every mod you install there by hand or with Vortex. XF Studio only ever adds or replaces its own files.");
    } else {
      const { placement } = modlist!;
      changes.push(replacing ? `Replace the ${fileWords} of the mod ${quoted(modName)} that XF Studio added before, in ${target}.`
        : `Add the mod ${quoted(modName)} to Mod Organizer 2, with its ${fileWords} in ${target}.`);
      const listed = mo2ModlistEntry(text!, modName);
      changes.push(placement.rule === "existing"
        ? listed === "+" ? `${quoted(modName)} is already switched on in the profile ${quoted(profile)}; it stays where it is.`
          : `${quoted(modName)} is already in the profile ${quoted(profile)}; switch it on where it is.`
        : `Add ${quoted(modName)} to the profile ${quoted(profile)}, switched on. ${placement.description}`);
      changes.push("Nothing else in your mod list changes.");
      for (const older of EYE_MAKEUP_MOD.predecessorMods) if (mo2ModlistEntry(text!, older) === "+")
        notes.push(`${quoted(older)} is also switched on. It's an older eye makeup mod: switch it off in Mod Organizer 2 if the two clash.`);
      if (running.mo2 !== false) wait(mo2Open(running.mo2));
    }
    // A running game holds the installed `.archive` open, so replacing it would fail halfway (INSTALL-02).
    if (replacing && running.game !== false) wait(gameOpen(running.game));
    const receipt = transport.record();
    // Consent covers everything shown: the files, where the row goes and why (its placement), and the list it goes into (INSTALL-07).
    const token = sha(JSON.stringify([candidateId, route, target, settings.revision, modlist ? sha(modlist.bytes) : null, modlist?.placement ?? null,
      changes, receipt ? [receipt.candidateId, receipt.installedAt] : null]));
    return { plan: { ...base, changes, notes, blocked: readOnly ?? why, next: readOnly !== undefined ? null : next, token }, transport, modlist };
  }
}

type ModlistChange = { file: string; bytes: Uint8Array; text: string; encoding: ModlistEncoding; placement: Mo2Placement; profile: string };

/** "Switch any mod off and on again in MO2" makes MO2 save the list the usual way (UTF-8, a plain file of its own). */
const RESAVE = "Open Mod Organizer 2, switch any mod off and on again so it saves the list, close it, then choose Check again.";

/**
 * The profile's mod list, read so it can be written back byte for byte (INSTALL-05): its exact bytes, its text and how it is
 * stored. A list XF Studio can't read back exactly, or can't safely replace (read-only, linked to another file), is refused.
 */
function readModlist(file: string, ansiCodePage: number | null, profile: string):
  { bytes: Uint8Array; text: string; encoding: ModlistEncoding } | { blocked: string } {
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(file); } catch { return { blocked: `The profile ${quoted(profile)} has no mod list yet. Open Mod Organizer 2 with that profile once and close it, ${CHECK_AGAIN}` }; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
    return { blocked: `The mod list of the profile ${quoted(profile)} is linked to another file, so XF Studio won't change it. ${RESAVE}` };
  try { accessSync(file, constants.W_OK); }
  catch { return { blocked: `The mod list of the profile ${quoted(profile)} is read-only, so XF Studio can't add to it. Open the profile's folder in ` +
    `Mod Organizer 2, turn off Read-only in modlist.txt's Properties, ${CHECK_AGAIN}` }; }
  const bytes = new Uint8Array(readFileSync(file));
  const decoded = decodeModlist(bytes, ansiCodePage);
  if (!decoded) return { blocked: `The mod list of the profile ${quoted(profile)} is saved in a text format XF Studio can't edit without changing ` +
    `other rows, so nothing was changed. ${RESAVE}` };
  return { bytes, text: decoded.text, encoding: decoded.encoding };
}

type StagedModlist = { commit(receiptsRoot: string): void; discard(): void };
/**
 * The one-row change written beside the mod list and flushed to disk (INSTALL-08), checked against the bytes the plan read.
 * `commit` keeps the previous list in the private receipts folder and moves the new one into place, so MO2 never sees half a file.
 */
function stageModlist(change: ModlistChange): StagedModlist {
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
  const current = () => new Uint8Array(readFileSync(change.file));
  if (!same(current(), change.bytes)) throw new ModInstallError("stale_plan",
    "Your mod list changed since you reviewed this, so nothing was changed. Review it again.");
  accessSync(change.file, constants.W_OK);
  const next = encodeModlist(applyMo2Placement(change.text, change.placement, true), change.encoding);
  if (!next) throw new ModInstallError("install_blocked", `Your mod list's text format can't hold the name ${quoted(change.placement.modName)}. ` +
    `Rename your mod in Mod package using plain letters, then build it again.`);
  const temp = join(dirname(change.file), `.${basename(change.file)}.${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx");
  try {
    let written = 0;
    while (written < next.length) written += writeSync(fd, next, written, next.length - written);
    fsyncSync(fd);
  } catch (error) { closeSync(fd); rmSync(temp, { force: true }); throw error; }
  closeSync(fd);
  const discard = () => rmSync(temp, { force: true });
  return {
    discard,
    commit(receiptsRoot: string) {
      if (!same(current(), change.bytes)) throw Error("The mod list changed.");
      const stat = lstatSync(change.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw Error("The mod list is not a plain file.");
      mkdirSync(join(receiptsRoot, "modlists"), { recursive: true });
      copyFileSync(change.file, join(receiptsRoot, "modlists", `${sha(resolve(change.file)).slice(0, 16)}-${Date.now()}.txt`));
      renameSync(temp, change.file);
    },
  };
}

/**
 * Every place the game would load a copy of the build from (INSTALL-06): each MO2 mod switched on in the profile, MO2's
 * Overwrite folder, and the game's own mod folder. A switched-off or unlisted MO2 mod is not loaded, so it never blocks.
 */
function installPlaces(settings: LocalSettings, mo2: { mods: string; overwrite: string } | null, modlist: string | null): Place[] {
  const places: Place[] = [];
  if (mo2 && modlist !== null) {
    for (const entry of parseMo2Modlist(modlist).entries) if (entry.enabled && entry.kind === "mod")
      places.push({ kind: "mo2", label: `the Mod Organizer 2 mod ${quoted(entry.name)}`, folder: join(mo2.mods, entry.name, "archive", "pc", "mod") });
    places.push({ kind: "overwrite", label: "Mod Organizer 2's Overwrite folder", folder: join(mo2.overwrite, "archive", "pc", "mod") });
  }
  if (settings.gameRoot) places.push({ kind: "game", label: "your game's archive\\pc\\mod folder", folder: join(settings.gameRoot, "archive", "pc", "mod") });
  return places;
}

/** What to do about each place already holding part of the build, in the words (and the tool) that place needs. */
function duplicateAdvice(found: { place: Place; file: string }[], gameRoot: string | null, profile: string): string {
  const labels: string[] = [], advice = new Set<string>();
  for (const { place, file } of found) {
    const owner = place.kind === "game" && gameRoot ? vortexOwner(gameRoot, file) : null;
    if (owner) {
      labels.push(`the Vortex mod ${quoted(owner)}`);
      advice.add("Disable or remove it in Vortex and deploy.");
    } else if (place.kind === "mo2") {
      labels.push(place.label);
      advice.add(`Switch it off in the profile ${quoted(profile)} in Mod Organizer 2, or remove it.`);
    } else if (place.kind === "overwrite") {
      labels.push(place.label);
      advice.add(`Move ${quoted(basename(file))} out of Overwrite in Mod Organizer 2, or delete it.`);
    } else {
      labels.push(`${place.label} (${quoted(basename(file))})`);
      advice.add("Remove that mod's files from the game folder.");
    }
  }
  return `Part of this mod is already installed as ${labels.join(" and ")}. ${[...advice].join(" ")} Then choose Check again.`;
}

/** The Vortex mod that deployed `file` into the game folder, by Vortex's own deployment record; null when Vortex didn't. */
export function vortexOwner(gameRoot: string, file: string): string | null {
  try {
    const { deployment } = readVortexManifests(gameRoot);
    if (!deployment) return null;
    const path = relative(gameRoot, file).replaceAll("\\", "/");
    if (!path || path.startsWith("..")) return null;
    return attributeVortexFile(deployment, path, statSync(file).mtimeMs)?.label ?? null;
  } catch { return null; }
}

const result = (plan: ModInstallPlan, message: string): ModInstallResult =>
  ({ schema: MOD_INSTALL_RESULT, candidateId: plan.candidateId, modName: plan.modName, route: plan.route, message });

/**
 * Whether Mod Organizer 2 and Cyberpunk 2077 are running, from one `tasklist` run off the server thread (bounded by a
 * timeout). Where it can't be read (tasklist failed, timed out or printed nothing), both are unknown: the install then waits
 * rather than guessing (INSTALL-10). Off Windows neither runs.
 */
export async function windowsRunningApps(timeoutMs = 10_000): Promise<RunningApps> {
  if (process.platform !== "win32") return { mo2: false, game: false };
  const unknown: RunningApps = { mo2: null, game: null };
  try {
    const run = Bun.spawn(["tasklist", "/NH", "/FO", "CSV"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: timeoutMs });
    const [out, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
    if (code !== 0) return unknown;
    const images = new Set(out.split(/\r?\n/).map(line => /^"([^"]+)"/.exec(line)?.[1]?.toLowerCase()).filter(Boolean));
    if (!images.size) return unknown;
    return { mo2: images.has("modorganizer.exe"), game: images.has("cyberpunk2077.exe") };
  } catch { return unknown; }
}

/** The system ANSI code page (kernel32 `GetACP`), for mod lists an older MO2 stored in it; null off Windows or when unavailable. */
export function systemAnsiCodePage(): number | null {
  if (process.platform !== "win32") return null;
  try {
    const { dlopen, FFIType } = import.meta.require("bun:ffi") as typeof import("bun:ffi");
    const kernel = dlopen("kernel32.dll", { GetACP: { args: [], returns: FFIType.u32 } });
    try { return kernel.symbols.GetACP(); } finally { kernel.close(); }
  } catch { return null; }
}

/** Opens Windows Explorer with `path` selected (localhost; the desktop uses its native call). */
export function explorerReveal(path: string): boolean {
  if (process.platform !== "win32") return false;
  try { Bun.spawn(["explorer.exe", `/select,${path}`], { stdio: ["ignore", "ignore", "ignore"] }); return true; } catch { return false; }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const STATUS: Record<ModInstallError["code"], number> = { install_blocked: 409, stale_plan: 409, candidate_missing: 404, install_unavailable: 503, install_failed: 500 };

/**
 * The endpoint both hosts mount at `/api/mod-install` (and, read-only, at `/api/verification/mod-install`): POST
 * `{ action: "plan" | "install" | "reveal", candidateId, token? }` from the loopback page only. Every answer is JSON with plain
 * words; failures are logged by `log`.
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
      if (action === "plan") return json(await service.plan(candidateId));
      if (action === "install") return json(await service.install(candidateId, token as string));
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

/** A host's own earlier receipts folder, beside its other data (before receipts were per user: INSTALL-04). */
export const installReceiptsRoot = (dataRoot: string) => resolve(dataRoot, "install-receipts");
