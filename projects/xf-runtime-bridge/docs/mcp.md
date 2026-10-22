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
| [Player](mcp-reference.md#player) and [behaviours](mcp-reference.md#behaviours) | Read V's state; teleport with ground checks, turn her view, crouch; routines that run in the game at frame rate (a turntable, a smooth look, a glide along a walkable path) |
| [World](mcp-reference.md#world) | The clock, a freeze, the weather, streaming and ground probes |
| [Wardrobe, clothing and cyberware](mcp-reference.md#wardrobe-clothing-and-cyberware) | Read what V wears; equip and unequip through the game's own requests (off unless explicitly allowed) |
| [XF Finish Showroom](mcp-reference.md#xf-finish-showroom) | Mannequin heads wearing XF makeup presets, with light rigs, for close-up finish checks |
| [Capture and the agent's view](mcp-reference.md#capture-and-the-agents-view) | Screenshots with named crops, re-crops, bursts for flicker checks, contact sheets; `scene_report`, the agent's own view of the shot (where each subject sits in the frame, whether it is blocked, which lights reach it) with pre-capture checks that refuse a bad shot |
| [Saves](mcp-reference.md#saves) | List saves, make a new manual save, load one |
| [Overlay and in-game UI](mcp-reference.md#overlay-and-in-game-ui) | The game's UI state, the XF overlay's state, placing the XF panel |

Typical uses: preparing a photo-mode shot and comparing it with an XF Studio preview, checking a makeup finish under several lights, stepping through creator options and capturing each, and running an in-game test session where the player only watches and answers questions.

## Installing it

### What you need

- **Windows**, Cyberpunk 2077 **2.31**, and the frameworks the bridge is built against: RED4ext 1.30.0, redscript 0.5.31 and Cyber Engine Tweaks 1.37.1; Codeware 1.20.5 and TweakXL 1.11.4 for the features that say so. The [bridge README](../README.md#versions) has the details. XF never installs, updates or replaces these; if one is missing or old, the tools say which.
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
| `--read-only` | Only tools that change nothing in the game: looking, messages to the player, and the kill switch |
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
| `write-inventory` | V's clothing and cyberware | Off in every build unless the `-writes` build is made with `--allow-inventory` |
| `act-player` | Irreversible actions for V (dialogue, devices, consumables) | Reserved: no tool uses it |

**The test profile.** The `-writes` build is only ever staged into a dedicated test profile with a disposable test save. A session starts with a fresh manual save and ends by loading it, so nothing the bridge did stays in your playthrough.

**Every change can be undone.** Each change answers with an `undo`: the exact command that puts back what it changed (or a plain note when there is nothing to put back). Each tool's undo is in the reference. The session's event stream (`session_log`) records every change with its undo, every refusal and every note.

**The kill switch.** `bridge_kill`, the button in the bridge's CET window, a CET hotkey you bind, or a `KILL` file beside the bridge's session file. Each one stops the bridge at once and cancels anything still queued, then puts back what it left on: a frozen world, a hidden photo-mode menu, a held weather, V's cyberware and wardrobe, the effects it put on V, its showroom heads and pins. After that nothing reaches the game until you press **Reconnect** in the bridge's CET window or restart the game. The kill switch is always available, in every MCP configuration.

**Pause and handover.** **Pause changes** in the bridge's CET window refuses every change until you resume. An AI client can also hand the game to you (`session_handover`): it stops its routines, gives V back and refuses changes until `session_resume`.

**Saves are protected.** Nothing saves the game except `game_save`, which makes one new manual save and never overwrites one. From the bridge's first change until a save is loaded, the bridge holds its own save lock:
- `game_save` refuses (`bridge_save_lock`) unless told to override it;
- it also refuses while the bridge still holds something a save would keep (`bridge_effects_active`).

Loading a save (`game_load`) discards progress, so it needs `discard_unsaved: true`.

**One key, nothing else.** The only input the tools ever send is your own photo-mode key, only to the game's window, only while that window is already in front and the game says photo mode is allowed.

**Local only.** The pipe accepts only processes of your Windows user on this machine, with a new key each game session. It is not reachable from the network or from web pages. The server talks to its client over stdio and opens no network port.

**Your mod setup is never touched.** The bridge and its tools never install, replace, disable or reorder your mods or frameworks. A missing framework is reported plainly (for example `codeware_missing`) with where to get it.

**What leaves your machine.** XF itself sends nothing anywhere. Your AI client, however, passes every tool result (game state, screenshots, file paths) to the model service it uses. Screenshot answers include the full path of the saved file on your machine.

## Answering from inside the game

A session doesn't need you at the keyboard of the AI client. The AI client asks with `ui_message` at `level: "ask"`, optionally with `choices` (one to four short labels; Ready, Yes and No by default). You see the question in two places:

- **The XF panel**, top-left over the game (needs Codeware). Each answer has a key beside it: F6, F7, F8 and F11 by default (`answer_keys` in `config.ini`). Press the key to answer without leaving the game.
- **The bridge's window in the CET overlay** (test builds). It has a button per answer and a comment box for free text.

The newest unanswered question stays pinned on screen until you answer it or its time runs out. `session_wait` returns your answer (its label, and whether it came from a key or a button), or any comment you type. An answer you gave before the AI client started waiting still counts. **Mark this moment** in the CET window drops a marker into the session log, for "look at this".

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
8. **Let the player judge.** `session_handover {"note": "Judge the lid highlight"}` gives V back and pauses changes. The player looks, types a comment in the CET window, and `session_wait` returns it. `session_resume` takes the game back.
9. **Leave.** `photo_exit`. At the end of a test session the AI client loads the save the session started from (`game_load` with its `name`, or `latest: true` when nothing was saved since, always with `discard_unsaved: true`), so nothing the session changed stays.

## Troubleshooting

**The tools don't appear in the client.** Restart the client after registering the server (in Claude Code, `claude mcp list` shows whether it started). If it failed to start, run the same command in a terminal: a missing `bun` means giving its full path, and a missing module means running `bun install` in `projects/xf-runtime-bridge`. A tool withheld by `--read-only` or `--allow` isn't listed; the client answers that there is no such tool.

**"The game bridge isn't running"** (`no_bridge`). The game isn't running, the bridge isn't enabled in this profile (`[bridge] enabled = true` comes with the `-diagnostic` and `-writes` packages), or the game is still starting: wait for the main menu. Screenshots still work without the bridge.

**Busy** (`bridge_busy`, `session_running`, `busy`, `rate_limited`, `timeout`).
- The bridge takes one client at a time. The MCP server lets go of the connection after 3 s without a command, so the command-line client can use it in between, but not at the same moment.
- While a scripted session runs, the MCP server stays off the bridge (`session_running`). Screenshots and the kill switch still work.
- The rest mean the game was momentarily too busy. Nothing was changed; try again. `timeout_after_start` is the exception: the change may have happened, so check first.

**Refused.** A refusal always says what happened and the one next step, and a refused change changes nothing. The usual ones:

| Code | Meaning | Next step |
|---|---|---|
| `writes_disabled` | This build doesn't allow changes | Use the test profile's `-writes` build |
| `write_class_disabled` | This kind of change isn't listed in `config.ini` | Expected for inventory until it is allowed |
| `writes_paused` | Changes are paused in the CET window | Resume them there |
| `handed_over` | The game is handed to the player | `session_resume` |
| `killed` | The kill switch was used | **Reconnect** in the CET window, or restart the game |
| `game_loading` | A save is loading | `game_wait` for `gameplay` |
| `not_in_photo_mode`, `not_in_character_menu`, `not_in_gameplay` | Wrong place for this tool | Open photo mode or the creator first, or close menus |
| `bridge_save_lock`, `bridge_effects_active` | Saving would keep the bridge's changes | Load a save, or lift the effects (`player_stop`) |
| `not_foreground` | `photo_open` won't press a key while another window is in front | Bring the game window forward |

Every code, with its exact wording, is in the reference's [refusal codes](mcp-reference.md#refusal-codes). The correlation id in each answer (`cid`) matches the bridge's log (`red4ext/logs/xfruntimebridge-*.log`) and the tools' own log (`projects/xf-runtime-bridge/logs/`).

## Current limits

- **Test builds only.** The bridge is built from source and staged by hand into a test profile; no XF Studio release carries it yet. Hosting the same tools inside the XF Studio desktop app, behind an off-by-default switch and a consent screen, is the [planned direction](../../../research/backlog/ai-integration-mcp.md).
- **Windows and game 2.31 only.** The plugin declares 2.31, so RED4ext skips it after a game patch until it is rebuilt.
- **Stdio and one client.** The server runs beside one AI client on the same machine, and the bridge takes one connection at a time.
- **Opening photo mode needs the game window in front.** Every other tool works with the game in the background.
- **Inventory changes are off** until explicitly allowed, and `act-player` has no tools yet.
- **Some tools are research tools** and say so in their descriptions (for example `photo_camera_place`, `pose_live_apply`, `input_probe`). A few are known not to work in the game yet: photo mode puts its camera back after `photo_camera_place`. The [test card](../../../research/runtime/runtime-bridge-test-card.md) tracks each command's in-game result.

### What is proven where

- **In the game.** The in-game test sessions so far drove the bridge through its command-line client, which runs exactly the same commands through the same command API as the MCP server. Across those sessions, these worked in the game:
  - photo mode opened by the player's key, framing, lights placed about V, the clock and exposure, expressions;
  - the creator opened from the street, options changed by label, backing out;
  - equipping items, loading saves, the showroom's heads;
  - questions answered from inside the game;
  - the kill switch's restore.

  The [knowledge page](../../../knowledge/runtime-access.md#6-what-agents-can-and-cannot-do-yet) and the test card have the record.
- **Offline only.** The MCP layer itself (tool list, permission flags, refusals, undo values, images) is tested end to end with the MCP SDK's own client against the bridge's self-test host, a simulated game, and against synthetic game windows for captures. Newer commands are proven offline until their row in the test card passes.
