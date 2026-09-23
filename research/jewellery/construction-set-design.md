# Jewellery construction set — design proposal

Research/design snapshot, 24 September 2026. This proposes a reviewable *authoring grammar*, not an implemented editor or a game-ready piercing package. Eye makeup remains the active authored feature. Distances below are illustrative model dimensions, **not** fitting advice for a real piercing or calibrated REDengine coordinates. No external photo, mesh, texture, product silhouette, or mod asset is included in XF Studio.

## What the pictured references teach

The [Association of Professional Piercers' illustrated initial-jewellery brochure](https://safepiercing.org/wp-content/uploads/2020/05/APP_Initial_Print.pdf) separates *gauge/thickness*, *wearable length* and *ring diameter* in its measurement diagram and pictures a nostril screw, labret stud, circular barbell and fixed-bead ring as distinct mechanical forms. Its [procedure-manual illustrations, p. 31](https://safepiercing.org/wp-content/uploads/2020/10/APP_Procedures_2013_A_Web.pdf) further distinguish nostril nails, septum retainers, eyelets and captive-bead ends. These are the right conceptual measurements and closures for our controls; a single generic “scale” slider would conflate them. The brochures credit photos to **Paul King**, **Neometal**, and **Industrial Strength Body Jewelry** where noted, and their measurement diagram/text to **Elayne Angel, *The Piercing Bible***. The initial-jewellery brochure states **CC BY-NC-ND 4.0**. These illustrations are viewed as references only, not copied or adapted.

Actual product images illustrate the compositional range:

| Visual source (view image on source page) | Observation and design consequence | Authorship / rights |
| --- | --- | --- |
| [Anatometal seam ring](https://anatometal.com/products/seam-ring-titanium), [captive-bead and circular-barbell collection](https://anatometal.com/collections/circular-barbells-and-captive-bead-rings), [prong ends](https://anatometal.com/collections/prong-ends) | A ring body, its closure/end, and the ornament or gem setting are separable choices. The taxonomy includes seam rings, beads, straight/curved posts, prong ends, cabochons and dangles. | Anatometal product photography/design, © 2026. Reference only; no reuse permission established. |
| [Maria Tash illustrated hoop-size guide](https://www.mariatash.com/3mm-diamond-princess-triangle-hoop-earring-non-rotating.html), including 5, 6.5, 8, 9.5 and 11 mm placement images | Inner diameter and site must be independent. Its suggested placements differ even across parts of one ear; use local character-anatomy fit checks rather than promising a universal diameter. These examples provide a scale sanity check, not a default for every V. | Maria Tash guide/product imagery, © 2025/26. Reference only. |
| [Maria Tash linked hoop and cuff, product image 1](https://www.mariatash.com/cdn/shop/files/X2ETDPE-WG-D8-L_1_P.png?v=1760612380) and [side view](https://www.mariatash.com/cdn/shop/files/X2ETDPE-WG-D8-L_2_P.png?v=1760612378) | Front and side pictures show one pierced lower hoop, one higher cuff, and a **rigid connector**. A connector must therefore support rigid bars as well as flexible chains; a cuff need not imply a second piercing. Product includes a left/right direction choice. | Maria Tash product design/photography, © 2026; product page notes patented design. Reference only; do not reproduce its ornamental pattern or linkage dimensions. |
| [Stone and Strand diamond-stud-to-cuff chain](https://www.stoneandstrand.com/products/tiny-diamond-and-ear-cuff-chain-earring), [photo](https://www.stoneandstrand.com/cdn/shop/products/TINY-DIAMOND-AND-EAR-CUFF-CHAIN-EARRING-WEAR-IT-WITH_750x.jpg?v=1605549939) | Two anchors and a draped chain create a different topology from a freely dangling charm. The chain can visibly move relative to the ear while its ends remain anchored. | Stone and Strand product/photo; rights not established. Reference only. |
| [BVLA septum collection](https://www.bvla.com/collections/nose_7/septum_13/myla_p53/), [nose chains](https://www.bvla.com/collections/nose_7/nose-chains_121/) | Clickers, curved bars, seam rings, decorative fronts and chains are separate style families; a septum piece cannot be represented faithfully by resizing a nostril hoop. | BVLA product design/photography, © 2026. Reference only. |

The linked image URLs are a *reference manifest*, not assets to ingest. Product pages may change; before a design is implemented, compare the cited front/side images and the brochure's gauge/diameter diagram again. The examples below use common structural primitives rather than tracing any one pictured product.

## Game-side constraints already established

The [local PRC inventory](prc-inventory.md) shows how eagul's older framework fills fixed morph slots in a replacement vanilla piercing `.app` (128 slots per body variant, appearances by colour). Some installed item packs collide on the same morph-resource paths; profile selection does not prove which resource renders. This is useful evidence for rigged attachment and morph-following needs, **not** a catalogue to reuse or an export architecture to inherit. Its Nexus terms require author permission for copying/modifying assets. No PRC asset is used here.

The [character-customization resource-chain map](../character-customization/file-chain-map.md) connects CCXL options to `.app` definitions, mesh/morph components and materials, with illustrated `.inkcharcustomization`, `.app`, `.mesh` and `.mi` examples. A creator choice may activate one or several components, while an inventory item can use `.ent` and appearance resources. The [PRC survey](prc-inventory.md#preview-and-future-implementation-routes) identifies a possible CCXL `piercings`/`piercings_color` route and a proven *pattern* of EquipmentEx ear-slot use in Kwek's Small Fancy Hoop Earrings, but neither route yet proves our authored geometry, attachment, animation or save behavior. Keep the recipe independent of deployment route.

## Proposed composition model

One `JewelleryDesign` is a small directed assembly graph with stable IDs, authored parameters and a display name. It contains `placements` (one or more anatomical sites), `parts` (reusable generated primitives or future **owned/licensed** mesh imports), `joins` (rigid socket, hinged, chain, or pendant), and `materials` (metal, stone/enamel, finish). `variants` hold left/right, paired, colour and size choices without copying the whole design; a collection/preset references stable design IDs. Reserve the lowercase `xfs_` prefix for generated *game appearance names* at compilation, not for a user's editable display name.

```text
JewelleryDesign { id, revision, displayName,
  placements: [{ id, site, side, bindingProfile, localFrame, fitOverrides }],
  parts: [{ id, kind, parametersMm, materialSlot, sockets[] }],
  joins: [{ fromSocket, toSocket, mode, restLengthMm?, stiffness? }],
  variants: [{ id, overrides, symmetryMode }],
  previewPolicy: { chainMotion, showHiddenPost, collisionEnvelope }
}
```

The *site* names should be semantic (`nostril.left`, `nostril.right`, `septum`, `ear.left.lobe1`, `ear.left.helix`, etc.), not naked global XYZ. Each resolves to an oriented frame on the current character's deforming head/ear with a calibration revision and provenance. A placement can be `pierced`, `cuff/clamp`, or `surface adornment`; this prevents a decorative cuff from inventing a save-game piercing. Mirroring must swap anatomical sides and recompute handed orientation, not just negate world X; asymmetry may be intentional. A missing site/binding is an explicit unresolved state, never a silent default placement.

The initial part library needs `post/flat-back`, `stud end`, `ring arc` (round or elliptical centreline, inner diameter, wire cross-section, angular gap/closure), `circular barbell`, `bead`, `bezel/prong setting`, `faceted/cabochon stone`, `cuff arc`, `link/chain`, `rigid bridge`, and `pendant/charm socket`. Generic silhouettes for charms can be simple sphere/disc/drop/star/geometric plate; authored shapes come later. The graph validates socket compatibility and cycles; a chain connecting two anatomical anchors is not the same as a pendant chain with one free end.

Use **millimetres internally** for diameter, wire thickness/gauge, wearable post length, stone size and connector length, with a user-facing gauge conversion where useful. The scene importer must measure its model-unit-to-mm conversion before claiming fit. Diameter and wire thickness are separate axes. Geometry can regenerate continuously within safe parameter bounds, but changing `ring` to `circularBarbell` or `post` to `cuff`, changing closure topology, stone cut, number of prongs, chain link family, or anchor count is a discrete variant. Too-small diameter, excessive wire thickness and other invalid fits should produce a visible warning and preserve the last valid preview instead of silently clipping or distorting the part.

Each material is a *visual* specification with base colour, roughness, metallic response, optional anisotropy/texture, and stone optical intent. Preview may approximate polished steel/titanium, gold-coloured metal, matte black, enamel, pearl-like and coloured stone. Do not equate a browser PBR preset with a validated REDengine shader or with real-world material safety. Export must later map this abstract material to tested game templates, with warnings where gemstone refraction, physics or high-frequency sparkle cannot match.

## Six representative designs to review

All dimensions are **starter UI values for virtual characters**, to be calibrated against the actual head mesh and available rig. None reproduces a referenced commercial piece.

| Design | Assembly and editable parameters | What it tests |
| --- | --- | --- |
| **Pinpoint nostril stud** | Left or right nostril placement → virtual flat-back/post → 1.5–2 mm round bezel or prong-set stone; adjustable end size, metal and gem colour, local seating/angle. | Nose-surface frame, partial occlusion of post, mirror and material contrast. |
| **Fine nostril ring / paired rings** | One or two nostril placements → seam/hinged ring arc; illustrative 6–10 mm inner diameter, 0.8–1.2 mm wire, closure angle and orientation. Optional two-anchor connector is a separate graph edge. | Distinguishing diameter from gauge, clearance from nostril rim and paired asymmetry. |
| **Minimal horseshoe septum** | Septum placement → circular-barbell arc with adjustable opening → independent ball/cone ends. A decorative clicker front is a *different topology variant*, optionally with repeated small stone settings. | Bilateral alignment, nasal silhouette, closure/end swap without remeshing all finishes. |
| **Single huggie with drop** | Lobe site → close-fitting hoop → hinge/socket → small geometric drop charm, mirrored as a pair or worn singly. | Earring fit, exposed back, pendant pivot and hair occlusion. |
| **Stud-to-cuff drape** | Lobe stud plus upper-ear cuff → two anchored sockets joined by a chain with adjustable slack/link scale; left-only by default, paired variant optional. | Two-site attachment, chain sag/animation, no fictional upper piercing. Deliberately unlike the rigid Maria Tash connector. |
| **Asymmetric long drop** | One lobe post → short chain(s) → two or three independent geometric charms at staggered lengths; other ear has a small plain stud. | Unpaired preset, multiple dangling elements, silhouette/LOD and hair/shoulder collision. |

The first practical **vertical slice** should be the pinpoint stud plus a plain hoop on a neutral and morphed head. That exercises site frames, mm calibration, materials, skin clearance and both topologies with little physics. A two-site chain follows only once animated attachment is stable.

## Authoring and validation boundaries

The future editor should let someone choose a site, add/swap parts, connect compatible sockets, edit physical dimensions numerically or with direct handles, select materials per part, duplicate/mirror a placement or deliberately break symmetry, save reusable components/presets, and compare neutral/animated/left/right views with hair and other head details toggled. Expose validation results at the design location: missing site, hole/skin intersection, ear or nose penetration, overlap with makeup/other piercings, occlusion by hair, and unverified material or motion mapping. A “show hidden post” inspection toggle helps explain why only the visible ornament appears in normal preview.

Jewellery should largely retain its own rigid shape while its attachment frame follows head/ear skin and facial morphs. For multi-point pieces, the *two* attachment frames must deform independently, then the chain/bridge recomputes between them. A rigid bridge can strain or intersect after morphing; either constrain it to suitable placements or report a fit conflict. Chain motion needs a deterministic paused pose for design and, later, optional physical/damped preview. Do not bake one flattering camera angle into the geometry. Run sampled neutral, saved-V morph, creator idle and expression extremes; test front, profile, three-quarter, blink/jaw and close camera as relevant. For earrings include hair and glasses, collars/shoulders, and ear movement/physics when supported. Save warnings and source/candidate confidence separately from actual game-verified results.

Game compilation will have to decide whether a design appears as a CCXL creator choice, an inventory/EquipmentEx fashion item, or both. Since PRC's replacement bank collides by resource path, our authored design identities should not depend on PRC slot numbers. Keep the studio recipe/SQLite object independent of `.app`, `.ent`, `.morphtarget` and TweakDB packing; create deployment adapters only after an isolated, legal owned-geometry fixture works and the user reviews the interaction model. Compile only selected designs and deduplicate shared material/geometry recipes so arbitrary colours and components do not become another unmanageable matrix.

## Decisions for Nathan before jewellery authoring starts

1. **First scope:** Should the first released construction set cover nostril, septum and lobe, or include cartilage cuffs and linked chains from day one? The latter adds multi-anchor fit and motion work.
2. **Creator versus outfit:** Should facial piercings be permanent character-creator selections while removable earrings are inventory items, or should users be able to publish the same design through both routes where technically proven?
3. **Physical vocabulary:** Would a concise library of generic settings, geometric charms and chains satisfy the first iteration, with custom imported charms later? This avoids copying distinctive jewellery designs.
4. **Movement target:** Are static, believable chain drapes sufficient for first export, while browser animation/physics are a later quality tier? Their in-game physics needs its own evidence.
5. **Fit responsibility:** Should designs be calibrated per head/body preset automatically where possible, or should the studio expose local fit overrides for every saved-V face? The likely answer is both, but it affects recipe portability and user experience.

## Provenance and limits

This note learns **measurements and mechanical form** from the Association of Professional Piercers/Elayne Angel; **style grammar and photographed placement** from Anatometal, Maria Tash, Stone and Strand and BVLA; **game resource constraints** from eagul's PRC and the [community modding guides](../character-customization/file-chain-map.md); and a concrete **ear-equipment packaging pattern** from Kwek's installed mod (see [PRC inventory](prc-inventory.md)). It adapts **no code or assets**. The official-source pages are linked above. Page-specific photographer names for the commercial product photos are not stated, so authorship beyond the brands is unresolved; image/model/design reuse would require permission and, for the cited patented Maria Tash example, specific IP review. The root integration must add/update `docs/community-credits.md` entries for any of these newly used learning sources before its checkpoint. No runtime game test or jewelry fit calculation has been performed.
