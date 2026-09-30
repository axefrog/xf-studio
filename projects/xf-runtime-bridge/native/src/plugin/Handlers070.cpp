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
    const auto step = Game(
        [cid, request] {
            RED4ext::CString item(request.item.c_str());
            int32_t slot = request.slot;
            bool add = request.addIfMissing;
            return ScriptCall("XFCyberware", "Equip", {"String", "Int32", "Bool"}, {&item, &slot, &add}, cid);
        },
        "cyberware.equip");
    const auto area = step.value("area", std::string());
    const auto slot = step.value("slot", 0);
    const auto now = SettleSlot(cid, area, slot, [&](const json& aNow) { return aNow.value("item", std::string()) == request.item; });
    auto out = step;
    out["now"] = now.value("item", std::string());
    out["equipped"] = now.value("item", std::string()) == request.item;
    out["undo"] = h::CyberwareEquipUndo(step, request.item);
    out["undo_note"] = out["undo"].is_null() ? "it was already equipped: nothing changed"
                                             : "the result's undo puts the earlier item back (or empties the slot and removes an item the bridge added); loading the save undoes it too";
    if (!out["equipped"].get<bool>())
    {
        out["note"] = "the slot doesn't show the item yet: the game may still be applying it, or refused it (cyberware_state shows what V has)";
    }
    return out;
}

json CyberwareUnequip(const MethodContext& aContext)
{
    const auto request = h::ParseCyberwareUnequip(aContext.params);
    const auto cid = aContext.cid;
    RequireOpen();
    const auto step = Game(
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
        const auto removal = Game(
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
    PendingAsk ask;
    out["pending_ask"] = state.messages.Pending(ask) ? json{{"id", ask.id}, {"text", ask.text}, {"choices", ask.choices}, {"remaining_ms", ask.remainingMs}} : json(nullptr);
    out["overlay_host"] = state.overlayHost.Snapshot();
    return out;
}

// --- saves ----------------------------------------------------------------------------------------

json GameSaves(const MethodContext& aContext)
{
    const auto request = h::ParseSaves(aContext.params);
    const auto cid = aContext.cid;
    Game([cid] { return ScriptCall("XFGame", "SavesRequest", {}, {}, cid); }, "game.saves.request");
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(request.waitMs);
    json answer;
    size_t lastCount = 0;
    int stable = 0;
    while (std::chrono::steady_clock::now() < deadline)
    {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        answer = Game(
            [cid] {
                bool done = false;
                return ScriptCall("XFGame", "SavesAnswer", {"Bool"}, {&done}, cid);
            },
            "game.saves.read");
        const auto count = answer.value("metadata", json::array()).size();
        const auto names = answer.value("names", json::array()).size();
        stable = count == lastCount ? stable + 1 : 0;
        lastCount = count;
        if (answer.value("ready", false) && (count >= names || stable >= 3))
        {
            break;
        }
    }
    answer = Game(
        [cid] {
            bool done = true;
            return ScriptCall("XFGame", "SavesAnswer", {"Bool"}, {&done}, cid);
        },
        "game.saves.done");
    return h::TrimSaves(answer, request.limit);
}

// --- photo mode's scene rows ------------------------------------------------------------------------

json PhotoScene(const MethodContext& aContext)
{
    const auto request = h::ParsePhotoScene(aContext.params);
    const auto cid = aContext.cid;
    json applied = json::array();
    json undo = json::object();
    for (const auto& row : request.rows)
    {
        float value = static_cast<float>(row.value.value_or(0.0));
        json resolved = nullptr;
        if (!row.value)
        {
            int32_t key = row.key;
            RED4ext::CString label(row.label.c_str());
            resolved = ScriptCall("XFPhotoScene", "Resolve", {"Int32", "String"}, {&key, &label}, cid);
            value = resolved.value("value", 0.0f);
        }
        int32_t key = row.key;
        auto set = ScriptCall("XFPhoto", "SetAttribute", {"Int32", "Float"}, {&key, &value}, cid);
        if (!resolved.is_null())
        {
            set["matched_by"] = resolved.value("matched_by", std::string());
        }
        applied.push_back(set);
        const char* name = row.key == h::kPhotoNpcs ? "npcs" : row.key == h::kPhotoWeather ? "weather" : "game_speed";
        if (set.value("before_known", true))
        {
            undo[name] = name == std::string("game_speed") ? json(set.value("before", 1.0)) : json{{"value", set.value("before", 0.0)}};
        }
    }
    return json{{"applied", applied},
                {"undo", undo.empty() ? json(nullptr) : json{{"method", "photo.scene.set"}, {"params", undo}}},
                {"undo_note", "the result's undo sets the rows back; closing photo mode drops them too"}};
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
    aDispatcher.Register({"ui.state", Access::Read, RunOn::GameThread, "Menus, popups, photo mode's UI, the prompt, the CET overlay and the XF panels.", &UiState});
    aDispatcher.Register({"game.saves", Access::Read, RunOn::BridgeThread, "The save list with each save's details.", &GameSaves});
    aDispatcher.Register(MarkedWrite("photo.scene.set", Access::WritePhoto, RunOn::GameThread, "Photo mode's surrounding NPCs, weather and game speed rows.", &PhotoScene));
    aDispatcher.Register({"overlay.state", Access::Read, RunOn::BridgeThread, "The XF overlay host's state.", &OverlayState});
    aDispatcher.Register({"overlay.hide", Access::Notify, RunOn::BridgeThread, "Hides the XF overlay for a capture.", &OverlayHide});
}
} // namespace xfb::plugin
