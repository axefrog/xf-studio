# Toolchain and runtime baseline

Observed 2026-09-23. Source checkouts, installed files, saved MO2 profile state and runtime logs are different evidence sources.

## Runtime evidence and current stable releases

The latest inspected RED4ext session is September 16 2026, 11:14-11:25 Brisbane time, game 2.31 / file version 3.0.80.51928. The snapshot is retained in `captures/20260923-085239-949631-foundation-existing-logs/`; capture date is not game-session date.

**25 September diagnostic recheck:** the selected MO2 profile still enables ArchiveXL, TweakXL, Codeware and redscript. MO2 metadata and the locally inspected DLL versions agree at ArchiveXL 1.26.3, TweakXL 1.11.3 and Codeware 1.20.3; redscript metadata is 0.5.31 and the game-root RED4ext DLL is 1.30.0. These are installed-file observations, not evidence of a new game launch. The stable release targets below were rechecked against their official release pages. ArchiveXL 1.27.3 and Codeware 1.20.5 explicitly list game 2.31 in their tagged READMEs; TweakXL 1.11.4's tagged README still names game 2.3, so its next-run 2.31 compatibility needs fresh runtime confirmation. Preserve the existing entries and profile while preparing newer stable framework entries in a separate diagnostic profile. The 1.28.0 ArchiveXL beta, 1.11.5 TweakXL release candidate and redscript 1.0 development line are not the stable test targets.

| Framework | Observed installed/runtime version | Current stable release | Action before new runtime tests |
|---|---|---|---|
| ArchiveXL | 1.26.3 (runtime and MO2 metadata) | [1.27.3](https://github.com/psiberx/cp2077-archive-xl/releases/tag/v1.27.3) | Update; required by proposed composite-material design |
| TweakXL | 1.11.3 (runtime) | [1.11.4](https://github.com/psiberx/cp2077-tweak-xl/releases/tag/v1.11.4) | Update with the prepared framework maintenance step |
| Codeware | 1.20.3 (runtime) | [1.20.5](https://github.com/psiberx/cp2077-codeware/releases/tag/v1.20.5) | Update with the prepared framework maintenance step |
| RED4ext | 1.30.0 (runtime) | [1.30.0](https://github.com/wopss/RED4ext/releases/tag/v1.30.0) | Current at check time |
| redscript | 0.5.31 (MO2 metadata; compilation success in latest runtime log) | [0.5.31](https://github.com/jac3km4/redscript/releases/tag/v0.5.31) | Current stable; do not deploy the 1.0.x development source branch |
| CET | 1.37.1 (latest session header in appended log) | [1.37.1](https://github.com/maximegmd/CyberEngineTweaks/releases/tag/v1.37.1) | Current at check time |

Official GitHub API responses were reduced to release metadata in [framework release record](../inventory/framework-releases-2026-09-23.json). No installed framework binaries were changed during the foundation survey. Nathan authorizes designing for newer releases rather than allowing installed versions to limit the work.

The selected MO2 profile is `2025 (again)` (920 enabled actual mods). Game-root logs confirm a loaded framework stack; MO2 `overwrite` contains current ArchiveXL/redscript output, while `_overwrite_` is older. ArchiveXL's latest inspected log loads `xf-eye-artistry-ccxl.xl`; that proves loader activity, not that every appearance rendered correctly.

## Reference repositories

30 external reference repositories were checked against their configured upstream branch; 22 advanced since the original census. Core top-level references are current to their tracked branches. [Combined revision record](../inventory/reference-revisions.json) preserves the original and final revision for every checked repository. The separate first/second pass records explain Windows line-ending normalization and an initially slow historical clone status check.

- `D:/Dev/clones/WolvenKit` is the **xf-hq fork**, still at a May 2025 commit current to that fork. It is intentionally preserved; prefer the updated official `D:/Dev/WolvenKit` source.
- `D:/Dev/Cyberpunk-Modding-Docs` retains Nathan's fork as `origin`; on 23 September 2026 its clean `main` fast-forwarded from `e7b65fab` to canonical `upstream/main` at `be2f44ee` (99 commits ahead of the fork). The linked GitBook images are present locally and must be read with their guides. No fork push was made.
- The older `clones` ArchiveXL/SDK/RTTIDumper checkouts now align with their respective refreshed branch tips; the pre-update census preserves their earlier provenance.
- `redscript` tracks upstream `1.0.x`, which is a development line. Runtime-compatible research should inspect release tag `v0.5.31` where compiler behavior matters. `redscript-ide` tracks upstream default `0.2.x`.
- Reference checkouts were not compiled; submodule dependency trees were not mass-updated/installed. Source availability is not a claim of a ready native build environment.

## Offline tools actually exercised

- Python 3.14.6: `C:/Users/Nathan/AppData/Local/Python/bin/python.exe`.
- Blender 5.0.0: `C:/Program Files/Blender Foundation/Blender 5.0/blender.exe`. Also installed: 4.4 and 4.5 directories. Headless inspection works; no callable Blender MCP tool was exposed in this session. No upgrade needed to open the source successfully.
- WolvenKit CLI 8.17.4: `F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe`. Verified archive extraction and JSON/CR2W material round-trip; still the production default. Official [CLI 9.0.1](https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1) is now installed side by side at `F:/Games/RedModding/WolvenKit.Console-9.0.1/WolvenKit.CLI.exe`, with the published ZIP SHA-256 verified. Its [private four-preset round trip](../research/authoring/wolvenkit-9-roundtrip-2026-09-24.md) passed independent verification and reproduced all 16 archive members byte for byte against the validated 8.17.4 build. This is offline fixture compatibility, not game verification or a production-default change. GUI and CLI versions are separate tools.
- Older MLSB CLI 8.16.2-nightly.2025-06-16: `F:/Games/RedModding/MLSB_WolvenKit.CLI/WolvenKit.CLI.exe`; preserve for historical compatibility, not default builds.
- `rg` and Git available. Prefer `--no-optional-locks` for read-only reference inspection and per-command `core.autocrlf=true` when checking these Windows clones.

## Nexus connection

Nathan supplied a personal API key via `temp.txt`. It was extracted, saved using Windows CurrentUser DPAPI at `%LOCALAPPDATA%/CP2077ModdingHQ/credentials/nexus-api-key.dpapi`, verified by local readback and the official `https://api.nexusmods.com/v1/users/validate.json` endpoint, then `temp.txt` was deleted. The validation response confirmed a premium account. [Non-secret connection record](../inventory/nexus-connection.json).

Do not display the decrypted key or write it into project files. Future download helpers can decrypt it in-process for requests to the official Nexus API. Prefer official public GitHub assets for frameworks that publish them. Check version, game compatibility, selected optional files and rollback manifests before updating a mod; a valid key alone does not select the right archive variant.
