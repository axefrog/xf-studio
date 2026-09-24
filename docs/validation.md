# Validation with minimal game sessions

Principle: answer structural and deterministic questions offline, instrument the remaining uncertainties, then ask the maintainer for a small, prepared set of in-game actions. Never turn every uncertain resource property into a fresh game-launch request.

## Offline work before any test session

1. **Provenance and dependency graph.** Hash intake assets; keep originals immutable. Generate manifests of all depot paths, app/component names, material references, icons, `.xl` declarations and framework versions. Resolve every dynamic path for the full catalogue; identify intentional base-game dependencies separately from missing files.
2. **Serialization.** JSON → CR2W → JSON checks for critical resource fields; archive pack/list/unbundle checks against a manifest. Verify file existence and field contents because WolvenKit can log errors without failing its process. Keep fresh templates small enough for other people to open comfortably.
3. **CCXL invariants.** Unique stable option/appearance/component IDs, coherent indexes, OFF behavior, scope membership, explicit component overrides, palette-thumbnail correspondence and save-compatible identifiers. Measure serialized UI size as palette counts rise. Do not assume independent controls exist without a proof.
4. **Mesh/morph integrity.** Confirm units, axes, transforms, topology, vertex order, UV sets, normals/tangents, colour attributes, bone indices and normalized weights. Verify shape-key deltas and morph-buffer correspondence. Compare the plate to the head across the 105 available facial variants; investigate extreme combinations and eyelid/eye-corner boundaries.
5. **Geometric layer experiment.** Offset vertices along controlled surface normals, not uniform object-origin scaling. Preserve rigging/UVs; update all relevant morph states consistently. Parameterize offsets in confirmed units. Check post-export quantization so tiny separations survive packing. Measure intersections/clearance and retain a zero-offset control. Existing Displace strength on `.010` is about `0.0001` Blender units with mid-level 0.5; that is evidence of an experiment, not an approved release offset.
6. **Performance.** Benchmark generated file count/bytes, conversion time, peak memory and resource-open behavior at increasing palette sizes (initially legacy 49, then 128/256 candidates). Separate load-time cost from runtime cache growth and thumbnail/selector cost. Actual UI usability is still a human-observed criterion.

Source-derived models are useful for exhaustive naming/path checks. They cannot prove ArchiveXL hooks executed, GPU blending order, visual deformation or game save compatibility. Blender renders can expose holes/intersections and UV mistakes, but do not reproduce REDengine's decal shader.

## Preset compilation and optional geometric layering

The [Studio-to-mod pipeline guide](../research/authoring/studio-to-mod-pipeline.md) shows the current data, merge, resource, verifier and private `dist` stages, with the untested game boundary marked explicitly.

Current product direction is one selector for complete authored looks. [Experiment 005](../experiments/005-preset-collection/README.md) already merges compatible flat finishes into one material per selected look, using a single shared dynamic template. Its archive is verified offline, but selection clearing, rendered appearance and save persistence are not. Geometry offsets are still relevant for skin clearance and for any coordinated stack needed by optical finishes that cannot be merged faithfully.

The historical proposal of several normal-offset meshes may solve coplanar interference. However the inspected decal template has depth writes disabled, so the geometry alone does not establish which translucent/decal draw is blended last. Test component/selection order and camera movement as well as static overlap when a stack is needed. Keep the standard material template as baseline. Do not add new shader-priority tricks just to force a result.

If offsets fail, investigate actual renderer component/pass ordering, existing decal controls and whether a supported ordering hook exists. Offline texture compositing is now the preferred compatible-finish path; it compiles only authored combinations. Record why each alternative succeeds/fails.

## Instrumentation to prepare

- A tiny project-local diagnostic mod can log session/build IDs, registered layer options, selected IDs, component/morph/mesh paths, requested appearances and changes in selection order. First verify which fields/events are exposed; do not invent CET APIs.
- Prefer change-triggered, bounded logs and user-triggered snapshots over per-frame dumping. Use the CET kit's session/UI helpers or confirmed game events to isolate creation/photo-mode/gameplay transitions.
- ArchiveXL expansion/error logs are ground truth for resource resolution; RED4ext identifies loaded plugin versions; redscript logs identify compilation; CET captures the diagnostic callbacks. Use existing Red Hot Tools capabilities only after verifying installation/version/API support.
- Hot reload can shorten iteration, but not every cached resource, native DLL or CCXL registration can reload safely. Document the verified reload boundary before relying on it. Package several clearly labelled alternatives into a single diagnostic build where practical.
- `tools/capture_session.py --label <test-id> --profile "<MO2 profile name>"` copies relevant existing logs and the named profile's mod list into a unique HQ folder with timestamps, sizes and hashes. Omit `--profile` only for the historical `2025 (again)` baseline; it does **not** infer MO2's currently selected profile. It records both MO2 overwrite generations separately and flags files changing during capture. It does not launch or alter the game. The first baseline capture was successful: 13 files, zero changed during copy.

## Prepared single-session test card

**Current card: [first eye-makeup game smoke preflight, 25 September](../research/authoring/first-makeup-runtime-preflight-2026-09-25.md).** Use it for the next game session; it holds the exact candidate hashes, framework file checks, finish matrix and the concise six-step session procedure. Where it differs from the standing checklist below, the dated card wins.

**State at that preflight:** no game session has happened. The offline-verified four-preset [collection package](../experiments/005-preset-collection/README.md) and current stable frameworks (ArchiveXL 1.27.3, TweakXL 1.11.4, Codeware 1.20.5) are promoted into the separate `XF Studio diagnostic 2026-09-25` MO2 profile, which is **not selected**; all 44 framework files and the candidate still match their private manifests. That candidate covers Matte, Metallic and Off; its only Satin layer is disabled. A separate ignored, independently verified five-look candidate adds an enabled Satin control but is **not installed**. The diagnostic profile has `LocalSaves=false`, so make a recoverable test save before any launch. No plate clearance correction has passed every release gate: posed eyelid contact is a known risk to observe, not a reason to call the package release-ready. A game result must not be inferred from archive round-trip or MO2 file placement.

### Standing checklist

Before the diagnostic launch, pin the candidate manifest and profile ID, capture a fresh baseline, choose the MO2 executable/launch route explicitly, and make a recoverable test save. Verify MO2's effective winners and that the dedicated mod is enabled before selecting the diagnostic profile ([framework hashes and limits](../research/authoring/framework-diagnostic-profile-2026-09-25.md)). Record versions from new runtime logs separately from installed metadata. Add a diagnostic logger only after confirming the actual available APIs and testing that its output stays bounded.

1. Capture a pre-launch snapshot of the deliberately chosen profile, conflicting resource paths and existing logs. Pass its name to `tools/capture_session.py --profile`; the helper's default is still the historical source profile. Record the exact package identity and the game/build/framework versions actually loaded.
2. In the character creator, check the single XF Studio eye-makeup selector with **Off** and each authored verification preset in the staged candidate (for the promoted four-preset fixture from `editor-collection.json`: Metallic copy, Reload persistence, Collection B and Collection A). Switch A → B → Off, then B → A → Off; check that a choice replaces the complete prior look, that Off clears it, and that reselecting a look does not retain hidden prior components. The package manifest pins preset IDs, revisions and generated appearance names, **not display names**; confirm the ID-to-name mapping against the exact source collection snapshot.
3. Capture matched front, oblique and side views at close and ordinary camera distances, under at least two useful lights. Check soft edges and lower-mip appearance while zooming, surface attachment, overlap, and any eyelid/crease contact. This flat-finish fixture cannot validate Glitter, Shimmer, Glossy or Colour-shifting; those need separately identified material fixtures when ready.
4. Exercise a small offline-selected set of eye shapes and facial poses, including blinks and the creator idle. Record the exact preset/pose and camera state for any contact, floating edge or texture mismatch. Compare brow/lash and hair preview fidelity only with matched in-game choice, lighting and camera; do not infer a geometry defect from unmatched photographs.
5. Leave and re-enter customization, inspect photo mode/gameplay if available, and reload a designated recoverable test save to check selector identity and persistence. Reorder/removal behavior needs a separately prepared compatible update, not an ad hoc change to this first fixture.
6. Capture post-session logs and screenshots with the same package/profile label. Separate what the game visibly rendered from archive expansion logs, source-derived expectations and offline verifier results.

One prepared run should answer several runtime questions. A second cold start is warranted only if first-load/cache/save behavior or a reproducible failure requires it. Keep any source or screenshot evidence local until its redistribution rights are clear.

**Brow/lash parity in the same session:** hold the saved character's neutral expression and record the exact Arkhe Fuller style-18 `10_brown_ombre` brow and Soft Natural `05_brown_liquorice` lash choices, active XLs, effective archive/material bindings and fresh framework logs. Capture lossless frontal and three-quarter frames with camera/FOV and lighting; if the game permits stable brow/lash Off controls at the same pose, capture those too. Match the browser's saved-brow study by eye/nose landmarks before measuring. Compare silhouette and edge occupancy separately from darkness/underlying skin, and lash coverage separately from RGB and sorting. The current browser study uses a 30° vertical FOV, 481×720 crop and exposure 1.20, but equal FOV alone does not guarantee equal projection. Existing unmatched screenshots do not justify a source texture, alpha or tint change. [Brow source boundary](../research/eye-artistry/brown-ombre-gradient-equivalence.md), [lash material boundary](../research/eye-artistry/lash-material-followup.md).

## Diagnostic staging and promotion tools

Reference for the tools that prepared the current diagnostic profile. None of them launches MO2 or the game, switches MO2's selected profile, updates frameworks or proves runtime behaviour. Keep their JSON plans, receipts and journals private and ignored; they include local paths and hashes.

### Runtime diagnostic planner

The read-only [runtime diagnostic planner](../projects/xf-studio/authoring/tools/runtime-diagnostic.ts) checks a selected candidate's exact archive/XL hashes, the selected MO2 `modlist.txt`, installed framework metadata and exact archive filenames in enabled mods and the direct game folder. Dry-run is the default. `--stage` is a separate explicit action that copies selected profile metadata (including `plugins.txt` and `loadorder.txt` when present) into a **new private scratch MO2 root**, changes only that copied modlist to enable a dedicated XF Studio entry and disable the old XF Eye Artistry development entry if enabled, and uses the [trusted paired-file transport](../projects/xf-studio/authoring/src/mod-install-transport.ts) to install only into the scratch root. The scratch root contains no copies of the other enabled mods, so it is a reviewable staging artifact, **not a launchable MO2 instance**. The planner does not compare archive members inside other mods, resolve ArchiveXL merging or prove runtime winners.

From `projects/xf-studio/authoring`, run it with private absolute path values and a **new** staging directory beneath the ignored `data/runtime-diagnostic/` folder. Review its JSON before repeating the same command with `--stage`:

```powershell
bun tools/runtime-diagnostic.ts --candidate-store $candidateStore --candidate-id $candidateId --game-root $gameRoot --mo2-root $mo2Root --profile $profileId --staging-root $stagingRoot
```

### Diagnostic promotion tool

The [diagnostic promotion tool](../projects/xf-studio/authoring/tools/runtime-diagnostic-promotion.ts) reads an existing scratch stage and defaults to a **read-only** preview printing the exact new profile and dedicated-mod destinations plus every copied file's source, target, byte count and SHA-256. Recreate any scratch stage made before the planner began copying `plugins.txt`/`loadorder.txt`. Supply a **new** profile name; the source profile name is rejected, and any case-insensitive collision with a profile or dedicated XF Studio mod folder blocks the operation. It rechecks source candidate and staged payload hashes, the staged transport receipt, copied source profile metadata and current direct/enabled-MO2 filename collisions. `--promote` creates only those two new directories and writes a private journal/receipt beneath the stage. `--recover` resolves a partial transaction only when created files still match; `--rollback` removes only an unchanged completed promotion. Added or edited files stop removal for review.

Run the preview with the same private roots used for staging plus the proposed profile name, review the printed paths and hashes, and confirm MO2 is closed before an explicit `--promote`. Keep the journal/receipt with the stage until the diagnostic is finished. If a prior attempt left a journal, use `--recover` before retrying; if promoted files have changed, inspect them instead of forcing rollback.

```powershell
bun tools/runtime-diagnostic-promotion.ts --candidate-store $candidateStore --candidate-id $candidateId --game-root $gameRoot --mo2-root $mo2Root --profile $profileId --staging-root $stagingRoot --new-profile $newProfileId
```

### Staging record

- **24 September dry-run:** the private four-preset candidate from the relocated project `dist` and profile `2025 (again)`: four presets, 16 independently verified unpacked resources, zero omissions, 920 enabled source mods, the legacy Eye Artistry development mod enabled, and **zero exact archive filename conflicts**. A separate ignored scratch stage then copied the same hashed pair and a profile that disables the legacy selector and enables XF Studio; the live modlist hash stayed unchanged. The old Eye Artistry declaration uses a different customization resource path than the new collection; coexistence and effective archive ordering are still runtime questions.
- **25 September promotion:** after fixture and source checks, the candidate was promoted into the new `XF Studio diagnostic 2026-09-25` profile and dedicated `XF Studio` mod. The source `2025 (again)` modlist hash stayed unchanged, the promoted archive pair hashes matched the manifest, and the completion receipt was present without a pending journal. Current stable frameworks were installed side by side into versioned mod folders enabled only in that profile. Neither MO2 nor the game was launched.
- **Installed versions:** the original profile's MO2 metadata remains ArchiveXL 1.26.3, TweakXL 1.11.3, Codeware 1.20.3 and redscript 0.5.31. The latest inspected 16 September RED4ext log reports game 2.31, RED4ext 1.30.0, ArchiveXL 1.26.3, TweakXL 1.11.3 and Codeware 1.20.3; those describe a **past** session, not the next launch. See [toolchain](toolchain.md#runtime-evidence-and-current-stable-releases).
