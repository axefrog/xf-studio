# Diagnostics and problem reports

XF Studio traps its own errors, keeps a small private record of what it worked out, and helps a person file a useful bug report without shipping their mods. **Nothing is ever sent automatically.** A report is prepared for review, and the person saves it and attaches it themselves.

Code: [`projects/xf-studio/authoring/src/diagnostics/`](../projects/xf-studio/authoring/src/diagnostics/). Tests: [`tests/diagnostics.test.ts`](../projects/xf-studio/authoring/tests/diagnostics.test.ts), [`tests/diagnostics-report.test.ts`](../projects/xf-studio/authoring/tests/diagnostics-report.test.ts) (what a saved report holds, redaction, the resolution's size) and [`tests/diagnostics-device.test.ts`](../projects/xf-studio/authoring/tests/diagnostics-device.test.ts) (the page's device and the review). The typed actions are in the [action catalogue](../research/authoring/ui-action-catalogue.md#diagnostics-and-problem-reports).

## Where things live

Each host keeps everything in a `diagnostics/` folder inside its own data folder:

| Host | Folder |
|---|---|
| Localhost dev server | `projects/xf-studio/authoring/data/diagnostics/` (ignored by Git; `XFAS_DATA_DIR` moves it) |
| Desktop app | `diagnostics/` in the app's data folder (About shows where that is) |

| File | What it holds | Bound |
|---|---|---|
| `log.jsonl` | The log: one JSON line per event | Rotated to `log.1.jsonl` at 512 KB, so at most about 1 MB |
| `trace/*.jsonl` | The rolling detail window | 30 minutes and 8 MB normally; 3 hours and 64 MB in diagnostic mode |
| `mode.json` | Present only while diagnostic mode is on | Removed when it lapses after 24 hours |

The page keeps a ring of at most 50 entries it couldn't send to its host, and at most 100 waiting to be sent; beyond that the oldest are dropped and one line says how many. Both live in memory only, and the ring appears in a report.

## The log

Each line holds a timestamp, level (`info`, `warn` or `error`), area (`character`, `resolver`, `package`, `library`, `lut`, `eye-plate`, `preview`, `wolvenkit`, `server`, `page`, `notice`, `webgl`…), a stable code, one plain message, and optional details (a stack, codes, related references, where it was shown). Routine host events (preparation times, WolvenKit steps) are `info`. The dev server still prints them to its console, with terminal control characters shown as `?`.

Writing an entry never throws, since the failure hooks run inside other code's error handling: an entry that can't be redacted or written is replaced or skipped. The host also keeps its last 50 failures in memory apart from the log, so a flood of later entries can't push a failure out of its own report.

**Failures reach the log from:**

- **Host services**, through one line at each catch site, `hostFailure(area, code, message, error)`. This covers character-detail preparation, the resolver's extraction batches, the grading LUT, the 3D preview, the eye plate, Check and Build on both hosts, and the library and collection stores. Each server runs every request inside its log's context (`withRequestDiagnostics`, using `AsyncLocalStorage`), so work a request starts, such as a preparation's promise chain, still reaches that host's log.
- **The server wrapper.** An exception in any request becomes a logged failure and a plain 500 answer carrying its reference in `X-XFS-Error-Ref`. Any other 5xx API answer is logged with a reference too.
- **The page.** Uncaught errors, unhandled rejections, lost and restored WebGL contexts (reported by the scene host), failed actions and requests with unexpected codes, and app services' own failures (`pageFailure(area, code, message, error)`). These go to the host through `POST /api/diagnostics/entries`. The page records the same failure once every ten seconds, and a repeat shows the reference of the one recorded. Each forward holds at most 10 entries and 32 KB. The host keeps at most 60 page entries a minute and the same page entry once a minute, and counts the rest. An entry with another reference is not the same entry: the page showed that reference to someone, so a report for it must find it. An entry the host can't record is skipped rather than refused, and a forward the host refuses is dropped rather than resent; anything that couldn't be sent for another reason stays in the page's ring.

**Error references.** A failure a person sees gets a short reference such as `XF-7K3Q9P`: `XF-` and six Crockford base-32 characters (about a billion values; older four-character references still read). The notice shows it with a **Report this problem** button. When a failed host request gave a reference in the three seconds before, the notice reuses it, so the host's stack and the page's notice share one reference. A page failure with a reference of its own is linked to at most three host failures from the 15 seconds before it (`details.related`). Expected refusals, such as busy, out of range, cancelled or a library conflict, explain themselves and get no reference.

## The rolling detail window

XF Studio always keeps the last half hour of what it worked out. When something goes wrong, the report already holds the lead-up, so nobody has to switch anything on and make the problem happen again. The window records **references and decisions, never payloads**: resource paths and hashes, archive and mod names, request parameters, and outcomes. It never holds mesh, texture or file bytes.

| Event | Recorded by | Holds |
|---|---|---|
| `character/prepare` | The preparation service | The request (source, body, creator choices) and the installation summary (mounted archives, `.xl` files and their issues, read errors, mod order) |
| `character/resolved` | The preparation service | Every resolver decision for the V: each creator option's app, mesh, morph target and materials, the archive that won each and the ones it beat with the deciding rule, ArchiveXL overrides, patches, fixes and copies, dynamic-material expansions, gaps and ambiguities. Each distinct resource decision is written once in a `resources` table and referred to by its index. Material values that aren't resources are left out |
| `character/prepared` | The preparation service | The record, slot states, components with their winning archives, timings, load errors and ambiguities, and `dropped`: one plain line for each part left out and why |
| `wolvenkit/repair` | The game asset exporter | Each mesh sent through the export repair route: `repaired`, `not-applicable`, or `failed` with the step it stopped at (`serialize`, `deserialize`, `pack`, `uncook`); a failed one is also a warning in the log |
| `resolver/read`, `resolver/read_failed` | The resource graph | Every resource read with its winner (diagnostic mode only); every failed read (always) |
| `lut/prepared` | The grading-LUT host | The LUT's source and its winning archive |
| `*/failure` | `hostFailure` and page forwards | The failure's code and reference, beside the decisions that led to it |

The preparation service takes the window as an injected `DiagnosticTrace` (`trace` on `CharacterDetailHostOptions` and `PrepareCharacterOptions`) and hands it to the resource graph it resolves through (`ResourceGraph.trace`). Pure code never touches the file system for it. One event is at most 512 KB, and a larger one keeps only its keys. A V's resolution has its own bound of 2 MB; one still larger keeps its `resources` table. When a window holds no usable resolution, the report works from the preparation's parts and their winning archives instead.

The window's events are redacted as they are written, value by value, with the same folders and names as the log (below).

**Diagnostic mode** keeps three hours and up to 64 MB, and adds every resource read. A person switches it on from the report window or the command palette. It turns itself off after 24 hours.

## The report

**Report a problem** opens from a notice's button (with its reference), from Help, or from the command palette. The host builds the report on demand (`POST /api/diagnostics/report`), and the review screen shows it in groups, each expandable with its size and a preview of every part; **Show all of it** loads the whole of a long part (`POST /api/diagnostics/item`). **Always in the report** previews the file's `README.md` and `report.json` as they would be saved from the parts ticked now. The person's own description goes at the top. The host keeps a prepared report for an hour (at most three); saving one it no longer holds offers **Prepare again**.

| Group | Parts |
|---|---|
| About XF Studio and your system | Versions: XF Studio's version and commit, the OS, the host runtime, the WebView2 Runtime (desktop), the game's version, the WolvenKit version and source, and the framework versions. Setup choices: the launch route and options, with folders shown only as set or not set. This window: the browser, the GPU renderer string, WebGL2, and a few view settings |
| What happened | This problem: the log entries for the reference and those it links to, with stacks. The app log: the recent entries. Recent activity detail: the rolling window. Recent messages: the notices the person saw. Problems not yet in the log: the page's ring |
| Your mod setup | Mods involved (below). Frameworks and full mod list: the framework check and every mod the launch route has, enabled or not, by name and version. **Unticked by default**: it is personal, and the involved mods are enough to reproduce a problem |
| Resource details | Your V's latest preparation (the `resolved` and `prepared` events). Load-order winners: each resource with its winner, losers and rule. Resource tables: short extracts of the involved `.app`, `.ent`, `.mesh`, `.morphtarget`, `.mi` and `.mt` resources (appearance and material tables, at most 48 KB each and 480 KB together), read from XF Studio's own resolver cache. Parts of these come from mods' own files, and the review says so |
| Optional files (never ticked by default) | Every detail of the involved resources (at most 6 MB), and a small mod's own archives when XF Studio couldn't tell where it came from (below) |

**Actions:** **Save report…** makes one ZIP of the ticked parts: a `README.md` summary, a `report.json` index, and one file per part. The summary and the index are built from the ticked parts only: the versions only when "Versions" is ticked, the browser and graphics card only with "This window", the problem's log entries and stacks only with "This problem", the last log lines only with "App log". The index lists what was left out by its fixed IDs only (`mods`, `mod-file:0`), so an unticked mod's name never appears. It saves the way an exported collection does: the desktop window's download, or the browser's. **Copy summary** copies the readable summary. **Open a GitHub issue** opens a pre-filled new issue with the title and a short summary only, since the whole link stays under 6,000 characters, and asks the person to attach the saved file. The host always builds the link, redacting the title and summary with the configured folders the page doesn't know. On the desktop the host opens it in the person's browser; on the dev server it answers the link and the page opens it in a new tab. Nothing is uploaded by XF Studio. A report is limited to **20 MB**, under GitHub's 25 MB attachment limit, and the review shows the running total against that limit.

### Your mod setup, without the mods

Reports should let a developer rebuild the setup locally, not ship it. For every mod that supplied or lost a resource the V used, the report records:

- the mod's name and version;
- its source where the mod manager recorded one:
  - MO2's `meta.ini`: `modid`, `fileid`, `version`, `installationFile`, `repository`, `url`;
  - for a Vortex mod (named by `vortex.deployment.json` in the game folder, while the file there is still the one Vortex deployed: its modification time matches the manifest's): the Nexus mod ID, file ID and version Vortex keeps in its state, read without starting Vortex; when its state can't be read, the mod's staging folder name, whose Nexus mod ID is used only when the name follows Nexus's `<name>-<mod id>-<version>-<upload time>` download naming ([Vortex](../knowledge/vortex.md));
  - manual installs: nothing;
- each involved archive's file name, size, modification time, SHA-256, and how many resources it won and lost.

A mod with a Nexus Mods mod ID and file ID is **re-downloadable**: the identical file can be fetched and checked against its hash. One with only a mod ID or a page is **findable**. Anything else is **local only**.

**The game folder is not one mod.** The game's own archives (`content` and `ep1`) are one entry, "Cyberpunk 2077 (the game's own files)", identified by the game version: never looked for, never hashed. An archive Vortex deployed goes with its Vortex mod while it is still the file Vortex deployed; one replaced since, by hand or by another tool, is a game-folder entry of its own and never carries the Vortex mod's Nexus IDs. Every other archive in the game folder is its own entry ("hair.archive (in the game folder)"), since nothing records which mod put it there. On the Mod Organizer 2 route, an MO2 mod whose folder holds the archive stays an MO2 mod even when a leftover Vortex manifest names a Vortex mod of the same name. Archives in the game and manual folders are looked for only where the game loads them (`archive/pc/mod`, a level or two below it, and REDmod's `mods/<mod>/archives`), never by walking the whole folder; an MO2 mod's own folder is searched whole, within bounds.

**Identifying mods is bounded in time.** One 10-second budget covers reading Vortex's state (asynchronously, at most 512 MB, and kept for the next report while its files are unchanged) and hashing the involved archives, smallest first, while the review shows how far it is ("Fingerprinting the mod files involved (3 of 12)…", from `preparing` in `GET /api/diagnostics/state`). A hash still running when the budget ends stops there. Archives that don't fit, archives over 2 GB and anything beyond 6 GB in total are identified by size and date instead (`identifiedBy` says which). Those that didn't fit in time are hashed afterwards in the background, one at a time, so preparing the report again includes their hashes.

**Mod files are a last resort, never a default.** A report offers a mod's own archives (unticked) only when all of these hold:

- it is a mod folder the person installed (an MO2 mod or the manual mod folder), never files in the game folder;
- it is local only: XF Studio couldn't tell where it came from;
- its involved archives together are at most **5 MB**;
- the person confirms the sharing warning:

> Reports you attach on GitHub are public, and most mods' permissions don't allow re-uploading their files. Only include files of mods you made yourself, or whose permissions allow sharing them.

Until that confirmation is ticked, the files can't be included, and unticking it removes them again. The host checks it too: a save that includes mod files without the confirmation is refused. The files' names in the ZIP (`optional/mod-files/<mod>/<archive>`) are redacted like every other part. For mods that can't be shared, the resource extracts and the decision trace are the fallback, and they are usually enough.

## Privacy

- **Nothing is sent automatically.** The only network actions are the ones the person takes: saving a file, copying text, or opening the issue page, which carries only the title and short summary they can see.
- **Redaction** works in three passes:
  - **Known folders and names** the host names literally (`host-roots.ts`), in any slash direction, escaping, percent-encoding (a space also as `+`) or case: the person's profile folder becomes `%USERPROFILE%`, their OneDrive folders `%OneDrive%`, their account name `<user>` wherever it stands as a whole word, and the configured folders (game, MO2 and the MO2 instance's own mods, profiles, overwrite and downloads folders wherever they are, manual mods, data, tools, caches) labels such as `<game>` and `<mo2-mods>`. This catches what patterns can't see the end of, such as a profile name with spaces or an OneDrive folder named after an employer. In structured values, a key that is a plain identifier (`game`, `modName`) is never matched against the account name, so an account named like a common word leaves the value's shape alone; two keys that redact to the same text are both kept, the later one numbered.
  - **Save names:** Cyberpunk 2077 save names (`ManualSave-12`, the folder holding a `sav.dat`) become `<save>`.
  - **Profile folders, whole:** any other user-profile folder (`C:\Users\<name>`, `/mnt/c/Users/<name>`, `/Users/<name>`, `/home/<name>`, escaped or percent-encoded) loses its whole name up to the next separator, quote or line end, however many words it has and whatever it holds, parentheses included. Redaction may take a little more than the name, never less; shared profiles and placeholders (`Public`, `%USERNAME%`) stay.
  - **The shared patterns** in [`tools/private-data.json`](../tools/private-data.json), the same rules as the repository check, the site check and the packaged-app scan: user-profile folder names (including names of up to four words, and OneDrive-for-work folder names) become `<user>`, keeping the rest of the path; e-mail addresses become `<email>`. They are detectors, which must not flag ordinary prose, so they stop sooner than the pass before them.
- **Where redaction happens:** the log and the window are redacted as they are written, value by value (never as serialised text, which could break its escapes), with the person's folders and, once the diagnostics endpoint is up, the configured folders, so the files themselves are safe to attach. Every report part is redacted again, and the page's own parts, its facts, the description and the issue link's title and summary are redacted by the host with the configured folders before they reach the file or the browser. Tests feed every `userPath` and `email` vector through the log, the window, a report and its ZIP, and check that nothing the shared rules flag survives; others check that a configured folder, a spaced profile name and unticked parts never reach the ZIP.
- **Settings** appear only as set or not set. The MO2 profile's name is never recorded: the framework check's wording shows it as `<profile>` where it names the profile (in quotes, or as a folder in a path), never inside other words.
- The log never records collection content, recipes, file bytes, cookies or tokens. The resource extracts come from XF Studio's own cache of the game's resource tables, with every geometry, texture and buffer field left out.
- The desktop's startup "Copy diagnostics" text is redacted by the same rules, the person's own folders and account name included.
- The diagnostics endpoints accept writes only from the Studio page (same origin, JSON). On the desktop they are behind the session like every other route. The test hook `POST /api/diagnostics/test-failure` exists only when the dev server runs with `XFS_DIAGNOSTICS_TEST_HOOK=1`.
