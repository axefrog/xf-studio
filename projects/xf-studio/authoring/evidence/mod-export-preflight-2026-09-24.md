# Mod export preflight message — 24 September 2026

A manual Check game package attempt with Glitter showed a source stack trace. The compiler correctly rejected the finish, but Python's stderr was passed through the local server as the user-facing message. The old label and its placement inside collapsed collection/library options did not explain how finish choice affected export.

The local server now checks active, nontransparent layers with the same finish rule as the flat compiler before invoking the Python tool. Both Check mod export and Build mod files return `422` with `code: unsupported_finish`, a short message naming the finish, preset and layer, the supported Matte/Satin/Metallic finishes, and the action to change or disable the layer. The validated draft is unchanged; this path creates no work directory and never calls the package runner or promotes files. Disabled and zero-opacity experimental layers retain their existing compiler eligibility. The server logs the full preset/layer IDs, names and finish; unexpected tool stderr stays in the server log instead of appearing as a source trace in the interface. The compiler's Glitter guard remains intact.

The current interface puts collection export, build-plan export and the newly named mod-file actions together in the collection area, outside the collapsed saved-library details. Nearby text explains that mod files are for Cyberpunk, builds use the current draft, only flat finishes export at present, and a local build does not install or game-test the result. A note beside Finish connects preview-only choices to export eligibility. Existing element IDs and action wiring are retained.

Verification in the isolated worktree:

- 11 focused package/CLI/compiler tests passed. A test passes unsupported Glitter and Shimmer through both server actions and asserts that the runner is never called; another verifies disabled/zero-opacity layers do not trigger the guard.
- TypeScript check and browser bundle passed.
- A separate localhost server on port 49317 served `/?verify=1` with the renamed actions. Real same-origin requests using the fixture with an enabled Glitter layer returned `422 unsupported_finish` for both `check` and `build`, each with the concise message naming preset “Verification — metallic copy” and layer “Petal wash”. The server log retained structured diagnostic details. This was an HTTP/page-content smoke check, not a visual click-through or game runtime test.
