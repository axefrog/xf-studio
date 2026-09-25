# XF Studio desktop app (Electrobun, Windows)

The Windows desktop host for XF Studio. Alpha builds are published as **unsigned GitHub pre-releases** through a CI draft that a maintainer publishes by hand, with no update feed ([release decisions](../../../../research/authoring/desktop-release-decisions.md)). No release has been published yet. It wraps the shared Studio UI (first packaged from the committed Opus UI entry at `cec7089`) with Electrobun 2.0.1, a Bun main process and Windows WebView2. The independent localhost editor (`authoring/`, `bun start`) is unchanged and remains the primary development route. Follow the [desktop architecture](../../../../research/authoring/desktop-packaging.md) before expanding this host.

## Build and launch

From this directory, after `bun install --frozen-lockfile` in `authoring/` and here:

```powershell
bun run prepare:devkit  # once per clone: Hutch toolchain + SDK types the typecheck extends
bun run check        # TypeScript 5.9.3 --noEmit
bun test tests       # desktop host tests (also run by authoring `bun test`)
bun run build:dev    # prepare static view + build tools, then Electrobun dev build
bun run run:dev      # launch the dev build in a WebView2 window
```

**Last verified 25 September 2026:** 48 desktop tests pass; the desktop and authoring typechecks are clean; the full authoring `bun test` (which includes these tests) passes 476 with the private preview assets present. `tools/review-first-run.ts` and `tools/review-alpha-inventory.ts` pass against the prepared static view.

**Version.** `package.json` `version` (now `0.1.0-alpha.1`) is the only place the app version is set. `electrobun.config.ts` imports it, and `release.ts` derives the tag (`v0.1.0-alpha.1`), release title, asset name and changelog section from it. Change it together with the **Unreleased** section of the [changelog](../../CHANGELOG.md) when cutting a release.

**Release build.** `.github/workflows/desktop-release.yml` runs the same steps on a clean `windows-2025` runner. Pull requests build only, manual runs upload a 14-day artifact, and a matching `v*` tag creates a draft pre-release. `bun release.ts metadata|stage|notes` is the tooling it calls. Five authoring tests read ignored game-derived assets; CI skips them with `XFS_PRIVATE_ASSETS=absent` after proving the folder is absent. Never set that variable locally.

For an **unsigned Windows installer**, run `bun run build:canary` after the same frozen installs. It creates `artifacts/canary-win-x64-XFStudio-Setup-canary.zip` with the setup executable and its required hidden payload. `verify-canary.ts` checks the actual installer ZIP, update archive and packaged `version.json` against the pinned `dev.axefrog.xf-studio` identity, version `0.1.0`, canary channel and build hash; checks the nine-file Studio view allowlist (including `LICENSE.txt` and `THIRD_PARTY_NOTICES.md`, byte-compared with the repository's `LICENSE` and [third-party notices](../../THIRD_PARTY_NOTICES.md)) and the hashed build-tool manifest; requires the notices to name every shipped `bin/` program and the Bun, Electrobun and three.js versions actually built in (`notices.ts`); and refuses game assets, saved data and any unexpected update-feed URL. The archive and update JSON are local build byproducts only: CI never publishes them, and the packaged `baseUrl` must stay empty. `verify-canary.ts` uses Windows' own `tar.exe` (bsdtar), because a GNU `tar` earlier on `PATH` cannot read `.tar.zst` or ZIP. `build:dev` remains the faster source-run trial.

`prepare-static.ts` refuses to run without the top-level `LICENSE`, copies it and the third-party notices, copies the HTML/CSS, bundles `desktop-bootstrap.js` with the typed `LocalSetupActions` browser device, bundles `studio-main.ts` and `raster-worker.ts`, and bundles a separate Bun `check-worker.js`. Electrobun copies only those nine allowlisted files to `Resources/app/views/studio`; Bun main reads them from `PATHS.VIEWS_FOLDER`. `prepare-build-tools.ts` bundles the TypeScript package builder (`tools/build_collection_package.ts`, with its compiler, resource builder and independent verifier) into one asset-free `build-tools/app/tools/build.js`, with an integrity manifest (`xfs/desktop-build-tools-2`), as a host resource outside the served view. It contains no Python. Neither step copies `public/assets`, SQLite, credentials or game/mod files. `build/dev-win-x64/`, `artifacts/` and generated `static/` are ignored. The script fails if the shared Studio script tag changes, forcing review of this bootstrap.

## Current capabilities and limits

| Area | Works (evidence) | Still open |
|---|---|---|
| First run | A plain welcome: no 3D head preview in this alpha, the UV editor, library and Check work fully, Build needs a developer setup. **Start designing** stores the untouched Build setup through the validated `setup.save` action, so it does not return ([details](#community-first-run-25-september)) | Standard-user install, uninstall choices |
| Without preview assets | Full UV editor, Undo, autosave, SQLite library, mask PNG export and Check; head pane reports unavailable ([details](#uv-only-first-run-25-september)) | — |
| 3D preview | Not offered to community users. A developer-only five-file intake (enabled by a marker file) enables the head for maintainers ([details](#core-preview-intake-25-september)) | A 3D preview built from the user's own game files; general asset discovery and provenance |
| Check | Bounded worker, same filtered snapshot/identities as localhost ([details](#package-check-and-build)) | — |
| Build | Host-gated build with game and WolvenKit inputs; the eye plate is derived from the installed game and cached in user data. Exercised in an installed canary with the earlier private plate ([details](#installed-build-acceptance-25-september)). Without a complete Build setup every Build entry point shows one plain reason | Archive-byte reproducibility; a Build setup a community user can complete |
| Workspace persistence | Host-owned workspace file survives port changes, full restart ([details](#installed-webview-acceptance-and-restart-repair-25-september)) and native window close ([details](#desktop-close-flush-acceptance-25-september)) | Process kill, OS crash, power loss |
| Release | Version source, licence/tag/changelog gates, packaged and attached third-party notices, checksums, attestations and draft release in CI; clean-clone rehearsal passed locally | First GitHub run; signing |
| Updates | Disabled consent state machine and restart-save guard, tested with fake ports ([details](#updater-gate-25-september)) | Authenticated A→B feed, native apply, rollback |
| Game | Nothing installed into the game or MO2 by this host | All runtime rendering |

Disposable Windows installs have exercised the WebView editor, Build, restart and close persistence and quiet full-data uninstall. A published release, real updater, general asset resolution, standard-user installation, signing and game rendering remain unavailable or unproved.

## Host design

**Transport.** Main creates an ephemeral `127.0.0.1` server. An unguessable startup token establishes an HttpOnly, SameSite cookie. Every later request needs the cookie; writes need a matching `Origin`, or WebView2's browser-controlled `Sec-Fetch-Site: same-origin` plus a same-origin referrer. The latter is needed because this WebView2 build omitted `Origin` on same-origin JSON `fetch`; the adapter adds it **only after** validating those signals so existing SQLite/settings handlers keep their contract. No arbitrary command, SQL or filesystem action is offered to the view. `GET /api/desktop/capabilities` exposes a small typed, read-only record: exact packaged version/channel/build hash, private user-data path, WebView2, SQLite library support, asset readiness and package Check/Build support. Install and update remain unavailable. A development-only smoke report checks UI mount, WebGL2 and module-worker construction.

**User data.** `Utils.paths.userData` contains `library.sqlite`, `verification.sqlite`, `settings.json`, the host-owned `workspace.json` (or `verification-workspace.json` for `?verify=1`), an optional **private** `preview-assets/` directory and the private candidate store. The desktop host owns the same versioned `LocalSettingsStore` and narrow GET/PATCH/restore contract as localhost ([local settings](../LOCAL-SETTINGS.md)), rooted in this directory, and ignores developer `XFS_PACKAGE_*` overrides. Path edits keep revision guards and previous-good recovery; the renderer cannot select a settings-file path or escape the host-owned directory. The workspace file is validated, written atomically, and an unreadable prior file is preserved rather than silently replaced; the view shows a save failure.

**About.** Desktop-only. Reads the installed version and build hash from `Resources/version.json` through the host capability, and states in plain words whether the 3D preview is available, where the library and settings live, whether Check and Build are ready, and that automatic updates are off. **Licences** shows the packaged `LICENSE.txt` and `THIRD_PARTY_NOTICES.md`; **Build setup** opens the path form. Missing or invalid packaged metadata produces an explicit "reinstall to repair" state, never a guessed source version.

**Developer preview intake.** The five prepared preview files come from a maintainer pipeline that community users cannot run, so the host reports `previewIntake: false` and answers the intake endpoint with 404 unless an empty file named `developer-preview-intake` exists in the app's data folder (the path About shows). With it, **Enable 3D preview** and the intake dialog return exactly as before; `tools/review-ready-assets.ts` and `tools/review-first-run.ts` create the marker for their developer steps.

**Startup failures are never a blank window.** `main.ts` writes a bounded `desktop.log` in the data folder (version, WebView2 detection, loopback port, page load, bootstrap, smoke state, failures). `webview2.ts` follows Microsoft's documented registry check for the Evergreen runtime. If the WebView never requests the Studio page (5 s when no runtime is detected, otherwise 20 s), a native message explains it: without WebView2 it offers Microsoft's download page; otherwise it offers **Copy diagnostics**. Closing a window whose page never loaded closes at once instead of waiting for a workspace save. Inside the page, `boot-watchdog.js` is inlined as a classic script ahead of the module bootstrap: an uncaught script error before mount, or no mounted Studio after 30 s, replaces "Starting…" with a plain explanation, **Try again** and **Copy diagnostics**.

**Alpha wording.** User-facing reasons for things that are not in this alpha come from `src/alpha-availability.ts` (no 3D preview; Build needs a developer setup) and follow its jargon policy. Build readiness is part of the `package.build` file capability, so the command palette, header and Mod package panel all show the same reason.

### Package Check and Build

The desktop host runs the same TypeScript filter and 32-pixel compiler preflight as localhost without Python, WolvenKit, a source checkout or private game inputs. Validation, filtering and compilation run in a fresh Bun worker with a 15-second deadline; timeout, cancellation, malformed replies or worker failure return an error without a partial result, and only one Check runs at a time (a second receives a busy error). It returns the same retained preset identities, omissions and filtered SHA-256 as localhost for the shared partial-export fixture, and runs in the UV-only editor.

Build uses only the saved desktop settings for game and WolvenKit, plus an optional Bun executable; **it does not need Python**. A Python path saved by an earlier version is ignored. Before the builder starts, the host prepares the [built-in eye plate](../../../../research/authoring/studio-to-mod-pipeline.md#where-the-eye-plate-comes-from) from the configured game into `userData/plate-cache/` within the same Build deadline and cancellation; a missing or unsupported head resource ends Build with its explanation, and readiness shows it until the game's content archives change. Readiness probes run the configured WolvenKit CLI's `--version` and `--help` (8.17.4 or 9.0.1 must expose import, export, convert, pack and extract) and a small script through the selected Bun executable (or Electrobun's main executable when unset), with bounded timeouts; a failed probe retries after a short cache interval. The host also checks executable/resource signatures, bundle hashes and separation of writable user-data roots (including `plate-cache/`) from game, MO2 and tool roots. Requests contain only the collection. A Build uses private snapshot/work/staging roots, a 40-minute deadline, process-tree termination on timeout/cancel/shutdown, and the same partial filter, TypeScript resource builder and independent TypeScript verifier as localhost, run by Bun from the bundled `build.js`. The host gate checks source and filtered identities, omissions, exact archive/XL members, byte counts, hashes and realpath containment before moving the pair and manifest into the private candidate store. No install or launch is performed. Probes are a dependency gate; the verifier still decides whether a specific package is valid.

## Acceptance evidence

All trials below used disposable identities, touched no game or MO2 file, imported no private asset unless stated, and did not launch the game. Screenshots stay in ignored evidence.

### Community first run, 25 September

A clean data root opens a welcome instead of the path form. It says the 3D head preview isn't in this alpha (a preview from the user's own game files is planned), that the UV editor, library and Check work fully, and that building mod files still needs a developer setup. **Start designing** saves the untouched settings through the same revisioned `setup.save` action, so the welcome does not return; **Build setup** opens the form. A damaged settings file with a recoverable backup still opens Build setup for recovery. `tools/review-first-run.ts` (asset-free, isolated `?verify=1`) checks the welcome, the absent intake, the UV-only head reason, About wording and both Licences documents, then enables the developer marker and repeats the intake and Build setup checks. Screenshots were checked at 900×650.

### Community alpha control inventory, 25 September

`tools/review-alpha-inventory.ts` walks every reachable control of the desktop build as a community user (no preview files, no Build setup): the welcome, About, the overlay buttons, every command-palette entry, every control in every dock panel, the header and status bar, and the UV-map and layer-row context menus. It fails if any control is disabled without a visible reason or shows developer jargon. `tests/alpha-capability-reasons.test.ts` enforces the same rule for every catalogued target action and every head, camera, motion and saved-V action. The latest walk found 203 controls: 157 available, 46 unavailable with a reason, none silent.

| Area | Community user in this alpha | How it says so |
|---|---|---|
| Welcome, About, Licences, Build setup form | Works | — |
| Presets, layers, shape, pigment and edge, warp, colour, opacity, mirroring, Undo | Works | Situational limits explain themselves (for example "This layer is already at the front", "Select a warp control first") |
| Matte, Satin, Metallic finishes | Works and can be built | "Exports" / "Can be built" |
| Shimmer, Glitter, Glossy, Colour-shifting | Preview only; Build leaves them out | "Preview" tags, "(preview only)" in the palette, and Check/Build name each omitted layer |
| Library save/open/recover, collection and recipe import/export, mask export, compiler plan | Works | The compiler plan says it is "not a mod" |
| Check mod export | Works without game files | — |
| Build mod files (palette, header, panel) | Needs a developer setup | "Building mod files needs a developer setup in this alpha (game folder, WolvenKit and build tools). Check works without it." |
| Head pane, Front view, surface controls, wireframe, camera and light, motion and idle, eye optics, brows, lashes, hair, piercings, saved-V import and export | Not in this alpha (no 3D preview) | "The 3D head preview isn't available in this alpha. The UV editor, library and Check work fully." Invoking one by shortcut shows the same reason as an information toast |
| Preview quality | Works (sets the UV mask resolution) | — |
| Automatic updates | Off | About: "Automatic updates are off in this alpha. Download new versions from the XF Studio releases page on GitHub." |
| Installing into the game or a mod manager | Not offered | The Build result says nothing was installed |
| Legacy editor (`legacy.html`) | Not shipped in the desktop build | — |


### First-run path choice, 25 September

Superseded by the community welcome above. A clean data root opened Local setup before the optional 3D intake. Saving paths or choosing **Continue without paths** stores the validated settings through the same revisioned `setup.save` action; a saved or deferred setup no longer reopens the missing-assets intake on every launch, and **Enable 3D preview** stays available. A damaged primary settings file with a recoverable backup still opens recovery. An asset-free browser run verified the modal, skip, host persistence, reload, UV workflow and later intake; the first-run screenshot was checked at 900×650. The canary for this change was unsigned and uninstalled.

### UV-only first run, 25 September

Missing or incomplete core preview assets open the full Studio with a clearly unavailable head pane. The starter contour, shape edits and Undo, draft autosave, SQLite library, generated masks and PNG export, and collection-only Check work without a game asset; indicators say **UV masks ready**. Head, surface, camera, motion and saved-V actions report asset unavailability while stored camera and motion choices are kept. **Enable 3D preview** reopens the intake; a successful import reloads into the full head preview. Build keeps its own gates. `tools/review-first-run.ts` (asset-free, isolated `?verify=1`) and `tools/review-ready-assets.ts <prepared-folder>` regressions cover both paths; screenshots were checked at 900×650.

### Core preview intake, 25 September

The intake dialog accepts an absolute folder path (local or UNC; no native picker yet) to already prepared, user-owned outputs. The host reads only `head.glb`, `head-color.png`, `eye-color.png`, `head-normal.png` and `head-roughness.png`. It checks a bounded GLB v2 container whose semantic `head`, `makeup_plate` and `eyes` nodes reference meshes, and bounded square PNGs with valid chunk CRCs and 256–4096 px power-of-two sizes. The committed [output manifest](../evidence/asset-manifest.json) supplies optional known-hash diagnostics, not an eligibility condition. Inputs are copied through a temporary directory into `userData/preview-assets` and rechecked; symlinks are refused and an existing destination is never overwritten (repair or move an incomplete tree deliberately). The path is not persisted or logged. The renderer receives per-file statuses, never bytes or a general read/copy API; Inspect and Import require the authenticated session and same-origin write proof. Readiness is cached by file metadata stamps. Structural validity and hash agreement do **not** prove ownership, rights to distribute, effective game/mod winners or visual fidelity. The installer includes no game/mod bytes.

### Installed WebView acceptance and restart repair, 25 September

Two installed `dev.axefrog.xf-studio-ui-trial-*` canaries exercised the real WebView2 page through a temporary Chrome DevTools Protocol port. The first began asset-free: the head reported unavailable, the UV editor was ready and no head GLB was requested. A colour edit, Undo, second edit, SQLite Save, reload and Check succeeded; the private five-file intake then made head, UV and preview ready; Local setup was entered in the window; and **Build mod files → Build now** produced a one-preset, zero-omission candidate (manifest, 802,816-byte archive, ArchiveXL file) whose manifest hashes matched and whose post-Build Check reported the same snapshot hash.

That install exposed a restart fault: Electrobun assigns a new loopback port per launch, so origin-bound browser storage did not restore the workspace and startup appended a fresh starter preset. The host-owned workspace file above fixes this; a port-change regression test covers saved selection, normal/verification separation and corrupt-file preservation. The second canary (`sep25webview04`, build `2w9vje69xepb1`) proved the repair across full close/relaunch cycles: saved presets returned without duplication, an unsaved third preset and its selection were restored, and the private intake remained ready after restart. `tools/inspect-webview.ts` attaches only when the target identifies a disposable UI-trial data root; set the CDP port only on such a launch via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, never in a normal install.

### Installed Build acceptance, 25 September

Canary `sep25bld05` (build `iggpgiwpzwr0`) ran its authenticated host Build against the private plate/game/WolvenKit 9.0.1 inputs and the committed four-preset collection: four verified presets, 16 independently unpacked resources, no omissions, exactly `manifest.json`, an 847,872-byte `.archive` (SHA-256 `742b433061ee0bb1f9e74963b5f2b3efb9ada39efaf4c538ef6212133713f9d3`) and a 286-byte `.archive.xl` (SHA-256 `5789485c2578d5f990a5de6a1e6dc54f89727686f530055c5e4ccb920ae848cb`), and zero files left in work, snapshot and staging roots. Quiet app-only uninstall kept the candidate in that identity's user data.

WolvenKit 9.0.1 unbundled this, a preceding installed canary and the localhost archive for the same preset IDs/revisions (SHA-256 `8965de41a484b2bd853b6bb12dc78daf7ddead97b89742a4ff93039cd889fcb8`): all 16 resource paths and payload hashes matched. The archives differ in only 88 index bytes (index checksum and per-resource timestamps), so resource-level parity is observed but **archive-byte reproducibility is unproven**.

### Desktop close-flush acceptance, 25 September

Electrobun 2.0.1's cancellable `will-close` event now asks the page to capture the current draft synchronously, waits for its host POST and closes only after an authenticated same-origin acknowledgment with a live nonce. A failed save or ten-second timeout leaves the window open with a visible message and allows retry; no blocking unload handler is used. In installed canary `sep25close01` (build `26br23xts1fqp`), a delayed (2.5 s) >60 KB write kept the process alive until acknowledgment and a relaunch restored the latest preset and selection; a simulated HTTP 503 left the window open with an error, and retry then persisted. Its quiet full-data uninstaller removed the application, data and registration. Process termination, OS crash or power loss can still interrupt a write.

### Updater gate, 25 September

About shows the installed version, any checked available version and the update gate. The host accepts only Check, Download and Apply-and-restart, each with a separate consent event; a state-machine harness runs 0.1.0→0.2.0 against a fake Electrobun 2.0.1 port, and invalid metadata or unsigned configurations fail closed. Apply is reachable only after a host-confirmed workspace POST bound to a fresh nonce; a shared host gate blocks new Check/Build work during the handoff and refuses apply while package or install work is active, and a pending flush vetoes `before-quit`. The native updater is not connected to `main.ts`, the canary is unsigned with no feed, and the update API's bundle hash is not an authenticity signature. No update was downloaded or applied. The [signed A→B trial gate](../../../../research/authoring/desktop-update-ab-gate.md) lists the evidence required before integration.

### Canary artifact record

| Date | Change | Build | Setup ZIP SHA-256 | Installed? |
|---|---|---|---|---|
| 24 Sep | About unavailable state | `uszr34klsh5a` | `e720e0b1ed45634e9860c7109cbef43db164720d426c3758407df188431fa4c1` | No |
| 24 Sep | First-run form | `1lhsldp2qstkz` | `325b482c5a9c2c05cda5c8cb4e7e28469048fcf935b8ce6b2ab6b2b21e3427c3` | No |
| 25 Sep | Desktop Check | `1j6y17yujfhz4` | `93d185d920faa25e64b833ac2af197a0135854e33c7612738a318cb64b77f754` | No |
| 25 Sep | Integrated Check worker | `z444fj0jxrgi` | `fc3168fe61769bd6edf45e7c3608cc071bf87a88682e2bca3663dd21e8b91578` | No |
| 25 Sep | Core preview intake | `3626i2s6e2o22` | `e4dbb9d672fc7aa2466037d3f22e2467f9bf12d4160792cb4a0e2dd6f2e05959` | No |
| 25 Sep | Build adapter | `wtljn6ibxkjn` | `f3a7da72df9cbbc1d6c3d60eca88036c87fd2a9494e33de07fedd6f717605d0b` | No |
| 25 Sep | Installed Build | `iggpgiwpzwr0` | `b3ee9d095d51e9a5d990c98b12eaef38c789c3d454bc52d0a896e68567fcda2a` | Yes |
| 25 Sep | WebView restart repair | `2w9vje69xepb1` | `ee4106f53ee5bbb766b0b79711531819de3e5a4ee2cd68f18707f7999f9f6a38` | Yes |
| 25 Sep | Close flush | `26br23xts1fqp` | `44896ae13fb544723bb3868e52b5b8bfb0c3ec49794d25626705e2325b91543a` | Yes |

Each passed the view/tool allowlist and no-private-input gate. The 24 September setup executable reported `NotSigned`. Three builds of identical source reported the same bundle identity but different ZIP digests (tar entries carry build-time timestamps), so the gate is repeatable but **not byte-for-byte reproducible**.

## Build environment notes

`bunx electrobun@2.0.1` is a shim: it downloads the paired Hutch 0.24.3 from the Electrobun v2.0.1 GitHub release (SHA-256 checked against that release's index), and Hutch fetches the Electrobun core, a Cottontail runtime and a Bun toolchain into `HUTCH_HOME` (default `~/.hutch`). Set `HUTCH_HOME` to a scratch folder for a clean-machine build; CI uses a job-local one. The shim gives up on that index after 30 seconds. On a slow link it then falls back to a compatible global Hutch, and when it has to install one it **adds that Hutch's `bin` folder to the user PATH**. Remove the entry afterwards if the Hutch home was temporary. Which Hutch runs decides the bundled Cottontail: the paired 0.24.3 recorded Cottontail 0.5.0, while a build through a globally selected 0.26.0 recorded 0.6.0. `.hutch/dependencies.lock` (copied into `build-info.json` by `release.ts stage`) records what was used. A clean rehearsal (fresh shallow clone, empty Hutch home, no assets) passed on 25 September: devkit preparation took 130 s, mostly downloads, and `build:canary` took 31 s.

The dev bundle (`build/dev-win-x64/XFStudioDesktopSpike-dev`, from the package's original spike name) is neither signed nor an update candidate; it keeps its data under `%LOCALAPPDATA%/dev.axefrog.xf-studio-spike/dev/`, separate from the bundle. Its first smoke run reported `interactive; WebGL2=true; Worker=true`, and `missing-assets` with the head GLB held aside.

Installer trials so far ran from a sandboxed agent process whose `LOCALAPPDATA` had to be redirected to the sandbox's own LocalAppData before launch (otherwise setup reported `InvalidUninstallLocation`). This is a test-environment workaround, not standard-user evidence. Some disposable trial roots (`dev.axefrog.xf-studio-*-trial-*` under that redirected LocalAppData) and asset-free installer extractions (`xfs-*` folders under the Windows Temp directory) remain on the development machine because guarded recursive cleanup was refused by command policy; they contain no game assets, but the `sep25bld05` root holds a private candidate. Remove them deliberately.

## Clean-machine first run

### Windows Sandbox results, 25 September

Windows Sandbox (Windows 11 Enterprise 10.0.26100, networking off, elevated sandbox account) was enabled on the development machine and the kit now runs unattended: it dismisses the setup's final **Installation complete** window (Electrobun 2.0.1's `--quiet` applies to uninstall only and makes setup exit 1), restarts the app with a WebView2 debugging port, probes the loopback server, captures only the app or dialog window, copies `desktop.log` and shuts the sandbox down. `tools/sandbox-launch.ps1` starts it at a fixed 1600×1000 window. Results and screenshots stay in the ignored `artifacts/sandbox-trial/results/`.

| Run | Build | Observed |
|---|---|---|
| Before | `35yq1y2ht9yj1` | Checksum matched; setup needed a manual click on **Installation complete** (232 s); the app window stayed **blank white** on first run and relaunch, and closing it did not complete because the save handshake waited for a page that never loaded. |
| After, default sandbox | `38bs774jb4nrk` | No WebView2 Runtime anywhere in the sandbox (no Evergreen registry key in any of the three documented locations, no runtime folder). Install 14 s unattended; `desktop.log` shows the loopback server and window starting; after 5 s the app shows **"XF Studio needs the Microsoft Edge WebView2 Runtime"** with **Open the Microsoft download page**; closing works. |
| After, host runtime copied in | `15i95hcea5bi6` | A copy of the host's WebView2 153 runtime, given as a fixed-version runtime (with Microsoft's AppContainer read grants), still started no `msedgewebview2` process under Electrobun 2.0.1, and the app showed **"XF Studio couldn't show its window"** with **Copy diagnostics**. |

Root cause: the Windows Sandbox image does not include the WebView2 Runtime, which Electrobun's native renderer requires; the dev machine has it, so the app works there. The UV editor has **not yet been seen rendering inside the sandbox**. `bun tools/sandbox-trial.ts --install-webview2` turns sandbox networking on and installs Microsoft's signed Evergreen runtime with its official bootstrapper before the app, which is the remaining step to see the full first run there; it downloads that installer from Microsoft, so it runs only with the maintainer's go-ahead. The same packaged view renders the welcome and UV editor in the asset-free browser reviews above.

### Manual checklist

Windows Sandbox gives a disposable Windows session with no Studio data, Bun, WebView2 Runtime or developer paths; it is enabled on the development machine. `bun tools/sandbox-trial.ts [setup.zip]` prepares an ignored `artifacts/sandbox-trial/` kit and `tools/sandbox-launch.ps1` runs it unattended as described above. After a run with a WebView2 Runtime present, check by hand:

1. The welcome opens; **Start designing** reaches the Studio, and the head pane says the 3D head preview isn't available in this alpha.
2. Add a layer, edit its shape, Undo and Redo; save a preset to the library.
3. Run Check; it reports the collection without needing game files.
4. Close the window, reopen from the Start menu, and confirm that the preset and selection return and setup does not reappear.
5. About shows `0.1.0-alpha.1`, channel `canary` and the build hash from `build-info.json`.
6. Uninstall with the default **App** choice, and note what remains under `%LOCALAPPDATA%\dev.axefrog.xf-studio`.

Mapped files carry no Mark-of-the-Web, so SmartScreen will not appear; enable networking and download from the release page inside the sandbox to see it. The sandbox account does not prove standard-user behaviour, which still needs a non-administrator account.

## Icon and install behavior

The app icon is the XF Studio mark shared with the in-app brand chip, the site header and both favicons: a signal-yellow bevelled tile with a dark **XF**. `icon/icon.svg` is the master; `icon/icon-small.svg` is the same mark with heavier, wider-spaced strokes for 16 and 24 px. `bun icon/make-icon.ts` (from `desktop/`) renders transparent 16/24/32/48/64/128/256 PNGs with resvg and writes a 16/24/32/48/256 PNG-compressed `icon.ico`, which `build.win.icon` uses. All sizes were checked on dark and light backgrounds. Taskbar, title bar and Start menu appearance are reviewed in the installed canary.

Electrobun's [Windows distribution guide](https://framework.blackboard.sh/electrobun/guides/bundling-and-distribution/) documents the setup ZIP and hidden payload; its [uninstall guide](https://framework.blackboard.sh/electrobun/guides/uninstalling/) places the manager at `%LOCALAPPDATA%/<identifier>/<channel>/uninstall.exe`, and the [paths documentation](https://framework.blackboard.sh/electrobun/apis/paths/) locates writable data under `%LOCALAPPDATA%/<identifier>/<channel>/` (for the canary identity, `%LOCALAPPDATA%/dev.axefrog.xf-studio/canary/`). The default **App** uninstall preserves that data; **App and Data** removes it. Disposable identities have exercised quiet app-only uninstall with data retained and quiet `--delete-data` uninstall with roots removed. Interactive uninstall choices, app-only reinstall against retained data, unsigned update replacement and ordinary-user elevation remain unmeasured. Keep the release identifier stable; a future stable channel has its own root, and old `-spike` development data is not silently migrated.

## Next gates

The first GitHub workflow run; production asset provenance; clean standard-user install/reinstall and interactive uninstall choices; WebView2-missing bootstrap; GPU fallback and 4K memory/frame cadence in the packaged app; notices/licensing; signing ([options](../../../../research/authoring/desktop-release-decisions.md#signing-improvement-path)); an authenticated two-version feed proving consented check/download/apply, envelope verification, downgrade refusal, restart, rollback and library preservation before enabling updates; and a separate game session. The private plate and finish-export gates still apply. Do not treat an offline archive as game-tested.
