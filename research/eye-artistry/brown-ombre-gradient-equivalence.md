# Saved brow brown-ombre gradient: base-game versus installed override

24 September 2026. This is a read-only, private source comparison for Nathan's
saved Arkhe Fuller style-18 `10_brown_ombre` brow. It changes no Studio material,
saved character, mod, or game installation. It narrows the colour discrepancy;
it does not establish a game-rendered match or a runtime archive winner.

## Result

The installed Alliekat Natural Hair Tones archive does contain an override of
`base\\characters\\common\\hair\\textures\\cap_gradiants\\hh_cap_grad__brown_ombre.xbm`
(resource hash `17043542013265241872`). A fresh extraction from that archive
and, separately, the installed Cyberpunk 2077 2.31
`basegame_4_appearance.archive` found **different XBM resources**:

| Source | XBM SHA-256 | `allowTextureDowngrade` | `isGamma` |
|---|---|---:|---:|
| Base game | `0b14e679ebcf87863bba34add1902d53511901463b535cd3a6252d090d979da5` | 1 | 1 |
| Alliekat installed candidate | `1dc22d5095808b62aacefb808af2c64115bf00ce366a40aa83acfe64f2a94dbd` | 0 | 1 |

**Their decoded base-level images are pixel-identical**: 0 of 128 RGBA pixels
differ, and both WolvenKit 9.0.1 PNG exports have SHA-256
`53cfa17949db9dd729de1d364754a2c9bb43c41a6e7448ab25f89e4eaf18a4cd`.
The rightmost sampled texel is `(102,72,32,255)` in every one of the four rows.
The game's saved brow material sets `GradientMapUV=1` and the inspected compiled
double-diffuse path samples the gradient at `(1,0.5)` (see
[the material study](brow-lash-fidelity.md)). Thus the Studio's existing
hash-verified image and sRGB sampling use the same **base gradient pixels**
whether this installed override or the game resource supplies them. At the
close-up, the hypothesis that a different Alliekat base palette explains the
brow colour gap is ruled out for this selected gradient. The name `brown_ombre`
does not mean this shader varies the palette position across the brow: its
selected UV is constant. Strand colouring and apparent shape still vary through
the brow's primary/secondary maps, alpha, normal and lighting paths.

The six stored BC7 mip levels are not entirely identical. Independent decoded
pixel comparison gives:

| Mip size | Different RGBA pixels | Maximum channel delta, 8-bit |
|---:|---:|---:|
| 32×4 | 0 / 128 | 0 |
| 16×2 | 20 / 32 | 4 |
| 8×1 | 6 / 8 | 5 |
| 4×1 | 4 / 4 | 10 |
| 2×1 | 2 / 2 | 20 |
| 1×1 | 1 / 1 | 20 |

These lower mips and the texture-downgrade flag are real resource differences.
Ordinary implicit texture sampling of a *constant* `(1,0.5)` coordinate has
zero derivatives and ordinarily selects the base level. An engine-specified LOD
or downgrade policy has not been measured, so this audit does not claim the
stored mips can never affect a game frame. It does show that replacing the
Studio's base gradient image with a separately extracted Alliekat PNG cannot
correct the present close-up: those PNGs are byte-identical. No geometry,
alpha, tint or texture substitution follows from this result.

## Reproduction and evidence boundary

WolvenKit Console 9.0.1 unbundled resource hash `17043542013265241872`
**separately** from the installed base-game and Alliekat archives. Supplying
both archives to one extraction destination can overwrite the same depot path;
the separate directories and full XBM hashes above avoid that ambiguity.
`convert serialize` exposed the texture setup and 272-byte BC7 mip buffer.
`export --uext png -gp <game>` produced the independent identical base PNGs.
[`compare-gradient-xbm.py`](../../projects/xf-studio/authoring/tools/compare-gradient-xbm.py)
decodes each stored BC7 mip with Pillow and reports aggregate pixel differences
without outputting source pixels. Its base decode also matches the independent
WolvenKit PNG at every pixel. The source XBM/JSON/PNG files remain under ignored
`research/consumers/brow-gradient-check/` in the isolated worktree.

The local [hair-profile guide](../../../Cyberpunk-Modding-Docs/for-mod-creators-theory/files-and-what-they-do/file-formats/materials/hair-profiles-.hp.md)
and [hair/skin material guide](../../../Cyberpunk-Modding-Docs/for-mod-creators-theory/materials/configuring-materials/hair-and-skin-material-properties.md)
were checked at `be2f44eed8419342ec13f72ed9cab008e9f7b289`. They concern
hair `Strand_ID` and root-to-tip profile lookups, not this brow-decal gradient.
Neither guide's hair section illustrates the brow mechanism. The latter page's
two referenced screenshots, `.gitbook/assets/skin_shader_microdetail_scale.png`
and `skin_shader_UV_scale.png`, were inspected and depict skin microdetail/UV
layout, so they provide no game-runtime proof for this gradient. Previous
[lash shader work](lash-material-followup.md) remains the source for lash colour
limits. A matched game capture with effective resource bindings remains needed
to calibrate brow darkness and lash colour.

Community provenance: [Alliekat's Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787)
provided the installed candidate and taught the specific distinction between
an archive override and changed rendered base pixels. [Arkhe's Beautiful
EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168) supplied the
saved style/material chain. [WolvenKit](https://github.com/WolvenKit/WolvenKit)
9.0.1 decoded the private resources; the game's source data are CD PROJEKT RED
2.31. The community wiki authorship and screenshot scope are recorded in the
[central credits](../../docs/community-credits.md). This is source learning and
local tool use; no third-party bytes, code or images enter Git or a release.
