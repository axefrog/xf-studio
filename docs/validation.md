# Validation with minimal game sessions

Principle: answer structural and deterministic questions offline, instrument the remaining uncertainties, then ask Nathan for a small, prepared set of actions. Never turn every uncertain resource property into a fresh game-launch request.

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
- `tools/capture_session.py --label <test-id>` copies relevant existing logs and the saved selected-profile mod list into a unique HQ folder with timestamps, sizes and hashes. It records both MO2 overwrite generations separately and flags files changing during capture. It does not launch or alter the game. The first baseline capture was successful: 13 files, zero changed during copy.

## Prepared single-session test card

**Not ready to run yet:** the current four-preset [collection package](../experiments/005-preset-collection/README.md) passes offline resource checks but has not been installed, and no plate clearance correction has passed every release gate. A game session must not be inferred from the archive round-trip. Before scheduling one, pin the exact package/manifest and profile IDs, confirm the intended MO2 launch route and effective archive order, update the installed framework versions listed in [status](status.md), and make a recoverable test save. Record the versions observed in runtime logs separately from installed metadata. Add a diagnostic logger only after confirming the actual available APIs and testing that its output stays bounded.

1. Capture a pre-launch snapshot of the selected profile, conflicting resource paths and existing logs. Record the exact package identity and the game/build/framework versions actually loaded.
2. In the character creator, check the single XF Studio eye-makeup selector with **Off** and each of the four authored verification presets in `editor-collection.json`: Metallic copy, Reload persistence, Collection B and Collection A. Switch A → B → Off, then B → A → Off; check that a choice replaces the complete prior look, that Off clears it, and that reselecting a look does not retain hidden prior components. Names and order must be read from the pinned build manifest if they change before the session.
3. Capture matched front, oblique and side views at close and ordinary camera distances, under at least two useful lights. Check soft edges and lower-mip appearance while zooming, surface attachment, overlap, and any eyelid/crease contact. This flat-finish fixture cannot validate Glitter, shimmer, gloss or colour shift; those need separately identified material fixtures when ready.
4. Exercise a small offline-selected set of eye shapes and facial poses, including blinks and the creator idle. Record the exact preset/pose and camera state for any contact, floating edge or texture mismatch. Compare brow/lash and hair preview fidelity only with matched in-game choice, lighting and camera; do not infer a geometry defect from unmatched photographs.
5. Leave and re-enter customization, inspect photo mode/gameplay if available, and reload a designated recoverable test save to check selector identity and persistence. Reorder/removal behavior needs a separately prepared compatible update, not an ad hoc change to this first fixture.
6. Capture post-session logs and screenshots with the same package/profile label. Separate what the game visibly rendered from archive expansion logs, source-derived expectations and offline verifier results.

One prepared run should answer several runtime questions. A second cold start is warranted only if first-load/cache/save behavior or a reproducible failure requires it. Keep any source or screenshot evidence local until its redistribution rights are clear.
