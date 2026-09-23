# Research queue

| Priority | Work item | Status / trigger |
|---|---|---|
| 1 | Complete XF Studio makeup tasks | Editor, materials, plate and export work remain first. |
| 2 — after makeup | [Eyebrow shape and brow/lash colours](preview-fidelity.md) | Investigate thinner in-game brows and reproduce the saved colours. Explicit next priority. |
| 3 — after brows/lashes | Optional hair-mesh preview | Resolve the saved hairstyle and colour, with a visibility toggle. Preview is authorized; hair authoring remains a later discussion. |
| Thereafter | [CCXL and character-creator capability map](ccxl-character-creator-capabilities.md) | Pull forward findings when they unblock current makeup work. |
| Thereafter | Photo Mode Tools engine/API audit | Other queued work after the above priorities; see project README. |
| Required for XF Studio | [Makeup finish families and glitter](glitter-material.md) | Seven recognizable finish families; prove mixed-finish preset compilation and game/browser effects. |
| Current product | [Preset library and compiler](../../projects/xf-appearance-studio/data/product-direction.md) | Editable SQLite collections and portable export implemented; one-selector archive verified offline. Plate clearance, optical adapters and runtime proof remain. Later feature categories require discussion before building. |
| Requested; no assigned priority | [Preview fidelity and persistent workspace](preview-fidelity.md) | Actual modded eyes, adjustable FOV, all UI/camera state, imported-V reload fix, and SSS/material artifact investigation. Screenshot references preserved locally. |
| Future direction; discuss before implementation | Quest design and other capabilities beyond appearance | The XF Studio rename leaves room for these; eye makeup stays first. See the product direction. |
| During rendering-fidelity pass | [wgpu and ray-tracing assessment](wgpu-renderer-assessment.md) | Nathan's source lead; verify native/browser capabilities, material benefits and measured cost before recommending a renderer change. |
| Lower priority | [Claude UI/UX overhaul](claude-ui-overhaul.md) | Explicit `claude` harness + Opus 5.5. Fully decouple UI from functionality BEFORE delegation; prerequisite not met, not dispatched. Cyberpunk 2077 aesthetic with freedom to rethink UI strategy. |

This is a durable work queue within the headquarters, not a scheduled automation or a separate Codex task. It does not create recurring runs. Nathan explicitly authorizes bounded parallel subagents; current research findings are integrated into the linked notes.
## Authoring and character rendering follow-up

The first [XF Studio](../../projects/xf-appearance-studio/authoring/README.md) now provides concrete exploratory work. Continue game-material adaptation, authentic blink extraction, richer procedural control, and [saved-V resource resolution](../eye-artistry/save-import.md). The decoded save is a useful input to the CCXL boundary study. Old Eye Artistry content/identities may be discarded; legacy parity is not required.

The [persistent authoring queue](eye-artistry-authoring.md) tracks optional head details, direct live editing on the model surface, saved-V assembly, material/blink fidelity and richer procedural controls. A first direct surface-editing implementation is now verified; richer controls and fidelity work remain. Required glitter development has its own research task above.

- [Viewport and editor controls](viewport-and-editor-controls.md): idle pause/subsets, stable-head facial motion, FOV/zoom/pan ergonomics, compact layers, rename and live reorder feedback.

- [Path, falloff and surface controls](path-and-falloff-controls.md): nearest-curve insertion, single-eye UV view, weight seams, Bézier/corner handles, directional softness and overlay handles.
