# Save identity and lineage

**Maturity: Draft.** Consolidated on 22 October 2026 for the Story Engine's area G (saves and identity). It answers three questions: how a save can be identified and its lineage (a save made from a loaded save) followed, how existing mods tie their state to saves, and what happens to mod state on a new game, an older save and a deleted save. It ends with a proposal for the save key the Story Engine's world record would use, and a session card. Session 15 (23 October 2026, bridge 0.8.8) answered most of the card in the game ([results](#session-15-results)); the rest is [source] and [resource]. Sources: the game's 2.31 scripts (`final.redscripts`, the same decompiled bundle as [events the game emits](game-events.md)); the `metadata.9.json` files of 167 private saves (copies, field names, types and counts only, no values kept); the scripts of the studied mods named in [Sources](#sources); the Codeware wiki, and Codeware's source for how its session events are raised (commit `a652bbb`, read 23 October 2026); the Modding Docs. Evidence grades follow the [knowledge rules](README.md): **[source]** engine, framework or mod source; **[resource]** bytes of real saves; **[wiki]** Modding Docs; **[community]** a mod author's or framework wiki's statement, not read in engine source; **[offline]** measured by our own probes; **[runtime]** seen in the running game; **[hypothesis]** not established. The container, the node encodings and where mods keep data in a save are in [save files](save-files.md); the hooks that report a save or a load are in [events the game emits §9](game-events.md#9-save-and-load).

## Short answers

| Question | Answer | Grade |
|---|---|---|
| Does the game give a save a stable identity? | Not a usable one. The folder name is reused (rings of 20 auto, 10 quick and 10 point-of-no-return slots, and the save menu can overwrite a manual slot), the second-resolution timestamp can collide, and `saveID` is a script-only number of unknown meaning. | [source] [resource] |
| Does it say which playthrough a save belongs to? | Yes, in the metadata file only: `playthroughID`, a 16-hex-digit id shared by every save of one playthrough, kept across game updates. No script reads it. | [resource] |
| Does it record a save's parent? | No. Nothing in the metadata names the save it was made from. Branches can only be inferred (same `playthroughID`, `playTime` going backwards). The one lineage tag it has is `pointOfNoReturnId`, set after the point of no return. | [resource] |
| How do mods tie state to saves? | Three working ways: state inside the save (persistent fields, facts, persistent entity state), which branches with the save for free; an external file joined to the save by a fact; or an external store that ignores saves. Only the first two follow a reload. | [source] |
| What happens to that state? | In-save state reverts with the save, is absent on a save older than the mod, and starts fresh on a new game. External stores do none of this: they need a key, and clean up only when the mod does it. | [source] [community] |
| What should the Story Engine do? | Keep the world record in an external ledger, and carry a small sealed key in five quest facts that pins the ledger entry the save corresponds to ([proposal](#the-story-engines-save-key)). | proposal |

## 1. What the game records about a save

A save folder holds `sav.dat`, `metadata.9.json` and `screenshot.png`. The metadata is the load menu's summary. Field names below are from 167 saves in six playthroughs, written by game versions 2.02 to 2.31 (save versions 257, 265 and 269); every field is present in every version [resource].

| Field | Seen | Survives load and resave? | Use as identity |
|---|---|---|---|
| Folder name = `name` | `ManualSave-<n>` (numbers rise and may leave gaps), `AutoSave-<0..19>`, `QuickSave-<0..9>`, `PointOfNoReturnSave-<0..9>`, `EndGameSave-<n>`. Auto and quick numbers never leave their ring, so slots are reused [resource]. The save menu can overwrite a manual slot (`OverrideSavedGame`, `OverrideSave`) [source: `saveGameMenu.script`, `orphans.script`] | No | No: the same name can hold a different save later |
| `timestamp` (script, `Uint64`) and `timestampString` (`HH:MM:SS, DD.MM.YYYY`) | Within 2 s of the file's modified time on all 167 saves. Three pairs share a second (two end-game saves written together) [resource] | New each save | Weak: one-second resolution, locale-formatted string |
| `playthroughID` | 16 hex digits; six values over 167 saves, each shared by 1 to 69 saves. Constant across game versions 2.21 to 2.31 within a playthrough [resource] | **Yes** | Yes, for the playthrough, not the save. Not readable from script |
| `visitID` | A UUID; 100 values over 167 saves, mostly 1 or 2 saves each, up to 12. Two values span two playthroughs. Within one value, `playTime` goes backwards in 5 of 65 consecutive pairs [resource] | No | Reads as one id per game launch (not per load); a load inside the same launch keeps it [hypothesis, session card 2] |
| `playTime`, `playthroughTime` (seconds) | `playthroughTime` is never below `playTime`; the gap grows over a playthrough and does not reset on a reload. `playTime` goes backwards when an older save is loaded and resaved [resource] | Continues | Orders saves; shows a branch as a step back |
| `pointOfNoReturnId` | 16 hex digits. Empty on 123 saves. Each of 10 values sits on exactly one `PointOfNoReturnSave` and on the end-game and manual saves made after it (all later in `playTime`); later saves of the same playthrough made from earlier saves lack it [resource] | Inherited by later saves | A branch tag the game itself keeps from the point of no return on [hypothesis for the rule] |
| `nextSavableEntityID`, `nextNonSavableEntityID` | Integers; not monotonic in `playTime` | Vary | No |
| `isForced`, `isCheckpoint`, `isPointOfNoReturn`, `isEndGameSave` | Booleans; they split auto saves into plain and checkpoint ones | Per save | Save kind only |
| `saveVersion`, `gameVersion`, `buildID`, `initialBuildID`, `buildPatch` | Save 257 at game 2.02, 265 at 2.21 and 2.3, 269 at 2.31 | An old save keeps its versions | Compatibility checks |
| `facts` | A list of `name=value` strings, 1 to 79 per save, chosen by the game (quest flags such as an episode's `active`, a lifepath background). Not settable from script as far as scripts show [resource] [source] | Per save | A mod's own facts are not known to appear |
| `fileSize`, `isModded`, `additionalContentIds`, `lifePath`, `difficulty` | As named; `fileSize` equals the length of `sav.dat` | Per save | No |
| `locationName`, `trackedQuest`, `playerPosition`, `level`, attributes and skills | The load menu's text and numbers | Per save | No |

**What scripts can see.** The load menu hands scripts a `SaveMetadataInfo` with `saveIndex`, `saveID` (`Uint32`), `internalName`, `locationName`, `trackedQuest`, `gameVersion`, `lifePath`, `saveType`, `saveStatus` (invalid, local, upload, cloud, in sync), `timestamp`, `playTime`, `playthroughTime`, `initialLoadingScreenID`, `level`, `isValid`, `isModded`, `platform` and `additionalContentIds` [source: `loadGameMenu.script`, `orphans.script`]. It has **no** `playthroughID`, `visitID` or `pointOfNoReturnId`. `initialLoadingScreenID` takes 1 to 11 values inside a playthrough, so it is a picture id, not an identity [resource]. The bridge's `game.saves` returns a subset of these ([MCP reference](../projects/xf-runtime-bridge/docs/mcp-reference.md#game_saves)); the game sends details only through the Load menu's own callback ([runtime access](runtime-access.md)).

**The game has a playthrough notion of its own.** `LoadLastCheckpoint(onlySamePlaythrough)` is called with `true` by the death menu and the settings restart, and `false` by the main menu's Continue (which loads the newest save of any playthrough) [source: `deathMenu.script`, `singleplayerMenu.script`, `settingsMain.script`]. A death therefore reloads the last checkpoint of the same playthrough without the load menu: a load that no menu hook sees.

**Lineage, then.** The metadata says which playthrough a save is in and when it was made, never what it was loaded from. A tool can only guess a parent: the newest earlier save of the same `playthroughID` is right for a straight run and wrong after any reload of an older save. A scripted store that needs the true parent has to record it itself, at the moment of the load.

## 2. How mods tie state to saves

Studied by reading the mods' scripts (technique only; [Sources](#sources)).

| Pattern | Used by | What branches with the save? | Weak points |
|---|---|---|---|
| **Persistent fields of a `ScriptableSystem`** | EquipmentEx (outfits), RPG Progression System (rank arrays, tweak baselines), Night City Allies (companion registry, a `modVersion` integer with an ordered list of migrations run on load) | Everything: the fields are in the save's `ScriptableSystemsContainer` ([save files §4](save-files.md#4-where-mods-keep-their-data)) | Restored after the systems attach, so `OnAttach` sees defaults (RPS: "every rank reading 0") [community]. Positional arrays must only grow at the end, and arrays of different lengths in an old save crashed the game in one mod [community]. Removal behaviour untested |
| **Quest facts** | Every quest mod; the vanilla game itself (`PlayerSystem.OnGameRestored` reads `isPlayerPossessedByJohnny` from the facts) | Yes; facts are `Int32`, set with `QuestsSystem.SetFactStr(name, value)` and read with `GetFactStr` (0 if never set) [source] | One 32-bit integer per name. Names are hashed in the save, so a collision with a quest fact is silent |
| **A per-save file joined to the save by a fact** (psiberx's GameSession in CET Kit, as vendored by XUtils and BetterFuelSystemReloaded) | Mods that keep Lua state outside the save | Only by the join, below | Needs the join to be right; see below |
| **An external store that ignores saves** | Codeware `ScriptableService` persistent fields (one `.dat` beside the plugin, shared by all playthroughs), CET mods' own `db.sqlite3` and files [source] [community] | Nothing: every save sees the same state | Wrong on every reload and every second playthrough |
| **Persistent entity state** | Codeware dynamic entities with `persistState` or `persistSpawn`; `@addField persistent` on a vanilla persistent state | Yes (in `PersistencySystem2`) [source] | An id that is stable only with `persistState` [community] |
| **A save-owned identity with an external ledger** | The AI NPC Cyberpunk Mod (version 0.2.7) | Its memory ledger, through the identity | Its fact module calls itself a "candidate" and keeps its write gates off by default [source] |

**GameSession's join, as read** [source: `GameSession.lua` 1.4.5, identical in both vendored copies]. The key is `os.time()` at the moment of minting, kept in the fact `_psxgs_session_key` (the `Int32` fits until 2038). After every successful save (`gameuiInGameMenuGameController.OnSavingComplete`) it writes the mod's data to a file named by the current time, with the key just in force on the first line, and then mints and writes a new key, so the next save carries a different key; on each load it finds the file whose first line matches the fact. When a load starts from the load menu it also records the chosen save's metadata timestamp and finds the file by that (with one second of slack, `+1`), because the key is not readable from the menu's list ("Cannot be retrieved from save metadata"). It renews the key again at `PlayerPuppet.OnGameAttached`, and removes files whose timestamps no save has when a load starts from the menu (its `Clean` event). What this gives: one file per save (the whole state copied each time), the right file on a load from the menu, and cleanup only as a side effect of menu loads. What the code leaves open: whether the key survives the renewal at `OnGameAttached` on the Continue path, and what happens when two saves land in the same second.

**The AI NPC mod's identity, as read** [source: `fact-identity.lua`, `save-identity.lua`, `knowledge-state.lua`]. It builds the save's identity from about 40 quest facts under one prefix: a 128-bit campaign id and a 128-bit branch id (each in eight 16-bit facts), a branch epoch, a ledger sequence number and a commit generation, in two alternating banks of 21 facts, each closed by a seal fact equal to the generation, with a head fact (twice the generation plus the bank) that says which bank is current. A write puts the seal at 0, fills the payload, reads it back, writes the seal and then the head. The identity is read at the end of `PlayerSystem.OnGameRestored`. A restored record counts only if the mod's external ledger already confirmed it; otherwise the next write must **fork**: a new branch id with a higher epoch, sequence 0. A second, native variant (a system with claim, seed, resume, advance and fork commands guarded by generation and revision counters) is driven from the same Lua; its native code is not in the package. The facts need a collision audit against the quest corpus first, and the module's write and restore gates default off until that audit is supplied [source: its comments]. It is the closest precedent to the proposal below and confirms the shape: **identity inside the save, data outside, fork when the ledger does not know the restored point.**

## 3. What happens to mod state

**Reference-model check [offline].** The Story Engine's S3 core now carries its chronological event buffer, pool,
occurrence identities, tombstones, cooldowns, pending lifetimes, recent choices, schedule position, outcome-consumption
position and arc lock in one
branch-local record. Its [reload tests](../projects/xf-story-engine/reference/test/s3/reload.test.ts) verify selected-save
inheritance and atomic sowing; the [Kabuki fixture](../projects/xf-story-engine/reference/test/s3/e2e.test.ts) agrees with
uninterrupted play after fresh-process reloads at each of five simulation boundaries, including reloading at every boundary.
This checks the external ledger's reference semantics. It does not validate the proposed five-fact key or a game save hook.

**Event facts are part of the saved dependency [offline].** Keeping an event's id/header alone does not keep its fields
readable after replay. The [review regressions](../projects/xf-story-engine/reference/test/s3/review-fixes.test.ts) verify
that a story handed to S2 retains its constituent events and transitive causes across fresh loads after pool reclamation,
and releases them only after the last consumer finishes. The [kernel regression](../projects/xf-story-engine/reference/test/process-evidence.test.ts)
also checks a non-canon raw event referenced by an outstanding output batch: its own facts survive the save before the
batch applies. A closure saved before the next director tick remains unconsumed, so the next tick establishes the arc
opening lock; saving after consumption cannot extend it again. These are reference-model checks, not game-save evidence.

The kernel's S3B regressions extend this to pin evidence, frame focus, edge causes, canon causes/participants/served,
memorable beliefs and transitive header creator/cause links. Referenced summary items keep participant/effect facts
under their opening process's materialisation owner (`scene.acts` in the fixture); their time and place still change
with the summary descriptor. Both direct seed references and pending output batches agree with uninterrupted execution
after fresh replacement loads. A retained event's own location edge persists for spatial discovery without rooting
unreferenced events. These [offline] checks implement S0 v4.16 §14.1; the old bare-header expectation is superseded.

**Retention release is separate from edge validity [offline].** The reference model's
[event-persistence regressions](../projects/xf-story-engine/reference/test/process-evidence.test.ts) release an event at 10,
reference it again at 20, and compare uninterrupted execution with fresh incremental and snapshot loads: the spatial
queries and the entire later save record agree. Release is carried by the retained-reference records and their marked
closure; it never invents an edge end. Saved history keeps actual validity without becoming a retention root, including
after sweeping. Re-reference completes missing headers, owned facts, materialisation provenance and transitive event
dependencies from the selected save through the same header-first replay as load, even when a summary query has
already recreated the event header. Live records remain authoritative; recovery fills only absent records and follows
only reached references. The S3F-01 matrix checks query-before-reference and reference-before-query, with/without a sweep,
in both incremental and snapshot modes against fresh B loads; all eight materialisation-owned facts and the minted
participant recover, while unrelated saved events remain unretained and sweepable. Releasing again makes the recovered
closure sweepable. Both B and C
loads in a release/re-reference/release sequence preserve later records and readable facts. The live edge interval is
authoritative, even when reopening reuses the previous start timestamp: equal starts do not identify an interval. The
tests preserve both `{ from: 20, to: 30 }` after a previous end at 10 and `{ from: 0, to: 30 }` after a previous end at 0,
as well as an interval left open. They also cover an end beyond save time, sweeping before saving, an end before the first
save, and retention monotonicity/root insertion order for ordinary and materialised events. These are reference-model
guarantees ([SPEC-NOTES 191–192](../projects/xf-story-engine/reference/SPEC-NOTES.md)), not game-save evidence.

| Event | State inside the save (fields, facts, entity state) | An external store | Grade |
|---|---|---|---|
| **New game** | A fresh facts table and default fields: GameSession mints a key because the fact reads 0; the AI NPC mod treats a detach with no restore after it as a new game | Untouched: Codeware services and CET files carry on, so a store without a key mixes playthroughs | [source] [community]; the facts reset itself is [hypothesis], session card 6 |
| **Loading an older save** | Reverts to that save's values. If the save predates the mod, fields are absent (defaults; `OnRestored` is documented as called for a system that has data) and the fact reads 0 | Does not revert. The mod's world is now ahead of the save | [source] |
| **Reloading after death, or the settings restart** | As an older save: the last checkpoint (`LoadLastCheckpoint(true)`) | As above, with no menu event | [source] |
| **Overwriting a manual slot, or an auto or quick slot rolling over** | The new save replaces the old; the folder name now means a different save | Any mapping keyed by name or timestamp now points at the wrong save | [source] [resource] |
| **Deleting a save in the menu** | The state goes with the file | Scripts are told nothing. The requests handler's `DeleteSavedGame(saveId)` is a native reached from the Load and Save menus' controllers; wrapping the controllers' call is possible [hypothesis]. GameSession only cleans up on the next menu load. Deleting in the file manager is never seen | [source] |
| **Exporting, importing or a cloud save** | Travels with the file | The sidecar stays behind: the save arrives on another machine without its ledger | [source: `ExportSavedGame`, `ImportSavedGame`, `inkSaveStatus`] |
| **Removing the mod** | Persistent fields of its systems: untested here. The Modding Docs warn that removing mods that store data in saves "may" crash a load until they are reinstalled, naming mods with custom weather states, New Game Plus and a ripperdoc mod: world and entity state, not plain facts | The mod's files are the mod's problem | [wiki: Modding Docs `a54b0873`, `for-mod-users/user-guide-troubleshooting/README.md`, "Corrupt-ish Saves"] |

## The Story Engine's save key

**Aim.** The world record branches with saves ([DS-08](../research/story-engine/design-seeds.md), requirement P1): load an older save and the record is the one that save had, not the one the future left behind. The record is too large for facts and belongs in XF Core's store (megabytes, requirement P3). So the key has to be small, live in the save, survive any load or resave without a hook running at the right moment, and say how to rebuild or fork when the ledger does not recognise it.

**Decision.** The record is an **append-only ledger** in XF Core's store. The save carries a **pin** into it: five quest facts naming one ledger entry. Nothing depends on a save hook firing, because the pin is written when the record is *committed*, not when the game saves.

**The pin** (five `Int32` facts, all in 0 to 2³¹−1, names under `xfs_sk_`):

| Fact | Holds |
|---|---|
| `xfs_sk_c0`, `xfs_sk_c1` | Campaign id: 62 random bits, never 0. One per playthrough we have seen. Zero in both means "no key" |
| `xfs_sk_b` | Branch id: 31 random bits. A branch is a run of commits with a single parent |
| `xfs_sk_n` | Sequence number of the last commit on the branch |
| `xfs_sk_k` | Check: a 31-bit hash of the other four. A mismatch (a torn write) is read as "no key, damaged" |

**The ledger** (one namespace per campaign): `branches[b] = {parent: (b', n') or none, forked_at: game time and wall time}` and `entries[(b, n)] = delta or snapshot of the record`, immutable once written. Replaying a branch's entries up to `n`, on top of its parent chain up to the fork point, rebuilds the record as of that pin.

**Rules**

1. **Commit.** When the record changes, append the entry `(b, n+1)` to the ledger and flush it; only then set `xfs_sk_n` and `xfs_sk_k`. A crash between the two leaves an unreferenced entry, which is harmless. Commit on a short timer while the record is dirty, and again at `Session/BeforeSave`. Codeware raises that event from its own game system's before-save step and runs every callback synchronously before the step returns [source] ([events §9](game-events.md#how-codeware-raises-the-session-events)); its wiki adds that the save waits for the callback [community]. Codeware does not filter by save kind, so from source the event should fire for autosaves and quick-saves too. That the engine runs the step for every kind, and that a fact written in the callback reaches the file, are still game questions (session card row 4). Where `BeforeSave` does not fire, the save pins the last commit, and the loss is bounded by the timer.
2. **Load.** Read the pin once the facts are readable, which is no later than the end of `PlayerSystem.OnGameRestored` (the vanilla game reads a fact there [source]). Codeware's `Session/Ready` for a loaded save comes from the engine's game-system restore step, with `IsRestored()` true, which makes it a candidate read point that needs no wrap [source] ([events §9](game-events.md#how-codeware-raises-the-session-events); session card row 3 says whether facts are readable there). The bridge's script gate (`OnPlayerAttach`) comes much later ([runtime access](runtime-access.md)). Classify:
   - *Known:* the pin is valid and the ledger has `(b, n)`. Rebuild the record at `(b, n)`.
   - *Behind:* as *known*, and the ledger has entries after `(b, n)` on that branch. Same, but the next commit **forks**.
   - *Foreign:* the pin is valid and the ledger lacks `(b, n)` (a save from another machine, an imported or cloud save, a pruned ledger). Rebuild layer 1 from the game's own state (the mirror re-derives); keep the campaign id; open a new branch with no parent and mark it `lineage_unknown`.
   - *Unkeyed:* campaign 0. A new game, or a save older than the mod. Mint a campaign and a root branch.
   - *Damaged:* check mismatch. Treat as *foreign* and log it.
3. **Fork.** The next commit after *behind* (or *foreign*) mints a new random branch id and writes `parent = (b, n)` before the first entry of the new branch. The sequence restarts at 1. Parent and child are therefore recorded at the moment of the divergence, which is the only moment the true parent is known. Saves made without any commit in between simply pin the same entry, and that is correct: they hold the same record.
4. **Save events (optional index).** When a save completes (`Session/AfterSave` or `OnSavingComplete`, whichever fires), append `{pin, wall time, game time}` to a save log. The log is for display, to place saves in a tree beside the Load menu's list (matching on timestamp and `playTime`, never on the folder name). Nothing is restored from it.
5. **Clean-up.** Keep a campaign's ledger while any save in the saves folder carries its campaign id and for 90 days after the last one is seen to go. The Studio can read the pin offline (a fact is stored as the FNV-1a 32-bit hash of its name and a value, [save files §2](save-files.md#2-three-encodings)) and can read `playthroughID` from the metadata; a script cannot read the latter. Never prune an ancestor of a kept entry; compact a long chain with a snapshot at the fork point. Dropping a branch is a decision for the Studio's user, not the plugin.

**Failure cases**

| Case | What happens |
|---|---|
| Two saves share a pin | Correct: same record |
| A second save lands in the same second as the first | Harmless: nothing is keyed by time |
| Older save loaded, then played on | *Behind*, then fork; the old branch stays loadable from its own saves |
| Save deleted, or the slot overwritten | The ledger entry stays until clean-up; no script is told. A slot that now holds a different save pins a different entry; nothing maps a name to a pin |
| Save copied to a new machine, cloud save, restored backup | *Foreign*: the record is rebuilt from game state and the branch marked unknown. A snapshot written into the save itself would avoid this; whether a persistent array can hold one cheaply is a session question |
| New game | *Unkeyed* if the facts table resets (session card 6); if it does not, the old pin is read as *known* in the wrong world, so the load also compares `playTime` and `playthroughTime` against the entry's recorded values and treats a mismatch as *foreign* |
| Save from before the mod | *Unkeyed* |
| Pin written, then the game crashes before saving | The next load is from a save; the unsaved entry is orphaned and ignored |
| A torn pin (a save lands between two fact writes) | Check fails; treated as *damaged* |
| A quest sets or clears our facts | Not expected (private names); cover with a collision audit against the quest and scene corpus before shipping |
| The mod is removed | The facts remain, unread, in every save; nothing else of ours is in the save |
| Cloud sync or a save from a different game version | The pin travels in the facts; the ledger decides |

**Why facts, and not the alternatives.** Facts survive removal of the mod, need no system class, are in the save atomically, are readable offline by the Studio and in game by the bridge (`world.state` reads named facts), and are the pattern GameSession and the AI NPC mod already use. A persistent field on a scriptable system could carry a string or a snapshot, but its removal behaviour is unknown. Keying by time, as GameSession does, fails on same-second saves and copies the whole state into every save. A Codeware service or CET store has no link to saves at all. The game's own `playthroughID` is the right id for a playthrough, but scripts cannot read it, so it serves only as an optional offline cross-check by the Studio.

**What the bridge needs.** Read and set named facts from the plugin (`world.state` reads; a write route inside the plugin's own scope); the load-time read point; the save hooks as a convenience, not a dependency; and a store namespace per campaign with a megabyte-scale quota. Requirement P1 can then be marked as designed, pending the session card.

## Reference-model persistence checks

The deterministic reference model tests the logical ledger independently of the game's save-key
carrier **[offline]**. Its save/recovery contract is:

1. Every change to a saved record is written independently of retention. A first-save change that its
   regeneration recipe cannot reproduce is written too: edge ends, reopened intervals, attribute/data
   updates and ends of an event's own simulation constants. Changed pack contributions keep their ends
   across pack regeneration. The exact record, original identity headers and origin closure survive a
   sweep before the save. A newly saved event identity includes its complete own payload, spatial link,
   transitive event dependencies and explicit materialisation ownership, so direct reference operations
   need no author recipe after reload. These supporting records never become retention roots.
2. `Persistence.recoverIfSaved` is the common boundary for semantic references. Pinning, observation,
   canonisation, resolution, queries, event and record operations recover before inspecting live
   headers or selecting defaults. Typed restoration adapters and the S1/S2/S3 header readers reach the
   same gate. It uses only the selected save, replays headers before facts/provenance and leaves newer
   live records authoritative. Missing records are installed silently; no changes or relevance are
   emitted. Replacement load selects that baseline before reconciliation, excluding discarded branches.
3. A sweep drops only exactly recoverable records. Pending edits, unsaved facts and general authored
   rules remain available without becoming roots. Release never ends or reopens an interval, and a
   reopened interval keeps its actual end even when its start matches an earlier one. Retention
   membership queries walk gated roots but do not acquire the queried node as a new reference. Raw
   stores, replay/collector hooks and metadata predicates observe physical/data state; they must not
   resurrect the history they collect. The public API inventory and its explicit routes are in
   [SPEC-NOTES 195 and 196](../projects/xf-story-engine/reference/SPEC-NOTES.md).
4. Regeneration checks the whole owned event payload. One surviving constant is insufficient evidence
   of completeness. Summary items keep immutable descriptor/materialisation ownership independently
   of contribution order or expired overlays; time/kind/place remain live descriptor dependencies.

Evidence is the earlier S3C-I regressions in
[`process-evidence.test.ts`](../projects/xf-story-engine/reference/test/process-evidence.test.ts),
[`sweep-replay.test.ts`](../projects/xf-story-engine/reference/test/sweep-replay.test.ts) and
[`sweep-operations.test.ts`](../projects/xf-story-engine/reference/test/sweep-operations.test.ts), plus
S3J's incremental/snapshot first-save edge-end/data/own-end and direct pin/observation/canonisation
checks. Additional checks cover complete changed-event identities with and without a pre-edit sweep,
ordinary events and summary items, transitive dependencies, staged discard and changed pack replay.
S1's bounded protection/tie histories agree with the replayed explicit ends. Their two former
raw-absence expectations now require exact saved intervals; protection, casting and tie-reopening
assertions are unchanged and pass. Persisted history and physical residency are separate contracts.
The legacy S1 R3-01 mutation is now obsolete: removing S1 evidence materialisation still passes all
seven regression assertions against HEAD `3b2f9cae` **[offline counterfactual]**. S0 v4.15/v4.16's
saved event facts and S1's evidence records provide overlapping defences. S1's capture/materialisation
may be removable later, after its separate consumers are audited; no defence is removed in S3J.

**Discovery is a semantic reference too [offline].** Saved events remain discoverable by place,
time and witness after their headers and edges leave memory. The candidate universe is the union of
live indexes and the selected save's indexes; callers charge candidates to the operation budget and
recover each reached id through the common gate. Live intervals override saved intervals, and indexes
never root history. The [SE-229 reproduction](../projects/xf-story-engine/reference/test/discovery.test.ts)
checks independent spatial, temporal and witness reads in incremental and snapshot modes against
unswept/fresh-load controls. Discovery leaves events sweepable. Region discovery, operation exhaustion,
unrelated history and indirect recovery of another candidate are also checked.

The property compares unswept, swept and freshly reloaded executions after every operation and compares
whole save records. The raw observer starts from every retention-root category, walks owned fields and
origin/constant references, and compares headers, factual contributions, intervals/data, pins,
withdrawals, provenance, resolved values, event views and pending changes. Observer reads use a
disposable projection with an empty recovery baseline, with no saved-history prefill. Source tables,
queues/worklists and revision are serialized before/after observation to prove it cannot repair them.
Deliberately ephemeral unpersisted overlays are excluded from fact equality; expired ones remain when
checking event views so they cannot masquerade as provenance.

Public spatial queries, `eventsAtTime()` and `witnessed()` are generated operations on the executions
themselves. Every lifecycle includes save/release/sweep and all three reads, with rotating read order
and another sweep before each read. Complete discovery results are compared there. Random discovery
also checks saved event identities without supplying recipes; intentionally never-saved identities
still require their producer's recipe after load. Other operations cover saved/unsaved event payloads,
authored/own simulation constants, first-save edits, re-reference and partial regeneration. The default
has eight seeds in both snapshot modes, 20 random operation kinds and 550 total operations.

The default property rejects **28/28 historical S3C-I probes plus 3/3 discovery counterfactuals**.
All **64/64 dedicated probes** reach their named semantic assertion failure; setup errors and timeouts
do not count. The recovery inventory now audits **482 operations**, including each facade callable and
exported arrow/function expression separately, resolves simple store/argument aliases in lexical scope,
and rejects recovery of the wrong input. Removing only the predicate facade's `kindOf` gate fails both
the source audit and a semantic test that creates the facade before sweeping its future argument.
Evidence: [recovery API tests](../projects/xf-story-engine/reference/test/recovery-api.test.ts) and
[SPEC-NOTES 196](../projects/xf-story-engine/reference/SPEC-NOTES.md).

Two historical probes deliberately bypass overlapping gates to restore their original defect:
partial-header recovery also bypasses the provenance gate; contribution re-submission bypasses both
identity recovery and target-validation recovery. The shorter default random tail initially missed
the latter. A stratified saved-end/release/sweep/re-submission episode now detects it independently of
random luck. The preceding S3J hunt used a history-prefilled query projection and therefore did not
establish discovery invariance, despite passing its 28-probe bar. The earlier S3I generator detected
only 14/28 historical mutations. The new generator's post-bar hunt and final suite results are recorded
in SPEC-NOTES 196. These are offline oracle results, not game-runtime evidence. Both frozen kernel
digests remain unchanged: v3 `746601727380a3fdff647f873c91c971`, v4
`8fce55b19462a1e02f03ca5336bd8c16`.

## Session card

For a booked session on the [runtime bridge](../projects/xf-runtime-bridge/README.md). `C` is Claude, `M` is the maintainer. Rows marked **probe** use bridge 0.8.7's save-identity probe (the -writes package only, `[bridge] allow_test_hooks`; [design §3.15](../research/runtime/runtime-bridge-design.md#315-bridge-087-session-14s-findings-and-three-test-probes-for-session-15)): `test_save_identity {mode: "write"}` sets the test fact pair `xfs_probe_a`, `xfs_probe_b` and a test pin `xfs_probe_sk_c0`, `_c1`, `_b`, `_n`, `_k` (the save key's facts under the probe's prefix, the check written last), `arm_before_save: true` makes `Session/BeforeSave` write a fresh `xfs_probe_b` (row 4), and `persist {value, kib}` fills a persistent probe system kept in a file of its own (rows 11 and 12); `mode: "read"` answers them and whether the pin's check holds. Each lifecycle point is a `session` record with the facts read there while the script gate is open (points before it opens carry `live: false` and no facts, since the probe reads no game system then; so row 3 is answered up to "readable when the gate opens") (`OnGameRestored`, Codeware's `Session/*`, `OnGameAttached`, `OnTakeControl`, the probe's `OnPlayerAttach`), read with `test_events`; a delete in the Load menu is one too (row 9: the wrap is on the menu's `OnRelease`, since `DeleteSavedGame` itself is native). They are scheduled in [session 15](../research/runtime/runtime-bridge-test-card.md#session-15-checks-bridge-088). The maintainer picks saves; `game_saves` lists them. `M` plays and presses keys; `C` reads the log.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| 1 | C | Copy the metadata of the current save. `game_save` twice, a minute apart, with no load between; copy both new `metadata.9.json` files to scratch and compare `playthroughID`, `visitID`, `timestampString` and `playTime` | Same `playthroughID` and `visitID` on both; different `playTime` and timestamp; two new folder names | `visitID` differs: it is not per launch; record what changes it |
| 2 | C, M | `game_save`; then load that same save from the Load menu; `game_save` again; compare the three metadata files | Same `playthroughID`; `visitID` equal (per launch) or new (per load): either settles the hypothesis | `playthroughID` changes: a load can mint a playthrough; the proposal's cross-check needs a rule for it |
| 3 | C | **probe.** Set `xfs_probe_a` to 11. `game_save`. Set it to 22. Load the save. Read it at `OnGameRestored`, `Session/Start`, `Session/Ready`, `OnGameAttached`, `OnTakeControl` and `OnPlayerAttach` | 11 at every point from `OnGameRestored` on | It reads 0 or 22 early: record the first point at which it reads 11; the load-time read waits for that point |
| 4 | C, M | **probe.** In a `Session/BeforeSave` handler, set `xfs_probe_b` to a fresh number each time. Make a manual save, a quick-save (`ask "Quick-save with F5. Say Done."`) and an autosave (sell an item at a vendor and leave). Load each and read `xfs_probe_b` | The value the handler wrote before that save, for all three kinds (Codeware applies no save-kind filter); the log shows which hooks fired for which kind (adds the fact check to [events, session-card row 5](game-events.md#questions-only-the-game-can-answer)) | A save holds the value from before the handler: a write in the hook is not serialised; the proposal's commit-on-change does not depend on it. Record per save kind |
| 5 | M | **probe.** Die in a fight and let the game reload the checkpoint (`LoadLastCheckpoint(true)`) with no menu | The log shows the session events and `xfs_probe_a` equal to the checkpoint's value | No session events or a stale value: the death reload does not restart the session; the load-time read needs another trigger |
| 6 | C, M | **probe.** Set `xfs_probe_a` to 11 and save. Start a new game from the main menu to the first control point. Read `xfs_probe_a`; copy the new save's metadata | 0, and a new `playthroughID` | Still 11: the facts table survives a new game; the proposal's `playTime` cross-check is required, not optional |
| 7 | C, M | **probe.** Load a save made before the probe build existed. Read `xfs_probe_a` | 0 | Non-zero: names collide with something; pick a new prefix and audit |
| 8 | M, C | In the Save menu, overwrite an existing manual slot with a new save. Compare the folder's old and new `metadata.9.json` (copy the old one first) | Same `name`; new `timestampString`; the old `sav.dat` is gone, so a name does not identify a save | The old save survives under another name: record where |
| 9 | C, M | **probe.** Wrap `LoadGameMenuGameController.DeleteSavedGame` (or the menu's delete action) in a log-only build; delete a throwaway manual save in the Load menu | A log line with the index before the folder disappears | The wrap does not compile or never fires: deletion stays unobservable; clean-up stays time-based |
| 10 | C | `game_saves` twice, then again after deleting a throwaway save that sits earlier in the list. Compare `saveID` and `saveIndex` for an unchanged save | `saveID` equal each time; `saveIndex` shifts when an earlier save goes | `saveID` changes too: it is a list position; never store it |
| 11 | C, M | **probe.** On the test profile, add a probe `ScriptableSystem` with a `persistent` field set to 7; save; remove the system from the build; load the save | The save loads; the data is dropped on the next save | The load fails or crashes: persistent fields are unsafe to ship; the proposal stays facts-only (it already is) |
| 12 | C | **probe.** With the probe system from row 11, store arrays of 256 KiB, 1 MiB and 4 MiB; save and load each; note `fileSize`, save time and load time | A size and time curve | A hard limit or a long stall: a snapshot cannot ride in the save; *foreign* saves cost a rebuild |
| 13 | C | Cross-check a pin: with the pin from row 3 set to a campaign, branch and sequence, run a save, a load and a second save; compare the pin read after the load with the one set | Equal; the check fact validates | The check fails after a load: facts are altered on restore; choose a different carrier |

### Session 15 results

On bridge 0.8.8's probe, at a street in Watson ([card](../research/runtime/runtime-bridge-test-card.md#session-15-checks-bridge-088)); every row [runtime]:

- **Row 1:** two manual saves a minute apart kept the same `playthroughID` (`6a06…a1`) and `visitID`, with different `playTime` and timestamps and two new folders.
- **Row 2:** a load within one game run kept `visitID`; after a relaunch the overwritten save carried a new one (row 8 below). `visitID` is per game run, not per load.
- **Row 3:** facts are readable once the script gate opens: the first point with facts after a load, `player_attach`, read `xfs_probe_a` 11; every earlier point (`game_restored`, `Session/*`, `game_attached`, `take_control`) carries no facts because the probe reads no game system before the gate, so a read earlier than the gate needs a guarded reader of its own.
- **Row 4:** `Session/BeforeSave` and `AfterSave` fired for a manual save, a quick save and two autosaves; loading each read back exactly the `xfs_probe_b` written before it (703212282, 12228493, 1037869404): a write in `BeforeSave` is serialised by every kind of save.
- **Row 5:** a death reload (the police killed V) restarted the session (`Session/BeforeEnd`, detach with the facts already torn down, `End`, a fresh start) and read the checkpoint's `a`.
- **Row 7:** a save from before the probe read 0 and `keyed` false.
- **Row 8:** overwriting a manual slot kept its name, with a new `timestampString` and `playTime`.
- **Row 9:** deleting a save in the Load menu gave a `session` record `load_menu_delete` with its index (18); the folder went and the next save moved up to index 18.
- **Row 11:** a save carrying a 4 MiB persistent blob loaded with the probe's script removed: `persist.present` false, the facts intact, and the next save saved and loaded. Dropped persistent data does no harm.
- **Row 12:** persistent blobs of 256 KiB, 1 MiB and 4 MiB grew `sav.dat` about one to one (2.20 MB, then 2.46, 3.25 and 6.41 MB; not compressed); the save call returned in about 270 ms each time (it returns before the write ends).
- **Row 13:** the pin read back after a load with its check valid.

Rows 6 (a new game) and 10 (`saveID` against a delete) are still open.

## Open questions

1. ~~Is `visitID` per launch or per load?~~ Per game run (session 15). Does a load keep `pointOfNoReturnId`? per launch or per load (rows 1 and 2), and does a load keep `playthroughID` and `pointOfNoReturnId` as described?
2. Does the facts table reset on a new game, and on New Game Plus-style mods (rows 6 and 7)?
3. ~~At which load point are facts readable (row 3), and does a death reload run the session events (row 5)?~~ From the gate's opening (`player_attach`); yes (session 15).
4. ~~Which save hooks fire for autosaves and quick-saves (row 4)?~~ `BeforeSave` and `AfterSave` for every kind, and a fact written in `BeforeSave` reaches the file (session 15). Codeware raises them from its engine game system's save steps with no filter by save kind or caller; `IsRestored()` means "loaded from a save" and `IsPreGame()` "the main menu's world" ([events §9](game-events.md#how-codeware-raises-the-session-events), [source]).
5. ~~What happens to a removed mod's persistent fields (row 11; also the third open question in [save files](save-files.md#open-questions))?~~ They are dropped harmlessly (session 15).
6. Is the metadata `facts` list fixed by the engine, or can a mod's fact join it?
7. What is `saveID` (row 10), and what is the gap `playthroughTime` minus `playTime`?
8. ~~Can the plugin wrap the delete path of the save menus (row 9)?~~ Yes, the Load menu's (session 15); the overwrite path is still unwrapped.

## Sources

- **The game's 2.31 scripts** (`final.redscripts`, SHA-256 `2119046f…ee86`, decompiled with redscript-cli 0.5.31): `loadGameMenu.script` (`SaveMetadataInfo`), `saveGameMenu.script`, `singleplayerMenu.script`, `deathMenu.script`, `settingsMain.script`, `core/systems/playerSystem.script` (`OnGameRestored`), `core/systems/scriptableSystem.script` (`OnRestored`, `WasRestored`), `orphans.script` (`inkISystemRequestsHandler`, `inkSaveType`, `inkSaveStatus`, `LatestSaveMetadataInfo`, `QuestsSystem.SetFactStr`).
- **167 private saves' `metadata.9.json`**, copied to scratch and read for structure only; no names, paths, values or identifiers are kept.
- **GameSession.lua 1.4.5** (Copyright 2021 psiberx), as vendored in the studied XUtils 1.0.2 and BetterFuelSystemReloaded 1.6.0. Technique only; no code is used.
- **AI NPC Cyberpunk Mod 0.2.7** (Alystria AI and contributors): `fact-identity.lua`, `save-identity.lua`, `knowledge-state.lua`. Technique only.
- **RPG Progression System 1.0.3** (`RPS_System.reds`, `RPS_Tweaks.reds`) and **Night City Allies 1.6.10** (`Persistence/`, `Migration/Migrations.reds`): their persistent systems and migration code. Technique only.
- **Codeware wiki**, "Callback system" (read 22 October 2026): the `Session/*` events and the `BeforeSave` guarantee.
- **Codeware source** (psiberx and contributors), commit `a652bbb`, read 23 October 2026: `src/App/Callback/CallbackSystem.cpp` and `CallbackSystem.hpp` (the session events are raised from the callback system's own engine game-system steps, `OnBeforeGameSave` and `OnAfterGameSave` among them; `IsRestored` is set by `OnGameLoad`), `Controllers/PlayerSpawnedHook.hpp` (`Session/Ready` on a fresh session). Detail in [events the game emits §9](game-events.md#how-codeware-raises-the-session-events).
- **Modding Docs** `a54b0873`: `for-mod-users/user-guide-troubleshooting/README.md`.

Related: [save files](save-files.md) · [events the game emits](game-events.md) · [runtime access](runtime-access.md) · [quests and story](quests-and-story.md) · [Story Engine runtime requirements](../research/story-engine/runtime-requirements.md).
