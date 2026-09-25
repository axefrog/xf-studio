# Runtime bridge: one-session test card

**Status: prepared, not yet run.** The first in-game check of the [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md) baseline ([design](runtime-bridge-design.md)). About 15 minutes of play. It needs no particular character or save, and nothing in it saves the game or changes the player.

## Before the session (coordinator)

1. **Build and package** from the branch under test:

   ```powershell
   cmake --build projects/xf-runtime-bridge/build --config Release
   bun projects/xf-runtime-bridge/tools/selftest.ts
   bun projects/xf-runtime-bridge/tools/package.ts
   ```

   Use `dist/xf-runtime-bridge-0.1.0-diagnostic.zip` (bridge on, writes off). Record its SHA-256 and the manifest's `commit` in the session notes.

2. **Create a dedicated MO2 profile.** Name it `XF Runtime Bridge diagnostic`.
   - Copy it from the diagnostic profile `XF Studio diagnostic 2026-09-25`. That profile already has the current ArchiveXL, TweakXL, Codeware and redscript entries; RED4ext 1.30.0 and CET 1.37.1 load from the game folder.
   - Add **one** new mod entry, `XF Runtime Bridge`, holding the zip's contents, and enable it only in this profile.
   - Place the entry with the documented [placement rule](../authoring/framework-version-check.md#mo2-placement-rule).
   - **Never** use or change the everyday profile. Don't install anything into the game folder, and don't touch framework entries.

3. **Check framework versions** with the read-only framework check. Expect RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1 and TweakXL 1.11.4; the bridge needs no other framework.

4. **Take a baseline capture:**

   ```powershell
   python tools/capture_session.py --label bridge-baseline-pre --profile "XF Runtime Bridge diagnostic"
   ```

5. **Clear the runtime folder.** Make sure `%LOCALAPPDATA%\XFStudio\runtime-bridge\` has no `session.json` and no `KILL` left over; delete them if present.

## During the session (maintainer)

Keep one PowerShell 7 window open in the repository root. Every command below is read-only.

| # | Do | Expect |
|---|---|---|
| 1 | In MO2, select **XF Runtime Bridge diagnostic** and launch the game as usual. Wait for the main menu. | The game starts normally with no redscript error pop-up. A small green **"XF bridge: listening (read-only)"** label appears at the top left once CET initialises its mods; note whether that is at the main menu or only after loading a save. |
| 2 | Run `pwsh -File projects/xf-runtime-bridge/tools/bridge-client.ps1 ping` | `OK   ping cid=ps-… {"plugin_version":"0.1.0","pong":true,"protocol":1,"sid":"<16 hex>"}` |
| 3 | Run `pwsh -File projects/xf-runtime-bridge/tools/bridge-client.ps1 smoke` at the main menu | `ping`, `bridge.info`, `game.version`, `game.state` and `layers.status` are `OK`. `game.version` shows `3.0.80.51928`. `player.position` is `OK` with `"available":false`. Note whether `layers.status` already lists `redscript`, `tweakxl` and `cet`. |
| 4 | Load any save. Stand still in the world, then run `smoke` again. | `player.position` gives `"available":true` with coordinates. `script.describe` returns `"has_player":true` and `"tweak_marker":1`. `layers.status` lists `redscript`, `tweakxl` (`protocolVersion=1`) and `cet`. |
| 5 | Open photo mode (normal key) and run `… bridge-client.ps1 call photomode.state`. Close photo mode and run it again. | `"active":true` inside photo mode, `"active":false` after closing. |
| 6 | Run `… bridge-client.ps1 call diag.write_probe` | `FAIL … writes_disabled`. This proves the write gate; nothing in the game changes. |
| 7 | Open the CET overlay. | An **XF Runtime Bridge** window shows the plugin version, game version, `Running` and the request count. |
| 8 | Only if the game runs in **borderless windowed** mode: run `pwsh -File projects/xf-runtime-bridge/tools/capture-window.ps1 -Name bridge-test` | A PNG appears under `projects/xf-runtime-bridge/captures/` showing the game (not black). Note which window mode was used. |
| 9 | **Kill switch.** In the CET overlay, Bindings tab, bind *"Kill XF Runtime Bridge"* to a spare key and press it. Then run `ping`. | The label turns red "XF bridge: killed". `ping` fails: "Could not open …" or no session file. |
| 10 | Quit to desktop normally. | The game exits cleanly, and `session.json` is gone from `%LOCALAPPDATA%\XFStudio\runtime-bridge\`. |

**If something goes wrong:**
- **Redscript error pop-up at start:** note or screenshot the text, close the game, and disable the `XF Runtime Bridge` entry in this profile. The coordinator reads `r6/logs/redscript_rCURRENT.log`.
- **Game crash:** disable the entry and send the newest `red4ext/logs/*.log` files (under MO2 they are in `overwrite/red4ext/logs/`).
- **Don't save during the session.** This profile shares the normal save folder, and nothing in the test needs a save.

## After the session (coordinator)

```powershell
python tools/capture_session.py --label bridge-baseline-post --profile "XF Runtime Bridge diagnostic"
```

Expected evidence, and the question each part answers:

| Log (MO2: under `overwrite/`) | Expected lines | Answers |
|---|---|---|
| `red4ext/logs/red4ext-<ts>.log` | `Loading plugin from '…XFRuntimeBridge.dll'…` and `XF Runtime Bridge (version: 0.1.0, author(s): XF Studio) has been loaded`; no "incompatible" warning | RED4ext accepted the plugin (API v1, SDK 1.0.0, runtime 2.31) |
| `red4ext/logs/xfruntimebridge-<ts>.log` | `evt=plugin.load … game_file=3.0.80.51928`, `evt=plugin.config … bridge.enabled=true bridge.allow_writes=false`, `evt=plugin.scripts … added_to_redscript=true`, `evt=bridge.listen pipe=\\.\pipe\xf-runtime-bridge-<pid>-…`, `evt=rtti.register_types phase=post_register natives=5`, `evt=game.state state=BaseInitialization event=enter` … `state=Running event=enter`, `evt=game.running_first_tick` | Load order, config, RTTI registration and state transitions |
| same file | `layer=redscript … evt=script.log XFBridgeSystem.OnAttach`, `evt=native.ping from=redscript cid=rs-attach`, `evt=layer.announce layer=redscript`, `evt=layer.announce layer=tweakxl detail=XFRuntimeBridge.Meta.protocolVersion=1`, `layer=redscript … PlayerPuppet.OnGameAttached replacer=false x=…` | Redscript compiled and runs; TweakXL data reached TweakDB; wrap and add methods work |
| same file | `layer=native cid=cet-1 evt=native.ping from=cet`, `evt=layer.announce layer=cet detail=onInit; CET v1.37.1`, `layer=cet … redscript DescribeJson: {…}` or a `not callable from CET` warning | CET calls natives; whether CET sees our redscript class (open question 2) |
| same file | `evt=bridge.client_connected client_pid=…`, `evt=bridge.request method=… access=read`, `evt=bridge.response method=… code=ok ms=…`, `evt=bridge.write_refused method=diag.write_probe`, `evt=bridge.killed reason=script:cet-hotkey`, `evt=bridge.listener_closed`, `evt=game.state state=Shutdown event=enter`, `evt=plugin.unload` | Audit trail, write gate, kill switch, clean shutdown |
| `r6/logs/redscript_rCURRENT.log` | The two `.reds` files from `red4ext/plugins/XFRuntimeBridge/Scripts` in the compiled list; `Compilation complete` | `scripts->Add` path works under MO2 |
| `red4ext/plugins/TweakXL/TweakXL.log` | `Reading "…xf_runtime_bridge.yaml"…` with no parse error | TweakXL loaded the data layer |
| `bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/xf_runtime_bridge.log` | `onInit cet=v1.37.1` and `native ping reply`; info lines may only be flushed at exit | CET layer ran |

Record the outcome in the [design page](runtime-bridge-design.md) (turn [unverified] rows into [runtime] with the capture ID) and in [knowledge/runtime-access.md](../../knowledge/runtime-access.md). Answer open questions 1–4 there.
