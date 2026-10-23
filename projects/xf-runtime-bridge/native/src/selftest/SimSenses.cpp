#include "selftest/SimSenses.hpp"

#include <algorithm>
#include <memory>
#include <mutex>

#include "core/Dispatcher.hpp"
#include "core/Params.hpp"
#include "core/Senses.hpp"

namespace xfb::selftest
{
namespace
{
using json = nlohmann::json;

struct SensesState
{
    std::mutex mutex;
    std::string district = "place"; // place, district or none
    bool vehicle = false;
    bool scanning = false;
};

// The phases with no world to read (XFSenses.NotReady).
void RequireWorld(const std::string& aPhase)
{
    if (aPhase == "starting" || aPhase == "main_menu" || aPhase == "loading" || aPhase == "shutting_down")
    {
        throw MethodError("game_not_ready", "There is no world to read yet (the game is at: " + aPhase + "). Load a save and try again once V is in the world.");
    }
}

json DistrictRecord(const std::string& aEnum, const std::string& aName, const std::string& aType)
{
    return {{"id", "Districts." + aEnum}, {"enum", aEnum}, {"name", aName}, {"name_key", "LocKey#sim"}, {"type", aType},
            {"quest_district", false}, {"crime_multiplier", 1.0}, {"gangs", json::array({"TygerClaws"})}};
}
} // namespace

void RegisterSimSenses(Dispatcher& aDispatcher, SimSensesHooks aHooks)
{
    auto state = std::make_shared<SensesState>();
    namespace s = xfb::senses;

    aDispatcher.Register({"selftest.senses", Access::Read, RunOn::BridgeThread, "Test control for the simulated senses.", [state](const MethodContext& aContext) {
                              std::scoped_lock _(state->mutex);
                              if (const auto it = aContext.params.find("district"); it != aContext.params.end() && it->is_string())
                              {
                                  state->district = it->get<std::string>();
                              }
                              if (const auto v = params::CheckBoolean(aContext.params, "vehicle"))
                              {
                                  state->vehicle = *v;
                              }
                              if (const auto v = params::CheckBoolean(aContext.params, "scanning"))
                              {
                                  state->scanning = *v;
                              }
                              return json{{"district", state->district}, {"vehicle", state->vehicle}, {"scanning", state->scanning}};
                          }});

    aDispatcher.Register({"world.facts", Access::Read, RunOn::GameThread, "Quest facts (simulated).", [aHooks](const MethodContext& aContext) {
                              const auto request = s::ParseFacts(aContext.params);
                              RequireWorld(aHooks.phase());
                              json facts = json::object();
                              for (const auto& name : request.facts)
                              {
                                  facts[name] = (name == "q000_done" || name == "q104_mitch_rescued") ? 1 : (name == "q114_started" ? 2 : 0);
                              }
                              json out{{"simulated", true}, {"facts", facts}};
                              s::FinishFacts(out, request.facts.size());
                              return out;
                          }});

    aDispatcher.Register({"world.district", Access::Read, RunOn::GameThread, "V's district (simulated).", [aHooks, state](const MethodContext& aContext) {
                              s::ParseDistrict(aContext.params);
                              RequireWorld(aHooks.phase());
                              std::scoped_lock _(state->mutex);
                              if (state->district == "none")
                              {
                                  throw MethodError("no_district", "The game hasn't told its district system where V is yet. It does so when V crosses an area border, so a moment after a load, or after V moves, it will.");
                              }
                              const auto watson = DistrictRecord("Watson", "Watson", "Watson");
                              const auto kabuki = DistrictRecord("Kabuki", "Kabuki", "Kabuki");
                              const auto motel = DistrictRecord("Kabuki_NoTellMotel", "No-Tell Motel", "Kabuki_NoTellMotel");
                              const bool place = state->district == "place";
                              json out{{"simulated", true}, {"levels", place ? 3 : 1}, {"area", place ? motel : watson}, {"district", watson},
                                       {"subdistrict", place ? kabuki : json(nullptr)}, {"place", place ? motel : json(nullptr)},
                                       {"chain", place ? json::array({"Kabuki_NoTellMotel", "Kabuki", "Watson"}) : json::array({"Watson"})},
                                       {"prevention_preset", "PreventionData.NCPD"}, {"dogtown", false}, {"badlands", false},
                                       {"map", {{"enum", place ? "Kabuki_NoTellMotel" : "Watson"}, {"name_key", "LocKey#sim"}, {"agrees", true}, {"new_location", false}}},
                                       {"position", {100.0, 200.0, 10.0}}};
                              return out;
                          }});

    aDispatcher.Register({"player.status", Access::Read, RunOn::GameThread, "V's status (simulated).", [aHooks, state](const MethodContext& aContext) {
                              const auto request = s::ParseStatus(aContext.params);
                              const auto phase = aHooks.phase();
                              RequireWorld(phase);
                              std::scoped_lock _(state->mutex);
                              const auto has = [&](const char* aPart) {
                                  return request.parts.empty() || std::find(request.parts.begin(), request.parts.end(), aPart) != request.parts.end();
                              };
                              json out{{"simulated", true}, {"phase", phase}};
                              if (has("vitals"))
                              {
                                  out["vitals"] = {{"health", 450.0}, {"health_max", 500.0}, {"health_percent", 90.0}, {"dead", false}, {"in_combat", false}};
                              }
                              if (has("progress"))
                              {
                                  out["progress"] = {{"level", 21}, {"level_exp", 300}, {"level_exp_to_next", 700}, {"street_cred", 34}, {"street_cred_exp", 10}, {"street_cred_exp_to_next", 90}};
                              }
                              if (has("money"))
                              {
                                  out["money"] = 12345;
                              }
                              if (has("heat"))
                              {
                                  out["heat"] = {{"stage", 0}, {"star_state", "Default"}, {"chasing", false}, {"system_enabled", true}, {"system_locked", false},
                                                 {"facts", {{"wanted_level", 0}, {"wanted_chase_active", 0}}}};
                              }
                              if (has("vehicle"))
                              {
                                  out["vehicle"] = state->vehicle ? json{{"mounted", true}, {"record", "Vehicle.v_sport2_quadra_type66_player"}, {"id", "0x1"}, {"class", "vehicleCarBaseObject"},
                                                                         {"driver", true}, {"player_vehicle", true}, {"position", {100.0, 200.0, 10.0}}}
                                                                   : json{{"mounted", false}};
                              }
                              if (has("inventory"))
                              {
                                  out["inventory"] = {{"stacks", 3}, {"quest_stacks", 1}, {"types", json::array({{{"type", "Gen_Misc"}, {"stacks", 1}, {"quantity", 12345}},
                                                                                                                    {{"type", "Wea_Handgun"}, {"stacks", 2}, {"quantity", 2}}})}};
                              }
                              if (has("scanner"))
                              {
                                  out["scanner"] = {{"scanning", state->scanning}, {"vision", state->scanning ? 1 : 0}, {"progress", state->scanning ? 0.5 : 0.0}, {"scanner_look_at", state->scanning},
                                                    {"scanned_object", state->scanning ? json{{"id", "0x2"}, {"class", "NPCPuppet"}, {"distance", 4.0}, {"record", "Character.Sim_NPC_A"}, {"loaded", true}} : json(nullptr)}};
                              }
                              return out;
                          }});
}
} // namespace xfb::selftest
