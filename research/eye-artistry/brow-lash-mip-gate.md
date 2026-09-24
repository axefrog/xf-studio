# Saved brow/lash fidelity: authored mip gate

24 September 2026. This is a read-only follow-up to the [saved material study](brow-lash-fidelity.md), [style-18 shape audit](brow-shape-followup.md) and [lash compiled-pass audit](lash-material-followup.md). No preview material, geometry, saved character, game installation or third-party asset changed.

## Brow mip check

The installed Arkhe Beautiful EYEBROWS II FULLER style-18 primary `ark_heb__base_d18.xbm` and secondary `ark_heb_wa__base_ds18.xbm` each serialize a 2048×1024, 12-level, uncompressed RGBA mip chain. Their existing locally serialized resources were checked with [`audit-brow-mips.py`](../../projects/xf-studio/authoring/tools/audit-brow-mips.py). The script compares each **stored alpha mip** to a 2×2 box reduction of the preceding stored mip; that is a controlled numerical reference, not a reconstruction of WebGL or REDengine filtering.

| Stored level | Size | Primary alpha mean absolute error / max, 8-bit units | Secondary alpha mean absolute error / max |
|---:|---:|---:|---:|
| 1 | 1024×512 | 0.0633 / 1 | 0.0484 / 1 |
| 2 | 512×256 | 0.0675 / 1 | 0.0564 / 1 |
| 3 | 256×128 | 0.0695 / 1 | 0.0632 / 1 |
| 4 | 128×64 | 0.0786 / 1 | 0.0692 / 1 |
| 5 | 64×32 | 0.0869 / 1 | 0.0781 / 1 |
| 6 | 32×16 | 0.0996 / 1 | 0.0840 / 1 |

Through level 10, **every pixel's stored alpha differs by at most one byte** from that local box reduction. The final 1×1 level differs by 7 and 11 bytes respectively; it has no resolved eyebrow silhouette. The primary RGB chain has larger differences because it is tagged `isGamma=1`; the secondary is `isGamma=0`. The browser loads decoded base PNGs and lets WebGL create mips, so an exact runtime equivalence is not claimed. Still, the stored alpha chain contains no large authored density or shape alteration that would justify changing the preview geometry or forcing an alternate mip level to make the brow thinner. For the shader study's `coverage = (p + (1-p)·0.7s)²`, the measured level-1 per-texel mean alpha errors bound the mean coverage difference against this box reference below 0.0008, before filtering between levels. This bound does **not** include differences in actual GPU filters, coordinate derivatives or the engine's further decal passes.

The source images, texture bytes and serialized JSON are ignored local research inputs. Their decoded base PNG hashes remain primary `5fac5306ee4f32c082a6739457170e5f5d2aac5e2f3a73eb3c903628ebfdb56f` and secondary `1684bedf441efc495bd06f3c8c1438e7293dc00f7f3b4b55bc6ce254d1546eaf`. [The provider audit](brow-texture-audit.md) identifies the sole installed candidate and archive hash. These files are installed candidates, not measured winners from Nathan's photographed game session.

## Decision and remaining gate

The Soft Natural `05_brown_liquorice` preview already uses the exact saved alpha image; its RGB channels are identical greyscale and PNG alpha is solid. Its `Strand_ID` and `Strand_Gradient` placeholders are spatially constant, while the current `#302d29` colour is explicitly a swatch-calibrated approximation of the saved vanilla hair profile. The inspected game cache has separate hair alpha and base-colour passes, but no proven binding table or final rendered RGB for this custom lash. There is therefore no source-backed lash tint, opacity, strand variation or sorting correction to make here.

The installed Arkhe style-18 registration and `.xl` copy of vanilla render buffers still support the preview's current geometry. The corrected double-diffuse alpha adapter already makes its visible fringe slimmer than the old green-channel fallback. The remaining apparent-thickness gap could involve post-G-buffer normal/skin shading, WebGL versus engine mip sampling, camera/pose/light mismatch, or a runtime resource state not proven by this offline scan. These are hypotheses, not measured causes. Keep the current preview geometry, lash tint label and material behavior. The next useful gate is a fixed pose/camera/light in-game capture of the exact saved choices, with effective resource winners and engine material bindings recorded in the planned batched session. Compare brow *coverage/silhouette* separately from darkness, and lash colour separately from alpha/ordering.

Reproduction on Nathan's local 2.31 resource extraction:

```powershell
python projects/xf-studio/authoring/tools/audit-brow-mips.py `
  D:/Dev/cp2077-modding-hq/research/consumers/saved-v-brows/json/ark_heb__base_d18.xbm.json `
  D:/Dev/cp2077-modding-hq/research/consumers/saved-v-brows/json/ark_heb_wa__base_ds18.xbm.json
```

Provenance: [Arkhe Beautiful EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168) by Arkhe supplied the style-18 source; [icxrus Soft Natural Eyelashes](https://www.nexusmods.com/cyberpunk2077/mods/29582) supplied the lash source; [Alliekat Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787) supplied the installed brow-gradient candidate. [WolvenKit](https://github.com/WolvenKit/WolvenKit) 8.17.4 serialized the local texture resources. This is learning/tool use from installed sources, with no code or assets copied into Git. The central [community credit record](../../docs/community-credits.md) already identifies these contributors; the integrating parent agent owns any central update for this added mip finding.
