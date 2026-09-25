# Toolchain and runtime baseline

First observed 2026-09-23; development toolchain and framework staging rechecked 2026-09-25. Source checkouts, installed files, saved MO2 profile state and runtime logs are different evidence sources.

## Development toolchain

Versions actually pinned or used by current XF Studio work. Lockfiles and `package.json` pins are authoritative for the Bun projects.

| Tool | Version | Used for | Pinned by |
|---|---|---|---|
| [Bun](https://bun.sh/) | 1.4.2 | Studio server, bundling, tests; desktop main; public site | `@types/bun` in each `package.json`; `bun-version` in `.github/workflows/pages.yml` |
| TypeScript | 7.0.2 (authoring), 5.9.3 (desktop) | `tsc --noEmit` checks | `projects/xf-studio/authoring/package.json`, `authoring/desktop/package.json` |
| three.js | 0.186.0 | Browser renderer; skinning shader patches are pinned to this version | `authoring/package.json` (with `@types/three` 0.186.0) |
| [Electrobun](https://github.com/blackboardsh/electrobun) | 2.0.1 (compatible global Hutch 0.24.3 as builder fallback) | Private Windows desktop trial | `authoring/desktop/package.json` and its `bunx electrobun@2.0.1` scripts |
| WolvenKit CLI | 8.17.4 (production default) and 9.0.1 (side by side) | Resource conversion, pack/unbundle, package verification | Local paths below and Local setup; desktop readiness accepts either |
| Blender | 5.0.0 | Headless intake, plate audit/export, preview GLB export | `C:/Program Files/Blender Foundation/Blender 5.0/blender.exe` |
| Python | 3.14.6 with Pillow 12.3.0 and NumPy (2.5.2 global) | Study scripts and the Experiment 005 research oracle (`compare-build-port.ts`, oracle unit tests). **Not needed by the product:** Build runs in TypeScript | Local install below |
| NumPy / SciPy | 2.5.3 / 1.18.1 | Plate clearance and correction studies | [`experiments/006-plate-clearance/fixed_requirements.txt`](../experiments/006-plate-clearance/fixed_requirements.txt), installed into an ignored experiment-local target (SciPy is not in the global Python) |
| .NET SDK | 9.0.205 (projects target `net9.0`) | `projects/xf-studio/tools/morph-import` and `anim-export`, which reference WolvenKit CLI assemblies (`WolvenKitDir`, default the 8.17.4 console) | `.csproj` files |
| [dxil-spirv](https://github.com/HansKristian-Work/dxil-spirv) and [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) | Commits `f2d1b554` and `aa217aeb`, built from source with CMake 4.0.1 + MSVC 2022 | Optional `shader_annotate.py --decompile` (DXIL to structured HLSL/GLSL) in shader research | `D:/Dev/tools/README.md` (full commits, build flags, binary SHA-256s); `DXIL_SPIRV_EXE` / `SPIRV_CROSS_EXE` or `XF_TOOLS_DIR` |
| [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli) | 11.17.0 with Chrome | Rendering pipeline-guide diagrams for visual review (not installed globally) | Recorded in the pipeline guide's visual-review table |

Last verified 25 September 2026: authoring `bun test` passes 448 (including desktop tests), `tsc --noEmit` is clean in authoring and desktop, and the site tests, build and check pass.

## Runtime evidence and current stable releases

The latest inspected RED4ext session is September 16 2026, 11:14-11:25 Brisbane time, game 2.31 / file version 3.0.80.51928. The snapshot is retained in `captures/20260923-085239-949631-foundation-existing-logs/`; capture date is not game-session date.

**25 September diagnostic recheck:** the selected MO2 profile still enables ArchiveXL, TweakXL, Codeware and redscript. MO2 metadata and the locally inspected DLL versions agree at ArchiveXL 1.26.3, TweakXL 1.11.3 and Codeware 1.20.3; redscript metadata is 0.5.31 and the game-root RED4ext DLL is 1.30.0. These are installed-file observations, not evidence of a new game launch. The stable release targets below were rechecked against their official release pages. ArchiveXL 1.27.3 and Codeware 1.20.5 explicitly list game 2.31 in their tagged READMEs; TweakXL 1.11.4's tagged README still names game 2.3, so its next-run 2.31 compatibility needs fresh runtime confirmation. Preserve the existing entries and profile while preparing newer stable framework entries in a separate diagnostic profile. The 1.28.0 ArchiveXL beta, 1.11.5 TweakXL release candidate and redscript 1.0 development line are not the stable test targets.

| Framework | Last observed runtime/base-profile version | Current stable release | Diagnostic status before runtime test |
|---|---|---|---|
| ArchiveXL | 1.26.3 (runtime and original MO2 entry) | [1.27.3](https://github.com/psiberx/cp2077-archive-xl/releases/tag/v1.27.3) | Versioned 1.27.3 mod enabled only in new diagnostic profile; verify actual load |
| TweakXL | 1.11.3 (runtime and original MO2 entry) | [1.11.4](https://github.com/psiberx/cp2077-tweak-xl/releases/tag/v1.11.4) | Versioned 1.11.4 mod enabled only in new diagnostic profile; tagged README still names game 2.3 |
| Codeware | 1.20.3 (runtime and original MO2 entry) | [1.20.5](https://github.com/psiberx/cp2077-codeware/releases/tag/v1.20.5) | Versioned 1.20.5 mod enabled only in new diagnostic profile; verify actual load |
| RED4ext | 1.30.0 (runtime) | [1.30.0](https://github.com/wopss/RED4ext/releases/tag/v1.30.0) | Current at check time |
| redscript | 0.5.31 (MO2 metadata; compilation success in latest runtime log) | [0.5.31](https://github.com/jac3km4/redscript/releases/tag/v0.5.31) | Current stable; do not deploy the 1.0.x development source branch |
| CET | 1.37.1 (latest session header in appended log) | [1.37.1](https://github.com/maximegmd/CyberEngineTweaks/releases/tag/v1.37.1) | Current at check time |

Official GitHub API responses were reduced to release metadata in [framework release record](../inventory/framework-releases-2026-09-23.json) (like other `inventory/` outputs, a local-only ignored file). The foundation survey changed no installed binaries. On 25 September, complete stable packages were installed **side by side** into new MO2 mod folders and enabled only in the new diagnostic profile; the old folders and physical RED4ext loader were not replaced. [ZIP hashes, profile scope and runtime limits](../research/authoring/framework-diagnostic-profile-2026-09-25.md).

The selected MO2 profile is `2025 (again)` (920 enabled actual mods). Game-root logs confirm a loaded framework stack; MO2 `overwrite` contains current ArchiveXL/redscript output, while `_overwrite_` is older. ArchiveXL's latest inspected log loads `xf-eye-artistry-ccxl.xl`; that proves loader activity, not that every appearance rendered correctly.

## Reference repositories

30 external reference repositories were checked against their configured upstream branch; 22 advanced since the original census. Core top-level references are current to their tracked branches. [Combined revision record](../inventory/reference-revisions.json) (local-only) preserves the original and final revision for every checked repository. The separate first/second pass records explain Windows line-ending normalization and an initially slow historical clone status check.

- `D:/Dev/clones/WolvenKit` is the **xf-hq fork**, still at a May 2025 commit current to that fork. It is intentionally preserved; prefer the updated official `D:/Dev/WolvenKit` source.
- `D:/Dev/Cyberpunk-Modding-Docs` retains the maintainer's older fork as `origin`; on 23 September 2026 its clean `main` fast-forwarded from `e7b65fab` to canonical `upstream/main` at `be2f44ee` (99 commits ahead of the fork). The linked GitBook images are present locally and must be read with their guides. No fork push was made.
- The older `clones` ArchiveXL/SDK/RTTIDumper checkouts now align with their respective refreshed branch tips; the pre-update census preserves their earlier provenance.
- `redscript` tracks upstream `1.0.x`, which is a development line. Runtime-compatible research should inspect release tag `v0.5.31` where compiler behavior matters. `redscript-ide` tracks upstream default `0.2.x`.
- Reference checkouts were not compiled; submodule dependency trees were not mass-updated/installed. Source availability is not a claim of a ready native build environment.

## Offline tools actually exercised

- Python 3.14.6: `%USERPROFILE%/AppData/Local/Python/bin/python.exe`.
- Blender 5.0.0: `C:/Program Files/Blender Foundation/Blender 5.0/blender.exe`. Also installed: 4.4 and 4.5 directories. Headless inspection works; no callable Blender MCP tool was exposed in this session. No upgrade needed to open the source successfully.
- WolvenKit CLI 8.17.4: `F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe`. Verified archive extraction and JSON/CR2W material round-trip; still the production default. Official [CLI 9.0.1](https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1) is now installed side by side at `F:/Games/RedModding/WolvenKit.Console-9.0.1/WolvenKit.CLI.exe`, with the published ZIP SHA-256 verified. Its [private four-preset round trip](../research/authoring/wolvenkit-9-roundtrip-2026-09-24.md) passed independent verification and reproduced all 16 archive members byte for byte against the validated 8.17.4 build. This is offline fixture compatibility, not game verification or a production-default change. GUI and CLI versions are separate tools.
- Older MLSB CLI 8.16.2-nightly.2025-06-16: `F:/Games/RedModding/MLSB_WolvenKit.CLI/WolvenKit.CLI.exe`; preserve for historical compatibility, not default builds.
- `rg` and Git available. Prefer `--no-optional-locks` for read-only reference inspection and per-command `core.autocrlf=true` when checking these Windows clones.

## Nexus connection

A personal API key was supplied via `temp.txt`. It was extracted, saved using Windows CurrentUser DPAPI at `%LOCALAPPDATA%/CP2077ModdingHQ/credentials/nexus-api-key.dpapi`, verified by local readback and the official `https://api.nexusmods.com/v1/users/validate.json` endpoint, then `temp.txt` was deleted. The validation response confirmed a premium account. [Non-secret connection record](../inventory/nexus-connection.json) (local-only).

Do not display the decrypted key or write it into project files. Future download helpers can decrypt it in-process for requests to the official Nexus API. Prefer official public GitHub assets for frameworks that publish them. Check version, game compatibility, selected optional files and rollback manifests before updating a mod; a valid key alone does not select the right archive variant.
