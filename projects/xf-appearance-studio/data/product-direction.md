# Studio-authored presets and one in-game selector

User decisions, 2026-09-23. This supersedes the original four in-game layer selectors and the palette/design/finish option matrix. Eye makeup is the only feature currently authorized for implementation.

Product name: **XF Studio**, formerly XF Appearance Studio / XF Eye Artistry. The broader name leaves room for future capabilities such as quest design; that is a future direction to discuss, not a current implementation task or a revival of the old xf-omega toolbox. Eye makeup remains the current focus. See [naming and compatibility](naming.md).

## User workflow

1. Author as many named eye-makeup presets as desired in the studio. Each is an editable composition of shapes, layers, colours, finishes and order.
2. Keep the collection in a local SQLite library. Preserve portable recipe import/export for sharing and backup; browser drafts remain a recovery convenience.
3. Choose a collection to compile into a personal game mod. Generate only actual authored presets, reuse identical assets, and never enumerate all possible combinations.
4. One character-creator selector switches between complete eye-makeup presets, including an Off choice. Internal layer count is not the in-game selector count.

“Any number” means no arbitrary small product catalogue cap. Actual CCXL option, atlas, memory and export-size limits need measurement. The current recipe has four authoring layers; variable layer count is separate future schema work, not an in-game requirement.

Additional explicit, nonurgent authoring requirement: users can add/remove layers and drag to reorder them. Presets appear ABOVE their layers as an accordion, with add/remove, rename and reorder operations; do not use a preset dropdown in the intended UI. The current dropdown library is a functional first slice only. Variable layer count, collection order, stable identity and recoverable removal must be supported by the core before the future UI redesign consumes them.

## Compilation contract to prove

The desired output is a merged, multilayered material for each preset where the engine can represent it faithfully. Do not assume REDengine's named multilayer system supports cosmetic decal transparency or distinct overlapping reflectance lobes. Explore one material with baked channel maps, compatible-layer flattening, and a small set of coordinated components if needed. Preserve coverage, per-layer finish and order; do not bake view-dependent glitter/specular highlights into colour textures.

Whatever its internal representation, a compiled look is one game selection. Prove switching A → B → Off removes stale components and persists correctly. Avoid a separate selector per colour, design, finish or layer. ArchiveXL expansion remains useful for reuse, but the older 15,680-case contract is a historical mechanism test, not the product target.

Stable library preset IDs must be independent of names/list positions. Plan stable export collection namespaces plus stable preset appearance IDs (`xfs_…`) and manifest records of source revision, compiler version, material adapter, dependencies and output hashes. Namespace exported collections so separately shared packs cannot collide. Updating/reordering a collection must not silently change the appearance associated with a saved selection. Test CCXL index/name persistence before committing the release format.

## Local library and portability

First implemented slice: named full-recipe snapshots, immutable saved revisions, optimistic conflict protection, explicit Save look / Save a copy / Open look, separate verification DB. Browser draft recovery and portable JSON files remain. No automatic migration or deletion of existing drafts.

Next: visible revision history/restore, library autosave with clear draft-versus-published state, thumbnails/tags/search, export collections, backup/restore, and bounded schema migrations. Large textures and derived meshes should be content-addressed files with hashes/provenance in SQLite, not repeated giant JSON/blob payloads. Regenerable caches are distinct from user-authored inputs. Portable bundles must contain owned source assets and recipes, and references/dependency reports for game/third-party assets.

Local development uses Bun + localhost. Desktop packaging should reuse the domain/compiler and library boundaries; filesystem/database operations stay outside the renderer. Electron and Electrobun remain candidates, not installed/chosen dependencies. See [desktop assessment](../../../research/authoring/desktop-packaging.md).

## Later features — discuss each before building

1. Eye makeup — current focus.
2. Piercings / earrings.
3. Eyebrows.
4. Cheek makeup.
5. Hair.
6. Facial expressions — static and animated photo-mode expressions; also explore introducing new/varied idle animations.
7. Tattoos — expand the preview to the full player body at this stage for full-body tattoos (formerly item 6).

Nathan explicitly authorizes an early, brief animation side quest: load the actual default character-creator idle onto the studio head, with an enable/disable toggle. Preserve the main eye-makeup work and resume it afterwards. This establishes animation playback infrastructure; it does not authorize building the full expression/animation editor before discussing that feature. Do not substitute an invented idle and label it the game default.

The same authored-preset workflow can inform those areas, but geometry/rigging/material/export needs differ. Existing brows/lashes are preview context, not authorization to build an eyebrow authoring product. Do not implement these later categories until Nathan and the agent discuss them.
