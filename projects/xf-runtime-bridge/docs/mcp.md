# The XF Runtime Bridge MCP server

The XF Runtime Bridge MCP server lets an AI client drive Cyberpunk 2077 while you play: look at what the game is doing, set up photo mode, frame and light V, change creator options, take and judge screenshots, ask you a question inside the game and wait for your answer. Everything it can do is listed in the generated [tool reference](mcp-reference.md). This guide covers what it is, how to install it, how it keeps your game safe, how you answer from inside the game, a worked session, troubleshooting and the current limits.

**Status: test builds only.** The server and the bridge are built from source and run in a dedicated test profile. They are not part of an XF Studio release yet. Many of the commands behind the tools have been used in the game through the bridge's command-line client, which runs the same commands; the MCP layer itself is proven offline (see [what is proven where](#what-is-proven-where)).

## Contents

- [What it is](#what-it-is)
- [What an AI client can do with it](#what-an-ai-client-can-do-with-it)
- [Installing it](#installing-it)
- [The safety model](#the-safety-model)
- [Answering from inside the game](#answering-from-inside-the-game)
- [A worked session](#a-worked-session)
- [Troubleshooting](#troubleshooting)
- [Current limits](#current-limits)

## What it is

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) is an open standard that lets an AI client, such as Claude Code or Claude Desktop, call tools that a local program offers. XF Runtime Bridge is XF's own connection into the running game: a small RED4ext plugin with redscript, Cyber Engine Tweaks (CET) and TweakXL parts, which opens a local, token-protected pipe while the game runs. The MCP server is a small program your AI client starts. It translates each tool call into a bridge command and answers with plain results.

```
AI client  --MCP over stdio-->  XF MCP server  --local named pipe-->  XF Runtime Bridge (in the game)
                                     |
                                     +--> screenshots of the game window (no bridge needed)
```

The server has no commands of its own. It publishes the bridge's command catalogue (`tools/api/catalogue*.ts`), the same list the command-line client and the scripted-session runner use, so a command added to the catalogue appears in every frontend at once, and the [tool reference](mcp-reference.md) is regenerated from it. It is built on the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (MIT).

The Studio and the bridge are XF's base layer: deep integration that works with the vanilla game and the common frameworks, and never reshapes anyone's mod setup. A larger, opt-in overhaul is a separate, later direction ([vision](../../../docs/vision.md)).

## What an AI client can do with it

The tools fall into areas, each with its own section in the reference:

| Area | Examples |
|---|---|
| [Connection, session and answers](mcp-reference.md#connection-session-and-answers) | `bridge_ping`, `game_status`, `game_wait`; ask the player with `ui_message` and wait for the answer with `session_wait`; follow the session with `session_log`; hand the game to the player with `session_handover` |
| [Photo mode](mcp-reference.md#photo-mode) | Open it with the player's own key (`photo_open`), frame V automatically (`photo_frame`), set the camera, lights, expression, pose and scene rows, hide the menu for a clean shot |
| [Appearance screen](mcp-reference.md#appearance-screen-character-creator) | Read V's creator options, open the creator from normal play, change an option by its on-screen label, confirm or back out |
| [Player](mcp-reference.md#player) and [behaviours](mcp-reference.md#behaviours) | Read V's state and her status (`player_status`: health, level and street cred, money, wanted level, vehicle, an inventory summary, the scanner); teleport with ground checks, turn her view, crouch; routines that run in the game at frame rate (a turntable, a smooth look, a glide along a walkable path) |
| [World](mcp-reference.md#world) | The clock, a freeze, the weather, streaming and ground probes; quest facts in a batch (`world_facts`, with a main-story preset) and V's district (`world_district`) |
| [Wardrobe, clothing and cyberware](mcp-reference.md#wardrobe-clothing-and-cyberware) | Read what V wears; equip and unequip through the game's own requests (off unless explicitly allowed) |
| [XF Finish Showroom](mcp-reference.md#xf-finish-showroom) | Mannequin heads wearing XF makeup presets, with light rigs, for close-up finish checks |
| [NPC direction](mcp-reference.md#npc-direction) | Bring in XF's own passers-by (never saved), walk them up to V, give them lines, a gaze, a face and dialogue choices whose pick comes back to `session_wait`, run a short scene written as data (`npc_scenario`); stand-ins that can be shot, spawns out of V's sight and a release that waits until she can't see them (the `+npc` branch build only) |
| [Live direction](mcp-reference.md#live-direction) | Bring props, vehicles and lights in (never saved), change doors and vehicles, play sounds and a vehicle's radio, show a message toast or ring a real call from a contact the player has, put an XF quest in the HUD's tracker, show the game's own banners and quest toasts, and arm watchers that run short command lists inside the game without the agent (`game_digest` reads the lot in one call); the `-writes` build only, with Codeware for spawning |
| [Capture and the agent's view](mcp-reference.md#capture-and-the-agents-view) | Screenshots with named crops, re-crops, bursts for flicker checks, contact sheets; `scene_report`, the agent's own view of the shot (where each subject sits in the frame, whether it is blocked, which lights reach it) with pre-capture checks that refuse a bad shot |
| [Saves](mcp-reference.md#saves) | List saves, make a new manual save, load one |
| [Overlay and in-game UI](mcp-reference.md#overlay-and-in-game-ui) | The game's UI state, the XF overlay's state, placing the XF panel |
| [Autonomous input and choice tests](mcp-reference.md#autonomous-input-and-choice-tests) | Explicit 0.8.13 autonomous candidate: bounded XF hub actions, photo exit attempts and rendered CET Save anyway activation. Native engine input remains unavailable pending R1 |

Typical uses: preparing a photo-mode shot and comparing it with an XF Studio preview, checking a makeup finish under several lights, stepping through creator options and capturing each, and running an in-game test session where the player only watches and answers questions.

## Installing it

### Source recorder (0.8.14)

Only the explicit autonomous `-writes` build with `allow_test_hooks=true` exposes `test_record_start`, `test_record_read` and `test_record_stop`. Start selects up to ten channels: `v`, `actors`, `camera`, `subtitles`, `voice`, `face`, `ui`, `contacts`, `supervisor` and `incidents`, up to 16 returned actor handles, a 10 Hz target, a duration (at most 1800 s) and a byte cap (at most 512 MiB). It reads the source on 100 ms game-update deadlines, independently of the 4 Hz NPC status cache. Actual/valid per-channel rates, age, largest gap, missed deadlines and drops are reported. A late update takes one fresh sample and counts missed deadlines; it never invents catch-up samples.

**Declared incidents (0.8.21, the same build).** The game raises almost none of the Story Engine's incident kinds, so the engine stages its own with XF actors and declares them: `incidents_declare {id, kind, roles, at, ttl_s}` (roles maps actor handles `a1`... to the engine's own role names; V and picked passers-by are refused; id, kind and roles are kept exactly and checked as safe ASCII text) opens an incident at once and answers our `inc-N` beside the engine's id. Anything the game raises that names one of its actors joins it; V's sight of its actors is sampled twice a second (three a second accepted, at most four declared incidents) so a silent staging can be *saw*, and shout or shot stimuli give *heard*. `incidents_close {id}`, the TTL (simulation seconds), a kill, a load, a handover or the taps going off ends it: exactly one `witness.report` with `declared {id, kind, roles}`, a `witness.gap`, or a `witness.unwitnessed` event with the reason (`no_samples`, `actors_missing`, `no_view`, `out_of_range`, `not_in_view`, `occluded`, `unchecked`). `npc_spawn` and `npc_substitute` take `incident` and `incident_role`. `game_catchup`'s `incident_summary` lists declared reports and the unwitnessed ones. Passive. The rules are in the [knowledge page](../../../knowledge/game-events.md#declared-incidents-bridge-0821).

**What V witnessed (0.8.20, the same build).** `incidents_list` reads the incidents the game's own systems raised near V (a theft, an assault, an accident, a street fight, a police stop, gunfire, or other) with the people in them, where, when and how V perceived each: saw (a person other than V in the camera's view within 80 m with no static geometry on the ray), heard (V inside the stimulus' own radius); was told is not sensed. An incident V perceived becomes one `witness.report` when it closes: in `test_events`, in `session_log`, in the optional recorder channel `incidents` (a tenth channel; not a default) and in `game_catchup`'s `incident_summary`. Passive and read-only; `tap: false` switches the observation off. The rules and bounds are in the [knowledge page](../../../knowledge/game-events.md#13-incidents-what-v-witnessed-bridge-0820).

Read with the returned `run` and your last durably saved `since`; pages contain at most five records. Stop uses the emergency control pipe. The bounded native owner writes private 1 MiB JSONL chunks and an atomic final manifest under `<runtime>/recordings/<session>/run-<id>/`. Load, disconnect, kill and unload stop it, with the file writer draining independently of the transport. `tools/testing/recording.ts:recordSources` streams a second private copy into a new directory, records SHA-256 chunk hashes and bounds the host/QPC clock offset by request round-trip time. If kill closes the pipe, that tools copy says incomplete; use the native manifest after its writer finishes. Never silently rearm the bridge to drain it.

Every source row includes its run/session/world identity, sequence, game-update tick, QPC acquisition interval, validity and read age; simulation time is explicitly unavailable. Camera basis/FOV/aspect and fresh actor entity/position/yaw/AI-command/prepared state are source observations, not final rendered or audible evidence. The recorder does no inventory or whole-world scan. Runtime cadence and perturbation remain unverified.

The optional `subtitles`/`voice` channels add event-driven records to this same ring and file stream. The subtitle channel reports `line.requested`, `line.hidden`, `line.delivered`, `line.accepted`, `line.widget_created`, `line.widget_bound`, `line.widget_state` and `line.widget_removed`. Each line carries CRUID, text/type/speaker; real widget callbacks add a session-local widget/controller identity, actual bound ink text, effective visibility and callback geometry (not settled rendering). The source's three immediate listeners and each consumer's delayed handles/controller/widget counts are exposed by `tap.coverage` heartbeats at 1 Hz. A maximum of 16 weak controller refs and 64 entries per notification bound the adapter; truncation, malformed/oversize native ingress and contention invalidate completeness. Codeware is required for taps; missing Codeware is explicit invalid coverage.

The voice channel records `voice.requested` for `GameObject.PlayVoiceOver`, plus reaction-look-at, squad and AI caller context. Request triggers are not selected dialogue identities, Wwise events, completion or audible barks. Native Wwise hooks are deferred for separate ABI/thread/lifecycle commissioning using the R2 study. `tools/testing/subtitles.ts:checkSubtitleRecording` consumes a fully drained recording and a QPC interval plus expected text/type/entity/minimum reading duration. It checks source request, actual widget binding/removal and lifetime, source/controller listener coverage and no covered greeting request; incomplete evidence is INCONCLUSIVE. The result says `audible_proof:false` and `rendered_proof:false`.

Prepared runtime checks (coordinator supplies the exact candidate/profile): warm up with a known subtitle while the live gate is open to discover both controllers, then record `subtitles` and `voice` before N3, keep recording through the full question/read/hide/depart interval and one trailing heartbeat, then stop/drain. Check three source listeners, one Subtitles and one Chatters controller with three delayed handles each, a single widget creation/binding/removal for the question, correct actual text/type/speaker and the minimum reading interval. Capture a known positive script VO request before the N3 observation interval; the oracle requires this control before interpreting greeting absence. Compare per-line counts on a repeated question and an idle interval for flood; repeat attach/detach/load and verify no duplicated listeners or stale controller identities. Collect achieved rates, drops, frame/cost comparisons and private files. The game has not yet run these taps.

Run `bun tools/lint-redscript.ts --natives-only` for the native contract without a game bundle. The normal/default/diagnostic/writes sets omit recording natives and adapters; the explicit autonomous writes set includes them. `stageVariant` repeats exact-name/build-flag validation on all staged `.reds`, including probes, so module-prefixed globals fail before launch.

### Input and choices candidate (0.8.13)

**[source]** This candidate is separate from normal default, diagnostic and writes packages. Build with `XFB_AUTONOMOUS_TEST_HOOKS=ON` (and `XFB_ENGINE_INPUT_TESTS=ON` for the engine-input gate), and package only with `--autonomous-tests`. It requires `allow_test_hooks=true`, `allow_writes=true`, the relevant write classes and an expiring `test_input_arm` run bound to the current context/world/connection. The normal packages omit the autonomous scripts and CET module; a test DLL is rejected outside that explicit candidate. The current 0.8.21 test build registers 36 natives; normal builds register 27.

**[source]** `test_npc_choice` uses the XF hub's existing action handler: select-only returns a highlight, and commit waits for the matching `npc.choice`. `test_photo_exit_attempt {route: "event"}` queues the game's exit event; `route: "callback"` is a comparison at the controller. This covers the photo exit/hold callback path, **not physical Esc delivery**. With a real changed photo option, modal on must hold the exit, and modal off must expose the game's confirmation token. `test_ui_activate` consumes one token through the real visible settled CET button path; CET must already be open. Activation/queue acknowledgements do not prove a save: require one `save {via: "save_anyway", ok: true}`, one settled new slot and the engine/bridge lock read-back. Never replay an uncertain activation. The existing `game_save {override_lock: true}` policy is unchanged, pending RB-226; this is no claim of a no-agent-bypass policy.

**[source]** `test_input_state` includes `engine_input`, `selection` and `cleanup_pending`. A release failure keeps ownership and prevents a new run or resumption of the cancelled job. `test_input_pulse` and `player_choice_select` additionally require the `act` class and the engine-test build flag, and currently refuse `input_unavailable`. Receiver lifetime, virtual implementations, physical overlap and load-safe neutralisation remain unknown; real offer eligibility and dedicated-action semantics are also uncertified. `LastAttemptedChoice` has no hub ID: a fresh successful attempt can be correlated with an observed offer, but cannot establish universal scene/hub identity.

**[hypothesis]** The [Borg-mode session card](../../../research/runtime/runtime-bridge-test-card.md#input-and-choices-borg-mode-session) prepares four consumer rows and the separate R1 read-only evidence row, using schema-2 [session assertions](../tools/testing/assertions.ts). `input_probe` is read-only RTTI inventory; **no receiver-lifecycle recorder is shipped**. IC5 needs an externally captured, hash-pinned private native trace. Its assertion checks evidence completeness and context pairing, never enables dispatch or approves an ABI. Missing instrumentation is BLOCKED/NOT RUN; incomplete trace evidence is INCONCLUSIVE. No pulse or test-input native may be used to obtain that trace. Source basis and limits: [input and choices](../../../knowledge/input-and-choices.md).

### What you need

- **Windows**, Cyberpunk 2077 **2.31**, and the frameworks the bridge is built against: RED4ext 1.30.0, redscript 0.5.31 and Cyber Engine Tweaks 1.37.1; Codeware 1.20.5 and TweakXL 1.11.4 or newer for the features that say so. The [bridge README](../README.md#versions) has the details. XF never installs, updates or replaces these; if one is missing or old, the tools say which.
- **The bridge mod**, built from this repository ([Build and check](../README.md#build-and-check)) and staged into a **dedicated test profile** in your mod manager, never your main profile. It comes in three packages:
  - the default package keeps the bridge off;
  - `-diagnostic` switches it on read-only;
  - `-writes` also allows changes, for the test profile only.
- **[Bun](https://bun.sh/) 1.4.2** and this repository checked out. Install the server's one dependency once:

  ```powershell
  cd PATH_TO_REPO/projects/xf-runtime-bridge
  bun install --frozen-lockfile
  ```

`PATH_TO_REPO` stands for wherever you checked out the repository. Use forward slashes in the paths below, including on Windows.

### Claude Code

```powershell
claude mcp add xf-runtime-bridge -- bun PATH_TO_REPO/projects/xf-runtime-bridge/tools/mcp-server.ts
```

Add `--scope user` after `add` to have it in every project. Start a new Claude Code session and the `xf-runtime-bridge` tools appear; `/mcp` shows the server's status. To start with looking only:

```powershell
claude mcp add xf-runtime-bridge -- bun PATH_TO_REPO/projects/xf-runtime-bridge/tools/mcp-server.ts --read-only
```

### Other MCP clients

Most clients take a stdio server as a command plus arguments. In the common `mcpServers` form (Claude Desktop's configuration file, a project `.mcp.json`):

```json
{
  "mcpServers": {
    "xf-runtime-bridge": {
      "command": "bun",
      "args": ["PATH_TO_REPO/projects/xf-runtime-bridge/tools/mcp-server.ts", "--read-only"]
    }
  }
}
```

Other clients put the same command and arguments in their own format. If the client can't find `bun`, give its full path as the command.

### Options

| Option | Effect |
|---|---|
| (none) | Every tool is listed; the game's own settings still decide what may change |
| `--read-only` | Observe through a bounded reader connection; read/control tools, with native refusal for exclusive queries and recorder start |
| `--allow read,write-photo,…` | Only the named [permission classes](mcp-reference.md#permission-classes); the kill switch is always included. Can't be combined with `--read-only`, and an empty list is refused |
| `--no-inline-images` | Screenshots come back as file paths only, without a preview image |

A tool withheld by these options isn't listed at all, so the AI client never sees it.

## The safety model

The bridge is built so that a mistake, a confused model or a crash can't damage your game, your saves or your mod setup. The full model, with the evidence for each rule, is in the [bridge design](../../../research/runtime/runtime-bridge-design.md#4-safety-model).

**Off unless you switch it on.** The default package opens no connection at all. The `-diagnostic` package opens one that can only look.

**Two locks on every change.** The MCP server can withhold whole classes of tools (`--read-only`, `--allow`). Separately, and finally, the bridge inside the game refuses every change unless its `config.ini` says `allow_writes = true`, and then each class unless it is listed:

| Class | What it can change | Allowed in |
|---|---|---|
| `read`, `notify`, `control` | Nothing in the game (messages to the player; stopping or pausing the bridge's own work) | Every build that has the bridge on |
| `write-photo`, `write-world`, `write-character` | Photo mode; the clock, a freeze, the weather, XF map pins; the appearance screen | The test profile's `-writes` build |
| `write-save`, `write-showroom`, `write-player` | A new manual save or a load; XF Finish Showroom's test heads; V's position, view and stance | The `-writes` build, listed by name |
| `write-npc` | XF's own actors, the NPCs it picks near V, their lines and the dialogue choices it shows | The `-writes` build (0.8.8 on), listed by name |
| `write-dm` | Props, vehicles and lights brought in, doors and vehicles changed, sounds, a message toast and a real call, a tracker with XF's words, the game's banners, watchers with micro-actions | The `-writes` build (0.8.12 on), listed by name; its scripts ship in that package only |
| `write-inventory` | V's clothing and cyberware | Off in every build unless the `-writes` build is made with `--allow-inventory` |
| `act-player` | Irreversible actions for V (dialogue, devices, consumables) | Reserved: no tool uses it |

**The test profile.** The `-writes` build is only ever staged into a dedicated test profile with a disposable test save. A session starts with a fresh manual save and ends by loading it, so nothing the bridge did stays in your playthrough.

**Every change can be undone.** Each change answers with an `undo`: the exact command that puts back what it changed (or a plain note when there is nothing to put back). Each tool's undo is in the reference. The session's event stream (`session_log`) records every change with its undo, every refusal and every note.

**The kill switch.** `bridge_kill`, the bridge's own stop key in the game (Ctrl + Shift + End by default, `[ui] kill_key` in `config.ini`, changed on the XF Runtime Bridge window's Keys section; it works in play, photo mode, menus and loading screens while CET's overlay is closed), **Stop the bridge** in the XF Runtime Bridge window, a CET hotkey you bind, or a `KILL` file beside the bridge's session file. Each one stops the bridge at once and cancels anything still queued, then puts back what it left on: a frozen world, a hidden photo-mode menu, a held weather, V's cyberware and wardrobe, the effects it put on V, its showroom heads and pins, and every NPC it directs (its actors removed, lines and dialogue choices taken down, gazes and faces given back). After that nothing reaches the game until you press **Reconnect** in the XF Runtime Bridge window or restart the game. The kill switch is always available, in every MCP configuration.

**Pause and handover.** **Pause changes** in the XF Runtime Bridge window refuses every change until you resume. An AI client can also hand the game to you (`session_handover`): it stops its routines, gives V back, releases every NPC it directs and everything the live-direction toolkit holds (doors and vehicles put back, spawned things removed, a call ended, the tracker taken down) and refuses changes until `session_resume`. The pause releases the same, and so do the kill switch and loading a save.

**Saves are protected.** Nothing saves the game except `game_save`, which makes one new manual save and never overwrites one. From the bridge's first change until a save is loaded, the bridge holds its own save lock:
- `game_save` refuses (`bridge_save_lock`) unless told to override it;
- it also refuses while the bridge still holds something a save would keep (`bridge_effects_active`);
- your own saves in the game are refused too; from 0.8.7 the status surface then says why ("XF Runtime Bridge is holding saves because of a test change…"), and the XF Runtime Bridge window offers **Save anyway**, which makes one manual save past the lock on your say-so (the test profile's `-writes` build only; no tool can ask for it).

Loading a save (`game_load`) discards progress, so it needs `discard_unsaved: true`.

**One key, nothing else.** The only input the tools ever send is your own photo-mode key, only to the game's window, only while that window is already in front and the game says photo mode is allowed.

**Local only.** The pipe accepts only processes of your Windows user on this machine, with a new key each game session. It is not reachable from the network or from web pages. The server talks to its client over stdio and opens no network port.

**Your mod setup is never touched.** The bridge and its tools never install, replace, disable or reorder your mods or frameworks. A missing framework is reported plainly (for example `codeware_missing`) with where to get it.

**What leaves your machine.** XF itself sends nothing anywhere. Your AI client, however, passes every tool result (game state, screenshots, file paths) to the model service it uses. Screenshot answers include the full path of the saved file on your machine.

## Answering from inside the game

A session doesn't need you at the keyboard of the AI client. The AI client asks with `ui_message` at `level: "ask"`, optionally with `choices` (one to four labels of up to 24 characters; one Done button by default). You see the question in two places:

- **On the game's screen**: in the **ink panel** (the game-style panel with the red edge, top left by default; needs Codeware) while the game shows its HUD and, from 0.8.6, inside photo mode's own menu while photo mode is open, where you can also click an answer (0.8.7: clicks there work; 0.8.6's were ignored); otherwise in the **XF box** (the small dark box with the yellow heading), in menus and wherever the ink panel can't show. Each answer has its key in front of it, as the game writes its own prompts: `[F6] Done` (F6, F7, F8 and F11 by default, `answer_keys` in `config.ini`). Press the key to answer without leaving the game. Only one status surface shows at a time, and none on a loading screen.
- **The XF Runtime Bridge window** in CET's overlay (test builds). It has a button per answer and a comment box for free text (Ctrl+Enter sends).

The ink panel inside photo mode's menu also reports to `session_log`: `ink_tree` (photo mode's menu and the XF layer under it, on each open and once laid out), `ink_pointer` (the pointer entering it, the camera's mouse taken or refused while a button is held, answer clicks) and `ink_input` (what it holds from photo mode, and when it gives it back). `ui_hud {layer: "hud"}` keeps the panel out of photo mode, so the XF box shows there instead. `ui_hud {modal: true}` holds photo mode's exit while it shows (0.8.7); photo mode's camera keys can't be held and keep moving the camera. The window's answer buttons name no key: CET takes the keyboard while its overlay is open.

One question shows at a time: a new question withdraws the one still waiting, and it stays on screen until you answer it, it is withdrawn or its time runs out. `session_wait` returns your answer (its label, and whether it came from a key or a button), or any comment you type. An answer you gave before the AI client started waiting still counts. **Mark this moment** in the XF Runtime Bridge window drops a marker into the session log, for "look at this".

## A worked session

A portrait check in photo mode, as an AI client runs it. Answers are shortened; each change also answers with its `undo`.

1. **Is the game there?** `game_status` → `phase: "gameplay"`, `allow_writes: true`.
2. **Ask the player.**

   ```json
   ui_message {"text": "Portrait check next: keep the game window in front. Ready?", "level": "ask", "choices": ["Ready", "Not now"], "seconds": 120}
   ```
   → `id: 7`. Then `session_wait {"message_id": 7}` → `answer: {"label": "Ready", "via": "ink_key"}`.
3. **Open photo mode.** `photo_open` presses the player's photo-mode key → photo mode is open.
4. **Frame V.** `photo_frame {"target": "face"}` turns V to the camera, centres the face and sizes it with a portrait lens → `converged: true`.
5. **Light her.** `photo_light_set {"light": 1, "on": true, "brightness": 40, "place": {"azimuth": 45, "elevation": 20, "distance": 1.2}}` puts light 1 in front and to V's left, aimed at her head.
6. **Look before shooting.** `scene_report` → V's face is wholly in frame, not blocked, and light 1 reaches it.
7. **Capture.** `photo_hud_hide`, then:

   ```json
   capture_screenshot {"region": "face", "expect": {"in_frame_margin": 0.05, "unoccluded": true, "lit_by": "photo", "max_clipped": 0.02}}
   ```
   The checks run before the shot and on its pixels afterwards; a failure refuses with `expectation_failed` and says why. The answer carries a preview image and the path of the full-resolution file.
8. **Let the player judge.** `session_handover {"note": "Judge the lid highlight"}` gives V back and pauses changes. The player looks, types a comment in the XF Runtime Bridge window, and `session_wait` returns it. `session_resume` takes the game back.
9. **Leave.** `photo_exit`. At the end of a test session the AI client loads the save the session started from (`game_load` with its `name`, or `latest: true` when nothing was saved since, always with `discard_unsaved: true`), so nothing the session changed stays.

## Troubleshooting

**The tools don't appear in the client.** Restart the client after registering the server (in Claude Code, `claude mcp list` shows whether it started). If it failed to start, run the same command in a terminal: a missing `bun` means giving its full path, and a missing module means running `bun install` in `projects/xf-runtime-bridge`. A tool withheld by `--read-only` or `--allow` isn't listed; the client answers that there is no such tool.

**"The game bridge isn't running"** (`no_bridge`). The game isn't running, the bridge isn't enabled in this profile (`[bridge] enabled = true` comes with the `-diagnostic` and `-writes` packages), or the game is still starting: wait for the main menu. Screenshots still work without the bridge.

**Busy** (`bridge_busy`, `session_running`, `busy`, `rate_limited`, `timeout`).
- The main pipe takes one writer at a time. Observer clients use `--read-only` and the separate bounded pool; the default MCP and CLI remain writers. A second writer may still get `bridge_busy`. Reader requests share aggregate pacing and may be retried while writer work has priority.
- The emergency controls (`bridge_kill`, `player_stop`, `behave_stop`, `session_handover`, `session_resume`) go on a second pipe of their own and never wait behind other calls, from any process.
- While a scripted session runs, writer MCP processes stay off the bridge (`session_running`). Reader MCP processes can observe independently; screenshots and the kill switch still work.
- The rest mean the game was momentarily too busy. Nothing was changed; try again. `timeout_after_start` is the exception: the change may have happened, so check first.

**Refused.** A refusal always says what happened and the one next step, and a refused change changes nothing. The usual ones:

| Code | Meaning | Next step |
|---|---|---|
| `writes_disabled` | This build doesn't allow changes | Use the test profile's `-writes` build |
| `write_class_disabled` | This kind of change isn't listed in `config.ini` | Expected for inventory until it is allowed |
| `writes_paused` | Changes are paused in the XF Runtime Bridge window | Resume them there |
| `handed_over` | The game is handed to the player | `session_resume` |
| `killed` | The kill switch was used | **Reconnect** in the XF Runtime Bridge window, or restart the game |
| `game_loading` | A save is loading | `game_wait` for `gameplay` |
| `not_in_photo_mode`, `not_in_character_menu`, `not_in_gameplay` | Wrong place for this tool | Open photo mode or the creator first, or close menus |
| `bridge_save_lock`, `bridge_effects_active` | Saving would keep the bridge's changes | Load a save, or lift the effects (`player_stop`) |
| `not_foreground` | `photo_open` won't press a key while another window is in front | Bring the game window forward |

Every code, with its exact wording, is in the reference's [refusal codes](mcp-reference.md#refusal-codes). The correlation id in each answer (`cid`) matches the bridge's log (`red4ext/logs/xfruntimebridge-*.log`) and the tools' own log (`projects/xf-runtime-bridge/logs/`).

## Current limits

- **Test builds only.** The bridge is built from source and staged by hand into a test profile; no XF Studio release carries it yet. Hosting the same tools inside the XF Studio desktop app, behind an off-by-default switch and a consent screen, is the [planned direction](../../../research/backlog/ai-integration-mcp.md).
- **Windows and game 2.31 only.** The plugin declares 2.31, so RED4ext skips it after a game patch until it is rebuilt.
- **Stdio and connection roles.** Each server process serves one AI client. Default processes use the exclusive writer; `--read-only` processes use the observer pool. Emergency controls have their own pipe.
- **Opening photo mode needs the game window in front.** Every other tool works with the game in the background.
- **Inventory changes are off** until explicitly allowed, and `act-player` has no tools yet.
- **The senses (0.8.8, checked in session 15; 0.8.9 fixes two reads):** `world_facts`, `world_district`, `player_status` and `scene_read`'s `npc_detail` read the game's own scripts' state for the Story Engine and change nothing. On the main menu, between sessions and during a load the bridge's gate refuses them with `game_loading`; `game_not_ready` is the script's own answer when the gate is open but the game has no world. `player_status`'s inventory part reads at most 1500 stacks and says `truncated` when more were left. Session 15 compared them with the screens ([card](../../../research/runtime/runtime-bridge-test-card.md#session-15-checks-bridge-088)); 0.8.9's inventory counts only what the backpack shows (with `equipped` apart), and `heat.bar` follows the wanted bar itself. An NPC's entity template path is not among them: the scripts cannot turn a resource reference into a path.
- **Test probes (0.8.7, for session 15):** `test_events`, `test_save_identity` and `test_companion_probe` work only with the test profile's `-writes` build and are refused elsewhere (`test_hooks_off`). They come out, or move into XF Lab, once XF Core's first tracks land.
- **NPC direction ran first in session 15** (0.8.8) and again in session 16 (0.8.9); 0.8.11 stops a walk to V from leaving V as the facing target for the next walk (`npc_move`'s `face_v` is off unless asked) and holds a smile by sending it again; 0.8.10 turns an actor to her way before a walk away from V (`turns_first`), keeps a spawn asked for relative to V in V's sight (`moved_for_sight`, `no_visible_spot`), and a scene speaks only subtitles. 0.8.9 holds back an actor's own look-at reaction while it is directed, refuses choices at a device's screen, and adds `npc_say`'s `near_m`; body gestures (`npc_act`) are refused until the XF gesture carrier is built.
- **Live direction (0.8.12, offline only so far):** 26 commands in the `dm` class, none yet run in the game. A call can be started only from a contact the player's journal has unlocked (an unknown caller is refused); a light needs a template that already holds a light component (there is no light carrier yet); a radio device cannot be tuned to an exact station, only a vehicle's; the shard popup, the experience toast and a sound at a point are not built. Spawning and subtitle lines need Codeware. Every refusal says which of these it is.
- **Some tools are research tools** and say so in their descriptions (for example `photo_camera_place`, `pose_live_apply`, `input_probe`). A few are known not to work in the game yet: photo mode puts its camera back after `photo_camera_place`. The [test card](../../../research/runtime/runtime-bridge-test-card.md) tracks each command's in-game result.

### What is proven where

- **In the game.** The in-game test sessions so far drove the bridge through its command-line client, which runs exactly the same commands through the same command API as the MCP server. Across those sessions, these worked in the game:
  - photo mode opened by the player's key, framing, lights placed about V, the clock and exposure, expressions;
  - the creator opened from the street, options changed by label, backing out;
  - equipping items, loading saves, the showroom's heads;
  - questions answered from inside the game, one at a time, on one status surface at a time;
  - the kill switch's restore, and the bridge's own stop key in play, photo mode and the pause menu;
  - emergency controls from a second process while another waits on the main pipe;
  - world pins with the XF mark, and the staged showroom found without naming its build.

  The [knowledge page](../../../knowledge/runtime-access.md#6-what-agents-can-and-cannot-do-yet) and the test card have the record.
- **Offline only.** The MCP layer itself (tool list, permission flags, refusals, undo values, images) is tested end to end with the MCP SDK's own client against the bridge's self-test host, a simulated game, and against synthetic game windows for captures. Newer commands are proven offline until their row in the test card passes.

### Timeline between coordinator turns (0.8.14 autonomous candidate)

Start the recorder with the channels needed for the session. Call `game_catchup {run}` once, then `game_catchup {cursor}` with the complete returned cursor at the start of every turn. The compact result summarizes V's path, health, combat, heat, vehicle and busy changes, callback channels and session events plus the existing current digest; `detail:true` returns retained raw rows. Compact tails disclose omissions; ring loss, invalid sources and missed deadlines prevent complete coverage. Explicit contact receipts can alert; there is no commissioned physical collision sensor. Catch-up also replays the native writer’s existing private chunks, so a thinking turn can outlast the ring without losing retained source history. File replay is bounded to 8 MiB/1024 returned rows per call; when `more:true`, continue with its cursor. `now:false` skips the current digest and `replay_files:false` restricts observation to the ring. No extra event history is stored.

Timing-sensitive native photo/player/DM actions accept a small `when` object, e.g. `{phase:"gameplay",vehicle:false,combat:false,spawned:[7]}` or `{photo_mode:true}`. The native dispatcher compares live observations on each executing changing frame, refuses with `precondition_failed` and observed state in the error detail, and keeps restoration available. A multi-step action can refuse after earlier steps. External key routes cannot provide this guarantee. The normal package has no condition reader; `game_continue` remains unavailable until R8 commissioning.

`capture_arm` watches future recorder `data.event` or session kind using the same `CommandApi`. A bounded exact match selects an event; count (1–8), expiry (1–120 s) and source-timed delay (0–2000 ms) bound it. `capture_armed` returns up to 32 receipts with source-to-capture latency intervals and saved paths; `capture_disarm` cancels. What cancels an arm follows its trigger's feed: an arm without `channel` (a session event such as `dm.quest` or `npc.arrived`) is cancelled only by session-feed loss, and its receipts say what the recorder lost while it was armed (`recorder_loss_while_armed`); an arm that names a recorder channel is cancelled by recorder loss after arming (drops, a writer error, lost history, invalid samples on that channel, missed deadlines on a polled channel), with the exact reason. Source read/poll/queue delays are visible, so it is not a frame-exact trigger. Screenshot/burst keep overlays by default for consumer evidence; recrop reprocesses an existing image and cannot observe a fresh event. `toast.created` currently covers XF's MessengerNotification consumer only.

While recording, the tools retain the same main connection and send a bounded two-second heartbeat; ordinary idle-close and local wait release cannot stop it between turns. This lease ends at stop, source expiry, load, disconnect or close. Arms live in the persistent MCP/session-runner process. Closing tools, killing/handing over, expiry or incomplete coverage cancels; one-shot CLI invocation closes and cancels immediately. The main pipe retains one exclusive writer; a second writer gets `bridge_busy`. CLI/MCP `--read-only` or `CommandApi({ readOnly: true })` selects a bounded observer endpoint (default 3, config `max_read_only_connections`, range 0-8). Observers have independent explicit cursors and non-acknowledging recorder replay; disconnect never changes the writer generation or its leases. `npc.pick`, recorder start, `game.saves`, `game.options.read`, and `test.events` with `stims` remain writer-only in this safe subset. Other notify/write commands refuse `read_only_connection`; emergency cancellation/ownership controls remain available. Writer queue priority and reserved aggregate pacing preserve the existing game-frame task budget. See the [commissioning card](../../../research/runtime/runtime-bridge-test-card.md#concurrent-readers-0815); runtime latency and teardown remain uncommissioned. See [player control](../../../knowledge/player-control.md#session-lifecycle-and-timeline-control) and [R8](../../../knowledge/game-lifecycle-control.md).
