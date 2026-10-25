# Game 2.31 baseline and WolvenKit 10 beta evaluation

**Verdict: FAIL for the requested strict beta compatibility gate.** On 25 October 2026, both four-preset builds and independent verifiers passed, but only 14/16 unpacked members were identical between WolvenKit 9.0.1 and 10.0.0-beta.1. The beta remains an evaluation tool; stable defaults were not changed. No package was installed and no game was launched.

## Method and evidence boundaries

The checked-in fixture is `experiments/005-preset-collection/editor-collection.json`, SHA-256 `8591c115d59915a4747f2586e874696d2108c842759942b4a9c1c02f4bfe4089`. The historical round trip uses the private Experiment 004 plate pair, checks its input hashes, builds with each CLI, independently verifies each archive, and compares every staged and unpacked member. The separate production Build uses a freshly cut base-game plate and the same fixture. `XFS_NATIVE_WRITER=off` keeps those reference Builds entirely on WolvenKit, including texture import. The native writer is tested separately.

The game reports product version **2.31**, file version **3.0.5294808**. Bun is **1.4.4**; the native reader is version **4**, and the native writer targets WolvenKit **9.0.1** / WKit JSON **0.0.9**. Source revision: `f85983149448e63fcadac7f908f61868d650e933`, plus this uncommitted experiment. The beta runtimeconfig requests `Microsoft.NETCore.App` **10.0.0**; installed **10.0.13** satisfies it, and the CLI executed successfully.

Every WolvenKit batch, oracle, native build and capture attempt ran under the memory guard. Tool folders were copied into private scratch before execution, protecting the supplied installations from tool-side writes. Game and reference inputs were read only. Scratch was authorised inside the ignored `generated/scratch/` folder because the originally requested scratch path was outside the sandbox.

Private evidence is in `generated/2-31-final/` (round trip, preview, plate, production package and logs), `generated/2-31-writer-production/` (production 9.0.1 capture and decoded comparison), and `generated/2-31-writer-recheck/` (repeatable writer comparisons and compression probe). The original aggregate is retained privately as `generated/2-31-final/baseline-source.json`. The original public baseline was **not asset-free**: it included the ordered vertex mapping, selected faces and triangle indices. [baseline.json](baseline.json) now uses schema 2: four identity hashes, equality flags and allow-listed section counts, canonical JSON byte lengths and SHA-256 hashes. No manifests, nested resource differences, mappings or per-element data are published. Detailed evidence stays ignored.

## Beta binary differences

All member paths are beneath `axefrog/appearance_studio/collections/0ec3546e3fac43e78c19a65d20383d41/`. The comparison criteria are member bytes, not whole-archive digests, which vary with index timestamps.

| Member | 9.0.1 bytes / SHA-256 | Beta bytes / SHA-256 |
|---|---|---|
| `models/xfs_eye_plate.morphtarget` | 7130559 / `a059773c8958bfab1b317fb060c92d26c38dfe441e8c360e2129207171305cfc` | 7130324 / `e9aaa50b27745e26334e332fe5f6ba0c51fc9642117ed323d91428142f953864` |
| `xfs_collection.app` | 2022 / `0018515589a5dbca57ccff3aa7f92e8a9cfe541f244bbf05dec6cc81f307944d` | 2101 / `74f6f7d8c197a8b0c2991fd49074926a3cc31b69dfdeeeafe2ed557c4944a666` |

- The morph resource omits 21 explicitly stored `faceRegion: FACE_REGION_EYES` fields (target indices 0, 5, …, 100). Its decompressed buffers are identical. The beta reads the omission back as EYES; the existing native reader, learned against 9.0.1, reads the omitted default as NONE. This can affect classification on the older interpretation and requires compatibility review; it is not a harmless assembly-name change.
- The `.app` explicitly writes `chunkMask: 9223372036854775807` in the template component and its component override, where 9.0.1 omitted it. The compiled-package buffer consequently differs. Those are the only stored-property differences identified by the native decoder.
- JSON-only changes also include assembly version strings, `boundingBoxLocalBoundsOverride: -1`, texture `formatOverride: TEXFMT_NULL` and `astcQuality: ASTC_None`, and six `targetTextureDiffsData` array fields growing from zero to three elements on each of 105 targets. The twelve XBM members and mesh remain byte-identical despite their JSON shape changes.

The 9.0.1 native-reader oracle passes both tests (120 extracted resources and 14 resource-type JSON samples, 282 assertions). The beta passes the 120-resource extraction test but fails the JSON test at the hair `.app` sample: the added bounding-box default and `entSkinnedMeshComponent.chunkMask` changing from `9223372036854775807` to `18446744073709551615`. The existing test stops at that sample; this is not a complete inventory of beta JSON differences across all game resource types.

### Why the beta omits `faceRegion: EYES`

WolvenKit 10.0.0-beta.1 changed its type definition, not only its writer. At WolvenKit's September source (9.x), `MorphTargetMeshEntry`'s constructor sets `FaceRegion = FACE_REGION_NONE` (255). At the `10.0.0-beta.1` tag that line is gone, so the property's default is the enum's value 0, `FACE_REGION_EYES`. The beta therefore omits EYES as a default [source: `WolvenKit.RED4/Types/Classes/MorphTargetMeshEntry.cs` and `Types/Enums/cp77enums.cs` at both revisions, read 25 October 2026].

Whether the **game's** class default changed in 2.5 is unknown until 2.5 files are read. What follows for XF Studio:
- **Our writer** writes `faceRegion` explicitly, which is safe under either default.
- **Our native reader** reads an omitted `faceRegion` as NONE. If the game's own 2.5 resources omit EYES, the reader would misclassify them.

After the update, the recheck's reader oracle must compare the game's 2.5 morph targets against WolvenKit 10's reading. If the default changed, the native reader takes its omitted-value default from the game version's type data. This is a question about the type default, not about compression or byte equality.

## Prepared preview and plate baseline

This measures the **preview-core preparation task** from an empty isolated cache, not end-to-end GUI first paint or all body/hair/idle preparation. It prepared the feminine head, plate, eyes and core maps in **17.8 s** (18.33 s including the guarded process); a prior empty-cache trial took 21.2 s. Warm reuse took 0.77 s including launch. OS file caches were not flushed.

All eight directly prepared source resources were found in `archive/pc/content/basegame_4_appearance.archive`. The full cache key, per-export file hashes, raw resource hashes and output manifest are in the private aggregate under `provenance`, `preparedFiles` and `preparedManifests`; the public baseline hashes these sections.

| Resource path | Native resource SHA-256 |
|---|---|
| `base/characters/common/eyes/textures/he_000_base_d02.xbm` | `d1afea0622075a02c69110fbe390ba22d8c5275a6bce304d063def856f3888e1` |
| `base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget` | `3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e` |
| `base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead.mesh` | `e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6` |
| `base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.mesh` | `4d5dfa91efdf54485c5637ad34d64c32ae2f02cad7c52915062f3a0ec0f7aa19` |
| `base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/textures/h0_000_pwa_c__basehead_d01.xbm` | `088b83be507afa41f4a6299b570111b4edcda0b78b9f0b67654e5c5eeb974959` |
| `base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/textures/h0_001_pwa_c__basehead_n01.xbm` | `8629f2213ad22c9ac33531377f3a12afa13aeca6cdb7d3b46bec59abe6b27415` |
| `base/characters/head/player_base_heads/player_female_average/he_000_pwa__morphs.morphtarget` | `42a19b6a4d2f4060f6785de525d8c55f663fb2a13db804cd84e929e5110d1323` |
| `base/characters/head/wa/h0_000_wa_c__basehead/textures/h0_000_wa_c__basehead_rm01.xbm` | `13eefcecdb96bad238caa5feafe1bd361070bd6d6a1e29c789bdcbaf6f9f66f4` |

Core cache key: `128e061d0d87bd7c45bc77951af3e47a3997bacff316851647c249c165513d29`.

| Prepared file | Bytes | SHA-256 |
|---|---:|---|
| `head.glb` | 12373124 | `c5a996b72b89553e95ec7f17d102d0982a08fdab9d46c11bcf68f7d51add37b5` |
| `head-color.png` | 1083142 | `92d9e0c040d9a8fc3ae8b7dfc6411a3ef028f4fbbf7bd1fdf664caa31f81e420` |
| `head-normal.png` | 850972 | `588f3a1cafe5b64d6c71dee03a74ead015ea7b3ea986848861c5bfa4acba5dc9` |
| `head-roughness.png` | 278989 | `7715552a32d0ddf61d7ff2cca94565ce3f0ffb7e53185f6214e158332b2de1d1` |
| `eye-color.png` | 185083 | `643ec30e2e22b80ed74e4ec59eeaeba75e26b922ca30844d8f6d43170d1d82a8` |
| `preview-core.json` | 4673 | `d7a74acdffc906483229d5846f841ac7de11500157f59761ba83271312249ffd` |

Plate cache key: `53de4be766029f1f3d1cad1cfea163cac7d3246687161d7d4469d7272231b60b`. The cut has **1,620 vertices, 3,010 triangles, 105 morph targets and 73,164 retained morph-diff rows**. The manifest passes exact triangle, morph-row and quantization checks, native skin bytes in both mesh and embedded morph base, and equality of mesh/morph skin rows. Skin-row SHA-256: `ccb073c1447830fe675ce97de3782e121f85bab7ca68ee59fa1cde08f4eeea8b`. The complete ordered mapping (plate vertex i → head vertex ID), selected face IDs and compact triangles are private in the aggregate's `provenance.mapping`; the recipe vertex-ID hash is `5c37e3472aec37abf1f5b6ae1ddcbbeaab84bdb5b877b16e6bcefd0e4bb4f62b`.

The beta-derived plate passes its own byte-correspondence verifier. That does not resolve its omitted morph-region properties or prove deformation/rendering in game. The source-resource revision gate may deliberately refuse a changed 2.5 head; do not weaken it just to get a green run.

One repeatability limit: WolvenKit material JSON embeds `MaterialRepo`, an absolute run directory. Changing output location alone changes its digest, the preview core cache key and `preview-core.json`; an unchanged-game repeat showed identical GLB/texture output with only this path-sensitive metadata changing. Treat these expected location differences separately from source resource or geometry changes.

## Fixed production Build inventory

The beta Build passed the production independent verifier: **4 presets, 16 unpacked members, no omissions**, feminine V only, 0.4 mm plate lift. Its complete package manifest is retained in the private candidate and aggregate (`buildManifests`); only the section summary is public. All conversions, texture imports and packing used WolvenKit (native writing was explicitly disabled).

Paths below are relative to the collection depot prefix given above.

| Member | Bytes | SHA-256 |
|---|---:|---|
| `models/xfs_eye_plate.mesh` | 142994 | `5b1dc9d5dd543f94c050e9115e5a3de096b6c1c6c1ed5b4d669938ffa4496d57` |
| `models/xfs_eye_plate.morphtarget` | 7129774 | `b213e433f485902c100054616d4e3568669efd616a5973f36157fd3221f23b95` |
| `textures/xfs_p1c6ff912757849468b547d47e65d1d8e_diffuse.xbm` | 55798 | `89df8f04a2f75170accbaa374ffbc1fd534b206ca0b12abb0f9505b7e9ec7835` |
| `textures/xfs_p1c6ff912757849468b547d47e65d1d8e_metalness.xbm` | 2820 | `a067dad12a71886f9978e74d6e321136f3526597e66749cafa4bbfe2544b5e4c` |
| `textures/xfs_p1c6ff912757849468b547d47e65d1d8e_roughness.xbm` | 5976 | `4c21ab008d5743e77c1e79039fdcb190337033206c25145bd26bcbb1cb60c319` |
| `textures/xfs_p9039b2bd3320437984e0fe7c69460d73_diffuse.xbm` | 52479 | `e2d4b8f835b40f2774b1180e2c216bde7937011ac8c7cb606fc921f294340160` |
| `textures/xfs_p9039b2bd3320437984e0fe7c69460d73_metalness.xbm` | 2820 | `a067dad12a71886f9978e74d6e321136f3526597e66749cafa4bbfe2544b5e4c` |
| `textures/xfs_p9039b2bd3320437984e0fe7c69460d73_roughness.xbm` | 5976 | `4c21ab008d5743e77c1e79039fdcb190337033206c25145bd26bcbb1cb60c319` |
| `textures/xfs_pf25f8eb18a834f65a111b83086382c18_diffuse.xbm` | 59281 | `0bd2efdd3f31db2d5c7d7eb011fd3970961dbf2c1e8190760435acf93b65b220` |
| `textures/xfs_pf25f8eb18a834f65a111b83086382c18_metalness.xbm` | 6724 | `5e62860c6eadfa8e19ba2e503c98ed427e355fe930bfdd93c515b02e0f8c0b3f` |
| `textures/xfs_pf25f8eb18a834f65a111b83086382c18_roughness.xbm` | 6725 | `f633086a829ba105c641517cd6e47b54b767b23f0a94a0fa64223e74743f57e2` |
| `textures/xfs_pf80173e2e5b94be28f2d8d870ec55566_diffuse.xbm` | 50743 | `78a6f83a172e1cd475427c8b1c4305b9457ef620e67b8b1f0e0f000f39b1fed0` |
| `textures/xfs_pf80173e2e5b94be28f2d8d870ec55566_metalness.xbm` | 2820 | `a067dad12a71886f9978e74d6e321136f3526597e66749cafa4bbfe2544b5e4c` |
| `textures/xfs_pf80173e2e5b94be28f2d8d870ec55566_roughness.xbm` | 5976 | `4c21ab008d5743e77c1e79039fdcb190337033206c25145bd26bcbb1cb60c319` |
| `xfs_collection.app` | 2101 | `74f6f7d8c197a8b0c2991fd49074926a3cc31b69dfdeeeafe2ed557c4944a666` |
| `xfs_collection.inkcharcustomization` | 2026 | `f8e8c9c9d7d0a3849431a6a7f9a0c1cffc414fc338cb15ce65ad046c56d66b28` |

## Native writer baseline

No previous oracle or prebuilt BCN DLL was available. The project build script used the supplied pinned DirectXTex may2026 ZIP, Visual Studio 2022 / MSVC 19.43.34810.0 and the Windows SDK shader compiler. It built `xfs_bcn.dll`, SHA-256 `1161507a1452baeb96634db961d6ee2a1d6dc526e911fbb0ef5bff1bf949ed08`, in 37.95 s. No download was needed.

A fresh **production** WolvenKit 9.0.1 Build was captured through `native-writer-oracle.ts capture`. The existing writer test reports **17 pass, 1 fail**: 12/16 resource bytes differ. The separate comparison completes the archive gate: **packing the reference resource bytes reproduces the archive except file times**. This isolates the archive packer; an archive made from the differing native resources is not claimed byte-identical. All 16 native outputs have identical native-decoded stored properties and decompressed buffers to the reference.

The compression probe reproduces **all 17 reference table buffers at Kraken Normal (4)**; only three also reproduce at Optimal2 (6). The native resource writer currently uses Optimal2. This limits the older knowledge claim of version-wide byte equality; it does not establish damaged geometry or texture pixels. No compression policy or writer implementation was changed here.

Exact reference/native sizes and hashes for all members, input hashes and probe rows are in the private aggregate's `writerResources`, `writerOracleInputs`, `nativeWriterFiles`, `writerSemanticComparison` and `writerCompression` sections. Their counts and hashes are public.

## Captures and remaining runtime work

`starter-shapes-look.ts --only head` timed out inside the agent's sandbox after 240 s, with no PNGs. The coordinator then ran it outside the sandbox on 25 October 2026, under the guard (peak 6.7 GB), with stable WolvenKit 9.0.1 and isolated data. It produced **20 head captures**: the default feminine and masculine V with each of the five starter shapes, light and dark, front view. They are in `generated/2-31-final/head-captures/`, private, and are the visual baseline for after the update. Compare them by eye, or with a perceptual tolerance, never byte for byte: renderer noise differs between runs.

This is offline evidence only. The complete post-update board recheck also includes showroom, creator merge targets, idle clips, framework guidance and one maintainer-run game session; this experiment does not replace that session or prove game 2.5 compatibility.

## Timings

Guarded wall times; compilation of the texture DLL is a one-time setup cost. Peak memory: preview 2.2 GB, package Build 2.6 GB, plate 1.6 GB, reader 1.4 GB or less, writer comparison 0.6 GB. The probe and decoded diagnostic stayed below their 2 GB guards.

| Step | Seconds | Exit |
|---|---:|---|
| wk9-build | 63.58 | 0 |
| wk9-verify | 12.78 | 0 |
| wk10-build | 64.01 | 0 |
| wk10-verify | 13.33 | 0 |
| binary-analysis | 2.23 | 0 |
| prepare-cold | 18.33 | 0 |
| prepare-warm | 0.77 | 0 |
| plate | 30.48 | 0 |
| provenance | 0.74 | 0 |
| studio-build | 46.77 | 0 |
| reader-oracle-wk9 | 17.37 | 0 |
| reader-oracle-wk10 | 16.33 | 1 |
| head-captures | 240.03 | timeout |
| writer-plate | 31.45 | 0 |
| writer-build | 43.59 | 0 |
| writer-capture | 0.75 | 0 |
| writer-oracle | 3.77 | 1 |
| writer-compare | 3.23 | 1 |
| compression-probe | 1.76 | 0 |
| build-bcn | 37.95 | 0 |

The measured repeatable work is roughly 6–8 minutes without the capture timeout or compiler setup; allow roughly 10–13 minutes with that timeout, plus review of any update differences. This is the fixture pass, not the full post-update board checklist.

## Recheck after the update

Run from the root of a linked Git worktree, using the full interpreter path. When `captures` is selected (including the default steps), the runner refuses the main working tree before creating outputs or starting tools: it compares Git’s absolute `--git-dir` and `--git-common-dir`. Each label must be new; previous output is never deleted or reused. The runner checks that `generated/` is ignored, copies the supplied CLIs privately, guards each heavy command, writes private logs/results, removes its own scratch, and prints changed metadata sections plus leaf paths. Full differences go to the new run’s `diff.json`. Existing known failures still return exit 1; they are not silently accepted.

```powershell
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" `
  experiments/045-game-2-5-baseline/recheck.py `
  --game PATH_TO_GAME `
  --wk9 PATH_TO_WOLVENKIT_9_CLI `
  --wk10 PATH_TO_EVALUATED_WOLVENKIT_10_CLI `
  --reference-root PATH_TO_REFERENCE_CHECKOUT `
  --writer-oracle experiments/045-game-2-5-baseline/generated/2-31-writer-production/writer-oracle `
  --bcn PATH_TO_PREBUILT_XFS_BCN_DLL `
  --label 2-5-first-pass --port 4585
```

Use `--steps roundtrip,prepare,plate,build,reader,writer` to omit the currently unavailable capture step. The writer requires an explicit prebuilt `--bcn` DLL; the runner never invokes the native build tool or writes to its shared build/tool folders. Without `--writer-oracle`, the writer phase derives a stable plate, makes and captures a fresh production 9.0.1 Build, then compares it. Keep the recorded 2.31 oracle to compare the writer using the updated game’s Oodle library. `XFS_NATIVE_WRITER_GAME_ROOT` explicitly passes `--game` to that comparison, which records the actually loaded Oodle path, identity, SHA-256 and trust method in its private log and `native-output/oodle-identity.json` (copied to the private result's `writerOodle`). The historical round-trip phase requires the private Experiment 004 plate pair under the reference checkout; the fixture recipe itself is checked in.

The writable-location audit covered `server.ts`, `src/host`, `src/setup/host`, other host adapters under `src/`, and the invoked tools. Every inherited `XFS_*`/`XFAS_*` override is discarded. The runner supplies these roots beneath the new run: `XFAS_DATA_DIR` (library, diagnostics and verification data), `XFS_SETTINGS_DIR` (settings and install receipts), `XFS_PREVIEW_CORE_CACHE`, `XFS_RESOLVER_CACHE`, `XFS_CHOICE_PREVIEW_CACHE`, `XFS_PACKAGE_PLATE_CACHE`, `XFS_EXPRESSIONS_GAME_CACHE`, `XFS_TOOLS_DIR`, `XFS_NATIVE_WRITER_ORACLE` and `XFS_NATIVE_WRITER_OUTPUT`. An explicit existing oracle remains a read-only input. `XFS_SAVES_DIR` points to an empty run-local location. `TEMP` and `TMP` point into the run's disposable `generated/scratch/<label>/`; private CLI copies, browser profiles and the capture server's disposable data/settings live there. Captures use `--empty-settings`, preserving head capture while avoiding a copy of personal settings or mod-manager routes. No existing data cache is borrowed. This does not relocate browser bundles: capture-server startup still overwrites and prunes this worktree’s `projects/xf-studio/authoring/public/build/`. The server has no build-directory relocation setting. Use a separate worktree whose build directory is not linked to another checkout, with no active Studio serving those bundles; the Git check alone does not detect shared build-directory junctions or protect another server in the same worktree. Package Build roots are explicit command-line outputs; candidate-store defaults are not used by head captures.

`public_baseline.py` is the sole public-baseline writer policy: unknown top-level evidence sections fail closed; arbitrary nested evidence is represented only by counts and a canonical JSON hash. Canonical JSON sorts keys, uses compact separators and UTF-8 without ASCII escaping. Raw results remain private. `--save-baseline` requires a new `.json` inside this experiment, resolves junctions/symlinks before checking containment and uses exclusive creation. Comparison against schema 2 reports changed sections through their summaries; exact element differences require the retained private evidence. `compare-json.py` recursively sanitizes buffers even in added, removed or type-changed subtrees and validates its difference-record schema. Native-writer diagnostics require a fresh output directory with an existing parent, created non-recursively by the tool. Existing entries are refused using `lstat`, including dangling links; canonical containment also rejects overlap with the oracle root, game root or BCN input. Every diagnostic file (including Oodle identity metadata) is created exclusively with `wx`, so pre-existing files, hard links and dangling links cannot be overwritten. A diagnostics run compares exactly one oracle; use a new output path for each comparison. Canonical paths alone do not identify hard links. These guards prevent reuse/overwrite of existing diagnostic entries; they are not a filesystem sandbox against another process concurrently replacing directories. Capture also refuses overlap with its source and refuses replacing an existing capture.

To regenerate a new public file without rerunning any tools, use `python experiments/045-game-2-5-baseline/public_baseline.py experiments/045-game-2-5-baseline/generated/2-31-final/baseline-source.json experiments/045-game-2-5-baseline/baseline-review.json`. The destination must not exist. The retained aggregate preserves the original manually combined measurements and the per-element evidence removed from the public baseline.

Compare member and source hashes first. Review location-sensitive material hashes, cache keys, timestamped candidate paths, whole-archive hashes and PNG renderer noise separately. The script records such differences rather than normalising away evidence. A failed plate revision gate requires a correspondence audit before any recipe acceptance update.

The historical Python builder had a stale branding guard requiring `XF ` even though the production selector label is `XF`. It now accepts the same branded token boundary as production. This was necessary to run the existing fixture and does not change its resource plan.

## Validation and handoff

The original baseline's `bun run check`, link checking (447 tracked Markdown files), tracked private-data scanning, and explicit privacy/link checks on the new files passed. The full suite attempt hit a 120 s browser-dependent hook timeout and was stopped. With optional browser oracles explicitly marked unavailable, the suite passed **3,788 tests, 178 skips, 0 failures** across 477 files in **516.47 s**, peak 3.0 GB under the 6 GB guard. The real-install reader/writer oracles were run separately with prerequisites required; their failures are reported above.

The review fixes were checked with `python experiments/045-game-2-5-baseline/test_safety.py` (main-tree capture refusal, linked-worktree acceptance, Git failure, containment, junction escape, exclusive writes, public schema, nested buffers and inherited environment), `bun test ./experiments/045-game-2-5-baseline/test-output-overlap.ts` (31 assertions across two tests, including hard links, dangling links, fresh-directory ownership, exclusive file creation and CLI refusal before Oodle loading), and guarded `bun run check` (3 GB limit). Link and private-path checks passed. These checks use synthetic inputs; the WolvenKit, native compression, capture and game steps were not repeated. The public baseline was regenerated from the retained private aggregate, with no resource payload emitted. Git remains uncommitted for coordinator review.


Retained private experiment evidence: 1.073 GiB. Superseded runs, scratch, round-trip bake/export intermediates and the regenerable native compilation tree were removed. The small ignored texture DLL and build record remain in `authoring/data/tools/xfs-bcn/` for the recheck. The coordinator must preserve the three referenced generated folders when integrating/removing this worktree.

Knowledge used: [tooling](../../knowledge/tooling.md), [archive formats](../../knowledge/archive-format.md), [head rendering](../../knowledge/head-cc-rendering.md), [CC file chain](../../knowledge/cc-file-chain.md), [native plate bootstrap](../012-native-plate-bootstrap/README.md), [9.0.1 round trip](../../research/authoring/wolvenkit-9-roundtrip-2026-09-24.md). Tooling/archive/head pages were updated; the older unconditional compression-equivalence interpretation is incomplete for this measured path.
