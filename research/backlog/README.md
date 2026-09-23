# Research queue

| Priority | Work item | Status / trigger |
|---|---|---|
| 1 | XF Studio makeup material/mesh proof | Next implementation slice; see project README and validation plan |
| 2 | [CCXL and character-creator capability map](ccxl-character-creator-capabilities.md) | Explicitly requested by Nathan on 2026-09-23; queued. Pull forward its palette/UI findings when they unblock XF Studio. |
| 3 | Photo Mode Tools engine/API audit | After XF Studio's first makeup completion milestone; see project README |
| Required for XF Studio | [Makeup finish families and glitter](glitter-material.md) | Seven recognizable finish families; prove mixed-finish preset compilation and game/browser effects. |
| Current product | [Preset library and compiler](../../projects/xf-appearance-studio/data/product-direction.md) | SQLite first slice implemented; one selector, authored collections and merged-material study next. Later feature categories require discussion before building. |
| Requested; no assigned priority | [Preview fidelity and persistent workspace](preview-fidelity.md) | Actual modded eyes, adjustable FOV, all UI/camera state, imported-V reload fix, and SSS/material artifact investigation. Screenshot references preserved locally. |
| Future direction; discuss before implementation | Quest design and other capabilities beyond appearance | The XF Studio rename leaves room for these; eye makeup stays first. See the product direction. |
| During rendering-fidelity pass | [wgpu and ray-tracing assessment](wgpu-renderer-assessment.md) | Nathan's source lead; verify native/browser capabilities, material benefits and measured cost before recommending a renderer change. |
| Lower priority | [Claude UI/UX overhaul](claude-ui-overhaul.md) | Explicit `claude` harness + Opus 5.5. Fully decouple UI from functionality BEFORE delegation; prerequisite not met, not dispatched. Cyberpunk 2077 aesthetic with freedom to rethink UI strategy. |

This is a durable work queue within the headquarters, not a scheduled automation or a separate Codex task. No new task, worker or recurring run has been started.
## Authoring and character rendering follow-up

The first [XF Studio](../../projects/xf-appearance-studio/authoring/README.md) now provides concrete exploratory work. Continue game-material adaptation, authentic blink extraction, richer procedural control, and [saved-V resource resolution](../eye-artistry/save-import.md). The decoded save is a useful input to the CCXL boundary study. Old Eye Artistry content/identities may be discarded; legacy parity is not required.

The [persistent authoring queue](eye-artistry-authoring.md) tracks optional head details, direct live editing on the model surface, saved-V assembly, material/blink fidelity and richer procedural controls. A first direct surface-editing implementation is now verified; richer controls and fidelity work remain. Required glitter development has its own research task above.
