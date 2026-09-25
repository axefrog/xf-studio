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
| Steam | `HKCU\Software\Valve\Steam` `SteamPath`, the HKLM `InstallPath` keys, and `%ProgramFiles(x86)%\Steam` or `%ProgramFiles%\Steam` when they hold `steamapps`; then `libraryfolders.vdf` from both `steamapps\` and `config\` (current `path` objects and the legacy numbered strings); then `appmanifest_1091500.acf` in every library; then `steamapps/common/<installdir>`, spelled as the folder is on disk. Keys match without case, and the parser treats a BOM and CRLF as whitespace | Format observed on a machine without the game. Every Cyberpunk step, including a unicode library path, a manifest only in a second library and an `installdir` in a different case, is covered by synthetic fixtures only |
| GOG | Every subkey of `GOG.com\Games` in both the native and `WOW6432Node` registry views whose product ID is the base game's or whose `gameName` names Cyberpunk 2077 | Observed: the base game is product `1423049311` (`gameName` "Cyberpunk 2077"). Phantom Liberty (`1256837418`) and REDmod (`1597316373`) register the same `path`. Each path is still checked for the executable instead of trusting an ID |
| Epic | `.item` JSON manifests in `<data>\Manifests`, where `<data>` is `%ProgramData%\Epic\EpicGamesLauncher\Data` or the launcher's registered `AppDataPath` (`HKLM\SOFTWARE\WOW6432Node\Epic Games\EpicGamesLauncher`). A manifest matches on a `LaunchExecutable` ending in `bin/x64/Cyberpunk2077.exe` or a Cyberpunk 2077 `DisplayName`, and its `InstallLocation` is checked. A manifest with `bIsIncompleteInstall: true` is rejected with a plain "hasn't finished" issue. The launcher's second list, `%ProgramData%\Epic\UnrealEngineLauncher\LauncherInstalled.dat` (`InstallationList` rows of `AppName` and `InstallLocation`), is read too, so a location recorded there after a move is still found. Every location is confirmed by executable | The `.item` fields (including `bIsIncompleteInstall`, CRLF and backslash paths), `AppDataPath` and the `LauncherInstalled.dat` shape were observed with other apps. The Cyberpunk match and the unfinished, moved and multiple-install cases are covered by synthetic fixtures only |
| Xbox app | Recognised, never offered; see [store coverage](#store-coverage). Each local drive (from `HKLM\SYSTEM\MountedDevices`, so network shares are not probed) is checked for a `.GamingRoot` file naming library folders, plus the default `XboxGames`. A `<library>\<title>\Content` folder holding `MicrosoftGame.config` or `appxmanifest.xml`, with a Cyberpunk 2077 title or the game executable, is reported as unsupported. A lead from another source that points into such a folder or into a `WindowsApps` path is reported the same way. When no folder is found, a `HKLM\SOFTWARE\Microsoft\GamingServices\PackageRepository\Package` value naming Cyberpunk 2077 is reported without a path | `.GamingRoot` layout observed on two drives of the development machine: `RGBX`, a 32-bit 1, then NUL-terminated UTF-16LE relative paths. The package key was observed holding other packages. The `Content` marker files are expected, not observed. The Cyberpunk cases are synthetic fixtures only |
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

The parser follows QSettings value syntax: `@ByteArray(...)`, `\\` escapes, quoting, and an unquoted `;` starting a comment. Keys and sections are case-insensitive, as QSettings INI files are on Windows. `reg.exe` prints in the console code page, so a registry path outside that code page may not round-trip. Such a character comes back as `?`, which no Windows path contains, so a Steam, GOG or Epic registry path containing `?` is skipped with a `registry_text_unreadable` issue. The other leads (Steam's Program Files default, Epic's `%ProgramData%` folder, MO2) still run. Paths inside `libraryfolders.vdf`, `.item` files and `LauncherInstalled.dat` are UTF-8 file text and are read exactly.

On the development machine, a read-only run found the game through three GOG registry entries and one portable MO2 instance. It found no Steam, Epic or Xbox app record for the game. Detection took about 0.2 s before the Xbox app and Epic additions and about 0.4 s after.

The capability is exposed as the typed read-only host actions `detect.gameInstalls` and `detect.mo2Instances`. They are listed in `DETECTION_DESCRIPTORS` and served GET-only by `/api/install-detection?target=games|mo2`. A third action, `detect.frameworkVersions`, reuses the same MO2 interpretation to report framework versions ([framework check](framework-version-check.md)). See the [action catalogue](ui-action-catalogue.md#host-actions). The 3D preview's setup card runs `detect.gameInstalls` when the game folder is missing. It offers a single candidate with "Use this folder". When nothing usable was found but an Xbox app copy was, the card shows that copy's plain message above "Choose game folder".

### Store coverage

| Store | Detected | Proven by |
|---|---|---|
| GOG | Yes | A real machine (the development machine) and synthetic fixtures |
| Steam | Yes | Synthetic fixtures only. The registry and `libraryfolders.vdf` formats were observed on a machine without the game |
| Epic Games Store | Yes | Synthetic fixtures only. The manifest and install-list formats were observed with other apps |
| MO2 (any store) | Yes | A real machine and synthetic fixtures |
| Xbox app / Microsoft Store | Recognised and explained, never offered | Synthetic fixtures only |

**Why the Xbox app copy is not supported** (checked 25 September 2026):

- **No framework source mentions it.** The RED4ext (`c52c8d8`), ArchiveXL (`5474e34`), Cyber Engine Tweaks (`9a8522f`), redscript (`3ca666c`), TweakXL (`f8da6be`) and Codeware (`613a1cb8`) clones were searched for Xbox, Game Pass, Microsoft Store, Windows Store, `WindowsApps`, UWP and GDK. The only hits are CET icon-font glyph names. **[source]**
  - The install guides say only to extract into the game directory: [RED4ext's guide](https://docs.red4ext.com/getting-started/installing-red4ext), and ArchiveXL's `README.md` (RED4ext 1.29.0 or newer, then extract into the Cyberpunk 2077 directory).
  - RED4ext's script-validation failure text tells the user to verify game files "with Steam/GOG" (`src/dll/Hooks/ValidateScripts.cpp`).
  - RED4ext identifies the game only by the executable's `ProductName` "Cyberpunk 2077" (`src/dll/Image.cpp`) and loads addresses from the game's `cyberpunk2077_addresses.json` (`src/dll/Addresses.cpp`). Nothing in it is store-specific.
  - So the sources neither support nor exclude an Xbox app edition: they never consider one.
- **There is no Xbox app edition for Windows to support.** **[source]** for the store listings. The absence of a Windows edition is what those listings show today, not a promise.
  - Microsoft's store listing (product `BX3M8L83BBRW`, which `apps.microsoft.com` redirects to [xbox.com](https://www.xbox.com/en-us/games/store/cyberpunk-2077/bx3m8l83bbrw)) lists Xbox One, Xbox Series X|S and Xbox Cloud Gaming, and no PC.
  - The Game Pass entry announced on [Xbox Wire on 3 March 2026](https://news.xbox.com/en-us/2026/03/03/xbox-game-pass-march-2026-wave-1/) was for cloud and console only.
  - CD PROJEKT RED's [REDmod page](https://www.cyberpunk.net/en/modding-support) offers the REDmod DLC for GOG, Steam and Epic Games. Its [launch troubleshooting](https://support.cdprojektred.com/en/cyberpunk/pc/sp-technical/issue/1568/game-is-not-launching) names only Steam, GOG GALAXY and the Epic Games Store.
  - The Modding Docs clone (`be2f44ee`) lists the same three platforms (`for-mod-users/users-modding-cyberpunk-2077/getting-started/README.md`).
- **What the Studio says.** ArchiveXL runs as a RED4ext plugin installed into the Windows PC game, and that game is sold on Steam, GOG and the Epic Games Store. A recognised Xbox app copy therefore gets `XBOX_UNSUPPORTED_MESSAGE` from `install-detection.ts`. It names ArchiveXL, says where the PC edition is sold, notes that the Xbox store sells the game for consoles and cloud play, and gives one next step: install from Steam, GOG or Epic Games, then choose that folder. It does not claim that the frameworks were tried on an Xbox copy and failed. If a Windows Xbox app edition appears later, the frameworks' own statements decide whether detection should offer it.

**Nothing else depends on the store.** The framework version check (`framework-versions.ts`) and both launch routes read only the chosen game folder. A test runs the check against Steam-, GOG-, Epic- and unicode-shaped folders and gets identical verdicts. No XF Studio code launches the game, reads `REDprelauncher`, finds save folders by path, or treats REDmod's `mods/` folder differently by store (REDmod archives are listed as not mounted for every store). Three local shader-research tools that hard-coded one install path now read the game folder from the Studio's setup (`tools/configured-game-root.ts`).

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
