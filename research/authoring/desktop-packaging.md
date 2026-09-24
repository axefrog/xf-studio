# XF Studio desktop, environment and installation architecture

Design checkpoint, 24 September 2026. This is an architecture proposal, not an implemented desktop release, installer or game deployment. The current localhost authoring app remains independently usable. The first target is Windows and eye-makeup export. Follow the maintained [architecture contract](architecture-contract.md), [package pipeline](studio-to-mod-pipeline.md) and [partial-export rule](partial-mod-export-checkpoint.md) when implementing this plan. No wrapper has been installed or selected for release.

This expands the earlier wrapper assessment into a release boundary and acceptance plan. Electron's bundled Chromium and process separation remain the fallback baseline ([official introduction](https://www.electronjs.org/docs/latest), [process model](https://www.electronjs.org/docs/latest/tutorial/process-model)). Bun's built-in [SQLite driver](https://bun.com/docs/runtime/sqlite) currently serves the local prototype. Neither choice entails rewriting the Three.js editor or placing wrapper APIs in its domain model.

## Decision and present boundary

Prefer a bounded **Electrobun 2.0.1 Windows/WebView2 trial** because it can keep a Bun main process and the existing Three.js view. Do not choose a public shell until the actual editor, library, package and update workload passes the decision gates below. Electron is the fallback if native WebView2, shell APIs, packaging or recovery fail those gates; switching shells must not change collection semantics, package eligibility or installation policy. The wrappers are adapters, not application architectures.

Today `server.ts` creates Bun SQLite libraries under `XFAS_DATA_DIR` or ignored `authoring/data/`. `package-server.ts` owns a same-origin, loopback-only request, but its default plate, WolvenKit and game paths are Nathan-specific and its command runs Python, Bun and WolvenKit from the HQ tree. It checks source and filtered collection hashes and the independent verifier before returning a candidate in ignored `dist`. The manifest schema is `xfs/local-package-1`, with `installed: false` and `gameRenderingVerified: false`; it lacks a complete compiler/toolchain lock. `catalog_readonly.py` is a research probe for MO2/direct physical candidates and selected hashes, not a production asset resolver or proof of a runtime winner. [Current implementation](../../projects/xf-appearance-studio/authoring/src/package-server.ts), [wrapper](../../projects/xf-appearance-studio/authoring/tools/build_collection_package.py), [catalog limits](../character-customization/catalog-prototype.md).

```mermaid
flowchart TB
  UI["Presentation: typed actions, snapshots, capabilities"] --> APP["Authoring and application services"]
  APP --> CORE["Recipes, collection, SQLite revisions, Undo"]
  APP --> PKG["Check / package-only filter / compiler / verified candidate"]
  APP --> ENV["Environment and source discovery"]
  ENV --> MO2["MO2 profile + overwrite adapter"]
  ENV --> DIRECT["Direct game archive/pc adapter"]
  ENV --> FUTURE["Future Vortex provider"]
  APP --> INSTALL["Install transaction + receipt"]
  INSTALL --> MO2TARGET["Dedicated MO2 mod target"]
  INSTALL --> GAMETARGET["Direct game archive/pc/mod target"]
  APP --> UPDATE["App update service"]
  SHELL["Desktop shell and device adapters"] -. "typed ports" .-> APP
  WEB["Localhost browser adapters"] -. "same typed ports" .-> APP
  PKG -. "verified files and manifest" .-> INSTALL
```

The application layer owns validation, readiness, async state, cancellation, install consent and recovery policy. The environment layer inventories candidates and their provenance; it does not decide how an authored recipe compiles. The package layer remains the only source of package eligibility, omissions, names and verification. The install layer accepts an immutable verified candidate and a separately validated target. Shell adapters own window, dialogs, privileged file operations and native update mechanics. Presentation cannot write game files, choose an executable path for a request, or infer readiness from labels. A desktop main process or local service must revalidate each typed request and bound every path; renderer compromise must not become arbitrary SQL, command execution or filesystem access.

## Typed local configuration and readiness

Keep configuration outside portable recipe/collection JSON and immutable SQLite look revisions. Introduce a versioned local settings document under the OS user-data directory, with atomic write, previous-good backup and explicit migrations. Retain current developer `XFAS_DATA_DIR` as an override only in localhost/development mode; desktop release paths come from its app identity and cannot silently point into the installed program directory. Settings types should include `gameRoot`, `launchRoute` (`direct` or `mo2`), optional `mo2Root` and profile ID, optional separate manual mod root, `plateInput`, `wolvenKitCli`, optional Python/Bun tool locations while legacy subprocesses exist, source-cache location/limit, target install mode, update channel and update-check preference. Defaults may be suggested from discovery; they are never baked Nathan paths. Store canonical paths and last validation metadata locally; redact paths from shared error reports and portable exports.

Secrets, if later required for account-backed downloads, belong in OS credential storage (Windows DPAPI/Credential Manager) with opaque references in settings. Existing locally protected Nexus material is not migrated into a recipe, manifest, release image or log. Neither MO2 installation nor direct game copying needs a Nexus key. Never make a credential a prerequisite for offline authoring or package Check.

Each setting is independently validated for existence, kind, access, expected executable identity/version and safe root relationship. Distinguish `unconfigured`, `discovering`, `ready`, `stale`, `unsupported-version`, `permission-denied` and `error`; publish a specific action-level disabled reason. Revalidate at operation time because a drive, profile or file may change after Settings was opened. Record exact detected versions and hashes separately: source checkout, installed CLI metadata and runtime game logs are different evidence. Profile `+` indicates intended activation, not effective archive ownership or a particular game launch.

Use a provider-neutral `SourceCandidate` record: virtual/depot path or hash, physical container, provider, selected route/profile, active state, priority evidence, size/hash, discovery timestamp and limitations. Resolve loose-file precedence, archive-index candidates and ArchiveXL transformations in distinct steps. A result reports `observed`, `source-derived`, `ambiguous` or `unknown` confidence and every relevant contender; only a game trace can upgrade a runtime-loaded claim. The first production adapters are game vanilla/manual `archive/pc/*` and MO2 profiles/mods/overwrite. A route choice excludes staged MO2 content in direct mode. Keep Vortex as a typed future adapter; do not fake its semantics with a directory scan. Cache by source fingerprints and invalidate on profile, modlist, archive, `.xl` or game-version changes. [Source design](../backlog/jewellery-and-customization.md), [catalog prototype](../character-customization/catalog-prototype.md).

Settings UI should group Game, Mod sources, Build tools and source plate, Installation and Desktop updates. Each row needs Browse/Detect, a precise validation result, provenance and a safe retry action. The export screen distinguishes Check readiness (no game/tool paths required), Build readiness and Install readiness; a partial export lists every omitted active layer/preset before the build. A tool version being present does not certify package compatibility. The Desktop updates group appears only when the shell provides an updater; localhost displays no dead update control.

## One authoring product, two hosts

Keep the independent localhost entry and its browser/loopback adapters. Desktop constructs the same trusted application services, file/package ports and `StudioPresentationPort`; it adds narrowly typed `Environment`, `Install` and `Update` capability/action ports. The UI can query them and handle unavailable results. No desktop import may enter recipe, compiler, library schema, package filter or Three renderer core. A shell does not need to expose the HTTP server publicly; if it reuses loopback transport, bind `127.0.0.1`, use a per-session capability token and origin validation, and close it at shutdown. Prefer direct typed IPC where shell maturity allows it. Desktop file dialogs yield vetted handles/paths to privileged adapters, never unrestricted renderer-supplied paths.

Both hosts must open/edit/Undo, persist workspace and SQLite revisions, import/export portable collections, Check and Build with the same collection snapshot and omission list. Localhost can configure paths and build when its external tools exist, but desktop-only installation/update features remain explicitly unavailable. Preserve verification mode (`?verify=1`) and never use Nathan's active draft as a packaging or UI acceptance fixture.

## Build, install and removal sequence

1. Finish a first release-safe authored eye-makeup mod: confirm eligible flat finishes, preserve every omission, pin compiler/tool versions, validate private plate provenance and full mesh/morph/pose gates. The current plate still has unresolved contact failures. Check and Build must agree on original/filtered hashes, IDs and omissions; a completely empty filtered package fails.
2. Build in a package-only copy and ignored intermediate directory. Run independent resource/mip/wiring/manifest verification; promote a unique immutable candidate with `.archive`, `.archive.xl` and manifest only on success. Never mutate SQLite revisions, draft recipes or authored collection; do not silently treat skipped layers as installed. Do not put private game-derived resources in a public release artifact.
3. Present target, source collection/revision or unsaved-snapshot hash, omitted details, expected files, versions, conflicts and backup plan. Require an explicit Install action for the selected target. An exported candidate remains useful without installation.
4. For MO2, create or update a dedicated XF Studio mod folder under the chosen MO2 instance; write into staging, verify hashes, then rename/swap atomically where possible. Keep a receipt with profile/target identity, before-state and files owned. Do not edit another mod or assert that changing `modlist.txt` proves a runtime winner. If activation is supported, make it a separate explicit step with MO2-compatible handling and a reversible backup; otherwise guide the user to enable the dedicated mod in MO2.
5. For direct install, stage only owned `.archive` and `.archive.xl` in the configured game's `archive/pc/mod` target; detect same-name files and refuse an unexplained overwrite. Hash/backup each replaced owned file, copy to temporary siblings, verify and swap, then record a receipt. Handle locked files, partial copy and crash recovery before showing success. The installer never guesses a game path from the current checkout.
6. Rollback restores only files this transaction changed, from verified backups, and records any conflict since install instead of overwriting a user's later edits. Uninstall removes only still-matching receipt-owned files; a missing or modified file is surfaced for review. Keep archive and `.xl` paired. Installation proof is file/hash state; activation is target/profile state; game registration, A/B/Off clearing, save identity and visual appearance require the prepared runtime session in [validation](../../docs/validation.md).

```mermaid
flowchart LR
  SNAP["Draft or exported collection snapshot"] --> CHECK["Shared validation + partial filter"]
  CHECK -->|"eligible"| BUILD["Isolated compile + resource build"]
  CHECK -->|"empty or invalid"| STOP["No package"]
  BUILD --> VERIFY["Independent verifier"]
  VERIFY -->|"pass"| CAND["Immutable local candidate + manifest"]
  VERIFY -->|"fail"| STOP
  CAND --> CHOOSE["Explicit target and conflict review"]
  CHOOSE --> STAGE["Stage + hash + backup"]
  STAGE --> SWAP["Commit paired archive / XL files"]
  SWAP --> RECEIPT["Install receipt + rollback/uninstall"]
  RECEIPT -. "separate game session" .-> RUNTIME["Runtime registration / rendering proof"]
```

An installation receipt is a private, versioned local record, not a claim in `xfs/local-package-1`; future manifests may cross-reference its ID but must keep build and install facts separate. Serialize one install per target and one package build per source workspace. Cancellation before swap removes staging; after swap it triggers rollback or a visible recoverable state. A crash journal is replayed on startup before another install.

## Shell choice, assets and distribution gates

[Electrobun v2.0.1](https://github.com/blackboardsh/electrobun/releases/tag/v2.0.1) is a trial target, not a proven Studio host. Its [Windows build configuration](https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/) offers native WebView2 by default and optional bundled CEF. WebView2 depends on the machine runtime; CEF gives a pinned browser at larger size. Benchmark both against the actual skinned/animated head, UV picking, 4K masks, saved-V assets, file dialogs, background conversion, close/restart and GPU failure. Measure installer/update size, cold start, memory, frame cadence and crash recovery on clean and modded Windows machines. Verify WebView2 runtime bootstrap/failure messages. Avoid broad `autoGrantPermissions` (applies to every native view origin). The [Updater API](https://framework.blackboard.sh/electrobun/apis/updater/) exists for Bun/Cottontail main processes, not the native main runtimes. Electron's [documented process model](https://www.electronjs.org/docs/latest/tutorial/process-model) and bundled Chromium provide the fallback if Electrobun fails a required gate; compare the same fixture and typed adapter behavior, not a toy window.

Before shipping, prove the packaged executable can open the SQLite library, migrate/back up data, spawn or replace every required build component and locate all static/runtime assets without developer source paths. Current Python/Bun/installed WolvenKit CLI chain is not assumed redistributable or present. Prefer a user-configured, version-checked external WolvenKit CLI for the first private build, then evaluate a legally reviewed bundling strategy. [WolvenKit 9.0.1](https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1) is the current official release while the measured builder uses CLI 8.17.4; move only after the full resource round-trip and verifier pass. Its repository is GPL-3.0; bundling it would require license/notice and integration review. The 9.0.1 release notes require .NET 10 runtime prerequisites. The official source checkout used for study is commit `11720772f1e20581301b3dec88a59f7b5ee05675`; local working-tree changes are irrelevant to this design and were not used. [Toolchain record](../../docs/toolchain.md), [WolvenKit source](https://github.com/WolvenKit/WolvenKit/tree/11720772f1e20581301b3dec88a59f7b5ee05675).

Ship no game-derived mesh/morph, extracted texture, private save, MO2 inventory, credential or user's SQLite database in the desktop installer or update. Define a first-run local asset intake and hash/provenance check; if required private inputs are absent, authoring and Check remain available while Build explains the missing prerequisite. Produce a release SBOM/notices from actual dependency artifacts. Electrobun's [MIT license](https://github.com/blackboardsh/electrobun/blob/main/LICENSE) requires retaining its copyright/license notice for copies. Review separately the licenses and redistribution terms of Bun/Cottontail, WebView2 bootstrap or CEF, Three, Python/.NET and WolvenKit, plus game/mod asset rights. Learning from a tool does not grant redistribution of its binaries or source.

## Consented desktop updates

Updater is a desktop shell capability only. Default to an explicit Check for updates action and an opt-in automatic check preference; never silently download or apply. The view reports current channel/version, available version, release notes, signed publisher, download size where known, and `checking`, `available`, `downloading`, `ready-to-restart`, `applying`, `recovered` or `error`. Download and apply require separate user actions; apply checks active edits/build/install transactions and persists/backs up user data before restart. An update changes app code and packaged assets, never user settings, source bindings, SQLite look history or installed game mod files as a hidden side effect.

The first update gate is a two-version trial: sign and install version A, exercise library/settings/source discovery and a staged package; publish version B to a test channel; check by consent, download by consent, inspect authenticity, restart/apply by consent, verify preserved settings/library and resumable or rolled-back install journal; simulate interrupted download, missing patch, failed replace, rollback and offline restart. Test an actual packaged canary/stable build because Electrobun's `dev` channel does not report updates. Its [update guide](https://framework.blackboard.sh/electrobun/guides/updates/) says static HTTPS hosting can serve full bundles and optional hash-routed delta patches, with full-bundle fallback. The hash routes patches; it is not code signing. The API describes transactional app replacement with previous-app restoration after a failed replacement, but Studio must still prove this with its own two-version test. Pin release base URL, app identity, channel, artifact retention and publisher identity; verify metadata/content authenticity under the selected signing scheme before enabling general distribution. Electrobun's [signing guide](https://framework.blackboard.sh/electrobun/guides/code-signing/) says Hutch does not currently sign Windows releases, so add a separate Windows Authenticode signing and verification stage or withhold automatic Windows update distribution. Prepare visible acknowledgements and third-party notices before publishing any release. No updater is installed or configured by this document.

## Acceptance matrix and forbidden coupling

| Gate | Minimum evidence |
| --- | --- |
| Host parity | Same fixture edits/Undo/reload/SQLite revisions/import/export and exact Check/Build identities/omissions in localhost and desktop; one source compiler/filter. |
| Settings | Fresh install, invalid/moved game, MO2 profile change, tool version mismatch, migration and restore from previous-good file; disabled reasons and no personal path in portable output. |
| Source provenance | MO2/direct route exclusion, disabled and competing files, overwrite, archive hash ambiguity, ArchiveXL merge limits, cache invalidation; no `+` to runtime-winner claim. |
| Package | Empty/invalid rejection, partial export disclosure, independent verifier failure blocking promotion, hash/identity match and private payload exclusion. |
| Installation | MO2 and direct staging, collisions, locked files, disk failure, crash journal, paired archive/XL rollback, altered-file uninstall refusal and receipt accuracy. |
| Shell | Real editor frame cadence, 4K preview memory/cancellation, file dialogs, SQLite durability, external-tool execution, WebView2 absent/CEF comparison, clean-machine startup. |
| Update | Signed A-to-B consent flow, offline/no update, delta/full fallback, interrupted download, failed replace restoration, data preservation and busy-transaction guard. |
| Runtime | Separate versioned game session proves selector registration, A/B/Off clearing, save identity, plate poses and material appearance; offline checks never fill this row. |

Forbidden dependencies: `recipe.ts`, `preset-collection.ts`, `preset-compiler.ts`, `package-filter.ts` and library models importing Electrobun/Electron, `process.env` installation paths, UI elements or source-provider rules; presentation reading mutable recipes, SQLite or filesystem; installer compiling or altering authoring data; settings changing package output without recorded tool/source fingerprints; update service writing mod target files; source discovery claiming executed ArchiveXL or game-loaded winners from physical inventory alone. Add typed actions/capabilities and boundary tests with each user-visible step, and record any unavoidable exception with owner and removal criterion in [UI boundary assessment](ui-architecture-boundary.md).

Documentation consistency: this proposal changes no recipe, compiler, manifest or promotion code, so the existing pipeline diagrams remain the current factual flow and need no new render checkpoint. On the first implementation change to that flow, update and visually review them under the [pipeline guide's maintenance rule](studio-to-mod-pipeline.md#maintenance-and-visual-review-record). The diagrams above describe planned boundaries, not present features.
