# One-selector authored preset collection

**Status:** active — it compiles authored preset collections into an offline-verified local archive plus ArchiveXL registration for one selector; a promoted four-preset (Matte/Metallic/Off) package is staged in a diagnostic MO2 profile for the first in-game smoke test, which has **not** happened yet ([runtime preflight card](../../research/authoring/first-makeup-runtime-preflight-2026-09-25.md)).

Two editable authored looks, **Violet ink** and **Copper edge**, compile into an actual local archive plus ArchiveXL registration. Each combines two overlapping layers. One character-creator appearance control lists **Off**, Violet ink and Copper edge. This is an offline-verified fixture, not a deployed or render-verified release.

The current builder rejects a generated resource tree that differs from the collection plan before WolvenKit packs it. Canonical relative paths, supported extensions, unique 64-bit depot hashes and each payload's SHA-256 are recorded in `build.json`; the independent verifier checks the source tree and exact unpacked member set again. [Local package boundary](../../research/authoring/local-package-build.md) explains how this gate fits the private Studio export.

Naming update, 2026-09-23: the current generator and verified rebuild use **XF Studio / `xfs_`** for appearances, selector/component names and generated resource filenames. Existing `xfas/collection-1` input files still load. The plate source retains its historical filename; output filenames are derived from the plan. The verifier checks the new prefix, label and resolved references in converted resources, and compares all unpacked payloads. The selector label is the mod's own name, **XF Eye Artistry**, taken from the export plan's `selectorLabel` (defined once in [`src/mod-branding.ts`](../../projects/xf-studio/authoring/src/mod-branding.ts)). Builds made before 25 September's branding change carry `XF Studio · Eye makeup`; their recorded results are unchanged. Earlier XFAS results remain in Git history at `382f227` and the preserved local build `generated/build-1790130339455979000`; they were not rewritten in place. See the [naming contract](../../projects/xf-studio/data/naming.md).

## Current editor-to-archive check

The latest result uses [four synthetic verification presets authored and ordered in the actual studio](editor-collection.json), saved through the isolated SQLite collection API and exported as a collection snapshot. It contains 12 textures, 4 mesh appearances and 5 selector options including Off, with the same shared material/component design. All 16 unpacked resources verify; the supplied-mip archive is **847,872 bytes**. The original two-look fixture remains [collection.json](collection.json), and its 831,488-byte earlier build is preserved at `generated/build-1790133575399258000`. Rebuild locally before running the revised verifier against a prior build pointer. No personal save, decoded appearance, game asset or SQLite database is included in the source fixture.

## Original fixture structure

- One shared mesh/morph pair containing the owned neutral expanded plate and all 105 facial customization shapes.
- One embedded `@preset` material template using the authoritative `mesh_decal.mt`; no modified material-priority template.
- Six textures: diffuse/coverage, roughness and metalness for each authored look. Only selected combinations are compiled.
- Two `.app` definitions: an exact empty Off appearance and a shared morph-skinned component template. ArchiveXL expands requested stable preset suffixes into that template.
- Two lightweight mesh appearance entries: one provides the shared chunk template and the other expands it. Explicit stubs avoid depending on unproven native missing-appearance fallback; they do not duplicate material instances.
- One `.inkcharcustomization` control with three options and one `.xl` customization/scope registration.

The original fixture archive was **831,488 bytes**, containing 10 resources; the current editor-run counts are above. Its paired `.archive.xl` is outside the archive, in the standard `archive/pc/mod` package layout. [Result and hashes](result.json), [latest local build pointer](latest-build.json), [editable fixture](collection.json). Generated binaries/texture exports remain under ignored `generated/`; nothing was installed or pushed as game payload.

## Reproduce

Requires the current locally built experiment 004 plate, WolvenKit CLI 8.17.4, Bun and Python/Pillow/NumPy. Paths are explicit in the scripts. From HQ:

```powershell
python experiments/005-preset-collection/build.py --collection experiments/005-preset-collection/editor-collection.json
python experiments/005-preset-collection/verify.py
```

The Studio app has TypeScript ports of `mip_maps.py`, `archive_inventory.py` and an independent port of `verify.py`, which reproduce these programs' output (see [Build pipeline port](../../research/authoring/studio-to-mod-pipeline.md#build-pipeline-port)). The product Build still runs the Python programs until the orchestration is ported. These Python programs remain the research oracle.

`build.py --collection <collection.json>` accepts another validated `xfas/collection-1` collection. Each build gets a new output directory, preserving prior outputs. The independent verifier follows the latest successfully completed build. No runtime install action is part of either command.

`create_fixture.ts` reproduces the checked-in two-look example from the studio's initial recipe. It is not required for normal rebuilds and is not a user-library migration. The [collection domain module](../../projects/xf-studio/authoring/src/preset-collection.ts) validates snapshots and derives resource identities; the [bake adapter](../../projects/xf-studio/authoring/tools/bake_collection.ts) writes the material inputs. The accordion editor and SQLite collection store now feed this same contract; its source export remains separate from installable packaging.

## Evidence and limits

The verifier inspects **round-tripped binary resources**, including the compiled component package and its hard-transform/skinning bindings. It checks an empty Off, a named override, one enabled selector, definitions/labels, dynamic Soft resource paths, texture dimensions/gamma/mip/compression settings, unchanged mesh/morph buffers and all 105 targets. It then unpacks the final archive and compares every depot path and SHA-256 to the source payload.

The compiler's exact base pixels are retained. Packaging now supplies a complete, project-authored DDS chain whose lower levels average **premultiplied mesh-decal destination contributions** before converting back to diffuse square-root alpha, colour, roughness and metalness. WolvenKit imports those levels with mip generation disabled. The verifier decodes every compressed XBM mip, checks the supplied chain, compares partial-edge coverage and material contributions against area-reduced source pixels, and retains the existing base-level and unpacked-archive checks. [Filtering study and measured limits](../../research/materials/flat-preset-mip-filtering.md). This improves mip texel centres; bilinear/trilinear sampling between centres, GPU sampler state, game rendering and perceived equivalence remain unverified.

The appearance component now has a deterministic 64-bit ID derived from its stable collection component name. Two independent rebuilds produced identical bytes for all 16 unpacked resources, and the verifier checks the serialized component ID and CRUID. The `.archive` bytes still vary because WolvenKit records current file-entry timestamps in its index; both builds independently verify and neither was installed. [Exact hashes and source trace](../../research/materials/flat-preset-mip-filtering.md).

Stable UUID-based appearance/resource names survive renaming, revision updates and collection reordering in unit tests. ArchiveXL regenerates option indexes; **actual game save behaviour across reorder/removal still needs runtime proof**. One collection currently creates one selector; combining multiple independently exported packs into one shared selector is not implemented.

Other open work: controlled plate clearance after packing, posed intersections, game A → B → Off clearing, appearance persistence and external conflicts, mixed-finish adapters (shimmer/glitter/gloss/colour shift), installable export UI. Matte/satin/metallic parameters are provisional. No runtime success is inferred from a source-derived resolver model or a valid archive.

## Community provenance

[ArchiveXL](https://github.com/psiberx/cp2077-archive-xl/tree/5474e34d56112f5d8843ae863e1e72ff510957c0), by psiberx and contributors, supplies the source-grounded expansion rules. Its garment hook calls customization fallback only when an appearance was not found, enabling a direct empty Off. The customization component fix reads the first override array; both generated definitions therefore contain that array, with no component overrides for Off. A named override on the shared template avoids the special single-unnamed-override path.

WolvenKit's appearance preprocessor/writer establishes how fresh component definitions become a binary RedPackage; actual CLI conversion confirms the resulting package and bindings. One initial conversion failed because new appearance handles collided with preserved mesh-buffer handles; generated handles now use a distinct range. The scripts inspect conversion logs as well as exit codes.

These lessons extend the [community credits](../../docs/community-credits.md). Historical Eye Artistry was a schema research reference; it is not an input to this clean build. Geometry derives from the owned plate pipeline and underlying CDPR head assets.
