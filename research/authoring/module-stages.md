# Module stages: what is finished, what is early access, and why

The one place that says which parts of XF Studio are finished, which are early access, why, and what each early-access part needs before it can leave. Other pages link here instead of restating it. Update this page whenever a module's stage, its evidence or its exit list changes.

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[runtime]** seen in the running game, **[offline]** run here without the game, **[design]** decided but not built.

## 1. What the stages mean

| Stage (code) | What the person sees | Meaning |
|---|---|---|
| `stable` | No tag | Finished to the [1.0 bar](../../docs/release-readiness.md): what it makes works in game, its UI is finished and reviewed, and nothing about it is provisional. |
| `preview` | An **Early access** stage tag wherever it's listed or shown (Modules menu, Panels, tabs, switches; `studio-ui/components/stage-tag.ts`) | Usable, but some part of its promise is unproven or unfinished. Each preview module has an exit list below. |
| `dev` | The same Early access tag | Reserved for work that is not for users yet. No module uses it today. |

"Hidden by default" is separate from the stage. It is the module manifest's `shownByDefault: false`: the person turns the module on in the Modules menu. Today every `preview` module is also hidden by default. The word "preview" in the code means the release stage. In the UI, "preview" means the 3D view, so the UI says "Early access".

**A module leaves preview** when:
- everything on its exit list is done;
- it meets the 1.0 bar;
- its stage is set to `stable` in both `module.ts` and the feature's `index.ts`, in the same commit that updates this page.

## 2. The register

| Module | Stage | Shown by default | Makes anything for the game? | Summary of why it isn't stable |
|---|---|---|---|---|
| Eye makeup | stable | yes | XF Eye Artistry | Stable. Finish-level limits are listed in [status](../../docs/status.md) (some finishes are experimental) |
| Expressions | preview | no | XF Expressions (photo-mode expression mods) | §3: the formal in-game comparison (R4) hasn't run, the protection for a carried table hasn't been built, and the shared-pack route conflicts with other expression mods |
| Poses | preview | no | Nothing yet: browse and show installed poses | §4: nothing to export; the pose editor is a next track |
| Save Explorer | preview | no | Nothing: a read-only save inspector | §5: a research tool, not a user feature |

## 3. Expressions

### What is built
Each item is tested offline unless marked otherwise.
- **Phase 1, model and preview:** the `expressions` look part, with Undo and these actions:
  - **Start from:** rest, saved, natural or any installed expression, resolved generically, so the Mega Pack's faces appear because its files win;
  - **the all-controls drawer;**
  - **Mirror and Flip.**

  The Studio's head shows a live solve of the game's own facial rig, using the setup photo mode uses (D1, the male player setup) [offline] ([design](../animation/expression-editor-design.md), [phase 1 status](../animation/expression-editor-design.md#phase-1-status)).
- **Phase 3, export:** the Expression sets panel. Check and Build produce an **XF Expressions** mod (clips, an ArchiveXL patch of the photo-mode face rig, TweakXL records, and the expression table in an overlay archive), with an independent verifier. A five-expression set builds and verifies in about 84 s, and its clips round-trip exactly through WolvenKit 9.0.1 [offline] ([phase 3 status](../animation/expression-editor-design.md#phase-3-status)).
- **Phase 5, an in-app solver:** the MIT solver, verified against the external one [offline].
- **Animated transitions** between expressions (default 1 s linear, like photo mode) [offline].

### What has been seen in game
- **Session 4 (28 September 2026)** staged a three-expression XF set built by the Studio, the "Cheek check" set. Its rows were listed as the last three of 210 photo-mode expressions, beside the Mega Pack's, under their own names, and they played. The smile's cheek bunching sat where the Studio's preview put it [runtime] ([N13](../../experiments/029-session-4/README.md#34-n13-cheek-check)).
  - Its size is inconclusive: the lens, the lighting and the facial setup all differed.
  - The maintainer's reading: the expressions look "more comical in game", and photo-mode lighting changes a lot.
- **R1 and R2 answered:** which facial setup photo mode solves with, and that the menu value isn't the table index [runtime] (same session, §3.5).

### Why it is still early access, and what it waits on
Each exit item is a blocker unless marked otherwise.

| # | Exit item | Why it matters | State | Waits on |
|---|---|---|---|---|
| E1 | **R4: an authored expression plays as the preview shows.** Compare a copy of Happy and one changed control, at matched framing, then repeat on a second eye shape. | Session 4 proved that a set loads and plays, not that the face matches. The preview is labelled "a solved preview of the game's rig", never "as in game", until this passes. | Not run | Game session: plan [N11](../runtime/next-sessions-plan.md#n11-xf-expressions-set-in-photo-mode-r4r5) |
| E2 | **R5: rows beside other expression mods, and sparse indices.** | Listing beside the Mega Pack passed in session 4. Two parts are untested: the "For sharing" table (filler rows up to index 999, its own rows from 1000), and whether sparse indices work. | Partly done | Game session: N11 |
| E3 | **The stale-table watch** ([§6.3](../animation/expression-editor-design.md#63-the-expression-table-and-precedence-decision-2)). | A "For my game" build carries a copy of the winning expression table. If the other expression mod later updates, its new faces silently stop working until the person rebuilds. That fails the 1.0 bar's "nothing glitchy". | Not built | Implementation only |
| E4 | **Decide the shared-pack route** (design question D5). | A "For sharing" pack and any other expression mod each replace the one table file, so only one wins, as between expression mods today. A pack made for other people therefore conflicts with the Mega Pack. A public "contribution pack" and its tour need a decision on whether that's acceptable, or another route. | Open | The maintainer's decision |
| E5 | **Decide whether region handles (phase 2) are needed for 1.0.** | The confirmed interaction is handles plus the drawer. Only the drawer is built, and editing 141 controls in a drawer is slow. | Designed, not built | The maintainer's call: needed for 1.0, or later |
| E6 | **Male V.** | The Studio has no male head preview, so male clips export blind (question 4). | Open | Male head preparation, or label it plainly as unpreviewed |
| E7 | **The banked follow-ups from the UI review:** Add to set in a saved expression's menu, and step-by-step Build progress. | Polish to the 1.0 bar. | Not built | Implementation only |

**Not exit items** (banked; they wait for 1.0): export at a chosen intensity, a bridge photo-mode lighting rig matching the Studio's, XF Natural Face Overrides, NPC puppets, and animated faces.

**The guided "photo-mode expression pack" tour** waits on E1–E5. It's written against the finished module and doubles as the end-to-end script for N11.

## 4. Poses

### What is built
- The pose library: every photo-mode pose from the game and installed mods (TweakXL list operations, the native `.anims` decoder), in one searchable tree, shown on the full-body view [offline] ([work queue](../backlog/README.md)).

### Why it is still early access
| # | Exit item | State |
|---|---|---|
| P1 | Something to make: the pose editor and its export. Until then it only shows what's installed | Designed, needs discussion ([pose editor design](../animation/pose-editor-design.md)) |
| P2 | A decision on whether a browse-only Poses module should be stable on its own | Open: the maintainer's call |

## 5. Save Explorer

### What is built
- A read-only save inspector: nodes, objects and script mods' data [offline].

### Why it is still early access
- It's a research tool, not a user feature. The [release-readiness audit](release-readiness-audit.md) recommends moving it under research tools rather than the Modules menu. It has no exit to stable planned: either it moves to research tools, or a user feature is built on it.

## 6. Early-access settings outside modules
- **Hair physics** (Motion) carries the Early access tag: a preview-only motion setting [offline]. It has no export.
