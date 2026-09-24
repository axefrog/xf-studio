# Optional head details — 23 September 2026

Shape Studio renders two specific reference accessories, selected by the captured save's resource hashes and appearance names. Each has a visibility switch. This is a local research assembly, not a general MO2 load-order resolver or a complete saved-V likeness.

## Brows

Source: `F:/Games/MO2/mods/Beautiful EYEBROWS II - CCXL - Realistic Textures - BOTH V/archive/pc/mod/Arkhe_Beautiful_Eyebrows_02_FULLER_CCXL.archive` and its `.xl` sibling. Saved resource hash `10685882159528859062`, appearance `ark_eyebrows_02_ccxl_18`, definition `10_brown_ombre`.

The selected app's compiled morph component references hash `5838896660247859963`, which resolves to `arkhe\ccxl_eyebrows_02\models\pwa\heb_000_pwa__morphs_18.morphtarget`. Its `resolvedDependencies` list incorrectly names morphs_05: component references are the authority here. The morph blob is null and the base mesh is a partial resource. Exporting these as complete geometry fails.

The `.xl` copies vanilla female eyebrow resources into `arkhe_copy`, then patches `blob`, `boundingBox`, `targets` into the morph stubs and `renderResourceBlob` into the mesh stubs. Therefore the preview exports `base\characters\head\player_base_heads\player_female_average\heb_000_pwa__morphs.morphtarget` with its vanilla base mesh, and assigns the style-18 texture. This follows the declared geometry assembly. It does not prove which conflicting replacement, if any, won in the last reference game session.

Geometry: 390 vertices, 105 morph targets, 74 skin joints, two weight sets. The brow material derives from `mesh_decal_double_diffuse.mt`; its actual diffuse/secondary/gradient/normal behaviour still needs shader adaptation. Current preview uses the grayscale diffuse texture as coverage and a provisional brown tint. No exact ombre match is claimed.

## Lashes

Source: `F:/Games/MO2/mods/Soft Natural Eyelashes - CCXL/archive/pc/mod/CCXL_icxrus_SoftNaturalEyelashes.archive`. Saved resource hash `6047185506343464350`, appearance `icxrus_softnaturaleyelashes`, definition `05_brown_liquorice`.

The female morph and base mesh contain full data. WolvenKit Console resolves dependencies through game archive loading, which does not automatically see MO2's separate mod folder. Export therefore uses an isolated `projects/xf-eye-artistry-ccxl/build/preview-game` context containing copies named `basegame_brows.archive` and `basegame_lashes.archive` plus an empty `bin/x64` directory. Original game/mod folders remain untouched. The `basegame_` prefix matters to this CLI's archive discovery.

Geometry: 22,416 vertices, 21 eye morph targets, 57 skin joints, two weight sets. The material overrides `Strand_Alpha`; that real texture is retained. Colour and anisotropic hair shading are not faithfully reproduced. Synthetic blinking includes `eye_lid_lashes_*` bones as well as ordinary eyelid bones; all accessory morphs matching the head are synchronized.

## Reproduction and evidence

Local extracted/serialized files are under `research/consumers/saved-v-brows` and `saved-v-lashes`, excluded from Git. WolvenKit Console 8.17.4 was used for this narrow conversion; these results do not depend on upgrading the installed application.

1. Unbundle selected resources from each mod archive by recorded hash/path; serialize `.app`, `.morphtarget`, `.mesh` and `.mi` for inspection.
2. Unbundle the vanilla brow morph from `F:/Games/Cyberpunk 2077/archive/pc/content`. `unbundle` requires that explicit input path even if `-gp` is supplied.
3. `export <vanilla morph> -o <existing output directory> -gp "F:/Games/Cyberpunk 2077"` preserves geometry, morphs and skin. Export mod XBM textures with `--uext png`. Export the lash morph against the isolated archive context above.
4. Run `bun tools/intake_details.ts` in authoring. It copies local derived assets and records SHA-256 hashes in [details manifest](../../projects/xf-studio/authoring/evidence/details-manifest.json).

Browser checks: on/off visibility, open/closed pose, saved five-region morph import and hash/definition matching. Automated asset checks verify morph counts, multiple weight sets and normalized total weights. No game launch was needed. The assets are local reference material and must not be included in a redistributable release.
