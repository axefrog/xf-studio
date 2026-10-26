#include "plugin/Plugin.hpp"

#include <RED4ext/Api/v1/Logger.hpp>
#include <RED4ext/Version.hpp>

#include "core/BuildInfo.hpp"
#include "core/Win32.hpp"

#include <cmath>
#include <fstream>
#include <sstream>

namespace xfb::plugin
{
Red4extSink::Red4extSink(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk)
    : m_handle(aHandle)
    , m_sdk(aSdk)
{
}

void Red4extSink::Write(Level aLevel, const std::string& aLine)
{
    if (!m_sdk || !m_sdk->logger)
    {
        return;
    }
    switch (aLevel)
    {
    case Level::Error:
        m_sdk->logger->Error(m_handle, aLine.c_str());
        break;
    case Level::Warn:
        m_sdk->logger->Warn(m_handle, aLine.c_str());
        break;
    default:
        m_sdk->logger->Info(m_handle, aLine.c_str());
        break;
    }
}

State& Get()
{
    static State state;
    return state;
}

std::string GameStateName(int aState)
{
    switch (aState)
    {
    case 0:
        return "BaseInitialization";
    case 1:
        return "Initialization";
    case 2:
        return "Running";
    case 3:
        return "Shutdown";
    default:
        return "PreInit";
    }
}

uint64_t State::InkShownAsk() const
{
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - inkShownAtMs.load() <= kInkShownMs ? inkShownAsk.load() : 0;
}

bool State::InkVisible() const
{
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - inkShownAtMs.load() <= kInkShownMs && inkVisible.load();
}

uint64_t State::InkKeysAsk() const
{
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - inkShownAtMs.load() <= kInkShownMs ? inkKeysAsk.load() : 0;
}

inkui::BridgeView BridgeViewNow()
{
    auto& state = Get();
    inkui::BridgeView view;
    view.pluginEnabled = state.config.bridgeEnabled;
    view.allowWrites = state.config.allowWrites;
    view.scriptReady = state.scriptLayer.Ready();
    if (state.bridge)
    {
        auto& dispatcher = state.bridge->GetDispatcher();
        view.killed = dispatcher.IsKilled();
        view.writesPaused = dispatcher.WritesPaused();
        view.listening = state.bridge->IsListening();
        view.hasClient = state.bridge->HasClient();
        view.inSession = state.bridge->InSession();
    }
    return view;
}

std::string HudFrame()
{
    // 0.8: made in one place (core BuildFrame), shared with the self-test's selftest.hud.
    auto& state = Get();
    const auto view = BridgeViewNow();
    if (view.killed)
    {
        state.hud.DropModal(); // 0.8.6: the kill switch ends ui.hud's modal; Reconnect starts without it
    }
    return inkui::BuildFrame(state.hud.Current(), view, state.messages, state.config.answerKeys, state.InkShownAsk(),
                             static_cast<inkui::StatusSurface>(state.statusSurface.load()), state.InkKeysAsk());
}

// 0.8.22: re-reads Windows' animation-effects setting (at start and with each info refresh) so the motion in force is current.
xfb::overlay::MotionState MotionNow(State& aState)
{
    aState.overlayHost.NoteWindowsAnimation(win32::ClientAreaAnimation());
    aState.overlayHost.RefreshFrameGeneration(&win32::FrameGenerationModules);
    return aState.overlayHost.Motion();
}

nlohmann::json InfoJson()
{
    auto& state = Get();
    return nlohmann::json{
        {"plugin", "XF Runtime Bridge"},
        {"plugin_version", XFB_VERSION_STRING},
        {"build_commit", std::string(BuildCommit())},
        {"build_dirty", BuildDirty()},
        {"protocol", kProtocolVersion},
        {"sid", state.session.sessionId},
        {"sdk_version", std::to_string(RED4EXT_VER_MAJOR) + "." + std::to_string(RED4EXT_VER_MINOR) + "." +
                            std::to_string(RED4EXT_VER_PATCH)},
        {"game_product_version", state.gameProductVersion},
        {"game_file_version", state.gameFileVersion},
        {"game_state", GameStateName(state.gameState.load())},
        {"running_ticks", state.runningTicks.load()},
        {"bridge", state.bridge ? state.bridge->Status()
                                : nlohmann::json{{"enabled", state.config.bridgeEnabled}, {"listening", false}}},
        {"allow_creator_leave", state.config.allowCreatorLeave},
        {"allow_live_pose", state.config.allowLivePose},
        {"restore_pending", state.restore.Pending()},
        // 0.8.4 (the UI review's fix 7): whether the bridge changed the game this run, so the window says saving stays
        // locked only when it does.
        {"writes_used", state.restore.WritesUsed()},
        {"script_layer", state.scriptLayer.Describe()},
        {"rearm_pending", state.rearmRequested.load()},
        // 0.7: the overlay host's switches (the CET window takes its theme from here) and the answer keys.
        // 0.8.22: the values in force (overlay.set changes them live; config.ini's are the ones at load).
        {"overlay", {{"enabled", state.overlayHost.EnabledNow()}, {"theme", xfb::overlay::ThemeName(state.overlayHost.Theme())}, {"phase", xfb::overlay::PhaseName(state.overlayHost.CurrentPhase())},
                     // 0.8 (the UI review): the CET label says so when frame generation keeps the overlay off.
                     {"off_for_frame_generation", state.overlayHost.OffForFrameGeneration()},
                     {"diagnostics", state.overlayHost.Diagnostics()},
                     // 0.8.22 (the Studio's in-game motion rule): the effective motion, "full" or "reduced" ([overlay] motion, Windows'
                     // animation-effects setting read now, and frame generation), with the setting and the reason.
                     {"motion", MotionNow(state).effective},
                     {"motion_setting", xfb::overlay::MotionSettingName(state.overlayHost.MotionSettingNow())},
                     {"motion_reason", state.overlayHost.Motion().reason},
                     {"windows_animations", state.overlayHost.WindowsAnimation()},
                     // the host's own figures, for the CET window's diagnostics card
                     {"frames", state.overlayHost.Frames()},
                     // 0.8.22: the test figure (overlay.set diagnostics_cpu_ms) where one is set, so the CET window's bar draws it too
                     {"cpu_ms", state.overlayHost.CpuOverridden() ? state.overlayHost.DisplayCpuMs() : std::round(state.overlayHost.CpuMs() * 1000.0) / 1000.0},
                     {"cpu_ms_override", state.overlayHost.CpuOverridden()},
                     {"cpu_ms_max", std::round(state.overlayHost.CpuMsMax() * 1000.0) / 1000.0}}},
        // 0.8.22: what the CET window last drew (its DIAGNOSTICS header, chip and tone) and how cet.panel's last press went; null
        // until the CET layer has reported (core/CetPanel.hpp).
        {"cet_panel", state.cetPanel.Report()},
        // 0.8 (the UI review): the status wording every surface shows, made in one place (core/InkUi.cpp Summarize).
        {"status", inkui::StatusJson(BridgeViewNow())},
        // 0.8.2: which status surface shows now (0.8.3's names: ink_panel, xf_box, cet_line, or none while loading).
        {"status_surface", inkui::SurfaceName(static_cast<inkui::StatusSurface>(state.statusSurface.load()))},
        {"answer_keys", state.config.answerKeys},
        // 0.8.3: the bridge's own kill key ([ui] kill_key); the XF Runtime Bridge window names it beside Stop. 0.8.4: the window
        // changes it; the answer adds its spelling, the default, and what else may react to it.
        {"kill_key", KillKeyJson()},
        // 0.8.5: the sound a new question plays ([ui] question_sound), or off.
        {"question_sound", state.config.questionSound.empty() ? std::string("off") : state.config.questionSound},
        // 0.8.7: the bridge's save lock as the player meets it: whether the window offers Save anyway, refusals, the outcome.
        {"save_lock", SaveLockJson()},
        {"last_rearm", [&state] {
             std::scoped_lock _(state.rearmMutex);
             return state.lastRearm;
         }()}};
}
bool SaveAnywayOffered()
{
    auto& state = Get();
    if (!state.config.allowWrites || (state.config.writeClasses & kWriteSave) == 0 || !state.bridge)
    {
        return false;
    }
    const auto& dispatcher = state.bridge->GetDispatcher();
    // Only while the bridge runs and its lock is (as far as the plugin knows) held: it is taken before the first change, and a
    // refused save of the player's says so.
    return !dispatcher.IsKilled() && (state.restore.WritesUsed() || state.saveRefusals.load() > 0);
}

nlohmann::json SaveLockJson()
{
    auto& state = Get();
    std::scoped_lock _(state.saveAnywayMutex);
    nlohmann::json out{{"save_anyway", SaveAnywayOffered()}, {"running", state.saveAnywayRunning.load()}, {"refusals", state.saveRefusals.load()},
                       {"last_seq", state.saveAnywaySeq}};
    if (!state.saveAnywayLast.empty())
    {
        out["last"] = state.saveAnywayLast;
    }
    return out;
}

killkey::Chord State::KillKey()
{
    std::scoped_lock _(killKeyMutex);
    return config.killKey;
}

namespace
{
std::string ReadSmall(const std::filesystem::path& aPath)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(aPath, ec) || std::filesystem::file_size(aPath, ec) > 8u * 1024 * 1024 || ec)
    {
        return {};
    }
    std::ifstream in(aPath, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

// The game's folder: the plugin sits in <game>/red4ext/plugins/XFRuntimeBridge.
std::filesystem::path GameRoot()
{
    return Get().pluginDir.parent_path().parent_path().parent_path();
}
} // namespace

killkey::Conflicts ReadKillKeyConflicts(const killkey::Chord& aChord)
{
    const auto root = GameRoot();
    const auto files = killkey::InputMappingFiles(root);
    return killkey::FindConflicts(aChord, files, ReadSmall(root / L"bin" / L"x64" / L"plugins" / L"cyber_engine_tweaks" / L"bindings.json"));
}

nlohmann::json KillKeyJson()
{
    auto& state = Get();
    std::scoped_lock _(state.killKeyMutex);
    const auto& chord = state.config.killKey;
    const killkey::Chord fallback;
    return nlohmann::json{{"enabled", chord.enabled},
                          {"label", chord.label},
                          {"spelling", killkey::Spelling(chord)},
                          {"default", fallback.label},
                          {"is_default", killkey::Spelling(chord) == killkey::Spelling(fallback)},
                          {"setting", "[ui] kill_key in config.ini (the XF Runtime Bridge window's Change... sets it)"},
                          {"warnings", state.killKeyConflicts.warnings},
                          {"notes", state.killKeyConflicts.notes},
                          {"unseen", killkey::kUnseenNote}};
}

nlohmann::json SetKillKey(const std::string& aText, const std::string& aSource)
{
    auto& state = Get();
    killkey::Chord chord;
    std::string why;
    if (!killkey::Parse(aText, chord, why))
    {
        return nlohmann::json{{"ok", false}, {"why", "That key can't stop the bridge (" + why + "). Pick another key."}, {"kill_key", KillKeyJson()}};
    }
    // 0.8.4 (the UI review): the bridge's own answer keys are refused in place (pressing one to answer would stop the bridge);
    // keys the game or CET use are warned about, never refused (the maintainer's brief).
    if (chord.enabled && !chord.ctrl && !chord.shift && !chord.alt)
    {
        for (const auto& name : state.config.answerKeys)
        {
            killkey::Chord answerKey;
            std::string ignored;
            if (killkey::Parse(name, answerKey, ignored) && answerKey.vk == chord.vk)
            {
                return nlohmann::json{{"ok", false}, {"why", chord.label + " answers XF Studio's questions. Pick another key, or hold Ctrl, Shift or Alt with it."}, {"kill_key", KillKeyJson()}};
            }
        }
    }
    if (!chord.enabled)
    {
        // The window offers no Off (the UI review): the in-game stop stays; off is config.ini's choice only.
        return nlohmann::json{{"ok", false}, {"why", "The stop key can only be switched off in config.ini. Pick a key."}, {"kill_key", KillKeyJson()}};
    }
    auto conflicts = ReadKillKeyConflicts(chord);
    {
        std::scoped_lock _(state.killKeyMutex);
        state.config.killKey = chord;
        state.killKeyConflicts = conflicts;
    }
    state.killKeyChanged.store(true);
    // Saved into config.ini's [ui] kill_key, so it lasts across launches (under MO2 the file is the mod's own copy).
    const auto path = state.pluginDir / L"config.ini";
    // The review of 0.8.4: only after a whole, successful read, then read back; any failure keeps the old config.ini as it was.
    // 0.8.5 (session 12's K5): the old file is kept in the bridge's runtime folder (the last 3), not beside config.ini, where
    // MO2 put the new file into its overwrite folder, which every profile shares (core win32::ReplaceSettingsFile).
    std::string saveError;
    win32::SettingsReplace replaced;
    {
        std::string before;
        std::string ioWhy;
        bool missing = false;
        const auto runtime = win32::RuntimeDirectory();
        if (!win32::ReadFileExact(path, before, missing, ioWhy))
        {
            saveError = missing ? "config.ini isn't there, so the key lasts only until the game closes"
                                : "config.ini couldn't be read (" + ioWhy + "), so it was left as it is and the key lasts only until the game closes";
        }
        else if (runtime.empty())
        {
            saveError = "the bridge's runtime folder isn't known, so config.ini was left as it is and the key lasts only until the game closes";
        }
        else if (!win32::ReplaceSettingsFile(path, killkey::WithKillKey(before, killkey::Spelling(chord)), runtime / L"settings-backups", 3, replaced, ioWhy))
        {
            saveError = "config.ini wasn't changed: " + ioWhy + "; the key lasts only until the game closes";
        }
    }
    log::Warn("bridge.kill_key_changed", "key=" + killkey::Spelling(chord) + " from=" + aSource + " saved=" + (saveError.empty() ? "true" : "false") +
                                             " warnings=" + std::to_string(conflicts.warnings.size()) + " backup=" +
                                             (replaced.backup.empty() ? std::string("none") : win32::Narrow(replaced.backup.filename().wstring())) +
                                             " temp=" + (replaced.tempBeside ? "beside" : "runtime"));
    for (const auto& warning : conflicts.warnings)
    {
        log::Warn("bridge.kill_key_warning", warning);
    }
    nlohmann::json answer{{"ok", true}, {"saved", saveError.empty()}, {"kill_key", KillKeyJson()}};
    if (!replaced.backup.empty())
    {
        // 0.8.5: where the old config.ini is kept (the XF Runtime Bridge window says so), and whether the temporary file had to
        // go beside config.ini (another volume).
        answer["backup"] = win32::Narrow(replaced.backup.wstring());
        answer["backup_folder"] = R"(%LOCALAPPDATA%\XFStudio\runtime-bridge\settings-backups)";
        answer["temp_beside"] = replaced.tempBeside;
    }
    if (!saveError.empty())
    {
        answer["save_error"] = saveError;
    }
    return answer;
}
} // namespace xfb::plugin
