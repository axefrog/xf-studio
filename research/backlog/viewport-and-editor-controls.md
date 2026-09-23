# Viewport and editor controls

Nathan's additional requests, 23 September 2026. Preserve these independently of conversation history. Preset/collection functionality is now checkpointed. Layer compactness, rename and reorder feedback were completed alongside it; camera and animation items remain queued.

- **Pause/resume idle:** separate from the existing disable/reset toggle; pausing must hold the current body and face pose/phase and resume from there. Persist the paused state across reloads.
- **Idle subsets:** inspect source channels and expose meaningful independent motion controls, especially a stationary head while gaze, eyelids, mouth and other facial motion continue. The two decoded clips and inherited bone drivers need inspection; do not freeze facial children accidentally or describe approximate channel separation as engine graph parity. This extends the authorized early idle-preview work, not full expression authoring.
- **FOV-aware zoom range:** narrow FOV currently reaches the fixed minimum orbit distance too early. Define zoom in terms of useful projected editing scale, account for the face surface and near plane, and retain a usable close-up at narrow angles.
- **Keep framing while changing FOV:** adjust camera distance coherently around the orbit target to preserve apparent scale where possible. Do not silently change pose/orientation or reset framing. Perspective changes remain expected when focal length and distance change.
- **Layer reorder feedback:** show an obvious live insertion position and dragged-row state during movement, including edge scrolling/cancellation and keyboard alternatives. **Completed:** floating Move label, bright insertion line, dimmed source, edge scroll and Escape/pointer cancellation; up/down alternatives remain. Actual held-pointer browser verification showed the feedback before dropping.
- **Compact makeup layers:** **Completed:** rows reduced from about 89 to 46 px, with secondary actions in the ⋯ menu while selection/visibility remain direct.
- **Layer rename discoverability:** **Completed:** each row’s ⋯ → Rename selects the layer and focuses/selects the Layer name field. Stable IDs, workspace persistence and Undo are retained.
- **Pan:** **Existing gesture verified and documented:** right-drag pans; the on-screen hint now explains it. Camera and target translate together and survive reload. See [camera findings](../authoring/camera-control-findings.md). A more visible pan mode remains an optional refinement for narrow viewports. Inspect current OrbitControls bindings, preserve target/camera together and persist framing. Do not confuse orbit with pan or break direct surface dragging. Consider a visible mode/gesture hint in addition to the mouse shortcut.

Verify gesture feedback in the isolated browser, camera/motion state across reload, and relevant source animation composition offline. Avoid using Nathan's active draft for tests.

[Idle control design](../animation/idle-controls-design.md) now identifies validated body/facial composition boundaries and pause/framing invariants. Camera/FOV findings are linked above; these remaining controls are not implemented yet.
