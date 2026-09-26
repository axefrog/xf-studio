# Diagnostics and problem reports

XF Studio traps its own errors, keeps a small private record of what it worked out, and helps a person file a useful bug report without shipping their mods. **Nothing is ever sent automatically.** A report is prepared for review, and the person saves it and attaches it themselves.

Code: [`projects/xf-studio/authoring/src/diagnostics/`](../projects/xf-studio/authoring/src/diagnostics/). Tests: [`tests/diagnostics.test.ts`](../projects/xf-studio/authoring/tests/diagnostics.test.ts). The typed actions are in the [action catalogue](../research/authoring/ui-action-catalogue.md#diagnostics-and-problem-reports).

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

The page keeps a ring of at most 50 entries it couldn't send to its host. The ring lives in memory only and appears in a report.

## The log

Each line holds a timestamp, level (`info`, `warn` or `error`), area (`character`, `resolver`, `package`, `library`, `lut`, `eye-plate`, `preview`, `wolvenkit`, `server`, `page`, `notice`, `webgl`…), a stable code, one plain message, and optional details (a stack, codes, related references, where it was shown). Routine host events (preparation times, WolvenKit steps) are `info`. The dev server still prints them to its console.

**Failures reach the log from:**

- **Host services**, through one line at each catch site, `hostFailure(area, code, message, error)`. This covers character-detail preparation, the resolver's extraction batches, the grading LUT, the 3D preview, the eye plate, Check and Build on both hosts, and the library and collection stores. Each server runs every request inside its log's context (`withRequestDiagnostics`, using `AsyncLocalStorage`), so work a request starts, such as a preparation's promise chain, still reaches that host's log.
- **The server wrapper.** An exception in any request becomes a logged failure and a plain 500 answer carrying its reference in `X-XFS-Error-Ref`. Any other 5xx API answer is logged with a reference too.
- **The page.** Uncaught errors, unhandled rejections, lost and restored WebGL contexts (reported by the scene host), failed actions and requests with unexpected codes, and app services' own failures (`pageFailure(area, code, message, error)`). These go to the host through `POST /api/diagnostics/entries`. Each forward holds at most 10 entries and 32 KB, the host keeps at most 60 page entries a minute and counts the rest, and anything that can't be sent stays in the page's ring.

**Error references.** A failure a person sees gets a short reference such as `XF-7K3Q`: `XF-` and four Crockford base-32 characters. The notice shows it with a **Report this problem** button. When a failed host request gave a reference moments before, the notice reuses it, so the host's stack and the page's notice share one reference. The host also links a page notice to host failures from the previous two minutes (`details.related`). Expected refusals, such as busy, out of range, cancelled or a library conflict, explain themselves and get no reference.

## The rolling detail window

XF Studio always keeps the last half hour of what it worked out. When something goes wrong, the report already holds the lead-up, so nobody has to switch anything on and make the problem happen again. The window records **references and decisions, never payloads**: resource paths and hashes, archive and mod names, request parameters, and outcomes. It never holds mesh, texture or file bytes.

| Event | Recorded by | Holds |
|---|---|---|
| `character/prepare` | The preparation service | The request (source, body, creator choices) and the installation summary (mounted archives, `.xl` files and their issues, read errors, mod order) |
| `character/resolved` | The preparation service | Every resolver decision for the V: each creator option's app, mesh, morph target and materials, the archive that won each and the ones it beat with the deciding rule, ArchiveXL overrides, patches, fixes and copies, dynamic-material expansions, gaps and ambiguities. Material values that aren't resources are left out |
| `character/prepared` | The preparation service | The record, slot states, components with their winning archives, timings, load errors and ambiguities |
| `resolver/read`, `resolver/read_failed` | The resource graph | Every resource read with its winner (diagnostic mode only); every failed read (always) |
| `lut/prepared` | The grading-LUT host | The LUT's source and its winning archive |
| `*/failure` | `hostFailure` and page forwards | The failure's code and reference, beside the decisions that led to it |

The resolver and the preparation service take the window as an injected `DiagnosticTrace` (`trace` on `CharacterDetailHostOptions` and `PrepareCharacterOptions`, and `ResourceGraph.trace`). Pure code never touches the file system for it. One event is at most 512 KB, and a larger one keeps only its keys.

**Diagnostic mode** keeps three hours and up to 64 MB, and adds every resource read. A person switches it on from the report window or the command palette. It turns itself off after 24 hours.

## The report

**Report a problem** opens from a notice's button (with its reference), from Help, or from the command palette. The host builds the report on demand (`POST /api/diagnostics/report`), and the review screen shows it in groups, each expandable with its size and a preview of every part. The person's own description goes at the top.

| Group | Parts |
|---|---|
| About XF Studio and your system | Versions: XF Studio's version and commit, the OS, the host runtime, the WebView2 Runtime (desktop), the game's version, the WolvenKit version and source, and the framework versions. Setup choices: the launch route and options, with folders shown only as set or not set. This window: the browser, the GPU renderer string, WebGL2, and a few view settings |
| What happened | This problem: the log entries for the reference and those it links to, with stacks. The app log: the recent entries. Recent activity detail: the rolling window. Recent messages: the notices the person saw. Problems not yet in the log: the page's ring |
| Your mod setup | Mods involved (below). Frameworks and mod list: the framework check and the launch route's mod list by name and version |
| Resource details | Your V's latest preparation (the `resolved` and `prepared` events). Load-order winners: each resource with its winner, losers and rule. Resource tables: short extracts of the involved `.app`, `.ent`, `.mesh`, `.morphtarget`, `.mi` and `.mt` resources (appearance and material tables, at most 48 KB each and 480 KB together), read from XF Studio's own resolver cache |
| Optional files (never ticked by default) | Full JSON of the involved resources (at most 6 MB), and a small local-only mod's own archives (below) |

**Actions:** **Save report…** makes one ZIP of the ticked parts: a `README.md` summary, a `report.json` index, and one file per part. It saves the way an exported collection does: the desktop window's download, or the browser's. **Copy summary** copies the readable summary. **Open a GitHub issue** opens a pre-filled new issue with the title and a short summary only, since the whole link stays under 6,000 characters, and asks the person to attach the saved file. On the desktop the host opens the page in the person's browser; in a browser it opens a new tab. Nothing is uploaded by XF Studio. A report is limited to **20 MB**, under GitHub's 25 MB attachment limit, and the review shows the running total against that limit.

### Your mod setup, without the mods

Reports should let a developer rebuild the setup locally, not ship it. For every mod that supplied or lost a resource the V used, the report records:

- the mod's name and version;
- its source where the mod manager recorded one:
  - MO2's `meta.ini`: `modid`, `fileid`, `version`, `installationFile`, `repository`, `url`;
  - for a Vortex mod (named by `vortex.deployment.json` in the game folder): the Nexus mod ID, file ID and version Vortex keeps in its state, read without starting Vortex; when its state can't be read, the mod's staging folder name, whose Nexus mod ID is used only when the name follows Nexus's `<name>-<mod id>-<version>-<upload time>` download naming ([Vortex](../knowledge/vortex.md));
  - manual installs: nothing;
- each involved archive's file name, size, modification time, SHA-256, and how many resources it won and lost.

A mod with a Nexus Mods mod ID and file ID is **re-downloadable**: the identical file can be fetched and checked against its hash. One with only a mod ID or a page is **findable**. Anything else is **local only**. The game's own archives are identified by the game version and never hashed. Archives over 2 GB, or beyond 6 GB in total, are identified by size and date instead of a hash.

**Mod files are a last resort, never a default.** A report offers a mod's own archives (unticked) only when all of these hold:

- it is local only, with no download source;
- its involved archives together are at most **5 MB**;
- the person confirms the sharing warning:

> Reports you attach on GitHub are public, and most mods' permissions don't allow re-uploading their files. Only include files of mods you made yourself, or whose permissions allow sharing them.

Until that confirmation is ticked, the files can't be included, and unticking it removes them again. For mods that can't be shared, the resource extracts and the decision trace are the fallback, and they are usually enough.

## Privacy

- **Nothing is sent automatically.** The only network actions are the ones the person takes: saving a file, copying text, or opening the issue page, which carries only the title and short summary they can see.
- **Redaction** uses the repository's shared patterns in [`tools/private-data.json`](../tools/private-data.json), the same rules as the repository check, the site check and the packaged-app scan:
  - user-profile folder names become `<user>`, keeping the rest of the path;
  - e-mail addresses become `<email>`;
  - Cyberpunk 2077 save names (`ManualSave-12`, the folder holding a `sav.dat`) become `<save>`;
  - in a report, the configured folders (game, MO2, manual mods, data, tools, caches) become labels such as `<game>` and `<mo2>`, in any slash direction, escaping or case.
- **Where redaction happens:** the log and the window are redacted as they are written, so the files themselves are safe to attach. Every report part is redacted again with the configured folders, and the page's own parts are redacted by the host before they reach the file. Tests feed every `userPath` and `email` vector through the log, the window, a report and its ZIP, and check that nothing the shared rules flag survives.
- **Settings** appear only as set or not set; MO2 profile names are not recorded.
- The log never records collection content, recipes, file bytes, cookies or tokens. The resource extracts come from XF Studio's own cache of the game's resource tables, with every geometry, texture and buffer field left out.
- The desktop's startup "Copy diagnostics" text is redacted by the same rules.
- The diagnostics endpoints accept writes only from the Studio page (same origin, JSON). On the desktop they are behind the session like every other route. The test hook `POST /api/diagnostics/test-failure` exists only when the dev server runs with `XFS_DIAGNOSTICS_TEST_HOOK=1`.
