# Vortex: how it deploys Cyberpunk 2077 mods

**Maturity: Draft.** Source read at Vortex 2.7.1 (tag `v2.7.1`, commit `c8ea03d0`), the Cyberpunk 2077 Vortex extension (`E1337Kat/cyberpunk2077_ext_redux` commit `565deef1`, package 0.13.0; newest published extension 0.12.1) and the `vortex-games` stub (commit `18bbee9b`). One Windows Sandbox run of the released Vortex 2.7.1 with extension 0.12.1 ([experiment 023](../experiments/023-vortex-sandbox/README.md), 26 September 2026) checked the central claims. It used a synthetic game folder and local test archives. Evidence grades follow the [knowledge rules](README.md); **[observed]** marks what that run showed of Vortex's own behaviour. No Vortex-managed game has been launched: nothing here is runtime evidence about the game.

This page answers: *when Vortex manages Cyberpunk 2077, which files does the game see, which mod put each one there, and how should XF Studio add its own mod?* It complements [mod loading](mod-loading.md), whose archive and ArchiveXL rules apply unchanged once the files are in the game folder.

## 1. The short answer

| Question | Answer | Grade |
|---|---|---|
| Where do mods live? | Each installed mod is a folder in the game's **staging folder**, default `%APPDATA%\Vortex\cyberpunk2077\mods\<mod id>`. The mod id is the installed archive's name without its extension. | [source]; [observed] |
| What does the game see? | Vortex **deploys** the enabled mods of the active profile into the game folder itself, as hard links. Unlike MO2 there is no virtual file system: the game folder holds the winners, whoever launches the game. | [source]; [observed] |
| Which mod wins a file? | The mod Vortex deploys last, by its dependency rules ("load after"). The loser's copy is not deployed at all. Different archive **names** with the same resources are ordered by the game (alphabetically), not by Vortex. | [source]; loser not deployed [observed] |
| Who put a file there? | `vortex.deployment.json` in the game folder lists every deployed file and the mod it came from. | [source]; [observed] |
| Nexus ids, versions, enabled state? | Only in Vortex's state database (`%APPDATA%\Vortex\state.v2`, LevelDB) or its JSON backups, and readable only while Vortex is closed. A mod installed from a local archive has no Nexus ids or version at all. | [source]; [observed] |
| How should XF Studio add its mod? | Build an archive Vortex can install and hand it to the user's Vortex (`Vortex.exe --install-archive <file>`), with consent. Vortex installs, enables and deploys it without a prompt. | [observed]; recommendation |

## 2. Deployment

### 2.1 Staging and deployment methods

- **Staging folder.** `settings.mods.installPath[gameId]`, a path or a pattern with `{USERDATA}`, `{GAME}` and `{USERNAME}` (case-insensitive); the default is `{USERDATA}\{GAME}\mods`, and a relative result is taken from Vortex's user data folder. The folder holds a marker, `__vortex_staging_folder`, containing `{"instance": <Vortex instance id>, "game": <game id>}`, written by the manage-game flow (`ensureStagingDirectory`). A mod is extracted into `<mod id>.installing` and renamed when done. **[source]** `mod_management/util/getInstallPath.ts`, `stagingDirectory.ts`, `InstallManager.ts`, `modIdManager.ts`.
  - **[observed]** The default folder and one subfolder per mod, named after its archive, both matched the source.
  - **[observed]** The sandbox's state was seeded with `--set`, which skipped the manage-game flow, and no marker was written. The marker's presence in a normal setup is therefore source-only, and XF Studio treats it as optional.
- **Methods**, tried in priority order until one works for every mod type: hard links (5), symbolic links (10), symbolic links through an elevated helper (20), move (50, experimental). The choice is stored in `settings.mods.activator[gameId]`. **[source]** `extensions/*_activator/index.ts`, `mod_management/util/deploymentMethods.ts`.
- **Cyberpunk forbids symbolic links**: the extension registers the game with `compatible: { symlinks: false }`, so a Cyberpunk setup uses **hard links**, which need the staging folder on the game's volume (Vortex suggests `<game volume>\Vortex Mods\cyberpunk2077` when it isn't), or the experimental move method. **[source]** extension `cyberpunk2077_ext_redux/src/index.ts`. This matters for XF Studio: its source scan skips symbolic links, but hard links are ordinary files to it.
- **What a deployment leaves in the game folder:** the files (hard links share the staging file's identity and modification time), `__folder_managed_by_vortex` in every folder Vortex had to create, `<file>.vortex_backup` for a file that was already there and that a mod replaced (restored on purge), and the manifest. **[source]** `LinkingDeployment.ts`.
  - **[observed]** Deployed files had two hard links, and their modification time was the staged file's, equal to the manifest's `time`.
  - **[observed]** A hand-placed `Preexisting.archive` that a mod also shipped was renamed `Preexisting.archive.vortex_backup` with its content intact.
  - Not exercised: the folder marker (every folder already existed) and the restore on purge.
  - The sandbox chose hard links explicitly. Vortex's automatic choice for Cyberpunk remains **[source]**.

### 2.2 The deployment manifest

One manifest per mod type, in that type's target folder: `vortex.deployment.json` for the default type, `vortex.deployment.<type>.json` otherwise. The Cyberpunk extension registers **no** mod types (its `registerModType` is commented out because it stopped Vortex deploying), so a Cyberpunk setup has exactly one manifest, in the game folder, listing everything. **[source]** `activationStore.ts` `saveActivation`; extension `cyberpunk2077_ext_redux/src/index.ts`. **[observed]** One `vortex.deployment.json`, in the game folder, with exactly these fields in this order. Vortex's generic `dinput` and `enb` types were deployed with zero files and left no manifest. A real manifest is committed as a test fixture ([§7](#7-implementation)).

| Field | Meaning |
|---|---|
| `version` | Format version, 1 |
| `instance` | The Vortex installation's id (`app.instanceId`, a UUID made on first start). A per-user and a shared (multi-user) Vortex have different ids. |
| `deploymentMethod` | e.g. `hardlink_activator` |
| `gameId`, `deploymentTime` (ms), `stagingPath`, `targetPath` | Private paths: never copy them into a portable document |
| `files[]` | `relPath` (relative to the target folder, backslashes, original case), `source` (the mod id, i.e. staging folder name; `__merged` for merged files), `target` (empty for Cyberpunk, whose extension sets `mergeMods: true`), `time` (the staged file's modification time in ms), optional `merged` |

- It is written atomically (`<name>.XXXXXX.tmp`, then renamed) after every deployment, with a binary copy, `vortex.deployment.msgpack`, in the staging folder (both **[observed]**: rewritten after each of three deployments). **A purge deletes both**; an empty deployment never leaves an empty list. Vortex treats the manifest as a fallback and works if it's deleted, so its absence doesn't prove Vortex isn't in use. **[source]** `activationStore.ts`.
- **Only winners are listed.** Mods are deployed lowest priority first and each file key is overwritten by later mods, so a file two mods ship is listed once, for the mod that won. **[source]** `LinkingDeployment.ts` `addModFiles`. **[observed]** Two mods shipped `XF Test Shared.archive` with no rule between them. The one deployed second won: it was listed once, for that mod, and the other copy stayed in staging. Vortex showed "There are unresolved file conflicts" but still deployed.

### 2.3 Conflicts and order

- **File conflicts** (two mods ship the same path) are settled by a topological sort of each mod's `before`/`after` rules; mods without a rule between them fall in whatever order the sort gives. `conflicts` rules block deployment; unresolved file conflicts only block **launching** from Vortex. `fileOverrides` hide a mod's copy of a file. **[source]** `mod_management/util/sort.ts`, `modActivation.ts`, `mod-dependency-manager`.
- **Archive order is the game's.** The extension never writes `archive/pc/mod/modlist.txt`, and its own help says archive mods load "in the usual alphabetical order", before REDmods. Two differently named archives that contain the same resource are therefore ordered exactly as in a direct install ([mod loading §1](mod-loading.md#1-the-stages-in-order), stage 3). **[source]** extension `cyberpunk2077_ext_redux/src/load_order.ts`.
- **REDmod** has its own load order: stored in Vortex state (`persistent.loadOrder[profile]`), written to `<game>\V2077\Load Order\V2077-load-order-<profile>.json` and `<game>\V2077\modlist.txt`, and applied by running `tools\redmod\bin\redMod.exe deploy … -modlist=V2077\modlist.txt` after a deployment in which the order changed. REDmods deploy to `mods\<name>`. **[source]** extension `cyberpunk2077_ext_redux/src/load_order.ts`, `cyberpunk2077_ext_redux/src/installer.redmod.ts`.

### 2.4 How the extension installs mods

- **One installer for everything.** Priority 30, accepting every archive, it recognises the frameworks (CET, redscript, RED4ext, TweakXL, ArchiveXL, …), REDmods, multi-type mods, and archive mods, unwrapping a single top-level folder. **[source]** extension `cyberpunk2077_ext_redux/src/installers.ts`.
- **Archive mods keep their paths:** `archive\pc\mod\x.archive` and `x.archive.xl` land at the same path in the game folder (**[observed]**). Archives found elsewhere in the download are placed under `archive\pc\mod\<their folder>`, which the game doesn't read, with a warning. **[source]** extension `cyberpunk2077_ext_redux/src/installer.archive.ts`.
- A loose `.archive` dropped on Vortex (not inside an archive) skips the installers and would deploy to the **game folder root**, where the game ignores it. **[source]** Vortex `mod_management/index.ts`, extension `queryModPath: () => ""`.

## 3. Metadata: Vortex's state

- **Where.** `%APPDATA%\Vortex\state.v2`, a LevelDB database; in shared (multi-user) mode a second one at `%ProgramData%\vortex\state.v2`. Vortex 2.x opens it through DuckDB's `level_pivot` extension, but the files are ordinary LevelDB. **[source]** `Vortex/src/main/src/Application.ts`, `store/LevelPersist.ts`, `store/DuckDBSingleton.ts`.
- **Keys and values.** A key is the Redux state path joined with `###` (`persistent###mods###cyberpunk2077###<mod id>###attributes###modId`); a value is the leaf's JSON. Arrays and other non-plain objects are stored whole. **[source]** `LevelPersist.ts`, `store/stateDiff.ts`. **[observed]** in the real database. An empty object can sit beside deeper keys under the same path, as in `persistent###profiles###xfstest###modState = {}` next to `…###modState###<mod>###enabled`. Tables are Snappy-compressed.
- **What XF Studio reads:**

| State path | Meaning |
|---|---|
| `app.instanceId` | Matches the manifest's `instance`: this is the Vortex that deployed |
| `settings.profiles.activeProfileId`, `settings.profiles.lastActiveProfile.<game>` | The profile in use |
| `persistent.profiles.<id>` `{gameId, name, modState.<mod>.enabled}` | Profiles and what each enables |
| `persistent.mods.<game>.<mod id>` `{installationPath, attributes}` | Installed mods. `attributes`: `name`, `logicalFileName`, `customFileName`, `version`, `source` (`nexus`), `modId`, `fileId`, `downloadGame`, `installTime`. **[observed]** A mod installed from a local archive records only `name` (the archive name), `fileName` and `logicalFileName` (the file name, which the Mods page shows), `fileMD5`, `fileSize`, `modSize`, `installTime` and `downloadGame`. It has no `version`, `modId`, `fileId` or `source`, even when the file name follows Nexus's download naming. |
| `settings.mods.installPath.<game>`, `settings.mods.activator.<game>`, `settings.gameMode.discovered.<game>.path` | Staging folder, deployment method, managed game folder |

- **Reading it safely.** Vortex holds LevelDB's `LOCK` while it runs; a second Vortex waits and then reports the database as locked. XF Studio never opens the database: it reads the files beside `LOCK` and interprets them itself. **[source]**
  - **[observed] While Vortex runs, its current MANIFEST and write-ahead log can't be opened by another program** (sharing violation); older tables and `CURRENT` can.
  - Vortex keeps the database open for its whole session, so everything written since it started is invisible until it closes: installs, enabled states, even the instance id made at first start. The readable tables hold only earlier sessions' state, each start having flushed the previous log into a table.
  - On closing, Vortex compacts the database, and XF Studio's reader then reads it completely through the MANIFEST.
  - So state read while Vortex runs is **stale, not merely partial**. XF Studio marks it not current and never concludes from it that a deployed mod is uninstalled.
- **Fallbacks.** Vortex's own full-state JSON backup is `%APPDATA%\Vortex\temp\state_backups_full\hourly.json` (written every hour Vortex runs, from an hour after it starts; none appeared in the sandbox's five-minute session **[observed]**) or `manual.json`, and may be up to an hour old. `Vortex.exe --get <path>` prints `path = value` lines while Vortex is closed (**[observed]**), but it starts Vortex's executable, so XF Studio doesn't use it. **[source]** `recovery/index.ts`, `store/store.ts`, `main.ts`.

## 4. Detecting a Vortex setup

| Signal | What it proves | Grade |
|---|---|---|
| `vortex.deployment.json` in the game folder | Vortex has files deployed there now; names the installation (`instance`), method, staging folder | [source] |
| `__vortex_staging_folder` in the staging folder | That folder is a Vortex staging folder for the named game and installation. Absent in the sandbox's seeded setup, so optional. | [source] |
| `%APPDATA%\Vortex\state.v2` (or `%ProgramData%\vortex\state.v2`) | Vortex has run for this Windows user (or in shared mode); its state names the managed game folder and the active profile | [source] |
| `HKCU\Software\Classes\nxm\shell\open\command` naming `Vortex.exe` | Vortex was the last program to claim Nexus links. Vortex claims them **on first start and again on every start** unless its "handle Nexus links" setting (`settings.nexus.associateNXM`) is off, so this only says Vortex ran most recently, not that it manages the game. | [source]. **[observed]** With the setting off before the first start, the key was never written; Vortex registered `nxm` in-app only. |
| Uninstall entry `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\57979c68-f490-55b8-8fed-8b017a5af2fe` (`DisplayName` "Vortex", `Publisher` "Black Tree Gaming Ltd.", `DisplayVersion`, no `InstallLocation`) | Vortex is installed, per machine, at `%ProgramFiles%\Vortex\Vortex.exe` | [observed] (quiet install of 2.7.1) |

**Active profile:** `settings.profiles.activeProfileId` when that profile's `gameId` is `cyberpunk2077`; otherwise the game's `lastActiveProfile` (Vortex is managing another game right now, and the game folder holds whatever was last deployed for Cyberpunk).

## 5. What XF Studio sees

**The direct route is already right about the files.** Because Vortex deploys hard links into the game folder, the direct route scans exactly the files the game will read, whatever Vortex's state says. What it lacked was *who* put each file there.

| Situation | Game folder (what the game loads) | Direct route before | With Vortex attribution |
|---|---|---|---|
| Normal deployment | Winners of enabled mods | Correct files, all "Installed game" | Each deployed file names its Vortex mod (and Nexus ids when the state is readable) |
| A mod disabled or uninstalled but **not yet deployed** (auto-deploy off, or deployment failed) | The old files | Correct: the game loads them too | Reported as a stale deployment: "deploy in Vortex" |
| Purged | Nothing from Vortex | Correct | No manifest; nothing to attribute |
| Profile switched to another game | Last Cyberpunk deployment | Correct | Profile shown as not active |
| A file replaced or deleted outside Vortex | The new file / nothing | Correct | Reported as changed / missing; Vortex shows the same in its External Changes dialog. A replaced file keeps the game folder as its provider and is never credited with the Vortex mod's Nexus ids: its modification time no longer matches the manifest's |
| A file placed by hand (or by another tool) | It | Correct | Reported as not deployed by Vortex |
| REDmod mods | `mods\<name>` + `r6\cache\modded` | Not mounted (REDmod unmodelled on every route) | Same gap |

- **Symbolic links** would have been a problem (the scan skips links), but Cyberpunk forbids them in Vortex. A symlinked file from another manager still shows as a skipped link.
- **The move method** leaves real files in the game folder; attribution works the same.

## 6. Placing XF Eye Artistry in a Vortex setup

| Option | Vortex's reaction | Fits "don't touch users' setups"? |
|---|---|---|
| Copy `XF Eye Artistry.archive` + `.xl` into `archive\pc\mod` | Ignored: Vortex's external-change check walks only files in its manifest, and purges remove only its own links. If a Vortex mod later ships the same file name, Vortex renames ours to `.vortex_backup` and restores it on purge. The mod is invisible in Vortex and can't be toggled there. **[source]** `LinkingDeployment.ts`. **[observed]** A dropped-in `XF Eye Artistry.archive` survived a later deployment untouched, with no external-change prompt, and a replaced file became `.vortex_backup`. | Adds only our files, but leaves the user an unmanaged mod in a managed setup |
| **Hand an installable archive to Vortex** (`Vortex.exe --install-archive <zip>`; the running Vortex receives it) | Installed through the Cyberpunk installer like a download, then enabled and deployed by Vortex's defaults (`settings.automation.install`, `enable` and `deploy` all default to on). **[source]** `cli.ts`, `settings_interface/reducers/automation.ts`. **[observed]** Three archives, each installed, enabled and deployed within seconds, with no prompt. | Yes: Vortex adds one mod the user can see, disable, update and uninstall |
| Write into the staging folder or state | — | No: never |

**Recommendation.** For a Vortex-managed game, Build writes `XF Eye Artistry.zip` holding `archive\pc\mod\…` exactly as the game needs, and offers **"Add to Vortex"**, which (with consent) runs the user's own `Vortex.exe --install-archive`, or tells them to drag the file onto Vortex's Mods page. The archive's file name becomes the mod's id and, extension included, the name on Vortex's Mods page (**[observed]**: `XF Eye Artistry.zip`), so keep it the plain mod name. Open questions: what Vortex does when a same-named archive is installed again (it offers replace or variant), and whether a `.zip` built by XF Studio needs a `fomod` or Nexus metadata (it shouldn't).

## 7. Implementation

`projects/xf-studio/authoring/src`:

- `vortex-deployment.ts` (pure): manifest names and parsing, attribution of a game-folder file (`deployed` while its modification time matches the manifest's within 2 s, else `changed`), and the comparison of a scan with the deployment (unmanaged, missing, changed, stale).
- `vortex-state.ts` (pure): Vortex's `###` keys into the state tree, then the game's profile, mods and Nexus ids; the staging-folder pattern. The tree is built from null-prototype objects, a key segment `__proto__`, `prototype` or `constructor` is skipped (and reported), and reads take own properties only, so a mod named after one, or a damaged database, can't reach `Object.prototype`.
- `leveldb-read.ts` (pure): a read-only LevelDB reader (log records, write batches, tables with Snappy blocks, MANIFEST live-file set). When the MANIFEST can't be read it reads every file and keeps each key's newest sequence number, and says so. The files are another program's, so decoding is bounded: a Snappy block's claimed length is checked against what its bytes can hold (22 times) and a 64 MB limit before anything is allocated, a block the index lists more than once is decoded once, and everything a read allocates (blocks and expanded keys) counts against one budget, 16 times the input and between 64 MB and 1 GB; a file past it is a gap.
- `vortex-host.ts` (adapter): `readVortexManifests` (synchronous and small, used by source discovery on every route: a game-folder file still as deployed gets `deployedBy` and names its Vortex mod as provider, a changed one keeps the game folder's name; the manifest is watched, so a redeploy reopens the installation) and `inspectVortexSetup` (the installation that deployed, matched by instance id, else by managed game folder; state from the database or a backup; staging marker). State is read asynchronously, at most 256 MB a file and 512 MB together, and never past the caller's deadline (a problem report's time budget); a complete read is kept for the same files, so preparing a report again doesn't read them again. The newest backup replaces the database when the database couldn't be read completely and either lists no mods or is older than the backup. The staging marker is read only from a folder on a local drive: a `stagingPath` in a manifest anyone can write never makes the host open a network share. State is `current` only when the whole database was read. Otherwise its gaps say why (Vortex appears to be running, too large, or out of time), and the stale-deployment check (`compareWithDeployment`) is skipped.
- `tools/vortex-check.ts`: a read-only report for one game folder, with no paths and no profile name in its output (testers paste it).
- `diagnostics/mod-identity.ts`: a problem report's involved mods. An archive goes with a Vortex mod only while the game folder holds the file Vortex deployed (time as in the manifest), and on the Mod Organizer 2 route an MO2 mod whose folder holds the archive stays an MO2 mod even when a leftover manifest names a Vortex mod of the same name. A Vortex mod gets its Nexus mod and file IDs and version from Vortex's state (re-downloadable); without readable state, the staging folder name's mod ID is used only when the name follows Nexus's `<name>-<mod id>-<version>-<upload time>` download naming, a convention rather than a Vortex record **[hypothesis]**.

Tests: `tests/vortex-deployment.test.ts`, `vortex-setup.test.ts` (prototype keys, changed files, bounded and kept state reads, newer backups, network staging folders, the check tool's output), `leveldb-read.test.ts` (hostile Snappy lengths, repeated blocks, a decoding budget) and the Vortex cases in `diagnostics.test.ts` and `diagnostics-report.test.ts`; fixtures in `tests/fixtures/vortex/`. `sandbox-023/` holds what Vortex really wrote in experiment 023: the final manifest, the game-folder listing, the closed database (one Snappy table) and the tables readable while Vortex ran. The older `cyberpunk-hardlink` manifest was built from the source-documented format.

## Open questions

1. What does Vortex do with a second `--install-archive` of the same archive name: replace, variant, or a prompt that blocks an unattended install?
2. Does anything in the game or a framework behave differently for hard-linked files (for example a tool that rewrites an archive in place, which would change the staged copy too)?
3. How do Vortex collections and "load order" entries for REDmods interact with archives shipped inside REDmods, once the resolver mounts REDmod archives?
4. Vortex looks installs up on Nexus by MD5 (`<md5>:<size>:<game>`; attempted, and failed offline, in the sandbox). Does that lookup record Nexus ids and a version for a real Nexus file installed from disk?
5. With "handle Nexus links" on, what exactly does Vortex write under `HKCU\Software\Classes\nxm`, and does it overwrite another manager's handler on every start as the source suggests?

## Test asks

Not for the maintainer, whose setup is MO2. A community tester with a Vortex-managed game can run `bun tools/vortex-check.ts --game-root <game folder>` from a source checkout and confirm the listed mods, versions and Nexus ids match Vortex's Mods page, then disable one mod without deploying and confirm it is reported as stale.

## Related pages

[Mod loading](mod-loading.md) · [Vortex support backlog](../research/backlog/vortex-support.md) · [Experiment 023](../experiments/023-vortex-sandbox/README.md) · [MO2 source resolution](../research/character-customization/mod-source-resolution.md) · [Framework check and MO2 placement](../research/authoring/framework-version-check.md)
