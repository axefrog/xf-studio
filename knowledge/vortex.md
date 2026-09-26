# Vortex: how it deploys Cyberpunk 2077 mods

**Maturity: Draft.** Source read at Vortex 2.7.1 (tag `v2.7.1`, commit `c8ea03d0`), the Cyberpunk 2077 Vortex extension (`E1337Kat/cyberpunk2077_ext_redux` commit `565deef1`, package 0.13.0; latest release 0.12.1) and the `vortex-games` stub (commit `18bbee9b`). A Windows Sandbox run of the released Vortex ([experiment 023](../experiments/023-vortex-sandbox/README.md)) is prepared but its results are pending, so every claim below comes from source. Evidence grades follow the [knowledge rules](README.md); **[observed]** marks what the sandbox run showed. No Vortex-managed game has been launched: nothing here is runtime evidence about the game.

This page answers: *when Vortex manages Cyberpunk 2077, which files does the game see, which mod put each one there, and how should XF Studio add its own mod?* It complements [mod loading](mod-loading.md), whose archive and ArchiveXL rules apply unchanged once the files are in the game folder.

## 1. The short answer

| Question | Answer | Grade |
|---|---|---|
| Where do mods live? | Each installed mod is a folder in the game's **staging folder**, default `%APPDATA%\Vortex\cyberpunk2077\mods\<mod id>`. The mod id is the installed archive's name without its extension. | [source] |
| What does the game see? | Vortex **deploys** the enabled mods of the active profile into the game folder itself, as hard links. Unlike MO2 there is no virtual file system: the game folder holds the winners, whoever launches the game. | [source] |
| Which mod wins a file? | The mod Vortex deploys last, by its dependency rules ("load after"). The loser's copy is not deployed at all. Different archive **names** with the same resources are ordered by the game (alphabetically), not by Vortex. | [source] |
| Who put a file there? | `vortex.deployment.json` in the game folder lists every deployed file and the mod it came from. | [source] |
| Nexus ids, versions, enabled state? | Only in Vortex's state database (`%APPDATA%\Vortex\state.v2`, LevelDB) or its JSON backups. | [source] |
| How should XF Studio add its mod? | Build an archive Vortex can install and hand it to the user's Vortex (`Vortex.exe --install-archive <file>`), with consent. | [source]; recommendation |

## 2. Deployment

### 2.1 Staging and deployment methods

- **Staging folder.** `settings.mods.installPath[gameId]`, a path or a pattern with `{USERDATA}`, `{GAME}` and `{USERNAME}` (case-insensitive); the default is `{USERDATA}\{GAME}\mods`, and a relative result is taken from Vortex's user data folder. The folder holds a marker, `__vortex_staging_folder`, containing `{"instance": <Vortex instance id>, "game": <game id>}`. A mod is extracted into `<mod id>.installing` and renamed when done. **[source]** `mod_management/util/getInstallPath.ts`, `stagingDirectory.ts`, `InstallManager.ts`, `modIdManager.ts`.
- **Methods**, tried in priority order until one works for every mod type: hard links (5), symbolic links (10), symbolic links through an elevated helper (20), move (50, experimental). The choice is stored in `settings.mods.activator[gameId]`. **[source]** `extensions/*_activator/index.ts`, `mod_management/util/deploymentMethods.ts`.
- **Cyberpunk forbids symbolic links**: the extension registers the game with `compatible: { symlinks: false }`, so a Cyberpunk setup uses **hard links**, which need the staging folder on the game's volume (Vortex suggests `<game volume>\Vortex Mods\cyberpunk2077` when it isn't), or the experimental move method. **[source]** extension `src/index.ts`. This matters for XF Studio: its source scan skips symbolic links, but hard links are ordinary files to it.
- **What a deployment leaves in the game folder:** the files (hard links share the staging file's identity and modification time), `__folder_managed_by_vortex` in every folder Vortex had to create, `<file>.vortex_backup` for a file that was already there and that a mod replaced (restored on purge), and the manifest. **[source]** `LinkingDeployment.ts`.

### 2.2 The deployment manifest

One manifest per mod type, in that type's target folder: `vortex.deployment.json` for the default type, `vortex.deployment.<type>.json` otherwise. The Cyberpunk extension registers **no** mod types (its `registerModType` is commented out because it stopped Vortex deploying), so a Cyberpunk setup has exactly one manifest, in the game folder, listing everything. **[source]** `activationStore.ts` `saveActivation`; extension `src/index.ts`.

| Field | Meaning |
|---|---|
| `version` | Format version, 1 |
| `instance` | The Vortex installation's id (`app.instanceId`, a UUID made on first start). A per-user and a shared (multi-user) Vortex have different ids. |
| `deploymentMethod` | e.g. `hardlink_activator` |
| `gameId`, `deploymentTime` (ms), `stagingPath`, `targetPath` | Private paths: never copy them into a portable document |
| `files[]` | `relPath` (relative to the target folder, backslashes, original case), `source` (the mod id, i.e. staging folder name; `__merged` for merged files), `target` (empty for Cyberpunk, whose extension sets `mergeMods: true`), `time` (the staged file's modification time in ms), optional `merged` |

- It is written atomically (`<name>.XXXXXX.tmp`, then renamed) after every deployment, with a binary copy, `vortex.deployment.msgpack`, in the staging folder. **A purge deletes both**; an empty deployment never leaves an empty list. Vortex treats the manifest as a fallback and works if it's deleted, so its absence doesn't prove Vortex isn't in use. **[source]** `activationStore.ts`.
- **Only winners are listed.** Mods are deployed lowest priority first and each file key is overwritten by later mods, so a file two mods ship is listed once, for the mod that won. **[source]** `LinkingDeployment.ts` `addModFiles`.

### 2.3 Conflicts and order

- **File conflicts** (two mods ship the same path) are settled by a topological sort of each mod's `before`/`after` rules; mods without a rule between them fall in whatever order the sort gives. `conflicts` rules block deployment; unresolved file conflicts only block **launching** from Vortex. `fileOverrides` hide a mod's copy of a file. **[source]** `mod_management/util/sort.ts`, `modActivation.ts`, `mod-dependency-manager`.
- **Archive order is the game's.** The extension never writes `archive/pc/mod/modlist.txt`, and its own help says archive mods load "in the usual alphabetical order", before REDmods. Two differently named archives that contain the same resource are therefore ordered exactly as in a direct install ([mod loading §1](mod-loading.md#1-the-stages-in-order), stage 3). **[source]** extension `src/load_order.ts`.
- **REDmod** has its own load order: stored in Vortex state (`persistent.loadOrder[profile]`), written to `<game>\V2077\Load Order\V2077-load-order-<profile>.json` and `<game>\V2077\modlist.txt`, and applied by running `tools\redmod\bin\redMod.exe deploy … -modlist=V2077\modlist.txt` after a deployment in which the order changed. REDmods deploy to `mods\<name>`. **[source]** extension `src/load_order.ts`, `src/installer.redmod.ts`.

### 2.4 How the extension installs mods

- **One installer for everything.** Priority 30, accepting every archive, it recognises the frameworks (CET, redscript, RED4ext, TweakXL, ArchiveXL, …), REDmods, multi-type mods, and archive mods, unwrapping a single top-level folder. **[source]** extension `src/installers.ts`.
- **Archive mods keep their paths:** `archive\pc\mod\x.archive` and `x.archive.xl` land at the same path in the game folder. Archives found elsewhere in the download are placed under `archive\pc\mod\<their folder>`, which the game doesn't read, with a warning. **[source]** extension `src/installer.archive.ts`.
- A loose `.archive` dropped on Vortex (not inside an archive) skips the installers and would deploy to the **game folder root**, where the game ignores it. **[source]** Vortex `mod_management/index.ts`, extension `queryModPath: () => ""`.

## 3. Metadata: Vortex's state

- **Where.** `%APPDATA%\Vortex\state.v2`, a LevelDB database; in shared (multi-user) mode a second one at `%ProgramData%\vortex\state.v2`. Vortex 2.x opens it through DuckDB's `level_pivot` extension, but the files are ordinary LevelDB. **[source]** `src/main/src/Application.ts`, `store/LevelPersist.ts`, `store/DuckDBSingleton.ts`.
- **Keys and values.** A key is the Redux state path joined with `###` (`persistent###mods###cyberpunk2077###<mod id>###attributes###modId`); a value is the leaf's JSON. Arrays and other non-plain objects are stored whole. **[source]** `LevelPersist.ts`, `store/stateDiff.ts`.
- **What XF Studio reads:**

| State path | Meaning |
|---|---|
| `app.instanceId` | Matches the manifest's `instance`: this is the Vortex that deployed |
| `settings.profiles.activeProfileId`, `settings.profiles.lastActiveProfile.<game>` | The profile in use |
| `persistent.profiles.<id>` `{gameId, name, modState.<mod>.enabled}` | Profiles and what each enables |
| `persistent.mods.<game>.<mod id>` `{installationPath, attributes}` | Installed mods. `attributes`: `name`, `logicalFileName`, `customFileName`, `version`, `source` (`nexus`), `modId`, `fileId`, `downloadGame`, `installTime` |
| `settings.mods.installPath.<game>`, `settings.mods.activator.<game>`, `settings.gameMode.discovered.<game>.path` | Staging folder, deployment method, managed game folder |

- **Reading it safely.** Vortex holds LevelDB's `LOCK` while it runs; a second Vortex waits and then reports the database as locked. XF Studio never opens the database: it reads the files beside `LOCK` and interprets them itself, which works whether or not Vortex is running, except for files Vortex holds open for writing. Whether Vortex holds its newest log file open so that no other program can read it is **[hypothesis]**: upstream LevelDB's Windows environment opens writable files without sharing. When the files can't be read completely, the fallback is Vortex's own full-state JSON backup, `%APPDATA%\Vortex\temp\state_backups_full\hourly.json` (written every hour Vortex runs, from an hour after it starts) or `manual.json`, which may be up to an hour old. `Vortex.exe --get <path>` also prints state, but only while Vortex is closed, and it starts Vortex's executable, so XF Studio doesn't use it. **[source]** `recovery/index.ts`, `store/store.ts`, `main.ts`.

## 4. Detecting a Vortex setup

| Signal | What it proves | Grade |
|---|---|---|
| `vortex.deployment.json` in the game folder | Vortex has files deployed there now; names the installation (`instance`), method, staging folder | [source] |
| `__vortex_staging_folder` in the staging folder | That folder is a Vortex staging folder for the named game and installation | [source] |
| `%APPDATA%\Vortex\state.v2` (or `%ProgramData%\vortex\state.v2`) | Vortex has run for this Windows user (or in shared mode); its state names the managed game folder and the active profile | [source] |
| `HKCU\Software\Classes\nxm\shell\open\command` naming `Vortex.exe` | Vortex was the last program to claim Nexus links. Vortex claims them **on first start and again on every start** unless its "handle Nexus links" setting is off, so this only says Vortex ran most recently, not that it manages the game. | [source] |
| Uninstall entry | Vortex is installed | **[hypothesis]** electron-builder's per-machine installer entry (app id `com.nexusmods.vortex`) |

**Active profile:** `settings.profiles.activeProfileId` when that profile's `gameId` is `cyberpunk2077`; otherwise the game's `lastActiveProfile` (Vortex is managing another game right now, and the game folder holds whatever was last deployed for Cyberpunk).

## 5. What XF Studio sees

**The direct route is already right about the files.** Because Vortex deploys hard links into the game folder, the direct route scans exactly the files the game will read, whatever Vortex's state says. What it lacked was *who* put each file there.

| Situation | Game folder (what the game loads) | Direct route before | With Vortex attribution |
|---|---|---|---|
| Normal deployment | Winners of enabled mods | Correct files, all "Installed game" | Each deployed file names its Vortex mod (and Nexus ids when the state is readable) |
| A mod disabled or uninstalled but **not yet deployed** (auto-deploy off, or deployment failed) | The old files | Correct: the game loads them too | Reported as a stale deployment: "deploy in Vortex" |
| Purged | Nothing from Vortex | Correct | No manifest; nothing to attribute |
| Profile switched to another game | Last Cyberpunk deployment | Correct | Profile shown as not active |
| A file replaced or deleted outside Vortex | The new file / nothing | Correct | Reported as changed / missing; Vortex shows the same in its External Changes dialog |
| A file placed by hand (or by another tool) | It | Correct | Reported as not deployed by Vortex |
| REDmod mods | `mods\<name>` + `r6\cache\modded` | Not mounted (REDmod unmodelled on every route) | Same gap |

- **Symbolic links** would have been a problem (the scan skips links), but Cyberpunk forbids them in Vortex. A symlinked file from another manager still shows as a skipped link.
- **The move method** leaves real files in the game folder; attribution works the same.

## 6. Placing XF Eye Artistry in a Vortex setup

| Option | Vortex's reaction | Fits "don't touch users' setups"? |
|---|---|---|
| Copy `XF Eye Artistry.archive` + `.xl` into `archive\pc\mod` | Ignored: Vortex's external-change check walks only files in its manifest, and purges remove only its own links. If a Vortex mod later ships the same file name, Vortex renames ours to `.vortex_backup` and restores it on purge. The mod is invisible in Vortex and can't be toggled there. **[source]** `LinkingDeployment.ts` | Adds only our files, but leaves the user an unmanaged mod in a managed setup |
| **Hand an installable archive to Vortex** (`Vortex.exe --install-archive <zip>`; the running Vortex receives it) | Installed through the Cyberpunk installer like a download, then enabled and deployed by Vortex's defaults (`settings.automation.install`, `enable` and `deploy` all default to on). **[source]** `cli.ts`, `settings_interface/reducers/automation.ts` | Yes: Vortex adds one mod the user can see, disable, update and uninstall |
| Write into the staging folder or state | — | No: never |

**Recommendation.** For a Vortex-managed game, Build writes `XF Eye Artistry.zip` holding `archive\pc\mod\…` exactly as the game needs, and offers **"Add to Vortex"**, which (with consent) runs the user's own `Vortex.exe --install-archive`, or tells them to drag the file onto Vortex's Mods page. The archive's file name becomes the mod's name in Vortex, so keep it the plain mod name. Open questions: what Vortex does when a same-named archive is installed again (it offers replace or variant), and whether a `.zip` built by XF Studio needs a `fomod` or Nexus metadata (it shouldn't).

## 7. Implementation

`projects/xf-studio/authoring/src`:

- `vortex-deployment.ts` (pure): manifest names and parsing, attribution of a game-folder file, and the comparison of a scan with the deployment (unmanaged, missing, changed, stale).
- `vortex-state.ts` (pure): Vortex's `###` keys into the state tree, then the game's profile, mods and Nexus ids; the staging-folder pattern.
- `leveldb-read.ts` (pure): a read-only LevelDB reader (log records, write batches, tables with Snappy blocks, MANIFEST live-file set). When the MANIFEST can't be read it reads every file and keeps each key's newest sequence number, and says so.
- `vortex-host.ts` (adapter): `readVortexManifests` (used by source discovery on every route: game-folder files get `deployedBy` and name their Vortex mod as provider; the manifest is watched, so a redeploy reopens the installation) and `inspectVortexSetup` (the installation that deployed, matched by instance id; state from the database or a backup; staging marker).
- `tools/vortex-check.ts`: a read-only report for one game folder, with no paths in its output.

Tests: `tests/vortex-deployment.test.ts`, `vortex-setup.test.ts`, `leveldb-read.test.ts`; fixtures in `tests/fixtures/vortex/`. The manifest fixture is built from the source-documented format.

## Open questions

1. What does Vortex do with a second `--install-archive` of the same archive name: replace, variant, or a prompt that blocks an unattended install?
2. Does anything in the game or a framework behave differently for hard-linked files (for example a tool that rewrites an archive in place, which would change the staged copy too)?
3. How do Vortex collections and "load order" entries for REDmods interact with archives shipped inside REDmods, once the resolver mounts REDmod archives?

## Test asks

Not for the maintainer, whose setup is MO2. A community tester with a Vortex-managed game can run `bun tools/vortex-check.ts --game-root <game folder>` from a source checkout and confirm the listed mods, versions and Nexus ids match Vortex's Mods page, then disable one mod without deploying and confirm it is reported as stale.

## Related pages

[Mod loading](mod-loading.md) · [Vortex support backlog](../research/backlog/vortex-support.md) · [Experiment 023](../experiments/023-vortex-sandbox/README.md) · [MO2 source resolution](../research/character-customization/mod-source-resolution.md) · [Framework check and MO2 placement](../research/authoring/framework-version-check.md)
