# Character customization: portable source resolution

23 September 2026. Architecture note for a read-only character catalog and saved-V preset editor. This is a proposed resolver contract, not a completed load-order implementation or proof of current game rendering.

## Why a file search is insufficient

A save stores appearance resource hashes and definition names, not the bytes that rendered them. The [saved-V reader](../../projects/xf-appearance-studio/authoring/src/save-reader.ts) preserves unsigned 64-bit hashes as decimal strings. Its present [eye adapter](../../projects/xf-appearance-studio/authoring/src/eye-appearance.ts) recognizes one locally researched `(app hash, definition)` pair with a verified PNG; it deliberately does not resolve general mod sources. In [Nathan's eye trace](../eye-artistry/modded-eye-resolution.md), `eye_16_diffuse` is absent from the serialized shared `.app`, registered by nutboy's CCXL resource and mesh patch, and ultimately uses Kala's texture archive. A search of the base `.app` alone would reject a valid saved choice.

Resolve four distinct questions in order. They have different winners:

1. **Which physical file is visible at a virtual game path?** MO2 profile priority and `overwrite` govern direct file conflicts in its virtual filesystem. Disabled staged mods remain catalog candidates, not active providers. A direct game launch does not inherit MO2's virtual filesystem.
2. **Which archive supplies a resource hash?** First collapse duplicate physical `.archive` paths to their visible file. Then order the visible archives using the game's effective archive order, which may differ from MO2's file priority. Index each archive by its unsigned resource hash; retain all candidates, including losing and inactive ones.
3. **What do framework registrations change?** Read effective `.xl` files and apply supported ArchiveXL customization, resource patch/copy/link and appearance override operations to the selected resource graph. Record each operation and its source. A `resource.link` is conditional: [ArchiveXL's link extension](https://github.com/psiberx/cp2077-archive-xl/blob/5474e34d56112f5d8843ae863e1e72ff510957c0/src/App/Extensions/ResourceLink/Extension.cpp) rejects a link path already provided by the depot. [Its customization extension](https://github.com/psiberx/cp2077-archive-xl/blob/5474e34d56112f5d8843ae863e1e72ff510957c0/src/App/Extensions/Customization/Extension.cpp) merges groups/options, replaces or appends matching choices, registers app overrides and rebuilds indices. A static archive winner is therefore an input to resolution, not the final appearance.
4. **What did a particular launch render?** Offline composition yields a source-supported expectation. Versioned runtime logs or captures can corroborate it, but are dated observations and cannot be silently promoted to current truth. The September 16 ArchiveXL log in the [eye trace](../eye-artistry/modded-eye-resolution.md) is an example.

### MO2 evidence and the two orderings

At this inspection, `F:/Games/MO2/ModOrganizer.ini` selects profile `2025 (again)` and sets `enforce_archive_load_order=false`, `reverse_archive_load_order=false`. That profile enables Unique Eyes to CCXL and Kala's Eyes Standalone V2. No `F:/Games/MO2/overwrite/archive/pc/mod/modlist.txt` exists. The local installed Cyberpunk support plugin (`F:/Games/MO2/plugins/basic_games/games/game_cyberpunk2077.py`, version 2.3.1, authors listed as 6788 and Zash) reads active mods by profile priority and generates an archive `modlist.txt` in its launch hook only when enforcement is enabled. The [plugin's maintained source](https://github.com/ModOrganizer2/modorganizer-basic_games/blob/3bd9da97c159a1bc05fd21e81199e997ed16e0f6/games/game_cyberpunk2077.py) shows the same separation; the [maintainers' Cyberpunk load-order guide](https://github.com/ModOrganizer2/modorganizer-basic_games/wiki/Game%3A-Cyberpunk-2077#load-order) says the default game archive conflict winner is the first archive in alphabetical load order. When enforced, first in the generated list wins: `reverse_archive_load_order=false` puts lowest MO priority first, while `true` puts highest priority first. Direct file conflicts still follow MO priority, with `overwrite` highest. These are rules and current configuration, not evidence of the launch path used for Nathan's save or photographs.

For MO2, the adapter must capture selected profile, enabled state, profile priority, physical mod folders, `overwrite`, plugin settings, actual visible `modlist.txt` if any, and intended launch route. When enforcement is off but a list exists, inspect the actual list and report the ambiguity rather than deriving order from the setting alone. Within one mod, the support guide says multiple archives retain alphabetical order. A manual `archive/pc/mod` adapter inventories files deployed in the game directory and applies the game's archive ordering without inventing a manager priority. The base-game adapter indexes the installed game's base archives. A future Vortex adapter must inspect **deployed winners and deployment state** as well as staging metadata; its staging directory alone is not an effective game view. The same applies to other managers. REDmod deployment and script-driven appearance changes are separate graph stages until their order and semantics are supported.

## Typed boundaries and evidence

Keep source adapters narrow. The core resolver should not branch on manager names:

```ts
type SourceSnapshot = {
  sourceId: string;
  kind: "base" | "manual" | "mo2" | "vortex";
  launchContext: string; // e.g. selected MO2 profile or direct game launch
  fingerprint: string;   // relevant config, file metadata and order inputs
  mounts: FileCandidate[];
  archiveOrder: OrderEvidence | { status: "unknown"; reason: string };
};
type FileCandidate = {
  virtualPath: string;
  physicalPath: string;
  providerId: string;
  active: boolean;
  filePriority?: number;
};
type ResourceCandidate = {
  hash: string;           // decimal uint64, never a JS number
  depotPath?: string;     // may be unknown even when an index has the hash
  archive: FileCandidate;
  archivePosition?: number;
};
type Resolution<T> = {
  candidates: T[];
  winner?: T;
  rule: string;
  confidence: "observed-runtime" | "source-supported" | "inferred" | "unknown";
  gaps: string[];
};
```

Adapters enumerate and fingerprint; the core resolves virtual-file conflicts, then archive-hash conflicts, then framework transformations. A result should retain the full contender chain, winner rule, mod name/version if evidenced, archive path, depot path/hash, extracted-byte SHA-256 when available, and explicit missing/ambiguous states. Version, enabled state, physical presence and last observed runtime version are separate fields. A hash collision or unsupported patch must remain unresolved. Inventory coverage must say which roots, archives, payloads and launch contexts were actually inspected. Keep game and third-party extracted bytes in ignored local research output; a distributable catalog contains identifiers and provenance, not those assets.

The character selector catalog is another output of the same graph. Parse the **effective** female/male `gameuiCharacterCustomizationInfoResource`, including active `.xl customizations` additions, into groups, appearance/morph/switcher options and choices. Preserve stable names, resource path, UI slot/link, edit tags, enabled/hidden flags, default, localization key, icon/colour, actions and source provenance. Generate widgets from these descriptors and match save choices by `(resourceHash, definition)` within the relevant saved group, or morph `(region, target)`; do not use regenerated option indices as persistent identities. [Heterochromia's inspected resource](../consumers/heterochromia/json/heterochromia_pwa.inkcharcustomization.json) demonstrates switchers, UI slots, edit tags and appearance definitions. Resource fields support an offline catalog; actual in-game widget visibility, script effects, selected materials and pixels require separate validation. Show unmatched saved choices rather than substituting a similarly named option.

## First read-only slice

Implement an offline snapshot for the current saved eye `(7132639559252259433, eye_16_diffuse)` and the selected brow's overridden `brown_ombre` gradient in the [brow audit](../eye-artistry/brow-texture-audit.md). Index only relevant hashes in active base/manual/MO2 archives, retain disabled candidates for diagnostics, parse the relevant `.xl` declarations and one CCXL resource, and emit a local resolution manifest with winners, alternatives, dependency edges and explicit uncertainty. A single Eyes selector can then render from normalized CCXL data, preselect the saved identity, and keep the existing reference-texture fallback for missing bytes. Do not edit saves or install mods in this slice.

Acceptance fixtures should cover: active versus disabled MO2 mods; duplicate virtual paths with profile priority and `overwrite`; alphabetical versus enforced/reversed archive order; duplicate resource hashes in distinct archives; a conditional ArchiveXL link whose target already exists; a dynamically registered definition missing from its base `.app`; a same-named definition under a different app hash; a hash above JavaScript's safe-integer limit; stale snapshot detection; and missing or unsupported resources that stay visible as such. The local integration check should reproduce the [eye chain and verified digests](../eye-artistry/modded-eye-resolution.md), without claiming the offline result proves today's rendered eye. This also supplies a concrete, source-grounded start for the [queued CCXL capability study](../backlog/ccxl-character-creator-capabilities.md).
