#include "core/DmService.hpp"

#include <algorithm>
#include <cmath>
#include <tuple>

#include "core/Events.hpp"
#include "core/Params.hpp"

namespace xfb::dm
{
namespace p = xfb::params;

namespace
{
constexpr double kPi = 3.14159265358979323846;

[[noreturn]] void Bad(const std::string& aMessage)
{
    throw MethodError("bad_params", aMessage);
}

Vec3 ToVec(const json& aValue)
{
    if (aValue.is_array() && aValue.size() >= 3 && aValue[0].is_number() && aValue[1].is_number() && aValue[2].is_number())
    {
        return {aValue[0].get<double>(), aValue[1].get<double>(), aValue[2].get<double>()};
    }
    return {};
}

json Arr(const Vec3& aPoint)
{
    return json::array({std::round(aPoint[0] * 100.0) / 100.0, std::round(aPoint[1] * 100.0) / 100.0, std::round(aPoint[2] * 100.0) / 100.0});
}

double Distance(const Vec3& aA, const Vec3& aB)
{
    const double dx = aA[0] - aB[0], dy = aA[1] - aB[1], dz = aA[2] - aB[2];
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// The point aForward metres along a facing of aYaw degrees (the game's yaw: 0 faces +Y, 90 faces -X) and aRight metres to its right.
Vec3 OffsetPoint(const Vec3& aFrom, double aYaw, double aForward, double aRight, double aUp)
{
    const double r = aYaw * kPi / 180.0;
    const double fx = -std::sin(r), fy = std::cos(r);
    const double rx = std::cos(r), ry = std::sin(r);
    return {aFrom[0] + fx * aForward + rx * aRight, aFrom[1] + fy * aForward + ry * aRight, aFrom[2] + aUp};
}

// The game's yaw that faces aTo from aFrom.
double YawToward(const Vec3& aFrom, const Vec3& aTo)
{
    return std::atan2(-(aTo[0] - aFrom[0]), aTo[1] - aFrom[1]) * 180.0 / kPi;
}

bool IsDigits(const std::string& aText)
{
    return !aText.empty() && std::all_of(aText.begin(), aText.end(), [](char c) { return c >= '0' && c <= '9'; });
}

json Merge(json aBase, const json& aMore)
{
    if (aMore.is_object())
    {
        for (const auto& [key, value] : aMore.items())
        {
            aBase[key] = value;
        }
    }
    return aBase;
}

std::string Plural(size_t aCount, const std::string& aOne, const std::string& aMany)
{
    return std::to_string(aCount) + " " + (aCount == 1 ? aOne : aMany);
}
} // namespace

// ---- the service -------------------------------------------------------------------------------------------------------

Service::Service(OpsFor aOpsFor)
    : m_opsFor(std::move(aOpsFor))
{
}

void Service::SetOpsFor(OpsFor aOpsFor)
{
    std::scoped_lock _(m_mutex);
    m_opsFor = std::move(aOpsFor);
    m_tickOpsBuilt = false;
    m_session.reset();
}

Ops Service::OpsForCid(const std::string& aCid) const
{
    OpsFor opsFor;
    {
        std::scoped_lock _(m_mutex);
        opsFor = m_opsFor;
    }
    return opsFor ? opsFor(aCid) : Ops{};
}

void Service::SetEvents(EventLog* aEvents)
{
    std::scoped_lock _(m_mutex);
    m_events = aEvents;
}

void Service::Emit(const std::string& aKind, const std::string& aLevel, const std::string& aText, json aData)
{
    EventLog* events = nullptr;
    {
        std::scoped_lock _(m_mutex);
        events = m_events;
    }
    if (events)
    {
        events->Push("dm." + aKind, aLevel, "dm", aText, std::move(aData));
    }
}

double Service::Now() const
{
    std::scoped_lock _(m_mutex);
    return m_clock;
}

void Service::NoteOps(const Ops& aOps)
{
    OpsFor factory;
    {
        std::scoped_lock _(m_mutex);
        if (m_tickOpsBuilt) { return; }
        factory = m_opsFor;
    }
    auto ops = factory ? factory("dm-tick") : aOps;
    std::scoped_lock _(m_mutex);
    if (!m_tickOpsBuilt) { m_tickOps = std::move(ops); m_tickOpsBuilt = true; }
}

SessionOps Service::MakeSessionOps(const Ops& aOps)
{
    SessionOps so;
    so.sample = [this, aOps](const SampleWants& aWants) {
        std::map<std::string, std::string> entities;
        {
            std::scoped_lock _(m_mutex);
            for (const auto& key : aWants.entities)
            {
                const auto handle = SpawnHandleOf(key);
                if (handle > 0)
                {
                    if (const auto it = m_items.find(handle); it != m_items.end())
                    {
                        entities[key] = it->second.entity;
                    }
                }
                else if (IsDigits(key))
                {
                    entities[key] = key;
                }
            }
        }
        return aOps.sample(aWants, entities);
    };
    so.showLine = aOps.showLine;
    so.hideLine = aOps.hideLine;
    so.callRing = aOps.callRing;
    so.callStart = aOps.callStart;
    so.callEnd = aOps.callEnd;
    so.tracker = aOps.tracker;
    so.lightIntensity = [this, aOps](int32_t aHandle, double aIntensity) {
        std::string entity;
        {
            std::scoped_lock _(m_mutex);
            if (const auto it = m_items.find(aHandle); it != m_items.end())
            {
                entity = it->second.entity;
            }
        }
        if (!entity.empty() && aOps.lightIntensity)
        {
            aOps.lightIntensity(entity, aIntensity);
        }
    };
    so.event = [this](const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData) { Emit(aKind, aLevel, aText, aData); };
    so.micro = aOps.micro;
    return so;
}

Session& Service::SessionFor(const Ops& aOps)
{
    NoteOps(aOps);
    std::scoped_lock _(m_mutex);
    if (!m_session) { m_session = std::make_unique<Session>(MakeSessionOps(m_tickOps)); }
    return *m_session;
}

Session& Service::SessionForTest(const Ops& aOps)
{
    return SessionFor(aOps);
}

json Service::RequireWorld(const Ops& aOps)
{
    NoteOps(aOps);
    { std::scoped_lock _(m_mutex); m_releaseReceipts.clear(); }
    auto v = aOps.v();
    const auto phase = v.value("phase", std::string("gameplay"));
    if (phase != "gameplay")
    {
        throw MethodError("not_in_world", "the toolkit works in normal play only; the game is in '" + phase + "'");
    }
    if (v.value("busy", std::string()) == "not_v")
    {
        throw MethodError("not_v", "the player isn't V right now, so the bridge leaves the world alone");
    }
    return v;
}

std::string Service::ResolveTarget(const std::string& aTarget) const
{
    const auto handle = SpawnHandleOf(aTarget);
    if (handle <= 0)
    {
        return aTarget;
    }
    std::scoped_lock _(m_mutex);
    const auto it = m_items.find(handle);
    if (it == m_items.end())
    {
        throw MethodError("target_unknown", "nothing the bridge spawned has the handle " + aTarget + " (world_spawned lists them; a load forgets them)");
    }
    return it->second.entity;
}

Service::Item* Service::FindItem(int32_t aHandle)
{
    const auto it = m_items.find(aHandle);
    return it == m_items.end() ? nullptr : &it->second;
}

size_t Service::CountItems(const std::string& aKind) const
{
    return static_cast<size_t>(std::count_if(m_items.begin(), m_items.end(), [&](const auto& pair) { return pair.second.kind == aKind; }));
}

json Service::ItemJson(const Item& aItem) const
{
    json out{{"handle", aItem.handle}, {"target", "spawn:" + std::to_string(aItem.handle)}, {"kind", aItem.kind}, {"entity", aItem.entity},
             {"position", Arr(aItem.position)}, {"yaw", std::round(aItem.yaw * 10.0) / 10.0}};
    if (!aItem.templatePath.empty())
    {
        out["template"] = aItem.templatePath;
    }
    if (!aItem.record.empty())
    {
        out["record"] = aItem.record;
    }
    if (!aItem.appearance.empty())
    {
        out["appearance"] = aItem.appearance;
    }
    if (!aItem.label.empty())
    {
        out["label"] = aItem.label;
    }
    if (aItem.kind == "light")
    {
        out["pending"] = aItem.pending;
        if (!aItem.error.empty()) { out["error"] = aItem.error; }
        out["colour"] = json::array({aItem.colour[0], aItem.colour[1], aItem.colour[2]});
        out["intensity"] = aItem.intensity;
        out["radius"] = aItem.radius;
        out["on"] = aItem.on;
        if (aItem.inner)
        {
            out["inner"] = *aItem.inner;
            out["outer"] = *aItem.outer;
        }
    }
    return out;
}

void Service::RememberChange(const std::string& aKind, const std::string& aTargetId, const json& aBefore, const std::string& aKey, const json& aAsked, bool aSticky)
{
    std::scoped_lock _(m_mutex);
    auto& change = m_changes[aKey];
    if (change.kind.empty())
    {
        change.kind = aKind;
        change.targetId = aTargetId;
        change.original = json::object();
        change.current = json::object();
    }
    // The first state seen for each field is the one the release puts back.
    if (aBefore.is_object())
    {
        for (const auto& [key, value] : aBefore.items())
        {
            if (!change.original.contains(key) && !value.is_null())
            {
                change.original[key] = value;
                change.current[key] = value;
            }
        }
    }
    // What was asked is what the field becomes (an object, such as a vehicle's doors, field by field).
    if (aAsked.is_object())
    {
        for (const auto& [key, value] : aAsked.items())
        {
            if (value.is_object() && change.current.contains(key) && change.current[key].is_object())
            {
                for (const auto& [inner, state] : value.items())
                {
                    change.current[key][inner] = state;
                }
            }
            else
            {
                change.current[key] = value;
            }
        }
    }
    change.dormant = false;
    change.sticky = change.sticky || aSticky;
    if (!change.sticky && change.current == change.original)
    {
        m_changes.erase(aKey);
    }
}

// ---- world -------------------------------------------------------------------------------------------------------------

json Service::Spawn(const json& aParams, const Ops& aOps)
{
    const auto request = ParseSpawn(aParams);
    {
        std::scoped_lock _(m_mutex);
        if (m_items.size() >= kMaxSpawned)
        {
            throw MethodError("limit", "the bridge already has " + std::to_string(kMaxSpawned) + " spawned things (props, vehicles and lights together); remove some with world_despawn first");
        }
    }
    const auto v = RequireWorld(aOps);
    const auto vPos = ToVec(v.value("position", json::array({0, 0, 0})));
    const double vYaw = v.value("yaw", 0.0);
    Vec3 at;
    if (request.where.mode == Where::Mode::World)
    {
        at = request.where.point;
    }
    else
    {
        at = OffsetPoint(vPos, vYaw, request.where.forward, request.where.right, request.where.up);
    }
    if (Distance(at, vPos) > kMaxSpawnDistance)
    {
        throw MethodError("too_far", "that place is more than " + std::to_string(static_cast<int>(kMaxSpawnDistance)) + " m from V");
    }
    const double yaw = request.where.yaw ? *request.where.yaw : (request.where.faceV ? YawToward(at, vPos) : vYaw);

    int32_t handle = 0;
    {
        std::scoped_lock _(m_mutex);
        handle = m_nextHandle++;
    }
    SpawnStep step;
    step.kind = request.kind;
    step.templatePath = request.templatePath;
    step.record = request.record;
    step.appearance = request.appearance;
    step.label = request.label;
    step.at = at;
    step.yaw = yaw;
    step.ground = request.ground;
    step.handle = handle;
    const auto done = aOps.spawn(step);

    Item item;
    item.handle = handle;
    item.kind = request.kind;
    item.entity = done.value("entity", std::string());
    item.templatePath = request.templatePath;
    item.record = request.record;
    item.appearance = request.appearance;
    item.label = request.label;
    item.position = done.contains("position") ? ToVec(done["position"]) : at;
    item.yaw = done.value("yaw", yaw);
    size_t total = 0;
    {
        std::scoped_lock _(m_mutex);
        m_items[handle] = item;
        total = m_items.size();
    }
    Emit("world", "info", request.kind + " spawned: " + (request.label.empty() ? "spawn:" + std::to_string(handle) : request.label),
         json{{"what", "spawned"}, {"handle", handle}, {"kind", request.kind}, {"entity", item.entity}});
    json out = ItemJson(item);
    out["grounded"] = done.value("grounded", false);
    if (done.contains("traffic_check")) out["traffic_check"] = done["traffic_check"];
    out["spawned"] = total;
    out["limit"] = kMaxSpawned;
    out["undo"] = SpawnUndo(handle);
    out["undo_note"] = "the result's undo removes it; the kill switch, a pause, a handover and loading a save remove everything the bridge spawned, and a save is refused while any exists";
    return out;
}

json Service::Despawn(const json& aParams, const Ops& aOps)
{
    const auto request = ParseDespawn(aParams);
    std::vector<Item> targets;
    {
        std::scoped_lock _(m_mutex);
        if (request.all)
        {
            for (const auto& [handle, item] : m_items)
            {
                if (item.kind != "light")
                {
                    targets.push_back(item);
                }
            }
        }
        else
        {
            const auto it = m_items.find(request.handle);
            if (it == m_items.end())
            {
                throw MethodError("target_unknown", "nothing the bridge spawned has the handle " + std::to_string(request.handle) + " (world_spawned lists them)");
            }
            if (it->second.kind == "light")
            {
                throw MethodError("use_light_remove", "spawn:" + std::to_string(request.handle) + " is a light; light_remove takes it away");
            }
            targets.push_back(it->second);
        }
    }
    json removed = json::array();
    json specs = json::array();
    std::string failure;
    for (const auto& item : targets)
    {
        try
        {
            if (!aOps.despawn(item.entity).value("despawned", false)) { throw MethodError("failed", "deletion not confirmed"); }
        }
        catch (const std::exception& e)
        {
            failure = e.what();
            continue; // still owned; retain its save hold for retry
        }
        {
            std::scoped_lock _(m_mutex);
            m_items.erase(item.handle);
        }
        removed.push_back(ItemJson(item));
        json spec{{"kind", item.kind}, {"position", Arr(item.position)}, {"yaw", item.yaw}};
        if (!item.templatePath.empty())
        {
            spec["template"] = item.templatePath;
        }
        if (!item.record.empty())
        {
            spec["record"] = item.record;
        }
        if (!item.appearance.empty())
        {
            spec["appearance"] = item.appearance;
        }
        if (!item.label.empty())
        {
            spec["label"] = item.label;
        }
        specs.push_back(spec);
    }
    if (!targets.empty())
    {
        Emit("world", "info", "despawned " + Plural(removed.size(), "thing", "things"), json{{"what", "despawned"}, {"count", removed.size()}});
    }
    json out{{"removed", removed.size()}, {"items", removed}};
    if (!failure.empty())
    {
        out["failure"] = failure;
    }
    const auto undos = DespawnUndo(specs);
    if (undos.size() == 1)
    {
        out["undo"] = undos[0];
        out["undo_note"] = "the result's undo spawns it again where it stood (a new handle)";
    }
    else
    {
        out["undo"] = nullptr;
        if (!undos.empty())
        {
            out["undo_all"] = undos;
        }
        out["undo_note"] = undos.empty() ? "nothing was spawned" : "undo_all spawns each one again (new handles)";
    }
    return out;
}

json Service::Present(const Ops& aOps) const
{
    std::map<std::string, std::string> entities;
    {
        std::scoped_lock lock(m_mutex);
        for (const auto& [handle, item] : m_items) entities[std::to_string(handle)] = item.entity;
    }
    if (entities.empty()) return json::object();
    if (!aOps.presence) throw MethodError("precondition_unavailable", "No entity-presence reader.");
    return aOps.presence(entities);
}

json Service::Spawned(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {});
    std::vector<Item> items;
    {
        std::scoped_lock _(m_mutex);
        for (const auto& [handle, item] : m_items)
        {
            items.push_back(item);
        }
    }
    // Where each stands now, in one reading.
    std::map<std::string, json> live;
    if (!items.empty() && aOps.sample)
    {
        SampleWants wants;
        std::map<std::string, std::string> entities;
        for (const auto& item : items)
        {
            const auto key = "spawn:" + std::to_string(item.handle);
            wants.entities.push_back(key);
            entities[key] = item.entity;
        }
        try
        {
            const auto sample = aOps.sample(wants, entities);
            if (sample.contains("ents") && sample["ents"].is_object())
            {
                for (const auto& [key, value] : sample["ents"].items())
                {
                    live[key] = value;
                }
            }
        }
        catch (const MethodError&)
        {
        }
    }
    json list = json::array();
    for (const auto& item : items)
    {
        auto entry = ItemJson(item);
        const auto it = live.find("spawn:" + std::to_string(item.handle));
        entry["present"] = it != live.end();
        if (it != live.end() && it->second.contains("p"))
        {
            entry["position"] = it->second["p"];
        }
        list.push_back(entry);
    }
    json sounds = json::array();
    {
        std::scoped_lock _(m_mutex);
        for (const auto& [id, sound] : m_sounds)
        {
            sounds.push_back({{"id", id}, {"event", sound.event}, {"on", sound.on}, {"loop", sound.loop}});
        }
    }
    return json{{"spawned", list}, {"count", list.size()}, {"limit", kMaxSpawned}, {"sounds", sounds}};
}

json Service::Door(const json& aParams, const Ops& aOps)
{
    const auto request = ParseDoor(aParams);
    RequireWorld(aOps);
    DoorStep step;
    step.target = ResolveTarget(request.target);
    step.open = request.open;
    step.locked = request.locked;
    step.sealed = request.sealed;
    const auto done = aOps.door(step);
    const auto id = done.value("target_id", std::string());
    if (!id.empty())
    {
        // Opening unlocks and unseals a door (the quest actions do both).
        json asked = json::object();
        if (request.open)
        {
            asked["open"] = *request.open;
        }
        if (request.open.value_or(false))
        {
            asked["locked"] = false;
            asked["sealed"] = false;
        }
        else
        {
            if (request.locked)
            {
                asked["locked"] = *request.locked;
            }
            if (request.sealed)
            {
                asked["sealed"] = *request.sealed;
            }
        }
        RememberChange("door", id, done.value("before", json::object()), "door:" + id, asked, false);
    }
    Emit("world", "info", "door " + id + " changed", json{{"what", "door"}, {"target", id}, {"after", done.value("after", json::object())}});
    json out = done;
    out["undo"] = DoorUndo(done, request);
    out["undo_note"] = "the result's undo puts the door back as it was; the kill switch, a pause, a handover put every door back, and a save is refused while a door is changed";
    return out;
}

json Service::Vehicle(const json& aParams, const Ops& aOps)
{
    const auto request = ParseVehicle(aParams);
    RequireWorld(aOps);
    VehicleStep step;
    step.target = ResolveTarget(request.target);
    step.lights = request.lights;
    step.engine = request.engine;
    step.door = request.door;
    step.doorState = request.doorState;
    const auto done = aOps.vehicle(step);
    const auto id = done.value("target_id", std::string());
    if (!id.empty())
    {
        json before = done.value("before", json::object());
        // The game has no script read of the headlights: the state before is taken to be the opposite of what was asked.
        if (request.lights && !before.contains("lights"))
        {
            before["lights"] = !*request.lights;
        }
        json asked = json::object();
        if (request.lights)
        {
            asked["lights"] = *request.lights;
        }
        if (request.engine)
        {
            asked["engine"] = *request.engine;
        }
        bool sticky = false;
        if (!request.door.empty())
        {
            if (request.doorState == "open" || request.doorState == "closed")
            {
                json doors = json::object();
                for (const auto& name : VehicleDoors())
                {
                    if (name != "all" && (request.door == "all" || request.door == name))
                    {
                        doors[name] = request.doorState;
                    }
                }
                asked["doors"] = doors;
            }
            else
            {
                sticky = true; // a door's lock cannot be read back
            }
        }
        RememberChange("vehicle", id, before, "vehicle:" + id, asked, sticky);
    }
    Emit("world", "info", "vehicle " + id + " changed", json{{"what", "vehicle"}, {"target", id}});
    json out = done;
    out["undo"] = VehicleUndo(done, request);
    out["undo_note"] = "the result's undo puts back what it can read (the engine, the doors); the lights are switched the other way. Door locks cannot be read back, so changing one holds saving until a save loads, including after release";
    return out;
}

// ---- audio -------------------------------------------------------------------------------------------------------------

json Service::AudioPlay(const json& aParams, const Ops& aOps)
{
    const auto request = ParsePlay(aParams);
    RequireWorld(aOps);
    {
        std::scoped_lock _(m_mutex);
        // Finished one-shots leave the table first.
        for (auto it = m_sounds.begin(); it != m_sounds.end();)
        {
            it = (!it->second.loop && it->second.endsAt <= m_clock) ? m_sounds.erase(it) : std::next(it);
        }
        if (m_sounds.size() >= kMaxSounds)
        {
            throw MethodError("limit", "the bridge already tracks " + std::to_string(kMaxSounds) + " sounds; stop some with audio_stop first");
        }
    }
    const auto on = ResolveTarget(request.on);
    const auto done = aOps.audioPlay(request.event, on, request.emitter);
    Sound sound;
    sound.event = request.event;
    sound.on = request.on;
    sound.onId = done.value("on_id", on);
    sound.emitter = request.emitter;
    sound.loop = request.loop;
    int32_t id = 0;
    {
        std::scoped_lock _(m_mutex);
        id = m_nextSound++;
        sound.id = id;
        sound.endsAt = m_clock + request.seconds;
        m_sounds[id] = sound;
    }
    Emit("audio", "info", "sound " + request.event + " started", json{{"what", "play"}, {"id", id}, {"event", request.event}, {"on", request.on}, {"loop", request.loop}});
    return json{{"id", id}, {"event", request.event}, {"on", request.on}, {"on_id", sound.onId}, {"loop", request.loop},
                {"undo", {{"method", "audio.stop"}, {"params", {{"id", id}}}}},
                {"undo_note", "the result's undo stops it; a looped sound plays until it is stopped, the kill switch, a pause, a handover or a load"}};
}

json Service::AudioStop(const json& aParams, const Ops& aOps)
{
    const auto request = ParseStop(aParams);
    std::vector<Sound> targets;
    {
        std::scoped_lock _(m_mutex);
        if (request.all)
        {
            for (const auto& [id, sound] : m_sounds)
            {
                targets.push_back(sound);
            }
        }
        else
        {
            const auto it = m_sounds.find(request.id);
            if (it == m_sounds.end())
            {
                throw MethodError("not_found", "no sound " + std::to_string(request.id) + " is tracked (it may have ended; audio_play answers the id)");
            }
            targets.push_back(it->second);
        }
    }
    size_t stopped = 0;
    json again = json::array();
    for (const auto& sound : targets)
    {
        try
        {
            aOps.audioStop(sound.event, sound.onId, sound.emitter);
            ++stopped;
        }
        catch (const MethodError&)
        {
            continue;
        }
        {
            std::scoped_lock _(m_mutex);
            m_sounds.erase(sound.id);
        }
        again.push_back({{"method", "audio.play"}, {"params", {{"event", sound.event}, {"on", sound.on}, {"loop", sound.loop}}}});
    }
    Emit("audio", "info", Plural(targets.size(), "sound", "sounds") + " stopped", json{{"what", "stop"}, {"count", targets.size()}});
    return json{{"stopped", stopped}, {"tracked", targets.size()}, {"undo", nullptr}, {"undo_list", again},
                {"undo_note", "a sound can't be resumed; undo_list plays each again from the start"}};
}

json Service::AudioRadio(const json& aParams, const Ops& aOps)
{
    const auto request = ParseRadio(aParams);
    RequireWorld(aOps);
    RadioStep step;
    step.target = ResolveTarget(request.target);
    step.station = request.station;
    step.on = request.on;
    const auto done = aOps.radio(step);
    const auto id = done.value("target_id", std::string());
    if (!id.empty())
    {
        json asked = json::object();
        if (request.station)
        {
            asked["station"] = *request.station;
        }
        if (request.on)
        {
            asked["on"] = *request.on;
        }
        else if (request.station)
        {
            asked["on"] = true; // tuning a station turns the radio on
        }
        RememberChange("radio", id, done.value("before", json::object()), "radio:" + id, asked, false);
    }
    Emit("audio", "info", "radio " + id + " changed", json{{"what", "radio"}, {"target", id}});
    json out = done;
    out["undo"] = RadioUndo(done, request);
    out["undo_note"] = "the result's undo puts the station and the on state back; the kill switch, a pause and a handover do too";
    return out;
}

json Service::AudioVoice(const json& aParams, const Ops& aOps)
{
    const auto request = ParseVoice(aParams);
    RequireWorld(aOps);
    const auto done = aOps.voice(ResolveTarget(request.target), request.context);
    Emit("audio", "info", "voice line " + request.context, json{{"what", "voice"}, {"context", request.context}});
    json out = done;
    out["context"] = request.context;
    out["undo"] = nullptr;
    out["undo_note"] = "a spoken line can't be taken back";
    return out;
}

// ---- phone -------------------------------------------------------------------------------------------------------------

json Service::PhoneTextSend(const json& aParams, const Ops& aOps)
{
    const auto request = ParseText(aParams);
    RequireWorld(aOps);
    auto& session = SessionFor(aOps);
    aOps.phoneText(request.contact, request.text);
    auto out = session.Text(request, Now());
    m_notifications = true;
    return out;
}

json Service::PhoneCallStart(const json& aParams, const Ops& aOps)
{
    const auto request = ParseCall(aParams);
    RequireWorld(aOps);
    auto& session = SessionFor(aOps);
    return session.Call(request, Now());
}

json Service::PhoneEnd(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {});
    auto& session = SessionFor(aOps);
    return session.EndCall(Now(), "phone_end");
}

json Service::PhoneState(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {"contacts"});
    const bool contacts = p::CheckBoolean(aParams, "contacts").value_or(false);
    auto& session = SessionFor(aOps);
    json out = session.PhoneState(Now());
    if (contacts)
    {
        out["contacts"] = aOps.phoneContacts();
    }
    return out;
}

// ---- quests ------------------------------------------------------------------------------------------------------------

json Service::QuestSet(const json& aParams, const Ops& aOps)
{
    const auto request = ParseQuestSet(aParams);
    RequireWorld(aOps);
    auto& session = SessionFor(aOps);
    auto out = session.QuestSet(request, Now());
    if (!request.notify.empty())
    {
        NotifyRequest note;
        note.style = request.notify == "new" ? "quest_new" : "quest_update";
        note.text = request.quest.title;
        try
        {
            aOps.notify(note);
            m_notifications = true;
            out["notified"] = note.style;
        }
        catch (const MethodError& e)
        {
            out["notified"] = false;
            out["notify_error"] = e.code;
        }
    }
    return out;
}

json Service::QuestObjective(const json& aParams, const Ops& aOps)
{
    const auto request = ParseObjective(aParams);
    RequireWorld(aOps);
    auto& session = SessionFor(aOps);
    auto out = session.QuestObjective(request, Now());
    if (request.notify && request.state && *request.state != "hidden")
    {
        NotifyRequest note;
        const bool complete = out.value("quest_complete", false) && *request.state == "done";
        note.style = complete ? "quest_done" : (*request.state == "failed" ? "quest_failed" : "quest_update");
        note.text = out.value("text", std::string());
        try
        {
            aOps.notify(note);
            m_notifications = true;
            out["notified"] = note.style;
        }
        catch (const MethodError& e)
        {
            out["notified"] = false;
            out["notify_error"] = e.code;
        }
    }
    return out;
}

json Service::QuestClear(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {"id", "all"});
    const bool all = p::CheckBoolean(aParams, "all").value_or(false);
    std::string id;
    if (const auto text = p::CheckText(aParams, "id", 48))
    {
        id = *text;
    }
    if (all == !id.empty())
    {
        Bad("give id (the quest's id) or all: true, one of them");
    }
    auto& session = SessionFor(aOps);
    return session.QuestClear(id, all, Now());
}

json Service::QuestState(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {});
    return SessionFor(aOps).QuestState();
}

// ---- notifications -----------------------------------------------------------------------------------------------------

json Service::NotifyShow(const json& aParams, const Ops& aOps)
{
    const auto request = ParseNotify(aParams);
    RequireWorld(aOps);
    auto& session = SessionFor(aOps);
    if (request.style == "subtitle")
    {
        int32_t number = 0;
        {
            std::scoped_lock _(m_mutex);
            number = m_nextNotify++;
        }
        const auto id = session.ShowLine("notify:" + std::to_string(number), request.speaker, request.text, 1, request.seconds, Now());
        Emit("notify", "info", "subtitle shown", json{{"what", "subtitle"}, {"speaker", request.speaker}});
        return json{{"style", "subtitle"}, {"line", id}, {"seconds", request.seconds}, {"undo", {{"method", "notify.hide"}, {"params", {{"style", "subtitle"}}}}},
                    {"undo_note", "the result's undo takes the subtitle lines down; they go by themselves after seconds"}};
    }
    const auto done = aOps.notify(request);
    m_notifications = true;
    Emit("notify", "info", request.style + " shown", json{{"what", request.style}});
    json out = Merge(json{{"style", request.style}}, done);
    out["undo"] = request.style == "warning" || request.style == "onscreen" ? json{{"method", "notify.hide"}, {"params", {{"style", request.style}}}} : json(nullptr);
    out["undo_note"] = out["undo"].is_null() ? "a quest toast can't be taken back; it fades by itself" : "the result's undo takes the message down; it goes by itself after seconds";
    return out;
}

json Service::NotifyHide(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {"style"});
    std::string style;
    if (aParams.contains("style") && !aParams["style"].is_null())
    {
        const auto text = p::CheckText(aParams, "style", 24).value_or("");
        if (std::find(NotifyStyles().begin(), NotifyStyles().end(), text) == NotifyStyles().end())
        {
            Bad("'style' must be one of quest_new, quest_update, quest_done, quest_failed, onscreen, warning, subtitle (or leave it out for all)");
        }
        style = text;
    }
    auto& session = SessionFor(aOps);
    const bool lines = (style.empty() || style == "subtitle") ? session.HideLinesPrefix("notify:") : false;
    json shown = json::object();
    if (style != "subtitle")
    {
        shown = aOps.notifyHide(style);
    }
    return Merge(json{{"hidden", true}, {"subtitle_lines_hidden", lines}, {"undo", nullptr}, {"undo_note", "show it again with notify_show"}}, shown);
}

// ---- lights ------------------------------------------------------------------------------------------------------------

json Service::LightSpawn(const json& aParams, const Ops& aOps)
{
    const auto request = ParseLightSpawn(aParams);
    {
        std::scoped_lock _(m_mutex);
        if (m_items.size() >= kMaxSpawned)
        {
            throw MethodError("limit", "the bridge already has " + std::to_string(kMaxSpawned) + " spawned things (props, vehicles and lights together); remove some first");
        }
        if (CountItems("light") >= kMaxLights)
        {
            throw MethodError("limit", "the bridge already has " + std::to_string(kMaxLights) + " lights; light_remove takes one away");
        }
    }
    const auto v = RequireWorld(aOps);
    const auto vPos = ToVec(v.value("position", json::array({0, 0, 0})));
    const double vYaw = v.value("yaw", 0.0);
    Vec3 at = request.where.mode == Where::Mode::World ? request.where.point : OffsetPoint(vPos, vYaw, request.where.forward, request.where.right, request.where.up);
    if (Distance(at, vPos) > kMaxSpawnDistance)
    {
        throw MethodError("too_far", "that place is more than " + std::to_string(static_cast<int>(kMaxSpawnDistance)) + " m from V");
    }
    const double yaw = request.where.yaw ? *request.where.yaw : (request.where.faceV ? YawToward(at, vPos) : vYaw);
    int32_t handle = 0;
    {
        std::scoped_lock _(m_mutex);
        handle = m_nextHandle++;
    }
    LightStep step;
    step.handle = handle;
    step.templatePath = request.templatePath;
    step.label = request.label;
    step.at = at;
    step.yaw = yaw;
    step.colour = request.colour;
    step.intensity = request.intensity;
    step.radius = request.radius;
    step.inner = request.inner;
    step.outer = request.outer;
    const auto done = aOps.lightSpawn(step);

    Item item;
    item.handle = handle;
    item.kind = "light";
    item.entity = done.value("entity", std::string());
    item.templatePath = request.templatePath;
    item.label = request.label;
    item.position = at;
    item.yaw = yaw;
    item.colour = request.colour;
    item.intensity = request.intensity;
    item.radius = request.radius;
    item.inner = request.inner;
    item.outer = request.outer;
    item.pattern = request.pattern;
    item.pending = done.value("pending", false);
    item.configureUntil = Now() + 5.0;
    {
        std::scoped_lock _(m_mutex);
        m_items[handle] = item;
    }
    json patternNote = nullptr;
    if (!item.pending && request.pattern.kind != "steady")
    {
        // The pattern runs once the entity exists: flicker is the engine's own, the rest the tick drives.
        auto& session = SessionFor(aOps);
        LightSetStep set;
        set.entity = item.entity;
        try
        {
            if (request.pattern.kind == "flicker")
            {
                set.flickerStrength = request.pattern.strength;
                set.flickerPeriod = request.pattern.period;
                aOps.lightSet(set);
            }
            else
            {
                session.AnimateLight(handle, request.intensity, request.pattern, Now());
            }
            patternNote = PatternJson(request.pattern);
        }
        catch (const MethodError& e)
        {
            patternNote = json{{"refused", e.code}, {"message", e.what()}};
        }
    }
    Emit("light", "info", "light spawned", json{{"what", "spawned"}, {"handle", handle}, {"entity", item.entity}});
    json out = ItemJson(item);
    out["components"] = item.pending ? json(nullptr) : done.value("components", json(nullptr));
    out["components_state"] = item.pending ? "pending" : "resolved";
    out["pattern"] = patternNote;
    out["undo"] = json{{"method", "light.remove"}, {"params", {{"id", handle}}}};
    out["undo_note"] = "the result's undo removes it; the kill switch, a pause, a handover and loading a save remove every light, and a save is refused while one exists";
    return out;
}

json Service::LightSet(const json& aParams, const Ops& aOps)
{
    const auto request = ParseLightSet(aParams);
    RequireWorld(aOps);
    Item item;
    {
        std::scoped_lock _(m_mutex);
        // Any spawned thing may be steered: a lamp brought in with world_spawn holds a light component too (the script refuses
        // no_light_component for one that doesn't).
        const auto* found = FindItem(request.handle);
        if (found == nullptr)
        {
            throw MethodError("target_unknown", "the bridge has no spawned thing with the handle " + std::to_string(request.handle) + " (world_spawned lists what it spawned)");
        }
        item = *found;
    }
    auto& session = SessionFor(aOps);
    const std::optional<LightPattern> beforePattern = item.pattern;
    LightSetStep step;
    step.entity = item.entity;
    step.colour = request.colour;
    step.intensity = request.intensity;
    step.radius = request.radius;
    step.inner = request.inner;
    step.outer = request.outer;
    step.on = request.on;
    step.fadeS = request.fadeS;
    bool flicker = false;
    if (request.pattern)
    {
        if (request.pattern->kind == "flicker")
        {
            step.flickerStrength = request.pattern->strength;
            step.flickerPeriod = request.pattern->period;
            flicker = true;
        }
        else
        {
            step.flickerStrength = 0.0; // the engine's flicker off; the tick drives the rest
        }
    }
    const auto done = aOps.lightSet(step);
    {
        std::scoped_lock _(m_mutex);
        if (auto* live = FindItem(request.handle))
        {
            if (request.colour)
            {
                live->colour = *request.colour;
            }
            if (request.intensity)
            {
                live->intensity = *request.intensity;
            }
            if (request.radius)
            {
                live->radius = *request.radius;
            }
            if (request.inner)
            {
                live->inner = request.inner;
                live->outer = request.outer;
            }
            if (request.on)
            {
                live->on = *request.on;
            }
            if (request.pattern)
            {
                live->pattern = *request.pattern;
            }
            item = *live;
        }
    }
    if (request.pattern)
    {
        if (request.pattern->kind == "steady" || flicker)
        {
            session.ForgetLight(request.handle);
        }
        else
        {
            session.AnimateLight(request.handle, item.intensity, *request.pattern, Now());
        }
    }
    else if (request.intensity && beforePattern && beforePattern->kind != "flicker" && beforePattern->kind != "steady")
    {
        session.AnimateLight(request.handle, item.intensity, *beforePattern, Now()); // the pattern goes on at the new level
    }
    Emit("light", "info", "light " + std::to_string(request.handle) + " changed", json{{"what", "set"}, {"handle", request.handle}});
    json out{{"handle", request.handle}, {"light", ItemJson(item)}, {"before", done.value("before", json::object())}};
    if (request.pattern)
    {
        out["pattern"] = PatternJson(*request.pattern);
    }
    out["undo"] = LightSetUndo(request.handle, done.value("before", json::object()), beforePattern);
    out["undo_note"] = "the result's undo puts the earlier values and pattern back";
    return out;
}

json Service::LightRemove(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {"id", "all"});
    const bool all = p::CheckBoolean(aParams, "all").value_or(false);
    const auto handle = static_cast<int32_t>(p::CheckInteger(aParams, "id", 1, 1000000).value_or(-1));
    if (all == (handle > 0))
    {
        Bad("give id (what light_spawn answered) or all: true, one of them");
    }
    std::vector<Item> targets;
    {
        std::scoped_lock _(m_mutex);
        if (all)
        {
            for (const auto& [h, item] : m_items)
            {
                if (item.kind == "light")
                {
                    targets.push_back(item);
                }
            }
        }
        else
        {
            const auto* found = FindItem(handle);
            if (found == nullptr || found->kind != "light")
            {
                throw MethodError("target_unknown", "the bridge has no light with the handle " + std::to_string(handle));
            }
            targets.push_back(*found);
        }
    }
    auto& session = SessionFor(aOps);
    json removed = json::array();
    json again = json::array();
    json failures = json::array();
    for (const auto& item : targets)
    {
        try
        {
            if (!aOps.despawn(item.entity).value("despawned", false)) { throw MethodError("failed", "deletion not confirmed"); }
        }
        catch (const MethodError& e)
        {
            failures.push_back({{"handle", item.handle}, {"code", e.code}});
            continue; // still owned
        }
        session.ForgetLight(item.handle);
        {
            std::scoped_lock _(m_mutex);
            m_items.erase(item.handle);
        }
        removed.push_back(ItemJson(item));
        json params{{"colour", json::array({item.colour[0], item.colour[1], item.colour[2]})}, {"intensity", item.intensity}, {"radius", item.radius},
                    {"at", Arr(item.position)}, {"yaw", item.yaw}};
        if (!item.templatePath.empty())
        {
            params["template"] = item.templatePath;
        }
        if (item.inner)
        {
            params["inner"] = *item.inner;
            params["outer"] = *item.outer;
        }
        if (!item.label.empty())
        {
            params["label"] = item.label;
        }
        again.push_back({{"method", "light.spawn"}, {"params", params}});
    }
    if (!targets.empty())
    {
        Emit("light", "info", Plural(removed.size(), "light", "lights") + " removed", json{{"what", "removed"}, {"count", removed.size()}});
    }
    json out{{"removed", removed.size()}, {"lights", removed}, {"failures", failures}};
    if (again.size() == 1)
    {
        out["undo"] = again[0];
        out["undo_note"] = "the result's undo brings the light back (a new handle; its pattern is not restored)";
    }
    else
    {
        out["undo"] = nullptr;
        out["undo_list"] = again;
        out["undo_note"] = again.empty() ? "no light was there" : "undo_list brings each light back (new handles; patterns are not restored)";
    }
    return out;
}

// ---- watchers ----------------------------------------------------------------------------------------------------------

json Service::WatchArm(const json& aParams, const Ops& aOps)
{
    const auto spec = ParseWatch(aParams, aOps.actionCheck);
    RequireWorld(aOps);
    auto& session = SessionFor(aOps);
    return session.Arm(spec, Now());
}

json Service::WatchDisarm(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {"id", "all"});
    const bool all = p::CheckBoolean(aParams, "all").value_or(false);
    std::string id;
    if (const auto text = p::CheckText(aParams, "id", 48))
    {
        id = *text;
    }
    if (all == !id.empty())
    {
        Bad("give id (the watcher's id) or all: true, one of them");
    }
    auto& session = SessionFor(aOps);
    const auto dropped = all ? (aOps.microCancel ? aOps.microCancel("watch_disarm all") : 0) :
                              (aOps.microCancelWatch ? aOps.microCancelWatch(id) : 0);
    json out;
    try { out = session.Disarm(id, all); }
    catch (const MethodError& e)
    {
        if (e.code != "not_found") { throw; }
        out = json{{"disarmed", 0}, {"id", id}}; // idempotent, including a one-shot whose batch already finished
    }
    out["micro_dropped"] = dropped;
    return out;
}

json Service::WatchList(const json& aParams, const Ops& aOps)
{
    p::RequireOnly(aParams, {});
    return SessionFor(aOps).WatchList(Now());
}

// ---- digest ------------------------------------------------------------------------------------------------------------

json Service::GameDigest(const json& aParams, const Ops& aOps)
{
    const auto request = ParseDigest(aParams);
    auto& session = SessionFor(aOps);
    json out = aOps.digest ? aOps.digest(request.sky) : json::object();
    json placed = json::array();
    {
        std::scoped_lock _(m_mutex);
        for (const auto& [handle, item] : m_items)
        {
            json entry{{"target", "spawn:" + std::to_string(handle)}, {"kind", item.kind}, {"entity", item.entity}};
            if (!item.label.empty())
            {
                entry["label"] = item.label;
            }
            placed.push_back(entry);
        }
    }
    json changes = json::array();
    {
        std::scoped_lock _(m_mutex);
        for (const auto& [key, change] : m_changes)
        {
            changes.push_back({{"kind", change.kind}, {"target", change.targetId}});
        }
    }
    out["placed"] = placed;
    out["changed"] = changes;
    const auto phone = session.Digest(Now());
    out["watchers"] = phone["watchers"];
    out["quests"] = phone["quests"];
    out["phone"] = phone["phone"];
    EventLog* events = nullptr;
    {
        std::scoped_lock _(m_mutex);
        events = m_events;
    }
    json recent = json::array();
    if (events && request.events > 0)
    {
        const auto kinds = request.kinds.empty() ? DefaultDigestKinds() : request.kinds;
        const auto latest = events->Latest();
        const uint64_t since = latest > 400 ? latest - 400 : 0;
        const auto read = events->Read(since, 400, kinds);
        const auto& list = read.contains("events") ? read["events"] : json::array();
        const size_t from = list.size() > request.events ? list.size() - request.events : 0;
        for (size_t i = from; i < list.size(); ++i)
        {
            const auto& e = list[i];
            json item{{"seq", e.value("seq", 0)}, {"kind", e.value("kind", std::string())}, {"text", e.value("text", std::string())}};
            if (e.contains("data"))
            {
                item["data"] = e["data"];
            }
            recent.push_back(item);
        }
    }
    out["events"] = recent;
    return out;
}

// ---- the tick, release and the lifecycle -------------------------------------------------------------------------------

bool Service::Active() const
{
    std::function<size_t()> pending;
    bool active;
    {
        std::scoped_lock _(m_mutex);
        active = m_notifications || m_cleanupPending || !m_items.empty() || !m_sounds.empty() || !m_changes.empty() ||
                 (m_session && (m_session->Busy() || m_session->QuestCount() > 0));
        pending = m_tickOps.microPending;
    }
    return active || (pending && pending() > 0);
}

bool Service::NeedsCleanup() const
{
    std::scoped_lock _(m_mutex);
    return m_notifications || m_cleanupPending || !m_items.empty() || !m_sounds.empty() ||
           std::any_of(m_changes.begin(), m_changes.end(), [](const auto& entry) { return !entry.second.dormant; }) ||
           (m_session && (m_session->Busy() || m_session->QuestCount() > 0));
}

json Service::Holds() const
{
    std::scoped_lock _(m_mutex);
    json held = json::array();
    if (m_cleanupPending || (m_session && m_session->CleanupPending())) { held.push_back("live-direction cleanup awaiting confirmation"); }
    if (!m_items.empty())
    {
        held.push_back(Plural(m_items.size(), "spawned thing", "spawned things") + " from the live-direction toolkit (world_spawned; world_despawn and light_remove take them away)");
    }
    if (!m_changes.empty())
    {
        std::string names;
        for (const auto& [key, change] : m_changes)
        {
            names += (names.empty() ? "" : ", ") + change.kind;
        }
        held.push_back("a door, vehicle or radio the toolkit changed (" + names + ")");
    }
    return held;
}

json Service::ReleaseEverything(const std::string& aReason, const Ops& aOps, bool aUi)
{
    std::map<std::string, Change> changes;
    std::vector<Item> items;
    std::vector<Sound> sounds;
    Session* session = nullptr;
    {
        std::scoped_lock _(m_mutex);
        m_releaseRequested = true;
        m_releaseRetry.Attempt(m_clock);
        session = m_session.get();
        changes = m_changes;
        for (const auto& [handle, item] : m_items)
        {
            items.push_back(item);
        }
        for (const auto& [id, sound] : m_sounds) { sounds.push_back(sound); }
    }
    json out{{"reason", aReason}};
    // The micro-actions waiting stop first, so none lands after the put-back.
    if (aOps.microCancel)
    {
        out["micro_dropped"] = aOps.microCancel(aReason);
    }
    // Stop before deleting emitters. Failed stops remain owned for retry.
    size_t stopped = 0;
    for (const auto& sound : sounds)
    {
        try
        {
            if (!aOps.audioStop) { throw MethodError("not_ready", "audio stop unavailable"); }
            aOps.audioStop(sound.event, sound.onId, sound.emitter);
            { std::scoped_lock _(m_mutex); m_sounds.erase(sound.id); }
            ++stopped;
        }
        catch (const std::exception& e) { out["sound_errors"].push_back(e.what()); }
    }
    // Doors, vehicles and radios put back (the original state the first change saw).
    json restored = json::array();
    for (const auto& [key, change] : changes)
    {
        if (change.dormant)
        {
            // Only the unreadable lock remains. Do not reapply old door/engine values every paused tick.
            restored.push_back({{"kind", change.kind}, {"target", change.targetId}, {"ok", false}, {"requires_load", true}});
            continue;
        }
        try
        {
            if ((change.kind == "door" && !aOps.door) || (change.kind == "vehicle" && !aOps.vehicle) || (change.kind == "radio" && !aOps.radio))
            { throw MethodError("not_ready", "restore adapter unavailable"); }
            if (change.kind == "door")
            {
                DoorStep step;
                step.target = change.targetId;
                if (change.original.contains("open"))
                {
                    step.open = change.original["open"].get<bool>();
                }
                if (change.original.contains("locked"))
                {
                    step.locked = change.original["locked"].get<bool>();
                }
                if (change.original.contains("sealed"))
                {
                    step.sealed = change.original["sealed"].get<bool>();
                }
                if (aOps.door && (step.open || step.locked || step.sealed))
                {
                    aOps.door(step);
                }
            }
            else if (change.kind == "vehicle" && aOps.vehicle)
            {
                if (change.original.contains("lights") || change.original.contains("engine"))
                {
                    VehicleStep step;
                    step.target = change.targetId;
                    if (change.original.contains("lights") && change.original["lights"].is_boolean())
                    {
                        step.lights = change.original["lights"].get<bool>();
                    }
                    if (change.original.contains("engine") && change.original["engine"].is_boolean())
                    {
                        step.engine = change.original["engine"].get<bool>();
                    }
                    aOps.vehicle(step);
                }
                if (change.original.contains("doors") && change.original["doors"].is_object())
                {
                    for (const auto& [door, state] : change.original["doors"].items())
                    {
                        if (state.is_string() && (state == "open" || state == "closed"))
                        {
                            VehicleStep step;
                            step.target = change.targetId;
                            step.door = door;
                            step.doorState = state.get<std::string>();
                            aOps.vehicle(step);
                        }
                    }
                }
            }
            else if (change.kind == "radio" && aOps.radio)
            {
                RadioStep step;
                step.target = change.targetId;
                if (change.original.contains("station") && change.original["station"].is_number_integer())
                {
                    step.station = change.original["station"].get<int32_t>();
                }
                if (change.original.contains("on") && change.original["on"].is_boolean())
                {
                    step.on = change.original["on"].get<bool>();
                }
                if (step.station || step.on)
                {
                    aOps.radio(step);
                }
            }
            restored.push_back({{"kind", change.kind}, {"target", change.targetId}, {"ok", !change.sticky}, {"requires_load", change.sticky}});
            // An unreadable lock baseline cannot be restored by moving its door. Hold until load.
            {
                std::scoped_lock _(m_mutex);
                const auto it = m_changes.find(key);
                if (it != m_changes.end() && it->second.current == change.current)
                {
                    if (!change.sticky) { m_changes.erase(it); }
                    else { it->second.current = change.original; it->second.dormant = true; }
                }
            }
        }
        catch (const std::exception& e)
        {
            restored.push_back({{"kind", change.kind}, {"target", change.targetId}, {"ok", false}, {"error", e.what()}});
        }
    }
    out["restored"] = restored;
    size_t removed = 0;
    for (const auto& item : items)
    {
        try
        {
            if (!aOps.despawn) { throw MethodError("not_ready", "despawn adapter unavailable"); }
            if (!aOps.despawn(item.entity).value("despawned", false)) { throw MethodError("failed", "deletion not confirmed"); }
            { std::scoped_lock _(m_mutex); m_items.erase(item.handle); }
            ++removed;
        }
        catch (const std::exception& e) { out["despawn_errors"].push_back(e.what()); }
    }
    // The session: lines hidden, the call ended, the tracker restored, watchers dropped.
    if (session) { out["session"] = session->Reset(aUi); }
    // Everything the script holds, in one step.
    try
    {
        if (aOps.releaseAll)
        {
            out["script"] = aOps.releaseAll(aReason, static_cast<int32_t>(removed));
            // The script confirms every remaining line, call and tracker resource was cleaned up.
            if (session) { session->Reset(false); }
            { std::scoped_lock _(m_mutex); m_notifications = false; m_cleanupPending = false; }
        }
        else { throw MethodError("not_ready", "script cleanup adapter unavailable"); }
    }
    catch (const std::exception& e)
    {
        out["script_error"] = e.what();
        { std::scoped_lock _(m_mutex); m_cleanupPending = true; }
    }
    out["spawned_removed"] = std::max(removed, out.contains("script") ? out["script"].value("entities_removed", size_t{0}) : size_t{0});
    out["sounds_stopped"] = stopped;
    const bool pending = NeedsCleanup();
    {
        std::scoped_lock _(m_mutex);
        m_releaseRequested = pending;
        out["cleanup_pending"] = pending;
        out["automatic_attempts"] = m_releaseRetry.attempts;
        out["retry_exhausted"] = pending && m_releaseRetry.attempts >= 4;
    }
    return out;
}

json Service::ReleaseAllNow(const std::string& aReason, const Ops& aOps)
{
    json receipt;
    { std::scoped_lock _(m_mutex); const auto it = m_releaseReceipts.find(aReason);
      if (it != m_releaseReceipts.end()) { receipt = it->second; m_releaseReceipts.erase(it); } }
    const bool wasActive = Active();
    if (aOps.microCancel) { aOps.microCancel(aReason); }
    if (!wasActive && !Active())
    {
        return receipt.is_object() ? receipt : json{{"released", false}, {"nothing_held", true}};
    }
    { std::scoped_lock _(m_mutex); m_releaseRetry = {}; }
    auto out = ReleaseEverything(aReason, aOps, true);
    if (receipt.is_object()) {
        out["spawned_removed"] = out.value("spawned_removed", size_t{0}) + receipt.value("spawned_removed", size_t{0});
        out["sounds_stopped"] = out.value("sounds_stopped", size_t{0}) + receipt.value("sounds_stopped", size_t{0});
        out["earlier_cleanup"] = receipt;
    }
    out["released"] = !Active();
    Emit("released", "warn", Active() ? "toolkit cleanup still holds resources (" + aReason + ")" : "everything the toolkit holds was released (" + aReason + ")", json{{"reason", aReason}, {"auto", true}});
    return out;
}

json Service::RestoreAfterKill(const Ops& aOps)
{
    json receipt;
    { std::scoped_lock _(m_mutex); const auto it = m_releaseReceipts.find("kill");
      if (it != m_releaseReceipts.end()) { receipt = it->second; m_releaseReceipts.erase(it); } }
    const bool wasActive = Active();
    if (aOps.microCancel) { aOps.microCancel("kill"); }
    if (!wasActive && !Active())
    {
        return receipt.is_object() ? receipt : json{{"released", false}, {"nothing_held", true}};
    }
    { std::scoped_lock _(m_mutex); m_releaseRetry = {}; }
    auto out = ReleaseEverything("kill", aOps, true);
    if (receipt.is_object()) {
        out["spawned_removed"] = out.value("spawned_removed", size_t{0}) + receipt.value("spawned_removed", size_t{0});
        out["sounds_stopped"] = out.value("sounds_stopped", size_t{0}) + receipt.value("sounds_stopped", size_t{0});
        out["earlier_cleanup"] = receipt;
    }
    out["released"] = !Active();
    return out;
}

void Service::DropAll(const std::string& aReason)
{
    std::function<size_t(const std::string&)> cancel;
    bool had;
    {
        std::scoped_lock _(m_mutex);
        had = m_notifications || m_cleanupPending || !m_items.empty() || !m_sounds.empty() || !m_changes.empty() ||
              (m_session && (m_session->Busy() || m_session->QuestCount() > 0));
        if (m_session) { m_session->Reset(false); } // plain bookkeeping, no adapters
        cancel = m_tickOps.microCancel;
        m_items.clear(); m_sounds.clear(); m_changes.clear();
        m_notifications = false; m_cleanupPending = false; m_releaseRequested = false; m_releaseRetry = {}; m_releaseReceipts.clear();
    }
    if (cancel) { cancel(aReason); }
    if (had) { Emit("released", "info", "the toolkit's state was forgotten (" + aReason + "): the world took what it had brought in", json{{"reason", aReason}}); }
}

void Service::Tick(double aDt, const TickInput& aInput)
{
    bool detached = false;
    {
        std::scoped_lock _(m_mutex);
        m_clock += std::max(0.0, std::min(aDt, 0.5));
        if (!m_detachesKnown)
        {
            m_detaches = aInput.detaches;
            m_detachesKnown = true;
        }
        else if (aInput.detaches != m_detaches)
        {
            m_detaches = aInput.detaches;
            detached = true; // a load: the world took the entities; nothing is called
        }
    }
    if (detached)
    {
        DropAll("session_detached");
        return;
    }
    if (m_tickOpsBuilt && (aInput.killed || aInput.paused || aInput.handedOver || !aInput.gateOpen) && m_tickOps.microCancel)
    { m_tickOps.microCancel("gate_closed"); }
    if (!aInput.gateOpen || !m_tickOpsBuilt || !Active() || (aInput.killed && !m_releaseRequested))
    {
        return;
    }
    if (aInput.paused || aInput.handedOver || m_releaseRequested)
    {
        if (!NeedsCleanup()) { return; }
        {
            std::scoped_lock _(m_mutex);
            if (!m_releaseRequested) { m_releaseRequested = true; m_releaseRetry = {}; }
            if (!m_releaseRetry.Due(m_clock)) { return; }
        }
        // The pause and a handover release everything (a handover's own request has done it already; this is the safety net).
        const std::string reason = aInput.killed ? "kill" : aInput.handedOver ? "handover" : aInput.paused ? "paused" : "cleanup_retry";
        Ops ops;
        {
            std::scoped_lock _(m_mutex);
            ops = m_tickOps;
        }
        RestoreScope restoring;
        auto out = ReleaseEverything(reason, ops, true);
        { std::scoped_lock _(m_mutex);
          auto& receipt = m_releaseReceipts.try_emplace(reason, json::object()).first->second;
          out["spawned_removed"] = out.value("spawned_removed", size_t{0}) + receipt.value("spawned_removed", size_t{0});
          out["sounds_stopped"] = out.value("sounds_stopped", size_t{0}) + receipt.value("sounds_stopped", size_t{0});
          out["released"] = !Active();
          receipt = out; }
        Emit("released", "warn", Active() ? "toolkit cleanup still holds resources (" + reason + ")" : "everything the toolkit holds was released (" + reason + ")", json{{"reason", reason}, {"auto", true}, {"result", out}});
        return;
    }
    if (aInput.writesOpen && !aInput.writesOpen())
    {
        return;
    }
    Ops ops;
    std::vector<Item> lights;
    const double now = Now();
    {
        std::scoped_lock _(m_mutex);
        ops = m_tickOps;
        for (const auto& [handle, item] : m_items) { if (item.pending) { lights.push_back(item); } }
    }
    // Game-thread serialization owns execution; the mutex protects snapshots, never adapters.
    for (const auto& item : lights)
    {
        const auto handle = item.handle;
        try
        {
            if (now >= item.configureUntil) { throw MethodError("not_streamed", "light did not stream within five seconds"); }
            LightSetStep set;
            set.entity = item.entity; set.colour = item.colour; set.intensity = item.intensity;
            set.radius = item.radius; set.inner = item.inner; set.outer = item.outer; set.on = item.on;
            if (item.pattern.kind == "flicker") { set.flickerStrength = item.pattern.strength; set.flickerPeriod = item.pattern.period; }
            ops.lightSet(set);
            { std::scoped_lock _(m_mutex); if (auto* live = FindItem(handle)) { live->pending = false; } }
            if (item.pattern.kind != "steady" && item.pattern.kind != "flicker")
            { SessionFor(ops).AnimateLight(handle, item.intensity, item.pattern, now); }
            Emit("light", "info", "light configured", json{{"what", "ready"}, {"handle", handle}, {"pending", false}});
        }
        catch (const MethodError& e)
        {
            if (e.code == "target_missing" && now < item.configureUntil) { continue; }
            { std::scoped_lock _(m_mutex); if (auto* live = FindItem(handle)) { live->pending = false; live->error = e.code; } }
            try
            {
                if (ops.despawn(item.entity).value("despawned", false))
                { std::scoped_lock _(m_mutex); m_items.erase(handle); }
            }
            catch (...) {}
            Emit("light", "warn", "light configuration failed", json{{"what", "failed"}, {"handle", handle}, {"code", e.code}});
        }
    }
    Session* session;
    { std::scoped_lock _(m_mutex); session = m_session.get(); }
    if (session) { session->Tick(now); }
}

// ---- registration ------------------------------------------------------------------------------------------------------

void RegisterMethods(Dispatcher& aDispatcher, Service& aService, std::function<MethodSpec(MethodSpec)> aMarkWrite)
{
    using Fn = json (Service::*)(const json&, const Ops&);
    auto* service = &aService;
    // The service builds each request's game steps itself (aOpsFor was given to it), so the methods only hand over the params.
    // Written as {name, access, summary, fn} so the tools' catalogue test reads each access class from this source.
    const std::vector<std::tuple<const char*, Access, bool, const char*, Fn>> methods{
        {"world.spawn", Access::WriteDm, true, "Brings in a prop or a vehicle near V (never saved).", &Service::Spawn},
        {"world.despawn", Access::WriteDm, true, "Removes props and vehicles the bridge brought in.", &Service::Despawn},
        {"world.spawned", Access::Read, true, "What the bridge brought in, with where each stands now.", &Service::Spawned},
        {"world.door", Access::WriteDm, true, "Opens, closes, locks or seals a door.", &Service::Door},
        {"vehicle.set", Access::WriteDm, true, "A vehicle's lights, engine and doors.", &Service::Vehicle},
        {"audio.play", Access::WriteDm, true, "Plays a sound event on V, the world or an entity.", &Service::AudioPlay},
        {"audio.stop", Access::WriteDm, true, "Stops a sound the bridge started.", &Service::AudioStop},
        {"audio.radio", Access::WriteDm, true, "A radio device's or vehicle's station and on state.", &Service::AudioRadio},
        {"audio.voice", Access::WriteDm, true, "An NPC says a line of its own voiceset.", &Service::AudioVoice},
        {"phone.text", Access::WriteDm, true, "Shows a message toast from a name.", &Service::PhoneTextSend},
        {"phone.call", Access::WriteDm, true, "A real incoming call from a journal contact, with subtitle lines once answered.", &Service::PhoneCallStart},
        {"phone.end", Access::WriteDm, true, "Ends the ringing or running call.", &Service::PhoneEnd},
        {"phone.state", Access::Read, true, "The call, the messages shown and (on request) the journal's contacts.", &Service::PhoneState},
        {"quest.set", Access::WriteDm, true, "An XF quest in the HUD's quest tracker (journal-free).", &Service::QuestSet},
        {"quest.objective", Access::WriteDm, true, "Changes one objective of an XF quest.", &Service::QuestObjective},
        {"quest.clear", Access::WriteDm, true, "Removes an XF quest from the tracker.", &Service::QuestClear},
        {"quest.state", Access::Read, true, "The XF quests and their objectives.", &Service::QuestState},
        {"notify.show", Access::WriteDm, true, "The game's own banners, centred messages, quest toasts and subtitle lines.", &Service::NotifyShow},
        {"notify.hide", Access::WriteDm, true, "Takes the bridge's messages down.", &Service::NotifyHide},
        {"light.spawn", Access::WriteDm, true, "Brings in a light.", &Service::LightSpawn},
        {"light.set", Access::WriteDm, true, "A light's colour, intensity, cone, state and pattern.", &Service::LightSet},
        {"light.remove", Access::WriteDm, true, "Removes lights the bridge brought in.", &Service::LightRemove},
        {"watch.arm", Access::WriteDm, true, "Arms an in-game watcher with micro-actions.", &Service::WatchArm},
        {"watch.disarm", Access::WriteDm, true, "Disarms watchers.", &Service::WatchDisarm},
        {"watch.list", Access::Read, true, "The armed watchers.", &Service::WatchList},
        {"game.digest", Access::Read, true, "One compact read of V, the world, what the bridge placed, watchers and events.", &Service::GameDigest},
    };
    for (const auto& [name, access, gameThread, summary, fn] : methods)
    {
        MethodSpec spec{name, access, gameThread ? RunOn::GameThread : RunOn::BridgeThread, summary, [service, fn](const MethodContext& aContext) {
                            return (service->*fn)(aContext.params, service->OpsForCid(aContext.cid));
                        }};
        aDispatcher.Register(IsWrite(access) ? aMarkWrite(std::move(spec)) : std::move(spec));
    }
}
} // namespace xfb::dm
