#include "selftest/Sim060.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>

#include "core/Log.hpp"
#include "core/Params.hpp"
#include "core/Player.hpp"
#include "core/Scene.hpp"
#include "core/Writes.hpp"

namespace w = xfb::writes;

namespace xfb::selftest
{
namespace
{
using Vec3 = std::array<double, 3>;
constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;

Vec3 Add(const Vec3& a, const Vec3& b)
{
    return {a[0] + b[0], a[1] + b[1], a[2] + b[2]};
}
Vec3 Sub(const Vec3& a, const Vec3& b)
{
    return {a[0] - b[0], a[1] - b[1], a[2] - b[2]};
}
Vec3 Mul(const Vec3& a, double k)
{
    return {a[0] * k, a[1] * k, a[2] * k};
}
double Dot(const Vec3& a, const Vec3& b)
{
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
double Len(const Vec3& a)
{
    return std::sqrt(Dot(a, a));
}
Vec3 Cross(const Vec3& a, const Vec3& b)
{
    return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}
json Arr(const Vec3& a)
{
    const auto r = [](double v) { return std::round(v * 1e4) / 1e4; };
    return json::array({r(a[0]), r(a[1]), r(a[2])});
}
Vec3 VecOf(const json& aValue)
{
    return {aValue[0].get<double>(), aValue[1].get<double>(), aValue[2].get<double>()};
}

struct Camera
{
    Vec3 position, forward, right, up;
    double fov, aspect;
};

// A static occluder: a wall box between the camera's side and the far NPC.
bool Blocked(const Vec3& aFrom, const Vec3& aTo, Vec3& aHit)
{
    const Vec3 lo{100.8, 199.0, 9.0}, hi{103.0, 199.4, 13.0};
    double t0 = 0.0, t1 = 1.0;
    const Vec3 d = Sub(aTo, aFrom);
    for (int i = 0; i < 3; ++i)
    {
        if (std::abs(d[i]) < 1e-9)
        {
            if (aFrom[i] < lo[i] || aFrom[i] > hi[i])
            {
                return false;
            }
            continue;
        }
        double a = (lo[i] - aFrom[i]) / d[i], b = (hi[i] - aFrom[i]) / d[i];
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
    aHit = Add(aFrom, Mul(d, t0));
    return true;
}

json Ray(const Vec3& aFrom, const Vec3& aTo)
{
    const double distance = Len(Sub(aTo, aFrom));
    if (distance < 0.3)
    {
        return json{{"checked", false}, {"why", "closer than 30 cm"}};
    }
    Vec3 hit{};
    if (!Blocked(aFrom, aTo, hit))
    {
        return json{{"checked", true}, {"blocked", false}, {"target_distance", distance}};
    }
    const double hitDistance = Len(Sub(hit, aFrom));
    return json{{"checked", true}, {"blocked", hitDistance < distance - 0.12}, {"hit", Arr(hit)}, {"hit_distance", hitDistance},
                {"target_distance", distance}, {"material", "concrete"}};
}

// ProjectPoint as the simulated game answers it: normalised device coordinates, y up, a vertical field of view.
json Project(const Camera& aCamera, const Vec3& aPoint)
{
    const auto d = Sub(aPoint, aCamera.position);
    const double depth = Dot(d, aCamera.forward);
    const double t = std::tan(aCamera.fov * kDeg / 2.0);
    if (depth <= 1e-6)
    {
        return json{{"x", 0.0}, {"y", 0.0}, {"z", depth}, {"w", 1.0}};
    }
    return json{{"x", Dot(d, aCamera.right) / depth / (t * aCamera.aspect)}, {"y", Dot(d, aCamera.up) / depth / t}, {"z", depth}, {"w", 1.0}};
}
} // namespace

struct Sim060::State
{
    std::mutex mutex;
    // V in normal play.
    Vec3 position{100.0, 200.0, 10.0};
    double yaw = 0.0;   // facing +Y
    double pitch = 0.0; // the first-person camera's
    std::string busy;   // selftest.player {busy}
    bool crouched = false;
    bool weaponDrawn = false;
    std::string menu;
    std::vector<std::string> effects;
    // A look-at in progress: the camera turns towards the point over the duration.
    bool looking = false;
    double lookFromYaw = 0, lookFromPitch = 0, lookToYaw = 0, lookToPitch = 0, lookT = 0, lookDuration = 1;
    // photo.camera.preset: each preset's flats and the selected preset (0: Customization).
    std::map<int32_t, std::map<std::string, double>> presets;
    int32_t selectedPreset = 0;
};

Sim060::Sim060(Dispatcher& aDispatcher, GameThreadQueue& aQueue, const Config& aConfig, SimHooks aHooks)
    : m_dispatcher(aDispatcher)
    , m_queue(aQueue)
    , m_config(aConfig)
    , m_hooks(std::move(aHooks))
    , m_state(std::make_unique<State>())
{
}

Sim060::~Sim060() = default;

EventLog& Sim060::Events()
{
    return m_events;
}

void Sim060::Register()
{
    auto& st = *m_state;
    auto* self = this;
    RegisterEventMethods(m_dispatcher, m_events);
    m_behaviours.SetEvents(&m_events);
    m_dispatcher.SetEventSink([self](const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData) {
        self->m_events.Push(aKind, aLevel, "bridge", aText, aData);
    });

    // The simulated camera: photo mode's (pitched 10 degrees down, as a photo-mode camera looking at V's face from above), or
    // V's first-person one.
    const auto camera = [self]() -> Camera {
        auto& s = *self->m_state;
        if (self->m_hooks.phase() == "photo_mode")
        {
            const double p = -10.0 * kDeg;
            const Vec3 f{0.0, std::cos(p), std::sin(p)};
            const Vec3 r{1.0, 0.0, 0.0};
            return {{100.0, 198.0, 11.7}, f, r, Cross(r, f), 30.0, 16.0 / 9.0};
        }
        const double y = s.yaw * kDeg, p = s.pitch * kDeg;
        const Vec3 f{-std::sin(y) * std::cos(p), std::cos(y) * std::cos(p), std::sin(p)};
        const Vec3 r{std::cos(y), std::sin(y), 0.0};
        return {Add(s.position, {0.0, 0.0, 1.7}), f, r, Cross(r, f), 60.0, 16.0 / 9.0};
    };
    const auto cameraJson = [](const Camera& aCamera, const std::string& aMode) {
        return json{{"position", Arr(aCamera.position)}, {"forward", Arr(aCamera.forward)}, {"right", Arr(aCamera.right)}, {"up", Arr(aCamera.up)},
                    {"fov", aCamera.fov}, {"aspect", aCamera.aspect}, {"mode", aMode},
                    {"yaw", std::atan2(-aCamera.forward[0], aCamera.forward[1]) / kDeg}, {"pitch", std::asin(aCamera.forward[2]) / kDeg}};
    };
    const auto busyNow = [self]() -> std::string {
        auto& s = *self->m_state;
        if (self->m_hooks.phase() != "gameplay")
        {
            return "player_busy";
        }
        return s.busy;
    };
    const auto requireGameplay = [self](const char* aWhat) {
        if (self->m_hooks.phase() != "gameplay")
        {
            throw MethodError("not_in_gameplay", std::string("simulated: ") + aWhat + " only in normal play; the game is in " + self->m_hooks.phase());
        }
    };

    // scene.read
    m_dispatcher.Register({"scene.read", Access::Read, RunOn::GameThread, "The scene (simulated).", [self, camera, cameraJson](const MethodContext& aContext) {
                               const auto request = scene::ParseRead(aContext.params);
                               const auto has = [&](const char* aPart) {
                                   return request.parts.empty() || std::find(request.parts.begin(), request.parts.end(), aPart) != request.parts.end();
                               };
                               const auto phase = self->m_hooks.phase();
                               const bool photo = phase == "photo_mode";
                               std::scoped_lock _(self->m_state->mutex);
                               auto& s = *self->m_state;
                               const auto cam = camera();
                               json out{{"simulated", true}, {"phase", phase}};
                               out["camera"] = cameraJson(cam, photo ? "photo" : phase);
                               const Vec3 c1 = Add(cam.position, cam.forward);
                               out["calibration"] = {{"center", Project(cam, c1)}, {"up", Project(cam, Add(c1, Mul(cam.up, 0.1)))},
                                                     {"right", Project(cam, Add(c1, Mul(cam.right, 0.1)))}, {"far", Project(cam, Add(cam.position, Mul(cam.forward, 5.0)))}};
                               const auto subject = [&](const Vec3& aPosition, double aYaw, bool aOcclusion) {
                                   const Vec3 f{-std::sin(aYaw * kDeg), std::cos(aYaw * kDeg), 0.0};
                                   const Vec3 head = Add(aPosition, {0.0, 0.0, 1.62});
                                   const Vec3 face = Add(Add(head, Mul(f, 0.08)), {0.0, 0.0, 0.045});
                                   json o{{"position", Arr(aPosition)}, {"head", Arr(head)}, {"head_slot", true}, {"forward", Arr(f)}, {"yaw", aYaw}, {"face", Arr(face)}};
                                   if (aOcclusion)
                                   {
                                       o["occlusion"] = Ray(cam.position, face);
                                   }
                                   return o;
                               };
                               if (has("v"))
                               {
                                   auto v = photo ? subject({100.0, 200.5, 10.0}, 180.0, request.occlusion) : subject(s.position, s.yaw, false);
                                   v["source"] = photo ? "photo_puppet" : "player";
                                   out["v"] = v;
                               }
                               if (has("npcs") && request.maxNpcs > 0)
                               {
                                   json npcs = json::array();
                                   const struct
                                   {
                                       const char* name;
                                       Vec3 at;
                                       double yaw;
                                   } all[] = {{"Sim NPC A", {101.5, 201.0, 10.0}, 150.0}, {"Sim NPC B", {104.5, 202.0, 10.0}, 180.0}, {"Sim NPC far", {100.0, 260.0, 10.0}, 0.0}};
                                   for (const auto& npc : all)
                                   {
                                       const double distance = Len(Sub(npc.at, s.position));
                                       if (distance > request.radius || static_cast<int32_t>(npcs.size()) >= request.maxNpcs)
                                       {
                                           continue;
                                       }
                                       auto o = subject(npc.at, npc.yaw, request.occlusion);
                                       o["id"] = std::string("sim:") + npc.name;
                                       o["name"] = npc.name;
                                       o["class"] = "NPCPuppet";
                                       o["distance"] = distance;
                                       o["dead"] = false;
                                       npcs.push_back(o);
                                   }
                                   out["npcs"] = npcs;
                               }
                               if (has("showroom"))
                               {
                                   auto room = self->m_hooks.showroom();
                                   for (auto& piece : room["pieces"])
                                   {
                                       const auto pos = VecOf(piece["position"]);
                                       const double yaw = piece.value("yaw", 0.0) * kDeg;
                                       const auto& e = request.pieceEyes;
                                       const Vec3 eyes{pos[0] + std::cos(yaw) * e[0] - std::sin(yaw) * e[1], pos[1] + std::sin(yaw) * e[0] + std::cos(yaw) * e[1], pos[2] + e[2]};
                                       piece["eyes"] = Arr(eyes);
                                       if (request.occlusion)
                                       {
                                           piece["occlusion"] = Ray(cam.position, eyes);
                                       }
                                   }
                                   out["showroom"] = room;
                               }
                               if (has("lights"))
                               {
                                   json photoLights = json::array();
                                   if (photo)
                                   {
                                       const auto lights = self->m_hooks.photoLights();
                                       const Vec3 face{100.0, 200.42, 11.665};
                                       for (int i = 1; i <= 3; ++i)
                                       {
                                           const auto key = std::to_string(i);
                                           if (lights.contains(key))
                                           {
                                               const auto at = VecOf(lights[key]);
                                               photoLights.push_back({{"light", i}, {"found", true}, {"position", Arr(at)}, {"forward", Arr({0.0, 1.0, 0.0})}, {"to_face", Ray(at, face)}});
                                           }
                                           else
                                           {
                                               photoLights.push_back({{"light", i}, {"found", false}, {"why", "simulated: the light is off"}});
                                           }
                                       }
                                   }
                                   out["lights"] = {{"photo", photoLights}, {"world_lights", "not read: the world's own lights aren't listed to scripts (research)"}};
                               }
                               if (has("world"))
                               {
                                   out["world"] = {{"time", {{"hours", 12}, {"minutes", 0}, {"seconds", 0}}}, {"clock_paused", false}, {"rain", {{"type", "NoRain"}, {"intensity", 0.0}, {"puddles", 0.0}}}};
                               }
                               if (has("ui"))
                               {
                                   out["ui"] = {{"menu_open", !s.menu.empty()}, {"photo_mode", photo},
                                                {"interaction", {{"available", true},
                                                                 {"hub", {{"id", 7}, {"active", !photo}, {"title", "Door"}, {"choices", json::array({{{"index", 0}, {"label", "Open"}, {"input_action", "Choice1"}, {"hold", false}}})}}},
                                                                 {"dialog", json::array()}, {"active_hub", -1}, {"selected", 0}}}};
                               }
                               if (!request.points.empty())
                               {
                                   json points = json::array();
                                   for (const auto& point : request.points)
                                   {
                                       points.push_back({{"world", point}, {"screen", Project(cam, point)}});
                                   }
                                   out["points"] = points;
                               }
                               return out;
                           }});

    // The handover.
    m_dispatcher.Register({"bridge.handover", Access::Control, RunOn::BridgeThread, "Hands over or resumes (simulated).", [self](const MethodContext& aContext) {
                               params::RequireOnly(aContext.params, {"on", "note"});
                               const auto on = params::CheckBoolean(aContext.params, "on");
                               if (!on)
                               {
                                   params::CheckFail("'on' is required: true hands the session over to the player, false resumes it");
                               }
                               const auto note = params::CheckText(aContext.params, "note", 200).value_or("");
                               const bool was = self->m_dispatcher.HandedOver();
                               if (*on)
                               {
                                   self->m_behaviours.StopAll("handed_over");
                               }
                               self->m_dispatcher.SetHandover(*on, note);
                               return json{{"simulated", true}, {"handed_over", *on}, {"was", was}, {"behaviours_stopped", *on},
                                           {"undo", {{"method", "bridge.handover"}, {"params", {{"on", !*on}}}}}};
                           }});

    // Behaviours.
    m_ops.camera = [self, camera, cameraJson] {
        std::scoped_lock _(self->m_state->mutex);
        return cameraJson(camera(), self->m_hooks.phase());
    };
    m_ops.showroom = [self] { return self->m_hooks.showroom(); };
    m_ops.place = [self](const std::string& aKind, int32_t aIndex, const Vec3& aPosition, double aYaw) {
        self->m_hooks.moveShowroom(aKind, aIndex, aPosition[0], aPosition[1], aPosition[2], aYaw);
    };
    m_ops.player = [self, busyNow] {
        std::scoped_lock _(self->m_state->mutex);
        return json{{"position", Arr(self->m_state->position)}, {"yaw", self->m_state->yaw}, {"busy", busyNow()}};
    };
    m_ops.teleportPlayer = [self](const Vec3& aPosition, double aYaw) {
        std::scoped_lock _(self->m_state->mutex);
        self->m_state->position = aPosition;
        self->m_state->yaw = aYaw;
    };
    const auto lookAt = [self, camera](const Vec3& aPoint, double aDuration) {
        auto& s = *self->m_state;
        const auto cam = camera();
        const auto d = Sub(aPoint, cam.position);
        s.looking = true;
        s.lookFromYaw = s.yaw;
        s.lookFromPitch = s.pitch;
        s.lookToYaw = std::atan2(-d[0], d[1]) / kDeg;
        s.lookToPitch = std::clamp(std::asin(d[2] / Len(d)) / kDeg, -85.0, 85.0);
        s.lookT = 0.0;
        s.lookDuration = std::max(aDuration, 0.02);
    };
    m_ops.lookAt = [self, lookAt, requireGameplay](const Vec3& aPoint, double aDuration) {
        requireGameplay("looking");
        std::scoped_lock _(self->m_state->mutex);
        lookAt(aPoint, aDuration);
    };
    m_ops.breakLookAt = [self] {
        std::scoped_lock _(self->m_state->mutex);
        self->m_state->looking = false;
    };
    m_ops.path = [](const Vec3& aFrom, const Vec3& aTo) {
        // Walkable ground: z = 10 inside x 0-300, y 0-400.
        const auto walkable = [](const Vec3& p) { return p[0] >= 0 && p[0] <= 300 && p[1] >= 0 && p[1] <= 400 && std::abs(p[2] - 10.0) < 1.0; };
        if (!walkable(aFrom) || !walkable(aTo))
        {
            throw MethodError("no_path", "simulated: no walkable path there");
        }
        const Vec3 mid{(aFrom[0] + aTo[0]) / 2.0 + 0.5, (aFrom[1] + aTo[1]) / 2.0, 10.0};
        return std::vector<Vec3>{aFrom, mid, {aTo[0], aTo[1], 10.0}};
    };
    m_ops.holdMovement = [self](bool aOn) {
        std::scoped_lock _(self->m_state->mutex);
        auto& e = self->m_state->effects;
        const std::string id = "GameplayRestriction.NoMovement";
        if (aOn && std::find(e.begin(), e.end(), id) == e.end())
        {
            e.push_back(id);
        }
        if (!aOn)
        {
            e.erase(std::remove(e.begin(), e.end(), id), e.end());
        }
    };
    m_ops.subject = [self] { return self->m_hooks.subject(0.045, 0.08, 0.0); };
    m_ops.setAttribute = [self](int32_t aKey, float aValue) { return self->m_hooks.setAttribute(aKey, aValue); };

    for (const auto& [kind, access] : std::vector<std::pair<std::string, Access>>{
             {"turntable", Access::WriteShowroom}, {"look", Access::WritePlayer}, {"glide_path", Access::WritePlayer}, {"keep_framed", Access::WritePhoto}})
    {
        std::string method = "behave." + kind;
        if (kind == "glide_path")
        {
            method = "behave.glide.path";
        }
        else if (kind == "keep_framed")
        {
            method = "behave.keep.framed";
        }
        m_dispatcher.Register({method, access, RunOn::BridgeThread, "Starts a behaviour (simulated world).", [self, kind = kind](const MethodContext& aContext) {
                                   self->m_hooks.markWrite();
                                   auto out = self->m_behaviours.Start(behave::StartParams(kind, aContext.params),
                                                                       [self](Access aAccess) { self->m_dispatcher.RequireWriteClass(aAccess); });
                                   out["simulated"] = true;
                                   return out;
                               }});
    }
    // Written out for the catalogue's access check (tools/test/catalogue.test.ts reads these registrations):
    // {"behave.turntable", Access::WriteShowroom} {"behave.look", Access::WritePlayer} {"behave.glide.path", Access::WritePlayer}
    // {"behave.keep.framed", Access::WritePhoto}
    m_dispatcher.Register({"behave.stop", Access::Control, RunOn::BridgeThread, "Stops behaviours.",
                           [self](const MethodContext& aContext) { return self->m_behaviours.Stop(aContext.params); }});
    m_dispatcher.Register({"behave.list", Access::Read, RunOn::BridgeThread, "The running behaviours.", [self](const MethodContext& aContext) {
                               params::RequireOnly(aContext.params, {});
                               return self->m_behaviours.List();
                           }});

    // Player control.
    m_dispatcher.Register({"player.state", Access::Read, RunOn::GameThread, "V (simulated).", [self, camera, cameraJson, busyNow](const MethodContext& aContext) {
                               params::RequireOnly(aContext.params, {});
                               const auto phase = self->m_hooks.phase();
                               if (phase != "gameplay" && phase != "photo_mode" && phase != "menu")
                               {
                                   throw MethodError("not_in_gameplay", "simulated: V isn't in the world");
                               }
                               std::scoped_lock _(self->m_state->mutex);
                               auto& s = *self->m_state;
                               return json{{"simulated", true}, {"phase", phase}, {"position", Arr(s.position)}, {"yaw", s.yaw},
                                           {"camera", cameraJson(camera(), phase)}, {"psm", {{"locomotion", s.crouched ? 1 : 0}, {"locomotion_name", s.crouched ? "Crouch" : "Default"}, {"high_level", 2}, {"high_level_name", "SceneTier2"}}},
                                           {"in_combat", false}, {"in_vehicle", false}, {"in_scene", false}, {"in_dialogue", false}, {"busy", busyNow()},
                                           {"look_at", {{"id", "sim:door"}, {"class", "Door"}, {"name", "Door"}, {"distance", 1.2}, {"interaction_target", true}}},
                                           {"bridge_effects", s.effects}, {"behaviours", self->m_behaviours.List()["behaviours"]}, {"perspective", "fpp"},
                                           {"weapon_drawn", s.weaponDrawn}, {"menu", s.menu}};
                           }});
    const auto marked = [self](const char* aName, Access aAccess, RunOn aRunOn, const char* aSummary, std::function<json(const MethodContext&)> aFn) {
        return MethodSpec{aName, aAccess, aRunOn, aSummary, [self, aFn](const MethodContext& aContext) {
                              self->m_hooks.markWrite();
                              auto out = aFn(aContext);
                              out["simulated"] = true;
                              return out;
                          }};
    };
    static player::TeleportPacer pacer;
    m_dispatcher.Register(marked("player.teleport", Access::WritePlayer, RunOn::BridgeThread, "Teleports V (simulated).", [self, busyNow](const MethodContext& aContext) {
        const auto request = player::ParseTeleport(aContext.params);
        pacer.Take();
        return RunGameTask(
            self->m_queue, std::chrono::milliseconds(1000),
            [self, request, busyNow] {
                std::scoped_lock _(self->m_state->mutex);
                auto& s = *self->m_state;
                const auto busy = busyNow();
                if (!busy.empty())
                {
                    throw MethodError(busy, "simulated: V can't be moved now (" + busy + ")");
                }
                const auto before = s.position;
                const double yawBefore = s.yaw;
                auto [to, yaw] = player::Destination(request, before, yawBefore);
                const double distance = Len(Sub(to, before));
                if (distance > player::kMaxTeleportM && !request.farOk)
                {
                    throw MethodError("too_far", "simulated: more than 50 m");
                }
                bool snapped = false;
                if (!request.exact)
                {
                    if (to[0] < 0 || to[0] > 300 || to[1] < 0 || to[1] > 400)
                    {
                        throw MethodError("not_streamed", "simulated: the world there isn't loaded");
                    }
                    if (std::abs(to[2] - 10.0) > 2.0)
                    {
                        throw MethodError("no_ground", "simulated: no walkable ground within 2 m");
                    }
                    to[2] = 10.0;
                    snapped = true;
                }
                self->m_hooks.takeSaveLock();
                s.position = to;
                if (yaw)
                {
                    s.yaw = *yaw;
                }
                return json{{"before", {{"position", Arr(before)}, {"yaw", yawBefore}}}, {"target", Arr(to)}, {"yaw", s.yaw}, {"snapped", snapped}, {"now", Arr(s.position)},
                            {"off_m", 0.0}, {"held", true},
                            {"undo", {{"method", "player.teleport"}, {"params", {{"position", Arr(before)}, {"yaw", yawBefore}, {"ground", "exact"}}}}},
                            {"undo_note", "teleports V back to where she stood, facing the same way (loading the save undoes it too)"}};
            },
            "player.teleport");
    }));
    m_dispatcher.Register(marked("player.look", Access::WritePlayer, RunOn::BridgeThread, "Turns V's view (simulated).", [self, camera, lookAt, requireGameplay](const MethodContext& aContext) {
        const auto request = player::ParseLook(aContext.params);
        json before;
        player::LookTarget target{};
        RunGameTask(
            self->m_queue, std::chrono::milliseconds(1000),
            [&] {
                requireGameplay("looking");
                std::scoped_lock _(self->m_state->mutex);
                auto& s = *self->m_state;
                const auto cam = camera();
                before = {{"yaw", s.yaw}, {"pitch", s.pitch}};
                target = player::LookTargetFor(request, cam.position, s.yaw, s.pitch);
                self->m_hooks.takeSaveLock();
                lookAt(target.point, request.smooth || request.at ? request.duration : 0.05);
                return json();
            },
            "player.look");
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(static_cast<int>(request.duration * 1000.0) + 700);
        json reached;
        for (;;)
        {
            w::WaitTicks(self->m_queue, 3, std::chrono::milliseconds(1000));
            {
                std::scoped_lock _(self->m_state->mutex);
                reached = {{"yaw", self->m_state->yaw}, {"pitch", self->m_state->pitch}};
                if (!self->m_state->looking || std::chrono::steady_clock::now() > deadline)
                {
                    break;
                }
            }
        }
        const double ey = std::remainder(reached.value("yaw", 0.0) - target.yaw, 360.0), ep = reached.value("pitch", 0.0) - target.pitch;
        return json{{"mode", request.smooth ? "smooth" : "instant"}, {"wanted", {{"yaw", target.yaw}, {"pitch", target.pitch}}}, {"reached", reached},
                    {"error_deg", {{"yaw", ey}, {"pitch", ep}}}, {"within_2_deg", std::abs(ey) <= 2.0 && std::abs(ep) <= 2.0},
                    {"undo", {{"method", "player.look"}, {"params", {{"yaw", before["yaw"]}, {"pitch", before["pitch"]}, {"mode", "instant"}}}}}};
    }));
    m_dispatcher.Register(marked("player.look.stop", Access::WritePlayer, RunOn::GameThread, "Ends a look (simulated).", [self](const MethodContext& aContext) {
        params::RequireOnly(aContext.params, {});
        std::scoped_lock _(self->m_state->mutex);
        self->m_state->looking = false;
        return json{{"stopped", true}, {"undo", nullptr}};
    }));
    m_dispatcher.Register({"player.stop", Access::Control, RunOn::BridgeThread, "Stops every motion (simulated).", [self](const MethodContext& aContext) {
                               params::RequireOnly(aContext.params, {});
                               self->m_behaviours.StopAll("player_stop");
                               return RunGameTask(
                                   self->m_queue, std::chrono::milliseconds(1000),
                                   [self] {
                                       std::scoped_lock _(self->m_state->mutex);
                                       auto& s = *self->m_state;
                                       s.looking = false;
                                       json removed = s.effects;
                                       s.effects.clear();
                                       s.crouched = false;
                                       return json{{"simulated", true}, {"removed", removed}};
                                   },
                                   "player.stop");
                           }});
    m_dispatcher.Register({"player.interact.list", Access::Read, RunOn::GameThread, "The HUD's interactions (simulated).", [self](const MethodContext& aContext) {
                               params::RequireOnly(aContext.params, {});
                               const bool photo = self->m_hooks.phase() == "photo_mode";
                               return json{{"simulated", true},
                                           {"interaction", {{"available", true},
                                                            {"hub", {{"id", 7}, {"active", !photo}, {"title", "Door"}, {"choices", json::array({{{"index", 0}, {"label", "Open"}, {"input_action", "Choice1"}, {"hold", false}}})}}},
                                                            {"dialog", json::array()}, {"active_hub", -1}, {"selected", 0}}}};
                           }});
    m_dispatcher.Register({"player.action", Access::WritePlayer, RunOn::GameThread, "A system-driven action (simulated).", [self, busyNow](const MethodContext& aContext) {
                               const auto request = player::ParseAction(aContext.params);
                               self->m_dispatcher.RequireWriteClass(request.access);
                               self->m_hooks.markWrite();
                               std::scoped_lock _(self->m_state->mutex);
                               auto& s = *self->m_state;
                               const auto busy = busyNow();
                               if (!busy.empty() && request.name != "menu.close")
                               {
                                   throw MethodError(busy, "simulated: not now (" + busy + ")");
                               }
                               self->m_hooks.takeSaveLock();
                               const std::string crouch = "GameplayRestriction.ForceCrouch";
                               if (request.name == "crouch")
                               {
                                   s.crouched = true;
                                   if (std::find(s.effects.begin(), s.effects.end(), crouch) == s.effects.end())
                                   {
                                       s.effects.push_back(crouch);
                                   }
                               }
                               else if (request.name == "stand")
                               {
                                   s.crouched = false;
                                   s.effects.erase(std::remove(s.effects.begin(), s.effects.end(), crouch), s.effects.end());
                               }
                               else if (request.name == "weapon.draw" || request.name == "weapon.slot")
                               {
                                   s.weaponDrawn = true;
                               }
                               else if (request.name == "weapon.holster")
                               {
                                   s.weaponDrawn = false;
                               }
                               else if (request.name == "menu.close")
                               {
                                   s.menu.clear();
                               }
                               else
                               {
                                   s.menu = request.name.substr(5);
                               }
                               return json{{"simulated", true}, {"action", request.name}, {"undo", request.undo}, {"undo_note", request.undoNote}};
                           }});
    m_dispatcher.Register({"input.probe", Access::Read, RunOn::GameThread, "The test input system (simulated).", [](const MethodContext& aContext) {
                               params::RequireOnly(aContext.params, {});
                               json fns = json::array();
                               for (const char* name : {"FakeInputPressAction", "FakeInputReleaseAction", "TakeOverInput", "ReleaseAllInput"})
                               {
                                   fns.push_back({{"name", name}, {"params", 0}, {"native", true}, {"static", false}, {"has_return", false}, {"param_types", json::array()},
                                                  {"reg_index", 15000}, {"handler", {{"module", "Cyberpunk2077.exe"}, {"offset", "0x1234"}, {"in_executable", true}}}});
                               }
                               return json{{"simulated", true},
                                           {"note", "read-only: nothing here calls any of these functions"},
                                           {"functional_tests", {{"class", "FunctionalTestsGameSystem"}, {"present", true}, {"functions_total", 60}, {"functions", fns}}},
                                           {"player_functional_tests", {{"class", "PlayerFunctionalTests"}, {"present", true}, {"functions", json::array()}}},
                                           {"navigation_functional_tests", {{"class", "NavigationFunctionalTests"}, {"present", true}, {"functions", json::array()}}},
                                           {"ui_functional_tests", {{"class", "UIFunctionalTests"}, {"present", true}, {"functions", json::array()}}},
                                           {"handler_table", "resolved"},
                                           {"system_instance", false},
                                           {"game_in_front", false},
                                           {"xinput_imports", json::array({{{"dll", "XINPUT9_1_0.dll"}, {"function", "XInputGetState"}, {"resolves_to", "XINPUT9_1_0.dll"}}})}};
                           }});
    // photo.camera.preset (research): the simulated TweakDB holds each preset's flats; selecting a preset puts the simulated
    // camera at its distance (the answer's camera readings), as the game might if photo mode reads the record on selection.
    m_dispatcher.Register(marked("photo.camera.preset", Access::WritePhoto, RunOn::BridgeThread, "Rewrites a camera preset (simulated).", [self](const MethodContext& aContext) {
        const auto request = scene::ParsePreset(aContext.params);
        if (self->m_hooks.phase() != "photo_mode")
        {
            throw MethodError("not_in_photo_mode", "simulated: photo mode is not open");
        }
        std::scoped_lock _(self->m_state->mutex);
        auto& s = *self->m_state;
        auto& flats = s.presets[request.preset];
        if (flats.empty())
        {
            for (const auto& [name, range] : scene::PresetFlats())
            {
                flats[name] = name == "dist" ? -1.8 : name == "fov" ? 25.0 : 0.0;
            }
        }
        json before = json::object();
        for (const auto& [name, value] : flats)
        {
            before[name] = value;
        }
        json written = json::object();
        for (const auto& [name, value] : request.values)
        {
            flats[name] = value;
            written[name] = value;
        }
        const auto cameraOf = [&](int32_t aPreset) {
            const double dist = aPreset > 0 ? -s.presets[aPreset]["dist"] : 1.0;
            return json{{"position", {{"x", 100.0}, {"y", 200.5 - dist}, {"z", 11.7}}}, {"forward", {{"x", 0.0}, {"y", 1.0}, {"z", 0.0}}}, {"fov", 30.0}};
        };
        const auto cameraBefore = cameraOf(s.selectedPreset);
        const int32_t earlier = s.selectedPreset;
        const int32_t choose = request.selectAfter >= 0 ? request.selectAfter : request.select ? request.preset : -1;
        if (choose >= 0)
        {
            s.selectedPreset = choose;
        }
        const auto cameraAfter = cameraOf(s.selectedPreset);
        json undoParams{{"preset", request.preset}, {"values", before}, {"select", false}};
        if (choose >= 0)
        {
            undoParams["camera_preset"] = earlier;
        }
        self->m_hooks.takeSaveLock();
        const double moved = std::abs(cameraAfter["position"]["y"].get<double>() - cameraBefore["position"]["y"].get<double>());
        return json{{"preset", request.preset}, {"before", before}, {"written", written}, {"camera_before", cameraBefore}, {"camera_after", cameraAfter},
                    {"camera_moved_m", moved}, {"undo", {{"method", "photo.camera.preset"}, {"params", undoParams}}}};
    }));
    // selftest.player: V's simulated state (busy with a refusal code, a position).
    m_dispatcher.Register({"selftest.player", Access::Read, RunOn::BridgeThread, "Sets V's simulated state (self-test only).", [self](const MethodContext& aContext) {
                               std::scoped_lock _(self->m_state->mutex);
                               auto& s = *self->m_state;
                               s.busy = aContext.params.value("busy", std::string());
                               if (aContext.params.contains("position"))
                               {
                                   s.position = VecOf(aContext.params["position"]);
                               }
                               if (aContext.params.contains("yaw"))
                               {
                                   s.yaw = aContext.params["yaw"].get<double>();
                               }
                               return json{{"busy", s.busy}, {"position", Arr(s.position)}, {"yaw", s.yaw}};
                           }});
    (void)st;
}

void Sim060::Tick(double aDt)
{
    {
        std::scoped_lock _(m_state->mutex);
        auto& s = *m_state;
        if (s.looking)
        {
            s.lookT += aDt;
            const double k = std::min(s.lookT / s.lookDuration, 1.0);
            s.yaw = s.lookFromYaw + std::remainder(s.lookToYaw - s.lookFromYaw, 360.0) * k;
            s.pitch = s.lookFromPitch + (s.lookToPitch - s.lookFromPitch) * k;
            if (k >= 1.0)
            {
                s.looking = false;
            }
        }
    }
    if (m_behaviours.Active())
    {
        if (m_dispatcher.IsKilled())
        {
            m_behaviours.StopAll("kill_switch");
        }
        else if (m_dispatcher.WritesPaused())
        {
            m_behaviours.StopAll("writes_paused");
        }
        else if (m_dispatcher.HandedOver())
        {
            m_behaviours.StopAll("handed_over");
        }
        m_behaviours.Tick(aDt, m_ops, m_hooks.scriptsReady());
    }
}

void Sim060::OnDetach()
{
    m_behaviours.DropAll("session_detached");
    std::scoped_lock _(m_state->mutex);
    m_state->effects.clear();
    m_state->crouched = false;
    m_state->looking = false;
}

void Sim060::RestoreAfterKill(json& aOut)
{
    // As the plugin, whose next Running tick runs every behaviour's stop step after the kill switch (the self-test host
    // stops pumping once its listener has closed, so the step runs here).
    m_behaviours.StopAll("kill_switch");
    m_behaviours.Tick(0.0, m_ops, m_hooks.scriptsReady());
    std::scoped_lock _(m_state->mutex);
    if (!m_state->effects.empty())
    {
        aOut["player_stopped"] = {{"removed", m_state->effects}};
        m_state->effects.clear();
        m_state->crouched = false;
    }
    m_state->looking = false;
}
} // namespace xfb::selftest
