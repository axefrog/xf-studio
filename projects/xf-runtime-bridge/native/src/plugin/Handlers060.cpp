// Bridge 0.6 methods that need the game: scene.read, the handover, behaviours, player control phase 1 and input.probe.
// Every game call goes through the redscript layer (ScriptCall: a caller frame and a context, the game gate checked by
// the dispatcher right before a game-thread method and by RunGameTask before each step); the plugin keeps only the
// bookkeeping (the event stream, the behaviour runner, the teleport pacer). input.probe reads RTTI and the executable's
// import table and calls nothing.

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Detail/AddressHashes.hpp>

#include <Windows.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "core/Behaviours.hpp"
#include "core/Events.hpp"
#include "core/Log.hpp"
#include "core/Params.hpp"
#include "core/Player.hpp"
#include "core/Scene.hpp"
#include "core/Writes.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;
using behave::Vec3;

Vec3 VecOf(const json& aValue)
{
    if (aValue.is_array() && aValue.size() >= 3)
    {
        return {aValue[0].get<double>(), aValue[1].get<double>(), aValue[2].get<double>()};
    }
    throw MethodError("unavailable", "the game answered a point the bridge couldn't read");
}

json Game(const std::function<json()>& aTask, const std::string& aLabel)
{
    return RunGameTask(Get().queue, GameTimeout(), aTask, aLabel);
}

Dispatcher& TheDispatcher()
{
    auto& state = Get();
    if (!state.bridge)
    {
        throw MethodError("failed", "the bridge isn't running");
    }
    return state.bridge->GetDispatcher();
}

// --- scene.read ---------------------------------------------------------------------------------

json SceneRead(const MethodContext& aContext)
{
    const auto request = scene::ParseRead(aContext.params);
    RED4ext::CString parts(scene::PartsText(request).c_str());
    float radius = request.radius;
    int32_t maxNpcs = request.maxNpcs;
    bool occlusion = request.occlusion;
    float ex = static_cast<float>(request.pieceEyes[0]), ey = static_cast<float>(request.pieceEyes[1]), ez = static_cast<float>(request.pieceEyes[2]);
    auto out = ScriptCall("XFScene", "Read", {"String", "Float", "Int32", "Bool", "Float", "Float", "Float"},
                          {&parts, &radius, &maxNpcs, &occlusion, &ex, &ey, &ez}, aContext.cid);
    if (!request.points.empty())
    {
        json points = json::array();
        for (const auto& point : request.points)
        {
            float x = static_cast<float>(point[0]), y = static_cast<float>(point[1]), z = static_cast<float>(point[2]);
            const auto projected = ScriptCall("XFScene", "Project", {"Float", "Float", "Float"}, {&x, &y, &z}, aContext.cid);
            points.push_back({{"world", point}, {"screen", projected.value("screen", json())}});
        }
        out["points"] = points;
    }
    return out;
}

// --- handover -----------------------------------------------------------------------------------

json BridgeHandover(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {"on", "note"});
    const auto on = params::CheckBoolean(aContext.params, "on");
    if (!on)
    {
        params::CheckFail("'on' is required: true hands the session over to the player, false resumes it");
    }
    const auto note = params::CheckText(aContext.params, "note", 200).value_or("");
    auto& dispatcher = TheDispatcher();
    const bool was = dispatcher.HandedOver();
    json released = nullptr;
    if (*on)
    {
        Get().behaviours.StopAll("handed_over");
    }
    dispatcher.SetHandover(*on, note);
    if (*on)
    {
        // RB-82: the player gets V back as well, as player.stop gives her back: every look-at broken and every status effect
        // the bridge put on her lifted (a forced crouch would otherwise stay on, and player.action stand is refused while
        // handed over). One game-thread step after the flag is set, so no write can come in between; when the game can't
        // be called now (a save loading), the effects went with the session and the answer says why.
        const auto cid = aContext.cid;
        try
        {
            released = Game([cid] { return ScriptCall("XFPlayer", "Stop", {}, {}, cid); }, "bridge.handover.player_stop");
            released.erase("ok");
        }
        catch (const MethodError& e)
        {
            released = json{{"released", false}, {"why", e.code}, {"message", e.what()}};
        }
    }
    return json{{"handed_over", *on}, {"was", was}, {"behaviours_stopped", *on}, {"player_released", released},
                {"undo", {{"method", "bridge.handover"}, {"params", {{"on", !*on}}}}},
                {"undo_note", *on ? "bridge.handover {on: false} (session.resume) gives the bridge its writes back; what the handover lifted from V stays lifted" : "bridge.handover {on: true} hands over again"}};
}

// --- behaviours ---------------------------------------------------------------------------------

behave::Ops BehaviourOps()
{
    behave::Ops ops;
    const std::string cid = "behaviour";
    ops.camera = [cid] {
        RED4ext::CString parts("camera");
        float radius = 0.0f;
        int32_t npcs = 0;
        bool occlusion = false;
        float ex = 0.0f, ey = 0.0f, ez = 0.0f;
        const auto read = ScriptCall("XFScene", "Read", {"String", "Float", "Int32", "Bool", "Float", "Float", "Float"},
                                     {&parts, &radius, &npcs, &occlusion, &ex, &ey, &ez}, cid);
        if (!read.contains("camera"))
        {
            throw MethodError("unavailable", "the camera system reported no active camera");
        }
        return read["camera"];
    };
    ops.showroom = [cid] {
        RED4ext::CString parts("showroom");
        float radius = 0.0f;
        int32_t npcs = 0;
        bool occlusion = false;
        float ex = 0.0f, ey = 0.0497f, ez = 1.691f;
        const auto read = ScriptCall("XFScene", "Read", {"String", "Float", "Int32", "Bool", "Float", "Float", "Float"},
                                     {&parts, &radius, &npcs, &occlusion, &ex, &ey, &ez}, cid);
        return read.value("showroom", json::object());
    };
    ops.place = [cid](const std::string& aKind, int32_t aIndex, const Vec3& aPosition, double aYaw) {
        RED4ext::CString kind(aKind.c_str());
        float x = static_cast<float>(aPosition[0]), y = static_cast<float>(aPosition[1]), z = static_cast<float>(aPosition[2]);
        float yaw = static_cast<float>(aYaw);
        ScriptCall("XFShowroom", "Move", {"String", "Int32", "Float", "Float", "Float", "Float"}, {&kind, &aIndex, &x, &y, &z, &yaw}, cid);
    };
    ops.player = [cid] {
        const auto where = ScriptCall("XFPlayer", "Where", {}, {}, cid);
        return where;
    };
    ops.teleportPlayer = [cid](const Vec3& aPosition, double aYaw) {
        // A glide's per-tick step: no checks or log line per tick (the behaviour checks V every 15 ticks); the path already
        // keeps to walkable ground.
        float x = static_cast<float>(aPosition[0]), y = static_cast<float>(aPosition[1]), z = static_cast<float>(aPosition[2]);
        float yaw = static_cast<float>(aYaw);
        ScriptCall("XFPlayer", "Step", {"Float", "Float", "Float", "Float"}, {&x, &y, &z, &yaw}, cid);
    };
    ops.lookAt = [cid](const Vec3& aPoint, double aDuration) {
        float x = static_cast<float>(aPoint[0]), y = static_cast<float>(aPoint[1]), z = static_cast<float>(aPoint[2]);
        float duration = static_cast<float>(aDuration);
        ScriptCall("XFPlayer", "LookAt", {"Float", "Float", "Float", "Float"}, {&x, &y, &z, &duration}, cid);
    };
    ops.breakLookAt = [cid] { ScriptCall("XFPlayer", "BreakLook", {}, {}, cid); };
    ops.path = [cid](const Vec3& aFrom, const Vec3& aTo) {
        float x0 = static_cast<float>(aFrom[0]), y0 = static_cast<float>(aFrom[1]), z0 = static_cast<float>(aFrom[2]);
        float x1 = static_cast<float>(aTo[0]), y1 = static_cast<float>(aTo[1]), z1 = static_cast<float>(aTo[2]);
        const auto path = ScriptCall("XFPlayer", "Path", {"Float", "Float", "Float", "Float", "Float", "Float"}, {&x0, &y0, &z0, &x1, &y1, &z1}, cid);
        std::vector<Vec3> points;
        for (const auto& point : path.value("points", json::array()))
        {
            points.push_back(VecOf(point));
        }
        return points;
    };
    ops.holdMovement = [cid](bool aOn) {
        RED4ext::CString effect("GameplayRestriction.NoMovement");
        bool on = aOn;
        ScriptCall("XFPlayer", "Effect", {"String", "Bool"}, {&effect, &on}, cid);
    };
    ops.subject = [cid] {
        float up = 0.045f, forward = 0.08f, right = 0.0f;
        return ScriptCall("XFPhoto", "Subject", {"Float", "Float", "Float"}, {&up, &forward, &right}, cid);
    };
    ops.setAttribute = [cid](int32_t aKey, float aValue) {
        const auto result = ScriptCall("XFPhoto", "SetAttribute", {"Int32", "Float"}, {&aKey, &aValue}, cid);
        return result.value("after", aValue);
    };
    return ops;
}

// behave.<kind>: the input's own keys are the behaviour's parameters; max_s and every_ticks are the runner's.
json BehaveStart(const std::string& aKind, const MethodContext& aContext)
{
    auto& dispatcher = TheDispatcher();
    Get().restore.MarkWrite();
    return Get().behaviours.Start(behave::StartParams(aKind, aContext.params), [&dispatcher](Access aAccess) { dispatcher.RequireWriteClass(aAccess); });
}

// --- player -------------------------------------------------------------------------------------

json PlayerState(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    auto out = ScriptCall("XFPlayer", "State", {}, {}, aContext.cid);
    out["behaviours"] = Get().behaviours.List()["behaviours"];
    out["perspective"] = "fpp"; // an ITP-style camera or our own free camera would say otherwise (design §2.3); not detected yet
    return out;
}

json PlayerTeleport(const MethodContext& aContext)
{
    const auto request = player::ParseTeleport(aContext.params);
    Get().teleports.Take();
    const auto cid = aContext.cid;
    const auto where = Game([cid] { return ScriptCall("XFPlayer", "Where", {}, {}, cid); }, "player.where");
    const auto from = VecOf(where.at("position"));
    const double yawBefore = where.value("yaw", 0.0);
    const auto [to, yaw] = player::Destination(request, from, yawBefore);
    TheDispatcher().RequireWritesOpen();
    const auto done = Game(
        [cid, to = to, yaw = yaw, request] {
            float x = static_cast<float>(to[0]), y = static_cast<float>(to[1]), z = static_cast<float>(to[2]);
            float wanted = static_cast<float>(yaw.value_or(0.0));
            bool hasYaw = yaw.has_value();
            int32_t ground = request.exact ? 1 : 0;
            bool farOk = request.farOk;
            return ScriptCall("XFPlayer", "Teleport", {"Float", "Float", "Float", "Float", "Bool", "Int32", "Bool"}, {&x, &y, &z, &wanted, &hasYaw, &ground, &farOk}, cid);
        },
        "player.teleport");
    if (!writes::WaitTicks(Get().queue, 2, GameTimeout()))
    {
        throw MethodError("timeout", "the game didn't tick after the teleport; player_state shows where V is");
    }
    const auto after = Game([cid] { return ScriptCall("XFPlayer", "Where", {}, {}, cid); }, "player.where");
    const auto target = VecOf(done.at("target"));
    const auto now = VecOf(after.at("position"));
    const double off = std::hypot(now[0] - target[0], now[1] - target[1], now[2] - target[2]);
    return json{{"before", done.value("before", json())}, {"target", done.at("target")}, {"yaw", done.value("yaw", yawBefore)},
                {"snapped", done.value("snapped", false)}, {"now", after.at("position")}, {"off_m", std::round(off * 1000.0) / 1000.0},
                {"held", off < 0.3},
                {"undo", {{"method", "player.teleport"}, {"params", {{"position", where.at("position")}, {"yaw", yawBefore}, {"ground", "exact"}}}}},
                {"undo_note", "teleports V back to where she stood, facing the same way (loading the save undoes it too)"}};
}

json PlayerLook(const MethodContext& aContext)
{
    const auto request = player::ParseLook(aContext.params);
    const auto cid = aContext.cid;
    const auto state = Game([cid] { return ScriptCall("XFPlayer", "State", {}, {}, cid); }, "player.state");
    const auto& camera = state.at("camera");
    if (camera.is_null())
    {
        throw MethodError("unavailable", "the camera system reported no active camera");
    }
    const auto camPos = VecOf(camera.at("position"));
    const double yaw0 = camera.value("yaw", 0.0), pitch0 = camera.value("pitch", 0.0);
    const auto target = player::LookTargetFor(request, camPos, yaw0, pitch0);
    TheDispatcher().RequireWritesOpen();
    if (!request.smooth && !request.at)
    {
        // Instant: V's yaw by a teleport in place (her yaw is the first-person camera's), then the pitch by a very short look-at.
        Get().teleports.Take();
        const auto position = state.at("position");
        Game(
            [cid, position, yaw = target.yaw] {
                float x = position[0].get<float>(), y = position[1].get<float>(), z = position[2].get<float>();
                float wanted = static_cast<float>(yaw);
                bool hasYaw = true;
                int32_t ground = 1;
                bool farOk = false;
                return ScriptCall("XFPlayer", "Teleport", {"Float", "Float", "Float", "Float", "Bool", "Int32", "Bool"}, {&x, &y, &z, &wanted, &hasYaw, &ground, &farOk}, cid);
            },
            "player.look.yaw");
        writes::WaitTicks(Get().queue, 1, GameTimeout());
    }
    // Aim at the wanted point from where the camera is after any turn (the camera moves with V's head slightly).
    Game(
        [cid, point = target.point, duration = request.duration] {
            float x = static_cast<float>(point[0]), y = static_cast<float>(point[1]), z = static_cast<float>(point[2]);
            float d = static_cast<float>(duration);
            return ScriptCall("XFPlayer", "LookAt", {"Float", "Float", "Float", "Float"}, {&x, &y, &z, &d}, cid);
        },
        "player.look");
    // Wait for it: the look-at runs natively; read the camera until it stops moving or the time is up.
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(static_cast<int>(request.duration * 1000.0) + 700);
    json reached = camera;
    while (std::chrono::steady_clock::now() < deadline)
    {
        writes::WaitTicks(Get().queue, 3, GameTimeout());
        reached = Game([cid] { return ScriptCall("XFPlayer", "State", {}, {}, cid); }, "player.state").at("camera");
        const double dy = std::abs(std::remainder(reached.value("yaw", 0.0) - target.yaw, 360.0));
        const double dp = std::abs(reached.value("pitch", 0.0) - target.pitch);
        if (dy < 1.0 && dp < 1.0)
        {
            break;
        }
    }
    const double errYaw = std::remainder(reached.value("yaw", 0.0) - target.yaw, 360.0);
    const double errPitch = reached.value("pitch", 0.0) - target.pitch;
    return json{{"mode", request.smooth ? "smooth" : "instant"}, {"wanted", {{"yaw", target.yaw}, {"pitch", target.pitch}}},
                {"reached", {{"yaw", reached.value("yaw", 0.0)}, {"pitch", reached.value("pitch", 0.0)}}},
                {"error_deg", {{"yaw", std::round(errYaw * 100.0) / 100.0}, {"pitch", std::round(errPitch * 100.0) / 100.0}}},
                {"within_2_deg", std::abs(errYaw) <= 2.0 && std::abs(errPitch) <= 2.0},
                {"undo", {{"method", "player.look"}, {"params", {{"yaw", yaw0}, {"pitch", pitch0}, {"mode", "instant"}}}}},
                {"undo_note", "turns the view back; the player's own mouse or stick also breaks a look"}};
}

json PlayerLookStop(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    ScriptCall("XFPlayer", "BreakLook", {}, {}, aContext.cid);
    return json{{"stopped", true}, {"undo", nullptr}, {"undo_note", "nothing to undo"}};
}

json PlayerStop(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    Get().behaviours.StopAll("player_stop");
    const auto cid = aContext.cid;
    auto out = Game([cid] { return ScriptCall("XFPlayer", "Stop", {}, {}, cid); }, "player.stop");
    out["behaviours"] = "every behaviour stops on the next tick (behave_list)";
    return out;
}

json PlayerInteractList(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    return ScriptCall("XFPlayer", "Interactions", {}, {}, aContext.cid);
}

json PlayerAction(const MethodContext& aContext)
{
    const auto request = player::ParseAction(aContext.params);
    TheDispatcher().RequireWriteClass(request.access);
    Get().restore.MarkWrite();
    RED4ext::CString name(request.name.c_str());
    int32_t arg = request.arg;
    auto out = ScriptCall("XFPlayer", "Action", {"String", "Int32"}, {&name, &arg}, aContext.cid);
    out["undo"] = request.undo;
    out["undo_note"] = request.undoNote;
    return out;
}

// --- photo.camera.preset (research) ---------------------------------------------------------------

// The first value seen for each camera preset flat photo.camera.preset rewrote, kept in the plugin because TweakDB changes
// outlive a load (the scripts' own registry doesn't): the kill switch writes them back (RB-90).
std::mutex g_presetMutex;
std::map<int32_t, std::map<std::string, float>> g_presetOriginals;

void NotePresetOriginals(int32_t aPreset, const json& aFlats, const std::vector<std::pair<std::string, float>>& aWritten)
{
    std::scoped_lock _(g_presetMutex);
    auto& originals = g_presetOriginals[aPreset];
    for (const auto& [name, value] : aWritten)
    {
        (void)value;
        if (!originals.contains(name) && aFlats.contains(name) && aFlats[name].is_number())
        {
            originals[name] = aFlats[name].get<float>();
        }
    }
}

// Reads the preset's flats (the undo's values), writes the given ones and rebuilds the record, selects the preset (through
// Customization first, so photo mode applies it again), waits four ticks and reads the camera back.
json PhotoCameraPreset(const MethodContext& aContext)
{
    const auto request = scene::ParsePreset(aContext.params);
    const auto cid = aContext.cid;
    auto& queue = Get().queue;
    const int32_t preset = request.preset;
    const auto before = Game(
        [cid, preset] {
            int32_t p = preset;
            return ScriptCall("XFPresetRewrite", "Read", {"Int32"}, {&p}, cid);
        },
        "photo.camera.preset.read");
    const auto cameraBefore = Game([cid] { return ScriptCall("XFPhoto", "CameraReading", {}, {}, cid); }, "photo.camera.read");
    json written = json::object();
    if (!request.values.empty())
    {
        TheDispatcher().RequireWritesOpen();
        NotePresetOriginals(preset, before.value("flats", json::object()), request.values);
        Game(
            [cid, preset, values = request.values] {
                for (const auto& [name, value] : values)
                {
                    int32_t p = preset;
                    RED4ext::CString flat(name.c_str());
                    float v = value;
                    ScriptCall("XFPresetRewrite", "Write", {"Int32", "String", "Float"}, {&p, &flat, &v}, cid);
                }
                int32_t p = preset;
                return ScriptCall("XFPresetRewrite", "Commit", {"Int32"}, {&p}, cid);
            },
            "photo.camera.preset.write");
        for (const auto& [name, value] : request.values)
        {
            written[name] = value;
        }
    }
    json selected = nullptr;
    const int32_t choose = request.selectAfter >= 0 ? request.selectAfter : request.select ? preset : -1;
    if (choose >= 0)
    {
        TheDispatcher().RequireWritesOpen();
        selected = Game(
            [cid, choose] {
                int32_t key = params::key::kCameraPreset;
                float none = 0.0f;
                auto first = ScriptCall("XFPhoto", "SetAttribute", {"Int32", "Float"}, {&key, &none}, cid);
                float wanted = static_cast<float>(choose);
                auto then = ScriptCall("XFPhoto", "SetAttribute", {"Int32", "Float"}, {&key, &wanted}, cid);
                then["before"] = first.value("before", json());
                return then;
            },
            "photo.camera.preset.select");
        if (!writes::WaitTicks(queue, 4, GameTimeout()))
        {
            throw MethodError("timeout", "the game didn't tick after the preset was selected; photo.subject shows where the camera is");
        }
    }
    const auto cameraAfter = Game([cid] { return ScriptCall("XFPhoto", "CameraReading", {}, {}, cid); }, "photo.camera.read");
    const auto p0 = cameraBefore.value("position", json::object()), p1 = cameraAfter.value("position", json::object());
    const double moved = std::hypot(p1.value("x", 0.0) - p0.value("x", 0.0), p1.value("y", 0.0) - p0.value("y", 0.0), p1.value("z", 0.0) - p0.value("z", 0.0));
    json undoParams{{"preset", preset}, {"values", before.value("flats", json::object())}, {"select", false}};
    if (selected.is_object() && selected.contains("before") && selected["before"].is_number())
    {
        undoParams["camera_preset"] = static_cast<int32_t>(std::lround(selected["before"].get<double>()));
    }
    return json{{"preset", preset}, {"before", before.value("flats", json())}, {"written", written}, {"selected", selected},
                {"camera_before", cameraBefore}, {"camera_after", cameraAfter}, {"camera_moved_m", std::round(moved * 1000.0) / 1000.0},
                {"note", "research: whether photo mode reads the preset's record when it is selected is what camera_moved_m and camera_after show"},
                {"undo", {{"method", "photo.camera.preset"}, {"params", undoParams}}},
                {"undo_note", "writes the preset's earlier values back and selects the earlier preset; the values also go when the game restarts"}};
}

// --- input.probe --------------------------------------------------------------------------------

std::string NameOf(RED4ext::CName aName)
{
    const auto* text = aName.ToString();
    return text ? text : "";
}

json DescribeFunction(RED4ext::CBaseFunction* aFn, uintptr_t aHandlers, uint32_t aRegIndex, bool aHasIndex)
{
    json out{{"name", NameOf(aFn->shortName)},
             {"params", aFn->params.size},
             {"native", static_cast<bool>(aFn->flags.isNative)},
             {"static", static_cast<bool>(aFn->flags.isStatic)},
             {"has_return", aFn->returnType != nullptr}};
    std::vector<std::string> types;
    for (uint32_t i = 0; i < aFn->params.size; ++i)
    {
        const auto* prop = aFn->params.entries[i];
        types.push_back(prop && prop->type ? NameOf(prop->type->GetName()) : "?");
    }
    out["param_types"] = types;
    if (aHasIndex)
    {
        out["reg_index"] = aRegIndex;
    }
    // The native handler's address, as an offset in the executable (for offline disassembly), read from the engine's handler
    // table only when that entry is committed, readable memory.
    const auto exe = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
    if (aFn->flags.isNative && aHasIndex && aHandlers != 0 && aRegIndex < 200000)
    {
        const auto slot = aHandlers + static_cast<uintptr_t>(aRegIndex) * sizeof(void*);
        MEMORY_BASIC_INFORMATION info{};
        if (VirtualQuery(reinterpret_cast<void*>(slot), &info, sizeof(info)) == sizeof(info) && info.State == MEM_COMMIT &&
            (info.Protect & (PAGE_READONLY | PAGE_READWRITE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE)) != 0 && (info.Protect & PAGE_GUARD) == 0)
        {
            const auto handler = *reinterpret_cast<const uintptr_t*>(slot);
            HMODULE module = nullptr;
            if (handler && GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                                              reinterpret_cast<LPCWSTR>(handler), &module))
            {
                wchar_t path[MAX_PATH]{};
                GetModuleFileNameW(module, path, MAX_PATH);
                std::wstring file(path);
                const auto slash = file.find_last_of(L"\\/");
                std::string name;
                for (const auto c : file.substr(slash == std::wstring::npos ? 0 : slash + 1))
                {
                    name += static_cast<char>(c < 128 ? c : '?');
                }
                char offset[32];
                std::snprintf(offset, sizeof(offset), "0x%llx", static_cast<unsigned long long>(handler - reinterpret_cast<uintptr_t>(module)));
                out["handler"] = {{"module", name}, {"offset", offset}, {"in_executable", reinterpret_cast<uintptr_t>(module) == exe}};
            }
        }
    }
    return out;
}

json ProbeClass(const char* aName, const std::vector<std::string>& aWanted, uintptr_t aHandlers)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* cls = rtti->GetClass(aName);
    if (!cls)
    {
        return json{{"class", aName}, {"present", false}};
    }
    json functions = json::array();
    const auto take = [&](RED4ext::CClassFunction* aFn) {
        const auto name = NameOf(aFn->shortName);
        if (!aWanted.empty() && std::find(aWanted.begin(), aWanted.end(), name) == aWanted.end())
        {
            return;
        }
        functions.push_back(DescribeFunction(aFn, aHandlers, aFn->regIndex, true));
    };
    for (uint32_t i = 0; i < cls->funcs.size; ++i)
    {
        take(cls->funcs.entries[i]);
    }
    for (uint32_t i = 0; i < cls->staticFuncs.size; ++i)
    {
        take(cls->staticFuncs.entries[i]);
    }
    return json{{"class", aName}, {"present", true}, {"functions_total", cls->funcs.size + cls->staticFuncs.size}, {"functions", functions}};
}

// Which DLL the executable's XInputGetState import entry points to now (a replaced entry would name another module).
json ProbeXInput()
{
    const auto base = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
    const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    const auto& dir = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    json out = json::array();
    if (!dir.VirtualAddress)
    {
        return out;
    }
    for (const auto* desc = reinterpret_cast<const IMAGE_IMPORT_DESCRIPTOR*>(base + dir.VirtualAddress); desc->Name; ++desc)
    {
        std::string dll(reinterpret_cast<const char*>(base + desc->Name));
        std::string lower = dll;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (lower.rfind("xinput", 0) != 0 || !desc->OriginalFirstThunk)
        {
            continue;
        }
        const auto* names = reinterpret_cast<const IMAGE_THUNK_DATA64*>(base + desc->OriginalFirstThunk);
        const auto* slots = reinterpret_cast<const IMAGE_THUNK_DATA64*>(base + desc->FirstThunk);
        for (; names->u1.AddressOfData; ++names, ++slots)
        {
            if (IMAGE_SNAP_BY_ORDINAL64(names->u1.Ordinal))
            {
                continue;
            }
            const auto* byName = reinterpret_cast<const IMAGE_IMPORT_BY_NAME*>(base + names->u1.AddressOfData);
            std::string function(reinterpret_cast<const char*>(byName->Name));
            HMODULE module = nullptr;
            std::string target = "?";
            if (slots->u1.Function && GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                                                         reinterpret_cast<LPCWSTR>(slots->u1.Function), &module))
            {
                wchar_t path[MAX_PATH]{};
                GetModuleFileNameW(module, path, MAX_PATH);
                std::wstring file(path);
                const auto slash = file.find_last_of(L"\\/");
                target.clear();
                for (const auto c : file.substr(slash == std::wstring::npos ? 0 : slash + 1))
                {
                    target += static_cast<char>(c < 128 ? c : '?');
                }
            }
            out.push_back({{"dll", dll}, {"function", function}, {"resolves_to", target}});
        }
    }
    return out;
}

json InputProbe(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    uintptr_t handlers = 0;
    if (const auto red4ext = GetModuleHandleW(L"RED4ext.dll"))
    {
        using Resolve_t = uintptr_t (*)(uint32_t);
        if (const auto resolve = reinterpret_cast<Resolve_t>(GetProcAddress(red4ext, "RED4ext_ResolveAddress")))
        {
            handlers = resolve(RED4ext::Detail::AddressHashes::CBaseFunction_Handlers);
        }
    }
    const std::vector<std::string> fake{"FakeInputPressAction", "FakeInputReleaseAction", "FakeInputHoldAction", "FakeInputClickAction",
                                        "FakeInputMultitapAction", "FakeInputAxisAction", "FakeInputReleaseAxisAction", "FakePressButton",
                                        "FakeReleaseButton", "FakeSetAxis", "TakeOverInput", "ReleaseAllInput", "LookAtPosition",
                                        "NavigateFlatTowards", "NotifyReachedCurrentDestination", "TeleportPlayer", "GetPlayerPosition",
                                        "GetPlayerOrientation"};
    json out{{"note", "read-only: nothing here calls any of these functions (player-control design §2.5 step 1)"}};
    out["functional_tests"] = ProbeClass("FunctionalTestsGameSystem", fake, handlers);
    out["player_functional_tests"] = ProbeClass("PlayerFunctionalTests", {"SetCameraOrientation"}, handlers);
    out["navigation_functional_tests"] = ProbeClass("NavigationFunctionalTests", {"GetPathOnNavmesh"}, handlers);
    out["ui_functional_tests"] = ProbeClass("UIFunctionalTests", {"Play", "IsPlaying"}, handlers);
    out["handler_table"] = handlers != 0 ? "resolved" : "not resolved (the handler offsets are missing)";
    // Is the test system in the game instance (CET creates it as a singleton for its spawner)?
    auto* engine = RED4ext::CGameEngine::Get();
    auto* cls = RED4ext::CRTTISystem::Get()->GetClass("FunctionalTestsGameSystem");
    if (engine && engine->framework && engine->framework->gameInstance && cls)
    {
        out["system_instance"] = engine->framework->gameInstance->GetSystem(cls) != nullptr;
    }
    // The game window in front?
    const auto foreground = GetForegroundWindow();
    DWORD pid = 0;
    if (foreground)
    {
        GetWindowThreadProcessId(foreground, &pid);
    }
    out["game_in_front"] = pid == GetCurrentProcessId();
    out["xinput_imports"] = ProbeXInput();
    return out;
}
} // namespace

void RestorePresetsAfterKill()
{
    std::map<int32_t, std::map<std::string, float>> originals;
    {
        std::scoped_lock _(g_presetMutex);
        originals.swap(g_presetOriginals);
    }
    for (const auto& [preset, flats] : originals)
    {
        if (flats.empty())
        {
            continue;
        }
        for (const auto& [name, value] : flats)
        {
            int32_t p = preset;
            RED4ext::CString flat(name.c_str());
            float v = value;
            ScriptCall("XFPresetRewrite", "Write", {"Int32", "String", "Float"}, {&p, &flat, &v}, "kill-restore");
        }
        int32_t p = preset;
        const auto committed = ScriptCall("XFPresetRewrite", "Commit", {"Int32"}, {&p}, "kill-restore");
        log::Info("bridge.kill_restored_preset", "preset=" + std::to_string(preset) + " flats=" + std::to_string(flats.size()) + " " + committed.dump(),
                  "kill-restore");
    }
}

void TickBehaviours(double aDt, bool aScriptsReady)
{
    auto& state = Get();
    if (!state.behaviours.Active())
    {
        return;
    }
    // A behaviour's running steps are writes: the kill switch, the panel's pause and a handover stop every behaviour, whose
    // stop steps (giving back what each held) then run on this tick.
    if (state.bridge)
    {
        const auto& dispatcher = state.bridge->GetDispatcher();
        if (dispatcher.IsKilled())
        {
            state.behaviours.StopAll("kill_switch");
        }
        else if (dispatcher.WritesPaused())
        {
            state.behaviours.StopAll("writes_paused");
        }
        else if (dispatcher.HandedOver())
        {
            state.behaviours.StopAll("handed_over");
        }
    }
    static const behave::Ops ops = BehaviourOps();
    state.behaviours.Tick(aDt, ops, aScriptsReady);
}

void RegisterMethods060(Dispatcher& aDispatcher)
{
    auto& state = Get();
    RegisterEventMethods(aDispatcher, state.events);
    state.behaviours.SetEvents(&state.events);
    aDispatcher.SetEventSink([](const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData) {
        Get().events.Push(aKind, aLevel, "bridge", aText, aData);
    });
    aDispatcher.Register({"scene.read", Access::Read, RunOn::GameThread,
                          "The camera, V, NPCs, showroom heads and rigs, photo-mode lights, world and UI, with occlusion rays and projections.", &SceneRead});
    aDispatcher.Register({"bridge.handover", Access::Control, RunOn::BridgeThread,
                          "Hands the session over to the player (every write refused, behaviours stopped) or resumes it.", &BridgeHandover});
    // One method per behaviour, each with its own write class (keep_framed also needs showroom for a showroom head).
    aDispatcher.Register({"behave.turntable", Access::WriteShowroom, RunOn::BridgeThread, "Turns showroom heads or rigs continuously.",
                          [](const MethodContext& aContext) { return BehaveStart("turntable", aContext); }});
    aDispatcher.Register({"behave.look", Access::WritePlayer, RunOn::BridgeThread, "Turns V's view to a point or angles over time.",
                          [](const MethodContext& aContext) { return BehaveStart("look", aContext); }});
    aDispatcher.Register({"behave.glide.path", Access::WritePlayer, RunOn::BridgeThread, "Glides V along a walkable path.",
                          [](const MethodContext& aContext) { return BehaveStart("glide_path", aContext); }});
    aDispatcher.Register({"behave.keep.framed", Access::WritePhoto, RunOn::BridgeThread, "Keeps a showroom head or V framed as the camera moves.",
                          [](const MethodContext& aContext) { return BehaveStart("keep_framed", aContext); }});
    aDispatcher.Register({"behave.stop", Access::Control, RunOn::BridgeThread, "Stops one behaviour or all.",
                          [](const MethodContext& aContext) { return Get().behaviours.Stop(aContext.params); }});
    aDispatcher.Register({"behave.list", Access::Read, RunOn::BridgeThread, "The running behaviours.", [](const MethodContext& aContext) {
                              params::RequireOnly(aContext.params, {});
                              return Get().behaviours.List();
                          }});
    aDispatcher.Register({"player.state", Access::Read, RunOn::GameThread, "V's position, facing, camera and state machine.", &PlayerState});
    aDispatcher.Register(MarkedWrite("player.teleport", Access::WritePlayer, RunOn::BridgeThread, "Teleports V with ground checks.", &PlayerTeleport));
    aDispatcher.Register(MarkedWrite("player.look", Access::WritePlayer, RunOn::BridgeThread, "Turns V's view, instantly or smoothly.", &PlayerLook));
    aDispatcher.Register(MarkedWrite("player.look.stop", Access::WritePlayer, RunOn::GameThread, "Ends a look.", &PlayerLookStop));
    aDispatcher.Register({"player.stop", Access::Control, RunOn::BridgeThread, "Stops every motion and lifts every effect the bridge put on V.", &PlayerStop});
    aDispatcher.Register({"player.interact.list", Access::Read, RunOn::GameThread, "What the HUD offers to interact with.", &PlayerInteractList});
    aDispatcher.Register({"player.action", Access::WritePlayer, RunOn::GameThread, "A system-driven action: crouch, stand, weapons, menus.", &PlayerAction});
    aDispatcher.Register(MarkedWrite("photo.camera.preset", Access::WritePhoto, RunOn::BridgeThread,
                                     "Research: rewrites a photo-mode camera preset through TweakXL, selects it and reads the camera back.", &PhotoCameraPreset));
    aDispatcher.Register({"input.probe", Access::Read, RunOn::GameThread, "Read-only probe of the game's test input system and the pad import.", &InputProbe});
}
} // namespace xfb::plugin
