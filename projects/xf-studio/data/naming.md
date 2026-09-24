# XF Studio: scope and naming

Latest user decisions, 23 September 2026: **XF Studio** supersedes XF Appearance Studio and XF Eye Artistry. New generated resources use **`xfs_`**, replacing the earlier `xfas_` prefix. The broader product name leaves room for capabilities such as quest design, while eye makeup remains the first delivery area. Future feature implementation still requires discussion.

The current product model is [one selector for complete authored presets](product-direction.md), not the historical four-selector matrix.

## New generated game resources

- Every new app and mesh appearance starts with lowercase `xfs_`, including explicit templates and generated fallback appearances.
- A collection UUID produces `xfs_c<uuid-without-hyphens>`. A preset UUID produces `xfs_p<uuid-without-hyphens>`; the requested app appearance is `xfs_c<collection>__xfs_p<preset>`.
- Off is `xfs_off`; the shared app template is `xfs_c<collection>__xfs_template`.
- New collection packages, selectors, components, texture filenames and resource basenames use the same prefix. The collection builder derives filenames from its export plan so resource references stay aligned.
- Keep `__`, `+` and `@` where required by ArchiveXL syntax. Display names, revisions and list order do not change UUID-based identities. Actual game save/index persistence across collection changes still needs runtime proof.
- Referenced game/third-party appearances and identifiers read from existing saves retain their original spelling. These are inputs, not new XFS appearances.

## Compatibility and historical evidence

The technical project directory is `projects/xf-studio` as of 24 September 2026. The game depot root remains `axefrog/appearance_studio/`; changing a repository directory does not rename deployed resource paths. Existing package/health identifiers and the `XFAS_DATA_DIR` setting also remain compatible.

Keep serialized IDs (`eye-artistry/recipe-1`, `eye-artistry/saved-v-1`, `xfas/collection-1`, `xfas/export-plan-1`, `xfas/workspace-1`), browser storage keys and SQLite data unchanged. Existing collections load and compile into the new XFS namespace; they need no manual conversion. Visible UI, errors and new recipe/mask download filenames use XF Studio / XFS.

Earlier experiments, captured results and the owned source plate `xfas_eye_plate.blend` retain their original names. Experiments 001-004 are historical studies, not current release generators; their XFAS fixture outputs remain reproducible. Experiment 006 continues using those geometry controls. Experiment 005 is the current collection packaging path and emits XFS resources from the historical plate input without modifying it.

No XFAS package from these experiments has been installed or released. This is a pre-release namespace change, not a migration guarantee for an installed XFAS mod: old and new archives must not be co-installed as an upgrade strategy. Preserve prior build outputs and their hashes; record new validation separately. Do not replace names inside old evidence as though those tests originally used XFS.

Functional format update: variable layers deliberately introduce `xfs/recipe-2` (0–32 layers). This is a data-contract change, not a cosmetic rename. Legacy four-layer `eye-artistry/recipe-1` input remains supported and normalizes in memory; stored old SQLite revisions are not rewritten. New saves/exports use recipe-2, which older studio builds cannot read. Other IDs and keys above remain unchanged.
