# Handoff: Build speed pass 2, the native resource writer (PIPE-130)

Branch `claude/build-native` from main `2d6752b`. Not merged. Worktree `D:/Dev/worktrees/build-native`.

## Results (two-preset collection, both bodies' plates, development PC, WolvenKit 9.0.1, through the host service, 30 September 2026)

Native and WolvenKit-only Builds interleaved (`tools/build-bench.ts`, two Builds per host process); other work on the machine (CPU 54–97 % when sampled, 31 GB free, the game closed).

| | Native writer | WolvenKit-only (same hour) | Main before pass 1 |
|---|---|---|---|
| Warm: files built (step 5 starts) | **2.76–2.96 s** (3 runs) | 13.4–13.8 s (4 runs) | — |
| Warm: verified result | **17.8–18.3 s** | 28.5–29.8 s | 59 s |
| First Build (plates cut): built / verified | 47.0 s / 61.8 s | 56.6 s / 71.7 s | 115 s |
| WolvenKit launches, warm | 0 before verification, then 3 | 8 | 14 |
| Peak memory of the tree | 2.9–3.0 GB | 2.9 GB | 2.2 GB |

Native warm stages: prepare 0 s, compose 0.25–0.3 s, convert 1.7–1.8 s (BC7 0.45–0.5 s each on the GPU, BC4 30–70 ms, morph targets 0.4 s each incl. 0.27 s Optimal2, meshes 20–30 ms), pack 0.05 s, verify ~15 s. The very first Build in a fresh host process took 6.8 s / 23.7 s (the host's first route open). Finish board (6 presets, 25 resources): built 7.1 s warm (4.5 s compiling looks), verified 23.8 s, no fallback.

"Built" = step 5 of 5 ("Checking the mod files…") starts: the archive is written. The result, and **Add to my mod manager**, still come only after independent verification passes. No UI wording changed, so no UI gate is needed.

## What is native now, and what still uses WolvenKit

| Build step | Now | Before |
|---|---|---|
| Plate meshes and morph targets, `.app` (with its components' compiled package), `.inkcharcustomization` | native CR2W writer (`src/native/write/cr2w-writer.ts`, `package-writer.ts`, rules in `red-encoder.ts` + `writer-classes.json`) | `convert deserialize` |
| Textures: BC4 scalar, BC5 normal (CPU), BC7 colour (GPU) | native import (`xbm-writer.ts`) with XF Studio's compressor `xfs_bcn.dll` (DirectXTex) | `import`, one launch per group |
| The archive | native packer (`rdar-writer.ts`) | `pack` |
| Compression | the game's Oodle (`OodleLZ_Compress` now bound in `oodle.ts`): Optimal2 buffers, Normal bodies and name list | inside WolvenKit |
| Plate cut (first Build only) | WolvenKit, unchanged (44 s) | same |
| Verification | WolvenKit, unchanged: unbundle, serialize (members + plate inputs), texture export | same |

Per-file fallback: anything the writer refuses (unknown class/property, hash-only reference, unmatched texture setting or format, a link in staging, no Oodle compressor, no compressor DLL or no D3D11 device) is made by WolvenKit, one launch per kind. `build.json` and the manifest's `resourceWriters` list native files (depot paths, `archive` for the pack) and each WolvenKit file with its reason. `XFS_NATIVE_WRITER=off` forces WolvenKit (used to capture oracles). **Desktop:** the compressor isn't packaged, so desktop Builds write CR2W and pack natively but import textures with WolvenKit (~5 s).

## Byte-equivalence

Two real Builds captured from WolvenKit (`tools/native-writer-oracle.ts capture`, private, ignored in `authoring/data/native-writer-oracle/`): the two-preset collection (14 resources) and the finish board (25 resources: flat, faceted with a BC5 normal map, colour-shift). **All 39 resources byte-identical**, including compressed buffers; **both archives identical except each entry's file time and the index CRC over them** (which differ between two WolvenKit runs too). Every native Build passed the independent verifier. Facts learned are in `knowledge/archive-format.md` §14, notably: header CRC over 160 bytes with 0xDEADBEEF in place; name hash = folded FNV-1a 64; WolvenKit's write order/defaults/serialize-default classes (from its generated classes by reflection); WolvenKit's import flips rows and makes **BC7 on the GPU with DirectXTex's DirectCompute encoder** (no CPU setting matches); archive: name list at Kraken Normal in BFS walk order, 0xD9 padding to 4 KiB, CRC-64/XZ index CRC, empty-input SHA-1s, inline count = buffers − 1 (true of all 6,511 entries in 271 WolvenKit-packed mods).

## How verification works now

Unchanged and independent: WolvenKit unbundles the archive and hash-checks every member; eye makeup's verifier serializes members and plate inputs and exports textures with WolvenKit. Nothing in the verifiers can import the writer (`tests/native-boundary.test.ts`: only `native-resource-tools.ts` imports `src/native/write/*`). Verification still runs inside the Build right after the archive is written; the host answers only after it passes.

## Tests and checks

`tests/native-writer.test.ts` (synthetic round trips through the native reader everywhere; the oracle block where `XFS_RESOLVER_GAME_ROOT`, the compressor and a captured oracle exist — passes for both oracles), `tests/native-boundary.test.ts` (writer purity, FFI only in `bcn.ts`, importers), `tests/product-builder.test.ts` (manifest `resourceWriters`, host gate accepts it). Full authoring suite under the 5 GB guard: {SUITE}. `bunx tsc --noEmit -p tsconfig.json` clean; `check_links.py` 0 broken; `check_private_paths.py` 0 findings. Build diagram re-rendered and inspected (review row added). `python tools/review_due.py`: deep review DUE (new subsystem recorded in the ledger).

## Files

- Writer: `projects/xf-studio/authoring/src/native/write/` (`byte-writer`, `red-encoder` + `writer-classes.json`, `cr2w-writer`, `package-writer`, `xbm-writer`, `bcn`, `rdar-writer`, `segments`); `src/native-resource-tools.ts`; `src/native/oodle.ts`, `src/native/kark.ts`.
- Compressor: `native/bcn/xfs_bcn.cpp`, `native/bcn/CMakeLists.txt`, `tools/build-native-bcn.ts --directxtex <source>`. DirectXTex `may2026` source in `D:/Dev/tools/directxtex/may2026/` (row in `D:/Dev/tools/README.md`). Built DLL (ignored): `authoring/data/tools/xfs-bcn/xfs_bcn.dll` — depends only on `d3d11.dll` and `kernel32.dll`. To use it from the main checkout, run the build script there (or copy it into the same ignored path).
- Class table generator: `tools/native-writer-classes.ps1` (PowerShell 7 reflection over WolvenKit 9.0.1's `WolvenKit.RED4.dll`).
- Measurement and oracles: `tools/build-bench.ts`, `tools/native-writer-oracle.ts`.
- Platform: `ResourceTools.writers?()`/`ResourceWriters` (`platform/api/export.ts`); `resourceWriters` in build.json and `LocalPackageManifest2` (`product-builder.ts`, `manifest.ts`); CLI wiring in `tools/build_collection_package.ts`; `TEXTURE_GROUP_SETTINGS` exported from `package-resource-builder.ts`.
- Docs: pipeline doc (Build speed rewritten, new "Native resource writer", build diagram labels, review row), `knowledge/archive-format.md` §14 + sources + open questions, performance backlog (Build rows), code-health ledger (PIPE-130, new subsystem, "Fixed in claude/build-native"), `docs/toolchain.md`, `docs/community-credits.md` (DirectXTex; WolvenKit entry), authoring README.

## Decisions needed

1. **Package the texture compressor into the desktop app?** It is a new native DLL in the installer (built from DirectXTex in CI: MSVC, CMake, Windows SDK fxc; MIT). Without it desktop Builds import textures with WolvenKit (~5 s, one launch per texture group). `prepare-build-tools.ts` would add `app/native/xfs_bcn.dll` to the build tools and their manifest; the CLI already looks there.
2. **The Build now uses the GPU** (a D3D11 device for BC7, as WolvenKit's import already does). Byte identity with WolvenKit is shown on this RTX 4070 only; other GPUs are an open question (knowledge §14 Q7) that applies to WolvenKit's own output too. Accept?
3. **Verifier speed.** Verification is now ~15 s of the ~18 s. Options: an async verifier API so serialize and texture export run side by side (−3 to −4 s), or verifying with an independent reader other than WolvenKit (the native reader is separate code from the writer but shares the RTTI data; the task kept WolvenKit, so this is your call).
4. **Deep review** is due after merge (new subsystem, new native binary).

## Not done / next

- The plate cut is still WolvenKit (44 s of a first Build).
- Reuse the plate's own compressed buffers for the morph targets (−0.5 s): needs the tools to know the plate files.
- The `?verify=1` UI capture was not needed (no wording changed).
- Machine note: the timings were taken with other work running; pass 1's 28.6–31.7 s morning baseline and this hour's 28.5–29.8 s WolvenKit-only runs agree.
