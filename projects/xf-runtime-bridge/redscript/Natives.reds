// Native globals implemented by XFRuntimeBridge.dll (RED4ext plugin, src/plugin/Natives.cpp).
//
// This file deliberately has no `module` line: redscript prefixes module names onto globals,
// and the plugin registers these under their plain names (as Codeware does for Print/ModLog).
// The whole Scripts folder is added to compilation by the plugin itself
// (sdk->scripts->Add), so these declarations never exist without the DLL that backs them.

public static native func XFBridge_Ping(layer: String, cid: String) -> String
public static native func XFBridge_Info() -> String
public static native func XFBridge_Log(layer: String, level: String, cid: String, message: String) -> Void
public static native func XFBridge_Announce(layer: String, detail: String) -> Void
public static native func XFBridge_Kill(reason: String) -> Bool
// The CET layer answers game.options.read's render options through these two (core/OptionsExchange.hpp).
public static native func XFBridge_OptionsWanted() -> String
public static native func XFBridge_OptionsReport(values: String) -> Bool
// The CET layer draws ui.message's lines under the CET line from this one (core/Messages.hpp).
public static native func XFBridge_Messages() -> String
// cc.open's pause-menu redirect asks the plugin what to do (core/Writes.hpp CreatorRedirect): "redirect",
// "foreign", "expired", "refused", "withdrawn", "none", or "" when it can't say (the pause menu then opens).
public static native func XFBridge_CreatorRedirect(state: String) -> String
// The script layer's lifecycle (core/ScriptLayer.hpp, bridge 0.5.2): "attach", "player_attach", "detach". The plugin
// calls into our scripts only between a session's player attach and its detach (session 5 crashed on a call made just
// after a detach, while a save loaded).
public static native func XFBridge_ScriptLayer(event: String) -> Bool
// Bridge 0.5.3, temporary test feature: the ink HUD panel's frame (core/InkUi.hpp): its settings, the bridge's state, the
// script gate and the ui.message lines as tab-separated records. The redscript overlay (XFRuntimeBridgeInk.reds) pulls it;
// the plugin never calls into scripts for the panel.
public static native func XFBridge_Hud() -> String
// Bridge 0.6: a note from inside the game into the session's event stream (core/Events.hpp), for a panel button; level
// info, warn, ask or done. Answers false when the plugin couldn't take it.
public static native func XFBridge_Note(level: String, text: String) -> Bool
// Bridge 0.6.1 (RB-86): whether the game's scripts are live now (the script gate alone), for the ink overlay's check on every
// tick before it queries the world.
public static native func XFBridge_Live() -> Bool
// Bridge 0.7 (session 7, in-game driving): the player answers the pending ask (id 0) or a given one with choice n (0-based),
// from the ink panel's keys or the CET window's buttons; answers {ok, message_id, choice, label} or {ok: false, why}.
public static native func XFBridge_Answer(id: Int32, choice: Int32, source: String) -> String
// A comment from the player into the session's event stream (the CET window's commentary box).
public static native func XFBridge_Comment(text: String) -> Bool
// The CET layer reports its overlay opening and closing (ui.state, the capture pre-check, the overlay host's yield rule).
public static native func XFBridge_CetOverlay(open: Bool) -> Bool
// Bridge 0.8 (the UI review): the ink panel reports the question it draws and whether it is on screen now, about five times a
// second, so the CET label shows only the status and the answer keys instead of the question a third time.
public static native func XFBridge_InkDrawn(id: Int32, shown: Bool) -> Bool
// 0.8.4: the kill key chosen in the XF Runtime Bridge window (CET): action get, set (key: a chord such as Ctrl+Shift+End) or
// reset; answers JSON with the key and what else may react to it. Saved to config.ini's [ui] kill_key.
public static native func XFBridge_KillKey(action: String, key: String) -> String
// Bridge 0.8.6: the panel inside photo mode's menu (XFRuntimeBridgePhotoPanel.reds). An event into the session's stream
// (kind ink_tree, ink_pointer or ink_input; data a JSON object as text); and whether a mouse button is held now (its hover
// guard: no hover is taken from photo mode's camera mid-drag).
public static native func XFBridge_InkEvent(kind: String, text: String, data: String) -> Bool
public static native func XFBridge_MouseHeld() -> Bool
// Bridge 0.8.7: the player's own save refused while the bridge's save lock held (ours: whether that lock is among the
// reasons), so the status surface says why; and the XF Runtime Bridge window's Save anyway, the player's say-so to save past
// the lock (the plugin offers it only where writes and the save class are allowed; it answers JSON, {started} or {why}).
public static native func XFBridge_SaveRefused(ours: Bool) -> Bool
public static native func XFBridge_SaveAnyway(source: String) -> String
// Bridge 0.8.7, test probes (the -writes package's redscript-probes; refused unless [bridge] allow_test_hooks): one record
// into the probe's own ring (test.events; kind a-z, 0-9, _ . : /; data a JSON object as text), and the probe's switches (bit
// 1 the hooks on, 2 the stim tap, 4 the save-identity probe's BeforeSave write armed).
public static native func XFBridge_Event(kind: String, data: String) -> Bool
public static native func XFBridge_ProbeFlags() -> Int32
// Bridge 0.8.9 (the Sol review, finding 3): world.pin's drawn_by, OR-ed natively under one lock: ORs bits into the pin's views
// and answers those before; bits 0 reads them, below 0 clears them (a new pin under a used id).
public static native func XFBridge_PinDrawn(pin: Int32, bits: Int32) -> Int32
