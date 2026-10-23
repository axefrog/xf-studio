#include "selftest/Sim070.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <map>
#include <mutex>
#include <set>
#include <vector>

#include "core/Hooks070.hpp"
#include "core/Params.hpp"
#include "core/overlay/Host.hpp"

namespace xfb::selftest
{
namespace
{
using json = nlohmann::json;
namespace h = xfb::hooks;

// The simulated records: an item's cyberware area, and a weapon record's holster appearance (the arms' chain).
const std::map<std::string, std::string> kAreas{{"Items.StrongArms", "ArmsCW"},       {"Items.MantisBlades", "ArmsCW"},     {"Items.NanoWires", "ArmsCW"},
                                                {"Items.ProjectileLauncher", "ArmsCW"}, {"Items.KiroshiOptics", "EyesCW"},  {"Items.ReinforcedTendons", "LegsCW"},
                                                {"Items.SubdermalArmor", "IntegumentarySystemCW"}};
const std::map<std::string, std::string> kHolster{{"Items.StrongArms", "holstered_strong"},
                                                  {"Items.MantisBlades", "holstered_mantis"},
                                                  {"Items.NanoWires", "holstered_nanowire"},
                                                  {"Items.ProjectileLauncher", "holstered_launcher"}};
// RB-101: a record V can't equip (a requirement the simulated V doesn't meet).
const std::string kNotEquippable = "Items.ProjectileLauncher";
const std::vector<std::string> kWeathers{"24h_weather_sunny", "24h_weather_light_clouds", "24h_weather_rain", "24h_weather_fog"};

struct State
{
    std::mutex mutex;
    std::map<std::string, std::vector<std::string>> slots; // area -> item per slot ("" empty)
    std::set<std::string> inventory{"Items.MantisBlades", "Items.KiroshiOptics"};
    std::set<std::string> added;
    // RB-102: the slots before the bridge's first cyberware change (the kill switch puts them back).
    std::map<std::string, std::vector<std::string>> cyberwareBefore;
    bool cyberwareSnapshot = false;
    // RB-101: selftest.cyberware {fail_settle: code} makes the next slot read-back fail with that code.
    std::string failSettle;
    std::string weather = "24h_weather_sunny";
    bool weatherChanged = false;
    std::string weatherEarlier;
    bool cycle = true;
    std::map<int32_t, double> photoRows{{54, 1.0}, {69, 0.0}, {71, 1.0}};
    xfb::overlay::OverlayHost overlay;
};
State* gState = nullptr;

// The simulated static wall (as Sim060's occluder): a box beside V's place.
bool HitsWall(const std::array<double, 3>& aFrom, const std::array<double, 3>& aTo, double& aT)
{
    const double lo[3]{100.8, 199.0, 9.0}, hi[3]{103.0, 199.4, 13.0};
    double t0 = 0.0, t1 = 1.0;
    for (int i = 0; i < 3; ++i)
    {
        const double d = aTo[i] - aFrom[i];
        if (std::abs(d) < 1e-9)
        {
            if (aFrom[i] < lo[i] || aFrom[i] > hi[i])
            {
                return false;
            }
            continue;
        }
        double a = (lo[i] - aFrom[i]) / d, b = (hi[i] - aFrom[i]) / d;
        if (a > b)
        {
            std::swap(a, b);
        }
        t0 = std::max(t0, a);
        t1 = std::min(t1, b);
        if (t0 > t1)
        {
            return false;
        }
    }
    aT = t0;
    return true;
}

int32_t SlotCount(const std::string& aArea)
{
    return aArea == "IntegumentarySystemCW" || aArea == "FrontalCortexCW" ? 3 : 1;
}

std::vector<std::string>& SlotsOf(State& aState, const std::string& aArea)
{
    auto& slots = aState.slots[aArea];
    slots.resize(static_cast<size_t>(SlotCount(aArea)));
    return slots;
}

void SnapshotCyberware(State& aState)
{
    if (!aState.cyberwareSnapshot)
    {
        for (const auto& area : h::CyberwareAreas())
        {
            aState.cyberwareBefore[area] = SlotsOf(aState, area);
        }
        aState.cyberwareSnapshot = true;
    }
}

bool CyberwareChanged(State& aState)
{
    if (!aState.added.empty())
    {
        return true;
    }
    if (!aState.cyberwareSnapshot)
    {
        return false;
    }
    for (const auto& area : h::CyberwareAreas())
    {
        if (SlotsOf(aState, area) != aState.cyberwareBefore[area])
        {
            return true;
        }
    }
    return false;
}

void RequireGameplay(const Sim070Hooks& aHooks, const char* aWhat)
{
    const auto phase = aHooks.phase();
    if (phase != "gameplay")
    {
        throw MethodError("not_in_gameplay", std::string("simulated: ") + aWhat + " only in normal play; the game is in '" + phase + "'");
    }
}
} // namespace

void RegisterSim070(Dispatcher& aDispatcher, GameThreadQueue&, const Config& aConfig, Sim070Hooks aHooks)
{
    static State state;
    gState = &state;
    state.slots["ArmsCW"] = {""};
    state.slots["EyesCW"] = {"Items.KiroshiOptics"};
    state.overlay.Configure(true, xfb::overlay::ThemeFromName(aConfig.overlayTheme), aConfig.overlayScalePercent);
    state.overlay.NoteHooks(true, true, true, "");
    xfb::overlay::DeviceFacts facts;
    facts.deviceData = facts.swapChain = facts.directQueue = facts.sameDevice = true;
    facts.format = "R8G8B8A8_UNORM";
    facts.windowClass = "W2ViewportClass";
    facts.bufferCount = 3;
    facts.width = 3840;
    facts.height = 1600;
    state.overlay.NoteInit(facts, xfb::overlay::RefusalFor(facts));
    auto hooks = std::make_shared<Sim070Hooks>(std::move(aHooks));

    aDispatcher.Register({"cyberware.state", Access::Read, RunOn::GameThread, "V's cyberware (simulated).", [hooks](const MethodContext& aContext) {
                              const auto request = h::ParseCyberwareState(aContext.params);
                              std::scoped_lock _(state.mutex);
                              json areas = json::array();
                              for (const auto& area : h::CyberwareAreas())
                              {
                                  if (!request.areas.empty() && std::find(request.areas.begin(), request.areas.end(), area) == request.areas.end())
                                  {
                                      continue;
                                  }
                                  json items = json::array();
                                  const auto& slots = SlotsOf(state, area);
                                  for (size_t i = 0; i < slots.size(); ++i)
                                  {
                                      if (!slots[i].empty())
                                      {
                                          items.push_back({{"slot", i}, {"item", slots[i]}, {"label", slots[i].substr(6)}});
                                      }
                                  }
                                  areas.push_back({{"area", area}, {"slots", slots.size()}, {"items", items}});
                              }
                              const auto arms = SlotsOf(state, "ArmsCW")[0];
                              const auto holster = arms.empty() ? std::string("holstered_default") : kHolster.count(arms) ? kHolster.at(arms) : std::string();
                              // 0.8: drawn by XFCyberware.ArmsDrawn's rule (the weapon slot holds the arm cyberware).
                              const bool drawn = !arms.empty() && hooks->weaponDrawn && hooks->weaponDrawn();
                              return json{{"simulated", true},
                                          {"areas", areas},
                                          {"arms", {{"item", arms}, {"holster_state", holster}, {"creator_group", holster.empty() ? "" : holster + "_tpp"},
                                                    {"holstered_item", arms.empty() ? "Items.HolsteredFists" : "Items.Holstered" + arms.substr(6)},
                                                    {"right_arm_slot", drawn ? json(nullptr) : json{{"item", arms.empty() ? "Items.HolsteredFists" : "Items.Holstered" + arms.substr(6)}, {"appearance", holster}}},
                                                    {"weapon_right_slot", drawn ? json{{"item", arms}, {"appearance", "None"}} : json(nullptr)}, {"no_arms_cw_effect", false},
                                                    {"drawn", drawn}}},
                                          {"capacity", {{"humanity_available", 40}, {"humanity_total", 60}}}};
                          }});
    aDispatcher.Register({"cyberware.equip", Access::WriteInventory, RunOn::BridgeThread, "Equips cyberware (simulated).", [hooks](const MethodContext& aContext) {
                              const auto request = h::ParseCyberwareEquip(aContext.params);
                              hooks->markWrite();
                              h::CyberwareEquipOps ops;
                              // The script's step, as XFCyberware.Equip: checks first; an item V can't equip is refused before
                              // anything changes, and an added copy is taken out again (RB-101).
                              ops.equip = [hooks, request] {
                                  RequireGameplay(*hooks, "cyberware is changed");
                                  std::scoped_lock _(state.mutex);
                                  const auto found = kAreas.find(request.item);
                                  if (found == kAreas.end())
                                  {
                                      throw MethodError("bad_params", "simulated: '" + request.item + "' isn't a cyberware item record");
                                  }
                                  // RB-112 / 0.8: arm cyberware isn't swapped while it is drawn.
                                  if (found->second == "ArmsCW" && !SlotsOf(state, "ArmsCW")[0].empty() && hooks->weaponDrawn && hooks->weaponDrawn())
                                  {
                                      throw MethodError("arms_drawn", "simulated: V has her arm cyberware out (the right weapon slot holds " + SlotsOf(state, "ArmsCW")[0] + ")");
                                  }
                                  const bool had = state.inventory.count(request.item) != 0;
                                  if (!had && !request.addIfMissing)
                                  {
                                      throw MethodError("not_in_inventory", "simulated: V doesn't have '" + request.item + "'; pass add_if_missing to add one");
                                  }
                                  if (request.item == kNotEquippable)
                                  {
                                      throw MethodError("not_equippable", std::string("simulated: the game says V can't equip '") + request.item + "' now" +
                                                                             (had ? "" : "; nothing was added"));
                                  }
                                  auto& slots = SlotsOf(state, found->second);
                                  int32_t slot = request.slot;
                                  if (slot < 0)
                                  {
                                      const auto empty = std::find(slots.begin(), slots.end(), std::string());
                                      slot = empty == slots.end() ? 0 : static_cast<int32_t>(empty - slots.begin());
                                  }
                                  if (slot >= static_cast<int32_t>(slots.size()))
                                  {
                                      throw MethodError("bad_params", "simulated: " + found->second + " has " + std::to_string(slots.size()) + " slot(s)");
                                  }
                                  bool added = false;
                                  if (!had)
                                  {
                                      state.inventory.insert(request.item);
                                      state.added.insert(request.item);
                                      added = true;
                                  }
                                  hooks->takeSaveLock();
                                  SnapshotCyberware(state);
                                  const auto previous = slots[static_cast<size_t>(slot)];
                                  const bool already = previous == request.item;
                                  slots[static_cast<size_t>(slot)] = request.item;
                                  json step{{"simulated", true}, {"item", request.item}, {"area", found->second}, {"slot", slot}, {"added", added},
                                            {"already_equipped", already}, {"previous", previous}};
                                  if (!previous.empty())
                                  {
                                      step["id"] = std::to_string(std::hash<std::string>{}(previous) % 1000000007ull);
                                  }
                                  return step;
                              };
                              ops.settle = [](const std::string& aArea, int32_t aSlot) {
                                  std::scoped_lock _(state.mutex);
                                  if (!state.failSettle.empty())
                                  {
                                      const auto code = state.failSettle;
                                      state.failSettle.clear();
                                      throw MethodError(code, "simulated: the game didn't tick while the cyberware request was handled");
                                  }
                                  const auto item = SlotsOf(state, aArea).at(static_cast<size_t>(aSlot));
                                  return json{{"item", item}, {"empty", item.empty()}};
                              };
                              ops.removeAdded = [](const std::string& aItem) {
                                  std::scoped_lock _(state.mutex);
                                  const bool removed = state.added.erase(aItem) != 0;
                                  if (removed)
                                  {
                                      state.inventory.erase(aItem);
                                  }
                                  return json{{"removed", removed}};
                              };
                              return h::RunCyberwareEquip(request, ops);
                          }});
    aDispatcher.Register({"selftest.cyberware", Access::Read, RunOn::BridgeThread, "Makes the next cyberware slot read-back fail (self-test only).",
                          [](const MethodContext& aContext) {
                              std::scoped_lock _(state.mutex);
                              state.failSettle = aContext.params.value("fail_settle", std::string());
                              return json{{"fail_settle", state.failSettle}, {"inventory", state.inventory}, {"added", state.added}};
                          }});
    aDispatcher.Register({"cyberware.unequip", Access::WriteInventory, RunOn::BridgeThread, "Empties a cyberware slot (simulated).", [hooks](const MethodContext& aContext) {
                              const auto request = h::ParseCyberwareUnequip(aContext.params);
                              hooks->markWrite();
                              RequireGameplay(*hooks, "cyberware is changed");
                              std::scoped_lock _(state.mutex);
                              auto area = request.area;
                              if (!request.item.empty())
                              {
                                  const auto found = kAreas.find(request.item);
                                  if (found == kAreas.end())
                                  {
                                      throw MethodError("bad_params", "simulated: '" + request.item + "' isn't a cyberware item record");
                                  }
                                  area = found->second;
                              }
                              auto& slots = SlotsOf(state, area);
                              int32_t slot = request.slot < 0 ? 0 : request.slot;
                              if (!request.item.empty() && request.slot < 0)
                              {
                                  const auto held = std::find(slots.begin(), slots.end(), request.item);
                                  slot = held == slots.end() ? 0 : static_cast<int32_t>(held - slots.begin());
                              }
                              const auto previous = slots.at(static_cast<size_t>(std::min<int32_t>(slot, static_cast<int32_t>(slots.size()) - 1)));
                              if (!request.item.empty() && previous != request.item)
                              {
                                  throw MethodError("bad_params", "simulated: " + area + " slot " + std::to_string(slot) + " holds '" + previous + "', not '" + request.item + "'");
                              }
                              hooks->takeSaveLock();
                              SnapshotCyberware(state);
                              slots[static_cast<size_t>(slot)].clear();
                              bool removed = false;
                              if (request.removeAdded && state.added.count(request.item))
                              {
                                  state.added.erase(request.item);
                                  state.inventory.erase(request.item);
                                  removed = true;
                              }
                              json step{{"area", area}, {"slot", slot}, {"previous", previous}, {"was_empty", previous.empty()}};
                              auto out = step;
                              out["simulated"] = true;
                              out["emptied"] = true;
                              if (request.removeAdded)
                              {
                                  out["removed"] = removed;
                              }
                              out["undo"] = h::CyberwareUnequipUndo(step, removed);
                              return out;
                          }});
    aDispatcher.Register({"world.state", Access::Read, RunOn::GameThread, "The world (simulated).", [hooks](const MethodContext& aContext) {
                              const auto request = h::ParseWorldState(aContext.params);
                              std::scoped_lock _(state.mutex);
                              json facts = json::object();
                              for (const auto& fact : request.facts)
                              {
                                  facts[fact] = fact == "tutorial_ripperdoc_eyes_passed" ? 1 : 0;
                              }
                              const bool photo = hooks->phase() == "photo_mode";
                              json rows = nullptr;
                              if (photo)
                              {
                                  rows = {{"menu_seen", true}, {"rows", json::array()}};
                                  for (const auto& [key, value] : state.photoRows)
                                  {
                                      rows["rows"].push_back({{"key", key}, {"value", value}});
                                  }
                              }
                              return json{{"simulated", true},
                                          {"clock", {{"day", 3}, {"hours", 14}, {"minutes", 30}, {"seconds", 0}, {"paused", false}, {"time_dilation_active", false}}},
                                          {"rain", {{"type", "NoRain"}, {"intensity", 0.0}, {"puddles", 0.0}, {"moisture", 0.0}}},
                                          {"weather", {{"readable", true}, {"name", state.weather}, {"set_by_bridge", state.weatherChanged}, {"states", kWeathers}}},
                                          {"facts", facts},
                                          {"photo_mode", rows}};
                          }});
    aDispatcher.Register({"world.probe", Access::Read, RunOn::BridgeThread, "Streaming and ground (simulated).", [](const MethodContext& aContext) {
                              const auto request = h::ParseWorldProbe(aContext.params);
                              auto points = request.points;
                              const std::array<double, 3> v{100.0, 200.0, 10.0};
                              if (request.aroundV)
                              {
                                  points = h::RingPoints(v, 0.0, request.ringM, request.count);
                              }
                              json probes = json::array();
                              for (const auto& p : points)
                              {
                                  const double far = std::hypot(p[0] - v[0], p[1] - v[1]);
                                  json o{{"point", {p[0], p[1], p[2]}}, {"navmesh_streamed", far < 60.0}, {"from_v_m", far}};
                                  if (far < 60.0)
                                  {
                                      o["walkable"] = {p[0], p[1], 10.0};
                                      o["walkable_off_m"] = std::abs(p[2] - 10.0);
                                  }
                                  o["ground"] = p[2] >= 10.0 && p[2] - 10.0 <= request.down ? json{{"z", 10.0}, {"below_m", p[2] - 10.0}, {"material", "concrete"}} : json(nullptr);
                                  o["ceiling_m"] = nullptr;
                                  if (request.clearance > 0.0)
                                  {
                                      int blocked = 0;
                                      double nearest = request.clearance;
                                      json yaws = json::array();
                                      for (int i = 0; i < 8; ++i)
                                      {
                                          const double a = 45.0 * i * 3.14159265358979323846 / 180.0;
                                          const std::array<double, 3> end{p[0] - std::sin(a) * request.clearance, p[1] + std::cos(a) * request.clearance, p[2]};
                                          double t = 0.0;
                                          if (HitsWall(p, end, t))
                                          {
                                              ++blocked;
                                              nearest = std::min(nearest, t * request.clearance);
                                              yaws.push_back(45 * i);
                                          }
                                      }
                                      o["clearance"] = {{"radius_m", request.clearance}, {"blocked", blocked}, {"nearest_m", nearest}, {"blocked_yaws", yaws}};
                                  }
                                  if (request.sightFrom)
                                  {
                                      double t = 0.0;
                                      const bool hit = HitsWall(*request.sightFrom, p, t);
                                      o["sight"] = {{"checked", true}, {"blocked", hit && t < 0.98}};
                                  }
                                  probes.push_back(o);
                              }
                              json out{{"simulated", true}, {"probes", probes}};
                              if (request.aroundV)
                              {
                                  out["around_v"] = {{"centre", {v[0], v[1], v[2]}}, {"yaw", 0.0}, {"ring_m", request.ringM}};
                              }
                              return out;
                          }});
    aDispatcher.Register({"world.weather.set", Access::WriteWorld, RunOn::GameThread, "The weather (simulated).", [hooks](const MethodContext& aContext) {
                              const auto request = h::ParseWeather(aContext.params);
                              hooks->markWrite();
                              const auto phase = hooks->phase();
                              if (phase != "gameplay" && phase != "photo_mode")
                              {
                                  throw MethodError("not_in_gameplay", "simulated: the weather is set in normal play or photo mode");
                              }
                              std::scoped_lock _(state.mutex);
                              if (!request.name.empty() && std::find(kWeathers.begin(), kWeathers.end(), request.name) == kWeathers.end())
                              {
                                  throw MethodError("bad_params", "simulated: '" + request.name + "' isn't one of this world's weather states");
                              }
                              hooks->takeSaveLock();
                              const auto before = state.weather;
                              // RB-110: the bridge counts the weather as its own only once the change took.
                              if (!request.name.empty())
                              {
                                  state.weather = request.name;
                                  state.cycle = false;
                              }
                              if (!state.weatherChanged)
                              {
                                  state.weatherChanged = true;
                                  state.weatherEarlier = before;
                              }
                              if (request.cycle)
                              {
                                  state.cycle = true;
                                  if (request.name.empty() || request.name == state.weatherEarlier)
                                  {
                                      state.weatherChanged = false;
                                  }
                              }
                              json step{{"before", before}, {"after", request.name}, {"cycle", request.cycle}, {"blend_s", request.blend}};
                              auto out = step;
                              out["simulated"] = true;
                              out["undo"] = h::WeatherUndo(step);
                              return out;
                          }});
    aDispatcher.Register({"ui.state", Access::Read, RunOn::GameThread, "The UI (simulated).", [hooks](const MethodContext& aContext) {
                              params::RequireOnly(aContext.params, {});
                              const auto phase = hooks->phase();
                              return json{{"simulated", true},
                                          {"phase", phase},
                                          {"menu_open", phase == "menu" || phase == "character_menu"},
                                          {"popup", {{"shown", false}, {"modal", false}}},
                                          {"photo_mode", phase == "photo_mode"},
                                          {"tier", "full"},
                                          {"hud_prompt", nullptr},
                                          {"cet_overlay", false},
                                          {"pending_ask", hooks->pendingAsk()},
                                          {"overlay_host", state.overlay.Snapshot()}};
                          }});
    aDispatcher.Register({"game.saves", Access::Read, RunOn::BridgeThread, "The save list (simulated).", [](const MethodContext& aContext) {
                              const auto request = h::ParseSaves(aContext.params);
                              const json answer{{"ready", true},
                                                {"names", {"ManualSave-3", "AutoSave-12", "ManualSave-2"}},
                                                {"metadata",
                                                 {{{"index", 0}, {"name", "ManualSave-3"}, {"type", "ManualSave"}, {"location", "Watson"}, {"timestamp", 300}, {"modded", true}},
                                                  {{"index", 1}, {"name", "AutoSave-12"}, {"type", "AutoSave"}, {"location", "Watson"}, {"timestamp", 400}, {"modded", true}},
                                                  {{"index", 2}, {"name", "ManualSave-2"}, {"type", "ManualSave"}, {"location", "Kabuki"}, {"timestamp", 100}, {"modded", true}}}}};
                              h::SavesOps ops;
                              ops.request = [](int32_t) {};
                              ops.read = [answer](bool) { return answer; };
                              ops.sleep = [](std::chrono::milliseconds) {};
                              ops.now = [] { return std::chrono::steady_clock::now(); };
                              auto out = h::RunSaves(request, ops);
                              out["simulated"] = true;
                              return out;
                          }});
    aDispatcher.Register({"photo.scene.set", Access::WritePhoto, RunOn::GameThread, "Photo mode's scene rows (simulated).", [hooks](const MethodContext& aContext) {
                              const auto request = h::ParsePhotoScene(aContext.params);
                              hooks->markWrite();
                              if (hooks->phase() != "photo_mode")
                              {
                                  throw MethodError("not_in_photo_mode", "simulated: photo mode is not open");
                              }
                              h::PhotoSceneOps ops;
                              ops.resolve = [](const h::PhotoSceneRow& aRow) {
                                  static const std::map<int32_t, std::vector<std::string>> options{{54, {"Off", "On"}}, {69, {"Default", "Sunny", "Rain"}}};
                                  const auto& list = options.at(aRow.key);
                                  const auto hit = std::find(list.begin(), list.end(), aRow.label);
                                  if (hit == list.end())
                                  {
                                      throw MethodError("bad_params", "simulated: no option of photo-mode row " + std::to_string(aRow.key) + " is labelled '" + aRow.label + "'");
                                  }
                                  return json{{"value", static_cast<double>(hit - list.begin())}, {"matched_by", "exact"}};
                              };
                              ops.set = [](int32_t aKey, double aValue) {
                                  std::scoped_lock _(state.mutex);
                                  const auto before = state.photoRows[aKey];
                                  state.photoRows[aKey] = aValue;
                                  return json{{"key", aKey}, {"before", before}, {"before_known", true}, {"after", aValue}};
                              };
                              auto out = h::RunPhotoScene(request, ops);
                              out["simulated"] = true;
                              return out;
                          }});
    aDispatcher.Register({"overlay.state", Access::Read, RunOn::BridgeThread, "The overlay host (simulated renderer).", [hooks](const MethodContext& aContext) {
                              params::RequireOnly(aContext.params, {});
                              state.overlay.SetKilled(hooks->killed());
                              auto out = state.overlay.Snapshot();
                              out["simulated"] = true;
                              return out;
                          }});
    aDispatcher.Register({"overlay.hide", Access::Notify, RunOn::BridgeThread, "Hides the overlay for a capture (simulated).", [](const MethodContext& aContext) {
                              params::RequireOnly(aContext.params, {"hidden", "ms"});
                              const auto hidden = params::CheckBoolean(aContext.params, "hidden").value_or(true);
                              const auto ms = static_cast<uint32_t>(params::CheckInteger(aContext.params, "ms", 50, 10000).value_or(3000));
                              state.overlay.HideForCapture(hidden, ms);
                              return json{{"simulated", true}, {"hidden_for_capture", state.overlay.HiddenForCapture()}, {"ms", ms}, {"undo", {{"method", "overlay.hide"}, {"params", {{"hidden", false}}}}}};
                          }});
}

void Sim070RestoreAfterKill(json& aOut)
{
    if (!gState)
    {
        return;
    }
    std::scoped_lock _(gState->mutex);
    if (gState->weatherChanged)
    {
        gState->weather = gState->weatherEarlier;
        gState->cycle = true;
        gState->weatherChanged = false;
        aOut["weather_restored"] = gState->weather;
    }
    // RB-102: the cyberware as it was before the bridge's first change, and the copies it added removed.
    if (gState->cyberwareSnapshot || !gState->added.empty())
    {
        if (gState->cyberwareSnapshot)
        {
            for (const auto& [area, slots] : gState->cyberwareBefore)
            {
                SlotsOf(*gState, area) = slots;
            }
        }
        json removed = json::array();
        for (const auto& item : gState->added)
        {
            gState->inventory.erase(item);
            removed.push_back(item);
        }
        gState->added.clear();
        gState->cyberwareSnapshot = false;
        aOut["cyberware_restored"] = true;
        aOut["cyberware_removed"] = removed;
    }
}

json Sim070Holds()
{
    json held = json::array();
    if (!gState)
    {
        return held;
    }
    std::scoped_lock _(gState->mutex);
    if (gState->weatherChanged)
    {
        held.push_back("weather held by the bridge (" + gState->weather + ")");
    }
    if (CyberwareChanged(*gState))
    {
        held.push_back("cyberware changed by the bridge");
    }
    return held;
}
} // namespace xfb::selftest
