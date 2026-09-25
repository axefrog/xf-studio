# XF Studio desktop release decisions

Decided 25 September 2026. The maintainer set the direction and delegated the details. This record holds the decisions, how the pipeline carries them out, the improvement path, and the few questions still open. Architecture and acceptance gates: [desktop packaging](desktop-packaging.md). Updater gate: [A→B plan](desktop-update-ab-gate.md). Build details: [desktop README](../../projects/xf-studio/authoring/desktop/README.md).

## Decisions

| Topic | Decision |
|---|---|
| Channel | **GitHub Releases** on `axefrog/xf-studio`. Every alpha is marked **pre-release**. Channels run alpha → beta → stable later. |
| Versioning | SemVer with a pre-release suffix. Tags are `v0.MINOR.PATCH-alpha.N` (first: `v0.1.0-alpha.1`) and titles read “XF Studio 0.1.0 alpha 1”. The app version is independent of recipe, collection, library and manifest schema versions. |
| Version source | `projects/xf-studio/authoring/desktop/package.json` `version` only. `electrobun.config.ts` imports it, so packaged `version.json`, About, the canary gate, the tag check, the title and the asset name all derive from it. CI fails if a pushed tag is not exactly `v` + that version. |
| Signing | Alphas ship **unsigned**. Instead: SmartScreen guidance on the site and in every release body, SHA-256 checksums for every asset, and GitHub build-provenance attestations. Signing is the improvement path below, not a blocker. |
| Publication | CI creates a **draft** release only. A person reviews and publishes it. Agents never push tags, create releases or publish. |
| Changelog | `projects/xf-studio/CHANGELOG.md`, hand-curated and user-facing, newest first. Each version has exactly **New and improved** and **Fixes and under the hood**. Changes are added under **Unreleased** as they land. The release job copies the tagged version's section into the release body and fails if it is missing, empty or malformed. Auto-generated commit lists are not the notes; only a “full commit list” link is appended. No personal names; name the in-game mod **XF Eye Artistry**. |
| Updates | The in-app updater stays **disabled** in this pass. Users update by downloading the next release. See [Updater](#updater-github-feed-and-authenticity). |
| Site | The `#download` section is driven by `site.config.json`. It stays in the honest “nothing to download yet” state until the first draft is published, then switches to `releaseStatus: "prerelease"` with the tag and title. |

## Release pipeline

Workflow: [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml). Tooling: `desktop/release.ts` (tests in `desktop/tests/release.test.ts`).

| Trigger | What runs | Output |
|---|---|---|
| Pull request touching `desktop/`, the changelog or the workflow | Metadata, private-input refusal, install, Electrobun toolchain/devkit, both typechecks, the full authoring suite (including desktop tests), `build:canary` with `verify-canary.ts`, staging | Nothing uploaded |
| Manual run (`workflow_dispatch`) | Same | 14-day workflow artifact: setup ZIP, `build-info.json`, `SHA256SUMS.txt` |
| Pushed `v*` tag | Same, plus: tag equals the version and the changelog section is complete; then a separate job checks the tag is on `main` and has no existing release, re-verifies the checksums after transfer, composes the notes, attests the ZIP and `build-info.json`, and creates the draft | Draft GitHub release (pre-release for `-alpha`/`-beta`/`-rc`) |

Gates and properties:

- The build job has `contents: read` only. The release job alone gets `contents: write`, `id-token: write` and `attestations: write`, on an Ubuntu runner, and only for tag pushes.
- Every action is pinned by commit SHA, with its version in a comment: checkout v7.0.1, setup-bun v2.2.0, upload-artifact v7.0.1, download-artifact v8.0.1, attest-build-provenance v4.2.2. Bun is 1.4.2.
- **Private inputs.** `public/assets` must be absent and no asset, SQLite, `.glb`, `.blend`, `.sav`, `.archive` or `.xl` file may be tracked under `authoring/`. `verify-canary.ts` then checks the actual update archive and setup ZIP: a ten-file view allowlist that includes the byte-identical `LICENSE.txt` and `THIRD_PARTY_NOTICES.md`, notices that name every shipped `bin/` program and the Bun, Electrobun and three.js versions actually built in, hashed build tools, no data or asset paths, a content scan of every packaged text file (`package-content-scan.ts`, with patterns shared with the repository check in `tools/private-data.json`) that refuses user-profile paths (Windows in any spelling, WSL, macOS and Linux) and email addresses outside the licence and notices (findings are redacted, because the run log is public), pinned identity/version/channel, and an **empty** update `baseUrl`. Five authoring tests read game-derived preview assets; they skip only because CI sets `XFS_PRIVATE_ASSETS=absent` after proving the folder is missing. Locally they still fail loudly.
- **Toolchain.** `HUTCH_HOME` is job-local. The Electrobun npm shim downloads its paired Hutch 0.24.3 (SHA-256 checked against the Electrobun release index), and Hutch fetches Electrobun 2.0.1 core, Cottontail and a Bun toolchain. Their versions and archive hashes are recorded in `build-info.json` (`toolchain`). CRLF conversion is disabled before checkout.
- **Licence gate.** `prepare-static.ts` (every build) and `release.ts` (tag metadata, staging and notes) refuse to run without a non-empty top-level `LICENSE`.
- **Release assets:** `XFStudio-<version>-win-x64-setup.zip` (the Electrobun setup ZIP, renamed), `build-info.json` (commit, version, Electrobun build hash, toolchain, `signed: false`, `updater: "disabled"`, `includesGameAssets: false`), `THIRD_PARTY_NOTICES.md` and `SHA256SUMS.txt`; the first three carry attestations. The update archive and `update.json` are **not** published, so no release can serve as an accidental update feed.
- **Release body:** the changelog section, an alpha warning, install steps with SmartScreen guidance and plain first-run notes (the 3D preview and Build use WolvenKit, which XF Studio offers to download, and Microsoft's .NET 10 Runtime), the MIT licence and notices, a checksum table plus the PowerShell command, the `gh attestation verify <file> --repo axefrog/xf-studio` command, and a commit-list link.

**Verified so far.** Unit tests cover the version, tag, changelog, staging and notes rules. A PowerShell rehearsal of the build job ran in a fresh shallow clone with an empty Hutch home and no assets: installs, devkit preparation (130 s, mostly downloads), both typechecks, `bun test` (455 pass, 5 private-asset skips, before the later XF Eye Artistry merge), `build:canary` with the allowlist gate (31 s) and staging all passed, producing a 35.4 MB setup ZIP for `0.1.0-alpha.1`. **First GitHub run.** The first manual run on `windows-2025` failed at the Test step: one exhaustive flake-study test took 5.1 s against Bun's 5 s default test timeout (about 2 s locally). Tests that take about a second or more locally now carry explicit, commented timeouts. The workflow's first complete run is **pending a rerun** after that fix merges, and remains the real CI proof. The content scan found nothing in the three canary archives built locally on 25 September (16 text files and 2.6 MB each, including the Electrobun host scripts) and caught a planted user path. Two local findings:

- On this network the paired-Hutch index download exceeded the shim's 30-second limit and Hutch fell back to a newly installed global copy. That fallback **adds its bin folder to the user PATH** (it did so for the scratch rehearsal, and the entry was removed afterwards). This is harmless on ephemeral runners but worth knowing for local clean builds.
- Toolchain selection is not fully pinned by the repository: a build started through a globally selected Hutch 0.26.0 recorded Cottontail 0.6.0, while the paired 0.24.3 path used 0.5.0. CI always starts from an empty Hutch home, and `build-info.json` records which one was used.

Builds are repeatable but **not byte-reproducible**, because Electrobun's archives carry build-time timestamps. Attestations and checksums prove origin and integrity; they do not prove reproducibility.

### Cutting a release

1. Set `version` in `desktop/package.json` and rename **Unreleased** in the changelog to that version, with a new empty **Unreleased** above it. Merge to `main`.
2. On the development machine, run `XFS_REQUIRE_ORACLES=1 bun test` in `projects/xf-studio/authoring` with the Python oracle, game and resolver variables set ([authoring checks](../../projects/xf-studio/authoring/README.md#checks)). Public CI skips those tests; in this mode a missing prerequisite fails instead of skipping.
3. Optionally run the workflow manually on `main` and try the artifact.
4. Tag the merged commit (`git tag v0.1.0-alpha.1 <sha>`) and push the tag. CI creates the draft.
5. Review the draft (body, assets, checksums, attestations), then **publish by hand**.
6. Set `releaseStatus: "prerelease"` and `release: { "tag": "v0.1.0-alpha.1", "title": "XF Studio 0.1.0 alpha 1" }` in `site.config.json`, run `bun run verify` and `bun run qa`, and merge. The Pages workflow deploys it.

A mistaken tag fails before any release exists. A bad draft is deleted by hand and the version bumped; published tags are never reused.

### Implications to keep in view

- **Channel data roots.** Electrobun 2.0.1 knows only `dev`, `canary` and `stable`. Alphas and betas build as `canary`, so the setup is named `XF Studio-Setup-canary.exe` and user data lives under `%LOCALAPPDATA%\dev.axefrog.xf-studio\canary\`. A later `stable` build gets a **separate** root, and alpha libraries will not appear there automatically. Before the first stable release, add an explicit, tested import or migration (portable collection export already works as a manual path). Keep the identifier `dev.axefrog.xf-studio` fixed.
- **Artifacts are semi-public.** On a public repository, anyone signed in to GitHub can download workflow artifacts. Manual-run artifacts are therefore effectively unsigned preview builds for 14 days; pull-request runs upload nothing.
- **Install over an older version is unmeasured.** The first alpha's notes say so and recommend exporting looks first.

## Signing improvement path

Researched 25 September 2026. Prices and eligibility change; re-check them before applying.

| Option | Cost | Shown publisher | SmartScreen | Fit |
|---|---|---|---|---|
| Unsigned (current) | Free | “Unknown publisher” | Warns on every new file hash; reputation per hash restarts with each version | Works now. Smart App Control blocks it outright on machines where SAC is on. |
| [SignPath Foundation](https://signpath.org/terms.html) | Free for qualifying open source | **SignPath Foundation**, not the maintainer | Reputation accrues to that certificate | Needs an OSI licence with no proprietary parts, an already released product, a published code-signing policy with the Foundation's credit line, MFA, Author/Reviewer/Approver roles with **manual approval per release**, and builds on GitHub-hosted runners submitted with `signpath/github-action-submit-signing-request@v3`. The terms page is marked as a draft; the application form could not be inspected. |
| [Azure Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) (formerly Trusted Signing) | About $9.99/month (Basic) | The validated individual or organisation | No instant reputation; it accrues to a stable identity | Individual identity validation is documented for **US and Canada only**, and a Microsoft Q&A answer says individual onboarding is paused. `azure/artifact-signing-action@v2` runs on Windows runners with OIDC. Certificates last 72 hours, so timestamping is mandatory. |
| Certum Open Source certificate | About €49 cloud (SimplySign) or €69 with card | Maintainer's name | Reputation accrues | Hardware-backed key since the June 2023 CA/B rules. Cloud signing through SimplySign is hard to automate in CI, and whether the 459-day validity cap covers this product is unconfirmed. |
| OV or EV certificate (Sectigo, SSL.com, DigiCert) with cloud HSM | OV about $130–300/year; SSL.com eSigner from $20/month for 20 signatures | Maintainer or company | EV no longer gives instant reputation (since 2024) | Validity is now at most 460 days (CA/B ballot CSC-31, from 1 March 2026). |

**Recommendation.** Publish the first unsigned alphas, then apply to **SignPath Foundation**, which costs nothing and fits a GitHub-built open-source project. The prerequisites are a repository licence (see the open questions) and a short code-signing policy page on the site. Use Azure Artifact Signing instead only if the maintainer is eligible (US/Canada individual, or a qualifying organisation) and prefers their own name as publisher; the Certum open-source certificate is the low-cost fallback if both fail. Once a stable publisher identity signs every build, SmartScreen reputation carries over between versions.

**Technical caveat for any signing route.** Electrobun 2.0.1 does not sign Windows output. The setup ZIP contains `XF Studio-Setup-canary.exe` plus a `.tar.zst` payload holding the unsigned `launcher.exe`, `bun.exe` and native DLLs. Signing only the outer setup removes the installer warning but leaves the installed binaries unsigned, which Smart App Control can still block. Signing the inner binaries needs the `postWrap` hook (which receives `ELECTROBUN_WRAPPER_BUNDLE_PATH`) to sign them before compression, then a second step for the setup executable. That fits a synchronous signer such as Azure or a cloud-HSM `signtool` in the same job. SignPath signs asynchronously outside the job, so it would need the build split around that hook, or SignPath's support for signing files nested in the payload. Prove either with a disposable identity before relying on it.

### SignPath application preparation

- An OSI licence file at the repository root, with notices for bundled third-party components (below).
- A code-signing policy page on the site: which builds are signed, the roles, the manual approval step and the Foundation's required credit line.
- MFA on GitHub and SignPath. Assign Author, Reviewer and Approver; whether one maintainer may hold all three is unconfirmed, so ask SignPath.
- The workflow already builds on GitHub-hosted runners and uploads with `actions/upload-artifact`. A signing job would submit that artifact with `signpath/github-action-submit-signing-request@v3` before the draft release step.
- A published, unsigned alpha whose download page describes its functionality (the site's `#download` section).

## Updater: GitHub feed and authenticity

These findings come from Electrobun 2.0.1's `Updater.ts` and the [updates guide](https://framework.blackboard.sh/electrobun/guides/updates/).

- **Feed shape.** The app fetches `<baseUrl>/<channel>-win-x64-update.json?<random>`, then `<baseUrl>/<artifact>.tar.zst`, or `<baseUrl>/<prefix>-<hash>.patch` files chained from the installed hash. `baseUrl` is baked into version A at build time. The manifest must match the installed identifier, channel, OS and architecture.
- **GitHub Releases as the host.** The guide names `https://github.com/<owner>/<repo>/releases/latest/download` as a base URL, but `/latest` **excludes pre-releases**, so it cannot serve alpha builds. Workable alternatives:
  - a dedicated rolling release (for example tag `feed-canary`) whose assets are replaced with each version, carrying `update.json`, the full archive and patches;
  - a separate static host.

  GitHub Pages is already used by the site, whose content policy forbids archives.
- **Authenticity.** None beyond HTTPS. The guide calls the bundle hash a routing identifier, not authentication. The updater also treats **any different hash** as an update, with no version comparison, so a replaced feed could push a downgrade.
- **Proposed safe design (not implemented).**
  1. CI signs a small release envelope with an Ed25519 key held as a protected GitHub environment secret. The envelope contains identifier, channel, version, Electrobun hash, the SHA-256 of the full `.tar.zst`, and the SHA-256 of the decompressed tar.
  2. The public key is embedded in the app at build time.
  3. After Electrobun's `downloadUpdate()`, and before `applyUpdate()`, the Studio host verifies the envelope and requires a strictly newer SemVer. It then hashes the retained `self-extraction/<hash>.tar`, the exact file that 2.0.1's prepared-update record requires for apply. Any mismatch refuses the update.

  This covers delta-patch output too. The remaining exposure is a local attacker who can already write to the user profile. Key compromise would allow malicious updates to every install, so the key needs an environment with required reviewers, and a rotation plan (which itself requires an app update).
- **Recommendation.** Keep the updater disabled until the envelope verifier exists and the [A→B gate](desktop-update-ab-gate.md) passes with a disposable identity, including a tampered-archive refusal and a downgrade refusal. Choose the feed host at that point; the rolling-release option keeps everything on GitHub.

## Clean-machine and standard-user readiness

**Windows Sandbox is enabled on the development machine** (the machine owner enabled it on 25 September). The trial kit: `bun tools/sandbox-trial.ts [setup.zip]` in `desktop/` writes an ignored `artifacts/sandbox-trial/` with the ZIP, its checksum, `first-run.ps1` and `XFStudio-first-run.wsb`. The sandbox has **networking disabled**, maps the input read-only and one results folder writable, and on logon:

1. records the OS, whether the session is elevated and the WebView2 runtime version;
2. checks the ZIP against its checksum, extracts it and runs setup (complete any installer prompts by hand);
3. records install roots and packaged `version.json`;
4. launches the app, then after 25 seconds records its windows and a screenshot to `results/`.

The kit has since run unattended in the sandbox, including a one-click WebView2 install, a first-time session, relaunch and uninstall; see the [desktop README sandbox results](../../projects/xf-studio/authoring/desktop/README.md#windows-sandbox-results-25-september) and its manual checklist. Limits: files mapped into the sandbox carry no Mark-of-the-Web, so SmartScreen will not appear. To see the real download experience, enable networking and download the published asset in Edge inside the sandbox. The sandbox account is not a proof of standard-user behaviour; that still needs a non-administrator Windows account.

## Before publishing the first alpha

1. **Licence — done.** The repository and app are MIT-licensed (top-level `LICENSE`, decided 25 September 2026). MIT is OSI-approved, which also satisfies SignPath's prerequisite.
2. **Third-party notices — done.** [`projects/xf-studio/THIRD_PARTY_NOTICES.md`](../../projects/xf-studio/THIRD_PARTY_NOTICES.md) was built from the actual canary archive: Bun 1.4.0 (`bin/bun.exe`, MIT, with its statically linked components and the LGPL JavaScriptCore/WebKit source location), the Electrobun 2.0.1 programs and scripts (MIT), the Microsoft WebView2 SDK loader found inside `libNativeWrapper.dll`, Zstandard and the Zig standard library (reproduced as a precaution) and three.js 0.186.0 (MIT), with licence texts. It lives beside the changelog because it describes the app installer, not the whole repository. It is installed with the app, shown under About → Licences and attached to each release; `verify-canary.ts` keeps it current. Cottontail is not shipped, and no fonts or game files are.
3. **Community clarity — done.** First run, About, Build and every other reachable control explain what isn't in this alpha in plain words; see the [desktop README control inventory](../../projects/xf-studio/authoring/desktop/README.md#community-alpha-control-inventory-25-september).
4. **WebView2 on clean machines — done.** Windows Sandbox has no WebView2 Runtime, and the first sandbox run showed a blank white window. The app now packages Microsoft's signed Evergreen bootstrapper (Microsoft's distribution guidance allows packaging it) and, before any window, installs a missing runtime with one consent click; the full unattended sandbox first run passes (see the [desktop README sandbox results](../../projects/xf-studio/authoring/desktop/README.md#windows-sandbox-results-25-september)).
5. **Release-trigger review — done.** Reviewed at `ecb4b33` ([code-health ledger](code-health.md)). PREV-20, the Lows PREV-21..24, UI-34/35 and REL-01 are fixed; the `0.1.0-alpha.1` changelog and the site describe only what the packaged app does (head, eye plate and eyes in the preview; no brows, lashes, hair, piercings or idle), with its known limitations.
6. **First CI run — pending rerun.** The first manual run failed on a test timeout (fixed above). Run the workflow manually on `main` again after the fix merges, then install the artifact on a clean machine or in the sandbox.
7. **Draft review.** Read the release body and check that the checksums and `gh attestation verify` work on the downloaded files.

## WolvenKit delivery

Implemented 25 September 2026 ([how it works and evidence](../../projects/xf-studio/authoring/desktop/README.md#wolvenkit-on-first-use)).

- **Pinned release: WolvenKit CLI 9.0.1**, the console asset `WolvenKit.Console-9.0.1.zip` from the official [9.0.1 release](https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1), 45,266,234 bytes, SHA-256 `364427384c0f4ebb6b157fa9abd01595258af1b7993c7b3a7edd2920f2016e92` (equal to GitHub's published asset digest and to the copy verified on the development PC on 24 September). Why: it is the newest stable release; the eye plate, preview and Build pipelines were verified against it (a four-preset Build reproduced all 16 archive members of the 8.17.4 build byte for byte, and the derived plate is byte-identical); and it runs on .NET 10, Microsoft's long-term-support runtime until November 2028, while 8.17.4's .NET 8 support ends in November 2026. Readiness still accepts a user's own 8.17.4 or 9.0.1. Moving to a newer WolvenKit means re-running those pipeline checks, then changing the pin in `src/wolvenkit-release.ts`.
- **Consent and storage.** Nothing is downloaded until the user chooses **Download (45 MB)** in a dialog that states what WolvenKit is, why it is needed, the size, the source and its GPL-3.0 licence with a link. The request carries only the version the dialog showed. The copy lives in the app's own data folder (`userData/tools/`), is verified before first use and on later checks, and is never written into the user's settings, so a user-chosen path always wins and clearing it falls back to the managed copy.
- **.NET runtime: guided, not installed.** WolvenKit 9.0.1 needs the .NET 10 Runtime. XF Studio detects it the way the .NET host does and, if it is missing, offers one button that opens Microsoft's evergreen installer link and a **Check again**. It does not run the installer itself: that installs a system-wide component that needs elevation and is then serviced by Microsoft Update, which is the user's decision; the "don't silently install system components" rule and the consent model for WebView2 point the same way. An app-private runtime (Microsoft's ZIP, pinned by its published SHA-512, run through `DOTNET_ROOT`) would remove this step, but it would be a second download that XF Studio must keep patched; it is the improvement path if the one-click guidance proves to be a hurdle.
- **Not redistributed.** No WolvenKit binaries ship in the installer, so `THIRD_PARTY_NOTICES.md` is unchanged; About and the credits name WolvenKit as a separately downloaded GPL-3.0 tool with its licence link.

## Decided 25 September 2026

- **Licence:** MIT, matching ArchiveXL, TweakXL, Codeware, RED4ext and CET.
- **Clean-machine trial:** Windows Sandbox is enabled on the development machine.
- **WolvenKit delivery:** Build downloads the pinned official WolvenKit CLI release on first use, with the user's consent, and verifies it by SHA-256. We don't redistribute it. A path override remains for advanced users. Bundling may be reconsidered later. **Implemented**; see [WolvenKit delivery](#wolvenkit-delivery).
- **Mod sources:** auto-detect Steam, GOG and Epic installs and MO2 instances. Vortex and manual installs are treated as the game's own `archive/pc/mod` folder. The separate "manual mod folder" setting is dropped.

## Open questions

1. **Signing route, when ready to improve:** in which country is the maintainer resident (this decides Azure eligibility), and is **SignPath Foundation** acceptable as the publisher name users see?

Asked later, when updater work starts: may an Ed25519 update-signing key live in a GitHub environment secret with required reviewers? That is a repository-settings change for the maintainer.
