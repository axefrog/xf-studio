#include "selftest/SimDm080.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>
#include <set>
#include <vector>

#include "core/DmMicro.hpp"
#include "core/DmService.hpp"
#include "core/Params.hpp"
#include "core/Session.hpp"

namespace xfb::selftest
{
namespace
{
using json = nlohmann::json;
using dm::Vec3;

Vec3 VecOf(const json& aValue)
{
    Vec3 out{};
    if (aValue.is_array() && aValue.size() == 3)
    {
        for (size_t i = 0; i < 3; ++i)
        {
            out[i] = aValue[i].get<double>();
        }
    }
    return out;
}

json Arr(const Vec3& aV)
{
    return json::array({aV[0], aV[1], aV[2]});
}

struct Door
{
    bool open = false, locked = false, sealed = false;
    Vec3 position{100.0, 205.0, 10.0};
};

struct Vehicle
{
    bool engine = false, lights = false, radioOn = false;
    int station = 4;
    std::map<std::string, std::string> doors{{"seat_front_left", "closed"}, {"seat_front_right", "closed"}, {"seat_back_left", "closed"},
                                             {"seat_back_right", "closed"}, {"trunk", "closed"}, {"hood", "closed"}};
    Vec3 position{98.0, 203.0, 10.0};
};

struct Light
{
    std::array<int32_t, 3> colour{255, 255, 255};
    double intensity = 100.0, radius = 8.0, inner = 20.0, outer = 45.0, flicker = 0.0;
    bool on = true;
    int intensityCalls = 0;
    double lastIntensity = -1.0;
};

struct Ent
{
    std::string id, kind, templatePath, record;
    Vec3 position{};
    double yaw = 0.0;
    bool hasLight = false;
    Light light;
    bool lost = false;
};

struct Sound
{
    std::string event, on, emitter;
    bool stopped = false;
};
} // namespace

struct SimDm::State
{
    std::mutex mutex;
    SimDmHooks hooks;
    Dispatcher* dispatcher = nullptr;
    std::unique_ptr<dm::Service> service;
    std::unique_ptr<dm::MicroRunner> micro;
    bool codeware = true;
    bool hud = true;
    bool carrier = false;
    bool calling = true;
    bool noGround = false;
    std::vector<std::string> contacts{"test_fixer", "test_friend"};
    std::map<std::string, Door> doors{{"EntityID(8101)", Door{}}, {"EntityID(8102)", Door{false, true, false, {101.0, 205.0, 10.0}}}};
    std::map<std::string, Vehicle> vehicles{{"EntityID(8201)", Vehicle{}}};
    std::string mounted = "EntityID(8201)";
    bool isMounted = false;
    std::set<std::string> npcs{"EntityID(9001)"};
    std::map<std::string, Ent> ents;
    uint64_t nextEntity = 7001;
    std::vector<Sound> sounds;
    std::map<int32_t, std::string> lines; // line number -> "type|speaker|text"
    int lineShows = 0;
    std::string tracker;
    int trackerDraws = 0;
    std::vector<json> banners;
    int bannersHidden = 0;
    std::vector<std::string> toasts;
    std::string callState = "none";
    std::string callContact, callMode;
    int callFact = 0;
    int callRings = 0, callStarts = 0, callEnds = 0;
    std::string lookAt;
    bool combat = false, weapon = false;
    double tod = 43200.0;
    std::vector<json> events;
    bool listening = false;
    int releasedAll = 0;
    std::string failNext;
    json lastWants = json::object();
};

namespace
{
Vec3 PlayerPos(SimDm::State& aState)
{
    return VecOf(aState.hooks.player().value("position", json::array({0, 0, 0})));
}

void FailIfAsked(SimDm::State* s, const std::string& aOp)
{
    if (s->failNext == aOp)
    {
        s->failNext.clear();
        throw MethodError("sim_failed", "simulated: the game refused " + aOp);
    }
}

json DoorJson(const Door& aDoor)
{
    return json{{"open", aDoor.open}, {"locked", aDoor.locked}, {"sealed", aDoor.sealed}};
}

json VehicleDoorsJson(const Vehicle& aVehicle)
{
    json out = json::object();
    for (const auto& [name, state] : aVehicle.doors)
    {
        out[name] = state;
    }
    return out;
}

// A target as the script resolves it: v, look_at, mounted or an entity id; "" when nothing is there.
std::string ResolveId(SimDm::State& aState, const std::string& aTarget)
{
    if (aTarget == "look_at")
    {
        return aState.lookAt;
    }
    if (aTarget == "mounted")
    {
        return aState.isMounted ? aState.mounted : std::string();
    }
    return aTarget;
}

dm::Ops MakeOps(SimDm::State* aState)
{
    auto* s = aState;
    dm::Ops ops;
    ops.v = [s] {
        auto p = s->hooks.player();
        p["phase"] = s->hooks.phase();
        return p;
    };
    ops.spawn = [s](const dm::SpawnStep& aStep) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "spawn");
        if (!s->codeware)
        {
            throw MethodError("codeware_missing", "simulated: bringing props in needs Codeware");
        }
        if (!aStep.templatePath.empty() && aStep.templatePath.find("missing") != std::string::npos)
        {
            throw MethodError("template_missing", "simulated: the game has no entity template at that path");
        }
        if (!aStep.record.empty() && aStep.record.rfind("Nope.", 0) == 0)
        {
            throw MethodError("record_missing", "simulated: the game's database has no record " + aStep.record);
        }
        s->hooks.takeSaveLock();
        Ent e;
        e.id = "EntityID(" + std::to_string(s->nextEntity++) + ")";
        e.kind = aStep.kind;
        e.templatePath = aStep.templatePath;
        e.record = aStep.record;
        e.position = aStep.at;
        e.yaw = aStep.yaw;
        e.hasLight = aStep.templatePath.find("lamp") != std::string::npos;
        if (aStep.ground && !s->noGround)
        {
            e.position[2] = PlayerPos(*s)[2];
        }
        if (aStep.kind == "vehicle")
        {
            s->vehicles[e.id] = Vehicle{};
            s->vehicles[e.id].position = e.position;
        }
        s->ents[e.id] = e;
        return json{{"entity", e.id}, {"position", Arr(e.position)}, {"yaw", e.yaw}, {"grounded", aStep.ground && !s->noGround}};
    };
    ops.despawn = [s](const std::string& aEntity) -> json {
        std::scoped_lock _(s->mutex);
        s->ents.erase(aEntity);
        s->vehicles.erase(aEntity);
        return json{{"despawned", true}}; // confirmed absent is idempotent success
    };
    ops.door = [s](const dm::DoorStep& aStep) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "door");
        const auto id = ResolveId(*s, aStep.target);
        if (id.empty())
        {
            throw MethodError("target_missing", "simulated: V isn't looking at anything");
        }
        const auto it = s->doors.find(id);
        if (it == s->doors.end())
        {
            throw MethodError("not_a_door", "simulated: that isn't a door");
        }
        s->hooks.takeSaveLock();
        auto& door = it->second;
        const auto before = DoorJson(door);
        if (aStep.open.value_or(false))
        {
            door.sealed = false;
            door.locked = false;
            door.open = true;
        }
        else
        {
            if (aStep.open.has_value())
            {
                door.open = false;
            }
            if (aStep.locked)
            {
                door.locked = *aStep.locked;
            }
            if (aStep.sealed)
            {
                door.sealed = *aStep.sealed;
            }
        }
        return json{{"target_id", id}, {"before", before}, {"after", DoorJson(door)}};
    };
    ops.vehicle = [s](const dm::VehicleStep& aStep) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "vehicle");
        const auto id = ResolveId(*s, aStep.target);
        if (id.empty())
        {
            throw MethodError("target_missing", aStep.target == "mounted" ? "simulated: V isn't in a vehicle" : "simulated: V isn't looking at anything");
        }
        const auto it = s->vehicles.find(id);
        if (it == s->vehicles.end())
        {
            throw MethodError("not_a_vehicle", "simulated: that isn't a vehicle");
        }
        s->hooks.takeSaveLock();
        auto& vehicle = it->second;
        const json before{{"engine", vehicle.engine}, {"doors", VehicleDoorsJson(vehicle)}};
        if (aStep.lights)
        {
            vehicle.lights = *aStep.lights;
        }
        if (aStep.engine)
        {
            vehicle.engine = *aStep.engine;
        }
        if (!aStep.door.empty())
        {
            const bool all = aStep.door == "all";
            for (auto& [name, state] : vehicle.doors)
            {
                if (all || name == aStep.door)
                {
                    if (aStep.doorState == "open" || aStep.doorState == "closed")
                    {
                        state = aStep.doorState;
                    }
                }
            }
        }
        return json{{"target_id", id}, {"before", before}};
    };
    ops.audioPlay = [s](const std::string& aEvent, const std::string& aOn, const std::string& aEmitter) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "audio");
        const auto id = aOn == "global" ? std::string("global") : ResolveId(*s, aOn);
        if (id.empty())
        {
            throw MethodError("target_missing", "simulated: nothing there");
        }
        s->sounds.push_back({aEvent, id, aEmitter, false});
        return json{{"on_id", id}};
    };
    ops.audioStop = [s](const std::string& aEvent, const std::string& aOn, const std::string&) -> json {
        std::scoped_lock _(s->mutex);
        for (auto& sound : s->sounds)
        {
            if (!sound.stopped && sound.event == aEvent && sound.on == aOn)
            {
                sound.stopped = true;
            }
        }
        return json::object();
    };
    ops.radio = [s](const dm::RadioStep& aStep) -> json {
        std::scoped_lock _(s->mutex);
        const auto id = ResolveId(*s, aStep.target);
        if (id.empty())
        {
            throw MethodError("target_missing", "simulated: nothing there");
        }
        const auto it = s->vehicles.find(id);
        if (it == s->vehicles.end())
        {
            throw MethodError("no_radio", "simulated: that isn't a vehicle");
        }
        s->hooks.takeSaveLock();
        auto& vehicle = it->second;
        const json before{{"on", vehicle.radioOn}, {"station", vehicle.station}};
        if (aStep.station)
        {
            vehicle.station = *aStep.station;
        }
        if (aStep.on)
        {
            vehicle.radioOn = *aStep.on;
        }
        else if (aStep.station)
        {
            vehicle.radioOn = true;
        }
        return json{{"target_id", id}, {"before", before}};
    };
    ops.voice = [s](const std::string& aTarget, const std::string& aContext) -> json {
        std::scoped_lock _(s->mutex);
        const auto id = ResolveId(*s, aTarget == "v" ? std::string("EntityID(1)") : aTarget);
        if (id.empty())
        {
            throw MethodError("target_missing", "simulated: nothing there");
        }
        if (s->npcs.count(id) == 0)
        {
            throw MethodError("not_an_npc", "simulated: that isn't someone with a voice of their own");
        }
        s->sounds.push_back({"voice:" + aContext, id, "", false});
        return json{{"target_id", id}};
    };
    ops.lightSpawn = [s](const dm::LightStep& aStep) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "light");
        if (!s->codeware)
        {
            throw MethodError("codeware_missing", "simulated: bringing lights in needs Codeware");
        }
        if (aStep.templatePath.empty() && !s->carrier)
        {
            throw MethodError("carrier_missing", "simulated: the XF light carrier isn't built yet");
        }
        if (aStep.templatePath.find("missing") != std::string::npos)
        {
            throw MethodError("template_missing", "simulated: the game has no entity template at that path");
        }
        s->hooks.takeSaveLock();
        Ent e;
        e.id = "EntityID(" + std::to_string(s->nextEntity++) + ")";
        e.kind = "light";
        e.templatePath = aStep.templatePath;
        e.position = aStep.at;
        e.yaw = aStep.yaw;
        e.hasLight = aStep.templatePath.empty() || aStep.templatePath.find("lamp") != std::string::npos;
        // Initial settings are applied asynchronously by the same service tick as the real adapter.
        s->ents[e.id] = e;
        return json{{"entity", e.id}, {"components", 0}, {"pending", true}};
    };
    ops.lightSet = [s](const dm::LightSetStep& aStep) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "light");
        const auto it = s->ents.find(aStep.entity);
        if (it == s->ents.end() || it->second.lost)
        {
            throw MethodError("target_missing", "simulated: that entity isn't in the world now");
        }
        if (!it->second.hasLight)
        {
            throw MethodError("no_light_component", "simulated: that entity holds no light component");
        }
        auto& light = it->second.light;
        const json before{{"colour", json::array({light.colour[0], light.colour[1], light.colour[2]})},
                          {"intensity", light.intensity},
                          {"radius", light.radius},
                          {"inner", light.inner},
                          {"outer", light.outer},
                          {"on", light.on}};
        if (aStep.colour)
        {
            light.colour = *aStep.colour;
        }
        if (aStep.intensity)
        {
            light.intensity = *aStep.intensity;
        }
        if (aStep.radius)
        {
            light.radius = *aStep.radius;
        }
        if (aStep.inner)
        {
            light.inner = *aStep.inner;
            light.outer = *aStep.outer;
        }
        if (aStep.on)
        {
            light.on = *aStep.on;
        }
        if (aStep.flickerStrength)
        {
            light.flicker = *aStep.flickerStrength;
        }
        return json{{"before", before}};
    };
    ops.lightIntensity = [s](const std::string& aEntity, double aIntensity) {
        std::scoped_lock _(s->mutex);
        const auto it = s->ents.find(aEntity);
        if (it == s->ents.end() || !it->second.hasLight)
        {
            throw MethodError("no_light_component", "simulated: that entity holds no light component");
        }
        ++it->second.light.intensityCalls;
        it->second.light.lastIntensity = aIntensity;
    };
    ops.notify = [s](const dm::NotifyRequest& aRequest) -> json {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "notify");
        if (!s->hud)
        {
            throw MethodError("hud_missing", "simulated: the HUD isn't up");
        }
        s->banners.push_back(json{{"style", aRequest.style}, {"title", aRequest.title}, {"text", aRequest.text}, {"seconds", aRequest.seconds}});
        return json{{"shown", true}};
    };
    ops.notifyHide = [s](const std::string& aStyle) -> json {
        std::scoped_lock _(s->mutex);
        ++s->bannersHidden;
        return json{{"banners_hidden", true}, {"style", aStyle}};
    };
    ops.phoneText = [s](const std::string& aContact, const std::string& aText) -> json {
        std::scoped_lock _(s->mutex);
        if (!s->hud)
        {
            throw MethodError("hud_missing", "simulated: the HUD's phone isn't up");
        }
        s->toasts.push_back(aContact + ": " + aText);
        return json{{"shown", true}};
    };
    ops.phoneContacts = [s]() -> json {
        std::scoped_lock _(s->mutex);
        json list = json::array();
        for (const auto& id : s->contacts)
        {
            list.push_back({{"id", id}, {"name", "Simulated " + id}});
        }
        return json{{"contacts", list}, {"calling", s->calling}};
    };
    ops.sample = [s](const dm::SampleWants& aWants, const std::map<std::string, std::string>& aEntities) -> json {
        const auto player = s->hooks.player();
        std::scoped_lock _(s->mutex);
        s->lastWants = json{{"look", aWants.lookAt}, {"events", aWants.events}, {"occlusion", aWants.occlusion}, {"call", aWants.callContact}};
        s->listening = aWants.events;
        const auto v = VecOf(player.value("position", json::array({0, 0, 0})));
        const double r = player.value("yaw", 0.0) * 3.14159265358979323846 / 180.0;
        json out{{"v", Arr(v)}, {"yaw", player.value("yaw", 0.0)}, {"cam", Arr({v[0], v[1], v[2] + 1.6})}, {"fwd", json::array({-std::sin(r), std::cos(r), 0.0})},
                 {"combat", s->combat}, {"vehicle", s->isMounted}, {"weapon", s->weapon}, {"tod", s->tod}};
        if (aWants.lookAt)
        {
            out["look"] = s->lookAt;
        }
        if (!aWants.callContact.empty() && aWants.callContact == s->callContact)
        {
            out["call_fact"] = s->callFact;
        }
        if (!aEntities.empty())
        {
            json ents = json::object();
            for (const auto& [key, id] : aEntities)
            {
                const auto it = s->ents.find(id);
                if (it != s->ents.end() && !it->second.lost)
                {
                    ents[key] = json{{"p", Arr(it->second.position)}, {"id", id}};
                }
                else if (s->doors.count(id))
                {
                    ents[key] = json{{"p", Arr(s->doors[id].position)}, {"id", id}};
                }
            }
            out["ents"] = ents;
        }
        if (aWants.events && !s->events.empty())
        {
            out["ev"] = s->events;
            s->events.clear();
        }
        return out;
    };
    ops.showLine = [s](const dm::TimedLine& aLine) {
        std::scoped_lock _(s->mutex);
        if (!s->codeware)
        {
            throw MethodError("codeware_missing", "simulated: lines need Codeware");
        }
        s->lines[static_cast<int32_t>(aLine.id & 0xFFFFFFFFULL)] = std::to_string(aLine.type) + "|" + aLine.speaker + "|" + aLine.text;
        ++s->lineShows;
    };
    ops.hideLine = [s](uint64_t aLineId) {
        std::scoped_lock _(s->mutex);
        s->lines.erase(static_cast<int32_t>(aLineId & 0xFFFFFFFFULL));
    };
    ops.callRing = [s](const std::string& aContact, const std::string& aMode, bool) {
        std::scoped_lock _(s->mutex);
        FailIfAsked(s, "call");
        if (std::find(s->contacts.begin(), s->contacts.end(), aContact) == s->contacts.end())
        {
            throw MethodError("contact_unknown", "simulated: the player's phone has no contact with the id " + aContact);
        }
        if (!s->calling)
        {
            throw MethodError("phone_blocked", "simulated: the phone can't take a call now");
        }
        s->hooks.takeSaveLock();
        s->callState = "ringing";
        s->callContact = aContact;
        s->callMode = aMode;
        s->callFact = 1;
        ++s->callRings;
    };
    ops.callStart = [s](const std::string& aContact, const std::string& aMode) {
        std::scoped_lock _(s->mutex);
        s->callState = "talking";
        s->callContact = aContact;
        s->callMode = aMode;
        ++s->callStarts;
    };
    ops.callEnd = [s](const std::string& aContact) {
        std::scoped_lock _(s->mutex);
        s->callState = "ended";
        s->callContact = aContact;
        s->callFact = 0;
        ++s->callEnds;
    };
    ops.tracker = [s](const std::vector<dm::Quest>& aQuests) {
        std::scoped_lock _(s->mutex);
        if (!s->hud)
        {
            throw MethodError("hud_missing", "simulated: the HUD's quest tracker isn't up");
        }
        std::string spec;
        if (!aQuests.empty())
        {
            const auto& quest = aQuests.front();
            spec = quest.title;
            for (const auto& objective : quest.objectives)
            {
                if (objective.state != "hidden")
                {
                    spec += "\n" + objective.state + "\t" + (objective.optional ? "o" : "-") + "\t" + objective.text;
                }
            }
        }
        s->tracker = spec;
        ++s->trackerDraws;
    };
    ops.releaseAll = [s](const std::string& aReason) -> json {
        std::scoped_lock _(s->mutex);
        const auto removed = s->ents.size();
        s->ents.clear();
        s->lines.clear();
        s->tracker.clear();
        s->listening = false;
        s->banners.clear();
        s->toasts.clear();
        ++s->bannersHidden;
        ++s->releasedAll;
        const bool call = s->callState == "ringing" || s->callState == "talking";
        if (call)
        {
            s->callState = "ended";
            s->callFact = 0;
            ++s->callEnds;
        }
        return json{{"entities_removed", removed}, {"reason", aReason}, {"call_ended", call}, {"simulated", true}};
    };
    ops.digest = [s](bool aSky) -> json {
        const auto player = s->hooks.player();
        std::scoped_lock _(s->mutex);
        json world{{"clock", {{"hours", static_cast<int>(s->tod / 3600.0)}, {"minutes", static_cast<int>(std::fmod(s->tod, 3600.0) / 60.0)}}}};
        if (aSky)
        {
            world["weather"] = json{{"state", "sim_clear"}};
        }
        return json{{"v", {{"position", player.value("position", json::array({0, 0, 0}))}, {"yaw", player.value("yaw", 0.0)}, {"busy", player.value("busy", std::string())},
                           {"vitals", {{"health_percent", 62.0}}}}},
                    {"world", world}};
    };
    ops.micro = [s](dm::MicroBatch aBatch) {
        aBatch.sessionToken = s->hooks.token();
        s->micro->Enqueue(std::move(aBatch));
    };
    ops.microCancel = [s](const std::string& aWhy) { return s->micro->Cancel(aWhy); };
    ops.microCancelWatch = [s](const std::string& aWatch) { return s->micro->CancelWatch(aWatch); };
    ops.microPending = [s] { return s->micro->Pending(); };
    ops.actionCheck = [s](const std::string& aMethod) -> std::string {
        const auto access = s->dispatcher->AccessOf(aMethod);
        if (!access)
        {
            return "no such bridge method";
        }
        if (!dm::MicroAccessAllowed(std::string(AccessName(*access))))
        {
            return "its class (" + std::string(AccessName(*access)) + ") can't run from a watcher";
        }
        return {};
    };
    return ops;
}

json Snapshot(SimDm::State* s)
{
    json ents = json::array();
    for (const auto& [id, e] : s->ents)
    {
        json entry{{"id", id}, {"kind", e.kind}, {"template", e.templatePath}, {"record", e.record}, {"position", Arr(e.position)}, {"yaw", e.yaw}, {"has_light", e.hasLight}};
        if (e.hasLight)
        {
            entry["light"] = json{{"colour", json::array({e.light.colour[0], e.light.colour[1], e.light.colour[2]})},
                                  {"intensity", e.light.intensity},
                                  {"radius", e.light.radius},
                                  {"inner", e.light.inner}, {"outer", e.light.outer},
                                  {"on", e.light.on},
                                  {"flicker", e.light.flicker},
                                  {"intensity_calls", e.light.intensityCalls},
                                  {"last_intensity", e.light.lastIntensity}};
        }
        ents.push_back(entry);
    }
    json doors = json::object();
    for (const auto& [id, d] : s->doors)
    {
        doors[id] = DoorJson(d);
    }
    json vehicles = json::object();
    for (const auto& [id, v] : s->vehicles)
    {
        vehicles[id] = json{{"engine", v.engine}, {"lights", v.lights}, {"radio_on", v.radioOn}, {"station", v.station}, {"doors", VehicleDoorsJson(v)}};
    }
    json sounds = json::array();
    for (const auto& sound : s->sounds)
    {
        sounds.push_back({{"event", sound.event}, {"on", sound.on}, {"stopped", sound.stopped}});
    }
    json lines = json::object();
    for (const auto& [n, text] : s->lines)
    {
        lines[std::to_string(n)] = text;
    }
    return json{{"entities", ents},
                {"doors", doors},
                {"vehicles", vehicles},
                {"sounds", sounds},
                {"lines", lines},
                {"line_shows", s->lineShows},
                {"tracker", s->tracker},
                {"tracker_draws", s->trackerDraws},
                {"banners", s->banners},
                {"banners_hidden", s->bannersHidden},
                {"toasts", s->toasts},
                {"call", {{"state", s->callState}, {"contact", s->callContact}, {"mode", s->callMode}, {"fact", s->callFact}, {"rings", s->callRings}, {"starts", s->callStarts}, {"ends", s->callEnds}}},
                {"listening", s->listening},
                {"released_all", s->releasedAll},
                {"last_wants", s->lastWants},
                {"hud", s->hud},
                {"codeware", s->codeware}};
}
} // namespace

SimDm::SimDm(Dispatcher& aDispatcher, SimDmHooks aHooks)
    : m_state(std::make_unique<State>())
{
    m_state->hooks = std::move(aHooks);
    m_state->dispatcher = &aDispatcher;
    auto* s = m_state.get();
    s->service = std::make_unique<dm::Service>([s](const std::string&) { return MakeOps(s); });
    s->service->SetEvents(s->hooks.events);
    s->micro = std::make_unique<dm::MicroRunner>(
        [s](const std::string& aMethod, const json& aParams, const std::string& aCid, const std::string& aToken) -> json {
            const json request{{"v", kProtocolVersion}, {"id", aCid}, {"token", aToken}, {"method", aMethod}, {"params", aParams}, {"cid", aCid}};
            const auto handled = s->dispatcher->Handle(request.dump(), 4242);
            return json::parse(handled.line, nullptr, false);
        },
        [s](const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData) {
            if (s->hooks.events)
            {
                s->hooks.events->Push("dm." + aKind, aLevel, "dm", aText, aData);
            }
        });
    dm::RegisterMethods(aDispatcher, *s->service, [s](MethodSpec aSpec) {
        auto fn = aSpec.fn;
        aSpec.fn = [s, fn](const MethodContext& aContext) {
            s->hooks.markWrite();
            auto out = fn(aContext);
            out["simulated"] = true;
            return out;
        };
        return aSpec;
    });
    // selftest.dm: steers the simulated world (self-test only).
    aDispatcher.Register({"selftest.dm", Access::Read, RunOn::BridgeThread, "Steers the simulated live-direction world (self-test only).", [s](const MethodContext& aContext) {
                              const auto& p = aContext.params;
                              std::scoped_lock _(s->mutex);
                              const auto flag = [&p](const char* aKey, bool& aOut) {
                                  if (p.contains(aKey) && p[aKey].is_boolean())
                                  {
                                      aOut = p[aKey].get<bool>();
                                  }
                              };
                              flag("codeware", s->codeware);
                              flag("hud", s->hud);
                              flag("carrier", s->carrier);
                              flag("calling", s->calling);
                              flag("combat", s->combat);
                              flag("weapon", s->weapon);
                              flag("mounted", s->isMounted);
                              flag("no_ground", s->noGround);
                              if (p.contains("contacts") && p["contacts"].is_array())
                              {
                                  s->contacts = p["contacts"].get<std::vector<std::string>>();
                              }
                              if (p.contains("look_at") && p["look_at"].is_string())
                              {
                                  s->lookAt = p["look_at"].get<std::string>();
                              }
                              if (p.contains("tod") && p["tod"].is_number())
                              {
                                  s->tod = p["tod"].get<double>();
                              }
                              if (p.contains("call_fact") && p["call_fact"].is_number_integer())
                              {
                                  s->callFact = p["call_fact"].get<int>();
                              }
                              if (p.contains("fail_next") && p["fail_next"].is_string())
                              {
                                  s->failNext = p["fail_next"].get<std::string>();
                              }
                              if (p.contains("event") && p["event"].is_object())
                              {
                                  s->events.push_back(p["event"]);
                              }
                              if (p.contains("lose") && p["lose"].is_string())
                              {
                                  const auto it = s->ents.find(p["lose"].get<std::string>());
                                  if (it != s->ents.end())
                                  {
                                      it->second.lost = true;
                                  }
                              }
                              if (p.contains("move") && p["move"].is_object())
                              {
                                  const auto it = s->ents.find(p["move"].value("id", std::string()));
                                  if (it != s->ents.end())
                                  {
                                      it->second.position = VecOf(p["move"]["position"]);
                                  }
                              }
                              return Snapshot(s);
                          }});
}

SimDm::~SimDm()
{
    Stop();
}

void SimDm::Stop()
{
    if (m_state && m_state->micro)
    {
        m_state->micro->Stop();
    }
}

void SimDm::Tick(double aDt)
{
    auto* s = m_state.get();
    dm::TickInput input;
    input.gateOpen = s->hooks.scriptsReady();
    input.killed = s->hooks.killed();
    input.paused = s->hooks.paused();
    input.handedOver = s->hooks.handedOver();
    input.detaches = s->hooks.detaches();
    input.writesOpen = s->hooks.writesOpen;
    s->service->Tick(aDt, input);
}

json SimDm::ReleaseForHandover()
{
    RestoreScope restoring;
    return m_state->service->ReleaseAllNow("handover", MakeOps(m_state.get()));
}

void SimDm::OnDetach()
{
    std::scoped_lock _(m_state->mutex);
    m_state->ents.clear();
    m_state->lines.clear();
    m_state->tracker.clear();
    m_state->callState = "none";
    m_state->callFact = 0;
    m_state->listening = false;
}

void SimDm::RestoreAfterKill(json& aOut)
{
    aOut["dm_released"] = m_state->service->RestoreAfterKill(MakeOps(m_state.get()));
}

json SimDm::Holds()
{
    return m_state->service->Holds();
}
} // namespace xfb::selftest
