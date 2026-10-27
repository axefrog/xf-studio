#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Natives/entEntityID.hpp>
#include <Windows.h>
#include "plugin/Canvas.hpp"
#include "plugin/Plugin.hpp"
#include "plugin/GameHandlers.hpp"
#include "core/Win32.hpp"
#include <charconv>
#include <fstream>

namespace xfb::plugin
{
void RegisterCanvas(Dispatcher& d)
{
    auto& s = Get();
    s.canvas.Configure(s.config.overlayEnabled && s.config.canvasEnabled, s.config.canvasToggle, s.config.canvasMode,
                       s.config.canvasAnchorHz, s.config.canvasAnchorsPerRead);
    s.canvas.SetStateFile(s.session.runtimeDir / "canvas-view.json");
    canvas::RegisterMethods(d, s.canvas);
    s.bridge->SetDisconnectObserver([](uint64_t id) { Get().canvas.Disconnect(id); });
    s.bridge->AddStopObserver([] {
        auto& state = Get();
        if (state.bridge && state.bridge->GetDispatcher().IsKilled() && !state.canvasKilled.exchange(true)) state.scriptLayer.InvalidateWorld();
        state.canvas.Stop(); state.canvas.SetWorld(state.scriptLayer.WorldGeneration());
    });
    for (const auto& chord : {s.config.canvasToggle, s.config.canvasMode}) {
        const auto conflicts = ReadKillKeyConflicts(chord);
        for (const auto& warning : conflicts.warnings) log::Warn("canvas.key_conflict", chord.label + ": " + warning);
    }
}
void TickCanvas(bool ready)
{
    auto& s = Get();
    s.canvas.SetWorld(s.scriptLayer.WorldGeneration());
    if (!s.bridge || s.bridge->GetDispatcher().IsKilled()) return;
    s.canvasKilled.store(false);
    if (!s.canvas.Visible() || !ready || !s.overlayHost.ShouldDraw() || s.cetOverlayOpen.load()) return;
    const double start = canvas::Now(); const auto generation = s.canvas.Generation();
    canvas::Camera camera;
    try {
        const auto value = ScriptCall("XFCanvas", "CameraRead", {}, {}, "canvas-camera");
        camera.position = value.at("position").get<canvas::Vec>(); camera.forward = value.at("forward").get<canvas::Vec>();
        camera.right = value.at("right").get<canvas::Vec>(); camera.up = value.at("up").get<canvas::Vec>(); camera.fov = value.at("fov").get<double>();
        camera.player = value.at("player").get<canvas::Vec>(); camera.yaw = value.at("yaw").get<double>(); camera.valid = true;
        const auto viewport = s.overlayHost.Viewport(); camera.width = viewport.first; camera.height = viewport.second;
    } catch (...) {} // invalid camera suppresses projection without retaining a partial snapshot
    const double cameraMs = (canvas::Now() - start) * 1000;
    const double anchorStart = canvas::Now(); const auto wanted = s.canvas.Wanted(anchorStart);
    if (!wanted.empty()) {
        RED4ext::DynArray<RED4ext::ent::EntityID> ids;
        std::vector<canvas::EntityPosition> positions;
        for (const auto& text : wanted) {
            uint64_t id = 0; std::from_chars(text.data(), text.data() + text.size(), id); ids.PushBack(RED4ext::ent::EntityID(id));
            positions.push_back({text, std::nullopt});
        }
        try {
            const auto value = ScriptCall("XFCanvas", "AnchorsRead", {"array:entEntityID"}, {&ids}, "canvas-anchors");
            const auto& points = value.at("positions");
            if (points.is_array() && points.size() == positions.size()) for (size_t n = 0; n < positions.size(); ++n)
                if (points[n].is_array()) positions[n].position = points[n].get<canvas::Vec>();
        } catch (...) {} // failed reads do not extend anchor freshness
        s.canvas.Resolve(positions, anchorStart, (canvas::Now() - anchorStart) * 1000, generation);
    }
    s.canvas.Publish(camera, canvas::Now(), cameraMs, generation);
}
nlohmann::json CanvasLua(const std::string& module, const std::string& action, const std::string& payload)
{
    using json = nlohmann::json;
    auto& s = Get();
    if (module.empty() || module.size() > 24 || module.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_-") != std::string::npos)
        return {{"ok", false}, {"error", {{"code", "bad_batch"}, {"path", "$.module"}}}};
    if (!s.bridge || s.bridge->GetDispatcher().IsKilled()) return {{"ok", false}, {"error", {{"code", "killed"}}}};
    try {
        if (action == "feed" && !s.canvas.Visible()) return {{"ok", true}, {"result", {{"accepted",false},{"dropped","hidden"}}}};
        if (payload.size() > 65536) throw canvas::Refusal({{"code", "canvas_cap"}, {"cap", "bytes"}, {"limit", 65536}, {"got", payload.size()}});
        auto value = canvas::ParseJson(payload); json result;
        const std::string producer = "cet." + module;
        // CET is in-process; namespace identity is the module name, never a pipe connection.
        if (action == "feed" || action == "clear") { if (!value.is_object()) throw canvas::Refusal({{"code", "bad_batch"}, {"path", "$"}}); value["producer"] = producer; }
        if (action == "feed") { value["world"] = s.scriptLayer.WorldGeneration(); result = s.canvas.Feed(UINT64_MAX, value.dump(), canvas::Now(), true); }
        else if (action == "clear") result = s.canvas.Clear(UINT64_MAX, value, canvas::Now(), true);
        else if (action == "view") result = s.canvas.View(value);
        else if (action == "state") result = s.canvas.State();
        else if (action == "toggle") { s.canvas.Toggle(); result = s.canvas.State(); }
        else if (action == "mode") { s.canvas.Mode(); result = s.canvas.State(); }
        else if (action == "keys") {
            result = s.canvas.SetKeys(value); s.canvasKeysChanged.store(true);
            std::ifstream in(s.config.sourcePath, std::ios::binary); const std::string before((std::istreambuf_iterator<char>(in)), {});
            const auto keys = s.canvas.Keys(); const auto text = killkey::WithSetting(killkey::WithSetting(before, "overlay", "canvas_toggle", killkey::Spelling(keys.first)), "overlay", "canvas_mode", killkey::Spelling(keys.second));
            win32::SettingsReplace replaced; std::string why;
            result["saved"] = win32::ReplaceSettingsFile(s.config.sourcePath, text, s.session.runtimeDir / "settings-backups", 3, replaced, why);
            if (!why.empty()) result["save_error"] = why;
        } else throw canvas::Refusal({{"code", "bad_batch"}, {"path", "$.action"}});
        return {{"ok", true}, {"result", result}};
    } catch (const canvas::Refusal& e) { return {{"ok", false}, {"error", e.detail}}; }
}
}
