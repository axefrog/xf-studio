# Character-customisation file-chain study

**Status (30 September 2026): consolidation done; follow-ups open.** Track 5 in the [ranked queue](README.md). Every creator category is mapped from creator option to textures, with its morphs, save representation, ArchiveXL/CCXL extension routes and the Studio resolver's status, in the [file-chain map](../character-customization/file-chain-map.md); the distilled reference is the [CC file chain](../../knowledge/cc-file-chain.md). What remains is the in-game checks and resolver code the map ranks, not more offline mapping.

## Requirement

Consolidate, in one navigable reference, how character-customisation files tie together, from `.archive.xl` declarations through `.inkcharcustomization` groups and options, `.app` definitions, mesh components and appearances, morph targets, material instances and templates to textures and profiles, for **every** CC category, including how ArchiveXL/CCXL transforms them and how saves reference the result.

## Done

- **Per-category map** (30 September): 30 categories, from body gender and voice through head, makeup, jewellery and body parts, in two tables (option → appearance → variant → morphs → save groups; templates → ArchiveXL support → installed CCXL extensions → Studio status), with worked chains that carry hashes and a rendered, inspected diagram.
- **Sources reconciled**: 13 contradictions between the wiki, our own pages and the game files resolved or narrowed with evidence (the "missing" CC options page, the hair-to-beard link example, overlay matching, cheat-sheet counts, morph-name activation, save tags, beard structure, a stray cheek `.app` folder, and stale statements about TweakXL icons and the uncensored mode).
- **New findings**: the voice tone is a separate creator widget, not an option (decompiled scripts); ArchiveXL's own framework covers only eyes, lashes, brows, hair and beard, so other categories' CCXL options must define every appearance; ArchiveXL patches `.ent` files (always-on parts), which three installed mods use and the resolver does not follow.
- Earlier work it builds on: [CCXL merge boundary](../character-customization/ccxl-merge-boundary.md), [catalogue probe](../character-customization/catalog-prototype.md), [source resolution contract](../character-customization/mod-source-resolution.md), [resolver validation](../character-customization/resolver-validation.md), [render coverage](../character-customization/render-coverage.md) and the per-category knowledge pages.

## Open

The [ranked resolver gaps](../character-customization/file-chain-map.md#resolver-gaps-ranked) are the queue. The top of it needs the game, not code:

1. What the game draws for a saved choice whose mod is gone (CC file chain test ask 5), which decides stable identities for rebuilt XF Eye Artistry collections.
2. Which consumer groups reach gameplay and photo mode for a new option (test ask 6), which every export (eye makeup, piercings, brows, cheeks) relies on.
3. `.ent` patches in the resolver (code, M), then the order of same-priority face decals (head CC test ask 3) and the piercing morph and rigid-part checks ([experiment 024](../../experiments/024-ccxl-piercings/README.md)).

This is read-only research; it feeds [CC controls and presets](cc-controls-and-presets.md) (track 3) and [CCXL capabilities](ccxl-character-creator-capabilities.md) (track 8).
