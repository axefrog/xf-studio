#include "core/Behaviours.hpp"

#include <algorithm>
#include <cmath>

#include "core/Events.hpp"
#include "core/Log.hpp"
#include "core/Params.hpp"

namespace xfb::behave
{
namespace
{
constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;

double Wrap180(double aDeg)
{
    double v = std::fmod(aDeg + 180.0, 360.0);
    if (v < 0)
    {
        v += 360.0;
    }
    return v - 180.0;
}

double Round4(double aValue)
{
    return std::round(aValue * 1e4) / 1e4;
}

json VecJson(const Vec3& aV)
{
    return json::array({Round4(aV[0]), Round4(aV[1]), Round4(aV[2])});
}

Vec3 VecOf(const json& aValue)
{
    if (aValue.is_array() && aValue.size() >= 3)
    {
        return {aValue[0].get<double>(), aValue[1].get<double>(), aValue[2].get<double>()};
    }
    if (aValue.is_object())
    {
        return {aValue.value("x", 0.0), aValue.value("y", 0.0), aValue.value("z", 0.0)};
    }
    throw MethodError("unavailable", "the game answered a point the behaviour couldn't read");
}

double Dot(const Vec3& a, const Vec3& b)
{
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

Vec3 Sub(const Vec3& a, const Vec3& b)
{
    return {a[0] - b[0], a[1] - b[1], a[2] - b[2]};
}

double Length(const Vec3& a)
{
    return std::sqrt(Dot(a, a));
}

Vec3 Normalise(const Vec3& a)
{
    const double l = Length(a);
    return l > 1e-9 ? Vec3{a[0] / l, a[1] / l, a[2] / l} : Vec3{0, 1, 0};
}

double AngleDeg(const Vec3& a, const Vec3& b)
{
    const double c = std::clamp(Dot(Normalise(a), Normalise(b)), -1.0, 1.0);
    return std::acos(c) / kDeg;
}

// photo.subject's projection into frame units (window heights from the centre, x right, y down), as tools/api/framing.ts
// screenSpace does: which space ProjectPoint answers in follows from the centre's projection.
struct Frame
{
    double x = 0, y = 0;
};
std::pair<double, double> Perspective(const json& aPoint)
{
    const double x = aPoint.value("x", 0.0), y = aPoint.value("y", 0.0);
    if (aPoint.contains("w") && aPoint["w"].is_number())
    {
        const double w = aPoint["w"].get<double>();
        if (std::isfinite(w) && std::abs(w) > 1e-6 && std::abs(w - 1.0) > 1e-4)
        {
            return {x / w, y / w};
        }
    }
    return {x, y};
}
Frame SubjectFrame(const json& aReading)
{
    const auto& screen = aReading.at("screen");
    const auto [cx, cy] = Perspective(screen.at("center"));
    const auto [tx, ty] = Perspective(screen.at("target"));
    const auto [ux, uy] = Perspective(screen.at("up"));
    const auto [rx, ry] = Perspective(screen.at("right"));
    (void)ux;
    (void)ry;
    double aspect = 16.0 / 9.0;
    if (aReading.contains("camera") && aReading["camera"].value("aspect", 0.0) > 0)
    {
        aspect = aReading["camera"].value("aspect", 16.0 / 9.0);
    }
    const double sy = uy - ty > 0 ? -1.0 : 1.0;
    const double sx = rx - tx > 0 ? 1.0 : -1.0;
    if (std::abs(cx) < 0.2 && std::abs(cy) < 0.2)
    {
        return {sx * (tx - cx) * aspect / 2.0, sy * (ty - cy) / 2.0};
    }
    if (std::abs(cx - 0.5) < 0.2 && std::abs(cy - 0.5) < 0.2)
    {
        return {sx * (tx - cx) * aspect, sy * (ty - cy)};
    }
    const double height = 2.0 * std::abs(cy) > 0 ? 2.0 * std::abs(cy) : 1.0;
    return {sx * (tx - cx) / height, sy * (ty - cy) / height};
}

double PoseValue(const json& aReading, const char* aName, double aDefault)
{
    if (aReading.contains("pose") && aReading["pose"].contains(aName) && aReading["pose"][aName].is_object())
    {
        return aReading["pose"][aName].value("value", aDefault);
    }
    return aDefault;
}
} // namespace

std::pair<Vec3, double> AlongPath(const std::vector<Vec3>& aPath, double aS, double& aLength)
{
    aLength = 0.0;
    for (size_t i = 1; i < aPath.size(); ++i)
    {
        aLength += Length(Sub(aPath[i], aPath[i - 1]));
    }
    if (aPath.empty())
    {
        return {Vec3{0, 0, 0}, 0.0};
    }
    if (aPath.size() == 1)
    {
        return {aPath.front(), 0.0};
    }
    double s = std::clamp(aS, 0.0, aLength);
    for (size_t i = 1; i < aPath.size(); ++i)
    {
        const auto seg = Sub(aPath[i], aPath[i - 1]);
        const double l = Length(seg);
        if (l < 1e-9)
        {
            continue;
        }
        if (s <= l || i + 1 == aPath.size())
        {
            const double k = std::min(s / l, 1.0);
            return {Vec3{aPath[i - 1][0] + seg[0] * k, aPath[i - 1][1] + seg[1] * k, aPath[i - 1][2] + seg[2] * k}, YawFacing(seg[0], seg[1])};
        }
        s -= l;
    }
    return {aPath.back(), 0.0};
}

double YawFacing(double aDx, double aDy)
{
    return std::atan2(-aDx, aDy) / kDeg;
}

Vec3 ToWorld(const Vec3& aPosition, double aYaw, const Vec3& aLocal)
{
    const double c = std::cos(aYaw * kDeg), s = std::sin(aYaw * kDeg);
    return {aPosition[0] + c * aLocal[0] - s * aLocal[1], aPosition[1] + s * aLocal[0] + c * aLocal[1], aPosition[2] + aLocal[2]};
}

Vec3 OnCameraRay(const json& aCamera, double aDistance, double aX, double aY)
{
    const auto p = VecOf(aCamera.at("position"));
    const auto f = Normalise(VecOf(aCamera.at("forward")));
    const auto r = Normalise(VecOf(aCamera.at("right")));
    const auto u = Normalise(VecOf(aCamera.at("up")));
    const double fov = aCamera.value("fov", 60.0);
    const double scale = 1.0 / (2.0 * std::tan(fov * kDeg / 2.0));
    const Vec3 d = Normalise({f[0] + r[0] * aX / scale - u[0] * aY / scale, f[1] + r[1] * aX / scale - u[1] * aY / scale,
                              f[2] + r[2] * aX / scale - u[2] * aY / scale});
    return {p[0] + d[0] * aDistance, p[1] + d[1] * aDistance, p[2] + d[2] * aDistance};
}

struct Behaviour
{
    enum class State
    {
        Starting,
        Running,
        Stopping,
        Done
    };
    uint64_t id = 0;
    std::string kind;
    std::string target;
    Access access = Access::Write;
    json params;
    double maxS = 60.0;
    int everyTicks = 1;
    State state = State::Starting;
    std::string stopReason;
    std::string stopLevel = "done";
    json stopData;
    double t = 0.0;
    uint64_t ticks = 0;
    double lastProgress = -1.0;
    json summary = json::object();

    // turntable
    struct Held
    {
        std::string kind;
        int32_t index;
        Vec3 position;
        double yaw;
    };
    std::vector<Held> held;
    double rate = 30.0;
    double revolutions = 0.0;
    bool giveBack = true;
    // look
    Vec3 point{};
    double duration = 1.0;
    double tolerance = 2.0;
    double firstAngle = -1.0;
    double lastAngle = -1.0;
    // glide_path
    std::vector<Vec3> path;
    double pathLength = 0.0;
    double s = 0.0;
    double speed = 1.4;
    Vec3 startPos{};
    double startYaw = 0.0;
    bool holding = false;
    // keep_framed
    int32_t piece = -1;
    Vec3 pieceEyes{0.0, 0.0497, 1.691};
    Vec3 eyes{};
    double distance = 0.0;
    double atX = 0.0, atY = 0.0;
    double tol = 0.02;
    uint64_t moves = 0;
    // keep_framed v: V's placement (left/right, up/down) steered by a measured 2x2 response, refined as it goes.
    int vPhase = 0; // 0 read, 1 probe lr, 2 probe ud, 3 track
    int wait = 0;
    double lr0 = 0, ud0 = 0, lr = 0, ud = 0;
    double base[2] = {0, 0};
    double j[2][2] = {{0, 0}, {0, 0}};
    double lastErr[2] = {0, 0};
    double lastStep[2] = {0, 0};
    bool stepPending = false;
    double maxStep = 0.1;
};

json StartParams(const std::string& aKind, const json& aInput)
{
    json params = json::object();
    json out{{"kind", aKind}};
    if (aInput.is_object())
    {
        for (const auto& [key, value] : aInput.items())
        {
            if (key == "max_s" || key == "every_ticks")
            {
                out[key] = value;
            }
            else
            {
                params[key] = value;
            }
        }
    }
    out["params"] = params;
    return out;
}

Access Runner::ClassOf(const std::string& aKind, const json& aParams)
{
    if (aKind == "turntable")
    {
        return Access::WriteShowroom;
    }
    if (aKind == "look" || aKind == "glide_path")
    {
        return Access::WritePlayer;
    }
    if (aKind == "keep_framed")
    {
        (void)aParams;
        return Access::WritePhoto;
    }
    return Access::Write;
}

void Runner::SetEvents(EventLog* aEvents)
{
    std::scoped_lock _(m_mutex);
    m_events = aEvents;
}

void Runner::Emit(Behaviour& aBehaviour, const std::string& aLevel, const std::string& aText, json aData)
{
    if (!m_events)
    {
        return;
    }
    json data{{"id", aBehaviour.id}, {"kind", aBehaviour.kind}, {"t_s", Round4(aBehaviour.t)}};
    if (aData.is_object())
    {
        data.update(aData);
    }
    m_events->Push("behaviour", aLevel, "behaviour", aBehaviour.kind + " #" + std::to_string(aBehaviour.id) + ": " + aText, data);
}

json Runner::Start(const json& aParams, const std::function<void(Access)>& aRequireClass)
{
    params::RequireOnly(aParams, {"kind", "params", "max_s", "every_ticks"});
    const auto kind = params::CheckText(aParams, "kind", 32);
    if (!kind || (*kind != "turntable" && *kind != "look" && *kind != "glide_path" && *kind != "keep_framed"))
    {
        params::CheckFail("'kind' must be turntable, look, glide_path or keep_framed");
    }
    const json p = aParams.contains("params") && aParams["params"].is_object() ? aParams["params"] : json::object();
    if (aParams.contains("params") && !aParams["params"].is_object() && !aParams["params"].is_null())
    {
        params::CheckFail("'params' must be an object");
    }
    auto b = std::make_shared<Behaviour>();
    b->kind = *kind;
    b->params = p;
    b->maxS = params::CheckNumber(aParams, "max_s", 0.1, kMaxSeconds).value_or(60.0);
    b->everyTicks = static_cast<int>(params::CheckInteger(aParams, "every_ticks", 1, 60).value_or(b->kind == "turntable" ? 2 : b->kind == "keep_framed" ? 3 : 1));
    b->access = ClassOf(b->kind, p);

    if (b->kind == "turntable")
    {
        params::RequireOnly(p, {"target", "pieces", "deg_per_s", "revolutions", "return"});
        const auto target = params::CheckText(p, "target", 8).value_or("pieces");
        if (target != "pieces" && target != "rigs" && target != "both")
        {
            params::CheckFail("'params.target' must be pieces, rigs or both");
        }
        b->rate = params::CheckNumber(p, "deg_per_s", -360.0, 360.0).value_or(30.0);
        if (std::abs(b->rate) < 0.1)
        {
            params::CheckFail("'params.deg_per_s' must be at least 0.1 degrees a second either way");
        }
        b->revolutions = params::CheckNumber(p, "revolutions", 0.01, 100.0).value_or(0.0);
        b->giveBack = params::CheckBoolean(p, "return").value_or(true);
        if (p.contains("pieces") && !p["pieces"].is_null())
        {
            if (!p["pieces"].is_array() || p["pieces"].size() > 24)
            {
                params::CheckFail("'params.pieces' must be a list of at most 24 head indices");
            }
            for (const auto& index : p["pieces"])
            {
                if (!index.is_number_integer() || index.get<int64_t>() < 0 || index.get<int64_t>() > 23)
                {
                    params::CheckFail("each of 'params.pieces' must be a head index 0-23");
                }
            }
        }
        b->target = "showroom";
        b->summary = {{"target", target}, {"deg_per_s", b->rate}};
    }
    else if (b->kind == "look")
    {
        params::RequireOnly(p, {"at", "yaw", "pitch", "turn", "duration_s", "tolerance_deg"});
        const bool at = p.contains("at") && !p["at"].is_null();
        const bool angles = p.contains("yaw") || p.contains("pitch");
        const bool turn = p.contains("turn") && !p["turn"].is_null();
        if (static_cast<int>(at) + static_cast<int>(angles) + static_cast<int>(turn) != 1)
        {
            params::CheckFail("give one of at [x, y, z], yaw and pitch (absolute degrees), or turn {yaw, pitch} (relative)");
        }
        if (at)
        {
            params::CheckPoint(p, "at");
        }
        params::CheckNumber(p, "yaw", -360.0, 360.0);
        params::CheckNumber(p, "pitch", -85.0, 85.0);
        if (turn)
        {
            if (!p["turn"].is_object())
            {
                params::CheckFail("'params.turn' must be {yaw, pitch} in degrees");
            }
            params::RequireOnly(p["turn"], {"yaw", "pitch"});
            params::CheckNumber(p["turn"], "yaw", -360.0, 360.0);
            params::CheckNumber(p["turn"], "pitch", -170.0, 170.0);
        }
        b->duration = params::CheckNumber(p, "duration_s", 0.05, 5.0).value_or(1.0);
        b->tolerance = params::CheckNumber(p, "tolerance_deg", 0.2, 10.0).value_or(2.0);
        b->target = "player_camera";
        b->maxS = std::min(b->maxS, b->duration + 5.0);
    }
    else if (b->kind == "glide_path")
    {
        params::RequireOnly(p, {"to", "offset", "speed_m_s"});
        const bool to = p.contains("to") && !p["to"].is_null();
        const bool offset = p.contains("offset") && !p["offset"].is_null();
        if (to == offset)
        {
            params::CheckFail("give to [x, y, z] (a world point) or offset {forward, right} (metres from V)");
        }
        if (to)
        {
            params::CheckPoint(p, "to");
        }
        if (offset)
        {
            if (!p["offset"].is_object())
            {
                params::CheckFail("'params.offset' must be {forward, right} in metres");
            }
            params::RequireOnly(p["offset"], {"forward", "right"});
            params::CheckNumber(p["offset"], "forward", -50.0, 50.0);
            params::CheckNumber(p["offset"], "right", -50.0, 50.0);
        }
        b->speed = params::CheckNumber(p, "speed_m_s", 0.2, 6.0).value_or(1.4);
        b->target = "player";
    }
    else
    {
        params::RequireOnly(p, {"subject", "piece", "at", "distance_m", "tolerance", "piece_eyes", "max_step"});
        const auto subject = params::CheckText(p, "subject", 8).value_or("piece");
        if (subject != "piece" && subject != "v")
        {
            params::CheckFail("'params.subject' must be piece (a showroom head) or v (V in photo mode)");
        }
        if (p.contains("at") && !p["at"].is_null())
        {
            if (!p["at"].is_object())
            {
                params::CheckFail("'params.at' must be {x, y}: where in the frame, in window heights from the centre (y down)");
            }
            params::RequireOnly(p["at"], {"x", "y"});
            b->atX = params::CheckNumber(p["at"], "x", -1.2, 1.2).value_or(0.0);
            b->atY = params::CheckNumber(p["at"], "y", -0.5, 0.5).value_or(0.0);
        }
        b->tol = params::CheckNumber(p, "tolerance", 0.002, 0.2).value_or(0.02);
        if (subject == "piece")
        {
            const auto piece = params::CheckInteger(p, "piece", 0, 23);
            if (!piece)
            {
                params::CheckFail("'params.piece' is required with subject piece: the showroom head's index");
            }
            b->piece = static_cast<int32_t>(*piece);
            b->distance = params::CheckNumber(p, "distance_m", 0.3, 20.0).value_or(0.0);
            if (const auto eyes = params::CheckPoint(p, "piece_eyes", 3.0))
            {
                b->pieceEyes = *eyes;
            }
            b->target = "piece:" + std::to_string(b->piece);
        }
        else
        {
            b->maxStep = params::CheckNumber(p, "max_step", 0.01, 0.5).value_or(0.1);
            b->target = "v";
        }
        b->summary = {{"subject", subject}, {"at", {{"x", b->atX}, {"y", b->atY}}}};
    }
    aRequireClass(b->access);
    if (b->kind == "keep_framed" && b->target != "v")
    {
        aRequireClass(Access::WriteShowroom); // it moves a showroom head
    }

    std::scoped_lock _(m_mutex);
    size_t running = 0;
    for (auto& other : m_behaviours)
    {
        if (other->state == Behaviour::State::Done)
        {
            continue;
        }
        if (other->target == b->target && other->state != Behaviour::State::Stopping)
        {
            other->state = Behaviour::State::Stopping;
            other->stopReason = "replaced";
            other->stopLevel = "info";
            continue;
        }
        if (other->state != Behaviour::State::Stopping)
        {
            ++running;
        }
    }
    if (running >= kMaxBehaviours)
    {
        throw MethodError("behaviour_limit", "at most " + std::to_string(kMaxBehaviours) + " behaviours run at once; stop one first");
    }
    b->id = m_nextId++;
    m_behaviours.push_back(b);
    const json out{{"id", b->id}, {"kind", b->kind}, {"target", b->target}, {"write_class", std::string(AccessName(b->access))},
                   {"max_s", b->maxS}, {"every_ticks", b->everyTicks}, {"params", b->params},
                   {"undo", {{"method", "behave.stop"}, {"params", {{"id", b->id}}}}},
                   {"undo_note", "behave.stop ends it (the kill switch, a handover or loading a save stop every behaviour); each gives back what it held"}};
    if (m_events)
    {
        m_events->Push("behaviour", "info", "behaviour", b->kind + " #" + std::to_string(b->id) + ": start asked", out);
    }
    return out;
}

json Runner::Stop(const json& aParams)
{
    params::RequireOnly(aParams, {"id", "all", "reason"});
    const auto id = params::CheckInteger(aParams, "id", 1, 1'000'000'000);
    const bool all = params::CheckBoolean(aParams, "all").value_or(false);
    if (!id && !all)
    {
        params::CheckFail("give id (a behaviour's id) or all: true");
    }
    const auto reason = params::CheckText(aParams, "reason", 64).value_or("asked");
    std::scoped_lock _(m_mutex);
    json stopped = json::array();
    for (auto& b : m_behaviours)
    {
        if (b->state == Behaviour::State::Done || b->state == Behaviour::State::Stopping)
        {
            continue;
        }
        if (all || (id && b->id == static_cast<uint64_t>(*id)))
        {
            b->state = Behaviour::State::Stopping;
            b->stopReason = reason;
            b->stopLevel = "info";
            stopped.push_back(b->id);
        }
    }
    if (id && stopped.empty())
    {
        throw MethodError("no_such_behaviour", "no running behaviour has id " + std::to_string(*id));
    }
    return json{{"stopping", stopped}, {"note", "each stops on the next game tick and gives back what it held; behave_list or session_events shows it"}};
}

json Runner::List() const
{
    std::scoped_lock _(m_mutex);
    json out = json::array();
    for (const auto& b : m_behaviours)
    {
        if (b->state == Behaviour::State::Done)
        {
            continue;
        }
        const char* state = b->state == Behaviour::State::Starting ? "starting" : b->state == Behaviour::State::Running ? "running" : "stopping";
        out.push_back({{"id", b->id}, {"kind", b->kind}, {"target", b->target}, {"state", state}, {"t_s", Round4(b->t)},
                       {"max_s", b->maxS}, {"write_class", std::string(AccessName(b->access))}, {"summary", b->summary}});
    }
    return json{{"behaviours", out}, {"limit", kMaxBehaviours}};
}

bool Runner::Active() const
{
    std::scoped_lock _(m_mutex);
    return std::any_of(m_behaviours.begin(), m_behaviours.end(), [](const auto& b) { return b->state != Behaviour::State::Done; });
}

void Runner::DropAll(const std::string& aReason)
{
    std::scoped_lock _(m_mutex);
    for (auto& b : m_behaviours)
    {
        if (b->state != Behaviour::State::Done)
        {
            b->state = Behaviour::State::Done;
            Emit(*b, "warn", "dropped (" + aReason + "); nothing was put back, the game session it held is gone", {{"reason", aReason}});
        }
    }
    m_behaviours.clear();
}

void Runner::StopAll(const std::string& aReason)
{
    std::scoped_lock _(m_mutex);
    for (auto& b : m_behaviours)
    {
        if (b->state == Behaviour::State::Starting || b->state == Behaviour::State::Running)
        {
            b->state = Behaviour::State::Stopping;
            b->stopReason = aReason;
            b->stopLevel = "warn";
        }
    }
}

namespace
{
void Finish(Behaviour& aB, const std::string& aReason, const std::string& aLevel, json aData = nullptr)
{
    aB.state = Behaviour::State::Stopping;
    aB.stopReason = aReason;
    aB.stopLevel = aLevel;
    if (aData.is_object())
    {
        aB.stopData = std::move(aData);
    }
}

// The steps each kind takes. Each may throw MethodError (a refusal from the game): the behaviour then stops with it.
void StepTurntable(Behaviour& aB, const Ops& aOps, double aDt)
{
    if (aB.state == Behaviour::State::Starting)
    {
        const auto state = aOps.showroom();
        const auto target = aB.params.value("target", std::string("pieces"));
        const auto wanted = aB.params.contains("pieces") && aB.params["pieces"].is_array() ? aB.params["pieces"] : json();
        const auto take = [&](const char* aKind, const json& aList) {
            for (const auto& item : aList)
            {
                const auto index = item.value("index", -1);
                if (wanted.is_array() && std::string(aKind) == "pieces" && std::find(wanted.begin(), wanted.end(), json(index)) == wanted.end())
                {
                    continue;
                }
                aB.held.push_back({aKind, index, VecOf(item.at("position")), item.value("yaw", 0.0)});
            }
        };
        if (target != "rigs")
        {
            take("pieces", state.value("pieces", json::array()));
        }
        if (target != "pieces")
        {
            take("lights", state.value("rigs", state.value("lights", json::array())));
        }
        if (aB.held.empty())
        {
            throw MethodError("no_showroom", "the showroom has nothing to turn (showroom_spawn first, or check pieces)");
        }
        aB.state = Behaviour::State::Running;
        aB.summary["turning"] = aB.held.size();
        return;
    }
    aB.t += aDt;
    const double turned = aB.rate * aB.t;
    if (aB.ticks % static_cast<uint64_t>(aB.everyTicks) == 0)
    {
        for (const auto& h : aB.held)
        {
            aOps.place(h.kind, h.index, h.position, Wrap180(h.yaw + turned));
        }
    }
    aB.summary["turned_deg"] = Round4(turned);
    if (aB.revolutions > 0 && std::abs(turned) >= aB.revolutions * 360.0)
    {
        Finish(aB, "done", "done", {{"turned_deg", Round4(turned)}});
    }
}

void StopTurntable(Behaviour& aB, const Ops& aOps)
{
    if (aB.giveBack)
    {
        for (const auto& h : aB.held)
        {
            aOps.place(h.kind, h.index, h.position, h.yaw);
        }
    }
}

void StepLook(Behaviour& aB, const Ops& aOps, double aDt)
{
    const auto camera = aOps.camera();
    const auto pos = VecOf(camera.at("position"));
    const auto forward = Normalise(VecOf(camera.at("forward")));
    if (aB.state == Behaviour::State::Starting)
    {
        const auto& p = aB.params;
        if (p.contains("at") && p["at"].is_array())
        {
            aB.point = VecOf(p["at"]);
        }
        else
        {
            double yaw = std::atan2(-forward[0], forward[1]) / kDeg;
            double pitch = std::asin(std::clamp(forward[2], -1.0, 1.0)) / kDeg;
            if (p.contains("turn"))
            {
                yaw += p["turn"].value("yaw", 0.0);
                pitch = std::clamp(pitch + p["turn"].value("pitch", 0.0), -85.0, 85.0);
            }
            else
            {
                yaw = p.value("yaw", yaw);
                pitch = p.value("pitch", pitch);
            }
            const Vec3 d{-std::sin(yaw * kDeg) * std::cos(pitch * kDeg), std::cos(yaw * kDeg) * std::cos(pitch * kDeg), std::sin(pitch * kDeg)};
            aB.point = {pos[0] + d[0] * 10.0, pos[1] + d[1] * 10.0, pos[2] + d[2] * 10.0};
        }
        aB.firstAngle = AngleDeg(forward, Sub(aB.point, pos));
        aOps.lookAt(aB.point, aB.duration);
        aB.state = Behaviour::State::Running;
        aB.summary = {{"point", VecJson(aB.point)}, {"angle_deg", Round4(aB.firstAngle)}};
        return;
    }
    aB.t += aDt;
    const double angle = AngleDeg(forward, Sub(aB.point, pos));
    aB.lastAngle = angle;
    aB.summary["angle_deg"] = Round4(angle);
    if (angle <= aB.tolerance)
    {
        Finish(aB, "reached", "done", {{"angle_deg", Round4(angle)}, {"forward", VecJson(forward)}});
    }
    else if (aB.t > aB.duration + 2.0)
    {
        Finish(aB, "not_reached", "warn", {{"angle_deg", Round4(angle)}, {"note", "the camera stopped short (the player's own mouse or stick breaks a look, as the game's own look-at does)"}});
    }
}

void StepGlide(Behaviour& aB, const Ops& aOps, double aDt)
{
    if (aB.state == Behaviour::State::Starting)
    {
        const auto player = aOps.player();
        const auto busy = player.value("busy", std::string());
        if (!busy.empty())
        {
            throw MethodError(busy, "V can't be moved now (" + busy + ")");
        }
        aB.startPos = VecOf(player.at("position"));
        aB.startYaw = player.value("yaw", 0.0);
        Vec3 to{};
        if (aB.params.contains("to"))
        {
            to = VecOf(aB.params["to"]);
        }
        else
        {
            const double f = aB.params["offset"].value("forward", 0.0), r = aB.params["offset"].value("right", 0.0);
            const double c = std::cos(aB.startYaw * kDeg), s = std::sin(aB.startYaw * kDeg);
            // Facing (-sin, cos); right (cos, sin).
            to = {aB.startPos[0] - s * f + c * r, aB.startPos[1] + c * f + s * r, aB.startPos[2]};
        }
        aB.path = aOps.path(aB.startPos, to);
        if (aB.path.size() < 2)
        {
            throw MethodError("no_path", "the game found no walkable path there");
        }
        AlongPath(aB.path, 0.0, aB.pathLength);
        if (aB.pathLength > 50.0)
        {
            throw MethodError("too_far", "the walkable path is " + std::to_string(static_cast<int>(aB.pathLength)) + " m; a glide goes at most 50 m");
        }
        aOps.holdMovement(true);
        aB.holding = true;
        aB.state = Behaviour::State::Running;
        aB.summary = {{"path_m", Round4(aB.pathLength)}, {"points", aB.path.size()}, {"speed_m_s", aB.speed}, {"animated", false}};
        return;
    }
    aB.t += aDt;
    aB.s = std::min(aB.pathLength, aB.s + aB.speed * aDt);
    if (aB.ticks % 15 == 0)
    {
        const auto busy = aOps.player().value("busy", std::string());
        if (!busy.empty())
        {
            Finish(aB, busy, "warn", {{"travelled_m", Round4(aB.s)}});
            return;
        }
    }
    if (aB.ticks % static_cast<uint64_t>(aB.everyTicks) == 0 || aB.s >= aB.pathLength)
    {
        double length = 0.0;
        const auto [at, heading] = AlongPath(aB.path, aB.s, length);
        aOps.teleportPlayer(at, heading);
    }
    aB.summary["travelled_m"] = Round4(aB.s);
    if (aB.s >= aB.pathLength - 1e-6)
    {
        Finish(aB, "arrived", "done", {{"travelled_m", Round4(aB.s)}});
    }
}

void StopGlide(Behaviour& aB, const Ops& aOps)
{
    if (aB.holding)
    {
        aB.holding = false;
        aOps.holdMovement(false);
    }
    aB.stopData["undo"] = {{"method", "player.teleport"}, {"params", {{"position", VecJson(aB.startPos)}, {"yaw", Round4(aB.startYaw)}, {"ground", "exact"}}}};
}

void StepKeepPiece(Behaviour& aB, const Ops& aOps, double aDt)
{
    aB.t += aDt;
    if (aB.state == Behaviour::State::Starting)
    {
        const auto state = aOps.showroom();
        bool found = false;
        for (const auto& item : state.value("pieces", json::array()))
        {
            if (item.value("index", -1) == aB.piece)
            {
                aB.eyes = ToWorld(VecOf(item.at("position")), item.value("yaw", 0.0), aB.pieceEyes);
                found = true;
            }
        }
        if (!found)
        {
            throw MethodError("no_such_piece", "the showroom has no head " + std::to_string(aB.piece));
        }
        const auto camera = aOps.camera();
        if (aB.distance <= 0.0)
        {
            aB.distance = Length(Sub(aB.eyes, VecOf(camera.at("position"))));
        }
        aB.state = Behaviour::State::Running;
        aB.summary["distance_m"] = Round4(aB.distance);
        aB.summary["moves"] = 0;
        return;
    }
    if (aB.ticks % static_cast<uint64_t>(aB.everyTicks) != 0)
    {
        return;
    }
    const auto camera = aOps.camera();
    const auto target = OnCameraRay(camera, aB.distance, aB.atX, aB.atY);
    if (Length(Sub(target, aB.eyes)) < 0.01)
    {
        return;
    }
    const auto cam = VecOf(camera.at("position"));
    const double yaw = YawFacing(cam[0] - target[0], cam[1] - target[1]);
    const auto offset = ToWorld({0, 0, 0}, yaw, aB.pieceEyes);
    aOps.place("pieces", aB.piece, {target[0] - offset[0], target[1] - offset[1], target[2] - offset[2]}, yaw);
    aB.eyes = target;
    ++aB.moves;
    aB.summary["moves"] = aB.moves;
    aB.summary["eyes"] = VecJson(target);
}

// keep_framed v: V's photo-mode placement (left/right, key 8; up/down, key 37) steered so V's face sits at the wanted frame
// position. The world takes a placement a frame or two later (session 3), so each change waits a few ticks before the
// reading that judges it. The response is measured with two small probes, then refined after every step (Broyden).
void StepKeepV(Behaviour& aB, const Ops& aOps, double aDt)
{
    aB.t += aDt;
    if (aB.wait > 0)
    {
        --aB.wait;
        return;
    }
    const auto reading = aOps.subject();
    const auto at = SubjectFrame(reading);
    const double ex = at.x - aB.atX, ey = at.y - aB.atY;
    constexpr double probe = 0.02;
    constexpr int settle = 3;
    if (aB.state == Behaviour::State::Starting)
    {
        aB.lr0 = aB.lr = PoseValue(reading, "left_right", 0.0);
        aB.ud0 = aB.ud = PoseValue(reading, "up_down", 0.0);
        aB.base[0] = at.x;
        aB.base[1] = at.y;
        aB.lr = aOps.setAttribute(8, static_cast<float>(aB.lr0 + probe));
        aB.vPhase = 1;
        aB.wait = settle;
        aB.state = Behaviour::State::Running;
        return;
    }
    if (aB.vPhase == 1)
    {
        aB.j[0][0] = (at.x - aB.base[0]) / probe;
        aB.j[1][0] = (at.y - aB.base[1]) / probe;
        aB.lr = aOps.setAttribute(8, static_cast<float>(aB.lr0));
        aB.ud = aOps.setAttribute(37, static_cast<float>(aB.ud0 + probe));
        aB.vPhase = 2;
        aB.wait = settle;
        return;
    }
    if (aB.vPhase == 2)
    {
        aB.j[0][1] = (at.x - aB.base[0]) / probe;
        aB.j[1][1] = (at.y - aB.base[1]) / probe;
        aB.ud = aOps.setAttribute(37, static_cast<float>(aB.ud0));
        aB.vPhase = 3;
        aB.wait = settle;
        aB.summary["response"] = {{"lr", {Round4(aB.j[0][0]), Round4(aB.j[1][0])}}, {"ud", {Round4(aB.j[0][1]), Round4(aB.j[1][1])}}};
        return;
    }
    // Tracking: refine the response with the last step's outcome, then step towards the target.
    if (aB.stepPending)
    {
        const double dex = ex - aB.lastErr[0], dey = ey - aB.lastErr[1];
        const double du0 = aB.lastStep[0], du1 = aB.lastStep[1];
        const double nn = du0 * du0 + du1 * du1;
        if (nn > 1e-10)
        {
            const double rx = dex - (aB.j[0][0] * du0 + aB.j[0][1] * du1);
            const double ry = dey - (aB.j[1][0] * du0 + aB.j[1][1] * du1);
            aB.j[0][0] += rx * du0 / nn;
            aB.j[0][1] += rx * du1 / nn;
            aB.j[1][0] += ry * du0 / nn;
            aB.j[1][1] += ry * du1 / nn;
        }
        aB.stepPending = false;
    }
    aB.summary["error"] = {{"x", Round4(ex)}, {"y", Round4(ey)}};
    if (std::abs(ex) <= aB.tol && std::abs(ey) <= aB.tol)
    {
        aB.wait = aB.everyTicks;
        return;
    }
    const double det = aB.j[0][0] * aB.j[1][1] - aB.j[0][1] * aB.j[1][0];
    if (std::abs(det) < 1e-8)
    {
        Finish(aB, "no_response", "warn", {{"note", "V's placement doesn't move V across the frame from this camera (use photo_frame)"}});
        return;
    }
    double s0 = -(aB.j[1][1] * ex - aB.j[0][1] * ey) / det * 0.8;
    double s1 = -(-aB.j[1][0] * ex + aB.j[0][0] * ey) / det * 0.8;
    const double n = std::hypot(s0, s1);
    if (n > aB.maxStep)
    {
        s0 *= aB.maxStep / n;
        s1 *= aB.maxStep / n;
    }
    const double lrWanted = std::clamp(aB.lr + s0, -5.0, 5.0), udWanted = std::clamp(aB.ud + s1, -5.0, 5.0);
    const double lrBefore = aB.lr, udBefore = aB.ud;
    aB.lr = aOps.setAttribute(8, static_cast<float>(lrWanted));
    aB.ud = aOps.setAttribute(37, static_cast<float>(udWanted));
    aB.lastStep[0] = aB.lr - lrBefore;
    aB.lastStep[1] = aB.ud - udBefore;
    aB.lastErr[0] = ex;
    aB.lastErr[1] = ey;
    aB.stepPending = true;
    ++aB.moves;
    aB.summary["moves"] = aB.moves;
    aB.wait = std::max(settle, aB.everyTicks);
}

void StopKeepV(Behaviour& aB)
{
    aB.stopData["undo"] = {{"method", "photo.camera.set"}, {"params", {{"subject", {{"left_right", Round4(aB.lr0)}, {"up_down", Round4(aB.ud0)}}}}}};
}
} // namespace

void Runner::Tick(double aDt, const Ops& aOps, bool aGateOpen)
{
    std::scoped_lock _(m_mutex);
    if (m_behaviours.empty())
    {
        return;
    }
    const double dt = std::clamp(aDt, 0.0, 0.25); // a hitch doesn't jump a behaviour ahead
    for (auto& ptr : m_behaviours)
    {
        auto& b = *ptr;
        if (b.state == Behaviour::State::Done || !aGateOpen)
        {
            continue;
        }
        const bool starting = b.state == Behaviour::State::Starting;
        try
        {
            if (b.state == Behaviour::State::Starting || b.state == Behaviour::State::Running)
            {
                if (b.kind == "turntable")
                {
                    StepTurntable(b, aOps, dt);
                }
                else if (b.kind == "look")
                {
                    StepLook(b, aOps, dt);
                }
                else if (b.kind == "glide_path")
                {
                    StepGlide(b, aOps, dt);
                }
                else if (b.target == "v")
                {
                    StepKeepV(b, aOps, dt);
                }
                else
                {
                    StepKeepPiece(b, aOps, dt);
                }
                ++b.ticks;
                if (starting && b.state == Behaviour::State::Running)
                {
                    Emit(b, "info", "started", {{"target", b.target}, {"summary", b.summary}});
                }
                if (b.state == Behaviour::State::Running && b.t - b.lastProgress >= 1.0)
                {
                    b.lastProgress = b.t;
                    Emit(b, "info", "running", {{"summary", b.summary}});
                }
                if (b.state == Behaviour::State::Running && b.t >= b.maxS)
                {
                    Finish(b, "max_s", "info", {{"max_s", b.maxS}});
                }
            }
        }
        catch (const MethodError& e)
        {
            Finish(b, e.code, "warn", {{"message", e.what()}});
        }
        catch (const std::exception& e)
        {
            Finish(b, "failed", "warn", {{"message", e.what()}});
        }
        if (b.state == Behaviour::State::Stopping)
        {
            // The stop step: give back what it held. A failure here is reported, never retried.
            try
            {
                if (b.kind == "turntable")
                {
                    StopTurntable(b, aOps);
                }
                else if (b.kind == "look")
                {
                    if (b.stopReason != "reached" && aOps.breakLookAt)
                    {
                        aOps.breakLookAt();
                    }
                }
                else if (b.kind == "glide_path")
                {
                    StopGlide(b, aOps);
                }
                else if (b.target == "v" && b.vPhase > 0)
                {
                    StopKeepV(b);
                }
            }
            catch (const std::exception& e)
            {
                b.stopData["give_back_failed"] = e.what();
            }
            json data = b.stopData.is_object() ? b.stopData : json::object();
            data["reason"] = b.stopReason;
            data["summary"] = b.summary;
            Emit(b, b.stopLevel, "stopped (" + b.stopReason + ")", data);
            log::Info("behave.stopped", "id=" + std::to_string(b.id) + " kind=" + b.kind + " reason=" + b.stopReason);
            b.state = Behaviour::State::Done;
        }
    }
    m_behaviours.erase(std::remove_if(m_behaviours.begin(), m_behaviours.end(), [](const auto& b) { return b->state == Behaviour::State::Done; }),
                       m_behaviours.end());
}
} // namespace xfb::behave
