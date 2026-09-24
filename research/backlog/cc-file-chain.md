# Character-customisation file-chain study

**Status (25 Sep 2026): open.** Track 5 in the [ranked queue](README.md). A wiki-based chain map exists; the consolidation across all sources and CC categories has not been done.

## Requirement

Consolidate, in one navigable reference, how character-customisation files tie together — from `.archive.xl` declarations through `.inkcharcustomization` groups/options, `.app` definitions, mesh components and appearances, morph targets, material instances/templates and textures/profiles — for **every** CC category (head, eyes, brows, lashes, hair, skin, makeup, piercings, teeth, body/arms), including how ArchiveXL/CCXL transforms them and how saves reference the result.

## Sources

| Source | Use | Rules |
|---|---|---|
| Local wiki clone `D:/Dev/Cyberpunk-Modding-Docs` (tracks `upstream/main` at `be2f44ee` as of 23 Sep) | Documented resource relationships | Inspect each guide's **diagrams and screenshots** as evidence, not just prose. Record source commit, exact guide and image paths, page authorship where evidenced. Separate illustrated/editor examples from runtime proof. |
| Legacy xf-omega code, `D:/Dev/xf-omega` (e.g. `source/projects/xf-eye-artistry-ccxl/`, `source/red-engine/`) | How the old generator actually built CCXL makeup resources; lessons and pitfalls | **Reference only** — never resume or modify it. Its outputs are historical, not a compatibility target. See [lineage](../eye-artistry/lineage.md) for the pinned commit. |
| `D:/Dev/sx-cp2077/docs/xf-eye-artistry-ccxl/` (`modding-knowledge.md`, `xf-omega-architecture.md`, etc.) | Earlier first-party written knowledge | Reference only; treat archived agent plans as historical evidence, not current mandates. |
| Installed game 2.31 resources and MO2 mods | Ground truth for resource shape | Extracted payloads stay local/ignored; record hashes and tool versions. |
| ArchiveXL source `D:/Dev/cp2077-archive-xl` | What the extension merges | See the [merge boundary note](../character-customization/ccxl-merge-boundary.md). |

## Existing work to consolidate

- [File chain and image guide](../character-customization/file-chain-map.md) — the current wiki-based map (chain diagram, per-resource table, ArchiveXL transformation limits).
- [CCXL merge boundary](../character-customization/ccxl-merge-boundary.md), [catalogue probe](../character-customization/catalog-prototype.md), [source resolution contract](../character-customization/mod-source-resolution.md).
- Worked chains for single saved choices: [modded eyes](../eye-artistry/modded-eye-resolution.md), [brow textures](../eye-artistry/brow-texture-audit.md), [hair profile](../eye-artistry/saved-hair-profile-resolution.md), [skin and teeth](../eye-artistry/saved-skin-resource-chain.md), [vanilla piercings](../jewellery/vanilla-piercing-preview.md), [PRC catalogue](../jewellery/prc-catalog-audit.md).
- [ArchiveXL makeup strategy](../archive-xl/eye-artistry-strategy.md) (legacy matrix lessons).

## Deliverable

Extend `research/character-customization/file-chain-map.md` (or split per category beneath that folder) so that for each CC category it states: the resource types involved, the linking fields, where colour/material variants come from (definitions, `.hp` profiles, gradients, instance overrides), how mods add or patch options, how the save stores the choice, and a worked example with hashes. Mark every link as documented, source-verified or runtime-observed. Record learned lessons in [community credits](../../docs/community-credits.md).

This is read-only research; it feeds [CC controls and presets](cc-controls-and-presets.md) (track 3) and [CCXL capabilities](ccxl-character-creator-capabilities.md) (track 8).
