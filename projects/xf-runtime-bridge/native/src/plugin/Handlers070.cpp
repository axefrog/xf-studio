// Bridge 0.7 methods that need the game (research/runtime/bridge-hook-inventory.md): cyberware, the world's state and
// streaming probes, the weather, the UI's state, the save list, photo mode's scene rows, and the overlay host's state.
// Every game call goes through the redscript layer (ScriptCall: a caller frame and a context; the game gate checked right
// before each step); parameters and undos are core/Hooks070.cpp, shared with the self-test host.

#include <RED4ext/RED4ext.hpp>

#include <chrono>
#include <thread>

#include "core/Hooks070.hpp"
#include "core/Log.hpp"
#include "core/Writes.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;
namespace h = xfb::hooks;

json Game(const std::function<json()>& aTask, const std::string& aLabel)
{
    return RunGameTask(Get().queue, GameTimeout(), aTask, aLabel);
}

// RB-122 (0.8.1): a game-thread step that changes the game, checked against the kill switch, the pause and a handover on the
// game thread right before it runs (Dispatcher::RunWrite).
json GameWrite(const std::function<json()>& aTask, const std::string& aLabel)
{
    auto& state = Get();
    if (!state.bridge)
    {
        throw MethodError("killed", "the bridge isn't running");
    }
    return state.bridge->GetDispatcher().RunWrite(GameTimeout(), aTask, aLabel);
}

void RequireOpen()
{
    if (auto& state = Get(); state.bridge)
    {
        state.bridge->GetDispatcher().RequireWritesOpen();
    }
}

// --- cyberware ------------------------------------------------------------------------------------

json CyberwareState(const MethodContext& aContext)
{
    const auto request = h::ParseCyberwareState(aContext.params);
    RED4ext::CString areas(h::AreasCsv(request.areas).c_str());
    return ScriptCall("XFCyberware", "State", {"String"}, {&areas}, aContext.cid);
}

json CyberwareSlot(const std::string& aCid, const std::string& aArea, int32_t aSlot)
{
    return Game(
        [aCid, aArea, aSlot] {
            RED4ext::CString area(aArea.c_str());
            int32_t slot = aSlot;
            return ScriptCall("XFCyberware", "Slot", {"String", "Int32"}, {&area, &slot}, aCid);
        },
        "cyberware.slot");
}

// Reads the slot until it shows what was asked (about a second at most): the equipment system handles its requests on
// later frames, as for clothing.
json SettleSlot(const std::string& aCid, const std::string& aArea, int32_t aSlot, const std::function<bool(const json&)>& aDone)
{
    json now;
    for (int attempt = 0; attempt < 8; ++attempt)
    {
        if (!writes::WaitTicks(Get().queue, 4, GameTimeout()))
        {
            throw MethodError("timeout", "the game didn't tick while the cyberware request was handled; cyberware_state shows what V has");
        }
        now = CyberwareSlot(aCid, aArea, aSlot);
        if (aDone(now))
        {
            break;
        }
    }
    return now;
}

json CyberwareEquip(const MethodContext& aContext)
{
    const auto request = h::ParseCyberwareEquip(aContext.params);
    const auto cid = aContext.cid;
    RequireOpen();
    h::CyberwareEquipOps ops;
    ops.equip = [cid, request] {
        return GameWrite(
            [cid, request] {
                RED4ext::CString item(request.item.c_str());
                RED4ext::CString hash(request.id.c_str());
                int32_t slot = request.slot;
                bool add = request.addIfMissing;
                return ScriptCall("XFCyberware", "Equip", {"String", "String", "Int32", "Bool"}, {&item, &hash, &slot, &add}, cid);
            },
            "cyberware.equip");
    };
    ops.settle = [cid, request](const std::string& aArea, int32_t aSlot) {
        return SettleSlot(cid, aArea, aSlot, [&](const json& aNow) { return aNow.value("item", std::string()) == request.item; });
    };
    ops.removeAdded = [cid](const std::string& aItem) {
        RequireOpen();
        return GameWrite(
            [cid, aItem] {
                RED4ext::CString item(aItem.c_str());
                return ScriptCall("XFInventory", "RemoveAdded", {"String"}, {&item}, cid);
            },
            "cyberware.remove");
    };
    // RB-101: once the equip step has run, its undo is answered whatever happens while the slot is read back.
    return h::RunCyberwareEquip(request, ops);
}

json CyberwareUnequip(const MethodContext& aContext)
{
    const auto request = h::ParseCyberwareUnequip(aContext.params);
    const auto cid = aContext.cid;
    RequireOpen();
    const auto step = GameWrite(
        [cid, request] {
            RED4ext::CString area(request.area.c_str());
            RED4ext::CString item(request.item.c_str());
            int32_t slot = request.slot;
            return ScriptCall("XFCyberware", "Unequip", {"String", "Int32", "String"}, {&area, &slot, &item}, cid);
        },
        "cyberware.unequip");
    const auto area = step.value("area", std::string());
    const auto slot = step.value("slot", 0);
    auto out = step;
    const auto now = SettleSlot(cid, area, slot, [](const json& aNow) { return aNow.value("empty", false); });
    out["emptied"] = now.value("empty", false);
    bool removed = false;
    if (request.removeAdded && out["emptied"].get<bool>())
    {
        RequireOpen();
        const auto removal = GameWrite(
            [cid, request] {
                RED4ext::CString item(request.item.c_str());
                return ScriptCall("XFInventory", "RemoveAdded", {"String"}, {&item}, cid);
            },
            "cyberware.remove");
        removed = removal.value("removed", false);
        out["removed"] = removed;
    }
    out["undo"] = h::CyberwareUnequipUndo(step, removed);
    out["undo_note"] = out["undo"].is_null() ? "nothing to put back (the slot was empty, or the added item was removed)"
                                             : "the result's undo equips the item again; loading the save undoes it too";
    return out;
}

// --- the world ------------------------------------------------------------------------------------

json WorldState(const MethodContext& aContext)
{
    const auto request = h::ParseWorldState(aContext.params);
    RED4ext::CString facts(h::AreasCsv(request.facts).c_str());
    return ScriptCall("XFWorldState", "State", {"String"}, {&facts}, aContext.cid);
}

json WorldProbe(const MethodContext& aContext)
{
    const auto request = h::ParseWorldProbe(aContext.params);
    const auto cid = aContext.cid;
    auto points = request.points;
    json around = nullptr;
    if (request.aroundV)
    {
        const auto where = Game([cid] { return ScriptCall("XFPlayer", "Where", {}, {}, cid); }, "player.where");
        const auto p = where.at("position");
        const std::array<double, 3> centre{p[0].get<double>(), p[1].get<double>(), p[2].get<double>()};
        points = h::RingPoints(centre, where.value("yaw", 0.0), request.ringM, request.count);
        around = {{"centre", p}, {"yaw", where.value("yaw", 0.0)}, {"ring_m", request.ringM}};
    }
    json probes = json::array();
    for (const auto& point : points)
    {
        probes.push_back(Game(
            [cid, point, request] {
                float x = static_cast<float>(point[0]), y = static_cast<float>(point[1]), z = static_cast<float>(point[2]);
                float radius = static_cast<float>(request.radius), down = static_cast<float>(request.down), clearance = static_cast<float>(request.clearance);
                bool hasSight = request.sightFrom.has_value();
                float sx = hasSight ? static_cast<float>((*request.sightFrom)[0]) : 0.0f, sy = hasSight ? static_cast<float>((*request.sightFrom)[1]) : 0.0f,
                      sz = hasSight ? static_cast<float>((*request.sightFrom)[2]) : 0.0f;
                return ScriptCall("XFWorldState", "Probe", {"Float", "Float", "Float", "Float", "Float", "Float", "Bool", "Float", "Float", "Float"},
                                  {&x, &y, &z, &radius, &down, &clearance, &hasSight, &sx, &sy, &sz}, cid);
            },
            "world.probe"));
    }
    json out{{"probes", probes}, {"note", "observe only: nothing is moved or loaded; navmesh_streamed false means the world around that point isn't loaded now"}};
    if (!around.is_null())
    {
        out["around_v"] = around;
    }
    return out;
}

json WorldWeather(const MethodContext& aContext)
{
    const auto request = h::ParseWeather(aContext.params);
    RED4ext::CString name(request.name.c_str());
    float blend = static_cast<float>(request.blend);
    bool cycle = request.cycle;
    auto out = ScriptCall("XFWeather", "Set", {"String", "Float", "Bool"}, {&name, &blend, &cycle}, aContext.cid);
    out["undo"] = h::WeatherUndo(out);
    out["undo_note"] = "the result's undo sets the earlier weather back and gives it to the game's own cycle again; the kill switch does the same";
    return out;
}

// --- the UI ---------------------------------------------------------------------------------------

json UiState(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    auto out = ScriptCall("XFUi", "State", {}, {}, aContext.cid);
    auto& state = Get();
    out["cet_overlay"] = state.cetOverlaySeen.load() ? json(state.cetOverlayOpen.load()) : json(nullptr);
    if (!state.cetOverlaySeen.load())
    {
        out["cet_overlay_note"] = "the CET layer hasn't reported its overlay yet (it does from bridge 0.7 when the overlay opens or closes)";
    }
    out["xf_panel"] = state.hud.Current().show;
    // 0.8.2: the XF pins with the views that have drawn each (world.pin's drawn_by, read after the views ran).
    try
    {
        out["pins"] = ScriptCall("XFInkPins", "Pins", {}, {}, aContext.cid).value("pins", json::array());
    }
    catch (const MethodError& e)
    {
        out["pins"] = nullptr;
        out["pins_error"] = e.code;
    }
    PendingAsk ask;
    out["pending_ask"] = state.messages.Pending(ask) ? json{{"id", ask.id}, {"text", ask.text}, {"choices", ask.choices}, {"remaining_ms", ask.remainingMs}} : json(nullptr);
    out["overlay_host"] = state.overlayHost.Snapshot();
    return out;
}

// ui.ask.state {id} (RB-96, RB-103; tools only): what became of a question: pending, answered (with the answer), gone or
// unknown. Bridge thread: the message board only.
json UiAskState(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {"id"});
    const auto id = static_cast<uint64_t>(params::CheckInteger(aContext.params, "id", 1, 1000000000).value_or(0));
    if (id == 0)
    {
        throw MethodError("bad_params", "give id: the question's message id (ui_message's answer)");
    }
    return AskStateJson(id, Get().messages.StateOf(id));
}

// --- saves ----------------------------------------------------------------------------------------

json GameSaves(const MethodContext& aContext)
{
    const auto request = h::ParseSaves(aContext.params);
    const auto cid = aContext.cid;
    h::SavesOps ops;
    ops.request = [cid](int32_t aLimit) {
        Game(
            [cid, aLimit] {
                int32_t limit = aLimit;
                return ScriptCall("XFGame", "SavesRequest", {"Int32"}, {&limit}, cid);
            },
            "game.saves.request");
    };
    ops.read = [cid](bool aDone) {
        return Game(
            [cid, aDone] {
                bool done = aDone;
                return ScriptCall("XFGame", "SavesAnswer", {"Bool"}, {&done}, cid);
            },
            aDone ? "game.saves.done" : "game.saves.read");
    };
    ops.sleep = [](std::chrono::milliseconds aMs) { std::this_thread::sleep_for(aMs); };
    ops.now = [] { return std::chrono::steady_clock::now(); };
    // RB-118: the final step that stops collecting runs even when a read throws.
    return h::RunSaves(request, ops);
}

// --- photo mode's scene rows ------------------------------------------------------------------------

json PhotoScene(const MethodContext& aContext)
{
    const auto request = h::ParsePhotoScene(aContext.params);
    const auto cid = aContext.cid;
    h::PhotoSceneOps ops;
    ops.resolve = [cid](const h::PhotoSceneRow& aRow) {
        int32_t key = aRow.key;
        RED4ext::CString label(aRow.label.c_str());
        return ScriptCall("XFPhotoScene", "Resolve", {"Int32", "String"}, {&key, &label}, cid);
    };
    ops.set = [cid](int32_t aKey, double aValue) {
        int32_t key = aKey;
        float value = static_cast<float>(aValue);
        return ScriptCall("XFPhoto", "SetAttribute", {"Int32", "Float"}, {&key, &value}, cid);
    };
    // RB-111: a row that fails puts the rows already set back before the refusal.
    return h::RunPhotoScene(request, ops);
}

// --- the overlay host -----------------------------------------------------------------------------

json OverlayState(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    return Get().overlayHost.Snapshot();
}

json OverlayHide(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {"hidden", "ms"});
    const auto hidden = params::CheckBoolean(aContext.params, "hidden").value_or(true);
    const auto ms = static_cast<uint32_t>(params::CheckInteger(aContext.params, "ms", 50, 10000).value_or(3000));
    auto& host = Get().overlayHost;
    host.HideForCapture(hidden, ms);
    return json{{"hidden_for_capture", host.HiddenForCapture()}, {"ms", ms}, {"undo", {{"method", "overlay.hide"}, {"params", {{"hidden", false}}}}},
                {"undo_note", "the panel comes back by itself after ms"}};
}
} // namespace

void RegisterMethods070(Dispatcher& aDispatcher)
{
    aDispatcher.Register({"cyberware.state", Access::Read, RunOn::GameThread, "V's cyberware by area, and the arms' holster chain.", &CyberwareState});
    aDispatcher.Register(MarkedWrite("cyberware.equip", Access::WriteInventory, RunOn::BridgeThread, "Equips a cyberware item (adding it only if asked).", &CyberwareEquip));
    aDispatcher.Register(MarkedWrite("cyberware.unequip", Access::WriteInventory, RunOn::BridgeThread, "Empties a cyberware slot.", &CyberwareUnequip));
    aDispatcher.Register({"world.state", Access::Read, RunOn::GameThread, "The clock, rain, weather state, quest facts and photo mode's scene rows.", &WorldState});
    aDispatcher.Register({"world.probe", Access::Read, RunOn::BridgeThread, "Streaming, walkable ground, ground and ceiling at points (observe only).", &WorldProbe});
    aDispatcher.Register(MarkedWrite("world.weather.set", Access::WriteWorld, RunOn::GameThread, "Holds a weather state or gives the weather back to the game.", &WorldWeather));
    aDispatcher.Register({"ui.state", Access::Read, RunOn::GameThread, "Menus, popups, photo mode's UI, the prompt, the CET overlay, the ink panel and the XF pins.", &UiState});
    aDispatcher.Register({"ui.ask.state", Access::Read, RunOn::BridgeThread, "What became of a question (pending, answered, gone).", &UiAskState});
    aDispatcher.Register({"game.saves", Access::Read, RunOn::BridgeThread, "The save list with each save's details.", &GameSaves});
    aDispatcher.Register(MarkedWrite("photo.scene.set", Access::WritePhoto, RunOn::GameThread, "Photo mode's surrounding NPCs, weather and game speed rows.", &PhotoScene));
    aDispatcher.Register({"overlay.state", Access::Read, RunOn::BridgeThread, "The XF overlay host's state.", &OverlayState});
    aDispatcher.Register({"overlay.hide", Access::Notify, RunOn::BridgeThread, "Hides the XF overlay for a capture.", &OverlayHide});
}
} // namespace xfb::plugin
