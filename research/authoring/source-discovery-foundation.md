# Source discovery foundation

This page covers two read-only host capabilities in `projects/xf-studio/authoring/src`:

- **install detection**, which finds where Cyberpunk 2077 and Mod Organizer 2 (MO2) are installed;
- **source discovery**, which inventories the files a chosen launch route can see.

Neither capability writes to the game, a launcher or MO2, and neither launches anything.

Evidence grades used below: **source** means read in the upstream tool's source code; **observed** means seen on a local install during a read-only check; **expected** means inferred from source but not observed at runtime.

## Install detection

`install-detection.ts` holds the policy and parsers. It is pure and talks to the host only through a small `DetectionHostPort`. `install-detection-host.ts` is the Windows adapter: it reads environment variables, performs bounded file reads that refuse links, and runs `reg.exe query` with fixed keys and no shell. `mo2-instance.ts` holds the pure MO2 interpretation that detection and discovery share. Synthetic fixtures are in `tests/install-detection.test.ts`.

A game folder is offered only when it contains `bin/x64/Cyberpunk2077.exe`. Registered folders without the executable are listed separately in `rejected`. When several sources point to the same folder, they merge into one candidate with all their evidence.

| Source | How it is found | Grade |
|---|---|---|
| Steam | `HKCU\Software\Valve\Steam` `SteamPath` (with the HKLM `InstallPath` keys as fallback), then `steamapps/libraryfolders.vdf` (current `path` objects and the legacy numbered strings), then each library's `appmanifest_1091500.acf` `installdir`, then `steamapps/common/<installdir>` | Format observed on a machine without the game; the manifest step is covered by synthetic fixtures only |
| GOG | Every subkey of `GOG.com\Games` in both the native and `WOW6432Node` registry views whose product ID is the base game's or whose `gameName` names Cyberpunk 2077 | Observed: the base game is product `1423049311` (`gameName` "Cyberpunk 2077"). Phantom Liberty (`1256837418`) and REDmod (`1597316373`) register the same `path`. Each path is still checked for the executable instead of trusting an ID |
| Epic | `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` JSON, matched on a `LaunchExecutable` ending in `bin/x64/Cyberpunk2077.exe` or a Cyberpunk 2077 `DisplayName`, then `InstallLocation` | Manifest format observed with other apps; the Cyberpunk match is covered by synthetic fixtures only |
| MO2 | `gamePath` of each detected instance whose `gameName` is "Cyberpunk 2077" | Observed |

MO2 instances are found the way MO2 itself finds them:

- **Global instances** are the folders under `%LOCALAPPDATA%\ModOrganizer` that contain `ModOrganizer.ini`. Source: MO2 2.5.2 [`instancemanager.cpp`](https://github.com/ModOrganizer2/modorganizer/blob/v2.5.2/src/instancemanager.cpp).
- **Portable instances** are MO2 program folders that contain `ModOrganizer.ini`. They are found through the registered download handler:
  - the `nxm` protocol command in `HKCU\Software\Classes\nxm\shell\open\command` names an `nxmhandler.exe`, and that folder is checked;
  - the handler's `downloadhandler.ini` (or its legacy name `nxmhandler.ini`), either globally in `%LOCALAPPDATA%\ModOrganizer` or beside that `nxmhandler.exe`, lists `ModOrganizer.exe` executables, and each executable's folder is checked.

  Source: [modorganizer-nxmhandler `main.cpp`](https://github.com/ModOrganizer2/modorganizer-nxmhandler/blob/2209ca0ce95e60bfd85cf46f4c8dcf640a18acf8/src/main.cpp) and `handlerstorage.cpp`. A portable copy that was never registered as the handler cannot be found this way and has to be chosen manually.

Each instance description gives the following, parsed from its QSettings INI:

- `gameName`, `gamePath` and `selected_profile`;
- the configured directories, resolved as MO2's `PathSettings` does in [`settings.cpp`](https://github.com/ModOrganizer2/modorganizer/blob/v2.5.2/src/settings.cpp):
  - `[Settings] base_directory` defaults to the INI's folder;
  - `mod_directory`, `profiles_directory`, `overwrite_directory` and `download_directory` default to `%BASE_DIR%/mods`, `/profiles`, `/overwrite` and `/downloads`, with `%BASE_DIR%` substituted;
- `skip_file_suffixes` (default `.mohidden`) and `skip_directories` (default `.git`);
- the list of profile folders that contain a `modlist.txt`.

The parser follows QSettings value syntax: `@ByteArray(...)`, `\\` escapes, quoting, and an unquoted `;` starting a comment. Keys and sections are case-insensitive, as QSettings INI files are on Windows. `reg.exe` prints in the console code page, so a registry path outside that code page may not round-trip.

On the development machine, a read-only run found the game through three GOG registry entries and one portable MO2 instance. It found no Steam or Epic record for the game. Detection took about 0.2 s.

The capability is exposed as the typed read-only host actions `detect.gameInstalls` and `detect.mo2Instances`. They are listed in `DETECTION_DESCRIPTORS` and served GET-only by `/api/install-detection?target=games|mo2`. A third action, `detect.frameworkVersions`, reuses the same MO2 interpretation to report framework versions ([framework check](framework-version-check.md)). See the [action catalogue](ui-action-catalogue.md#host-actions). No settings view uses them yet. A later setup view can offer each candidate and then save the choice through the local setup actions.

## Source discovery

`source-discovery.ts` accepts the validated `xfs/local-settings-1` settings. It returns typed `SourceCandidate` rows, loose-file assessments, issues and explicit limits. It supports two launch routes:

- **Direct:** `gameRoot/archive/pc`, plus an optional `manualModRoot/archive/pc` tree with the same install shape.
- **MO2:** the same physical game/manual files, plus the selected profile's listed mod folders and the overwrite folder.

Direct mode excludes staged MO2 content. Only `.archive`, `.xl`, loose `.inkcharcustomization` and `archive/pc/mod/modlist.txt` are inventoried. No archive is opened, extracted or copied.

For MO2 the scanner reads the instance's `ModOrganizer.ini`. It takes the mods, profiles and overwrite folders from the configured directories and applies `skip_directories`. A folder without an INI uses MO2's defaults. `mod-install-transport.ts` resolves MO2 install targets through the same configured directories.

### MO2 precedence

The rules come from MO2 2.5.2 [`profile.cpp`](https://github.com/ModOrganizer2/modorganizer/blob/v2.5.2/src/profile.cpp) (grade: source):

- **The first row wins.** `modlist.txt` is written **highest priority first**. `refreshModStatus` gives row *i* of *N* known mods priority *N − i − 1*, and `doWriteModlist` writes priorities in reverse. When listed mods provide the same virtual path, the earlier row wins.
- **Overwrite** ranks above every listed mod.
- **Row prefixes:**
  - `-` disables a mod.
  - `+`, `*` and a bare name enable it. `*` marks a foreign, unmanaged entry with no folder in the mods directory.
  - A repeated name keeps its first row.
  - An `overwrite` row is ignored.
- **Separators:** mod names ending in `_separator` carry no files and are skipped.

Mods in the mods folder that the profile does not list are not part of that profile's state.

These rules correct an earlier version that treated later rows as higher priority. The runtime diagnostic clone already agreed with MO2: it appends its dedicated mod to the end of the copied list, which makes it the lowest priority, and it refuses to stage if any exact-path collision exists.

A read-only check on the development machine's selected profile compared the old rule with the corrected one. The profile has about 1,000 rows, 11 of them separators. It has 11 exact virtual paths provided by two enabled mods each: four archives and seven `.xl` files. The winner flips for all 11. In 10 cases the two files are byte-identical, so the flip is immaterial. In one case, an `.xl` shipped by both a base mod and its variant, the files differ, and the variant listed first now correctly wins. Grade: expected. This is MO2's source rule applied to the profile, not a live MO2 virtual-file-origin query or proof of what a game run loaded.

### Candidates and assessments

Every candidate records:

- virtual path and physical path;
- route and profile;
- provider and active state;
- MO2 priority with its evidence text;
- size, modification time and discovery time.

`sha256` is deliberately null until a separate bounded fingerprint stage exists. Disabled MO2 mods remain candidates for diagnosis.

The scanner validates settings and profile names and rejects unsafe mod names. It skips links and non-files. It bounds total entries, depth and profile size. A **blocking** issue (scan error, truncation, unsafe row, skipped link) makes the result incomplete and suppresses precedence conclusions. A **non-blocking** issue records MO2's own deterministic handling, such as a duplicate row. A fresh call re-reads files; there is no persistent cache. Physical paths and profile names are private host metadata. They must not enter portable recipes, collections or public manifests.

`looseFiles` groups candidates by case-insensitive virtual path. It sets `sourceDerivedFirst` in two cases:

- only one active candidate exists in the scanned roots;
- only MO2 mods and overwrite compete, and their priorities differ.

Game/manual collisions remain ambiguous, and `runtimeObservedWinner` is always null. Archive candidates are not assigned a resource or depot winner. MO2 file priority is separate from the game's own archive load order; see [MO2 source resolution](../character-customization/mod-source-resolution.md). A profile `+` means activation intent only. Neither the selected route nor a physical file proves what a game run loaded. This distinction follows the [local catalog prototype](../character-customization/catalog-prototype.md).

## Next stages

The character resolver builds on this inventory: `archive-precedence.ts` collapses virtual archive paths, orders mount groups and reads the game's `archive/pc/mod/modlist.txt`; `resolver-host.ts` reads RDAR indexes, adds the game-folder ArchiveXL bundle (outside the `archive/pc` scan) and applies ArchiveXL registrations, scopes, fixes, patches, copies and links. See [mod loading](../../knowledge/mod-loading.md). Still open:

- REDmod and other deployment transforms, and Vortex deployment state;
- content fingerprints (the resolver's cache keys archives by path, size and modification time);
- independent runtime traces.

Do not infer these from the inventory.

Known gaps:

- Links inside a real overwrite folder currently make the scan incomplete.
- Local setup readiness and the runtime diagnostic stage/promotion still assume the default `profiles` and `mods` folders under the MO2 root.

Fixtures are synthetic and asset-free: `tests/source-discovery.test.ts`, `tests/install-detection.test.ts` and `tests/install-detection-actions.test.ts`.
