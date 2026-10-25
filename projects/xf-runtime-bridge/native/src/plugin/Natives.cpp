// Global native functions for redscript and CET.
//
// Registered in the RTTI post-register callback the way RED4ext.SDK's
// examples/native_globals_redscript does (tag 1.0.0, Main.cpp:64-83): CGlobalFunction::Create,
// flags {isNative, isStatic}, AddParam/SetReturnType, CRTTISystem::RegisterFunction.
// Redscript declares them in Scripts/XFRuntimeBridge/Natives.reds; CET reaches them as
// Game.XFBridge_* (CET RTTIHelper::ResolveFunction searches global functions by short name).
//
// All of them run on the thread that calls them (the game's script thread). None of them
// touches gameplay objects; LifecycleMenu observes a scoped ink handle, the others use bridge bookkeeping. Each reads its
// parameters first (the script stack must always be consumed) and then runs its body inside
// a catch-all: an exception must never unwind into the game's script VM.

#include <RED4ext/RED4ext.hpp>
#include "plugin/HandlersInputChoices.hpp"
#include "plugin/Lifecycle.hpp"
#include "plugin/Supervisor.hpp"

#include <Windows.h>

#include <chrono>

#include "core/Win32.hpp"
#include "core/Writes.hpp"
#include "core/Recording.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

std::string ToStd(const RED4ext::CString& aText)
{
    return std::string(aText.c_str(), aText.Length());
}

std::string CleanLayer(const std::string& aLayer)
{
    // Layers name themselves; keep them short and plain for the log format.
    std::string out;
    for (const auto c : aLayer)
    {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
        {
            out.push_back(c);
        }
        if (out.size() >= 16)
        {
            break;
        }
    }
    return out.empty() ? "unknown" : out;
}

// Runs a native's body; logs and swallows anything it throws.
template<typename F>
void Guarded(const char* aNative, F&& aBody) noexcept
{
    try
    {
        aBody();
    }
    catch (const std::exception& e)
    {
        log::Error("native.failed", std::string("native=") + aNative + " what=" + e.what());
    }
    catch (...)
    {
        log::Error("native.failed", std::string("native=") + aNative + " what=unknown");
    }
}

// XFBridge_Ping(layer: String, cid: String) -> String
void Ping(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    RED4ext::CString layer;
    RED4ext::CString cid;
    RED4ext::GetParameter(aFrame, &layer);
    RED4ext::GetParameter(aFrame, &cid);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_Ping", [&] {
        const auto layerName = CleanLayer(ToStd(layer));
        const auto cidText = ToStd(cid);
        log::Info("native.ping", "from=" + layerName, cidText);

        if (aOut)
        {
            const auto reply = json{{"ok", true},
                                    {"sid", Get().session.sessionId},
                                    {"cid", cidText},
                                    {"from", layerName},
                                    {"plugin_version", XFB_VERSION_STRING}};
            *aOut = RED4ext::CString(SerializeJson(reply));
        }
    });
}

// XFBridge_Info() -> String (JSON)
void Info(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    Guarded("XFBridge_Info", [&] {
        if (aOut)
        {
            *aOut = RED4ext::CString(SerializeJson(InfoJson()));
        }
    });
}

// XFBridge_Log(layer: String, level: String, cid: String, message: String) -> Void
void LogFromScript(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, void*, int64_t)
{
    RED4ext::CString layer;
    RED4ext::CString level;
    RED4ext::CString cid;
    RED4ext::CString message;
    RED4ext::GetParameter(aFrame, &layer);
    RED4ext::GetParameter(aFrame, &level);
    RED4ext::GetParameter(aFrame, &cid);
    RED4ext::GetParameter(aFrame, &message);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_Log", [&] {
        Level parsed = Level::Info;
        ParseLevel(ToStd(level), parsed);
        log::Write(parsed, CleanLayer(ToStd(layer)), ToStd(cid), "script.log", ToStd(message));
    });
}

// XFBridge_Announce(layer: String, detail: String) -> Void
void Announce(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, void*, int64_t)
{
    RED4ext::CString layer;
    RED4ext::CString detail;
    RED4ext::GetParameter(aFrame, &layer);
    RED4ext::GetParameter(aFrame, &detail);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_Announce", [&] {
        const auto layerName = CleanLayer(ToStd(layer));
        const auto detailText = Sanitize(ToStd(detail), 512);
        Get().layers.Announce(layerName, detailText);
        log::Info("layer.announce", "layer=" + layerName + " detail=" + detailText);
    });
}

// XFBridge_Kill(reason: String) -> Bool   (kill switch for the CET hotkey)
void Kill(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString reason;
    RED4ext::GetParameter(aFrame, &reason);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_Kill", [&] {
        auto& state = Get();
        const bool hadBridge = state.bridge != nullptr;
        if (hadBridge)
        {
            state.bridge->Kill("script:" + Sanitize(ToStd(reason), 64));
        }
        else
        {
            log::Info("bridge.kill_ignored", "reason=bridge_not_enabled");
        }
        if (aOut)
        {
            *aOut = hadBridge;
        }
    });
}

// XFBridge_Note(level: String, text: String) -> Bool   (0.6: a note from inside the game into the session event stream,
// for a button in the CET panel or the XF HUD panel; core/Events.hpp). Works while the bridge is killed too: notes are
// the player's record, not a change.
void Note(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString level;
    RED4ext::CString text;
    RED4ext::GetParameter(aFrame, &level);
    RED4ext::GetParameter(aFrame, &text);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_Note", [&] {
        auto wanted = ToStd(level);
        if (wanted != "info" && wanted != "warn" && wanted != "ask" && wanted != "done")
        {
            wanted = "info";
        }
        const auto body = ToStd(text);
        if (body.empty())
        {
            return;
        }
        Get().events.Push("note", wanted, "game", body);
        if (aOut)
        {
            *aOut = true;
        }
    });
}

// XFBridge_Rearm(reason: String) -> String   (the CET panel's Reconnect after the kill switch)
// Asks the next Running ticks to re-arm the bridge with a new session (Main.cpp HandleRearm); answers
// {"requested":true} or {"requested":false,"reason":"..."} at once. Only an in-game action can do this:
// no pipe method re-arms, since the pipe is closed while the bridge is killed.
void Rearm(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    RED4ext::CString reason;
    RED4ext::GetParameter(aFrame, &reason);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_Rearm", [&] {
        auto& state = Get();
        // 0.8.6 (the UI review's P4): code for the window's plain copy; reason stays the log's detail.
        json answer{{"requested", false}};
        if (!state.config.bridgeEnabled)
        {
            answer["code"] = "off";
            answer["reason"] = "the bridge is off in config.ini ([bridge] enabled = false), so there is nothing to reconnect";
        }
        else if (!state.bridge)
        {
            answer["code"] = "not_started";
            answer["reason"] = "the bridge didn't start this session (see the plugin log); restart the game";
        }
        else if (!state.bridge->GetDispatcher().IsKilled())
        {
            answer["code"] = "already_running";
            answer["reason"] = "the bridge is already running";
        }
        else
        {
            state.rearmRequestedAt.store(state.runningTicks.load());
            state.rearmRequested.store(true);
            answer["requested"] = true;
            log::Warn("bridge.rearm_requested", "by=" + Sanitize(ToStd(reason), 64));
        }
        if (aOut)
        {
            *aOut = RED4ext::CString(SerializeJson(answer).c_str());
        }
    });
}

// XFBridge_PauseWrites(paused: Bool) -> String   (the CET panel's write switch)
// Pauses or resumes writes. It can only take access away: with allow_writes = false nothing changes,
// and resuming gives back exactly what config.ini allows.
void PauseWrites(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    bool paused = false;
    RED4ext::GetParameter(aFrame, &paused);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_PauseWrites", [&] {
        auto& state = Get();
        json answer{{"changed", false}};
        if (!state.bridge)
        {
            answer["reason"] = "the bridge isn't running";
        }
        else if (!state.config.allowWrites)
        {
            answer["reason"] = "changes are off in config.ini (allow_writes = false), so there is nothing to pause";
        }
        else
        {
            auto& dispatcher = state.bridge->GetDispatcher();
            answer["changed"] = dispatcher.WritesPaused() != paused;
            dispatcher.SetWritesPaused(paused);
        }
        answer["writes_paused"] = state.bridge && state.bridge->GetDispatcher().WritesPaused();
        if (aOut)
        {
            *aOut = RED4ext::CString(SerializeJson(answer).c_str());
        }
    });
}

// XFBridge_OptionsWanted() -> String   (CET layer: the render options game.options.read waits for,
// {"seq":n,"names":["Category/Name",...]}, or "" when none are wanted)
void OptionsWanted(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    Guarded("XFBridge_OptionsWanted", [&] {
        if (aOut)
        {
            *aOut = RED4ext::CString(Get().options.Pending().c_str());
        }
    });
}

// XFBridge_OptionsReport(values: String) -> Bool   (CET layer: {"seq":n,"values":{"Category/Name":"text"|null}})
// Stored only when it answers the pending request exactly (core/OptionsExchange.cpp checks it).
void OptionsReport(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString values;
    RED4ext::GetParameter(aFrame, &values);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_OptionsReport", [&] {
        std::string why;
        const bool stored = Get().options.Report(ToStd(values), &why);
        if (stored)
        {
            log::Debug("options.reported", "bytes=" + std::to_string(values.Length()));
        }
        else
        {
            log::Warn("options.report_refused", "why=" + why);
        }
        if (aOut)
        {
            *aOut = stored;
        }
    });
}

// XFBridge_Messages() -> String   (CET layer: the ui.message lines to draw under the CET line,
// {"messages":[{id, text, level, remaining_ms}]}, or "" when there are none). A killed bridge shows none
// and forgets them.
void Messages(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    Guarded("XFBridge_Messages", [&] {
        auto& state = Get();
        std::string text;
        if (state.bridge && state.bridge->GetDispatcher().IsKilled())
        {
            state.messages.Clear();
        }
        else
        {
            // 0.8 (session 8: CET's font turned Polish into "?"): the CET layer's Latin-1 copy (core/InkUi.hpp ForCet).
            text = state.messages.Snapshot(MessageBoard::Clock::now(), &inkui::ForCet);
        }
        if (aOut)
        {
            *aOut = RED4ext::CString(text.c_str());
        }
    });
}

// XFBridge_CreatorRedirect(state: String) -> String   (the pause menu's scenario wrap, cc.open's redirect:
// {pending, age_s, prev, refused, withdrawn_age_s} in, "redirect", "foreign", "expired", "refused",
// "withdrawn" or "none" out; core/Writes.cpp CreatorRedirect, unit-tested; RB-69, RB-75). Only called while a
// request waits or was just withdrawn. Anything unexpected answers "" and the pause menu opens as usual.
void CreatorRedirectNative(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    RED4ext::CString state;
    RED4ext::GetParameter(aFrame, &state);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_CreatorRedirect", [&] {
        const auto text = ToStd(state);
        const auto parsed = json::parse(text, nullptr, false);
        const auto decision = parsed.is_object() ? writes::CreatorRedirect(parsed) : std::string();
        log::Info("cc.open_redirect", "decision=" + (decision.empty() ? std::string("unreadable") : decision) + " state=" + text);
        if (aOut)
        {
            *aOut = RED4ext::CString(decision.c_str());
        }
    });
}

// XFBridge_ScriptLayer(event: String) -> Bool   (XFBridgeSystem's lifecycle: "attach", "player_attach", "detach";
// core/ScriptLayer.hpp, RB-76). Script calls are allowed only between a session's player attach and its detach.
// Runs on whichever thread the game attaches or detaches on; it only moves the gate's state.
void ScriptLayerEvent(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString event;
    RED4ext::GetParameter(aFrame, &event);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_ScriptLayer", [&] {
        const bool known = Get().scriptLayer.OnEvent(ToStd(event));
        if (known && ToStd(event) == "detach") InvalidateLifecycle();
        if (known && ToStd(event) == "detach") StopRecording("world_detach");
        if (known && ToStd(event) == "detach") CancelSupervisor("world_detach");
        if (!known)
        {
            log::Warn("script_layer.unknown_event", "event=" + Sanitize(ToStd(event), 32));
        }
        if (aOut)
        {
            *aOut = known;
        }
    });
}

// XFBridge_Hud() -> String   (bridge 0.5.3, temporary test feature: the ink HUD panel's frame, core/InkUi.hpp: its settings,
// the bridge's state, the script gate and the ui.message lines, one tab-separated record per line). Polled by the redscript
// overlay a few times a second and by the CET layer for its cet_label switch; reads bridge bookkeeping only.
void Hud(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    Guarded("XFBridge_Hud", [&] {
        const auto text = HudFrame();
        if (aOut)
        {
            *aOut = RED4ext::CString(text.c_str());
        }
    });
}

// XFBridge_Live() -> Bool   (0.6.1, RB-86: whether the game's scripts are live now, the script gate's `live` alone, so the ink
// overlay can check it on every tick before its world queries without pulling and parsing the whole frame). Reads bridge
// bookkeeping only.
void Live(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    Guarded("XFBridge_Live", [&] {
        if (aOut)
        {
            *aOut = Get().scriptLayer.Ready();
        }
    });
}

// XFBridge_Answer(id: Int32, choice: Int32, source: String) -> String   (0.7, session 7's in-game driving: the player answers
// the ask the ink panel or the CET window shows, by a key or a button). id 0 answers the pending ask. The answer goes into
// the session's event stream as kind "answer" (session.wait returns it) and the ask is replaced by "Answered: ...". Answers
// JSON: {ok, message_id, choice, label} or {ok: false, why}. Reads and writes bridge bookkeeping only.
void Answer(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    int32_t id = 0;
    int32_t choice = -1;
    RED4ext::CString source;
    RED4ext::GetParameter(aFrame, &id);
    RED4ext::GetParameter(aFrame, &choice);
    RED4ext::GetParameter(aFrame, &source);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_Answer", [&] {
        auto& state = Get();
        json answer;
        if (state.bridge && state.bridge->GetDispatcher().IsKilled())
        {
            answer = json{{"ok", false}, {"why", "the bridge is stopped"}};
        }
        else
        {
            // 0.8.9: answer keys (ink_key, cet_key) wait out the key guard; buttons and clicks don't.
            const auto via = ToStd(source);
            const bool byKey = via.size() >= 4 && via.compare(via.size() - 4, 4, "_key") == 0;
            answer = state.messages.Answer(id > 0 ? static_cast<uint64_t>(id) : 0, choice, byKey);
        }
        if (answer.value("ok", false))
        {
            auto from = ToStd(source);
            if (from.empty() || from.size() > 32)
            {
                from = "game";
            }
            const auto label = answer.value("label", std::string());
            state.events.Push("answer", "done", "game", "The player answered " + label,
                              json{{"message_id", answer["message_id"]}, {"choice", answer["choice"]}, {"label", label}, {"question", answer.value("text", std::string())}, {"via", from}});
        }
        if (aOut)
        {
            *aOut = RED4ext::CString(SerializeJson(answer).c_str());
        }
    });
}

// XFBridge_Comment(text: String) -> Bool   (0.7: the CET window's commentary box, and later the overlay's): a comment from the
// player into the session's event stream as kind "comment", source "game" (session.wait returns it like an answer).
void Comment(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString text;
    RED4ext::GetParameter(aFrame, &text);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_Comment", [&] {
        const auto body = ToStd(text);
        if (body.empty())
        {
            return;
        }
        Get().events.Push("comment", "info", "game", body, json{{"text", body}});
        if (aOut)
        {
            *aOut = true;
        }
    });
}

// XFBridge_CetOverlay(open: Bool) -> Bool   (0.7: the CET layer reports its overlay opening and closing, for ui.state, the
// capture pre-check that keeps CET's windows out of pictures, and the ImGui host's yield rule).
void CetOverlay(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    bool open = false;
    RED4ext::GetParameter(aFrame, &open);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_CetOverlay", [&] {
        Get().cetOverlayOpen.store(open);
        Get().cetOverlaySeen.store(true);
        if (aOut)
        {
            *aOut = true;
        }
    });
}

// XFBridge_InkDrawn(id: Int32, shown: Bool) -> Bool   (0.8, the UI review: the ink panel reports, about five times a second,
// the question it draws and whether it is on screen now, so the CET label can show only the status and the answer keys
// instead of the question a third time). Stores two numbers; reads nothing else.
void InkDrawn(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    int32_t id = 0;
    bool shown = false;
    RED4ext::GetParameter(aFrame, &id);
    RED4ext::GetParameter(aFrame, &shown);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_InkDrawn", [&] {
        auto& state = Get();
        const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
        // 0.8.11 (UI review of 0.8.11, fix 6): the question's keys become armed when the panel starts reporting it: a new
        // question, or the same one after a gap (the phone, photo mode's menu, a loading screen). The key guard starts again.
        const auto before = state.inkKeysAsk.load();
        const auto beforeAt = state.inkShownAtMs.load();
        if (id > 0 && (before != static_cast<uint64_t>(id) || now - beforeAt > State::kInkShownMs))
        {
            state.messages.NoteArmed(static_cast<uint64_t>(id));
        }
        // 0.8.2: shown is the panel on screen (whatever it shows); id the question it draws (0: none).
        state.inkShownAsk.store(shown && id > 0 ? static_cast<uint64_t>(id) : 0);
        state.inkVisible.store(shown);
        state.inkKeysAsk.store(id > 0 ? static_cast<uint64_t>(id) : 0); // 0.8.2: the question its keys answer, shown or not
        state.inkShownAtMs.store(now);
        if (aOut)
        {
            *aOut = true;
        }
    });
}

// XFBridge_KillKey(action: String, key: String) -> String   (0.8.4, the maintainer: the kill key chosen in the game). action
// "get" answers bridge_info's kill_key; "set" takes a chord's text (the XF Runtime Bridge window's Change... captures it) and
// "reset" the default; both save it to config.ini's [ui] kill_key and answer what else may react to it (warnings, never a
// refusal). Bridge bookkeeping and the plugin's own config.ini only; the game's and CET's files are only read.
void KillKeyNative(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    RED4ext::CString action;
    RED4ext::CString key;
    RED4ext::GetParameter(aFrame, &action);
    RED4ext::GetParameter(aFrame, &key);
    aFrame->code++; // skip ParamEnd

    Guarded("XFBridge_KillKey", [&] {
        const auto what = ToStd(action);
        json answer;
        if (what == "set")
        {
            answer = SetKillKey(ToStd(key).substr(0, 64), "cet-window");
        }
        else if (what == "reset")
        {
            answer = SetKillKey(killkey::kDefault, "cet-window-reset");
        }
        else
        {
            answer = json{{"ok", true}, {"kill_key", KillKeyJson()}};
        }
        if (aOut)
        {
            *aOut = RED4ext::CString(SerializeJson(answer).c_str());
        }
    });
}

// XFBridge_InkEvent(kind: String, text: String, data: String) -> Bool   (0.8.6: the photo-menu panel's events into the
// session's event stream: ink_tree, ink_pointer and ink_input only; data is a JSON object as text, core/InkUi.hpp
// InkEventData). Bookkeeping only; works while the bridge is stopped too, like XFBridge_Note (the stop's own release is one).
void InkEvent(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString kind;
    RED4ext::CString text;
    RED4ext::CString data;
    RED4ext::GetParameter(aFrame, &kind);
    RED4ext::GetParameter(aFrame, &text);
    RED4ext::GetParameter(aFrame, &data);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_InkEvent", [&] {
        const auto what = ToStd(kind);
        if (!inkui::InkEventKindOk(what))
        {
            log::Warn("ink.event_refused", "kind=" + Sanitize(what, 32));
            return;
        }
        const auto body = Sanitize(ToStd(text), 300);
        const auto raw = ToStd(data);
        Get().events.Push(what, "info", "game", body, inkui::InkEventData(raw.substr(0, 8192)));
        log::Debug("ink.event", "kind=" + what + " text=" + body);
        if (aOut)
        {
            *aOut = true;
        }
    });
}

// XFBridge_MouseHeld() -> Bool   (0.8.6: whether a mouse button is down now, while the game's window is in front: the
// photo-menu panel takes no hover from photo mode's camera while one is, so a drag that crosses the panel keeps turning the
// camera; §15.2's guard, read from the system as Advanced Pose Mod's plugin does, since script sees no button state).
void MouseHeld(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    Guarded("XFBridge_MouseHeld", [&] {
        bool held = false;
        const auto window = GetForegroundWindow();
        DWORD pid = 0;
        if (window && GetWindowThreadProcessId(window, &pid) != 0 && pid == GetCurrentProcessId())
        {
            held = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0 || (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0 ||
                   (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;
        }
        if (aOut)
        {
            *aOut = held;
        }
    });
}

// 0.8.7, what the player reads when their own save is refused by the bridge's lock (the status surface; the game's own
// notice stays as it is).
constexpr const char* kSaveHeldText =
    "XF Runtime Bridge is holding saves because of a test change. Load a save, or use Save anyway in the XF Runtime Bridge window (open the CET overlay).";

// XFBridge_SaveRefused(ours: Bool) -> Bool   (0.8.7: the redscript layer's wrap of the game's refused-save notice; ours: the
// bridge's own lock was among the reasons). Then the status surface says why for 12 s (at most once every 4 s) and the event
// stream records it; the XF Runtime Bridge window offers Save anyway.
void SaveRefused(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    bool ours = false;
    RED4ext::GetParameter(aFrame, &ours);
    aFrame->code++; // skip ParamEnd
    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_SaveRefused", [&] {
        auto& state = Get();
        if (!ours || !state.bridge || state.bridge->GetDispatcher().IsKilled())
        {
            return;
        }
        state.saveRefusals.fetch_add(1);
        const auto now = static_cast<int64_t>(win32::MonotonicMs());
        const auto last = state.saveRefusedAtMs.exchange(now);
        if (last > 0 && now - last < 4000)
        {
            return;
        }
        MessageRequest message;
        message.text = kSaveHeldText;
        message.seconds = 12;
        message.level = "warn";
        state.messages.Post(message);
        state.events.Push("save_refused", "warn", "game", "The player's save was refused while the bridge's save lock held",
                          json{{"by_bridge_lock", true}, {"refusals", state.saveRefusals.load()}});
        log::Info("save.refused_by_lock", "refusals=" + std::to_string(state.saveRefusals.load()));
        if (aOut)
        {
            *aOut = true;
        }
    });
}

// XFBridge_SaveAnyway(source: String) -> String   (0.8.7: the XF Runtime Bridge window's Save anyway, the player's own say-so
// to make one manual save past the bridge's lock, as game.save {override_lock: true} does; no pipe method asks for it). Only
// where the window offers it (allow_writes and the save class: the -writes package), while the bridge runs, one at a time, on
// a thread of its own so the game thread isn't held; the outcome goes to the status surface and the window. Answers
// {"started":true} or {"started":false,"why":"..."}.
void SaveAnyway(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    RED4ext::CString source;
    RED4ext::GetParameter(aFrame, &source);
    aFrame->code++; // skip ParamEnd
    json answer{{"started", false}, {"why", "the bridge couldn't start the save"}};
    Guarded("XFBridge_SaveAnyway", [&] {
        auto& state = Get();
        const auto correlation = TestUiSaveRequest(ToStd(source));
        if (!SaveAnywayOffered())
        {
            answer["why"] = state.config.allowWrites && (state.config.writeClasses & kWriteSave) != 0 ? "the bridge isn't holding saves now"
                                                                                                       : "this build of the bridge can't save";
            return;
        }
        if (state.saveAnywayRunning.exchange(true))
        {
            answer["why"] = "a save is already being made";
            return;
        }
        if (state.saveAnywayThread.joinable())
        {
            state.saveAnywayThread.join(); // the last one, finished
        }
        const auto from = Sanitize(ToStd(source), 32);
        log::Warn("save.anyway_requested", "by=" + from);
        state.saveAnywayThread = std::thread([correlation] {
            auto& s = Get();
            std::string text;
            json data{{"via", "save_anyway"}};
            data.update(correlation);
            try
            {
                const auto result = PlayerSaveAnyway("save-anyway");
                text = "Saved. XF Runtime Bridge holds saves again until you load a save.";
                data["ok"] = true;
                data["lock_overridden"] = result.value("lock_overridden", false);
            }
            catch (const MethodError& e)
            {
                // The window says it in plain words with one next step; the event keeps the reason for an agent.
                text = xfb::writes::SaveAnywayFailureCopy(e.code);
                data["ok"] = false;
                data["code"] = e.code;
                data["why"] = e.what();
            }
            catch (const std::exception& e)
            {
                text = xfb::writes::SaveAnywayFailureCopy("");
                data["ok"] = false;
                data["why"] = e.what();
            }
            catch (...)
            {
                text = xfb::writes::SaveAnywayFailureCopy("");
                data["ok"] = false;
            }
            MessageRequest message;
            message.text = text.substr(0, 400);
            message.seconds = 10;
            message.level = data.value("ok", false) ? "done" : "warn";
            s.messages.Post(message);
            s.events.Push("save", data.value("ok", false) ? "done" : "warn", "game", "Save anyway: " + text.substr(0, 200), data);
            {
                std::scoped_lock _(s.saveAnywayMutex);
                s.saveAnywaySeq += 1;
                s.saveAnywayLast = text.substr(0, 400);
            }
            s.saveAnywayRunning.store(false);
        });
        answer = json{{"started", true}};
    });
    if (aOut)
    {
        *aOut = RED4ext::CString(SerializeJson(answer).c_str());
    }
}

// XFBridge_Event(kind: String, data: String) -> Bool   (0.8.7, test probes: one record into the probe ring, test.events).
// Refused (false) unless [bridge] allow_test_hooks; data must be a JSON object of at most 4 KiB.
void ProbeEvent(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString kind;
    RED4ext::CString data;
    RED4ext::GetParameter(aFrame, &kind);
    RED4ext::GetParameter(aFrame, &data);
    aFrame->code++; // skip ParamEnd
    if (aOut)
    {
        *aOut = false;
    }
    Guarded("XFBridge_Event", [&] {
        auto& state = Get();
        const auto what = ToStd(kind);
        const auto raw = ToStd(data);
        if (!state.config.allowTestHooks || !probes::KindOk(what) || raw.size() > 4096)
        {
            return;
        }
        auto parsed = json::parse(raw, nullptr, false);
        if (parsed.is_discarded() || !parsed.is_object())
        {
            parsed = json{{"bad_json", Sanitize(raw, 200)}};
        }
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
        if (state.scriptLayer.Ready() && (what.starts_with("choice.") || what.starts_with("input.photo.")))
            InputService().Observe(what, parsed);
#endif
        const bool kept = state.probeEvents.Push(what, std::move(parsed), static_cast<int64_t>(win32::MonotonicMs()));
        if (aOut)
        {
            *aOut = kept;
        }
    });
}

// XFBridge_PinDrawn(pin: Int32, bits: Int32) -> Int32   (0.8.9, the Sol review's finding 3: world.pin's drawn_by from the mappin
// controllers on the UI's worker threads): ORs bits into the pin's set of views and answers the set before; bits 0 reads it,
// bits below 0 clears it (a new pin under a used id). Bookkeeping only, one lock, no game call.
void PinDrawn(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, int32_t* aOut, int64_t)
{
    int32_t pin = 0;
    int32_t bits = 0;
    RED4ext::GetParameter(aFrame, &pin);
    RED4ext::GetParameter(aFrame, &bits);
    aFrame->code++; // skip ParamEnd
    int32_t before = 0;
    Guarded("XFBridge_PinDrawn", [&] {
        auto& state = Get();
        if (bits < 0)
        {
            state.pinViews.Reset(pin);
            return;
        }
        before = static_cast<int32_t>(state.pinViews.Or(pin, static_cast<uint32_t>(bits)));
    });
    if (aOut)
    {
        *aOut = before;
    }
}

// XFBridge_ProbeFlags() -> Int32   (0.8.7, test probes: 1 the hooks are on ([bridge] allow_test_hooks), 2 the stim tap, 4 the
// save-identity probe's BeforeSave write armed, 8 the autonomous build, 16 the incident taps on; 0 without the test hooks).
void ProbeFlags(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, int32_t* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    int32_t flags = 0;
    Guarded("XFBridge_ProbeFlags", [&] {
        auto& state = Get();
        if (state.config.allowTestHooks)
        {
            flags = 1 | (state.probeSwitches.load() & 6);
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
            flags |= 8;
            // 0.8.20: 16 is the incident taps' switch (on unless incidents.list {tap: false} or the kill switch turned it off).
            if (IncidentTapOn())
            {
                flags |= 16;
            }
#endif
        }
    });
    if (aOut)
    {
        *aOut = flags;
    }
}

#ifdef XFB_AUTONOMOUS_TEST_HOOKS
void LifecycleMenu(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, void*, int64_t)
{
    RED4ext::Handle<RED4ext::ink::Widget> menu; RED4ext::GetParameter(frame, &menu); frame->code++;
    Guarded("XFBridge_LifecycleMenu", [&] { ObserveEngagementMenu(menu); });
}
void RecordEnabled(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, bool* out, int64_t)
{
    RED4ext::CString channel; RED4ext::GetParameter(frame, &channel); frame->code++;
    if (out) *out = false;
    Guarded("XFBridge_RecordEnabled", [&] { if (out) *out = RecordingWanted(ToStd(channel)); });
}
void RecordIdentity(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, RED4ext::CString* out, int64_t)
{
    RED4ext::CString channel; RED4ext::GetParameter(frame, &channel); frame->code++;
    if (out) *out = RED4ext::CString("");
    Guarded("XFBridge_RecordIdentity", [&] { if (out) *out = RED4ext::CString(RecordingIdentity(ToStd(channel)).c_str()); });
}
void RecordIngress(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, bool* out, int64_t)
{
    RED4ext::CString channel, payload;
    RED4ext::GetParameter(frame, &channel); RED4ext::GetParameter(frame, &payload); frame->code++;
    if (out) *out = false;
    Guarded("XFBridge_Record", [&] {
        // Consume ignored return values too; no unbounded copy before the core's length/nesting checks.
        const auto text = payload.Length() < recording::kPayload ? ToStd(payload) : std::string(recording::kPayload, ' ');
        const bool accepted = RecordingIngress(ToStd(channel), text);
        if (out) *out = accepted;
    });
}

// XFBridge_IncidentSeen(payload: String) -> Bool   (0.8.20, the autonomous test build): one observation or a one-second tick from the
// incident taps (core/Incidents.hpp). Passive: the plugin groups and reports; nothing is called back into the game.
void IncidentSeenNative(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, bool* out, int64_t)
{
    RED4ext::CString payload; RED4ext::GetParameter(frame, &payload); frame->code++;
    if (out) *out = false;
    Guarded("XFBridge_IncidentSeen", [&] {
        if (payload.Length() >= 4096) return;
        const bool accepted = IncidentSeen(ToStd(payload));
        if (out) *out = accepted;
    });
}

// XFBridge_IncidentAdmit(evidence: String, key: String) -> Bool   (0.8.20): whether the taps may build one more observation now. Bounded
// per second, by evidence and by entity, and every refusal counted, so a burst cannot starve other evidence nor vanish unseen.
void IncidentAdmitNative(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, bool* out, int64_t)
{
    RED4ext::CString evidence, key; RED4ext::GetParameter(frame, &evidence); RED4ext::GetParameter(frame, &key); frame->code++;
    if (out) *out = false;
    Guarded("XFBridge_IncidentAdmit", [&] {
        if (evidence.Length() >= 24 || key.Length() >= 64) return;
        const bool admitted = IncidentAdmit(ToStd(evidence), ToStd(key));
        if (out) *out = admitted;
    });
}

// XFBridge_IncidentSightPlan() -> String   (0.8.21): the XF actors (a1,a2) the sight sampler should look at now, from the open declared
// incidents (at most four of them), or "" when none is open, the taps are off or the scripts are not live. Read only.
void IncidentSightPlanNative(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, RED4ext::CString* out, int64_t)
{
    frame->code++; // skip ParamEnd
    if (out) *out = RED4ext::CString("");
    Guarded("XFBridge_IncidentSightPlan", [&] {
        if (out) *out = RED4ext::CString(IncidentSightPlan().c_str());
    });
}

// Test-only ingress: arming/taking cannot invoke SaveAnyway or enqueue any CET action.
void TestUiTake(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, RED4ext::CString* out, int64_t)
{
    RED4ext::CString raw; RED4ext::GetParameter(frame, &raw); frame->code++;
    json answer = nullptr;
    Guarded("XFBridge_TestUiTake", [&] {
        const auto text = ToStd(raw);
        if (text.size() > 2048 || JsonNestingDepth(text, 8) > 8) return;
        const auto draw = json::parse(text, nullptr, false);
        if (draw.is_object()) answer = TakeTestUi(draw);
    });
    if (out) *out = RED4ext::CString(SerializeJson(answer).c_str());
}
void TestUiReport(RED4ext::IScriptable*, RED4ext::CStackFrame* frame, RED4ext::CString* out, int64_t)
{
    RED4ext::CString raw; RED4ext::GetParameter(frame, &raw); frame->code++;
    json answer{{"accepted", false}};
    Guarded("XFBridge_TestUiReport", [&] {
        const auto text = ToStd(raw);
        if (!Get().config.allowTestHooks || text.size() > 2048 || JsonNestingDepth(text, 8) > 8) return;
        const auto report = json::parse(text, nullptr, false);
        if (report.is_object()) answer = ReportTestUi(report);
    });
    if (out) *out = RED4ext::CString(SerializeJson(answer).c_str());
}
#endif

void RegisterGlobal(RED4ext::CRTTISystem* aRtti, const char* aName, auto aFunction, const char* aReturnType,
                    std::initializer_list<const char*> aStringParams, const char* aParamType = "String")
{
    auto* func = RED4ext::CGlobalFunction::Create(aName, aName, aFunction);
    func->flags = {.isNative = true, .isStatic = true};
    for (const auto* param : aStringParams)
    {
        func->AddParam(aParamType, param);
    }
    if (aReturnType)
    {
        func->SetReturnType(aReturnType);
    }
    aRtti->RegisterFunction(func);
    log::Debug("rtti.register", std::string("global=") + aName);
}

// A global native with typed parameters (type, name), for the ones whose parameters aren't all of one type (0.7).
void RegisterGlobalTyped(RED4ext::CRTTISystem* aRtti, const char* aName, auto aFunction, const char* aReturnType,
                         std::initializer_list<std::pair<const char*, const char*>> aParams)
{
    auto* func = RED4ext::CGlobalFunction::Create(aName, aName, aFunction);
    func->flags = {.isNative = true, .isStatic = true};
    for (const auto& [type, name] : aParams)
    {
        func->AddParam(type, name);
    }
    if (aReturnType)
    {
        func->SetReturnType(aReturnType);
    }
    aRtti->RegisterFunction(func);
    log::Debug("rtti.register", std::string("global=") + aName);
}
} // namespace

void RegisterTypes()
{
    log::Info("rtti.register_types", "phase=register");
}

void PostRegisterTypes()
{
    try
    {
        auto* rtti = RED4ext::CRTTISystem::Get();
        RegisterGlobal(rtti, "XFBridge_Ping", &Ping, "String", {"layer", "cid"});
        RegisterGlobal(rtti, "XFBridge_Info", &Info, "String", {});
        RegisterGlobal(rtti, "XFBridge_Log", &LogFromScript, nullptr, {"layer", "level", "cid", "message"});
        RegisterGlobal(rtti, "XFBridge_Announce", &Announce, nullptr, {"layer", "detail"});
        RegisterGlobal(rtti, "XFBridge_Kill", &Kill, "Bool", {"reason"});
        RegisterGlobal(rtti, "XFBridge_OptionsWanted", &OptionsWanted, "String", {});
        RegisterGlobal(rtti, "XFBridge_OptionsReport", &OptionsReport, "Bool", {"values"});
        RegisterGlobal(rtti, "XFBridge_Rearm", &Rearm, "String", {"reason"});
        RegisterGlobal(rtti, "XFBridge_PauseWrites", &PauseWrites, "String", {"paused"}, "Bool");
        RegisterGlobal(rtti, "XFBridge_Messages", &Messages, "String", {});
        RegisterGlobal(rtti, "XFBridge_CreatorRedirect", &CreatorRedirectNative, "String", {"state"});
        RegisterGlobal(rtti, "XFBridge_ScriptLayer", &ScriptLayerEvent, "Bool", {"event"});
        RegisterGlobal(rtti, "XFBridge_Hud", &Hud, "String", {});
        RegisterGlobal(rtti, "XFBridge_Note", &Note, "Bool", {"level", "text"});
        RegisterGlobal(rtti, "XFBridge_Live", &Live, "Bool", {});
        RegisterGlobalTyped(rtti, "XFBridge_Answer", &Answer, "String", {{"Int32", "id"}, {"Int32", "choice"}, {"String", "source"}});
        RegisterGlobal(rtti, "XFBridge_Comment", &Comment, "Bool", {"text"});
        RegisterGlobal(rtti, "XFBridge_CetOverlay", &CetOverlay, "Bool", {"open"}, "Bool");
        // 0.8 (bridge-080a): the ink panel's report of the question it shows.
        RegisterGlobalTyped(rtti, "XFBridge_InkDrawn", &InkDrawn, "Bool", {{"Int32", "id"}, {"Bool", "shown"}});
        // 0.8.4: the kill key chosen in the XF Runtime Bridge window.
        RegisterGlobal(rtti, "XFBridge_KillKey", &KillKeyNative, "String", {"action", "key"});
        // 0.8.6: the photo-menu panel's events, and whether a mouse button is held (its hover guard).
        RegisterGlobal(rtti, "XFBridge_InkEvent", &InkEvent, "Bool", {"kind", "text", "data"});
        RegisterGlobal(rtti, "XFBridge_MouseHeld", &MouseHeld, "Bool", {});
        // 0.8.7: the player's refused saves and the window's Save anyway; the test probes' ring and switches.
        RegisterGlobal(rtti, "XFBridge_SaveRefused", &SaveRefused, "Bool", {"ours"}, "Bool");
        RegisterGlobal(rtti, "XFBridge_SaveAnyway", &SaveAnyway, "String", {"source"});
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
        RegisterGlobal(rtti, "XFBridge_TestUiTake", &TestUiTake, "String", {"draw"});
        RegisterGlobal(rtti, "XFBridge_TestUiReport", &TestUiReport, "String", {"receipt"});
        RegisterGlobalTyped(rtti, "XFBridge_LifecycleMenu", &LifecycleMenu, nullptr, {{"handle:inkWidget", "menu"}});
        RegisterGlobal(rtti, "XFBridge_RecordEnabled", &RecordEnabled, "Bool", {"channel"});
        RegisterGlobal(rtti, "XFBridge_Record", &RecordIngress, "Bool", {"channel", "payload"});
        RegisterGlobal(rtti, "XFBridge_RecordIdentity", &RecordIdentity, "String", {"channel"});
        RegisterGlobal(rtti, "XFBridge_IncidentSeen", &IncidentSeenNative, "Bool", {"payload"});
        RegisterGlobal(rtti, "XFBridge_IncidentAdmit", &IncidentAdmitNative, "Bool", {"evidence", "key"});
        RegisterGlobal(rtti, "XFBridge_IncidentSightPlan", &IncidentSightPlanNative, "String", {});
#endif
        RegisterGlobal(rtti, "XFBridge_Event", &ProbeEvent, "Bool", {"kind", "data"});
        RegisterGlobal(rtti, "XFBridge_ProbeFlags", &ProbeFlags, "Int32", {});
        // 0.8.9: the pins' views, OR-ed natively (the Sol review's finding 3).
        RegisterGlobalTyped(rtti, "XFBridge_PinDrawn", &PinDrawn, "Int32", {{"Int32", "pin"}, {"Int32", "bits"}});
        #ifdef XFB_AUTONOMOUS_TEST_HOOKS
        log::Info("rtti.register_types", "phase=post_register natives=36");
#else
        log::Info("rtti.register_types", "phase=post_register natives=27");
#endif
    }
    catch (const std::exception& e)
    {
        log::Error("rtti.register_failed", std::string("what=") + e.what());
    }
    catch (...)
    {
        log::Error("rtti.register_failed", "what=unknown");
    }
}
} // namespace xfb::plugin
