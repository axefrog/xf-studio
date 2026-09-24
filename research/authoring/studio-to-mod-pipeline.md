# From XF Studio collection to a Cyberpunk mod candidate

25 September 2026. This is a map of the **current local pipeline**, for a reviewer who knows the idea of a mod but not the file formats. The result is an offline-verified, private **candidate**. No XF Studio package has yet been installed and observed rendering in Cyberpunk 2077. “Loadable” here means the expected archive/declaration files have been built and independently unpacked and checked; it does **not** mean ArchiveXL registration, selector switching, visual fidelity or save persistence have passed an in-game test.

The short version: the Studio saves editable makeup as data. Check and Build make a package-only copy that omits active layers with unsupported finishes and presets left without active exportable layers. They report every omission while leaving the authored collection untouched. Build then merges each retained preset's visible layers into three 1024-pixel texture maps, attaches those maps to one shared eye-plate material pattern, writes a character-creator selector with an Off choice, packs the resources, independently checks the package, and places only a verified copy in a private `dist` folder. It never installs the files. [Product decision](../../projects/xf-studio/data/product-direction.md), [local build boundary](local-package-build.md), [runtime test card](../../docs/validation.md#prepared-single-session-test-card).

## The pipeline at a glance

Solid arrows below are implemented local data/build steps. The final dashed arrow is **work still to be observed in game**. A red rejection means no eligible preset remains; structural or integrity failures also prevent promotion. A partial result carries explicit omissions. The first diagram follows authoring through eligibility; the second begins with the same validated build snapshot.

```mermaid
flowchart TB
  subgraph editor["Studio — editable data"]
    recipe["Layer recipes<br/>editable shape, colour, finish, order"] --> draft["Collection draft<br/>named presets and stable IDs"]
    draft --> sqlite["Save collection<br/>immutable SQLite revision"]
    draft --> export["Export collection<br/>portable JSON"]
    draft --> ui["Check mod export / Build mod files<br/>snapshot includes unsaved edits"]
  end

  ui --> server["Localhost server<br/>validate original draft and snapshot"]
  ui --> desktop["Desktop host<br/>authenticated Check only<br/>Build unavailable"]
  server --> filter["Shared export filter<br/>package-only copy"]
  desktop --> worker["Isolated Bun Check worker<br/>15-second deadline"]
  worker --> filter
  worker -. "timeout, cancellation or failure" .-> noresult["No Check result published<br/>worker stopped"]
  export --> filter
  filter --> decision{"Any exportable<br/>preset remains?"}
  decision -- No --> reject["Refuse empty package<br/>original collection unchanged"]
  decision -- Yes --> omitted{"Any active layer or<br/>whole preset omitted?"}
  omitted -- Yes --> warn["Report every excluded<br/>preset and layer"]
  omitted -- No --> preflight["Shared TypeScript<br/>32-pixel compiler preflight"]
  warn --> preflight
  preflight -- Check --> ready["Eligibility and omissions<br/>no package created"]
  preflight -- "Localhost Build" --> setup["Host local setup and server overrides<br/>plate, game and build tools"]
  setup --> snapshot["Hash original and filtered snapshots<br/>continue with filtered copy below"]

  classDef blocked fill:#ffe7e7,stroke:#b42318,color:#6e1611;
  class reject,noresult blocked;
```

```mermaid
flowchart TB
  snapshot["Filtered, hashed build snapshot<br/>private intermediate directory"] --> bake["Experiment 005 build<br/>1024-pixel maps, plate and resources"]
  bake --> resources["Generated archive resources<br/>and ArchiveXL declaration"]
  resources --> gate["Pre-pack path gate<br/>planned inventory, canonical names, hashes"]
  gate -- Fail --> stop
  gate -- Pass --> pack["WolvenKit packs archive"]
  pack --> verifier["Independent verifier<br/>round trip, pixels, mips, archive"]
  verifier -- Fail --> stop["No dist candidate<br/>diagnostics retained locally"]
  verifier -- Pass --> dist["Private dist candidate<br/>archive, .archive.xl, manifest with omissions"]
  dist --> resultGate{"Host manifest identity gate<br/>source, filtered hash, omissions, presets"}
  resultGate -- Fail --> unaccepted["No accepted package result<br/>private files stay local"]
  resultGate -- Pass --> scratch["Ignored diagnostic scratch stage<br/>copied profile and paired files"]
  scratch --> preview["Read-only transfer preview<br/>paths, hashes, ownership gates"]
  preview -- "explicit promotion only" --> mo2["New MO2 profile and XF Studio mod<br/>reversible private receipt"]
  mo2 -. "not yet executed in real MO2<br/>or game-tested" .-> runtime["Future game session<br/>selector, A/B/Off, rendering, save"]

  classDef blocked fill:#ffe7e7,stroke:#b42318,color:#6e1611;
  classDef pending fill:#fff4d6,stroke:#946200,color:#594000;
  class stop,unaccepted blocked;
  class runtime pending;
```

The diagram has entries into the same TypeScript filter from a localhost Studio request, an authenticated desktop request and an exported collection JSON file passed to the CLI. All use the same filter and 32-pixel compiler preflight. **Check mod export** stops after eligibility and needs no plate, WolvenKit or game file. The desktop host runs collection validation, filtering and compilation in a fresh bundled Bun worker, with a 15-second deadline. Timeout, cancellation or worker failure stops that worker and returns an error without a partial result; a second concurrent Check is refused. The localhost CLI still runs the shared module through Bun. **Build mod files** currently works on localhost only and takes the filtered snapshot into the resource pipeline; the desktop returns 503 because that pipeline has no portable host adapter yet. Build paths come from private local settings, with server environment overrides taking precedence on localhost. The browser's separate Local setup form can edit saved fields with revision checks. The localhost server runs one build at a time and calls a source-tree-independent result verifier against its own filter of the exact snapshot and its host-owned dist root. The Python wrapper now accepts explicit app/study/work/build/dist roots plus preflight and bake entries, retaining the current HQ defaults for localhost; these path ports do not enable desktop Build. [Server boundary](../../projects/xf-studio/authoring/src/package-server.ts), [result identity gate](../../projects/xf-studio/authoring/src/package-result-verifier.ts), [desktop adapter](../../projects/xf-studio/authoring/desktop/package.ts), [shared preflight](../../projects/xf-studio/authoring/src/package-preflight.ts), [local setup](../../projects/xf-studio/authoring/LOCAL-SETTINGS.md), [CLI](../../projects/xf-studio/authoring/tools/build_collection_package.py).

## What each kind of data means

| Thing | What it contains | What it is **not** |
|---|---|---|
| Recipe | A versioned, editable ordered layer stack: contours, warp fields, pigment/softness, colour, opacity and finish. Current schemas include `xfs/recipe-6` through `xfs/recipe-10`; legacy recipes migrate on read. | A texture, mod or saved V. The browser preview resolution is independent of the recipe. |
| Collection | `xfas/collection-1` JSON with a stable collection UUID and named preset UUIDs/revisions, each carrying a recipe. The `xfas` schema name is retained for compatibility after the XF Studio rename. | A game selector by itself. It can travel between Studio installations. |
| Browser draft | Unsaved collection edits plus editor selections and preview context in local workspace storage. | A new SQLite revision or packaged mod. |
| SQLite revision | Explicit, immutable local library snapshot with conflict protection. | The latest browser draft unless the user saved it. |
| Package-only filtered snapshot | A validated copy with unsupported **active** layers removed and any now-empty preset removed. It keeps IDs/revisions of included presets; Check and Build use the same filter. | A change to the authored recipe, browser draft or SQLite library. |
| Build plan | Deterministic proposed resource names/paths for the **retained subset**. | An installable mod. |
| Intermediate build | Generated maps, JSON resources, conversion logs, packed archive and verifier evidence in ignored `build/`. | Public distribution content. |
| `dist` candidate | Verified `.archive`, `.archive.xl` and a manifest in ignored project `dist/`. | An installed, activated or game-proven mod. |

The new-layer template starts with a mirrored four-point upper-lid contour and no warp field. Reset applies that same starting shape, while duplicate and imported or saved recipes retain their authored geometry. This changes only the recipe produced by future Add/Reset actions; the filter, compiler, package identities and historical four-layer startup recipe are unchanged. [Layer action](../../projects/xf-studio/authoring/src/layer-stack.ts), [template](../../projects/xf-studio/authoring/src/recipe.ts).

For example, the checked-in four-preset fixture has collection ID `0ec3546e-3fac-43e7-8c19-a65d20383d41`. Its namespace is `xfs_c0ec3546e3fac43e78c19a65d20383d41`. Preset `f25f8eb1-8a83-4f65-a111-b83086382c18` gets mesh appearance `xfs_pf25f8eb18a834f65a111b83086382c18` and selector appearance `xfs_c0ec3546e3fac43e78c19a65d20383d41__xfs_pf25f8eb18a834f65a111b83086382c18`. Renaming that preset keeps these UUID-derived identities; reordering changes its index, whose save behavior remains unproven. This fixture is an example, not a required preset catalogue. [Identity planner](../../projects/xf-studio/authoring/src/preset-collection.ts), [fixture](../../experiments/005-preset-collection/editor-collection.json).

## Where layers become one look

**The merge happens in the Studio compiler, before WolvenKit and before ArchiveXL.** One preset is evaluated at 1024 × 1024 texels. Only enabled layers with opacity above zero participate. Their masks use the same recipe evaluator as the browser/PNG path. The compiler walks the layers bottom-to-top, applies each layer's colour and coverage, and accumulates colour, roughness, metalness and coverage in destination-channel space. It then emits **one diffuse map, one roughness map and one metalness map for that preset**, regardless of how many eligible layers the preset contains. There is no separate game selector for each layer. The current adapter is `mesh-decal-flat-v1` and its Matte/Satin/Metallic parameters are provisional. Diffuse alpha stores the square root of coverage for the inspected `mesh_decal.mt` path; the two scalar maps carry roughness and metalness. Normal contribution is disabled. [Compiler](../../projects/xf-studio/authoring/src/preset-compiler.ts), [raster evaluator](../../projects/xf-studio/authoring/src/recipe.ts).

```mermaid
flowchart TB
  subgraph one["One authored preset"]
    direction LR
    low["Bottom layer"] --> mid["Other eligible layers"] --> top["Top layer"]
  end
  top --> merge["Studio flat compiler<br/>ordered coverage and surface merge"]
  merge --> d["Diffuse RGB + coverage alpha"]
  merge --> r["Roughness"]
  merge --> m["Metalness"]
  d --> maps["Three mipmapped XBM textures<br/>for this preset"]
  r --> maps
  m --> maps
  maps --> shared["Shared plate mesh and morph target<br/>shared mesh_decal material pattern"]
  shared --> choice["One selector choice<br/>for the complete look"]
```

Currently only active **Matte, Satin** (stored as `regular`) **and Metallic** enter the flat package. Shimmer, Glitter, Glossy and Colour-shifting are meaningful **browser previews** but have no faithful production game adapter. The package filter omits those active layers, then omits any preset left without active exportable layers. Check and Build both report each excluded layer and whole preset; they refuse the collection only when no exportable preset remains. A disabled or zero-opacity experimental layer does not contribute and is not reported as an omission. The compiler itself still strictly rejects unsupported active layers if called without the package filter; it never silently flattens them. The individual **Export mask** command is a different output: a 2048 × 2048 white-RGB/coverage-alpha PNG for one layer, independent of its enabled state and not the three-map preset package. Preview quality at 512/1K/2K/4K changes generated browser textures only. [Package filter](../../projects/xf-studio/authoring/src/package-filter.ts), [compiler gate](../../projects/xf-studio/authoring/src/preset-compiler.ts).

## How those maps become game resources

`bake_collection.ts` validates the collection, plans its names, calls the flat compiler at 1024 for each preset, and writes three hashed raw maps plus `plan.json` and `compiled.json`. Experiment 005 computes a complete mip chain from those maps, writes DDS inputs, and asks WolvenKit to import colour as gamma-aware XBM and scalar maps as linear XBM. It serializes the local source plate mesh/morph, changes **resource references and appearance/material metadata**, then deserializes the new resources. It does not reskin or reshape the source geometry during this package step. The independent verifier compares the mesh render blob/bone data and morph blob/105 targets with the source after a WolvenKit round trip. This preserves the known source data but does not resolve the remaining eyelid-contact problem. [Bake adapter](../../projects/xf-studio/authoring/tools/bake_collection.ts), [resource builder](../../experiments/005-preset-collection/build.py), [verifier](../../experiments/005-preset-collection/verify.py).

The resource graph is deliberately small:

- **One** `xfs_collection.inkcharcustomization` supplies one female head customization option. Its definitions list index `0` as `xfs_off`, followed by one entry per authored preset, with display names from the collection. Current tags name New Game, HairDresser and Ripperdoc contexts in the resource; actual availability in those contexts is untested.
- **One** `xfs_collection.app` holds an Off definition with no components and a shared template definition with one `entMorphTargetSkinnedMeshComponent`. The preset selector names carry a suffix that the inspected ArchiveXL rules are expected to expand through the template. The independent verifier checks this **source-derived expansion model**; it does not run ArchiveXL.
- **One** copied/referenced `xfs_eye_plate.mesh` and **one** `xfs_eye_plate.morphtarget` serve the collection. The morph resource points to the new mesh path and seed appearance. The model retains 105 morphs, native skin data and one material entry. A single `base/materials/mesh_decal.mt` local material instance uses soft texture paths with `{material}` substitution. Each preset adds a mesh appearance identity and its own three XBM textures, not a separate plate copy.
- **One** `.archive.xl` text declaration tells ArchiveXL about the female customization resource and scope in `player_customization.app`. The `.archive` holds the binary resources. The declaration is beside the archive in `archive/pc/mod/`, not inside it.

For a package of **N retained** presets, the intended resource count is `4 + 3N`: mesh, morph, app and customization plus three XBM maps per preset. The unchanged four-preset fixture has 16 unpacked resources, four mesh appearances, four selector looks **plus Off**, and one shared material template. In a local partial-export test, making the fixture's first preset Glitter-only retained three presets and verified 13 unpacked resources; the omitted preset kept its authored ID in the original source but received no selector entry. These are verifier results, not observed game options. [Experiment 005](../../experiments/005-preset-collection/README.md), [source build](../../experiments/005-preset-collection/build.py).

The output tree is conceptually:

```text
projects/xf-studio/dist/<namespace>-<unique-build-time>/
  manifest.json                         local identity, hash and proof record
  archive/pc/mod/
    <namespace>.archive                 packed game resources
    <namespace>.archive.xl              ArchiveXL registration/scope text

Inside the archive (for collection 0ec3546e-…):
  axefrog/appearance_studio/collections/0ec3546e…/
    xfs_collection.app
    xfs_collection.inkcharcustomization
    models/xfs_eye_plate.mesh
    models/xfs_eye_plate.morphtarget
    textures/xfs_p<f25…>_diffuse.xbm
    textures/xfs_p<f25…>_roughness.xbm
    textures/xfs_p<f25…>_metalness.xbm
    ...three textures for each other preset
```

The exact real texture filenames concatenate `xfs_p` with the **full hyphenless preset UUID**; the abbreviated examples above are for reading only. Every newly generated archive appearance name starts with lowercase `xfs_`. The original imported plate filenames retain their historical `xfas_` names **as local inputs**; packaged outputs use the new namespace. [Naming contract](../../projects/xf-studio/data/naming.md), [planner](../../projects/xf-studio/authoring/src/preset-collection.ts).

## What Check, Build and Verify each prove

1. **Check mod export** validates the complete collection, filters a package-only copy, and runs a small 32-pixel compile for each retained preset. It reports the original preset count, packaged identities, every omitted layer/preset, and the filtered snapshot SHA-256. Check makes no archive or SQLite save. It does not need the plate/game/WolvenKit files. An invalid or empty collection, one above 16 MB, or one with no exportable preset fails. Desktop Check has a 15-second worker deadline and returns no result on timeout, cancellation or worker failure. This is an eligibility check, not a visual promise.
2. **Build mod files** captures the current Studio draft, even when it has unsaved edits, without creating a SQLite revision. The server accepts only a same-origin request on `127.0.0.1`, computes its own filtered plan and both original/filtered hashes, and writes a temporary original snapshot. The CLI checks that source has not changed, uses the **same filter**, writes an immutable filtered build snapshot, and checks its hash. Its source plate, WolvenKit and game paths come from private local settings or higher-priority server environment overrides, never browser package input. Unset build paths stay unset; there is no developer-specific fallback. Direct CLI use takes an exported collection file instead.
3. **Build conversion and pre-pack gate** produce the three texture maps per preset, full mip chains and mesh/morph/app/customization resources. Before calling WolvenKit's packer, Experiment 005 requires the physical generated tree to equal the planned `4 + 3N` resource paths exactly. Paths must already be lowercase, relative, slash-separated and made from archive-safe characters; no traversal, separator aliases, unsupported extension, symlink or path-hash collision is accepted. This avoids WolvenKit silently normalizing a name or skipping a file. Only then does it write `.archive`, `.archive.xl` and `build.json`. The build record includes per-recipe and map hashes, source plate path/hash entries, each archive member's canonical path, WolvenKit-compatible 64-bit path hash and SHA-256, and the packed archive hash. Build output stays under ignored project `build/`; the fixture's checked-in `latest-build.json` is not changed by this wrapper.
4. **Independent verification** is a separate Experiment 005 program. It rechecks the physical resource inventory against the plan and build record, then checks resource structure and names; preserved model and morph buffers; the Off/template/preset links; source-derived `{material}` texture paths; imported XBM metadata; decoded base-map colour/coverage/scalar tolerances; the entire decoded mip chain against coverage-space reductions; archive hash; and the exact set and SHA-256 of unpacked archive members. It reports `installed: false`, `gameRenderingVerified: false` and explicit limits. It cannot establish actual game shader filtering or executed ArchiveXL expansion.
5. **Promotion** happens only after the verifier succeeds. The wrapper compares the filtered plan identities and verification/archive hashes, copies just `.archive` and `.archive.xl` to a staging folder under ignored `dist/`, writes `manifest.json`, checks the promoted archive hash and atomically renames staging to a unique final directory. The host then calls the shared result identity gate with its own dist root: it checks containment and confirms the manifest's original source hash, filtered snapshot hash, omission list, original count, retained preset identities and archive hash before returning the path. `--output-root` cannot direct a build outside the chosen private `--dist-root`; a future desktop host must supply and own that root. A failed preflight/verifier does not promote a candidate, while a host identity-gate failure returns no accepted result and leaves private diagnostics local.

The `xfs/local-package-1` manifest identifies the original collection SHA-256 and original preset count, the exact filtered snapshot SHA-256, each excluded layer/whole preset, packaged preset IDs/revisions/appearance names, verified file count, hashes and sizes of the archive and `.archive.xl`, and explicit `installed: false` / `gameRenderingVerified: false`. It currently does **not** record an explicit compiler version or complete toolchain/version/provenance lock; those are release-traceability gaps. WolvenKit may place timestamps in the archive index, so two builds from identical resource artifact paths/hashes can have different packed archive hashes. Compare source/resource hashes as well as the packed hash. [Local wrapper](../../projects/xf-studio/authoring/tools/build_collection_package.py), [recorded checkpoint](local-package-build.md#offline-checkpoint--24-september-2026).

The separate first-game diagnostic path copies the candidate pair and selected profile metadata into an ignored scratch root. A new transfer planner can read that stage and show exact destination paths, bytes, hashes, profile changes and collision gates without writing to MO2. Its explicit promotion action is implemented but **has only run against temporary fixtures**: it would create a new profile and a dedicated XF Studio mod in a chosen real MO2 instance, leaving the original profile, other mods and global selected-profile setting untouched. It checks the source candidate against its manifest, the staged transport receipt and staged file hashes, source profile metadata, and current archive filename collisions. A private journal and receipt support conflict-aware recovery and rollback of only unchanged created paths. Neither stage nor transfer reruns the independent archive verifier; neither proves an archive winner or game behavior. [Transfer tool](../../projects/xf-studio/authoring/tools/runtime-diagnostic-promotion.ts), [prepared session card](../../docs/validation.md#prepared-single-session-test-card).

## Boundaries still needing evidence

The verifier's ArchiveXL path expansion is a **model inferred from inspected resource rules**, not a game execution trace. The archive has not been installed into a declared MO2/direct launch route. The single selector must still be observed appearing in the intended creator contexts; A → B → Off and B → A → Off must clear components correctly; re-entry/save/reload must preserve the intended preset identity; the on-head material and mip/filter response must be compared with game captures; and the plate must pass all relevant pose/contact gates. A proposed plate correction passed selected offline poses but failed the full 664-frame idle gate, so the current owned plate has no accepted new correction. Mixed optical finish export and faithful material mapping remain open. [Runtime checklist](../../docs/validation.md#prepared-single-session-test-card), [plate evidence](../../experiments/006-plate-clearance/research/dense-idle-contact-gate.md).

The package includes a locally derived CDPR plate resource. Its `build/` and `dist/` directories are ignored and private; do not commit, share or auto-deploy them as a release. A source clone lacks the private/local plate and other extracted assets needed for a full build. The current target is game 2.31 and stable ArchiveXL 1.27.3; installed versions and actual runtime-loaded versions must be checked separately before any game session. [Authoring setup](../../projects/xf-studio/authoring/README.md), [validation protocol](../../docs/validation.md).

## Maintenance and visual review record

After any change to collection/recipe schema, finish eligibility, map compilation, naming, `.app`/customization/ArchiveXL wiring, package guard, verifier, manifest or promotion, update the diagrams **and** the corresponding explanation in this guide in the same checkpoint. Render all three Mermaid diagrams and inspect them at normal reading width and at an enlarged width. Confirm that every node label is readable, branch direction and Check-versus-Build behavior are clear, the layer merge is located before packaging, and the dashed game boundary cannot be mistaken for completed validation. Compare the diagrams against the changed code and the output tree; record date, rendering tool, visual observations and any limits here. See the companion [AGENTS.md](../../AGENTS.md) rule.

| Date | Render/review method | Result |
|---|---|---|
| 2026-09-24 | Mermaid CLI 11.17.0 with Chrome; rendered all three diagrams to PNG, inspected full-size and 800px-wide versions. [Authoring](evidence/studio-to-mod-authoring-2026-09-24.png), [build](evidence/studio-to-mod-build-2026-09-24.png), [layer merge](evidence/studio-to-mod-merge-2026-09-24.png). | The first overview was too wide, so it was divided into authoring/preflight and build/verification diagrams; the merge diagram was made vertical. Labels, pass/fail branches and the dashed untested-game boundary remain legible at 800px. The authoring flow is tall and requires scrolling. All images are generated from documentation text and contain no game assets. |
| 2026-09-24, partial export | Mermaid CLI 11.17.0 with Chrome; rerendered all three and inspected original resolution and 800px-width images. [Updated authoring](evidence/studio-to-mod-authoring-partial-2026-09-24.png), [updated build](evidence/studio-to-mod-build-partial-2026-09-24.png); the [layer merge](evidence/studio-to-mod-merge-2026-09-24.png) remains visually unchanged. | The new No/Yes exportability branches, partial-warning path, Check/Build split, filtered snapshot, verifier failure and dashed untested-game boundary are visually distinct and legible at 800px. The authoring diagram remains vertically long. These renders contain no game assets. |
| 2026-09-24, archive path gate | Mermaid CLI 11.17.0 with Chrome; rendered all three current diagrams to temporary PNGs at 800px and 1600px and visually inspected both sizes. | The new pre-pack gate sits after resource generation and before WolvenKit pack; its Fail arrow joins No promotion, while Pass reaches the independent verifier. Check remains on the first diagram only. All labels, arrows, layer merge and the dashed untested-game boundary were legible at normal and enlarged widths. Temporary renders were asset-free and remain ignored under project `build/`; no new visual files were committed. |
| 2026-09-24, new-layer contour | Mermaid CLI 11.17.0 with Chrome; rendered all three diagrams to ignored 800px and 1600px PNGs and visually inspected both sizes. | The updated editable-recipe label is readable. The Check and Build branches still diverge after the shared preflight; eligible layers merge before resources are packed; failure paths end without promotion; and the dashed game-session arrow remains visibly unproven. The tall authoring diagram still requires scrolling at normal width. No game-derived pixels were committed. |
| 2026-09-24, local package setup | Mermaid CLI 11.17.0 with Chrome; rendered all three diagrams to ignored 800px and 1600px PNGs and visually inspected both sizes. | The new host setup node is legible solely on the Build branch, with Check ending separately. All arrows and labels remain readable; eligible layers still merge before packing and the dashed game-session boundary remains unproven. The authoring overview remains tall at ordinary reading width. |
| 2026-09-25, desktop Check | Mermaid CLI 11.17.0 with Chrome; rendered all three current diagrams to ignored 800px and 1600px PNGs, then visually inspected normal and enlarged renderings. | The authoring diagram now shows localhost and desktop entering the same filter/preflight. The desktop label states Check only and Build unavailable; the localhost Build branch alone reaches setup and the resource pipeline. The first draft's separate desktop-unavailable arrow looked as though it emerged from localhost, so it was folded into the desktop node and rerendered. Labels, No/Yes arrows, layer merge, verifier failure and dashed untested-game boundary are readable at ordinary width. The overview remains tall; no private images or resources were rendered. |
| 2026-09-25, bounded desktop Check | Mermaid CLI 11.17.0 with Chrome; rendered all three diagrams to ignored PNGs at 800px and 1600px and visually inspected both sizes. | The new desktop worker and dashed timeout/failure branch are legible at normal width. Desktop Check still enters the shared filter while only localhost Build reaches setup and resources. The 32-pixel preflight, omissions, layer merge before packaging, no-promotion failure branches and dashed untested-game boundary remain clear. The authoring diagram remains tall. These renders contain no private resources. |
| 2026-09-25, diagnostic transfer | Mermaid CLI 11.17.0 with Chrome; rendered all three diagrams to ignored PNGs with 800px and 1600px width requests and visually inspected normal and enlarged views. | The build diagram reads from private dist candidate through ignored scratch stage and read-only transfer preview to an explicitly invoked new MO2 profile/mod. The final dashed arrow labels the real-MO2 action and game session unexecuted. The failure label says no *dist candidate* to distinguish build failure from later transfer. Check/Build and the pre-pack layer merge remain readable. Mermaid kept diagrams two and three at intrinsic widths for both requests; enlarged viewing confirmed labels and arrows. Text-only renders remain ignored. |
| 2026-09-25, portable result gate | Mermaid CLI 11.17.0 with Chrome; rendered all three diagrams to ignored PNGs at 800px and 1600px requests and visually inspected each at normal and enlarged size. | The new host manifest gate follows the private dist candidate, with its Fail branch ending at no accepted result while the independent verifier's Fail branch still ends before dist. Labels and directions are readable. Check remains separate from localhost Build; eligible layers merge before resources, and the final game-session arrow remains dashed. Mermaid kept the merge diagram at intrinsic width. No private inputs entered the renders. |

Primary implementation sources: [recipe](../../projects/xf-studio/authoring/src/recipe.ts), [collection plan](../../projects/xf-studio/authoring/src/preset-collection.ts), [flat compiler](../../projects/xf-studio/authoring/src/preset-compiler.ts), [package server](../../projects/xf-studio/authoring/src/package-server.ts), [CLI wrapper](../../projects/xf-studio/authoring/tools/build_collection_package.py), [Experiment 005 builder](../../experiments/005-preset-collection/build.py) and [independent verifier](../../experiments/005-preset-collection/verify.py). The guide explains the code as checked on this date; it is not a runtime observation.
