# Trusted-bootstrap browser smoke check — 24 September 2026

The main-branch build after the trusted core/bootstrap extraction ran from a separate local server on port 4322, with a disposable data directory and `?verify=1` browser storage. Nathan's active draft and library were not used.

The page loaded the actual head and expanded plate and reported Ready. Adding a fifth layer enabled Undo; one Undo restored the original four layers and disabled Undo. Switching the UV pane to Single eye enabled Other eye, and a reload restored Single eye and the four-layer draft. The head and plate returned to Ready after reload. The browser error/warning log was empty. The isolated tab and server were closed after the check.

This verifies the current UI still boots and uses its newly routed actions. It does not exercise a replacement browser entry, a saved-V picker, package build, or game rendering. Those remain in the [handoff acceptance](ui-handoff-acceptance.md) and [architecture gate](ui-architecture-boundary.md).

After the browser viewport and file/workspace device extractions were merged, the same isolated server and verification route were run again. The real head and expanded plate reached Ready, workspace autosave reported success, the previously selected Single eye UV mode restored, Other eye remained available and responded, and the browser warning/error log was empty. The combined authoring branch passed 327 tests, type check and build. This check did not bypass the browser extension's earlier file-picker automation limit or prove the alternate presentation can start without legacy controls.
