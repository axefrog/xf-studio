# Selection restoration parity audit

Verified 29 October 2026 against committed `52e52825` and this fix, using only guarded targeted tests. This is offline application evidence, not a browser or game test.

## What the session hash covers

[`look-history-parity.ts`](../../projects/xf-studio/authoring/tests/fixtures/look-history-parity.ts) hashes a log of dispatched edits, form and gesture transactions (commit, cancellation and empty), Undo/Redo, jumps, preset navigation/removal/restoration, then a reload. Each moment contains the recipe hash, active layer index, selected point, history state, timeline and Undo/Redo capabilities; action results are included too. The reload contains its initial moment and a walk of every Undo, Redo and two jumps. Walk states and jump results were themselves hashed, so comparing only the outer session fields was insufficient.

The [parity test](../../projects/xf-studio/authoring/tests/look-history-parity.test.ts) now also captures those raw walk moments. Its baseline injects a history service without selection capture through the existing public target interface; all other application code is identical. That baseline reproduces every original frozen session hash, including sessions started from stored workspace data. Every difference between baseline and current decoded output must be exactly an `active` or `selected` field in a recorded moment. Recipe hashes, results, history, labels, timeline positions/IDs, capabilities, counts and reload writability all compare equal.

Only after those checks passed were `session` and `sessionFromStored` updated in the [golden](../../projects/xf-studio/authoring/tests/golden/look-history-parity.json). The original hashes remain in `selectionBaseline` and are checked on every run. `histories` and every `stored` field retain their original values. This also proves unchanged stored byte counts and text hashes for the input fixtures.

## Case-by-case decoded differences

Selections below are zero-based `(layer, point)`. Both entry routes (fixture and standard stored form) produce the same differences in each case. Consequences carried through subsequent edits, preset navigation and reload are selection values only.

| Case | Jump to start: old -> new | Jump to middle: old -> new | Jump to last: old -> new | Reload walk | Changed selection fields in log / reload moment / walk |
|---|---|---|---|---|---|
| small | `(0,0)` -> `(2,3)` | `(0,0)` -> `(4,0)` | `(0,0)` -> `(4,0)` | 15 moments, two jumps | 14 / 1 / 15 |
| loose | `(0,0)` -> `(0,3)` | `(0,0)` unchanged | `(0,0)` -> `(4,0)` | 19 moments, two jumps | 6 / 1 / 20 |
| large | `(0,0)` -> `(2,2)` | `(0,0)` -> `(2,2)` | `(0,0)` -> `(12,0)` | 141 moments, two jumps | 15 / 1 / 279 |
| damaged | `(0,0)` -> `(2,3)` | `(0,0)` -> `(4,0)` | `(0,0)` -> `(4,0)` | 15 moments, two jumps | 14 / 1 / 15 |
| preferences | `(0,0)` -> `(2,3)` | `(0,0)` -> `(4,0)` | `(0,0)` -> `(4,0)` | 15 moments, two jumps | 14 / 1 / 15 |

The first changed moment is the jump to start: Undo crosses the newly added layer and restores the selection that preceded it. Redo/jumping forward selects the added layer. Earlier behavior fell back to layer/point 0 after that layer disappeared. The later selection differences are the retained consequences of those moves, including restored look memory and persisted history endpoints. No other observable difference was found.

## Other gate failures

- **Fixture type error:** `history-selection.test.ts` omitted required `selectedCollection`. It now supplies `() => "local"`, matching its local look. No production API changed.
- **CORE-03 synthetic/multi-part:** a content publication removes selected `second` and selects `first`. Undo now restores `second`; Redo restores `first`. Marker content, absent-part restoration, one notification per move and cross-part history are unchanged. Assertions now cover both endpoints and Undo after persistence.
- **CORE-03 compatibility document:** reversing the layers with active index 1 changes the selected layer from `layer-2` to `layer-3`, both at point 2. Subsequent navigation to `layer-4`, point 1 is not part of the publication. Undo now restores `layer-2`, point 2; Redo restores `layer-3`, point 2. Recipe restoration and preview reset checks remain. Only selection assertions changed.
- **Slice 6 registered editor:** point 1 was selected before Add layer. Undo now correctly restores point 1 instead of 0; Redo selects point 0 in the added layer. There is no extra selection publication: the test now requires exactly `selection, scheduled, structure, restore, restore` through Redo.
- **Rename/move/reset:** rename, move and their Undo already preserved point 3 correctly. Reset exposed a real bug: its captured pre-selection was invalid index 20 on six points, so replay parsing fell back to 0 instead of clamping to 5. Eye makeup's history selection projection now clamps at capture; the original expectation of point 5 is retained, and Redo is checked at point 11 on the reset contour. Workspace parsing is unchanged.

Only the session golden hashes and intended selection assertions changed. The reset issue required a production fix.
