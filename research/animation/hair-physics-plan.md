# Hair and dangle physics in the preview: plan

**Status: design, 27 September 2026. Nothing in the Studio is built; P0's executable read is done ([§3.1](#31-data-path-p0) step 5).** Answers the question "does the Studio support the bones in hairstyles that give them physics?" (today: no) and plans how the preview should. The facts it builds on, with evidence grades, are in [hair and jewellery dangle physics](../../knowledge/hair-physics.md); this page holds the design, the phases and the provenance.

## 1. Summary

- **In game**, a hairstyle with physics adds one `entAnimatedComponent` per swinging part: a small rig (a copy of V's upper-body joints plus chains of `dyng_*` joints hanging from `Head`) and an animation graph whose one working node is a particle simulation, `animDangleConstraint_SimulationDyng`. The graph holds every parameter: per-joint mass, damping, pull toward the animated pose, whether the joint is fixed, link lengths, cone angle limits, a few capsules on V's shoulders, neck, chest and sometimes head, gravity, a fixed 0.01 s substep [resource]. Worn physics earrings use the same machinery. 84 of the 85 vanilla hair graphs and every modded one inspected use this one simulation class, and popular CCXL packs ship byte-identical copies of vanilla sets.
- **In the Studio today** the dangle components are dropped by the resolver, and the chain joints ride the idle rigidly, each joint on whichever body segment is nearest: a strand's root on the head, its tip on the shoulder [offline]. There is no gravity, inertia or collision.
- **The plan** is one data-driven solver for that simulation class, fed by each part's own rig and graph, never by per-style or per-mod values:
  1. read and keep the dangle components (P0);
  2. make every chain follow its own rig parent rigidly, which removes today's shear on its own (P1);
  3. a fixed-timestep position-based solver, deterministic, with the resource's collision shapes and a settle-at-rest mode for still poses (P2);
  4. wire it into the motion pipeline and the view graph as a scene-node motion setting, **off by default** until the in-game checks pass (P3);
  5. calibrate against one prepared session (P4), then reuse it for worn items (P5).
- **Effort:** about 12–18 agent-days in total. P1 alone (about a day) is worth doing first. The solver's formulas have been read from the executable ([knowledge §5](../../knowledge/hair-physics.md#5-solver-arithmetic-231-executable)), so the main remaining risks are the per-frame mode (whether the game carries world motion into the hair) and anything the in-game checks show. Motion that differs from the game is worse than none (render coverage rank 7), hence the default-off switch.

## 2. What the preview must reproduce

From the [knowledge page](../../knowledge/hair-physics.md), per dangle component:

| Input | Where | Used for |
|---|---|---|
| Component name, `rig`, `graph`, `controlBinding` (`root`/`Component` or `deformations`), `parentTransform` | the hair `.app` or `.ent`, or a worn item's `.ent` | which pose drives the base joints; which meshes the chains move |
| Mesh `skinning.bindName` | each mesh component | which dangle component a mesh reads (hair); earrings bind to `root` and need the by-name rule of §3.3 |
| Joint names, parents, local rest transforms | `.rig` | chain topology, rest lengths, rest orientations |
| Particles: `bone`, `isFree`, `mass`, `damping`, `pullForceFactor`, capsule radius, height and axis, `projectionType` | `.animgraph` `animDyngParticlesContainer.particles` | simulated points |
| `gravityWS`, `externalForceWS`, `externalForceWsLink` | the particles container | forces |
| `animDyngConstraintLink` (type, bounds %, `lookAtAxis`), `animDyngConstraintCone` (type, half angle, attachment bone and frame), `animDyngConstraintEllipsoid` | `animDyngConstraintMulti.innerConstraints` | constraints |
| `collisionRoundedShapes` (bone, frame, box extents, corner radius) | the simulation | collision against V |
| `substepTime`, `solverIterations`, `alpha`, `rotateParentToLookAtDangle` and the three transform flags | the simulation | stepping and output |

Anything else in a graph (another simulation class, a node other than the five-node spine) is **reported and left rigid**, never guessed.

## 3. Design

### 3.1 Data path (P0)

1. **Resolver.** `ResolvedComponent` keeps animated components: name, `rig` and `graph` depot paths, `controlBinding` and `parentTransform` bind names. Mesh components keep their `skinning.bindName`. Both follow the game's own reading of the `.app`/`.ent`, including duplicate names (first one per name until H4 answers otherwise; the choice is recorded in the record's notes).
2. **Native reader.** Add the dangle classes to the RTTI subset (`tools/native-rtti-subset.ts`): `animAnimGraph`'s node types on the spine (`animAnimNode_Dangle`, `_PoseLsToMs`, `_PoseMsToLs`, `_SharedMetaPose`, `_ReferencePoseTerminator`, `_Output`, `_VectorInput`), `animDangleConstraint_Simulation*`, `animDyng*`, `animCollisionRoundedShape`, `animAnimFeatureEntry`. `animRig` is already there. Parity with WolvenKit's JSON on the graphs of §9 is the test, as for every other class.
3. **`DangleSpec` reader** (a new pure module, proposed name `dangle-spec`): rig + graph → `{ component, drivenBy, baseJoints, chains: [{ joints, fixed }], particles, links, cones, ellipsoids, shapes, gravity, externalForce, substep, iterations, alpha, lookAt, unsupported[] }`, in game space (Z up, the rig's own frames), with class defaults filled in (`mass` 1, `damping` 1, `isFree` true, capsule axis (0.5, 0, 0)). It knows no hairstyle or mod.
4. **Render record.** A `dangles` list on each character detail: the spec's identity (depot paths and hashes), the meshes it drives, and its diagnostics. The spec itself is served next to the GLB like other derived data and cached by content hash, so a CCXL pack that copies a vanilla set shares one cached spec.
5. **Executable read** (R&D inside P0). **Done, 27 September 2026.** The Dyng update in the 2.31 `Cyberpunk2077.exe` was located through the class's RTTI and read with Capstone (the `dangle` mode of [`exe_hair.py`](../materials/shader-system/exe_hair.py)). It covers the substep count and length, integration, drag, pull, mass, gravity and external force, link, cone and ellipsoid projection and their order, rounded-shape collision, look-at output and `alpha`. The pseudocode and test vectors are in [knowledge §5](../../knowledge/hair-physics.md#5-solver-arithmetic-231-executable); addresses are in [§10](#10-evidence-and-sources). Still unread: the source of the per-frame mode (world-space inertia or not), the shape branches other than Z-capsules, the cone capsule's rotation solve and the `…AltersTransforms…` branches, none of which any vanilla hair graph needs except the mode.

### 3.2 Rigid chains first (P1)

Chain joints must never fall to `nearestDriver`, which is meant for the body's helper joints. For a mesh bound to a dangle component, each joint takes its parent from the component's `.rig`: the chains hang from `Head`, and the base joints map to V's joints by name. With the solver off, the whole chain then follows `Head` rigidly, which is what the game would show with `alpha` 0 and removes today's shear (a strand's root on the head, its tip on a shoulder). The chain keeps its authored shape relative to the head, including in poses. This is correct-by-construction, testable offline, and independent of every solver question.

### 3.3 Which meshes a dangle drives

- A mesh whose `skinning.bindName` names a dangle component reads that component's joints (all hair).
- A mesh bound to `root` whose joints include names found only in a dangle component controlled by `root` (the worn earrings) reads those joints from that component [hypothesis, check H5]. The rule is generic: it looks up joint names, never item names.
- Everything else is unchanged.

### 3.4 The solver (P2)

A new module (proposed name `dangle-solver`): DOM-free, allocation-free per step, `Float64Array` state, one instance per dangle component per scene.

It reproduces the game's arithmetic as read from the executable ([knowledge §5](../../knowledge/hair-physics.md#5-solver-arithmetic-231-executable)), which holds the pseudocode and test vectors. In outline, per substep of `substepTime` × `min(dilation, 1)`:

1. **Kinematic update.** Every particle's animated transform, the forces and every collision shape are interpolated between the previous and current frame's poses at `(i + 1) / steps`, so a fast head turn does not teleport the roots.
2. **Integrate** (velocity Verlet, half kick and drift). Fixed particles are placed on their animated position. Free ones take gravity (not divided by mass), plus a pull to their own animated position (`pullForceFactor` / `mass`), the external force divided by `mass`, and a drag of `damping` / `mass` capped at 50 m/s².
3. **Project and collide**, `solverIterations` times. Each pass projects the Multi's constraints in file order (links: inverse-mass split, fixed particles immovable; cones: from the attachment's animated frame, keeping the distance to its simulated position; ellipsoids). Then every particle is pushed out of the rounded shapes, then the cone capsules are tested.
4. **Velocity update**: `(x − xPrev) / h` plus the second half kick, so corrections feed back into velocity.
5. **Output**, once per frame in bone-index order: each joint moves to its particle, its link parent turns so `lookAtAxis` aims at it, and the result is blended by `alpha`.

Everything runs in game space; the adapter converts V's driven joints from Three's Y-up into it once per frame and the joint results back, so no parameter (gravity, cone frames, shape frames) needs converting.

**Driving.** The base joints take the pose of the component named by `controlBinding`: `root` means V's clip joints, `deformations` the helper-joint solve (§5). The preview's V never walks, so world motion is only the pose and idle, and the game's world-motion mode (mode 1, which carries the particle state through the character's world transform) is not needed. Gravity is turned into model space by V's world rotation, which in the preview is fixed. Orbiting the camera is not character motion and must not move the hair.

**Settle at rest.** When the body source is still (idle off, a held pose), the solver starts from the rigid chains and runs until settled: every free particle's speed under 1 mm/s for 0.2 simulated seconds, capped at 3 s (300 substeps). It runs in slices of at most 2 ms per frame, then stops and the viewport stops drawing. This gives the drape a pose would have after standing still: long hair lying on the shoulders, strands hanging with gravity when the head tilts. It re-settles on a pose change, a hair change, a body-shape change or switching physics on. A discrete jump (choosing a pose) resets to the rigid chains of the new pose first rather than simulating a whip between poses. The game's own reset does the same: on the graph's first evaluation and in its reset mode, every particle is placed on the pose with zero velocity and only the constraints run. The settle pass itself is a Studio addition; the game has none.

### 3.5 Determinism

- Fixed substeps only; the frame clock feeds an accumulator clamped like the idle's 0.1 s per frame. Frame rate changes how many substeps run per draw, never their result.
- **The game does not simulate in real time.** Its substep is always 0.01 s of simulated time, but the number per frame is a filtered, rounded count between 1 and 3, so the simulation runs at 1.2× real time at 60 fps, 0.9× at 30 fps and 1.44× at 144 fps ([knowledge §5.1](../../knowledge/hair-physics.md#51-frames-and-substeps)). The preview should reproduce a nominal game frame rate rather than real time: default 60 fps, i.e. two substeps per 1/60 s of motion clock, so the motion's pace matches what the maintainer sees in game. The rate is one constant, to be revised by P4 if the session's frame rate differs.
- The simulation clock is the motion clock (`IdleAnimation.time`). Pause stops it; seeking re-simulates deterministically: reset to the settled state at the clip's loop start, then step to the target time (at 100 Hz a 10 s seek is 1,000 substeps, a few milliseconds). The loop seam is continuous, not periodic: the state at `t` depends on elapsed motion, so captures state the phase since reset.
- Arithmetic is `+ − × ÷` and `sqrt` in doubles (IEEE-exact on every engine); no `Math.random`. Trigonometry is needed only once per cone, at setup (its cosine and half-angle rotation), through one helper. The game computes in single precision; the knowledge page's test vectors hold to about 1e-6 relative.
- Scene parity (`tools/scene-parity.ts`) stays byte-identical with physics off. With physics on, a capture is identical run to run on one machine; that is its own golden test.

### 3.6 View graph and the reactive graph

- **A scene-node setting, not a per-view one.** In the [view graph](../authoring/view-graph-design.md) a scene node owns the subject's motion (idle, blink, later a pose). Physics joins that group as `motion.physics: "off" | "on"`. A simulation is state of the scene, so two views linked to one scene show the same hair. A view that wants physics off while its neighbour has it on forks the scene, as for any other difference in content. Offering a per-view switch that silently runs two simulations of one V would break the "one source, many views" model and double the cost.
- **Derived nodes.** `DangleSpec` is derived data of each resolved component (a graph node keyed by content hash); the solver instance is derived from the spec set and the scene's motion. A hairstyle change swaps only the affected specs.
- **Surfaces.** A character-scene view tool beside Idle ("Hair physics"), the Motion panel's switch and a palette command, all through one typed action (`motion.setPhysics`) with a capability that refuses in plain words when nothing on V has physics ("This hairstyle doesn't move on its own") or when a part's graph is unsupported. The detail status line and the Activity view report what is simulated.
- **Default off** until P4. After the session the default becomes the maintainer's call (question Q1).

### 3.7 Performance budget

| Case | Particles | Cost estimate |
|---|---:|---|
| Default V, hairstyle 1 (`hh_033`) | 43 (36 free), 64 constraints, 4 shapes | about 20k simple operations per simulated second |
| Reference save (`lm097`, 2 parts) | 80 (66 free), 104 constraints, 12 shapes | about 50k per simulated second |
| Heaviest installed pack inspected (Sofie, 5 parts) | about 200 | about 150k per simulated second |

At 100 substeps per second that is well under 0.5 ms per drawn frame in JavaScript, the budget for all of V's dangles together, and the settle pass is under 10 ms in total. The GPU cost is unchanged: the mesh is already skinned; only the joint matrices change. The only risk is dozens of worn dangle items at once (P5); a cap reports and leaves the extra ones rigid. A native module is not needed.

## 4. Interaction with poses

- **Poses** ([pose library](pose-library-design.md) §5.2 already names hair as a later R&D track): with P1, hair keeps its authored shape on the head in every pose; with P2 and physics on, a held pose settles (§3.4), so lying or tilted poses show hair hanging with gravity instead of "up". An animated pose plays like the idle.
- **Expressions and head turns** move `Head`, which moves the fixed particles; nothing more is needed.
- **Photo mode parity** depends on H2: if the game freezes dangles in photo mode, the settled drape is still the right preview only if photo mode settles before it freezes. The check decides whether a held pose shows the settled state or the bind state.

## 5. Interaction with the deformation rig work (`claude/body-fidelity`)

That branch (running) evaluates `woman_base_deformations.animgraph` for the body's helper joints and replaces `nearestDriver` for them (pose library P4).

- **Order per frame:** body clip → deformation solve → dangle solve → skinning. "Deformations style" CCXL hair reads the deformation component's pose, so the dangle step must run after it; "vanilla style" hair reads `root` and could run earlier, but one order serves both.
- **`nearestDriver`.** P1 removes chain joints from its reach; body-fidelity removes the helper joints. After both, only genuinely unknown joints should reach it. Both change `IdleAnimation.bind`, so P1 lands after body-fidelity merges, or rebases on it, to avoid a conflict in `idle-animation.ts`.
- **`SimpleBounce`.** The deformation graph's 90 bounce nodes are a different, per-joint spring. The pose library keeps them at rest in still poses; the same fixed-substep clock (§3.5) should drive them when they move, so body jiggle and hair stay in step. The two solvers share the clock and the settle rule, not code.

## 6. Phases and effort

| Phase | Scope | Depends on | Effort |
|---|---|---|---|
| **P0 Data and decode** | Resolver keeps animated components and skinning binds; native RTTI subset gains the dangle classes with WolvenKit parity; `DangleSpec` reader and record field; the executable read of the Dyng update (§3.1 step 5, **done**) | – | 2–3 days left (the executable read is done) |
| **P1 Rigid chains** | Chain joints follow their rig parent; the earrings' by-name rule (§3.3); tests that every chain joint of the §9 rigs binds to `Head` | P0's spec reader (or the `.rig` alone); after body-fidelity merges | 1 day |
| **P2 Solver** | The solver module per §3.4, settle-at-rest, determinism tests (run-to-run identity, frame-rate independence), constraint and collision unit tests, golden trajectories for `hh_033` and `hh_107` under a scripted head turn | P0 | 4–6 days |
| **P3 Integration** | Motion pipeline order (§5), `motion.physics` on the scene node, `motion.setPhysics` action and capability, view tool, Motion panel switch, render-on-demand keep-alive while unsettled, seek and capture handling, diagnostics and Activity entries, `?verify=1` acceptance | P1, P2; view graph P1 for the scene node (until then, preview state like the idle switch) | 2–3 days |
| **P4 Calibration** | One prepared session (H1–H6); compare motion and drape; fix formulas from evidence, never per-style constants; decide the default | P3, session | 1–2 days |
| **P5 Worn items and other dangles** | Worn physics earrings and other dangle items through the clothing path; the same solver and cap | P3; clothing phases 5–6 for modded items | 1 day |

P1 is useful on its own and small. P0 + P2 + P3 give a working, switchable simulation in about two weeks; P4 makes it trustworthy.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Formulas wrong: hair moves differently from the game (the audit's warning) | Read from the executable in P0 ([knowledge §5](../../knowledge/hair-physics.md#5-solver-arithmetic-231-executable)); the solver's unit tests use its test vectors; default off until P4; the in-game checks compare drape and tip travel, not just "it moves" |
| Duplicate component names and the earrings' root binding resolve differently in game | H4 and H5; the rule is one resolver decision recorded in the record's notes, easy to flip |
| Space conversion errors (Z-up game frames, 90° cone frames) | The solver works only in game space (§3.4); unit tests assert that a settled `hh_033` chain hangs within its cones under −Z gravity |
| A graph with other nodes or another simulation class | Reported and left rigid (84 of 85 vanilla hair graphs are the one class) |
| Settling costs a hitch on a pose change | Sliced to 2 ms per frame; capped at 3 s simulated |
| Conflict with body-fidelity in `idle-animation.ts` | P1 after that merge (§5) |
| Motion is barely visible under the creator idle | Expected: the creator idle moves the head little. The visible gains are poses (drape), head turns and later expressions; the settle mode is the main user-facing value |
| The runtime clean-room line | The solver is written from resource data, type definitions and our own executable reading; no engine or tool code is copied |

## 8. In-game checks

The knowledge page's [H1–H6](../../knowledge/hair-physics.md#in-game-test-asks) batch into the next prepared session: creator sway, photo-mode behaviour under a head rotation, shoulder collision, the duplicate-name hair, worn earrings, and gameplay inertia. For P4, record the same framing in the Studio (default V hairstyle 1, the reference save's hair) with physics on, and compare:

- tip travel over one idle loop (pixels at a fixed camera, from the video);
- the drape after a held head turn (tip positions relative to the shoulder line);
- whether strands clip into the shoulders.

A later bridge command reading the dangle component's joint transforms per frame (`anim.component.pose.read`) would make this quantitative; it is not required for the first session.

## 9. Questions for the maintainer

1. **Q1 Default.** After calibration, should hair physics be on by default when the idle plays? *Proposed:* on with the idle and for held poses (settled), off while the idle is paused, with the switch always available.
2. **Q2 Per-view.** Is one setting per scene (all views of the same V agree; fork the scene for a difference) acceptable? *Proposed:* yes (§3.6).
3. **Q3 Worn items.** Should worn physics earrings and other dangle items follow the same switch? *Proposed:* yes, one switch for everything that dangles.

## 10. Evidence and sources

Inspected on 27 September 2026, read-only; private extractions in the session scratch space, WolvenKit CLI 9.0.1 `unbundle` and `convert serialize` one archive or file at a time.

| Resource | Source | SHA-256 (first 12) |
|---|---|---|
| `base\characters\common\hair\hh_033_wa__player\hh_033_wa__player_dangle.animgraph` | game 2.31, from the expressions study's extraction | `c87646986dcc` |
| `…\hh_033_wa__player\hh_033_wa__player_dangle.rig` | `basegame_4_appearance.archive` | `c054bdf866c0` |
| `…\hh_107_wa__girl_longhair\hh_107_wa__girl_longhair_dangle.animgraph` | game 2.31 | `66b788c4c170` |
| `…\hh_107_wa__girl_longhair\hh_107_wa__girl_longhair_dangle_skeleton.rig` | `basegame_4_appearance.archive` | `8d3dd083f0a7` |
| `ep1\characters\common\hair\hh_210_wa__long_hair_ponytail\hh_210_wa__long_hair_ponytail_dangle.animgraph` | game 2.31 (EP1) | `a0dbd1c6840e` |
| `base\characters\main_npc\clair\h0_001_wa_l__clair\i1_006_wa_earring__clair.animgraph` | game 2.31 | `46b8f924e74d` |
| `noladreamer_hair\nd_hair_sofie\meshes\nd_hair_sofie_pt1.animgraph`, `…pt1.rig` | Nola Dreamer's hair Sofie (Nexus 21844, 1.0.0.0), `ND_Sofie_hair_CCXL.archive` `3d726c06e2d9` | `15ea3cb5b0d1`, `a1dbc77fb43d` |
| `…\nd_hair_sofie_pt5.animgraph`, `…pt5.rig` | same archive | identical to `hh_107`: `66b788c4c170`, `8d3dd083f0a7` |
| `base\mel_ccxl_hair\meshes\lm127_hair_pt1.*`, `lm097_hair_pt2.*` (the reference save's hair) | MELUMINARY Long Length Pak Vol. 3, `MELUMINARY - CCXL - EASY ACCESS LONG VOL3.archive` (by hash) | identical to `hh_107` |
| `kwek\items\clothing\face\earrings_02\earrings_02.animgraph`, `.rig`, `.ent` | Kwek's Small Fancy Hoop Earrings with Physics (Nexus 7020, 1.1.0.0), `kwekClothing_Earrings02_ArchiveXL__.archive` `323346981532` | `396bc10756a8` (graph) |
| `base\yv\g_ent\g_app\ent\yv_claires_earring_f.ent`, `yv_claires_earring.app` | Claire's Jewellery with physics (Nexus 12863, 0.2.0.0), `void_Claires_Earring.archive` `0ae171fbcc9a` | `ce096e9b017b` (ent) |
| Hair `.app`/`.ent` component bindings | the resolver cache (`data/resolver-cache/json`): `hh_001_pwa__hairs_033.ent`, `hh_004_pwa__hairs_090.ent`, `hh_019_pwa__hairs_044.ent`, the FPP hair entities, `lm097_hair.app`, `emma2_hair.app`, `fhair_highpony_messy.app`, `kylin_wolfcut_wa.app`, `nd_hair_sofie.app`, `atomiic_bree_hair.app`, `atomiic_hair_double_bun_alt.app`, six `i0_000__earring_NN.app` | cached SHA-256 in each document's `meta` |
| Hair GLBs | the preview cache's exports of `hh_033_wa__player.mesh` and `nd_hair_sofie_pt1.mesh` | per `entry.json` |

**Executable read.** The 2.31 `bin\x64\Cyberpunk2077.exe` (SHA-256 `a7de82945c03e041fc7339fcf9066224d98db2f5d80fea50f7947bb350a60991`, 59,945,608 bytes) was read with Capstone 5.0.9, never run or modified. `python research/materials/shader-system/exe_hair.py dangle` reproduces the locations below; `… dis START END` disassembles any of them. Method: each RTTI class name string leads to its registration function. That function loads the type object and passes the instance size. The class's `GetType` method is a `mov rax, [rip+X]; ret` on the stored type pointer, and the pointer to that method marks the instance vtable. The Dyng-specific slots are the ones that differ from the base `animDangleConstraint_Simulation` vtable. The engine settings come from the static initialisers that name the `Dangle` group.

| RVA (2.31) | What it is |
|---|---|
| `0x2b39048` | `animDangleConstraint_SimulationDyng` vtable (size `0x1c8`) |
| `0x17934c` (slot `+0x100`) | Update: frame dt into the accumulator, time-dilation ratio, per-frame mode |
| `0x2c2114` (slot `+0x108`) | Initialise: particle order sorted by bone index; per-constraint rest lengths and look-at links |
| `0x2cf9f0` (slot `+0x120`) | Evaluate: mode handling, step count and filter, substep loop, output |
| `0xa508ec`, `0xa50b4c` | Begin frame: animated transforms, gravity and external force into model space, shape transforms |
| `0xa098f0` | Kinematic interpolation per substep |
| `0x9dbcb8`, `0xa2ab08`, `0x1dd508` | Integrate, velocity update, acceleration |
| `0xa50680`, `0xa50394` | Reset to pose; carry state through a world-transform change (mode 1) |
| `0x1d55c4`, `0x1d5558`, `0x1d57ec`, `0xc087f0` | Rounded-shape collision: loop, signed distance, push-out, Z-capsule nearest point |
| `0x2b9f3f0`, `0x17e420`, `0x2c1d78` | `animDyngConstraintLink` vtable, projection, rest length |
| `0x2ba2b70`, `0x17e610`, `0x4b3828`, `0x1d4c28` | `animDyngConstraintCone` vtable, projection, setup (cosine, half-angle rotation), capsule collision |
| `0x2c373e8`, `0x17fa34` | `animDyngConstraintEllipsoid` vtable, projection |
| `0x2b39170`, `0x17e3ac`, `0xa8fb38` | `animDyngConstraintMulti` vtable, project and collide loops over `innerConstraints` |
| `0x2d0050`, `0x2d040c` | Output per particle (look-at, write) and the `alpha` blend |
| `0x3468bc0`, `0x3468b70`, `0x3468ad0`, `0x3468b20`, `0x3468c10` | Values of `Dangle/MaxPhysicsStepsCount`, `…PhysicsStepsCountLowPassFilterRc`, `…MinTimeDilatation`, `…MaxTimeDilatation`, `…SolverIterationsWhenSkippingPhysics` |

Field offsets were matched to names with RED4ext.SDK `ad727771` (`Generated/anim/DyngParticle.hpp`, `DyngConstraint*.hpp`, `DangleConstraint_Simulation*.hpp`, `CollisionRoundedShape.hpp`) and enum values with WolvenKit `7876aae07` (`animDyngConstraintLinkType`, `animPendulumConstraintType`, `animPendulumProjectionType`, `animDyngParticleProjectionType`). The test vectors on the knowledge page were computed in single precision from the decoded rules with a throwaway script; they are derivations, not captures.

**Census.** Class names were counted in the raw CR2W name tables of the 525 vanilla `.animgraph` files of the expressions extraction (85 under `base\characters\common\hair`): 84 hair graphs have `animAnimNode_Dangle` with `animDangleConstraint_SimulationDyng`, 41 have `animCollisionRoundedShape`, 7 `animDyngConstraintEllipsoid`, 1 (`hh_033`) `DangleExternalInput`. Across all 525: `…SimulationPendulum` 6 (vehicles), `…SimulationSpring` 1 (`i1_002_wa_wrist__dawn__dangle`).

**Nearest-segment measurement.** Each chain joint's model-space rest position from its `.rig`, against the rest segments of `base\characters\base_entities\woman_base\woman_base.rig` (the idle's rig) with the Studio's `nearestDriver` rule (closest segment within 0.25 m).

**Tool and type sources.** WolvenKit `7876aae07` (`WolvenKit.RED4/Types/Classes/animDyng*.cs`, `Enums/cp77enums.cs`); RED4ext.SDK `ad727771` (`Generated/anim/DangleConstraint_*.hpp`, `AnimFeature_DangleExternalInput.hpp`); the 2.31 scripts decompiled with redscript-cli 0.5.31. The Modding Docs pages at `be2f44ee` are listed on the knowledge page.

## Related pages

[Hair and jewellery dangle physics](../../knowledge/hair-physics.md) · [Render coverage audit](../character-customization/render-coverage.md) · [Pose library design](pose-library-design.md) · [Poses](../../knowledge/poses.md) · [Body rendering](../../knowledge/body-rendering.md) · [View graph design](../authoring/view-graph-design.md)
