# Skin and makeup on spawned objects

**Maturity: Draft.** How an object placed or spawned in the world can show a character's skin and makeup: a copy of V that follows the player's own creator choices, a static head built from explicit mesh components, and what XF Finish Showroom builds from the second. Consolidated on 28 September 2026 from the installed 2.31 game (with Phantom Liberty) read with WolvenKit CLI 9.0.1 and XF Studio's TweakDB reader, the installed mod V's Faceplate (H10) 1.1.0 read in place, the Codeware source and the XF Finish Showroom build. **Nothing on this page has been seen in a game session by this project**; the one runtime observation is the mod's own, reported by the maintainer (the face in the tank looks right). Grades follow the [knowledge rules](README.md); [installed] is a mod package in the reference MO2 instance, read only (paths inside `mods/<mod name>/`).

This page answers: *can a prop in the world show skin and makeup the way V's own head does, and what exactly does it take?*

## In brief

- **There are two routes, and they answer different questions.**
  - A **replica of V** is an entity with no meshes of its own, only the character creator's controllers. It shows whatever V wears in the creator right now: her head, skin and every face decal, XF Eye Artistry included. The game uses it for V's head in a tank in Phantom Liberty, and V's Faceplate (H10) places that same vanilla entity in V's apartment. [resource] [installed]; that the controllers copy the player's state is [hypothesis, strongly supported].
  - A **static head** is an entity whose appearance lists the head, eyes and decal meshes explicitly, skinned to a head rig. It shows exactly the meshes and mesh appearances it names, whatever V wears. The game's own shop mannequins are built this way. [resource]
- **Only the static head can show several looks at once.** Every replica follows the one creator state, so a lineup of replicas would all wear V's current preset. A lineup of different presets needs static heads, one mesh appearance each. XF Finish Showroom uses that route (§4).
- **Nothing special is needed for skin or decals on a static entity.** The head mesh's own appearance picks the skin material (tone and type), and a `mesh_decal` plate drawn after it writes into the same surface buffer as on V. ArchiveXL expands the plate's `{material}` texture paths when the mesh loads, wherever it is used. [resource] [source]; that the result matches V's head in game is what the showroom's fidelity check tests.

## 1. The replica route: V's head in a tank

### 1.1 The vanilla entity

Phantom Liberty's quest data holds two TweakDB character records, `Character.q304_v_head_in_jar_wa` and `Character.q304_v_head_in_jar_ma`, in `tweakdb_ep1.bin` [resource, read with `tweakdb-flats.ts`]:

| Field | Value |
|---|---|
| `entityTemplatePath` | `ep1\quest\main_quests\q304\characters\q304_v_in_a_jar_wa_2.ent` (feminine) and `…_ma_2.ent` (masculine), in `ep1_2_gamedata.archive` |
| `appearanceName` | `None` |
| `baseAttitudeGroup` | `friendly` |
| `displayName` | `LocKey#33433` |
| `items` | none |

The template [resource] (feminine SHA-256 `4f53133c…`, masculine `15d41cd2…`):

| Part | What it holds |
|---|---|
| Entity class | `NPCPuppet` |
| Appearances | **none**; default appearance `none` |
| Mesh components | **none** |
| Creator controllers | `gameuiCharacterCustomizationFaceController` (group `face`), `…BodyController`, `…NailsController` (group `nails`), `…ArmCyberwareController` (default group `holstered_default`, with the player cyberware arm `.app` files) |
| Animation | `root`: `woman_base.rig` with `player_paperdoll.animgraph` (the inventory preview's graph); `deformations` and `breasts` with their deformation rigs and graphs; morph target manager |
| Lights | two `entLightComponent`s, `L_Highlight_Cold` and `L_Main_Fake_GI`, both at intensity 0 |
| Everything else | the ordinary NPC set: AI, stats, hit reactions, targeting, scanning, inventory and so on |

With no mesh of its own, anything the entity draws comes through its controllers. The `face` group is the one XF Eye Artistry registers its selector in, because the player entities' face controller reads it in gameplay and photo mode ([`package-resources.ts`](../projects/xf-studio/authoring/src/package-resources.ts) `SELECTOR_GROUPS`; [CC file chain](cc-file-chain.md)). So a replica is expected to show V's current look: skin, face decals, makeup and the XF selector's preset alike. [hypothesis, strongly supported: the entity's composition, and the mod's own description that "the face in the tank is dynamic and personal to your V"]

### 1.2 How V's Faceplate (H10) places it

V's Faceplate (H10) by MisterChedda (Nexus mod 24599, version 1.1.0; the author is named by the archive's own paths, `misterchedda\v_faceplate\…`, and by the creator link on its description) keeps the faceplate from the Phantom Liberty quest "Birds with Broken Wings" in V's H10 apartment stash room. It ships **no mesh, texture or entity**: its 20 KB archive holds six resources, and everything it shows is vanilla [installed] (`archive/pc/mod/v_faceplate.archive`, SHA-256 `442f3be0…`; `v_faceplate.archive.xl`, `746f32c5…`).

| Resource | What it does |
|---|---|
| `v_faceplate.archive.xl` | ArchiveXL: one quest phase under `cyberpunk2077.quest` and one streaming block |
| `world\sectors\v_faceplate.streamingsector` | The set: the vanilla tank `ep1\environment\decoration\unique\quest\q303\faceplate_tank\faceplate_tank.mesh`, the bubbles `ep1\fx\quest\q304\q304_face_tank_bubbles.particle`, a liquid-nitrogen smoke effect, two area lights, box collision, cables and a ceiling mount (13 nodes) |
| `world\sectors\v_faceplate_ai.streamingsector` | Two `worldPopulationSpawnerNode`s, one per record above, appearance `default`, `spawnOnStart` 1 |
| `quest\v_faceplate_root.questphase`, `quest\phases\v_faceplate_root_setup.questphase` | Gating by facts and V's body (`questCharacterCondition`), then scene sections `setup_head` and `despawn_head` |
| `quest\scene\v_faceplate.scene` | Finds the spawned head in the world and plays the vanilla workspot `ep1\workspots\quest\main_quests\q304\304_04d_shard_pickup\q304__player_{female,male}_tpp__face_tank__01.workspot` with the quest's own body and facial animation sets (`q304_04d_shard_pickup__player_{female,male}_tpp.anims`, `…__facial_{female,male}.anims`; animation names `face_tank__01`, `idle__dead__male`, `q304_dead_face`) |

So the mod's technique is placement, not rendering: the same entity, animation and tank the quest uses, in a new place, with a quest phase that spawns and poses it. V's skin and makeup reach it the way they reach the quest's own copy. [installed] How the rest of the body is kept out of view in the tank (hidden by a controller or the workspot, or simply framed by the tank) was not traced.

### 1.3 What the route is good for

| Use | Fit |
|---|---|
| Showing V's current look on a prop, a statue or a stand-in | Exact by construction (the same resolver the player uses) [hypothesis] |
| A second "V" beside V under the same light, to compare a preset on a static head with the real thing | Good: the fidelity check can use it as a third reference (§4.3) |
| A lineup of different presets side by side | **No**: every replica follows the one creator state |
| Anything without Phantom Liberty | The records and template live in the expansion's archives |

## 2. The static route: the shop mannequin

The game's clothing mannequins show a real NPC head on a posed body [resource] (`basegame_4_gamedata.archive`, `base\environment\decoration\small_shops\stands\mannequin_real\`):

- `mannequin_real_woman_a_censored.ent`: an `entEntity` whose one component is an `entCorpseComponent` named `root`, with its appearance in a generated `.app`.
- The source `.app` (`sources\mannequin_real_woman_a.app`, appearances `default` and `doggy`) lists the head's parts explicitly: an `entAnimatedComponent` `face_rig` with the NPC head's own skeleton rig, `woman_average_sermo.animgraph` and the head's `.facialsetup`, parented to `root`; the head mesh (`entGarmentSkinnedMeshComponent`), eyes, teeth, brows and the freckle decal (`entSkinnedMeshComponent`), each with its parent transform and skinning bound to `face_rig`; the body, nails and a proxy mesh bound to `root`.
- `generated\head\h0_009_wa_c__young.ent` holds the same head parts, including the eye-makeup, lip and pimple decal meshes, bound to an external component.

Nothing reads the player's state: each mesh shows the mesh appearance the component names. That is the pattern a showroom head needs.

**The player's head fits it.** Every bone the feminine player head (`h0_000_pwa_c__basehead.mesh`, 254 bones) and her eyes (`he_000_pwa_c__basehead.mesh`, 57 bones) skin to is in the head's own skeleton rig, `h0_000_pwa_c__basehead_skeleton.rig` (344 bones) [resource]. In that rig's reference pose the `Head` joint sits 1.640 m above the rig root and the eye joints at 1.691 m, and the head mesh's bounds run from 1.462 m (the neck's cut) to 1.830 m, so a head skinned to that rig stands at a person's height above the entity's origin, facing +Y [resource; arithmetic offline]. The XF eye plate is cut from the same head with the same bones and skin bytes ([plate](../research/authoring/studio-to-mod-pipeline.md#where-the-eye-plate-comes-from)), so it skins to the same rig and lands exactly on the head.

**Skin on a static head** comes from the head mesh's own appearances [resource] ([head CC rendering §2](head-cc-rendering.md#2-skin-type-tone-and-the-complexion-texture-set)): 60 local materials, one per tone and type, named like `01_ca_pale` (type 1) and `03_ca_senna_d03` (type 3). `01_ca_pale` has `TintScale` 0, so its skin is the albedo untinted; any other tone can be chosen by name.

**Decals on a static head.** The plate's `mesh_decal` material writes into the surface buffer after the skin, as vanilla makeup does on NPC heads ([materials §4](materials-and-shaders.md)). Its textures are soft paths with `{material}`, which ArchiveXL expands in its mesh-loading hook for any mesh, not only those in a creator scope ([mod loading §5](mod-loading.md#5-archivexl-dynamic-materials-mesh-side)) [source]. The same holds for the mesh-appearance stubs that ArchiveXL expands from the seed appearance.

## 3. Spawning at run time

| Route | Fits | Grade |
|---|---|---|
| A quest phase and sector, as V's Faceplate does | Permanent placements that belong to a location | [installed] |
| Codeware `StaticEntitySystem.SpawnEntity` (template, appearance, position, orientation, tags) | Test props: no persistence, no streaming, `DespawnTagged` removes a group | [source] Codeware `v1.20.4` `scripts/World/StaticEntitySystem.reds`, `src/App/World/StaticEntitySystem.cpp:116-144` ([world and streaming §2.6](world-and-streaming.md#26-runtime-spawning-and-inspection)) |
| Codeware `DynamicEntitySystem` | NPCs and records, with optional persistence | [source] |

Static spawning is asynchronous: `SpawnEntity` returns an ID at once and the entity exists a few frames later (`IsSpawned`, `GetEntity`) [source]. A spawned `gameObject` can be moved and turned with the teleportation facility, as CharLi moves its lights ([photo-mode lights §3](photo-mode-lights.md#3-spawning-lights-from-a-mod)) [installed].

## 4. What XF Finish Showroom builds

XF Finish Showroom is XF Studio's in-game test equipment for judging makeup finishes side by side. It follows the static route; the build and its checks are in the [pipeline guide](../research/authoring/studio-to-mod-pipeline.md#xf-finish-showroom-a-test-mod-of-mannequin-heads), the commands in the [runtime bridge](../projects/xf-runtime-bridge/README.md).

### 4.1 One entity, one appearance per preset

| Component | Resource | Bound to | Grade |
|---|---|---|---|
| `face_rig` (`entAnimatedComponent`) | `h0_000_pwa_c__basehead_skeleton.rig`, `woman_average_sermo.animgraph`, `h0_000_pwa_c__basehead_rigsetup.facialsetup` (the player head's own, by path) | the entity | pattern [resource]; with the player's rig [unverified] |
| `xfs_head` | `h0_000_pwa_c__basehead.mesh`, appearance `01_ca_pale` unless the build chooses another tone | `face_rig` | [unverified] |
| `xfs_eyes` | `he_000_pwa_c__basehead.mesh` (lashes, eye, wetness), a gradient eye colour | `face_rig` | [unverified] |
| `xfs_plate` | the build's own copy of the preset's eye plate, mesh appearance `xfs_p<preset>`, lifted 0.4 mm like XF Eye Artistry's | `face_rig` | plate and materials [offline: the eye-makeup verifier]; drawing [unverified] |
| `xfs_pedestal`, `xfs_plinth` | the creator box's own black panel `q110_black_box.mesh`, scaled into a column under the neck and a base slab | the entity | [unverified] |

The heads are feminine for now: the plate the pipeline prepares first is hers. Vanilla meshes are referenced by path, never copied.

### 4.2 Light rigs as templates

Each rig is an entity of `entLightComponent`s with every native field set at build time from the creator rig table ([creator lighting §2](creator-lighting.md#2-the-box-and-its-lights)): positions and spot axes converted from the Studio frame to the entity's (Studio (x, y, z) = local (x, −z, y)) and moved so the rig's head slot (1.62 m) sits on the showroom head's `Head` joint (1.640 m). The rig is spawned at a head's origin and facing, so every head gets the same light in its own frame. Baking the rig into templates avoids adding components at run time, which the [lighting mirror](../research/runtime/lighting-mirror-design.md#52-how-the-game-side-works) needs for arbitrary Studio setups. Whether a spot's axis is its +Y for a spawned component is the mirror's open question too [hypothesis].

**Identical light has a price in spacing.** A rig per head also lights the neighbours. With the engine's decoded falloff and cone forms (full-angle reading, Φ/4π), the full creator rig's rims and fills add about 90 % of a head's own light from neighbours 0.9 m away, 9 % at 2 m and under 1 % beyond about 3 m, while the key light alone (Main_Face, a 45° cone from about 1 m) adds none at 0.6 m [offline: `tools/showroom/plan.ts`, direction and shadows ignored]. So a lineup is judged side by side under the key light, and under the full rig one head at a time, or a few heads 3 m apart; the bridge's `showroom.light` reports the estimate for each placement.

### 4.3 The fidelity check

A showroom head beside V, both wearing the same preset under the same rig, tests whether the static route shows makeup as V's head does. A replica (§1) would be a third reference that needs no preset of its own, but it needs Phantom Liberty and a quest-free way to spawn it; it is left as an option.

## Open questions

1. Do the creator controllers copy the player's state into any entity that carries them, and when (spawn, appearance change, each frame)? A replica spawned by `DynamicEntitySystem` from `Character.q304_v_head_in_jar_wa` would answer it, and would show whether it follows a creator change live.
2. How is the replica's body hidden in the tank: controller settings, the workspot's animation, or only the tank's framing?
3. Does an `entAnimatedComponent` with the player head's rig, graph and facial setup, and no animation driving it, hold the reference pose, as the shop mannequin's face appears to?
4. Does a static head lit by the same rig show a preset's finish as V's head does (the showroom's fidelity check)? Skin scattering, the head's own ambient occlusion and the creator's render target all differ from gameplay.
5. Does a skinned mesh in a plain `entMeshComponent` (World Builder's mesh spawnable) draw in its bind pose? That would allow heads without a rig component.

## Sources

- Game 2.31 with Phantom Liberty: `tweakdb_ep1.bin`; `ep1_2_gamedata.archive` (the q304 templates); `basegame_4_gamedata.archive` (the shop mannequin); `basegame_4_appearance.archive` (the player head, eyes and head rig). Read with WolvenKit CLI 9.0.1 (`unbundle --hash`, `convert serialize`) and [`tweakdb-flats.ts`](../projects/xf-studio/authoring/src/tweakdb-flats.ts).
- V's Faceplate (H10) 1.1.0 (Nexus 24599, file 123152) in the reference MO2 instance, read only; its six resources converted to JSON in a private scratch folder.
- Codeware `v1.20.4` (`613a1cb8`): `scripts/World/StaticEntitySpec.reds`, `StaticEntitySystem.reds`, `src/App/World/StaticEntitySystem.cpp`.
- Who made each and what it taught us: [community credits](../docs/community-credits.md).

## Related pages

[World and streaming](world-and-streaming.md) · [Head CC rendering](head-cc-rendering.md) · [CC file chain](cc-file-chain.md) · [Creator lighting](creator-lighting.md) · [Photo-mode lights](photo-mode-lights.md) · [Runtime access](runtime-access.md)
