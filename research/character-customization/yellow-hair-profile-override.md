# Yellow-to-brown hair: Alliekat's Natural Hair Tones replaces the base hair profiles

25 September 2026. Read-only investigation of why the default V's hair in the Studio preview, and many NPC hairdos in the reference installation, show a gradient from pale yellow at the root to saturated brown at the tip. Sources: the reference MO2 profile `2025 (again)`, the installed game 2.31, the Studio resolver (`archive-precedence.ts`, `resolver-host.ts`, `character-resolver.ts`) and the Studio's hair colour model (`hair-colour-model.ts`). WolvenKit CLI 9.0.1 extracted and serialized the resources into ignored local space. No game launch, mod manager state or Studio code changed.

## Result

| Question | Answer | Grade |
|---|---|---|
| Which mod supplies the winning vanilla hair profiles? | [Alliekat's Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787), version 1.0.0.0 (Nexus file 82519), archive `Alliekat's Natural Hair.archive`. It replaces all 36 shared colour profiles under `base\characters\common\hair\textures\hair_profiles\` (the colour names vanilla hair meshes use) and 34 matching cap gradients `…\cap_gradiants\hh_cap_grad__{colour}.xbm`. It is the **only** mod, enabled or disabled, that ships any of them. | [resource]; winner by the resolver's mod-over-base rule [source, native lookup unread] |
| Where does the yellow come from? | The mod's own stop colours. In `brown_liquorice.hp` the root is saturated ochre `#996600` and the stop at 18 % is near-white yellow `#ffffcc`; the stops toward the tip are dark browns `#5c3418` and `#663300`. Two ID stops are also raised to near-white, which lightens strands through the overlay. | [resource] |
| Colour-space or ordering error? | No. Stop positions and their stored order are identical to the base game in all 36 profiles; only colours changed, and the new colours are not a transform of the old ones (blue, green and purple profiles become browns and blondes). | [resource] |
| Do NPCs use the same files? | Yes. Vanilla hair meshes, the player's and NPCs', point each colour appearance at a shared `hair_profiles\{colour}__{long,short,curls,dread,braid,beard}.mi`, which sets `HairProfile` to `hair_profiles\{colour}.hp`. | [resource] |
| Intentional? | The mod's purpose is intentional: it turns every vanilla colour, fantasy colours included, into a natural tone. `brown_liquorice` getting a near-white yellow band at the root looks like an authoring slip, not a design (see [below](#intent)). | [resource] + [hypothesis] |

A second installed mod is involved but is not the cause. [Preem Hair (Optional Judy Hair Colors)](https://www.nexusmods.com/cyberpunk2077/mods/8223) 2.2.0.0a (`###-PreemHair.archive`) replaces the shared strand textures `hh_long01_{alpha,grad,id,flow}` and `hh_short01_*`, plus a byte-identical copy of `engine\materials\defaults\default.hp`. With the base profiles, its textures give the same neutral colour as the base textures. Its gradient map sits lower on the root-to-tip axis: 69.5 % of alpha-weighted `hh_long01` hair lies below 0.45, against 54.9 % for the base texture. That puts slightly more hair into Alliekat's yellow root band.

## Precedence

The resolver's R1 rule ([mod loading §1–2](../../knowledge/mod-loading.md#1-the-stages-in-order)) mounted 1,079 archives for the profile. For all 117 `.hp` paths in the installed base archives, it found mod providers for 37:

| Paths | Mod providers (all enabled) | Other copies | Winner |
|---|---|---|---|
| The 36 shared colour profiles | Alliekat's Natural Hair Tones only | `basegame_4_appearance.archive` | Alliekat (`mod-over-content`) |
| `engine\materials\defaults\default.hp` | Preem Hair only | `basegame_1_engine.archive` | Preem (byte-identical to base, SHA-256 prefix `8aba6bc8`) |

An index scan of every archive under the MO2 `mods` folder, including disabled mods, found no other copies, so no mod-versus-mod conflict exists. Profiles for individual NPCs (for example `custom_judy.hp` and `jackie_welles_pony_tail.hp`) have no mod provider.

Mod-over-base is a tool-source rule. The native lookup is unread ([mod loading, open question 1](../../knowledge/mod-loading.md#open-questions)). The in-game observation that many NPC hairdos show the same yellow-to-brown look is **anecdotal runtime support** for the mod winning. The base profiles cannot produce that look: their `brown_liquorice` albedo is a neutral grey-brown at every depth.

## Default V's hair chain

The resolver's default female V (no save; creator defaults) wears `hh_033_wa__player` in `05_brown_liquorice`:

| Input | Resource | Provider |
|---|---|---|
| Mesh | `base\characters\common\hair\hh_033_wa__player\hh_033_wa__player.mesh` | base game |
| Strand material | `…\hair_profiles\brown_liquorice__long.mi` → `_master__long.mi` → `hair.mt` | base game |
| `HairProfile` | `…\hair_profiles\brown_liquorice.hp` | **Alliekat** (base copy is the alternative) |
| `Strand_Gradient`, `Strand_ID`, `Strand_Alpha` | `…\hair\textures\hh_long01_{grad01,id01,alpha01}_r.xbm` | Preem Hair (base copy is the alternative) |
| Cap `GradientMap` | `…\cap_gradiants\hh_cap_grad__brown_liquorice.xbm` | Alliekat |

## Gradient diff: `brown_liquorice.hp`

Stops are sorted by position, as stored 8-bit colours. Both files have `sampleCount` 127. The extracted Alliekat file's SHA-256 is `7425074a…2e27`, the base file's `57b9999e…dcec` (full digests in the [collision audit](../eye-artistry/brown-liquorice-profile-overlap.md)).

| Row | Position | Base game | Alliekat |
|---|---:|---|---|
| Root-to-tip | 0.000 (root) | `#6d6969` grey | `#996600` saturated ochre |
| | 0.182 | `#9b9281` grey-beige | `#ffffcc` near-white yellow |
| | 0.614 | `#8d7c70` grey-brown | `#5c3418` dark brown |
| | 1.000 (tip) | `#d6c5ae` light beige | `#663300` saturated brown |
| ID | 0.080 | `#98a6ad` | unchanged |
| | 0.384 | `#64686c` | unchanged |
| | 0.551 | `#827c75` | `#d1cdba` near-white |
| | 0.879 | `#888888` | `#eeece1` near-white |

Applied to Preem's `hh_long01` textures through the Studio model (sRGB-decoded bake, truncated lookup, luminance-switched overlay; albedo before lighting), the alpha-weighted mean albedo by root-to-tip band is:

| `Strand_Gradient` band | Base profile | Alliekat profile |
|---|---|---|
| 0.0–0.3 (root) | sRGB (93, 89, 82), hue 43°, saturation 0.06 | (210, 198, 127), hue 51°, saturation 0.48, lightness 0.66 |
| 0.3–0.5 | (95, 89, 80) | (161, 145, 105) |
| 0.5–0.7 | (94, 85, 77) | (93, 62, 34) |
| 0.7–1.0 (tip) | (115, 106, 95) | (85, 45, 10), saturation 0.79 |

The base profile keeps a neutral grey-brown from root to tip, slightly lighter at the ends. The Alliekat profile runs from a bright, fairly saturated yellow at the root to a dark, strongly saturated brown at the tip, the reverse of the base profile's light direction. The Python port used for these numbers matched `hair-colour-model.ts` to 0.1 of an 8-bit level at the checked samples.

### Swatches (private)

The swatches were rendered into the ignored `research/consumers/yellow-hair/raw/`, because they contain mod and game colours. They show:

- **`swatch-brown_liquorice.png`.** Base: a muted grey-to-beige root-to-tip strip, a blue-grey-to-grey ID strip, and an overlay map that is almost uniform grey-brown. Alliekat: the strip starts ochre, flares to pale lemon cream around one fifth of the way, then drops to chocolate and rust brown. The ID strip turns cream in its upper half. The overlay map has a vivid yellow-to-cream band on the root side and deep orange-brown over the tip half.
- **`atlas-brown_liquorice-long01.png`** (profile × textures, 2×2). The two base-profile panels show grey-brown cards; Preem's textures only add strand detail. Both Alliekat panels show every card with yellow to cream roots fading into orange-brown ends, with pale streaks where the ID is high. This is the preview anomaly.
- **`atlas-black_carbon-long01.png`.** Base black carbon is near-black with a faint cool tint. Alliekat's is black with golden-brown bands at about one third and at the tip.
- **`swatch-blonde_platinum.png`.** Base platinum is an even cool off-white. Alliekat's goes from black root through tan and mauve-brown to a **black** tip.
- **`contact-root-to-tip.png`** (all 36 profiles). Every vanilla colour except `blonde_ombre`, whose root-to-tip row is unchanged, becomes a natural brown, blonde, auburn or black. Blue, teal, green and purple profiles all become browns. `dark_purple` is solid black, `green_toxic` and `purple_blonde` are flat cream, and `cyberpunk_yellow` runs cream, maroon, salmon, rust and orange.

## Intent

- **The concept is intentional.** Replacing every vanilla colour, including the fantasy ones, with natural tones matches the mod's name and removes brightly coloured NPC hair everywhere.
- **Some gradients look unintended.**
  - The mod kept each vanilla stop position and changed only colours. So the vanilla stop at 18 % from the root, meant as part of a gentle grey ramp, became the brightest colour in `brown_liquorice`: a near-white yellow band just below the scalp.
  - `blonde_platinum` and `red_merlot` end in black tips, which natural hair does not have.
  - 59 of the 184 changed stops are exact preset-palette colours, from web-safe values (`#ffffcc`, `#996600`, `#663300`, `#ffff99`, `#993300`, `#cc6600`), classic office-theme colours (`#eeece1`, `#4f81bd`, `#c0504d`, `#f79646`) and named CSS colours (`#a52a2a`, `#ffa500`, `#800000`). This suggests colours picked from a colour picker's swatch palette rather than sampled from hair references [hypothesis].
- **Not a conversion error.** Unchanged stops are byte-identical to the base game, and changed stops bear no consistent relation to the vanilla values.
- The mod's Nexus description could not be read offline: no cached description in MO2, and the page returned HTTP 403. The judgement above rests on the files alone.

## Consequences for the Studio

- The preview is correct to show the yellow-to-brown hair under this profile. The resolver binds the installed winner, as the game is expected to. No preview change is needed.
- Disabling the mod changes more than NPC hair. Every hair, beard, lash and brow colour that uses these 36 profile names reverts to vanilla. The icxrus lashes of the reference save use `brown_liquorice.hp`, so their predicted albedo would change from dark red-brown to the golden tan of the vanilla tip stop ([collision audit](../eye-artistry/brown-liquorice-profile-overlap.md)). The saved V's hair (island_dancer `ash_brown.hp`) is unaffected.
- The runtime check is already on the list: [head CC rendering, test ask 7](../../knowledge/head-cc-rendering.md) (brown liquorice with and without this mod).

## Reproduction

1. **Collisions.** Collect every `.hp` path in the installed base archives with `WolvenKit.CLI archive <content> <ep1> -l -r "\.hp$"`. Then call `openInstallation({ launchRoute: "mo2", mo2ProfileId: "2025 (again)", … })` and `depot.lookup(depotHash(path))` for each path.
2. **Default V.** Resolve with `loadMergedCco` → `descriptorsFromUiState(cco, {})` → `resolveCharacter` → `planCharacterDetails`.
3. **Profiles.** Extract with `unbundle` (the Alliekat archive in full; `-r "hair_profiles.*\.hp$"` from `basegame_4_appearance.archive`), then `convert serialize`. Read `gradientEntriesRootToTip` and `gradientEntriesID`.
4. **NPC links.** Serialize `hh_023_wa__short_messy.mesh`, `hh_020_ma__mullet.mesh`, `hh_025_ma__pompadour.mesh` and `hh_033_wa__player.mesh`, their `externalMaterials`, and the 269 `hair_profiles\*.mi`. Each colour `.mi` (for example `brown_liquorice__long.mi`) has one `HairProfile` override, `…\{colour}.hp`, over `_master__{style}.mi`, which carries the shared strand textures.
5. **NPC appearances.** The citizen `.app` files use these colour appearances directly. For example:
   - `base\characters\appearances\citizen\citizen__aldecaldos_wa.app` `nomad_03`: `hh_064_wa__bob_fringe.mesh` in `brown_liquorice`.
   - `citizen__biker_ma.app` `biker_01` and `biker_02`: `hh_112_ma__kicinski_common.mesh` in `brown_liquorice`.
   - `citizen__corporat_ma.app` `corporat_ma_13`: `hh_089_ma__thompson_common.mesh` in `brown_ombre`.
   - `citizen__corporat_wa.app` `corporat_wa_01`: `hh_063_wa__messy_bob.mesh` in `black_carbon`.

   Across the five inspected citizen `.app` files, the most common hair colours are `black_carbon`, `brown_liquorice`, `brown_ombre`, `blonde_dishwater` and `ginger_copper`, all replaced by the mod.

Container SHA-256: `Alliekat's Natural Hair.archive` `eb16849a…c616`; `###-PreemHair.archive` `aab89b2a…8b36`.
