# ArchiveXL expansion strategy for XF Appearance Studio makeup

**Product direction superseded, 2026-09-23:** the user now wants one eye-makeup selector switching complete studio-authored presets, not a design/colour/finish matrix or four in-game layer selectors. The mechanisms and measured legacy comparisons below remain research evidence; the proposed naming/palette contract is a historical experiment. New work follows the [preset compiler direction](../../projects/xf-studio/data/product-direction.md), compiling only authored looks and deduplicating resources.

Decision, 2026-09-23: design against **ArchiveXL 1.27.3**, the current stable release verified from the author's GitHub API. Installed 1.26.3 must be updated before runtime validation. The project explicitly prefers current releases and requires a larger palette; 49 colours is only the legacy comparison point, never a new product limit.

Evidence anchor: [release](https://github.com/psiberx/cp2077-archive-xl/releases/tag/v1.27.3), commit `5474e34d56112f5d8843ae863e1e72ff510957c0`; selected source snapshots and hashes in [upstream manifest](upstream/manifest.json). The top-level local reference checkout has also been updated to that commit. Latest development branches and released binaries must remain distinct.

## What the old generator actually does

The current RedModding `source/raw` export contains 15,681 mesh appearances, entries and local material instances (15,680 generated combinations plus one baseline), 80 `.app` JSON files, 4 switchers and 84 appearance-option objects with 15,684 indexed definitions including OFF entries. See [measured counts](../eye-artistry/evidence/legacy-counts.json).

The multiplication is 4 layers × 20 designs × 49 colours × 4 finishes. Each design/layer `.app` enumerates 196 appearances, each containing a morph-skinned component; each combination also adds a mesh appearance and material. Only the input texture and diffuse colour change across many instances. Source: `D:/Dev/xf-omega/source/projects/xf-eye-artistry-ccxl/{xf-eye-artistry-ccxl,atlas,materials}.ts`.

Larger palettes reportedly caused WolvenKit to grind to a halt for other people opening the mod. No timing measurement was made here, but the duplicated resource structure is directly verified. Success means materially reducing editor resource load as well as supporting more colours, not merely shortening generator code.

## Distinct mechanisms, not one universal feature

| Mechanism | Verified behavior | Consequence |
|---|---|---|
| CCXL registration | `.xl customizations` supplies an `.inkcharcustomization`; merge/index repair handles registered entries | Selectors/icons/labels still need deliberate definitions |
| CCXL `.app` fallback | `FixCustomizationAppearance` clones an appearance template for missing requested names in the customization scope; suffix after the last `__` becomes mesh appearance | One template per layer can replace per-design/per-colour `.app` enumeration |
| Mesh appearance expansion | Empty `chunkMaterials` inherit an expansion template; names before `@` are replaced with the requested appearance name | Share a chunk layout and template instead of full per-appearance lists |
| Dynamic materials | `design+colour+finish@makeup` selects `@makeup`; resource references may interpolate the material name | One embedded material template per layer mesh, shared palette resources and texture files |
| Composite material attributes | 1.27.x `ChunkData::GetMaterialAttrs` splits `+` into `{material.1}`, `{material.2}`, … | Independently address design texture and colour/finish material without actor state |
| Garment dynamic appearance context | `DynamicAppearance`, `!variant`, condition selectors and entity/owner context support garments | Do not assume this exposes arbitrary new CCXL switcher values as dynamic attributes |
| Resource scope / patch / link | Explicit sets, resource patches and aliases have different meanings | Register custom makeup apps in the customization scope; avoid replacing base eye resources globally |

Source: [Customization Extension](https://github.com/psiberx/cp2077-archive-xl/blob/5474e34d56112f5d8843ae863e1e72ff510957c0/src/App/Extensions/Customization/Extension.cpp), [Mesh Extension](https://github.com/psiberx/cp2077-archive-xl/blob/5474e34d56112f5d8843ae863e1e72ff510957c0/src/App/Extensions/Mesh/Extension.cpp), [Garment Extension](https://github.com/psiberx/cp2077-archive-xl/blob/5474e34d56112f5d8843ae863e1e72ff510957c0/src/App/Extensions/Garment/Extension.cpp). Key functions: `FixCustomizationAppearance` (line 779), `FixCustomizationComponents` (885), `ExpandCustomizationOptions` (569), `ProcessAppearance` (85), `ExpandMaterialParams`, `ExpandMaterialInheritance`, `ExpandResourcePath`, `GetMaterialAttrs` (1292).

The [author's wiki](https://github.com/psiberx/cp2077-archive-xl/wiki) describes the garment variant/context path; the [community's CCXL hair guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-hairs) documents one-appearance app/mesh templates. Hair guides are a pattern reference, not proof of the full makeup implementation.

## Proposed concrete contract

Use short, stable lowercase IDs and reserve `__`, `+`, and `@` as syntax. No path or display label should accidentally contain these delimiters.

```text
CCXL requested app appearance: xfas_eye_layer1__xfas_e01+000+matte
Mesh appearance:              xfas_e01+000+matte
Chunk material:               xfas_e01+000+matte@makeup
CMeshMaterialEntry template:  @makeup
{material.1}:                 xfas_e01
{material.2}:                 000
{material.3}:                 matte

DiffuseTexture (Soft):
*axefrog\appearance_studio\textures\{material.1}.xbm
baseMaterial (Soft):
*axefrog\appearance_studio\materials\palette\{material.2}_{material.3}.mi
```

The palette material supplies an actual `DiffuseColor` and derives from a shared finish material. ArchiveXL substitutes **resource paths**, not arbitrary scalar/colour fields: do not try `DiffuseColor = {material.2}`. Each colour/finish material is shared across all designs and layers. All final finish chains terminate in the game material template unless a later verified rendering need says otherwise.

Use four independent layer `.app` templates with explicit, uniquely named morph-skinned components and four layer mesh/morph pairs if geometric separation proves useful. Register each `.app` explicitly:

```yaml
customizations:
  female: axefrog\appearance_studio\xfas.inkcharcustomization
resource:
  scope:
    player_customization.app:
      - axefrog\appearance_studio\layers\layer1.app
      - axefrog\appearance_studio\layers\layer2.app
      - axefrog\appearance_studio\layers\layer3.app
      - axefrog\appearance_studio\layers\layer4.app
```

This is a design specimen, not an install-ready configuration. Actual paths must agree with the generated archive manifest. The scope requirement is explicit in `FixCustomizationAppearance` and the shipped `PlayerCustomizationEyesScope.xl`; `.xl customizations` alone is not evidence that a custom makeup app entered that scope.

Set the first parts override's `componentsOverrides[].componentName` to the exact layer component name. Leave its part resource empty for the local component. Use a valid, nonempty seed `meshAppearance` other than `default`: `FixCustomizationComponents` skips empty/default appearances and explicitly supports `entMorphTargetSkinnedMeshComponent`. Avoid the single unnamed component-override form: `IsFixedCustomizationAppearance` treats it specially and can return the source definition unchanged. The first implementation must verify names survive CCXL selection and reload.

At the mesh level, start with a single valid seed appearance and `seed@makeup` chunk plus `@makeup` entry. The single-template pattern is documented for hair; native missing-appearance behavior still needs confirmation for this makeup resource. If needed, lightweight empty appearance stubs are an acceptable intermediate fallback, with counts reported. They must never trigger regenerating the full material matrix.

## What scales and what remains

| Resource | Legacy at 49 colours | Proposed target at 49 | Example at 256 colours |
|---|---:|---:|---:|
| Design textures | 20 | 20 shared | 20 shared |
| Authored full mesh material instances | 15,681 | 4 embedded templates, plus shared palette/finish materials | Same 4 embedded templates |
| Shared colour/finish `.mi` resources | mixed into full matrix | 196 | 1,024 |
| Layer `.app` templates | 80 files × 196 definitions | 4 files × 1 seed definition | Same 4 seed templates |
| CCXL selectable design/colour/finish combinations | 15,680 | Up to 15,680 explicit UI definitions | Up to 81,920 explicit UI definitions |
| Palette thumbnails | 196 | 196 shared across designs/layers | 1,024; atlas paging/size must be measured |

Counts are targets, not a built mod. Runtime ArchiveXL will instantiate requested materials and appearance definitions; selecting many variants can still grow caches. UI definitions, atlas dimensions, serialization size and actual WolvenKit load performance need independent budgets and benchmarks at 49, 128 and 256 colours before choosing a release palette. No arbitrary palette cap is approved. A future independent colour/finish UI could reduce UI duplication, but custom CCXL switchers do not automatically become `{material}` attributes; that would be a separate proven design.

`ExpandCustomizationOptions` currently copies definitions for unnamed appearance entries, not an arbitrary matrix of named design selectors. Do not claim it eliminates Eye Artistry's named UI option matrix.

## Offline evidence and next proof

[Experiment 001](../../experiments/001-dynamic-material-contract/README.md) validates all 15,680 baseline selectors, their 20 texture paths and 196 palette references, rejects malformed names, and round-trips a freshly authored dynamic material fixture through WolvenKit 8.17.4. Both placeholders and `Soft` flags survive binary serialization.

That establishes a serialization contract and a plausible reduction, not runtime correctness. Next: build the small layer sample from fresh resource templates, audit every resolved asset path, verify Blender-to-morph import, then use one prepared game session to check CCXL propagation, material appearance, reload persistence and layer order. See [validation plan](../../docs/validation.md).
