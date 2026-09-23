# XF Appearance Studio: scope and naming

Current product model is [one selector for complete authored presets](product-direction.md). The per-layer appearance names below are historical mechanism examples; they do not mandate multiple in-game selectors. Preserve `xfas_` for all new app/mesh appearances; the final collection/preset namespace and save-stability contract need proof.

User decisions, 23 September 2026: rename XF Eye Artistry to **XF Appearance Studio**, allow broader appearance editing and potentially full-body work later, and prefix generated archive appearance names with `XFAS` or `xfas` for recognizable provenance and reduced collision risk. Canonical implementation spelling is lowercase `xfas_`.

- Owned project: `projects/xf-appearance-studio`; package/archive stem: `xf-appearance-studio`.
- Owned depot root: `axefrog\appearance_studio\`. All new resources should live here unless an engine integration explicitly requires another location.
- App appearance example: `xfas_eye_layer1__xfas_e01+000+matte`.
- Corresponding expanded mesh appearance: `xfas_e01+000+matte`. Prefixing only the app scope would leave the mesh appearance unbranded; both are covered.
- Explicit appearance templates and generated fallback appearances must also use `xfas_`. Audit generated appearance fields before packaging; an engine-required literal must be investigated explicitly rather than silently exempted.
- Keep `__`, `+` and `@` for ArchiveXL syntax. The example is a format study, not a commitment to old design IDs, the old catalogue or a fixed palette size.
- Referenced game/third-party appearances, original Blender resource names and identifiers read from existing saves retain their original spelling. These are inputs, not new XFAS appearances.

Eye makeup is the first milestone. Other facial details, configurable asset sources, full saved-V rendering and eventual body authoring can build on the editor and material research; none should be described as finished merely because the scope expanded.

The editor retains `eye-artistry/recipe-1`, `eye-artistry/saved-v-1` and its existing browser draft keys as versioned compatibility identifiers. Renaming these for branding alone would risk existing work. UI and new download filenames use the new name. The active browser draft is not modified or reloaded during this rename. Historical inventory, evidence and research filenames retain their original context; active project links point to the new directory.
