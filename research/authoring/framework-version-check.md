# Framework version check and MO2 placement

The Studio never installs, replaces, disables or duplicates a user's frameworks, and never reshapes their mod list. It reads which framework versions the game would load, tells the user plainly what to update and where to get it, and adds only its own mod when placing into MO2. This page records how the read-only check works, why each minimum was chosen, and the placement rule. Code: [`framework-versions.ts`](../../projects/xf-studio/authoring/src/installation/framework-versions.ts), [`pe-version.ts`](../../projects/xf-studio/authoring/src/formats/pe-version.ts), [`mo2-placement.ts`](../../projects/xf-studio/authoring/src/installation/mo2-placement.ts).

## What the check reads

The check covers ArchiveXL, TweakXL, Codeware, RED4ext, redscript and Cyber Engine Tweaks. Each has one marker file, relative to the game folder:

| Framework | Marker | Version source |
|---|---|---|
| ArchiveXL | `red4ext/plugins/ArchiveXL/ArchiveXL.dll` | DLL version resource |
| TweakXL | `red4ext/plugins/TweakXL/TweakXL.dll` | DLL version resource |
| Codeware | `red4ext/plugins/Codeware/Codeware.dll` | DLL version resource |
| RED4ext | `red4ext/RED4ext.dll` | DLL version resource |
| redscript | `engine/tools/scc.exe` | MO2 `meta.ini` only; the compiler has no version resource |
| Cyber Engine Tweaks | `bin/x64/plugins/cyber_engine_tweaks.asi` | DLL version resource |

Each route is reported separately:

- **Game folder:** the marker in the game folder.
- **MO2 profile:** the first provider in MO2's order. That is `overwrite`, then enabled mods from the first `modlist.txt` row down, then the game folder. Other enabled copies are listed as hidden, e.g. the removed side-by-side framework copies.

**Which version is authoritative.** The binary's `VS_FIXEDFILEINFO` file version is authoritative, because it is the file the game loads. It is read from the PE `.rsrc` section only, and its first three parts are used: ArchiveXL 1.27.3 reports `1.27.3.17607`. MO2's `meta.ini` `version` is mod-manager metadata. It may be stale or hand-edited; after an in-place update the `installationFile` still names the old archive. It is used only when the binary has no version resource (redscript). A disagreement is reported as a note. Neither source proves what a past session loaded: new RED4ext and framework logs are runtime evidence.

## Minimums for XF Eye Artistry

| Framework | Minimum | Reason |
|---|---|---|
| ArchiveXL | 1.27.3 | The package uses CCXL registration, the customization appearance fallback (`FixCustomizationAppearance`), mesh `@` material expansion and `*`/`{material}` dynamic paths. Those mechanisms first appear between ArchiveXL 1.14 and 1.20 (first commits `10b61a1`, `e2fe13b`, `fc8e7a1`). The package does not use 1.27's composite `+` attributes (`GetMaterialAttrs`, `100ae62`). However, the selector wiring and the verifier's expansion model were derived from the 1.27.3 source (`5474e34`), and no earlier release has been checked against the package. Relax this only with evidence. |
| RED4ext | 1.29.0 | The ArchiveXL 1.27.3 README installation requirement. |
| redscript | 0.5.31 | The ArchiveXL 1.27.3 README compatibility line (ArchiveXL ships scripts). |
| TweakXL, Codeware, CET | none | Not used by the package; reported for information only. |

The ArchiveXL tags and commits above were read from the local `cp2077-archive-xl` checkout. The README requirements come from the `v1.27.3` tag; the 1.26.x and 1.27.0 READMEs also name game 2.31.

## Requirements for the person's products

Settings reports the union of what the person builds, rather than treating XF Eye Artistry's host verdicts as a universal requirements list. **XF Eye Artistry always counts. Expression sets count whenever the library holds any expression set**, including an empty one. The presentation asks the part-preset service through the application's public set-list interface; it never reads library storage or a feature's private state. Creating or deleting the last expression set updates the rows without another scan of the installed files.

Expression sets require ArchiveXL **1.27.3** (their animation-component resource patch) and TweakXL **1.11.4** (their photo-mode list records). The diagnostic contribution and exporter share the same pinned minimums. See the [expression exporter](../../projects/xf-studio/authoring/src/features/expressions/export/index.ts). Eye Artistry's RED4ext and redscript requirements continue to apply. When products need the same framework, the strongest minimum wins and all those products are named.

Every needed row has one short phrase, for example “Needed for expression sets” or “Needed for XF Eye Artistry and expression sets”. Only frameworks none of these products need go under the quiet “Not needed for your mod” heading, with muted names, versions and sources and no status chip. Codeware and CET are currently informational; TweakXL is informational only without expression sets. The host's report still inventories all six frameworks; the application computes the product-specific verdicts from that inventory.

Product requirements preserve the library owner’s three read states. While loading, the line says “Checking what your mods need…”. On failure, it shows the owner’s plain message and **Try again**, which retries the failed list through that owner; **Check again** retries failed requirement reads alongside framework detection. Both unresolved states hide framework rows and withhold readiness, even after successful detection. Only a successful, empty list establishes that expression sets add no requirements. A retry returns to loading until the owner resolves it. Regressions: `tests/studio-presentation.test.ts` (held read, failed read, both retries, empty and nonempty success) and `tests/ui-polish-dom.test.ts` (plain lines and retry control).

A successful report and the latest framework attempt carry the input key captured when the request started: game folder, route, MO2 instance and profile. The presentation uses only a report matching the current key and selected route. While a new route has no matching success it is not checked; after a failure it shows that attempt's plain message and Check again, never readiness from an earlier route. Other detection targets do not erase the framework failure. The previous rows remain during a re-check of the same inputs, with the checking line in place of readiness.

Discovery is queued by the detection service behind a running check. There is no UI wait loop or two-second deadline. Both game and MO2 discovery must succeed before completion is remembered; a failed or cancelled batch can be requested again. `AbortSignal` cancels queued interest and is passed to the running browser request. Hiding Settings cancels its discovery request without cancelling another caller's framework check.

**Guidance wording.** It follows the "It just works" policy: one sentence covering what is needed, what the user has, and the one next step, plus Nexus Mods and GitHub links. Example: "XF Eye Artistry needs ArchiveXL 1.27.3 or newer; you have 1.26.3. Update it in Mod Organizer 2 with the latest release from Nexus Mods or GitHub." A missing framework says where it is missing. An unreadable version asks for a reinstall of the latest release. Reports carry mod and profile names, never local paths.

**Where it is exposed:**

- The typed read-only host action `detect.frameworkVersions`, served by `/api/install-detection?target=frameworks` from the host's own settings. The page runs it by itself once the settings are known and whenever the game folder, the route or the Mod Organizer 2 instance or profile changes (`watchFrameworkInputs`, wired by the composition root), so the answer is ready before anyone looks; **Check again** asks once more, including in a read-only window. The endpoint reads host settings, game files, MO2 configuration, the profile mod list and mod metadata; it writes nothing durable. Detection keeps its result only in memory, so both the capability and dispatch bypass the workspace lease for this action.
- **Settings › Game › Mod frameworks** (shown once a game folder is chosen): one row per framework in the table above for the route the person launches with, in the order needed frameworks first. A needed row shows the name, its “Needed for …” phrase, the version the game will load and where it comes from (the game folder, or the Mod Organizer 2 mod), and a status: **Up to date**, **Too old (minimum X)**, **Missing**, **Version unknown**, or a quiet informational row under **Not needed for your mod** (only frameworks none of the current products need). A needed framework that isn't up to date shows this page's guidance sentence and links to its Nexus Mods and GitHub release pages (named links the host opens: `framework-<id>-nexus` and `framework-<id>-github`; the page never supplies a URL). A second, unused copy and a mod list that disagrees with the file are notes under the row. While everything needed is fine the rows fold under the line "All frameworks up to date". Nothing here installs, updates, disables or removes a framework. The Mod package card's Game section adds one pointer line while a needed framework needs attention and never repeats the detail; Help's "Installing your mod" and "Settings" topics name the same place. Components and states: [Framework status](../../projects/xf-studio/authoring/src/studio-ui/style-guide/library.ts) in the style guide's Component library; code in `src/installation/framework-status.ts` (the derivation) and `src/studio-ui/panels/framework-group.ts`.
- An advisory `frameworks` entry in Local setup readiness, for the selected launch route. It never blocks Check or Build.
- Cautions in the runtime-diagnostic plan.
- The read-only [`tools/framework-check.ts`](../../projects/xf-studio/authoring/tools/framework-check.ts).

## MO2 placement rule

MO2 writes `modlist.txt` highest priority first, so the left pane is the file reversed ([MO2 2.5.2 `profile.cpp`](https://github.com/ModOrganizer2/modorganizer/blob/v2.5.2/src/profile.cpp) `doWriteModlist`). A separator heads the mods below it in the pane. In the file, those are the rows above its line, back to the previous separator. Rows after the last separator line sit loose at the top of the pane.

Placement adds exactly one row and moves nothing else:

1. **Already listed** (enabled or disabled): keep the user's position; only the enabled flag changes.
2. **A related entry is listed** (the legacy `XF Studio` folder or the older `XF Eye Artistry CCXL - Dev` mod) outside a framework section: insert directly below it in the pane, i.e. immediately before its row in the file. It lands in the same section with one step higher priority.
3. **Otherwise:** use the bottom of the pane, which is the first row of the file. MO2 gives a mod folder the profile does not yet list the highest priority, i.e. the bottom of the pane (`Profile::refreshModStatus`: unlisted regular mods get `index++` after all listed mods). If that bottom section is a framework section, use the bottom of the nearest section above it that is not. Loose rows at the top of the pane are never used.
4. **Every section holds frameworks:** fall back to MO2's own default (bottom of the pane) and say so.

**Framework section:** a separator whose name contains framework, core, lib(s)/library, requirement, dependency or prerequisite as a word, or whose section contains a mod folder the version check found providing a framework. Frameworks themselves are never added, so nothing is ever placed above or inside such a section except in the rule 4 fallback.

The runtime-diagnostic stage applies this rule to its copied profile. It also switches off an enabled `XF Eye Artistry CCXL - Dev` in that copy only, so two eye-makeup selectors do not compete. Promotion recomputes the same modlist and refuses a stage that differs. The plan schema is `xfs/runtime-diagnostic-plan-2`; stages made by earlier tools must be staged again.

## Results on the reference installation (25 September 2026)

Read-only run of `tools/framework-check.ts` against the reference game folder and MO2 instance. Both profile `modlist.txt` hashes were unchanged afterwards.

| Route | ArchiveXL | TweakXL | Codeware | RED4ext | redscript | CET | Guidance |
|---|---|---|---|---|---|---|---|
| `2025 (again)` | 1.27.3 (DLL = meta) | 1.11.4 | 1.20.5 | 1.30.0 (game folder) | 0.5.31 (meta only) | 1.37.1 (game folder) | All minimums met |
| `XF Studio diagnostic 2026-09-25` | 1.27.3 | 1.11.4 | 1.20.5 | 1.30.0 | 0.5.31 | 1.37.1 | All minimums met |
| Game folder only | not installed | not installed | not installed | 1.30.0 | not installed | 1.37.1 | ArchiveXL and redscript missing: expected, because this installation keeps them in MO2 |

No hidden duplicate framework copies remain in either profile. In both profiles `XF Eye Artistry` is already listed (rule 1, `modlist.txt` line 107, `CUSTOM OVERWRITES` section), directly below `XF Eye Artistry CCXL - Dev` in the pane. With the row removed, rule 2 picks the same row beside that entry. With neither entry present, rule 3 picks the bottom of the `UNCATEGORISED` section.

## Limits

- The check reads installed files only. It does not prove which versions a past or future session loaded, and it does not check the RED4ext loader in `bin/x64`.
- redscript installed directly in the game folder has no readable version.
- Vortex and manual deployment trees are covered only through the game-folder route. That is where Vortex puts a framework (it hard-links deployed files into the game folder), so the game-folder column is right for Vortex users; the framework's Vortex mod name and version are not reported yet ([Vortex](../../knowledge/vortex.md)).
- MO2's `overwrite` is treated as a single top provider. Its generated logs are not frameworks.
