# Hair Lab experiment

The maintainer approved an experimental, feature-flagged Hair Lab prototype: long loosely wavy hair generated from a strand-budget volume graph, replacing the resolved hairstyle only while the lab is active. This is an approved research exception; broader hair functionality still waits for the current product to be finished and polished. It is not a requirement for 1.0.

Current state: the [approved design and model contracts](../hair/hair-lab-design.md) have a rough M2 vertical slice on V: derived clump cores, layered cards through the native hair shader and colour profile, groom-depth self-shadow, generated cap coverage and global Undo/History. Five data-only styles exercise head/body contact, convergence, tip-line trimming and warm continuation. Blind visual review still identifies exposed card construction, thin crown/tip coverage, swept-bang placement and weak lock separation. Coarse latency exceeds its target; warm refined display with occlusion is measured at about one second. Independent UI/UX review is PASS. M3 styling and build-only export remain later work. Nobody runs the game during this prototype run.

The active R&D questions are scalp derivation, head/shoulder contact, stable identity across field transport, and action-to-frame latency. Budgets and evidence grades live in the design. Reuse installed vanilla strand atlases through the existing resolver; never package extracted references. No deployment is authorised.

## Preset hairlines (queued for after M1 of the core rebuild)

The current default hairline is traced from the reference hairstyle's hair cap texture. That cap was painted for one long style, so it has a straight, square-cornered front band and no sideburns. On ponytails, updos and short styles, where the hairline shows, that looks artificial.

- **Decision (October 2026):** the default hairline becomes a natural anatomical template, and "match this game hairstyle's cap" stays available as an optional starting point. The template has rounded temples, a gentle front curve, sideburns to about mid-ear and a natural nape, and is bound to the verified head landmarks (forehead, temples, ear attachments, nape). Its variations are ordinary controls: widow's peak, temple recession, sideburn length.
- **Dependency:** if the game's own cap texture is kept, hair rooted outside it would grow from untinted skin. Generating the scalp tint from the same density map removes the mismatch by construction; decide that with the export work.
- **Same pass:** Side shave's density mask is a hard straight split down the head's midline, front and back. Replace it with a proper one-sided shaved region with a soft edge and regrowth density.
- Everything the change touches gets recertified, with before/after captures.

## Rigging and physics (banked; research first)

Generated hair is baked at export: the influences that shape it are authoring tools, and behaviour in game comes from generated skinning and bones.

- **Observed problem in existing hair mods.** Many otherwise good hair mods respond to head pose like a rigid shell: tilting the head in photo mode rotates the whole hair mesh, so long hair clips through the back (head tilted back) or lifts off it (head tilted forward). The likely cause, still a hypothesis, is the whole mesh weighted to the head bone with no chain or body weights. Many ported styles lack good rigging.
- **A counter-example.** The Chevelle hairstyle mod keeps the lower rear hair pinned to the back, which avoids that clipping. Its mechanism hasn't been inspected yet; one hypothesis is skin weights that blend from head to neck and spine bones along the hair's length.
- **Vanilla** hair mostly uses bone rigging with limited physics; better results are possible at a performance cost.
- **Opportunity.** The volume graph already knows each bundle's centre line, stiffness, holds and where it rests on the body. The generator can derive rigging from it. In order of cost:
  1. Length-wise weight blending from head to neck, shoulders and spine for hair that rests on the body. This is pure skinning, so it follows pose changes immediately, including in photo mode, where simulated physics may not settle.
  2. Physics chains per major volume, with chain stiffness from the bundle model, inside a bone budget.
  3. Ties and holds as pinned joints.
- **Research first.** How vanilla hair and the Chevelle mod carry skinning and physics (bones, components, data), from the files. Then the acceptance case is a photo-mode test: the head tilted forward and back with long hair, and no clipping or lifting.

## Open bugs

- **Scalp density against its seed** (HAIR-02): `hair-worker.ts` rebuilds density from the current seed surface without comparing the stored `scalp.densitySeed`, and `authored()` drops authored density that differs from the seed; compare the seed source, flag a mismatch and keep the authored density.
