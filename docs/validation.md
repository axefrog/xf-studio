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

## Layer ordering: the main unresolved rendering hypothesis

Four normal-offset meshes may solve coplanar interference. However the inspected decal template has depth writes disabled, so the geometry alone does not establish which translucent/decal draw is blended last. Test selection order and camera movement as well as static overlap. Keep the standard material template as baseline. Do not add new shader-priority tricks just to force a result.

If offsets fail, investigate actual renderer component/pass ordering, existing decal controls and whether a supported ordering hook exists. Offline texture compositing is a fallback with a different UI/runtime cost model, not an automatic return to pre-generating every layered combination. Record why each alternative succeeds/fails.

## Instrumentation to prepare

- A tiny project-local diagnostic mod can log session/build IDs, registered layer options, selected IDs, component/morph/mesh paths, requested appearances and changes in selection order. First verify which fields/events are exposed; do not invent CET APIs.
- Prefer change-triggered, bounded logs and user-triggered snapshots over per-frame dumping. Use the CET kit's session/UI helpers or confirmed game events to isolate creation/photo-mode/gameplay transitions.
- ArchiveXL expansion/error logs are ground truth for resource resolution; RED4ext identifies loaded plugin versions; redscript logs identify compilation; CET captures the diagnostic callbacks. Use existing Red Hot Tools capabilities only after verifying installation/version/API support.
- Hot reload can shorten iteration, but not every cached resource, native DLL or CCXL registration can reload safely. Document the verified reload boundary before relying on it. Package several clearly labelled alternatives into a single diagnostic build where practical.
- `tools/capture_session.py --label <test-id>` copies relevant existing logs and the saved selected-profile mod list into a unique HQ folder with timestamps, sizes and hashes. It records both MO2 overwrite generations separately and flags files changing during capture. It does not launch or alter the game. The first baseline capture was successful: 13 files, zero changed during copy.

## Draft single-session test card

**Not ready to run yet:** no diagnostic mod or final plate build has been deployed. Fill in exact mod/profile/build IDs and capture controls when the small implementation slice is ready.

1. Launch the prepared profile once. Open the appearance editor using the agreed save/location; the logger records versions and test build ID.
2. Select the two high-contrast test designs on each layer. Test OFF/ON and reverse the order of selecting the layers. Use the provided fixed selector checklist so results are comparable.
3. Cycle labelled offset alternatives if the diagnostic build exposes them. Capture front, oblique and side views, plus close/normal camera distance. Check soft edges, glitter/specular behavior and visible intersection/floating edges.
4. Cycle a short set of facial presets/eye shapes selected from offline stress checks; blink/express/pose where available. Confirm makeup stays attached and retains coverage.
5. Test palette navigation and rapid alternating choices, then leave/re-enter the editor and inspect in photo mode/gameplay. Save to a designated test slot if needed; reload within the same process to check persistence, then restore the working selection.
6. Finish the session. Capture logs/screenshots with matching test labels; report only the visible outcomes the logs cannot establish.

A second cold-start session is justified only if first-load/cache/save persistence or a reproducible failure demands it. Batch follow-up questions and code changes before asking for another run. Existing logs can be mined while Nathan plays normally; a special session should buy multiple concrete answers.
