# Profiles, Vs, saves and presets: the setup graph

**Status:** design for discussion, 29 September 2026; nothing built. It is the connective tissue the [1.0 bar](../../docs/release-readiness.md) needs between features that exist today in separate places: the Save Explorer, loading a V for editing, the Character panel's V, the collection library, part presets, saved layouts and the export identities. It models all of them as **top-level entities wired together in one reactive graph**, and profiles as rewirings of that graph. Discuss before building: nothing here changes code, stored data or exports until the maintainer has answered §7.

It extends the [architecture contract](architecture-contract.md), the [feature-module platform](feature-module-platform.md) (§2 document model, §6 export), the [view graph design](view-graph-design.md) (§3 nodes, §4.5 saved layouts) and the [selectors design](selectors-design.md) (§1 model, §1.5 identity), and follows the save-safety rules of [save files](../../knowledge/save-files.md#5-editing-safely), the [save write-back design](../character-customization/save-writeback-design.md) and the [save editor design](../save/save-editor-design.md#7-edit-safety). Code paths are relative to `projects/xf-studio/authoring/src/`.

## Contents

- [0. Summary](#0-summary)
- [1. The entity model](#1-the-entity-model)
- [2. The graph model](#2-the-graph-model)
- [3. Flows](#3-flows)
- [4. Mapping to today's code, and migration](#4-mapping-to-todays-code-and-migration)
- [5. UI surfaces (specified for the UI track)](#5-ui-surfaces-specified-for-the-ui-track)
- [6. Phased implementation plan](#6-phased-implementation-plan)
- [7. Open questions, with recommended defaults](#7-open-questions-with-recommended-defaults)

## 0. Summary

**What exists today, in pieces.**

| Piece | Where it lives | What it can't do |
|---|---|---|
| The Save Explorer | A read-only module (`features/save-explorer/`), one open save at a time, hidden under Tools | Hand its save's V to the editor |
| "Load a save" and "Default V" | The Character panel (`character-context-actions.ts`), a file picker; the decoded `SavedV` and the choices stored in the workspace (`savedV`, `preview.character`) | Keep more than one V; remember which save the V came from; write anything back |
| Makeup looks | Collection drafts in the workspace (browser storage or `workspace.json`), saved to the SQLite library only on **Save**, as immutable collection revisions | Exist outside one collection; be shared by two collections or worn by two Vs |
| Expression presets and sets | `part_presets` and `part_preset_sets` in the library, independent of any look | The same for other features |
| Saved layouts | `UIPreferences.layouts` in the workspace ([view graph §4.5](view-graph-design.md#45-saved-layouts-option-c-first-step)) | Belong to anything larger |
| Export identities | Derived from UUIDs: `xfs_c<32 hex>__xfs_p<32 hex>` for eye makeup, `xfs_x<12 hex>` for expressions | Be short, readable or chosen; be checked against each other |

**The model in one paragraph.** The Studio keeps a **setup graph**. Its durable nodes are top-level **entities** stored in the player's active **library** (the SQLite database): **presets** of every feature type, **V profiles**, **mods**, **layouts** and **profiles**. Each entity holds its own data and references other entities only by ID; the references are the graph's edges. A **profile** is a named wiring: a layout, a V profile (or "no V"), an active mod and, as the model grows, other subprofiles such as a world location. A **V profile** holds a V as data (default or from a save, plus creator choices), a **save link** to the save it came from, and what that V wears (presets by creator row). Presets are independent: any number of V profiles and mods reference one preset. Saves, the game installation and installed XF mods are **external nodes** the graph reads but never owns. Everything else (the resolved V, each mod's identity keys, each profile's requirements, and **conflicts**) is **derived**, recomputed incrementally when an input node changes.

**The key decisions.**

1. **One graph service, not one per feature.** `platform/core/setup-graph.ts` owns identity, references, validation, derivation, conflicts and the Setup history, and knows no feature. Entity types, their references and their conflict rules are registered by the composition, as view-graph codecs and feature modules are today.
2. **The library is the home of every top-level entity.** Presets autosave into it as you work; files are an export and import path, not the working store. The workspace keeps only session state (the active profile, editor memory, Undo, open saves) and legacy mirrors.
3. **Forward-only storage.** New tables beside the released ones, `user_version` left at 2 and no column added to a released table, so `v0.1.0-alpha.2` still opens a migrated library and loses nothing. Old rows are never rewritten.
4. **A preset holds one feature's part.** What V wears across features is a V profile's wiring, not a multi-part stored look.
5. **The V being edited stays on screen when you flick between Vs.** The profile's edit target (the preset you are editing) overlays whichever V is shown; each V also remembers her own worn presets (question Q1).
6. **Conflicts never block looking, only doing.** Switching profiles, flicking Vs and browsing always work. A conflict blocks exactly the operations whose result would be wrong (a Build, a write to a save, an edit of a missing preset), says why in place, and offers auto-fix routes that are ordinary, undoable graph rewrites. Deployment conflicts between mods are warnings: the player stays in charge.
7. **Saves are never written in place.** Every write-back produces a new save folder next to its target and leaves the original untouched; the offline writer stays gated on the in-game session of the write-back design, and **Apply in game** comes first (question Q2).
8. **Short export IDs, legacy identities kept.** New presets and mods get a six-character ID that is part of their exported identifiers and can be changed for a custom mod; migrated presets keep today's long identities so saved in-game choices keep working.

**Plan.** Eight slices (G1–G8, §6), about 33 agent-days (37 with the gated offline save writer), each shippable and each leaving `main` green: the graph core and entity store with automatic library backups and a developer inspector; V profiles; the Saves panel; profiles and conflicts; presets in the library; export identity and deployment warnings; write-back; and the inspector's advanced view.

## 1. The entity model

### 1.1 Kinds of node

| Kind | Examples | Stored where | Lifetime | Identity |
|---|---|---|---|---|
| **Entity** (top-level, durable) | Preset, V profile, mod, layout, profile | The active library, one row per entity plus versions | Created by the person or a migration; deleted to the library's trash; restored or purged | UUID, stable forever; plus a short export ID on presets and mods |
| **Value** (owned by one entity) | A V (as data), a save link, a mod's selectors, a layout's dock document | Inside its entity's body | Copied when its entity is duplicated; never shared | None of its own: its owner's |
| **External node** (read, never owned) | A save on disk, the game installation, an installed XF mod | Where the game or mod manager put it | Discovered by the host; may change or vanish at any time | A host reference (`SaveRef`, the installation fingerprint, an archive name) |
| **Static node** | Registered features and modules, preset types, built-in templates (Default V, the factory layout) | The composition | One build | Registry IDs |
| **Session node** | The active profile, open saves, the edit target, Undo histories | The workspace (verification-scoped) | One workspace | Workspace-local |
| **Derived node** | The resolved V, a mod's identity keys, a profile's requirements, conflicts | Memory only | Recomputed when an input changes | A function of its inputs |

Entities are the only things a person creates, names, deletes and mixes across profiles. Everything a person sees about wiring (what a profile uses, who uses a preset, what conflicts) is derived from entity references.

### 1.2 The entities

#### Library (the database)

| Aspect | Rule |
|---|---|
| What it is | One SQLite file: today's `library.sqlite` in the Studio's data folder, and `verification.sqlite` for the isolated `?verify=1` scope. "The active database" is the library this Studio has open. |
| Identity | A new `library_info` row holds a library UUID, so a workspace can tell which library its session state belongs to (a restored backup, another data folder). |
| Lifecycle | Created at first run; migrated forward only (§4.3); **backed up automatically** (§4.4); several libraries and switching between them are later (question Q7). |
| Owns | Every entity row, entity versions, the trash and the migration record. |

#### Preset (and feature preset types)

| Aspect | Rule |
|---|---|
| What it is | One feature's part saved under a name: an eye makeup look, an expression, later a hair colour, a piercing design, a pose. Exactly one part (decision 4). |
| Type | A **preset type** is registered by a feature module: its part codec (the existing `PartCodec`), its label, which creator rows it can be worn in (its selector type, [selectors §1.2](selectors-design.md#12-types-targets-and-caps)), and whether it exports through mods. Eye makeup and expressions are the first two. |
| Identity | UUID (migrated looks keep their look UUID) and an **export ID** (§1.3). The display name never enters an identity. |
| Lifecycle | Created by **New**, **Duplicate**, **Save as preset**, an import or a migration. Edited in place with autosave (§3.5). Deleted to the trash, where it stays restorable for 30 days before it is purged; **Delete permanently** acts only from the trash. |
| Versions | The head row is mutable; immutable versions are written at meaningful points: the first change of an editing session, before every Build (the manifest records the version built), at most every ten minutes of continued editing, and on **Keep this version**. |
| References out | Its feature type only. A preset references no V, profile or mod: they reference it. |

#### V (as data)

A value, never an entity of its own: a V exists inside a V profile.

```ts
// platform/api/v.ts (sketch)
export type VData = {
  readonly schema: "xfs/v-1";
  readonly bodyGender: "female" | "male";
  readonly base: { kind: "default" } | { kind: "save"; saved: SavedV };   // SavedV as today: appearance, loadout, evidence
  readonly choices: readonly CharacterChoice[];                        // only what the person set (CORE-50, CORE-51)
  readonly kept?: Record<string, unknown>;                               // a loaded CC preset's entries this installation can't use
  readonly clothing?: ClothingSetting; readonly ownMakeup?: "hidden";
};
```

This is exactly today's character-context state (`StoredCharacter`) plus the `SavedV` the workspace keeps beside it, gathered into one value so a V can be stored, duplicated and compared as one thing. The save's decoded appearance is copied in, so the V is **detached**: it never needs the save file again to be shown or edited.

#### V profile

| Aspect | Rule |
|---|---|
| What it is | A named V the player keeps: the V, where it came from, and what it wears. |
| Body | `{ name, v: VData, saveLink?: SaveLink, wears: Record<RowKey, PresetId | "off">, order }` (schema `xfs/v-profile-1`). |
| `wears` | What this V wears in each creator row the Studio authors: a row key is the feature type and its target (`eye-makeup:own`, `cheeks:vanilla:makeupCheeks`), the same unit the game saves and the selectors design organises around. Absent rows wear nothing of ours. |
| Identity | UUID. The name defaults from its source ("V from ManualSave-12", "Default V 2") and is freely renamed. |
| Lifecycle | Created by **Edit this V** on a save, **New V from ▸ Default V (feminine or masculine)**, **Duplicate**, a CC preset import, the first change to a built-in Default V (below), or migration. **Reset to default V** replaces `v.base` with the default and clears the choices (one undoable step; the save link stays, see §3.4). Deleted to the trash like presets. |
| Built-in templates | **Default V (feminine)** and **Default V (masculine)** are static, read-only V profiles. Choosing one shows the pristine default. The first change to one forks it into a new V profile in the same step, and Undo takes the fork away, exactly as built-in lighting setups fork today ([creator lighting](../../knowledge/creator-lighting.md#lighting-setups)). |
| References out | Presets (through `wears`); its origin save (external, through the save link). |

#### Save link

A value inside a V profile: what makes writing back easy without keeping the V tied to the file.

```ts
export type SaveRef = { readonly root: "detected" | "chosen"; readonly folder: string };   // never a path: the saves folder comes from Settings
export type SaveFingerprint = { readonly sha256: string; readonly bytes: number; readonly savedAt: string;
  readonly gameVersion: number; readonly saveVersion: number; readonly presetVersion: number; readonly isMale: boolean;
  readonly creatorNodeSha256: string };                   // the creator node alone: tells "played on" from "changed her looks at a mirror"
export type SaveLink = {
  readonly origin: SaveRef; readonly loaded: SaveFingerprint; readonly loadedAt: string;
  readonly writes: readonly { target: SaveRef; written: SaveRef; at: string; sha256: string; route: "offline" | "in-game" }[];
};
```

- **Origin** is the save the V was loaded from. It stays remembered after Reset and after edits, as the default write target.
- **Write-back targets** are chosen when writing (§3.4): the origin, another save, or the game itself (Apply in game). Only the history of writes is stored.
- Only the save's folder name and which saves folder it was in are stored, so the library holds no user path and a moved saves folder shows up as a plain "can't find this save" (conflict V3, §2.4).

#### Profile

| Aspect | Rule |
|---|---|
| What it is | A named way of working: which layout, whether a V is being edited and which, which mod the Mod package panel builds, which modules show. "Change profile, change layout." |
| Body | `{ name, slots: { layout: LayoutRef, v: VProfileRef | "off", mod?: ModId, …module slots }, modules?: Record<ModuleId, boolean>, needs?: ProfileNeeds }` (schema `xfs/profile-1`). |
| Slots | Registered, so later domains add their own (World registers `location`; a quest editor registers `quest`). A slot names its entity type, whether it may be off, and its default. |
| `v: "off"` | V editing is off: the profile has no opinion about a V. Modules that need a V are unavailable in it (their panels park, their tools withdraw, [view graph §4.3](view-graph-design.md#43-hiding-a-module)), and 3D views show only non-character scenes. |
| `modules` | Optional overrides on top of the layout's remembered modules; absent means the layout decides. |
| `needs` | Optional constraints the profile puts on what is wired: today only `v.bodyGender` (a masculine-export profile) and `v.source: "save"` (a write-back profile). Modules contribute needs too (§2.3). |
| Identity | UUID; name unique among profiles (48 characters, like layouts). |
| Lifecycle | First run creates one profile (§3.1). **New profile** copies the active one's wiring. Deleted to the trash; the last profile can't be deleted. |

#### Layout

Today's saved layout ([view graph §4.5](view-graph-design.md#45-saved-layouts-option-c-first-step)) promoted to an entity: the dock arrangement for both size classes, optionally its modules and its automatic size class, and its working state. Several profiles may use one layout; its working state is the layout's, so two profiles on one layout share it. The factory layout is a built-in template, forked on first change as today's **Reset to factory layout** already implies. The layout library's actions keep their names and meaning; `layouts.switch` becomes "wire this layout into the active profile".

#### Subprofile

The maintainer's umbrella word for any entity a profile wires by reference: a V profile and a layout today; a lighting setup library, a camera set or a world location later. It is a role, not a type: "subprofile" means "referenced from a profile slot". A subprofile never knows which profiles use it, so it can belong to any number of them.

#### Mod (and export identity)

| Aspect | Rule |
|---|---|
| What it is | One installable XF mod: its name in mod managers, its short key, its selectors and the presets each selector offers. It replaces "a collection with a package plan" as the unit of export. |
| Body | `{ name, key, selectors: StoredSelector[] (each with its preset IDs in order), settings, legacy?: { collectionId, archive } }` (schema `xfs/mod-1`). The selectors are the [selectors design](selectors-design.md#14-document-model)'s, moved from a collection into the mod. |
| One or many | By default the library has **one** mod holding every exportable preset (the "one XF-branded mod" rule); **Split into a new mod** moves selectors or presets to a new mod entity. Merging is the reverse. A mod is the product: the package plan's products become mods. |
| Identity | UUID; a short **key** (§1.3); migrated mods keep their collection's UUID and `xfs_c<collection>` archive. |
| References out | Presets, through its selectors. A preset may appear in several mods. |

### 1.3 Export identity

| Rule | Detail |
|---|---|
| Short IDs | Every new preset gets an **export ID** and every new mod a **key**: six characters of lower-case Crockford base32 (`0-9a-z` without `i l o u`), random, unique in the library (a unique index; a clash draws again). About a billion values, so two players' mods collide by chance about once in hundreds of thousands of pairs. |
| In identifiers | By default they build every emitted name: mod `k7m2qd` and preset `p3xv9a` give the archive and namespace `xfs_mk7m2qd`, the look appearance `xfs_mk7m2qd__xfs_pp3xv9a`, the head component `hx_xfs_mk7m2qd_makeup` and the depot folder `axefrog/appearance_studio/mods/k7m2qd/`. The [naming contract](../../projects/xf-studio/data/naming.md) gains this form in slice G6, beside the legacy one. |
| Chosen IDs | The player may set a custom ID or key for a mod they publish ("smoky"): 2–16 characters of `a-z` and `0-9`. Changing either on something already built says what it costs first: "Players who chose this look in game will need to choose it again." |
| Legacy identities | Migrated presets and mods keep exactly today's names (`xfs_c<32 hex>`, `xfs_p<32 hex>`, the expressions' `xfs_x<12 hex>` and clip names), so builds stay byte-identical and players' saved choices keep working. The UI shows them as "long ID (from an earlier version)" with **Use a short ID** and the warning above (question Q4). |
| Identity keys | Each mod's plan identity projects to a set of **keys**: archive, namespace and option names, `uiSlot`s, appearance and definition names, text keys, component names and depot folders. Projected purely from the mod, its presets' IDs and its selectors, without building. |
| Conflicts | Two deployable units sharing a key conflict (§2.4, D1–D3). Deployable units are this library's mods and the XF mods found installed in the game (from the resolver's installation scan and the Studio's own build records). An installed build of the *same* mod entity is an earlier version of it, not a conflict. |

### 1.4 What is top-level and what is wired

| Top-level (independent entity) | Wired by reference from | Owns nothing else |
|---|---|---|
| Preset | V profiles (`wears`), mods (selectors), the profile's edit target (session) | Yes |
| V profile | Profiles (`slots.v`), character scene nodes (later, to show two Vs) | Its V and save link (values) |
| Layout | Profiles (`slots.layout`) | Its dock document (value) |
| Mod | Profiles (`slots.mod`) | Its selectors (values) |
| Profile | The workspace's active-profile pointer (session) | Nothing but references |

No entity embeds another. Every edge is a named reference in a body, so mixing and matching is always a rewiring, and deleting something leaves visible dangling references (conflicts with fixes), never silent cascades.

## 2. The graph model

### 2.1 Node and edge types

```ts
// platform/api/setup-graph.ts (sketch)
export type EntityType = "preset" | "v-profile" | "mod" | "layout" | "profile" | (string & {});
export type EntityRef = { readonly type: EntityType; readonly id: string };
export type ExternalRef = { readonly kind: "save"; readonly save: SaveRef } | { readonly kind: "installation" } |
  { readonly kind: "installed-mod"; readonly archive: string };

/** What a composition registers per entity type: its codec and the edges its body declares. */
export interface EntityTypeContribution<B> {
  readonly type: EntityType; readonly owner: ModuleId | "platform"; readonly schema: string;
  parse(body: unknown): B;                          // validate and migrate on read; pure
  refs(body: B): readonly EdgeDecl[];               // the edges, derived from the body: no separate edge store
  readonly templates?: readonly { id: string; label: string; body: B }[];   // built-ins, forked on first change
}
export type EdgeDecl = { readonly slot: string; readonly to: EntityRef | ExternalRef;
  readonly strength: "requires" | "uses" };         // `requires`: the subject can't work without it; `uses`: it degrades
```

| Edge | From → to | Cardinality | Strength |
|---|---|---|---|
| `layout` | profile → layout | one | requires (a missing one falls back to the factory layout) |
| `v` | profile → V profile or template | zero or one | requires when the profile's modules need a V |
| `mod` | profile → mod | zero or one | uses |
| `<module slot>` | profile → a module's entity (World: `location`) | per slot | per slot |
| `wears:<row>` | V profile → preset | one per row | uses |
| `origin` | V profile → save (external) | zero or one | uses (only write-back needs it) |
| `selector:<id>` | mod → preset | many, ordered | uses |
| `type` | preset → preset type (static) | one | requires |
| `module` | profile → module (static) | many | uses |
| `edits` | session edit target → preset | one per feature | requires |

**Dependency rules.**

- The type order is a DAG: profile → {layout, V profile, mod} → preset → preset type; V profile → save. A body may not reference an entity of its own type or of a type above it, so cycles can't form, and the service rejects a body that tries.
- References are by ID only. Deleting an entity never edits another entity: its referrers keep the ID, and the reference shows as a conflict until it is restored, replaced or removed (fix routes).
- A template is referenced like an entity (`{ type: "v-profile", id: "template:default-female" }`); writing to it forks it.

### 2.2 Ownership and the service

- **`platform/core/setup-graph.ts`** (DOM-free) holds every entity head in memory (bodies of large presets load on demand), keeps the **reverse index** (who references each node), validates every commit with the types' codecs, derives, detects conflicts and records the Setup history. It publishes a detached `SetupSnapshot` and a change set per commit, like the view graph.
- **The store port** (`SetupStorePort`) is the host transport to the library: list heads, get bodies, commit a batch (revision-guarded per entity), trash, restore, versions. The library host implements it on the new tables (§4.2).
- **Feature code never touches the store.** A feature registers its preset type and its conflict rules; it reads its presets through its facade and edits them through its actions, as today.
- **Other windows.** The host bumps a library change counter on every commit (and SQLite's `data_version` catches another process). The graph polls it while the window has focus, reloads changed heads and re-derives. A stale commit gets a plain "changed in another window" and nothing is lost: the edit stays in the workspace's recovery copy.

### 2.3 Derivation

Derived nodes are memoised by the revisions of their inputs and recomputed only when an input changes:

| Derived node | Inputs | Consumers |
|---|---|---|
| Shown V | The active profile's `v`, the V profile's `VData`, the edit target | The character context and scene (today's `deriveCharacter` on the host) |
| Worn set | The V profile's `wears`, overlaid by the edit target (decision 5) | Feature renderers per row |
| Requirements | The profile's `needs`, the needs of its shown modules (`ModuleManifest.needs`: eye makeup, Character, Poses and Expressions need `v`), its slots | Conflict rules |
| Identity keys | A mod, its selectors and its presets' export IDs | The deployment key index |
| Usage | The reverse index | Lists ("Used by 2 Vs, 1 mod"), orphan detection, the inspector |
| Conflicts | Rules over a subject and its neighbours | Everything below |

### 2.4 Conflicts

**What counts as a conflict:** a wiring whose result would be wrong or surprising. Each is produced by a registered **rule** with an owner, a subject type, a severity and the operations it blocks.

| # | Rule | Severity | Blocks | Fix routes |
|---|---|---|---|---|
| P1 | The profile's layout is missing (deleted, or from a newer build) | Warning | Nothing (the factory layout shows meanwhile) | Restore it; use another layout (each listed); keep the factory layout |
| P2 | The profile's V profile is missing | Blocking | Edits and exports that need the V | Restore it; wire another V (each listed); turn V editing off |
| P3 | V editing is off, but a shown module needs a V | Blocking | That module's actions | Hide those modules in this profile; turn V editing on with a V (each listed); use a layout that doesn't show them |
| P4 | The wired V doesn't meet the profile's needs (a masculine-export profile given a feminine V; a write-back profile given a default V) | Blocking | The operations the need guards (the masculine Build, a write-back) | Wire a V that meets them (each listed); **New V from Default V (masculine)**; drop the need from the profile |
| V1 | A V wears a preset that is gone | Blocking | Editing that row | Restore the preset; wear another (each listed); wear nothing there |
| V2 | A V's choices name creator options the installation lacks | Notice | Nothing (kept and drawn as saved, today's missing-choice report) | Open the report |
| V3 | A V's origin save can't be found | Warning | Writing back to the origin | Find it in another saves folder (Settings); write to another save; forget the link |
| V4 | The origin's creator node changed since the V was loaded (her looks were changed at a mirror in game) | Warning | Nothing until a write, then asks | **Bring the game's changes in** (re-base: the save's new V as base, the choices kept where they don't overlap, overlaps listed); write anyway |
| V5 | A write target's body gender differs from the V's | Blocking | That write | Choose another target (matching saves listed) |
| M1 | A mod lists a preset that is gone | Warning | Nothing (partial export omits and reports it, as today) | Restore it; remove it from the mod |
| M2 | Two presets in one mod share an export ID | Blocking | Building that mod | Give one a new ID (a route per preset) |
| M3 | The V you are editing wears a preset no mod includes | Notice | Nothing | Add it to a mod (each listed) |
| D1 | Two of this library's mods share an identity key | Warning | Nothing | New key for one (a route per mod); leave it |
| D2 | A mod shares a key with an installed XF mod that isn't an earlier build of it | Warning | Nothing | New key for this mod; leave it |
| D3 | Two deployable mods each carry an XF eye makeup selector (the type's cap across mods: two eye plates may draw in an unknown order) | Warning | Nothing | Move the selectors into one mod; leave out one mod; leave it |
| E1 | An entity holds data from a newer build | Notice | Editing it (read-only, "made with a newer version") | None; kept as stored |

- **Deployment conflicts are warnings.** D1–D3 never block, as asked: the Studio says what would happen in game ("Only one of the two would show in the creator") and the person decides. **Leave it** acknowledges a warning: it stays listed in the Conflicts list but stops drawing attention, until any entity it involves changes.
- **Blocking is narrow.** A conflict names the actions it blocks by action kind and subject. Nothing blocks switching profiles, flicking Vs, opening panels, browsing presets or undoing.

**How it is detected, reactively and cheaply.**

- Rules are pure functions `evaluate(subject, neighbours) → Conflict[]`. A commit's change set gives the dirty nodes; the reverse index adds their referrers; only rules whose subject type is in that set run, only on those subjects. The cost is proportional to what changed and its degree, never to the library's size.
- The deployment rules (D1–D2) use a **key index**: key → owners. A mod's key set is re-projected only when the mod or one of its presets' IDs changes, and the index is diffed. Installed mods' keys come from the host once per installation generation.
- A conflict's identity is `hash(rule, subjects)`, stable across re-evaluation, so an acknowledgement and an open fix popover survive unrelated edits.
- **Budget:** under 2 ms per commit for a library of 2,000 presets, 50 mods, 30 V profiles and 20 profiles, measured by a synthetic-graph test (§6).

**How it surfaces.**

- `SetupSnapshot.conflicts`: every conflict with its plain sentence, severity, subjects and routes; and a per-entity index, so any list can mark its rows.
- **Capabilities consult the index.** An action a blocking conflict covers is refused with the reason code `conflict`, its sentence and the conflict's ID. The presentation shows the disabled reason with its fix routes in place (§5.4). Dispatch revalidates, as every capability does.

### 2.5 Auto-fix routes as graph rewrites

```ts
export type FixRoute = { readonly id: string; readonly label: string;      // "Wear “Smoky” instead"
  readonly consequence: string;                                            // one plain sentence: what changes
  readonly recommended?: true; readonly patch: GraphPatch };
export type GraphPatch = readonly (
  | { op: "set"; ref: EntityRef; path: readonly string[]; value: unknown }  // rewire one reference or value
  | { op: "create"; type: EntityType; body: unknown; as: string }          // e.g. a new V from a template
  | { op: "restore"; ref: EntityRef }                                        // out of the trash
  | { op: "acknowledge"; conflict: string })[];
```

- A rule offers its routes with each conflict. A route that needs a choice (another V, another layout) is one route per candidate, up to six shown, then **More…** opening the relevant list with the candidates marked.
- **Applying** is one action, `setup.fix { conflict, route }`: the service checks the conflict still exists with the same subjects and revisions, applies the patch as one commit, records one step in the **Setup history** with the route's label ("Wear “Smoky” instead"), and publishes. A patch that would create another blocking conflict is refused before it applies, with that conflict's sentence.
- **Undo** replays the inverse patch captured at commit (entity bodies before and after). Setup history is session-only, like View and lighting history ([view graph §3.6](view-graph-design.md#36-undo-scope)). A fix never deletes anything, so no fix needs the trash.

### 2.6 History scopes

| History | Covers | Where Ctrl+Z acts on it |
|---|---|---|
| Look (per preset) | The preset's part: today's look history, now keyed by preset | The feature's panels and the 3D view while editing |
| Character (per V profile) | The V's creator choices, base changes and Reset: today's character history, now kept per V profile, so flicking keeps each V's Undo | The Character panel |
| View and lighting | As built | The Camera & light panel |
| **Setup** (new) | Every wiring edit: profile slots, V list changes, wears, mod membership, fixes, renames, deletes to the trash | The profile switcher, the V list, the Saves panel, the Conflicts list, the inspector |

Deleting to the trash is a Setup step, so **Undo** restores it; purging from the trash is the one irreversible action and says so.

## 3. Flows

### 3.1 First run, with the default V

1. The library is new: the migration (§4.3) finds nothing to migrate and creates the first **profile**, "Studio", wired to the factory layout, the **Default V (feminine)** template, and the library's first mod ("XF Eye Artistry", key drawn, no presets yet).
2. The first paint needs nothing from the database: the workspace carries the active profile's wiring as a cached mirror, so layout, V and panels come up at once and the library confirms them moments later (the load-time goal).
3. The V list shows "Default V (feminine)" active, with **Load your V from a save** as its first action, and the Saves panel lists the player's saves (when the game's saves folder is found).
4. The first creator change or the first worn preset forks the template into "My V" and rewires the profile to it, in the same step; one line under the V list says so. The Default V template stays in the list, pristine, as the starting point to come back to.

### 3.2 Loading a save and making its V active

1. The **Saves panel** (the converged Save Explorer, §5.3) lists every save, newest first, each with its screenshot, level, life path, location and, when a V profile already comes from it, that V's name.
2. **Edit this V** on a save: the host reads its creator node (`readSavedV`) and fingerprints the file; the service creates a V profile (`base: save`, the save link with `loaded`), wires it into the active profile and makes it the shown V. One Setup step.
3. If a V profile already comes from this save, the row offers **Switch to <V name>** first, then **Bring the save's changes into <V name>** (re-base, V4's route) and **Load again as a new V**. Nothing duplicates by accident.
4. Several saves can be open at once: each opened save is a session node, listed at the top of the panel under **Open**, and each can make its own V. Opening a save for its V never needs the explorer's node tree; the tree stays a research tool.
5. The Character panel's **Load a save** opens the same list (as a popover), so there is one way to load a V, reached from two places.

### 3.3 Flicking between Vs

1. The V list shows every V profile and the two templates; clicking one (or the palette's "Switch to V: <name>", or a key the UI track assigns) rewires the active profile's `v`. One Setup step.
2. What you are editing stays on: the profile's edit target overlays the newly shown V in its row, so a makeup is judged on several faces by flicking (decision 5). Rows you are not editing show what that V wears.
3. **Instant after the first time.** The host already caches prepared details by request fingerprint. The device keeps the last three shown Vs' loaded details referenced for a grace period, so flicking back and forth draws within a frame budget (target: under 150 ms to the new V's first complete frame when its details were prepared before; a V never prepared shows the preparation line as today, with the previous V on screen until it is ready).
4. Each V keeps its own Character Undo history for the session.

### 3.4 Writing back: to the origin, a new save or another save

The write routes are designed here so the data model carries what they need; the offline writer ships only when the write-back design's session passes ([§14](../character-customization/save-writeback-design.md#14-batched-in-game-test-plan-one-session)).

| Route | What happens | Available |
|---|---|---|
| **Apply in game** (first) | The runtime bridge applies the V's creator choices at the mirror or ripperdoc screen; the player confirms and saves in game. No file is written by the Studio. | With the bridge and the appearance screen open (write-back phase A) |
| **Into its own save** (default target: the origin) | A **new save folder** beside the origin (the next `ManualSave-<n>`), holding the origin's current progress with this V's creator node; the origin is untouched | After the gate |
| **Into another save** | The same, based on a save the player picks (listed; only saves of the V's body gender are offered, V5) | After the gate |

**Safety**, from the write-back and save-editor designs, all enforced in the domain action (`vprofile.writeSave`), never only in the UI:

- Never in place (question Q2). Write to a temporary name in the saves folder, flush, rename; refuse if the destination exists or the target changed during the write.
- The target's own bytes are the base: progress since the V was loaded is kept. The creator node is planned from the V and must pass the **identity test** (no choices → the target's own node, byte for byte) before any write.
- Exact save and preset versions only (269 and 12 today); other versions stay read-only until a session confirms them.
- Re-read the new file with the Studio's reader: every other node byte-identical, the creator node exactly as planned, the original's hashes unchanged.
- The confirmation lists what changes ("Hair colour, eye colour and 3 face shapes change; everything else stays as saved"), which mods the written options come from, and one line about cloud sync.
- A **backup record** in the library (source and new folder hashes, time, route) makes every written save traceable to its V (the save link's `writes`).
- **V4 before writing to the origin:** if the origin's creator node changed since loading, the write asks first, with **Bring the game's changes in** and **Write anyway** (the second replaces the in-game changes, and says so).
- After a write the save link records it; the new save is not automatically the origin (the player may prefer to keep writing from the original).

### 3.5 Presets saved to the database and referenced by several profiles

1. **New preset** in the Presets panel creates a preset row at once (the feature's starter part, a drawn export ID) and makes it the edit target. There is no Save button: edits are autosaved into the library, debounced (about half a second after the last change, and at once on a commit such as a gesture's end, a blur or a switch).
2. Until the library acknowledges a write, the workspace keeps the edit in its recovery copy, so a closed window or a lost host loses nothing; on reconnect it is written with a revision check.
3. The Presets panel lists the library's presets of the active feature, filtered by chips that are always visible: **Worn by this V**, **In this mod**, **All**, **Trash**. Each row says where it is used ("Worn by 2 Vs · in XF Eye Artistry").
4. **Wear** puts a preset in the shown V's row; **Add to mod** puts it in a mod's selector. A preset worn by two V profiles and listed in one mod is one row, edited once, seen everywhere: profiles "Studio" and "Masculine check" wiring different Vs both show it.
5. **Export to a file** (a preset, a mod as an `xfs/collection-2` file, a V as `xfs/cc-preset-1`) and **Import** are in each list's menu: secondary, never needed to keep work.

### 3.6 Export with short IDs and cross-preset conflict warnings

1. The Mod package panel builds the active profile's mod (`slots.mod`); its header names it and offers the other mods.
2. **Check** (unchanged pipeline) plans the mod as a package-only collection built from the mod entity, as expression sets already are (`setCollection`, `part-preset-sets.ts`). Identity comes from the mod's key and the presets' export IDs, or their legacy identities.
3. The panel's **Identity** section shows the mod key and each preset's ID, editable, with the cost of changing a built one. Conflicts M2 (blocking) and D1–D3 (warnings) show in place, each with its routes, before Check is pressed: the key index knows them without building.
4. **Build** records each preset's version in the manifest; the build's keys join the deployment index as an installed candidate once placed in the mod manager, so a later mod with the same key warns against it.

### 3.7 Switching profile

1. The profile switcher lists every profile; choosing one moves the workspace's active-profile pointer. This is a navigation, not an edit: no Setup step, and it never asks.
2. The presentation applies the profile's layout through the layout library (the working state of the layout left behind is kept, as today), shows and hides modules by the layout and the profile's overrides, and the scene shows the profile's V (the V is prepared if it wasn't; the previous one stays until it is).
3. The edit target is per profile (session state), so each profile comes back to what it was editing.
4. Any conflicts of the profile show at once in the switcher row and the header indicator; nothing blocks the switch.

### 3.8 A world-editing profile with V editing off

1. **New profile › For world editing** (a template the World module contributes once it exists) creates a profile with `v: "off"`, a layout that shows World and hides the character modules, and no mod.
2. Character modules are unavailable in it: their panels park, their view tools withdraw, the Character panel isn't offered, and the main view's scene is the World's `location` kind ([view graph §3.10](view-graph-design.md#310-modules-that-are-not-about-v)).
3. If someone shows Eye makeup in this profile anyway (the Modules menu stays usable), conflict P3 appears with its three routes, and eye makeup's actions are refused with its sentence until one is taken.
4. Switching back to "Studio" brings the V, the makeup panels and the edit target back exactly as they were.

## 4. Mapping to today's code, and migration

### 4.1 What exists and what changes

| Today | Becomes | Change |
|---|---|---|
| `CharacterContextActions` (`character-context-actions.ts`), its state and Undo | The shown V's service, reading and writing the active V profile's `VData` | Its state moves out of the workspace into V profiles; its history is kept per V profile; its actions (`character.*`) are unchanged in name and meaning |
| `SavedAppearanceActions` (`saved-appearance-actions.ts`), `savedV` in the workspace | Part of the V profile (`base.saved`) | `savedV.load` becomes `vprofile.fromSave`; the workspace keeps `savedV` only as the legacy mirror (§4.3) |
| Character panel's Load a save / Load preset / Default V | The V list and the Saves panel's list | The panel keeps its buttons; they open the shared list |
| Save Explorer (`features/save-explorer/`), one `open` save, hidden under Tools | The Saves panel: a shell panel listing saves and open saves; the node explorer behind *Show research tools* | `open` becomes a list; new action `saves.editV { folder }`; the host adds the file and creator-node fingerprints to `saves-server.ts` |
| Collection drafts (`collection-workspace.ts`, `collection-service.ts`), Save / Save copy / Open | Presets autosaved in the library; mods for export | The draft model retires: per-preset editor memory and Undo stay in the workspace, keyed by preset; the recovery queue stays for unacknowledged writes |
| `CollectionLibrary` (`collection-store.ts`) | Read-only source for migration and re-import | No change to its tables or behaviour; the new build stops writing collection revisions once a collection is migrated |
| `PartPresetLibrary` and sets (`part-preset-store.ts`, `part-preset-sets.ts`, `part-presets.ts`) | The preset store for every feature; sets become mods | Presets gain side-table metadata (export ID, trash, versions); sets migrate to mods |
| Layout library (`layout-library.ts`, `UIPreferences.layouts`) | Layout entities | Actions keep their names; storage moves to the library; the workspace keeps the live arrangement |
| `UIPreferences.modules` | The layout's remembered modules, with profile overrides | Presentation state still; the application reads only the profile's `needs` |
| Package plan (`platform/core/package-plan.ts`) | Mods (one product each) | `xfs/package-plan-1` products migrate to mod entities with their archives |
| Export identity (`features/eye-makeup/export`, `features/expressions/export`) | Identity from the plan input (mod key, preset IDs, or legacy) | Exporters stop deriving names from UUIDs for new mods; legacy stays byte-identical |
| View graph scene node (`look: "selected"`) | `v: "profile"` (default) or a V profile ID | Makes [view graph Q8](view-graph-design.md#7-open-questions-with-proposed-defaults) (two Vs side by side) a wiring |
| Selectors design (proposed) | Selectors live in mods; worn looks live in V profiles; activation stays workspace state | Its Q1 (a look in one selector) relaxes: a preset may be in several mods' selectors |

**New modules.** `platform/api/setup-graph.ts` (types), `platform/core/setup-graph.ts` (service, derivation, conflicts, history), `platform/core/conflict-rules.ts` (the platform's rules; features register their own), `library-entities.ts` (host store over the new tables), `v-profile.ts` (the `VData` codec and the V profile type), `profile.ts`, `mod-entity.ts` (the mod type and its projection to a package collection and identity keys), `export-identity.ts` (IDs, validation, key projection), and the presentation port's `setup` facade.

### 4.2 Storage

| Table (new, `CREATE TABLE IF NOT EXISTS`) | Holds |
|---|---|
| `library_info(key, value)` | Library UUID, the migration record (what was migrated, from which revisions, when) |
| `entities(type, id, name, revision, schema, body, created_at, updated_at, deleted_at)` | V profiles, mods, layouts, profiles (one table, typed by `type`; bodies in their type's schema) |
| `entity_versions(type, id, revision, schema, body, created_at, reason)` | Kept versions of any entity |
| `preset_meta(id PRIMARY KEY, export_id UNIQUE, legacy_identity, deleted_at, created_from)` | What presets need beyond `part_presets` |
| `preset_versions(id, revision, schema, body, created_at, reason)` | Kept preset versions |
| `write_records(id, v_profile, target, written, sha256_before, sha256_after, route, at)` | The save write backup records |

- **Presets stay in `part_presets`.** Eye makeup looks become rows with `feature = 'eye-makeup'`, expressions are already there. Nothing is added to `part_presets` itself: today's code (and `v0.1.0-alpha.2`) inserts positionally, so a new column would break the published build's inserts. Metadata goes in `preset_meta`, keyed by preset ID; a preset row without metadata (made by alpha.2) gets it on first read.
- **`user_version` stays 2.** Alpha.2's stores refuse any other version.
- Rows of a newer build's schema are kept and shown read-only (E1), never rewritten, as part presets and collection rows already are.

### 4.3 Migration: no data loss, alpha.2 compatible

**Runs once per library, at the first start of the build with slice G5, forward only.**

| Source | Becomes | How |
|---|---|---|
| Each collection's latest revision | A mod entity with the **same UUID** and `legacy: { collectionId, archive: "xfs_c<collection>" }`; a multi-product package plan becomes one mod per product with its archive | Read through `CollectionLibrary.get`; never rewritten |
| Each look | An eye makeup preset with the **look's UUID** and `legacy_identity` (`xfs_p<preset>`), in that mod's selector in the same order | Its eye makeup part into `part_presets`; its other parts (an expression tried on it, CORE-123) become presets of their own, named "<look> (expression)", in no mod |
| Earlier revisions of each look | Its kept versions | Copied, labelled with the collection revision |
| Expression sets | Mods with the set's UUID and legacy namespace `xfs_x<12 hex>` | Members become the selector's presets |
| The workspace's `savedV` and `preview.character` | The first V profile, "My V" (or "V from <save>" when the workspace has a save), with no save link (the old workspace never recorded one) | Read from the workspace at first start |
| The workspace's layout library | Layout entities; its active layout wired into the first profile | The workspace's `layouts` is left in place |
| The workspace's collection draft | Its unsaved edits applied to the migrated presets as a first autosave (each marked "brought in from your unsaved draft"), and its recovery drafts as presets in the trash | So nothing autosaved in the browser is lost |

**Invariants and gates.**

- **Before anything is written**, the library file is copied to `library.pre-setup.sqlite` beside it (kept until the person removes it from Settings; not in backups rotation), and the migration is a dry run first: counts of collections, looks, versions, sets and presets read versus planned. A mismatch aborts the migration with nothing written, the Studio carries on with the legacy panels, and the problem is reported through Report a problem.
- **Byte-identical export** for every migrated collection: the same plan, members, `.archive.xl` and manifest fields (`tools/compare-package-candidates.ts`, as for platform step 8).
- **Alpha.2 still opens the library** and sees its collections and expression presets as they were at migration (a test runs alpha.2's vendored store code against a migrated fixture, as the part-preset tests do for alpha.1).
- **Alpha.2 changes after migration are noticed.** If the older build saves a new collection revision later, the new build sees a revision newer than the one it migrated and offers **Bring in changes from the older XF Studio** (per look: the newer content becomes the preset's head, the replaced head a kept version). It never merges silently.
- **Workspace downgrade.** The workspace keeps writing its legacy fields as mirrors of the active profile: `savedV` and `preview.character` from the shown V, `uiPreferences.layout` from the live layout, and a collection draft mirroring the active mod's presets, so alpha.2 opening this workspace shows the same V, layout and looks. New workspace fields (`setup`: active profile, edit targets, open saves) are written only once they differ from what the mirrors imply, the rule the view graph and lighting setups follow.

### 4.4 Automatic library backups

The library becomes the only home of the work, so it is backed up without being asked: SQLite's online backup of the library into a `backups` folder beside it, at the first start of each day and before every migration, keeping seven daily and four weekly copies (about 1 MB each for the reference collection). Settings shows **Restore a backup…** with each copy's date and counts. Backups hold no save files, only V profiles' decoded appearances, as the workspace does today.

## 5. UI surfaces (specified for the UI track)

Functional specifications only: the UI component track builds or extends the components in the library, with style-guide entries and light, dark, narrow and wide captures, and the UI design lead reviews them. Every surface follows "show the options, don't hide them": lists and button sets, not dropdowns.

### 5.1 Profile switcher

- **Where:** the header's leading slot, before the Modules and Panels menus, showing the active profile's name (icon alone when narrow; tooltip "Profile: <name>").
- **Menu content:** every profile as a row (name, a one-line wiring summary "Layout: Makeup · V: Nomad V · Mod: XF Eye Artistry", conflict marker when it has any); the active one checked. Below, **This profile**, shown as sections rather than nested menus: Layout (the layouts as rows), V editing (on or off as a two-button set; when on, the Vs as rows), Mod (the mods as rows). Then commands: New profile, Duplicate, Rename, Delete (to the trash).
- **The Layouts button** is folded into this menu: a layout is part of a profile. Its palette commands stay. (The UI lead may keep a separate button if the review prefers; the requirement is that layout choice reads as a profile setting.)
- **States:** switching shows its effect at once (optimistic, as the layout switch does today); a profile with a blocking conflict opens with the conflict indicator visible, never a dialog.
- **Keyboard:** menu pattern; the palette has "Profile: <name>" per profile.

### 5.2 V list

- **Where:** a shell panel `setup.vs`, in the `inspect` slot beside Character; also reachable from a V chip in the 3D view's header ("V: Nomad V"), which opens the same list as a popover.
- **Rows:** each V profile with its name, a source line ("From ManualSave-12 · level 34 · Nomad", "Default V (feminine)"), badges only when something differs (save link needs attention; conflicts), and usage ("In 2 profiles"). The two Default V templates sit in their own group, "Start from".
- **Actions:** clicking a row flicks to it; the row's menu has only what applies: Rename, Duplicate, Reset to default V, Write back… (when a route is available), Show its save (reveals it in the Saves panel), Delete. The list's header has **Load your V from a save** and **New V from ▸** (the templates, a CC preset file).
- **States:** the shown V is marked; a V being prepared shows the preparation line in its row, and the previous V stays on screen.
- **Keyboard:** list pattern (arrows, Enter to flick); a binding for next and previous V, registered in the [input bindings](input-bindings.md) catalogue.

### 5.3 Saves panel

- **Where:** a shell panel `setup.saves` (the Save Explorer's panel, converged), shown by default in character profiles.
- **Content:** the saves folder in use (as Settings names it) and every save, newest first: screenshot thumbnail, kind (manual, quick, auto), level, life path, location, time, and the V profiles that come from it. **Open** groups the saves opened this session at the top.
- **Actions per save:** **Edit this V** (primary), or **Switch to <V>** when one exists; **Write a V here…** (when write-back is available); **Explore** (the node tree, research tools only). Open saves have **Close**.
- **Write-back sheet:** the route choice as a button set (Apply in game, Into its own save, Into another save), the target, the plain summary of changes, the version and safety line, and one confirm button labelled with the action ("Write a new save"). Progress in place; the result names the new save and offers **Show in the Saves panel**.
- **States:** saves folder not found (friendly guidance with **Choose the saves folder**), loading, a save that can't be read (plain reason, the row kept).

### 5.4 Conflict indicators and auto-fix affordances

- **Header indicator:** a fixed-width slot (it never shifts layout) that shows a count badge only while conflicts exist, coloured by the worst severity; blocking ones take precedence. It opens the **Conflicts list**.
- **Conflicts list** (popover and the inspector's filter): grouped Blocking, Warnings, Notices; each item is the plain sentence, its subjects as links (reveal in their list), and its routes as buttons, the recommended one first, each with its consequence line underneath. Warnings add **Leave it**; acknowledged ones fold into "Left as they are (2)".
- **In place:** every list row whose entity has conflicts carries a marker (icon plus count, with the sentence in its tooltip). A blocked action's disabled reason (reason code `conflict`) shows the sentence and a **Fix…** affordance opening that conflict's routes beside the control.
- **After a fix:** the notice names the route ("Now wearing “Smoky”") with **Undo** (the Setup history).
- **Component asks:** `ConflictBadge` (count, severity, fixed slot), `ConflictItem` (sentence, subjects, route list, acknowledge), `FixRouteButton` (label, consequence, recommended state), `EntityRow` (name, source line, badges, usage, marker, row menu), used by every list here.

### 5.5 Graph inspector

An optional panel, `setup.inspector`: a developer's diagnostic view and an **Advanced** view for players who want to see how everything is wired. Listed under Modules › Tools (stage Preview, hidden by default).

**Content.** A tree list of everything in the graph or available to it, grouped:

- **In your library:** profiles, V profiles, layouts, mods, presets by type, the trash;
- **Available:** saves on disk, installed XF mods, built-in templates, registered features and modules;
- **This session:** the active profile, open saves, edit targets;
- with *Show research tools* on: derived nodes (the shown V's request fingerprint, identity keys, requirement sets) and raw bodies, revisions and rule IDs.

Each row shows its **type** (icon and label), name, ID (short ID where it has one), usage count and conflict marker. Expanding a node shows its references in two groups, **Uses** and **Used by**, each child a link to that node.

**Type-aware actions.** The row's context menu lists only what can be done to that node, from the application: Switch to (a profile), Flick to (a V), Wear or Add to mod (a preset), Edit this V (a save), Restore or Delete permanently (trash), Reveal in its own panel, Copy ID, the conflict's fix routes. No section appears without an action in it.

**Search and filters.** One search field over name, type, ID and export ID, origin save, mod, profile membership and wiring, plus always-visible filter chips (facets) that combine: type, feature, "in the active profile" (reachable from it), "has conflicts" (by severity), "unused" (presets no V, mod or profile references), "orphaned" (references to missing nodes), "from a save", "newer build". Typed facets work too (`type:preset used:0`, `origin:ManualSave-12`, `id:k7m2qd`, `uses>2`).

**Smart behaviour.** **Show what depends on this** filters to the node's referrers transitively; **Highlight conflicts** marks the paths from the active profile to each conflicted node; **Focus the active profile** collapses the tree to what it reaches; **Unused presets** lists candidates for tidying with a bulk **Move to the trash** (a Setup step, undoable).

**How it reads the graph without coupling.** The panel is presentation only: it calls `port.setup.inspect(query) → InspectorPage` (the application builds the index, runs the search and returns detached rows and edges, paged 200 at a time), `port.setup.actionsFor(ref) → ActionOffer[]` (each with its capability) and `port.setup.dispatch(action)`. It never receives entity bodies to edit, the store or the graph service; raw bodies in the research view are detached JSON copies. The index is built when the panel is first shown and withdrawn when it is hidden, so it costs nothing otherwise. A boundary test keeps `studio-ui` from importing the setup graph's core.

### 5.6 Changes to existing panels

- **Presets panel:** lists library presets of the active feature with the chips of §3.5; New, Duplicate, Wear, Add to mod, Export to a file; each row's usage line.
- **Mod package panel:** names its mod (from the profile), lists the other mods as rows, gains the **Identity** section (§3.6) and **Split into a new mod**.
- **Character panel:** its source line names the V profile; Load a save and Default V open the shared lists.

## 6. Phased implementation plan

Each slice leaves `main` green (suite, typecheck, browser build, desktop build and their gates) and is testable on its own. Effort in agent-days.

| # | Slice | Scope | Tests and gates | Effort | Needs |
|---|---|---|---|---|---|
| G1 | **Graph core and entity store** | `platform/api/setup-graph.ts`, `platform/core/setup-graph.ts` (heads, reverse index, codecs, commits, change sets, derivation, the conflict engine with no rules yet, Setup history); the new tables; `library-entities.ts` host store and transport; library UUID; **automatic backups** and Restore in Settings; the inspector's read-only developer view (research tools) | Pure graph tests: refs, reverse index, DAG refusal, revision conflicts, history replay; store tests on a temp library; alpha.2 vendored store opens a library with the new tables; the synthetic 2,000-preset commit budget; boundary: no feature or `studio-ui` imports the core | 4 | — |
| G2 | **V profiles** | `VData` and the V profile type; the Default V templates and fork-on-change; the character context reads and writes the active V profile; per-V Character history; the V list panel and V chip; flicking with the three-V details grace; first-start migration of the workspace V; legacy mirrors | Codec round trips; fork and Undo; migration from workspace fixtures (default, save, preset origins); mirror round trip read by the alpha.2 workspace reader; flick timing on the reference save in `?verify=1` | 4 | G1 |
| G3 | **Saves panel** | The Save Explorer's panel as `setup.saves`; several open saves; Edit this V, Switch to, Bring changes in (re-base) and Load again; the save link and fingerprints (`saves-server.ts`); conflicts V3 and V4; Character panel's Load a save through it | Host tests for fingerprints (fixture saves are synthetic, never private); re-base keeps choices and lists overlaps; `?verify=1`: two saves open, two Vs, flick | 3 | G2 |
| G4 | **Profiles and conflicts** | Profile and layout entities; slots registry; the switcher (with layouts folded in); modules' `needs`; rules P1–P4 and V1; fix routes and `setup.fix`; conflict indicators and in-place Fix; the first profile at migration | Rule tests with each route applied and undone; capability refusals carry `conflict`; boundary: rules registered with an owner, routes only through `setup.fix`; `?verify=1`: V editing off with Eye makeup shown, fix each way, switch back | 5 | G2 |
| G5 | **Presets in the library** | Presets autosaved with revision guards and the recovery copy; `preset_meta` and versions; the trash; the Presets panel's chips and usage; wears; the collection and set migration with its dry run, pre-migration copy and "Bring in changes" for alpha.2 edits; rule M1 and M3; file export and import as secondary | The platform §2 parity gates on migrated looks; migration fixtures (collection-1, collection-2, multi-product plan, expression sets, an unsaved draft); alpha.2 reads the migrated library; crash test (autosave interrupted, recovered on restart); write load (a long gesture session stays under one library write per 500 ms) | 6 | G1, G2 |
| G6 | **Mods and export identity** | Mod entities with keys and selectors; export IDs; identity projection and the key index; installed XF mods' keys from the installation scan; rules M2 and D1–D3; the Mod package panel's Identity section and Split; exporters take identity from the plan input; the naming contract and the [pipeline guide](studio-to-mod-pipeline.md) (with its diagram review) updated | **Byte-identical** builds for migrated mods (`compare-package-candidates.ts`); a new-identity build passes the independent verifiers; key projection equals the built inventory's names; rule tests including "earlier build of the same mod is not a conflict" | 5 | G5 |
| G7 | **Write-back** | `vprofile.writeSave` and Apply in game on the bridge (write-back phase A); the write sheet in the Saves panel; write records; V5. The offline writer (phase B) stays behind a developer flag until the write-back session passes | Phase A: bridge-driven session steps R1; phase B: the identity test and post-write checks on synthetic saves, then the batched in-game session W0–W3 | 4 (A) + 4 (B, gated) | G3, G4 |
| G8 | **Inspector, advanced view** | The inspector for players: search facets, type-aware menus, dependents, highlighting, active-profile focus, unused and orphaned presets with bulk trash | Pure query tests (each facet, combinations, paging); `?verify=1` walkthrough; UI review | 2 | G4, G5 |

About **33 days** in all (37 with the gated writer). G3 and G4 can run in parallel after G2; G5 can start beside G3 and G4 once G1 lands (it touches the collection code, which they don't); G6 follows G5; G7 needs G3 and G4; G8 last. Every slice with a UI change goes through the UI/UX review gate.

**Boundary rules to add** (each shown to fail on an injected violation, like the existing ones):

1. Only the setup graph service writes entities; no feature, device or presentation module imports the entity store.
2. `studio-ui` reads the graph only through `port.setup` (snapshots, `inspect`, `actionsFor`, capabilities); it never names an entity type's body fields beyond the snapshot's.
3. Every entity type, slot, rule and preset type names a registered owner; a golden snapshot guards their IDs.
4. A conflict's blocked actions are enforced in capabilities, never only in presentation.
5. Fix routes change the graph only through `setup.fix`.
6. Nothing outside the V profile service reads or writes the workspace's legacy V fields (`savedV`, `preview.character`).
7. Exporters take names only from the plan's identity; none derives a name from a UUID for a non-legacy mod.

**Risks.**

| Risk | Mitigation |
|---|---|
| Migration loses or alters work | Forward-only tables; old rows never rewritten; a pre-migration copy; a dry run with counts; byte-identical export gates; alpha.2 reading the migrated library in tests |
| Autosave writes too often or corrupts under concurrency | Debounce and commit points; WAL; revision guards; the recovery copy until acknowledged; the write-load test |
| The first paint waits for the database | The workspace mirror of the active profile's wiring; the library confirms after paint |
| Flicking Vs is slow | The host's prepared-detail cache; the three-V grace on the device; the budget measured in G2 |
| Conflicts become noise | Narrow blocking; Leave it for warnings; notices never badge the header |
| Changing an export ID breaks players' saved choices | Legacy identities kept; changing a built one says the cost first |
| Players write a broken save | Never in place; the identity test; exact version gate; post-write re-read; Apply in game first; the offline writer gated on the session |
| Profiles add friction for someone who only wants makeup | One profile made at first run and never required; the switcher is a name in the header, nothing asks |
| Selectors design and this one diverge | Selectors live in mods here; its slices S1–S3 build on G5 and G6 instead of on collections (§4.1) |

**How later domains plug in.** A new V feature (hair colour, piercings, body) registers a preset type and a selector type: its presets are worn by V profiles and exported by mods with no change here. Body customisation extends `VData` through the character context (it already carries body options). World editing registers a `location` entity type and a profile slot, and its own rules ("a location view without a location"). Quest design would register a `quest` entity and slot. Lighting setups (today per workspace) become a subprofile type when shared across workspaces is wanted. Each adds only registrations and its `compose/` list entries, the platform's acceptance test.

## 7. Open questions, with recommended defaults

| # | Question | Recommended default |
|---|---|---|
| Q1 | When you flick to another V, does the makeup you are editing stay on (so you judge one makeup on several faces), or does each V show only what she herself wears? | **It stays on.** The edited preset overlays every V you flick to in its row; each V still remembers what she wears, which shows in every other row and is what writing back puts into her save. |
| Q2 | May the Studio ever overwrite a save in place (with its own backup), or does every write make a new save folder beside the target? | **Always a new save folder**, the original untouched, as the write-back design and save-editor rules already say. "Write back to the origin" means "a new save made from it". |
| Q3 | Do profiles and layouts live in the library (they travel with presets and Vs, and every window shares them) or per machine? | **In the library,** with the workspace keeping only the active profile and the live arrangement. |
| Q4 | Migrated looks: keep today's long identities (saved in-game choices keep working) or move everything to short IDs now (players choose their looks again once)? | **Keep them**, with **Use a short ID** per preset or mod, which says the cost first. |
| Q5 | Is a stored preset always one feature's part (what V wears across features being the V profile's wiring), retiring the multi-part look as a stored unit? | **Yes.** Migrated multi-part looks split into one preset per part. |
| Q6 | Is Default V a read-only template that forks into "My V" on the first change (like built-in lighting setups), or an ordinary V profile you edit directly? | **A template that forks**, so "Default V" is always there to start from. |
| Q7 | Several libraries (open another library file, one per project) in 1.0? | **No**: one library per data folder, with file export and import to move work, and automatic backups; several libraries later if wanted. |
| Q8 | Should deployment warnings (D1–D3) also consider mods installed by other tools or other players' XF mods found in the game, not only this library's? | **Yes**, from the installation scan, as warnings only; an installed build of the same mod never counts. |

## Related pages

- [Architecture contract](architecture-contract.md) and [presentation boundary](ui-architecture-boundary.md): the layers and exceptions this design follows
- [Feature-module platform](feature-module-platform.md): parts, the document model and export, which §1 and §4 extend
- [View graph design](view-graph-design.md): the view graph's nodes, saved layouts and module activation
- [Selectors design](selectors-design.md): selectors, now held by mods
- [UI workspace preferences](ui-workspace-preferences.md): the workspace preference record that keeps the live layout
- [Save files](../../knowledge/save-files.md), [save import](../eye-artistry/save-import.md), [save write-back design](../character-customization/save-writeback-design.md) and [save editor design](../save/save-editor-design.md): what a save is and how writing stays safe
- [CC controls and presets](../backlog/cc-controls-and-presets.md): the character context and CC presets that V profiles hold
- [1.0 readiness](../../docs/release-readiness.md) and [where XF Studio is going](../../docs/vision.md): why this is 1.0 connective tissue, and the domains it must extend to
