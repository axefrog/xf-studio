# Open questions for the model review

Design decisions made while writing the catalogue, or left open, each with a recommendation. The coordinator's model review settles them; a settled question moves into the models (or the README) and leaves this list.

## Format

1. **Members the README didn't list.** The catalogue needed a few members beyond the README's first table: a field spec's `doc` and `shape`, a type's `migration`, a driver's `raises`, a process's and request's `faults`, a runtime's `environment`, an action's `name` and `input`, and a request's `root`. The README now lists them. *Recommendation:* keep them; they carry what the development loop asks a model to state (the migration, what a driver raises, the payload a script sends, where demand starts).
2. **How `replaces` names modules.** Module paths under `src/` without `.ts`, the same spelling the ratchets use, with `../` for modules outside `src/` (`../server`, `../desktop/main`). The test checks each one exists. *Recommendation:* keep.
3. **Root requests.** Four requests are raised from outside the graph (opening a window, the operating system starting the host and the desktop shell, a native close) and carry `root: true`; the test checks that every driver is reachable from a root or from an action through what drivers raise, which is the "every active node's demand traces to a driver" question made mechanical. *Recommendation:* keep, and extend it to processes once the engine records reasons.
4. **Engine gaps as plain capability keys.** Each `x-friction` item names one of 27 plain capability keys defined in `tools/models-index.ts` (INDEX.md ranks them). The keys are this catalogue's own plain words. *Recommendation:* review the key list once; later gaps reuse a key or add one there.
5. **Action variants.** Actions with named variants (`camera.navigate`: orbit, dolly, pan; `layer.edit`: add, duplicate, remove, reset, rename, move) list the variant names in their input's description but don't spell each variant's payload. *Recommendation:* generate the variant schemas from the action descriptors when the conformance check between models and registered code arrives, rather than by hand now.

## Coverage

6. **Sources replace reads, drivers replace behaviour.** Each source's `replaces` lists every ratchet module whose reads of its kind it takes over (the page clock replaces the page modules' `Date.now` and timers), in addition to the drivers, types and operators that take over those modules' behaviour. Coverage of the ratchets is therefore complete by construction, and the check can't tell a module whose behaviour no model has claimed. *Recommendation:* keep, and when a slice starts, check that each module it empties is also named by a non-source model.
7. **False positives in the direct-read ratchet.** Four host modules (`resolver-host`, `native/native-fetch-port`, `resource-graph`, `expressions-game-prerequisite`) are counted as network readers because they call a `.fetch(` method on the archive resource port. They read game archives, which the installation, decode and WolvenKit models cover. *Recommendation:* narrow the ratchet's network pattern to the global `fetch`, as its own small fix.
8. **Excluded modules.** The render-fidelity study, its brow fixture and the two style guide demo pages are excluded from coverage (see `coverage-exclusions.json`). *Recommendation:* agree, or move the study out of `src/`.

## Types

9. **A layer as a map of members.** A preset's `layers` is a map from layer ID to a map from member name to value, so a fork overrides one member of one layer (the colour, not the whole layer). The layer's shape is described in `shape`, because a map's values share one field spec. *Recommendation:* keep; if typed per-member field specs are wanted, that is an engine change (map entries as records).
10. **Order as a separate list.** Layer order and light order are `order` lists beside their maps, with `x-friction` for an ordered map with moves. *Recommendation:* keep until the engine has one; consumers key by ID either way.
11. **Settings as a node.** Host settings become a node, and the verification library's settings a fork of the real ones. That needs the host to run a graph that shares nodes with the page, and two libraries side by side. *Recommendation:* until then, keep settings as a host file read through a source, with the model's status `both`.
12. **Diagnostic mode moves into host settings** instead of a separate host file. *Recommendation:* agree.
13. **Clothing as its own undo scope** over the V's clothing fields, overlapping the character scope (today's `undoClothing`). *Recommendation:* keep both, as field-level scopes.

## Undo scopes

14. **Which history owns what.** Eye shape, material studies and the uncensored mode go into View and lighting (they change what a view shows); motion settings, transitions, view tools, poses and the texture tier have no Undo, as today. *Recommendation:* confirm with the maintainer; motion is the one most likely to want View and lighting.
15. **Library edits have no Undo.** Renaming a mod, editing its package plan and trashing presets record no step (trash is restorable for 30 days). *Recommendation:* keep for 1.0; a `library` scope can come with presets in the database.

## Drivers, processes and requests

16. **Drivers the inventory didn't have.** The catalogue adds a page `preview-setup` driver (the setup state machine needs a lifetime of its own, tied to the card being shown), a host `lut-host` (extraction per installation), `asset-export` (one export per key shared by every asker), `picture-store`, a page `poses` driver, a host `library` driver (the store's host side) and a planned `save-writer`. *Recommendation:* keep; each owns work that otherwise had no responsible driver.
17. **Processes merged or added.** The native resource decode and the native decode are one process; the pose sample has one owner (`pose-sample`), with motion raising a request for it; saving pose favourites is a commit, not a process; `store-load` is added, since the store must load as well as append and sync. *Recommendation:* agree.
18. **Migration runs on the host.** The one-time migration is a host driver, with the first window sending the legacy workspace text in its request, because the library tables live there. *Recommendation:* keep; the desktop's workspace file is already host-side.
19. **Native decoding with WolvenKit as the fallback** is one request served by two ranked drivers. *Recommendation:* keep; it is the model for every "try the next approach" case (the feminine head is the other).
20. **Recovery queue and "open" go away.** `collection.recover` and `collection.undoOpen` stay `current` only; in the target the store's pending copy is the recovery and opening a mod is navigation. *Recommendation:* agree, and keep the recovery queue until pending changes are durable.

## Engine

21. **Synchronous runtime queries.** Picking on the head (`operator:hit-target`) asks a runtime synchronously inside the input's cycle. *Recommendation:* sanction a query port on runtimes that returns plain data only, with a budget per query.
22. **Faults to `person` and `diagnostics`** end at the window's `diagnostics` driver through the `report-failure` request. *Recommendation:* keep until the engine routes faults along the request chain itself.

## Model review decisions (29 September 2026)

The coordinator's model review accepted the catalogue with these decisions. Each is a coordinator default that the maintainer may reverse.

| # | Decision |
|---|---|
| 1–3 | Accepted as recommended. Root requests extend to processes once the engine records reasons. |
| 4 | The 27 capability keys are accepted as the catalogue's plain vocabulary. |
| 5 | Variant schemas are generated from the action descriptors when the models-to-code check arrives. |
| 6 | Accepted. Each slice checks that the modules it empties are named by a non-source model. |
| 7 | Narrow the direct-read ratchet's network pattern to the global `fetch` (a small fix of its own). |
| 8 | Agreed. The render-fidelity study moves out of `src/` when it is next touched. |
| 9–13 | Accepted as recommended. Order lists stay until the engine has ordered maps. Settings stay a host file until the host runs a graph. |
| 14 | Eye shape, material studies and uncensored mode go into View and lighting. **Motion settings (idle, blink, physics, pause) stay without Undo**, like transitions, view tools, poses and the texture tier. They are ordinary data, modelled like any other; the history a person is shown is a selective policy over that data (each action's `undo`), and it shows the work they have done, not adjustments to how a view is watched. What is kept persistently is a separate selective policy, which the catalogue doesn't model yet. |
| 15 | No Undo for library edits in 1.0; a `library` scope comes with presets in the database. |
| 16–20 | Accepted as recommended. The recovery queue stays until pending changes are durable. |
| 21 | Sanctioned: runtimes offer a synchronous query port returning plain data only, with a per-query time budget. It is part of the engine library's runtime families. |
| 22 | Accepted until the engine routes faults along the request chain. |
