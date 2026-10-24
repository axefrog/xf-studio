#include "core/Npc.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <set>
#include <tuple>

#include "core/Dispatcher.hpp"
#include "core/Events.hpp"
#include "core/Messages.hpp"
#include "core/Params.hpp"

namespace xfb::npc
{
namespace
{
constexpr double kPi = 3.14159265358979323846;

[[noreturn]] void Bad(const std::string& aMessage)
{
    params::CheckFail(aMessage);
}

std::string Lower(std::string aText)
{
    std::transform(aText.begin(), aText.end(), aText.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return aText;
}

std::string RequireText(const json& aParams, const char* aKey, size_t aMaxBytes)
{
    const auto value = params::CheckText(aParams, aKey, aMaxBytes);
    if (!value)
    {
        Bad(std::string("'") + aKey + "' is required");
    }
    return *value;
}

bool IsHandle(const std::string& aText)
{
    if (aText.size() < 2 || aText.size() > 6 || (aText[0] != 'a' && aText[0] != 'p'))
    {
        return false;
    }
    return std::all_of(aText.begin() + 1, aText.end(), [](char c) { return c >= '0' && c <= '9'; });
}

std::string RequireWho(const json& aParams, bool aAllowAll = false)
{
    const auto it = aParams.find("who");
    if (it == aParams.end() || !it->is_string())
    {
        Bad("'who' is required: an NPC's handle from npc_spawn or npc_pick (a1, p1, ...)");
    }
    const auto who = it->get<std::string>();
    if (aAllowAll && who == "all")
    {
        return who;
    }
    if (!IsHandle(who))
    {
        Bad("'who' must be an NPC's handle from npc_spawn or npc_pick (a1, p1, ...)" + std::string(aAllowAll ? ", or all" : ""));
    }
    return who;
}

std::string Arr(const Vec3& aV)
{
    return json::array({aV[0], aV[1], aV[2]}).dump();
}

Vec3 ToVec(const json& aValue)
{
    Vec3 out{};
    if (aValue.is_array() && aValue.size() == 3)
    {
        for (size_t i = 0; i < 3; ++i)
        {
            out[i] = aValue[i].is_number() ? aValue[i].get<double>() : 0.0;
        }
    }
    return out;
}

// The game's yaw that faces the horizontal direction (dx, dy): 0 faces +Y, 90 faces -X.
double YawTowards(double aDx, double aDy)
{
    return std::atan2(-aDx, aDy) * 180.0 / kPi;
}

// The gait by name.
int32_t ParseGait(const json& aParams)
{
    const auto gait = params::CheckText(aParams, "gait", 16).value_or("walk");
    if (gait == "walk")
    {
        return 0;
    }
    if (gait == "run")
    {
        return 1;
    }
    if (gait == "sprint")
    {
        return 2;
    }
    Bad("'gait' must be walk, run or sprint");
}

const char* GaitName(int32_t aGait)
{
    return aGait == 1 ? "run" : aGait == 2 ? "sprint" : "walk";
}

json Undo(const std::string& aMethod, json aParams)
{
    return json{{"method", aMethod}, {"params", std::move(aParams)}};
}
} // namespace

// --- the tables -------------------------------------------------------------------------------------

const std::vector<Cast>& Casts()
{
    // Base-game civilian templates only (tweaks/test-profile/xf_npc_actors.yaml sets each clone's entityTemplatePath to the
    // base game's citizen template, so no clone needs Phantom Liberty).
    static const std::vector<Cast> casts{
        {"woman_corpo", "Character.xfs_actor_woman_corpo", "woman_average", "Stranger", false},
        {"man_corpo", "Character.xfs_actor_man_corpo", "man_average", "Stranger", false},
        {"woman_nightlife", "Character.xfs_actor_woman_nightlife", "woman_average", "Stranger", false},
        {"man_youngster", "Character.xfs_actor_man_youngster", "man_average", "Stranger", false},
        {"woman_lowlife", "Character.xfs_actor_woman_lowlife", "woman_average", "Stranger", false},
        {"man_lowlife", "Character.xfs_actor_man_lowlife", "man_average", "Stranger", false},
        // Masked (the live-DM casting data): every look covers the mouth, which hides the missing lip sync of text lines.
        // Appearance names from the base game's citizen templates (citizen__creole_wa.ent, citizen__lowlife_ma.ent) and
        // their .app garments (h1_051 headkerchief masks, h1_031 hazmat respirator) [resource]; how well each hides the
        // mouth in game is session 9's N16 [hypothesis].
        {"woman_masked", "Character.xfs_actor_woman_masked", "woman_average", "Stranger", false, {"citizen__creole_wa_caribbean_29"}, true},
        {"man_masked", "Character.xfs_actor_man_masked", "man_average", "Stranger", false,
         {"king_of_the_stoop_ma_king_of_the_stoop_ma_012", "king_of_the_stoop_ma_king_of_the_stoop_ma_03", "king_of_the_stoop_ma_king_of_the_stoop_ma_014"}, true},
        // Session 9's N4 comparison only: the vanilla crowd record itself (isCrowd true, unchanged), and our clone of the plain
        // NPC base (never a crowd record) with the same template.
        {"research_crowd_record", "Character.CorpoWoman", "woman_average", "Stranger", true},
        {"research_npc_base", "Character.xfs_actor_research_npc_base", "woman_average", "Stranger", true},
    };
    return casts;
}

std::string ReactiveRecord(const Cast& aCast)
{
    return aCast.research ? std::string() : aCast.record + "_reactive";
}

const Cast* FindCast(const std::string& aName)
{
    for (const auto& cast : Casts())
    {
        if (cast.name == aName)
        {
            return &cast;
        }
    }
    return nullptr;
}

const std::vector<Expression>& Expressions()
{
    static const std::vector<Expression> expressions{
        {"neutral", 2, 2},     {"joy", 3, 5},          {"smile", 3, 6},   {"sad", 3, 3},     {"surprise", 3, 8},
        {"aggressive", 3, 2},  {"anger", 3, 1},        {"interested", 1, 3}, {"disinterested", 1, 6},
        {"disappointed", 3, 4}, {"disgust", 3, 7},     {"nervous", 3, 10}, {"fear", 3, 11},
    };
    return expressions;
}

const Expression* FindExpression(const std::string& aName)
{
    for (const auto& expression : Expressions())
    {
        if (expression.name == aName)
        {
            return &expression;
        }
    }
    return nullptr;
}

const std::vector<std::string>& VoiceTriggers()
{
    // Conversation-safe triggers from the ones AMM's Director offers (init.lua:2792-2830 [source]); combat and warning
    // triggers (start_combat, enemy_warning, ...) are left out so a line never sounds like a fight.
    static const std::vector<std::string> triggers{"greeting", "bump", "stlh_curious_grunt", "coop_irritation", "battlecry_curse",
                                                   "fear_foll", "fear_beg", "fear_run", "danger", "vehicle_bump"};
    return triggers;
}

const std::vector<Gesture>& Gestures()
{
    // Vanilla standing clips listed under the same name for both the Woman Average and the Man Average rig in AMM's workspot
    // catalogue (its db.sqlite3, table workspots, columns anim_name and anim_rig; clone 1.8.4-167-g5427235) [resource]. The
    // XF gesture carrier that would play them isn't built yet, so npc.act answers carrier_missing in the game; the seconds
    // are estimates until it is (N11) [hypothesis].
    static const std::vector<Gesture> gestures{
        {"talk", "stand__2h_on_sides__01__talk__neutral__02", "stand__2h_on_sides__01__talk__neutral__02", 4.0},
        {"talk_hips", "stand__2h_on_hip__01__talk__neutral__01", "stand__2h_on_hip__01__talk__neutral__01", 4.0},
        {"wave", "stand__2h_on_sides__01__crowd_wave__01", "stand__2h_on_sides__01__crowd_wave__01", 3.0},
        {"shrug", "stand__2h_on_sides__01__shrug__01", "stand__2h_on_sides__01__shrug__01", 2.5},
        {"nod", "stand__2h_front__01__nod__respectful__01", "stand__2h_front__01__nod__respectful__01", 2.5},
        {"arms_crossed", "stand__arms_crossed_front__01", "stand__arms_crossed_front__01", 6.0},
        {"facepalm", "stand__2h_on_sides__01__facepalm__01", "stand__2h_on_sides__01__facepalm__01", 3.0},
        {"check_phone", "stand__2h_on_sides__01__check_phone__01", "stand__2h_on_sides__01__check_phone__01", 5.0},
    };
    return gestures;
}

const Gesture* FindGesture(const std::string& aName)
{
    for (const auto& gesture : Gestures())
    {
        if (gesture.name == aName)
        {
            return &gesture;
        }
    }
    return nullptr;
}

int32_t StyleLineType(const std::string& aStyle)
{
    if (aStyle == "subtitle")
    {
        return 1; // scnDialogLineType.Regular: the bottom subtitle with the speaker's name
    }
    if (aStyle == "call_subtitle")
    {
        return 2; // Holocall: the game draws it as a subtitle with the speaker's name; the call frame needs a real call (0.8.9)
    }
    if (aStyle == "overhead")
    {
        return 4; // OverHead: above the speaker (the chatter controller's rules)
    }
    if (aStyle == "ownerless")
    {
        return 9; // OwnerlessRegular: a subtitle with a name and no speaker entity
    }
    return -1;
}

double YawDifference(double aA, double aB)
{
    double d = std::fmod(aA - aB, 360.0);
    if (d > 180.0)
    {
        d -= 360.0;
    }
    if (d < -180.0)
    {
        d += 360.0;
    }
    return d;
}

Camera CameraFrom(const json& aReading)
{
    Camera out;
    const auto it = aReading.find("camera");
    if (it == aReading.end() || !it->is_object() || !it->contains("position") || !it->contains("forward"))
    {
        return out;
    }
    out.position = ToVec((*it)["position"]);
    out.forward = ToVec((*it)["forward"]);
    const double length = std::sqrt(out.forward[0] * out.forward[0] + out.forward[1] * out.forward[1] + out.forward[2] * out.forward[2]);
    if (length < 1e-6)
    {
        return Camera{};
    }
    for (auto& c : out.forward)
    {
        c /= length;
    }
    const auto fov = it->value("fov", 60.0);
    out.fov = std::isfinite(fov) && fov >= 10.0 && fov <= 170.0 ? fov : 60.0;
    const auto aspect = it->value("aspect", 16.0 / 9.0);
    out.aspect = std::isfinite(aspect) && aspect >= 0.5 && aspect <= 5.0 ? aspect : 16.0 / 9.0;
    out.known = true;
    return out;
}

bool InView(const Camera& aCamera, const Vec3& aPoint, double aMarginDeg)
{
    if (!aCamera.known)
    {
        return true;
    }
    const auto& f = aCamera.forward;
    const Vec3 d{aPoint[0] - aCamera.position[0], aPoint[1] - aCamera.position[1], aPoint[2] - aCamera.position[2]};
    const double depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) < 0.3)
    {
        return true; // at the camera itself
    }
    if (depth <= 0.0)
    {
        return false; // behind the camera
    }
    // Right: forward x up (Z up), so yaw 0 (facing +Y) has right +X; up: right x forward.
    double rx = f[1], ry = -f[0];
    const double rl = std::sqrt(rx * rx + ry * ry);
    if (rl < 1e-6)
    {
        rx = 1.0; // looking straight up or down
        ry = 0.0;
    }
    else
    {
        rx /= rl;
        ry /= rl;
    }
    const Vec3 r{rx, ry, 0.0};
    const Vec3 u{r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]};
    const double x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
    const double y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const double half = aCamera.fov * kPi / 360.0;
    const double hHalf = std::max(half, std::atan(std::tan(half) * aCamera.aspect));
    const double vHalf = std::max(half, std::atan(std::tan(half) / aCamera.aspect));
    const double margin = aMarginDeg * kPi / 180.0;
    return std::atan2(std::abs(x), depth) <= hHalf + margin && std::atan2(std::abs(y), depth) <= vHalf + margin;
}

std::vector<Vec3> HiddenCandidates(const Vec3& aV, const Camera& aCamera, double aMin, double aMax)
{
    std::vector<Vec3> out;
    if (!aCamera.known)
    {
        return out;
    }
    const double cameraYaw = YawTowards(aCamera.forward[0], aCamera.forward[1]);
    const double offsets[] = {180.0, 150.0, -150.0, 120.0, -120.0, 90.0, -90.0, 60.0, -60.0};
    const double distances[] = {aMin, (aMin + aMax) / 2.0, aMax};
    for (const double distance : distances)
    {
        for (const double offset : offsets)
        {
            const auto point = OffsetPoint(aV, cameraYaw + offset, distance, 0.0);
            const Vec3 chest{point[0], point[1], point[2] + 1.0};
            if (!InView(aCamera, chest, kViewMarginDeg))
            {
                out.push_back(point);
            }
        }
    }
    return out;
}

// --- targets -----------------------------------------------------------------------------------------

Target ParseTarget(const json& aValue, const std::string& aKey, bool aAllowOffset)
{
    Target out;
    const std::string allowed = aAllowOffset ? "\"v\", an NPC's handle, [x, y, z] or {ahead_m, side_m}" : "\"v\", an NPC's handle or [x, y, z]";
    if (aValue.is_string())
    {
        const auto text = aValue.get<std::string>();
        if (text == "v")
        {
            out.kind = Target::Kind::V;
            return out;
        }
        if (IsHandle(text))
        {
            out.kind = Target::Kind::Who;
            out.who = text;
            return out;
        }
        Bad("'" + aKey + "' must be " + allowed);
    }
    if (aValue.is_array())
    {
        const auto point = params::CheckPoint(json{{aKey, aValue}}, aKey.c_str());
        out.kind = Target::Kind::Point;
        out.point = *point;
        return out;
    }
    if (aValue.is_object() && aAllowOffset)
    {
        params::RequireOnly(aValue, {"ahead_m", "side_m"});
        const auto ahead = params::CheckNumber(aValue, "ahead_m", -kMaxRangeM, kMaxRangeM);
        if (!ahead)
        {
            Bad("'" + aKey + ".ahead_m' is required (metres along V's facing)");
        }
        out.kind = Target::Kind::Offset;
        out.ahead = *ahead;
        out.side = params::CheckNumber(aValue, "side_m", -kMaxRangeM, kMaxRangeM).value_or(0.0);
        return out;
    }
    Bad("'" + aKey + "' must be " + allowed);
}

const char* TargetKindName(Target::Kind aKind)
{
    switch (aKind)
    {
    case Target::Kind::V:
        return "v";
    case Target::Kind::Who:
        return "who";
    case Target::Kind::Point:
        return "point";
    case Target::Kind::Offset:
        return "offset";
    default:
        return "none";
    }
}

json TargetJson(const Target& aTarget)
{
    switch (aTarget.kind)
    {
    case Target::Kind::V:
        return "v";
    case Target::Kind::Who:
        return aTarget.who;
    case Target::Kind::Point:
        return json::array({aTarget.point[0], aTarget.point[1], aTarget.point[2]});
    case Target::Kind::Offset:
        return json{{"ahead_m", aTarget.ahead}, {"side_m", aTarget.side}};
    default:
        return nullptr;
    }
}

Vec3 OffsetPoint(const Vec3& aFrom, double aYaw, double aAhead, double aSide)
{
    const double r = aYaw * kPi / 180.0;
    const double fx = -std::sin(r), fy = std::cos(r); // forward: yaw 0 faces +Y, 90 faces -X
    const double rx = std::cos(r), ry = std::sin(r);  // right: forward x up
    return {aFrom[0] + fx * aAhead + rx * aSide, aFrom[1] + fy * aAhead + ry * aSide, aFrom[2]};
}

double Distance(const Vec3& aA, const Vec3& aB)
{
    const double dx = aA[0] - aB[0], dy = aA[1] - aB[1], dz = aA[2] - aB[2];
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

double HorizontalDistance(const Vec3& aA, const Vec3& aB)
{
    const double dx = aA[0] - aB[0], dy = aA[1] - aB[1];
    return std::sqrt(dx * dx + dy * dy);
}

size_t CountChars(const std::string& aText)
{
    size_t count = 0;
    for (const auto c : aText)
    {
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80)
        {
            ++count;
        }
    }
    return count;
}

void RequireKnown(const std::string& aMethod, const json& aParams)
{
    static const std::map<std::string, std::vector<const char*>> known{
        {"npc.list", {"radius_m", "max"}},
        {"npc.pick", {"id"}},
        {"npc.status", {}},
        {"npc.spawn", {"cast", "at", "face", "appearance", "variant", "out_of_view", "label", "attitude", "immortal", "reactions", "min_m", "max_m"}},
        {"npc.move", {"who", "to", "gait", "stop_m", "face_v", "max_s"}},
        {"npc.follow", {"who", "target", "distance_m", "gait", "max_s"}},
        {"npc.turn", {"who", "to", "away_from", "hold", "off"}},
        {"npc.place", {"who", "at", "yaw"}},
        {"npc.stop", {"who"}},
        {"npc.say", {"who", "speaker", "text", "trigger", "style", "seconds", "hide", "near_m"}},
        {"npc.look", {"who", "at", "off"}},
        {"npc.face", {"who", "expression", "off"}},
        {"npc.act", {"who", "gesture", "off", "seconds"}},
        {"npc.choices", {"who", "title", "choices", "max_s", "withdraw"}},
        {"npc.release", {"who", "how", "walk", "distance_m"}},
    };
    const auto it = known.find(aMethod);
    if (it == known.end())
    {
        return;
    }
    if (!aParams.is_object() && !aParams.is_null())
    {
        Bad("params must be an object");
    }
    if (aParams.is_null())
    {
        return;
    }
    for (const auto& [key, _] : aParams.items())
    {
        if (std::find_if(it->second.begin(), it->second.end(), [&](const char* k) { return key == k; }) == it->second.end())
        {
            std::string list;
            for (const auto* k : it->second)
            {
                list += (list.empty() ? "" : ", ") + std::string(k);
            }
            Bad("unknown parameter '" + key.substr(0, 32) + "' for " + aMethod + (list.empty() ? " (it takes none)" : " (" + list + ")"));
        }
    }
}

// --- the service -------------------------------------------------------------------------------------------

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
        events->Push(aKind, aLevel, "npc", aText, std::move(aData));
    }
}

json Service::RequireV(const Ops& aOps) const
{
    auto v = aOps.v();
    const auto phase = v.value("phase", std::string("gameplay"));
    if (phase != "gameplay")
    {
        throw MethodError("not_in_world", "NPCs are directed in normal play only; the game is in '" + phase + "'");
    }
    const auto busy = v.value("busy", std::string());
    if (busy == "in_combat" || busy == "in_vehicle" || busy == "in_scene" || busy == "not_v")
    {
        const std::string why = busy == "in_combat" ? "V is in combat" : busy == "in_vehicle" ? "V is in a vehicle" : busy == "in_scene" ? "V is in a story scene or a dialogue" : "the player isn't V right now";
        throw MethodError(busy, why + ", so the bridge leaves NPCs alone");
    }
    return v;
}

Service::Npc& Service::Ours(const std::string& aWho, bool aActorOnly)
{
    const auto it = m_npcs.find(aWho);
    if (it == m_npcs.end())
    {
        throw MethodError("npc_unknown", "no NPC has the handle " + aWho + " in this session (npc_status lists them; a load forgets them)");
    }
    if (aActorOnly && it->second.kind != "actor")
    {
        throw MethodError("not_ours", aWho + " is someone else's NPC (picked): the bridge only looks, sets a face and speaks for it; moving and gestures are for actors from npc_spawn");
    }
    return it->second;
}

void Service::RequireDirected(const Npc& aNpc)
{
    if (aNpc.deadKept)
    {
        throw MethodError("npc_dead", aNpc.who + " is dead; its body stays until npc_release (despawn, or dissolve once V can't see it)");
    }
    if (aNpc.handedBack)
    {
        throw MethodError("npc_handed_back", aNpc.who + " was handed back to its own AI when the fight began; the bridge no longer directs it (npc_release removes it)");
    }
}

bool Service::OutOfSight(const Camera& aCamera, const Vec3& aPoint, const Ops& aOps) const
{
    const Vec3 head{aPoint[0], aPoint[1], aPoint[2] + 1.6};
    const Vec3 feet{aPoint[0], aPoint[1], aPoint[2] + 0.3};
    if (!aCamera.known)
    {
        return false;
    }
    if (!InView(aCamera, head, kViewMarginDeg) && !InView(aCamera, feet, kViewMarginDeg))
    {
        return true;
    }
    if (!aOps.ray)
    {
        return false;
    }
    // In the view's cone: hidden only when static geometry stands between the camera and both its head and its feet.
    try
    {
        return aOps.ray(aCamera.position, head).value("blocked", false) && aOps.ray(aCamera.position, feet).value("blocked", false);
    }
    catch (const std::exception&)
    {
        return false;
    }
}

json Service::FindHiddenSpot(const json& aV, double aMin, double aMax, const Ops& aOps) const
{
    const auto camera = CameraFrom(aV);
    if (!camera.known)
    {
        throw MethodError("no_hidden_spot", "the game didn't report V's camera, so the bridge can't tell what she sees; give at instead");
    }
    if (!aOps.ground)
    {
        throw MethodError("no_hidden_spot", "this build can't probe the ground for a hidden spot; give at instead");
    }
    const auto vPos = ToVec(aV.value("position", json::array({0, 0, 0})));
    size_t probes = 0;
    for (const auto& candidate : HiddenCandidates(vPos, camera, aMin, aMax))
    {
        if (probes >= kMaxHiddenProbes)
        {
            break;
        }
        ++probes;
        json ground;
        try
        {
            ground = aOps.ground(candidate);
        }
        catch (const std::exception&)
        {
            continue;
        }
        if (!ground.value("walkable", false) || !ground.contains("point"))
        {
            continue;
        }
        const auto point = ToVec(ground["point"]);
        const double d = Distance(point, vPos);
        if (d > kMaxRangeM || HorizontalDistance(point, vPos) < aMin - 1.0)
        {
            continue;
        }
        if (!OutOfSight(camera, point, aOps))
        {
            continue;
        }
        return json{{"point", json::array({point[0], point[1], point[2]})}, {"probes", probes}, {"distance_v", std::round(d * 100) / 100}};
    }
    throw MethodError("no_hidden_spot", "no walkable spot out of V's sight between " + std::to_string(static_cast<int>(aMin)) + " and " +
                                            std::to_string(static_cast<int>(aMax)) + " m from her (" + std::to_string(probes) +
                                            " tried); turn V towards a wall or open ground, or give at instead");
}

json Service::FindVisibleSpot(const json& aV, const Vec3& aAsked, const Ops& aOps) const
{
    json out{{"moved", false}, {"probes", 0}};
    if (!aOps.ray || !aOps.ground)
    {
        return out;
    }
    const auto vPos = ToVec(aV.value("position", json::array({0, 0, 0})));
    // V's real head from the game (a crouch lowers it); standing height only where the game didn't say.
    const Vec3 eye = aV.contains("head") ? ToVec(aV["head"]) : Vec3{vPos[0], vPos[1], vPos[2] + kSightEyeM};
    size_t probes = 0;
    const auto snap = [&](const Vec3& aAt, Vec3& aOut) {
        ++probes;
        try
        {
            const auto ground = aOps.ground(aAt);
            if (!ground.value("walkable", false) || !ground.contains("point"))
            {
                return false;
            }
            aOut = ToVec(ground["point"]);
            return true;
        }
        catch (const std::exception&)
        {
            return false;
        }
    };
    const auto seen = [&](const Vec3& aSpot) {
        try
        {
            return !aOps.ray(eye, Vec3{aSpot[0], aSpot[1], aSpot[2] + kSightChestM}).value("blocked", false);
        }
        catch (const std::exception&)
        {
            return true; // can't tell: the asked spot stands
        }
    };
    Vec3 spot{};
    if (!snap(aAsked, spot) || seen(spot))
    {
        // Not walkable: the spawn says so itself. Seen: nothing to change.
        out["probes"] = probes;
        return out;
    }
    std::vector<Vec3> candidates;
    for (const double radius : {0.75, 1.5, 2.5, kSightSearchM})
    {
        for (int k = 0; k < 8; ++k)
        {
            const double a = k * kPi / 4.0;
            candidates.push_back({aAsked[0] + radius * std::cos(a), aAsked[1] + radius * std::sin(a), aAsked[2]});
        }
    }
    const double toward = HorizontalDistance(aAsked, vPos);
    if (toward > 1.0)
    {
        for (const double step : {1.0, 2.0, 3.0, kSightSearchM})
        {
            if (toward - step >= 1.0)
            {
                candidates.push_back({aAsked[0] + (vPos[0] - aAsked[0]) * step / toward, aAsked[1] + (vPos[1] - aAsked[1]) * step / toward, aAsked[2]});
            }
        }
    }
    std::stable_sort(candidates.begin(), candidates.end(), [&](const Vec3& a, const Vec3& b) { return Distance(a, aAsked) < Distance(b, aAsked); });
    for (const auto& candidate : candidates)
    {
        if (probes >= kMaxSightProbes)
        {
            break;
        }
        Vec3 found{};
        if (!snap(candidate, found) || HorizontalDistance(found, vPos) < 1.0 || Distance(found, aAsked) > kSightSearchM)
        {
            continue;
        }
        if (seen(found))
        {
            return json{{"moved", true}, {"point", json::array({found[0], found[1], found[2]})}, {"probes", probes}, {"moved_m", std::round(Distance(found, aAsked) * 100) / 100}};
        }
    }
    throw MethodError("no_visible_spot", "V can't see that place (something stands between her and it, such as a machine or a wall) and nowhere within " +
                                             std::to_string(static_cast<int>(kSightSearchM)) + " m of it is walkable with a sight line to her (" + std::to_string(probes) +
                                             " tried); step away from the obstacle, or ask for another place");
}

Vec3 Service::Resolve(const Target& aTarget, const json& aV) const
{
    const auto vPos = ToVec(aV.value("position", json::array({0, 0, 0})));
    switch (aTarget.kind)
    {
    case Target::Kind::V:
        return vPos;
    case Target::Kind::Point:
        return aTarget.point;
    case Target::Kind::Offset:
        return OffsetPoint(vPos, aV.value("yaw", 0.0), aTarget.ahead, aTarget.side);
    case Target::Kind::Who:
    {
        const auto it = m_npcs.find(aTarget.who);
        if (it == m_npcs.end())
        {
            throw MethodError("npc_unknown", "no NPC has the handle " + aTarget.who + " in this session");
        }
        if (!it->second.known)
        {
            throw MethodError("npc_not_spawned", aTarget.who + " hasn't appeared in the world yet (wait for npc.spawned)");
        }
        return it->second.position;
    }
    default:
        return vPos;
    }
}

void Service::CheckRange(const Vec3& aPoint, const json& aV) const
{
    const auto vPos = ToVec(aV.value("position", json::array({0, 0, 0})));
    const double d = Distance(aPoint, vPos);
    if (d > kMaxRangeM)
    {
        throw MethodError("too_far", "that place is " + std::to_string(static_cast<int>(std::round(d))) + " m from V; NPCs are directed within 30 m of her");
    }
}

json Service::List(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.list", aParams);
    const double radius = params::CheckNumber(aParams, "radius_m", 1.0, kListMaxM).value_or(kListDefaultM);
    const auto max = static_cast<int32_t>(params::CheckInteger(aParams, "max", 1, 40).value_or(20));
    auto out = aOps.list(radius, max);
    std::scoped_lock _(m_mutex);
    // Mark the session's own (actors and picks) by entity id.
    for (auto& entry : out["npcs"])
    {
        for (const auto& [who, npc] : m_npcs)
        {
            if (!npc.entity.empty() && entry.value("id", std::string()) == npc.entity)
            {
                entry["ours"] = who;
            }
        }
    }
    out["radius_m"] = radius;
    return out;
}

json Service::Pick(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.pick", aParams);
    const auto id = RequireText(aParams, "id", 64);
    RequireV(aOps);
    std::string who;
    {
        std::scoped_lock _(m_mutex);
        size_t picks = 0;
        for (const auto& [handle, npc] : m_npcs)
        {
            if (npc.kind == "pick")
            {
                ++picks;
                if (npc.entity == id)
                {
                    return json{{"who", handle}, {"already", true}, {"record", npc.record}};
                }
            }
        }
        if (picks >= kMaxPicks)
        {
            throw MethodError("limit", "the bridge holds " + std::to_string(kMaxPicks) + " picked NPCs already; npc_release one first");
        }
        who = "p" + std::to_string(m_nextPick);
    }
    auto step = aOps.pick(who, id);
    std::scoped_lock _(m_mutex);
    ++m_nextPick;
    Npc npc;
    npc.who = who;
    npc.kind = "pick";
    npc.record = step.value("record", std::string());
    npc.entity = id;
    npc.label = step.value("label", std::string("Stranger"));
    npc.rig = step.value("rig", std::string());
    npc.spawned = npc.announced = true;
    if (step.contains("position"))
    {
        npc.position = ToVec(step["position"]);
        npc.known = true;
    }
    m_npcs[who] = npc;
    step["who"] = who;
    step["undo"] = Undo("npc.release", {{"who", who}, {"how", "leave"}});
    step["undo_note"] = "a pick changes nothing by itself; releasing it takes back its look, face and lines";
    step["note"] = "picked NPCs take npc_look, npc_face and npc_say only; they aren't moved or given gestures";
    return step;
}

json Service::NpcJson(const Npc& aNpc) const
{
    json lines = json::array();
    for (const auto& line : aNpc.lines)
    {
        lines.push_back({{"line", "l" + std::to_string(line.number)}, {"seconds_left", std::round(line.left * 10) / 10}});
    }
    json out{{"who", aNpc.who},       {"kind", aNpc.kind},     {"record", aNpc.record},     {"entity", aNpc.entity},
             {"spawned", aNpc.spawned}, {"lines", lines},        {"look", aNpc.look ? TargetJson(*aNpc.look) : json(nullptr)},
             {"face", aNpc.face.empty() ? json(nullptr) : json(aNpc.face)}, {"gesture", aNpc.gesture.empty() ? json(nullptr) : json(aNpc.gesture)}};
    if (!aNpc.cast.empty())
    {
        out["cast"] = aNpc.cast;
    }
    if (aNpc.kind == "actor")
    {
        out["attitude"] = aNpc.attitude;
        out["immortal"] = aNpc.immortal;
        out["reactions"] = aNpc.reactions;
        out["handed_back"] = aNpc.handedBack;
        out["dead"] = aNpc.deadKept;
    }
    if (aNpc.known)
    {
        out["position"] = json::array({aNpc.position[0], aNpc.position[1], aNpc.position[2]});
    }
    if (aNpc.motion)
    {
        out["motion"] = {{"kind", aNpc.motion->kind}, {"target", TargetJson(aNpc.motion->target)}, {"age_s", std::round(aNpc.motion->age * 10) / 10},
                         {"max_s", aNpc.motion->maxS}, {"state", aNpc.motion->lastState}};
    }
    if (!aNpc.releasing.empty())
    {
        out["releasing"] = aNpc.releasing;
    }
    if (aNpc.yawKnown)
    {
        out["yaw"] = std::round(aNpc.yaw * 10) / 10;
    }
    if (aNpc.facing)
    {
        out["facing"] = {{aNpc.facing->away ? "away_from" : "to", TargetJson(aNpc.facing->target)}, {"hold", true}};
    }
    return out;
}

json Service::Status(const json& aParams) const
{
    RequireKnown("npc.status", aParams);
    std::scoped_lock _(m_mutex);
    json npcs = json::array();
    for (const auto& [who, npc] : m_npcs)
    {
        npcs.push_back(NpcJson(npc));
    }
    json hub = nullptr;
    if (m_hub)
    {
        hub = {{"hub", m_hub->hub.id}, {"who", m_hub->hub.who}, {"title", m_hub->hub.title}, {"choices", m_hub->hub.choices},
               {"age_s", std::round(m_hub->age * 10) / 10}, {"max_s", m_hub->maxS}};
    }
    json voices = json::array();
    for (const auto& line : m_voice)
    {
        voices.push_back({{"line", "l" + std::to_string(line.number)}, {"speaker", line.speaker}, {"seconds_left", std::round(line.left * 10) / 10}});
    }
    json casts = json::array();
    for (const auto& cast : Casts())
    {
        casts.push_back({{"cast", cast.name}, {"rig", cast.rig}, {"masked", cast.masked}, {"research", cast.research}, {"appearances", cast.appearances}});
    }
    return json{{"npcs", npcs}, {"hub", hub}, {"voice_lines", voices}, {"actors", ActorCount()}, {"casts", casts},
                {"limits", {{"actors", kMaxActors}, {"picks", kMaxPicks}, {"range_m", kMaxRangeM}}}};
}

size_t Service::ActorCount() const
{
    std::scoped_lock _(m_mutex);
    return static_cast<size_t>(std::count_if(m_npcs.begin(), m_npcs.end(), [](const auto& e) { return e.second.kind == "actor"; }));
}

json Service::Spawn(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.spawn", aParams);
    const auto castName = RequireText(aParams, "cast", 32);
    const auto* cast = FindCast(castName);
    if (!cast)
    {
        std::string names;
        for (const auto& c : Casts())
        {
            names += (names.empty() ? "" : ", ") + c.name;
        }
        throw MethodError("cast_unknown", "'" + castName.substr(0, 32) + "' isn't an XF actor; casts: " + names);
    }
    if (!aParams.contains("at"))
    {
        Bad("'at' is required: [x, y, z], {ahead_m, side_m} from V, or \"out_of_sight\"");
    }
    // V16: "out_of_sight" lets the bridge find a walkable spot V can't see, min_m to max_m from her.
    const bool hidden = aParams["at"].is_string() && aParams["at"].get<std::string>() == "out_of_sight";
    Target at;
    if (!hidden)
    {
        at = ParseTarget(aParams["at"], "at", true);
        if (at.kind != Target::Kind::Point && at.kind != Target::Kind::Offset)
        {
            Bad("'at' must be [x, y, z], {ahead_m, side_m} from V, or \"out_of_sight\"");
        }
        if (aParams.contains("min_m") || aParams.contains("max_m"))
        {
            Bad("min_m and max_m go with at: \"out_of_sight\"");
        }
    }
    const double minM = params::CheckNumber(aParams, "min_m", 3.0, kMaxRangeM).value_or(kHiddenMinM);
    const double maxM = params::CheckNumber(aParams, "max_m", 3.0, kMaxRangeM).value_or(std::max(kHiddenMaxM, minM));
    if (maxM < minM)
    {
        Bad("max_m must be at least min_m");
    }
    // V15: how it stands towards V, whether it can be killed, and whose reactions it has.
    const auto attitude = params::CheckText(aParams, "attitude", 16).value_or("friendly");
    if (attitude != "friendly" && attitude != "neutral" && attitude != "hostile")
    {
        Bad("'attitude' must be friendly (the default), neutral or hostile");
    }
    const bool immortal = params::CheckBoolean(aParams, "immortal").value_or(true);
    const auto reactions = params::CheckText(aParams, "reactions", 16).value_or("quiet");
    if (reactions != "quiet" && reactions != "game")
    {
        Bad("'reactions' must be quiet (the default: no crime or panic reactions) or game (the civilian's own)");
    }
    const auto record = reactions == "game" ? ReactiveRecord(*cast) : cast->record;
    if (record.empty())
    {
        Bad("the research casts have no record with the game's reactions; use reactions quiet");
    }
    Target face;
    face.kind = Target::Kind::V;
    if (aParams.contains("face") && !aParams["face"].is_null())
    {
        face = ParseTarget(aParams["face"], "face", false);
    }
    std::string appearance = params::CheckText(aParams, "appearance", 96).value_or(std::string());
    if (appearance.empty())
    {
        const auto variant = static_cast<size_t>(params::CheckInteger(aParams, "variant", 0, 31).value_or(0));
        if (!cast->appearances.empty())
        {
            if (variant >= cast->appearances.size())
            {
                Bad("'variant' is 0 to " + std::to_string(cast->appearances.size() - 1) + " for " + cast->name);
            }
            appearance = cast->appearances[variant];
        }
        else
        {
            appearance = "random";
        }
    }
    const bool outOfView = params::CheckBoolean(aParams, "out_of_view").value_or(hidden);
    const auto label = params::CheckText(aParams, "label", kMaxTitleChars).value_or(cast->label);
    const auto v = RequireV(aOps);
    {
        std::scoped_lock _(m_mutex);
        if (ActorCount() >= kMaxActors)
        {
            throw MethodError("limit", "the bridge has " + std::to_string(kMaxActors) + " actors out already; npc_release one first");
        }
    }
    json hiddenSpot = nullptr;
    if (hidden)
    {
        hiddenSpot = FindHiddenSpot(v, minM, maxM, aOps);
        at.kind = Target::Kind::Point;
        at.point = ToVec(hiddenSpot["point"]);
    }
    std::string who;
    Vec3 point{};
    double yaw = 0.0;
    {
        std::scoped_lock _(m_mutex);
        point = Resolve(at, v);
        CheckRange(point, v);
    }
    // 0.8.10: asked for relative to V (ahead_m, side_m), she can see the actor: a spot with no sight line to her head is replaced
    // by the nearest visible walkable one (a point given by coordinates is staged exactly as given).
    json sightMove = nullptr;
    if (at.kind == Target::Kind::Offset)
    {
        const auto visible = FindVisibleSpot(v, point, aOps);
        if (visible.value("moved", false))
        {
            sightMove = json{{"from", json::array({point[0], point[1], point[2]})}, {"to", visible["point"]}, {"moved_m", visible["moved_m"]}};
            point = ToVec(visible["point"]);
        }
    }
    {
        std::scoped_lock _(m_mutex);
        const auto facing = Resolve(face, v);
        yaw = YawTowards(facing[0] - point[0], facing[1] - point[1]);
        who = "a" + std::to_string(m_nextActor);
    }
    const int32_t attitudeCode = attitude == "hostile" ? 2 : attitude == "neutral" ? 1 : 0;
    auto step = aOps.spawn(who, record, point, yaw, appearance, outOfView, attitudeCode, immortal);
    std::scoped_lock _(m_mutex);
    ++m_nextActor;
    Npc npc;
    npc.who = who;
    npc.kind = "actor";
    npc.cast = cast->name;
    npc.record = record;
    npc.rig = cast->rig;
    npc.label = label;
    npc.attitude = attitude;
    npc.immortal = immortal;
    npc.reactions = reactions;
    npc.entity = step.value("entity", std::string());
    if (step.contains("position"))
    {
        npc.position = ToVec(step["position"]); // where it will appear; known (a target, a distance) once it has
    }
    m_npcs[who] = npc;
    json out{{"who", who},       {"cast", cast->name},   {"record", record},     {"appearance", appearance}, {"entity", npc.entity},
             {"asked_at", json::array({point[0], point[1], point[2]})}, {"yaw", yaw}, {"spawning", true}, {"attitude", attitude},
             {"immortal", immortal}, {"reactions", reactions}};
    if (!hiddenSpot.is_null())
    {
        out["out_of_sight"] = hiddenSpot;
    }
    if (!sightMove.is_null())
    {
        out["moved_for_sight"] = sightMove;
        out["note"] = "the asked place had no sight line to V's head, so the actor stands at the nearest walkable place she can see";
    }
    if (npc.StandsIn())
    {
        out["stand_in_note"] = "a stand-in: if a fight begins the bridge stops directing it and its own AI takes over (npc.handed_back); if it dies its body stays until npc_release";
    }
    if (step.contains("position"))
    {
        out["position"] = step["position"];
    }
    if (step.contains("note"))
    {
        out["note"] = step["note"];
    }
    out["undo"] = Undo("npc.release", {{"who", who}, {"how", "despawn"}});
    out["undo_note"] = "the actor is never saved: releasing it, the kill switch or loading a save removes it; npc.spawned follows when it appears";
    return out;
}

json Service::Move(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.move", aParams);
    const auto who = RequireWho(aParams);
    if (!aParams.contains("to"))
    {
        Bad("'to' is required: \"v\", an NPC's handle or [x, y, z]");
    }
    const auto to = ParseTarget(aParams["to"], "to", false);
    if (to.kind == Target::Kind::Who && to.who == who)
    {
        Bad("an NPC can't walk to itself");
    }
    Command command;
    command.kind = "move";
    command.target = to;
    command.gait = ParseGait(aParams);
    command.distance = params::CheckNumber(aParams, "stop_m", 0.3, 10.0).value_or(1.6);
    // 0.8.11 (session 17's N1 and N3: she walked away backwards): the move handler writes its facing target into the behaviour's
    // argument only when there is one and never clears it (aiMoveToCommandHandler.script:47-51), so V as the facing target stuck
    // and steered every later walk. Off unless asked; if it is asked, it is cleared when the move ends or the next command goes out.
    command.faceV = params::CheckBoolean(aParams, "face_v").value_or(false);
    const double maxS = params::CheckNumber(aParams, "max_s", 1.0, kMoveMaxS).value_or(kMoveMaxS);
    const auto v = RequireV(aOps);
    Vec3 point{};
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        RequireDirected(npc);
        if (!npc.releasing.empty())
        {
            throw MethodError("npc_releasing", who + " is walking away to be released");
        }
        point = Resolve(to, v);
        CheckRange(point, v);
    }
    if (to.kind == Target::Kind::Point)
    {
        command.target.point = point;
    }
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, true);
    const bool replaced = npc.motion.has_value();
    Motion motion;
    motion.kind = "move";
    motion.target = to;
    motion.point = point;
    motion.stopM = command.distance;
    motion.maxS = maxS;
    BeginWalk(npc, command, point, motion, aOps);
    npc.motion = motion;
    npc.facingSet = command.faceV;
    json out{{"who", who}, {"to", TargetJson(to)}, {"gait", GaitName(command.gait)}, {"stop_m", command.distance}, {"max_s", maxS}, {"replaced", replaced}};
    if (motion.pending)
    {
        out["turns_first"] = true; // 0.8.10: the way is more than kTurnFirstDeg off its facing: it turns on the spot, then walks
    }
    out["undo"] = Undo("npc.stop", {{"who", who}});
    out["undo_note"] = "npc.stop halts the actor where it is (it doesn't walk back); npc.arrived or npc.move_failed follows";
    return out;
}

json Service::Follow(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.follow", aParams);
    const auto who = RequireWho(aParams);
    const auto target = aParams.contains("target") ? ParseTarget(aParams["target"], "target", false) : Target{Target::Kind::V};
    if (target.kind != Target::Kind::V && target.kind != Target::Kind::Who)
    {
        Bad("'target' must be \"v\" or an NPC's handle");
    }
    if (target.kind == Target::Kind::Who && target.who == who)
    {
        Bad("an NPC can't follow itself");
    }
    Command command;
    command.kind = "follow";
    command.target = target;
    command.gait = ParseGait(aParams);
    command.distance = params::CheckNumber(aParams, "distance_m", 1.0, 10.0).value_or(2.0);
    const double maxS = params::CheckNumber(aParams, "max_s", 1.0, kFollowMaxS).value_or(kFollowMaxS);
    const auto v = RequireV(aOps);
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        RequireDirected(npc);
        if (!npc.releasing.empty())
        {
            throw MethodError("npc_releasing", who + " is walking away to be released");
        }
        CheckRange(Resolve(target, v), v);
    }
    Send(who, command, aOps);
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, true);
    const bool replaced = npc.motion.has_value();
    Motion motion;
    motion.kind = "follow";
    motion.target = target;
    motion.stopM = command.distance;
    motion.maxS = maxS;
    npc.motion = motion;
    return json{{"who", who}, {"target", TargetJson(target)}, {"distance_m", command.distance}, {"max_s", maxS}, {"replaced", replaced},
                {"undo", Undo("npc.stop", {{"who", who}})}, {"undo_note", "npc.stop ends the follow where the actor is; it ends by itself after max_s"}};
}

json Service::Turn(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.turn", aParams);
    const auto who = RequireWho(aParams);
    const bool off = params::CheckBoolean(aParams, "off").value_or(false);
    if (off)
    {
        // Ends a held facing (the actor keeps its current facing).
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        const bool had = npc.facing.has_value();
        npc.facing.reset();
        return json{{"who", who}, {"hold", false}, {"was_holding", had}, {"undo", nullptr}, {"undo_note", "nothing to undo: the actor keeps facing where it faces"}};
    }
    const bool away = aParams.contains("away_from");
    if (away == aParams.contains("to"))
    {
        Bad("give 'to' (face it) or 'away_from' (turn its back on it): \"v\", an NPC's handle or [x, y, z]; or off: true");
    }
    const auto target = ParseTarget(aParams[away ? "away_from" : "to"], away ? "away_from" : "to", false);
    if (target.kind == Target::Kind::Who && target.who == who)
    {
        Bad("an NPC can't turn to itself");
    }
    const bool hold = params::CheckBoolean(aParams, "hold").value_or(false);
    const auto v = RequireV(aOps);
    Command command;
    command.kind = "turn";
    command.target.kind = Target::Kind::Point;
    double goal = 0.0;
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        RequireDirected(npc);
        if (!npc.releasing.empty())
        {
            throw MethodError("npc_releasing", who + " is being released (" + npc.releasing + ")");
        }
        const auto there = Resolve(target, v);
        // The point to turn to: the target itself, or (away) the point opposite it, so the rotation doesn't depend on the
        // command's angleOffset semantics [hypothesis for angleOffset].
        const Vec3 from = npc.known ? npc.position : ToVec(v.value("position", json::array({0, 0, 0})));
        const double dx = there[0] - from[0], dy = there[1] - from[1];
        command.target.point = away ? Vec3{from[0] - dx, from[1] - dy, from[2]} : Vec3{there[0], there[1], from[2]};
        goal = YawTowards(away ? -dx : dx, away ? -dy : dy);
    }
    Send(who, command, aOps);
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, true);
    // The review's finding 4: the turn's AI command replaces any walk or follow the actor had, so its tracking goes too
    // (a walk given up for a turn must never report npc.arrived later).
    const auto replaced = npc.motion ? npc.motion->kind : std::string();
    Motion motion;
    motion.kind = "turn";
    motion.target = target;
    motion.maxS = 5.0;
    motion.yawGoal = goal;
    motion.hasYawGoal = true;
    motion.away = away;
    npc.motion = motion;
    if (hold)
    {
        npc.facing = Facing{target, away, 0.0};
    }
    else
    {
        npc.facing.reset();
    }
    json out{{"who", who}, {away ? "away_from" : "to", TargetJson(target)}, {"yaw_goal", std::round(goal * 10) / 10}, {"hold", hold}};
    if (!replaced.empty() && replaced != "turn")
    {
        out["replaced"] = replaced;
    }
    out["undo"] = hold ? Undo("npc.turn", {{"who", who}, {"off", true}}) : Undo("npc.stop", {{"who", who}});
    out["undo_note"] = hold ? "the undo stops holding the facing (the actor keeps facing where it faces); npc.turned follows each turn"
                            : "npc.stop ends the turn where it is; npc.turned follows when it faces there";
    return out;
}

json Service::Place(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.place", aParams);
    const auto who = RequireWho(aParams);
    const auto at = params::CheckPoint(aParams, "at");
    if (!at)
    {
        Bad("'at' is required: [x, y, z]");
    }
    Command command;
    command.kind = "place";
    command.target.kind = Target::Kind::Point;
    command.target.point = *at;
    if (const auto yaw = params::CheckNumber(aParams, "yaw", -360.0, 360.0))
    {
        command.yaw = *yaw;
        command.hasYaw = true;
    }
    const auto v = RequireV(aOps);
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        RequireDirected(npc);
        if (!npc.releasing.empty())
        {
            throw MethodError("npc_releasing", who + " is being released (" + npc.releasing + ")");
        }
        CheckRange(*at, v);
    }
    // The review's finding 3: the teleport itself makes no navigation test, so the spot is snapped to walkable, streamed ground
    // within 2 m first (the spawn's own rule); a point under the street or in the air is refused, never used as given.
    const auto ground = aOps.ground ? aOps.ground(*at) : json{{"walkable", false}, {"streamed", false}};
    if (!ground.value("streamed", false))
    {
        throw MethodError("not_streamed", "the world around that place isn't loaded (no walkable ground streamed in)");
    }
    if (!ground.value("walkable", false) || !ground.contains("point"))
    {
        throw MethodError("not_walkable", "there is no walkable ground within 2 m of that place");
    }
    const auto spot = ToVec(ground["point"]);
    {
        std::scoped_lock _(m_mutex);
        CheckRange(spot, v);
    }
    command.target.point = spot;
    auto step = Send(who, command, aOps);
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        npc.motion.reset(); // the review's finding 4: a placement replaces any walk, follow or turn the game was given
        npc.position = spot;
        npc.known = true;
    }
    json out{{"who", who}, {"at", json::array({spot[0], spot[1], spot[2]})}, {"asked_at", json::array({(*at)[0], (*at)[1], (*at)[2]})}};
    if (step.contains("before") && step["before"].contains("position"))
    {
        json back{{"who", who}, {"at", step["before"]["position"]}};
        if (step["before"].contains("yaw"))
        {
            back["yaw"] = step["before"]["yaw"];
        }
        out["before"] = step["before"];
        out["undo"] = Undo("npc.place", back);
        out["undo_note"] = "the undo places the actor back where it stood";
    }
    else
    {
        out["undo"] = nullptr;
        out["undo_note"] = "the game didn't report where the actor stood, so there is no way back but npc_release";
    }
    return out;
}

// 0.8.11 (the Sol review, finding 2): every command the script receives clears the facing target an earlier move left, unless the
// command is a move that sets its own, so the native flag that asks for the tick's clearing stop follows it (a stop sent after a
// placement would cancel the teleport).
json Service::Send(const std::string& aWho, const Command& aCommand, const Ops& aOps)
{
    auto step = aOps.command(aWho, aCommand);
    std::scoped_lock _(m_mutex);
    const auto it = m_npcs.find(aWho);
    if (it != m_npcs.end() && !(aCommand.kind == "move" && aCommand.faceV))
    {
        it->second.facingSet = false;
    }
    return step;
}

json Service::Stop(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.stop", aParams);
    const auto who = RequireWho(aParams);
    {
        std::scoped_lock _(m_mutex);
        if (Ours(who, true).releasing == "walk_away")
        {
            throw MethodError("npc_releasing", who + " is walking away to be released; npc_release with despawn removes it at once");
        }
    }
    Command command;
    command.kind = "stop";
    json step = json::object();
    try
    {
        step = Send(who, command, aOps);
    }
    catch (const MethodError& e)
    {
        if (e.code != "npc_lost")
        {
            throw;
        }
    }
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, true);
    const auto had = npc.motion ? npc.motion->kind : std::string();
    npc.motion.reset();
    json gesture = nullptr;
    if (!npc.gesture.empty())
    {
        gesture = npc.gesture;
    }
    return json{{"who", who}, {"stopped", had.empty() ? json(nullptr) : json(had)}, {"undo", nullptr}, {"undo_note", "nothing to undo: the actor holds its place"}};
}

json Service::Say(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.say", aParams);
    // Without who, a voice with no body: a line with a speaker's name and no NPC (someone speaking to V from elsewhere).
    const bool voice = !aParams.contains("who");
    const auto who = voice ? std::string() : RequireWho(aParams);
    const auto speakerParam = params::CheckText(aParams, "speaker", kMaxTitleChars * 4);
    if (voice && !aParams.contains("hide") && !speakerParam)
    {
        Bad("give who (an NPC's handle) or speaker (the name of a voice with no body)");
    }
    if (aParams.contains("hide"))
    {
        // The undo of a line: hide it by its id.
        const auto hide = RequireText(aParams, "hide", 12);
        if (hide.size() < 2 || hide[0] != 'l')
        {
            Bad("'hide' must be a line's id from npc_say (l1, l2, ...)");
        }
        const auto number = static_cast<int32_t>(std::strtol(hide.c_str() + 1, nullptr, 10));
        if (!voice)
        {
            std::scoped_lock _(m_mutex);
            Ours(who, false);
        }
        aOps.hide(who, number);
        std::scoped_lock _(m_mutex);
        if (voice)
        {
            m_voice.erase(std::remove_if(m_voice.begin(), m_voice.end(), [&](const VoiceLine& l) { return l.number == number; }), m_voice.end());
        }
        else
        {
            auto& npc = Ours(who, false);
            npc.lines.erase(std::remove_if(npc.lines.begin(), npc.lines.end(), [&](const LineHeld& l) { return l.number == number; }), npc.lines.end());
        }
        return json{{"who", voice ? json(nullptr) : json(who)}, {"hidden", hide}, {"undo", nullptr}, {"undo_note", "nothing to undo"}};
    }
    Line line;
    line.voice = voice;
    const auto text = params::CheckText(aParams, "text", kMaxLineChars * 4);
    if (text)
    {
        if (CountChars(*text) > kMaxLineChars)
        {
            throw MethodError("line_too_long", "a line is at most " + std::to_string(kMaxLineChars) + " characters; split it into two");
        }
        line.text = CleanMessageText(*text, kMaxLineChars);
    }
    if (const auto trigger = params::CheckText(aParams, "trigger", 32))
    {
        if (voice)
        {
            Bad("a voice with no body has no voice lines of its own: give text only");
        }
        const auto& triggers = VoiceTriggers();
        if (std::find(triggers.begin(), triggers.end(), *trigger) == triggers.end())
        {
            std::string names;
            for (const auto& t : triggers)
            {
                names += (names.empty() ? "" : ", ") + t;
            }
            throw MethodError("trigger_unknown", "'" + trigger->substr(0, 32) + "' isn't an allowed voice trigger; use one of " + names);
        }
        line.trigger = *trigger;
    }
    if (line.text.empty() && line.trigger.empty())
    {
        Bad(voice ? "give text: the line the voice says" : "give text (a line of up to 200 characters), trigger (a vanilla voice line), or both");
    }
    line.style = params::CheckText(aParams, "style", 16).value_or(voice ? "ownerless" : "subtitle");
    if (StyleLineType(line.style) < 0)
    {
        if (line.style == "holocall")
        {
            Bad("'holocall' is now call_subtitle: the game draws that line type as a plain subtitle with the speaker's name, never the holocall frame (that needs a real call)");
        }
        Bad("'style' must be subtitle, overhead, call_subtitle or ownerless");
    }
    if (voice && line.style == "overhead")
    {
        Bad("a voice with no body can't speak overhead: use ownerless (the default), call_subtitle or subtitle");
    }
    const double byLength = line.text.empty() ? 3.0 : std::clamp(1.5 + static_cast<double>(CountChars(line.text)) / 15.0, 2.0, 10.0);
    line.seconds = params::CheckNumber(aParams, "seconds", 1.0, 15.0).value_or(byLength);
    // 0.8.9 (session 15's NC1 redo: her lines played while she was nowhere near V): near_m refuses the line unless the NPC
    // stands within that many metres of V, so a scene's speech waits on a real arrival and fails early in plain words.
    const auto nearM = params::CheckNumber(aParams, "near_m", 0.5, kMaxRangeM);
    if (voice && nearM)
    {
        Bad("near_m is for an NPC's line (a voice with no body has no place)");
    }
    Vec3 vAt{};
    if (voice)
    {
        // A line on screen only: normal play, whatever V is doing.
        const auto v = aOps.v();
        const auto phase = v.value("phase", std::string("gameplay"));
        if (phase != "gameplay")
        {
            throw MethodError("not_in_world", "lines are shown in normal play only; the game is in '" + phase + "'");
        }
    }
    else
    {
        vAt = ToVec(RequireV(aOps).value("position", json::array({0, 0, 0})));
    }
    {
        std::scoped_lock _(m_mutex);
        if (voice)
        {
            line.speaker = CleanMessageText(*speakerParam, kMaxTitleChars);
        }
        else
        {
            auto& npc = Ours(who, false);
            RequireDirected(npc);
            if (nearM)
            {
                if (!npc.known)
                {
                    throw MethodError("too_far", "where " + who + " stands isn't known yet, so its line waits (near_m)");
                }
                const double d = Distance(npc.position, vAt);
                if (d > *nearM)
                {
                    char gap[160];
                    std::snprintf(gap, sizeof gap, " is %.1f m from V; this line needs it within %.1f m (near_m)", d, *nearM);
                    throw MethodError("too_far", who + gap);
                }
            }
            line.speaker = speakerParam ? CleanMessageText(*speakerParam, kMaxTitleChars) : npc.label.empty() ? "Stranger" : npc.label;
        }
        line.number = m_nextLine;
    }
    aOps.say(who, line);
    std::scoped_lock _(m_mutex);
    ++m_nextLine;
    if (voice)
    {
        m_voice.push_back({line.number, line.seconds, line.speaker});
    }
    else
    {
        Ours(who, false).lines.push_back({line.number, line.seconds, !line.text.empty()});
    }
    // 0.8.9 (session 15's NB2): the greeting comes with a smile unless a face is directed already (the script layer applies
    // it); it is held like npc.face's, so npc.status names it and npc.face {off} or the release ends it.
    bool smiled = false;
    if (!voice && line.trigger == "greeting")
    {
        auto& npc = Ours(who, false);
        if (npc.face.empty())
        {
            npc.face = "smile";
            npc.sinceFace = 0.0;
            npc.faceSends = 0;
            smiled = true;
        }
    }
    const auto id = "l" + std::to_string(line.number);
    json out{{"who", voice ? json(nullptr) : json(who)}, {"line", id}, {"seconds", line.seconds}, {"style", line.style}, {"speaker", line.speaker}};
    if (smiled)
    {
        out["face"] = "smile";
    }
    if (voice)
    {
        out["voice"] = true;
    }
    if (!line.trigger.empty())
    {
        out["trigger"] = line.trigger;
        out["trigger_note"] = "the NPC's own voice picks a line for that trigger; the words are the voice's, not ours";
    }
    json undoParams{{"hide", id}};
    if (!voice)
    {
        undoParams["who"] = who;
    }
    out["undo"] = line.text.empty() ? json(nullptr) : Undo("npc.say", undoParams);
    out["undo_note"] = line.text.empty() ? "a voice line can't be taken back once it plays" : "the undo hides the line; it hides by itself after seconds (npc.said)";
    return out;
}

json Service::Look(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.look", aParams);
    const auto who = RequireWho(aParams);
    const bool off = params::CheckBoolean(aParams, "off").value_or(false);
    Target at;
    if (!off)
    {
        if (!aParams.contains("at"))
        {
            Bad("give 'at' (\"v\", an NPC's handle or [x, y, z]) or off: true");
        }
        at = ParseTarget(aParams["at"], "at", false);
        if (at.kind == Target::Kind::Who && at.who == who)
        {
            Bad("an NPC can't look at itself");
        }
        RequireV(aOps);
    }
    std::optional<Target> before;
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, false);
        if (!off)
        {
            RequireDirected(npc);
        }
        before = npc.look;
        if (at.kind == Target::Kind::Who)
        {
            Ours(at.who, false);
        }
    }
    aOps.look(who, at, off);
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, false);
    if (off)
    {
        npc.look.reset();
    }
    else
    {
        npc.look = at;
    }
    json out{{"who", who}, {"looking", off ? json(nullptr) : TargetJson(at)}};
    if (off)
    {
        out["undo"] = before ? Undo("npc.look", {{"who", who}, {"at", TargetJson(*before)}}) : json(nullptr);
        out["undo_note"] = before ? "the undo looks at the earlier target again" : "nothing to undo";
    }
    else
    {
        out["undo"] = before ? Undo("npc.look", {{"who", who}, {"at", TargetJson(*before)}}) : Undo("npc.look", {{"who", who}, {"off", true}});
        out["undo_note"] = "the undo gives the gaze back (or to the earlier target)";
    }
    return out;
}

json Service::Face(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.face", aParams);
    const auto who = RequireWho(aParams);
    const bool off = params::CheckBoolean(aParams, "off").value_or(false);
    const Expression* expression = nullptr;
    if (!off)
    {
        const auto name = Lower(RequireText(aParams, "expression", 24));
        expression = FindExpression(name);
        if (!expression)
        {
            std::string names;
            for (const auto& e : Expressions())
            {
                names += (names.empty() ? "" : ", ") + e.name;
            }
            throw MethodError("expression_unknown", "'" + name + "' isn't an expression; use one of " + names);
        }
        RequireV(aOps);
    }
    std::string before;
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, false);
        if (!off)
        {
            RequireDirected(npc);
        }
        before = npc.face;
    }
    aOps.face(who, off ? 0 : expression->category, off ? 0 : expression->idle);
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, false);
    npc.face = off ? std::string() : expression->name;
    npc.sinceFace = 0.0;
    npc.faceSends = 0;
    json out{{"who", who}, {"expression", off ? json(nullptr) : json(expression->name)}};
    out["undo"] = before.empty() ? (off ? json(nullptr) : Undo("npc.face", {{"who", who}, {"off", true}})) : Undo("npc.face", {{"who", who}, {"expression", before}});
    out["undo_note"] = out["undo"].is_null() ? "nothing to undo" : "the undo gives the face back";
    return out;
}

json Service::Act(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.act", aParams);
    const auto who = RequireWho(aParams);
    const bool off = params::CheckBoolean(aParams, "off").value_or(false);
    const Gesture* gesture = nullptr;
    if (!off)
    {
        const auto name = Lower(RequireText(aParams, "gesture", 24));
        gesture = FindGesture(name);
        if (!gesture)
        {
            std::string names;
            for (const auto& g : Gestures())
            {
                names += (names.empty() ? "" : ", ") + g.name;
            }
            throw MethodError("gesture_unknown", "'" + name + "' isn't a gesture; use one of " + names);
        }
    }
    const double seconds = params::CheckNumber(aParams, "seconds", 0.5, 30.0).value_or(gesture ? gesture->seconds : 0.0);
    std::string clip;
    {
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        if (!off)
        {
            RequireDirected(npc);
        }
        if (!off)
        {
            if (npc.motion && npc.motion->kind != "turn")
            {
                throw MethodError("npc_moving", who + " is walking; npc_stop it or wait for npc.arrived before a gesture");
            }
            if (npc.rig == "woman_average")
            {
                clip = gesture->clipWoman;
            }
            else if (npc.rig == "man_average")
            {
                clip = gesture->clipMan;
            }
            else
            {
                throw MethodError("rig_unsupported", who + "'s body has no gesture clips in the XF carrier");
            }
        }
    }
    if (!off)
    {
        RequireV(aOps);
    }
    aOps.act(who, clip, off);
    std::scoped_lock _(m_mutex);
    auto& npc = Ours(who, true);
    npc.gesture = off ? std::string() : gesture->name;
    npc.gestureLeft = off ? 0.0 : seconds;
    json out{{"who", who}, {"gesture", off ? json(nullptr) : json(gesture->name)}};
    if (!off)
    {
        out["clip"] = clip;
        out["seconds"] = seconds;
    }
    out["undo"] = off ? json(nullptr) : Undo("npc.act", {{"who", who}, {"off", true}});
    out["undo_note"] = off ? "nothing to undo" : "the undo ends the gesture; it ends by itself after seconds (npc.act_done)";
    return out;
}

json Service::Choices(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.choices", aParams);
    if (aParams.contains("withdraw"))
    {
        const auto id = static_cast<int32_t>(params::CheckInteger(aParams, "withdraw", 1, 2147483647).value_or(0));
        Hub hub;
        {
            std::scoped_lock _(m_mutex);
            if (!m_hub || m_hub->hub.id != id)
            {
                return json{{"withdrawn", false}, {"why", "that hub isn't showing"}, {"undo", nullptr}};
            }
            hub = m_hub->hub;
        }
        aOps.hub(hub, false);
        {
            std::scoped_lock _(m_mutex);
            m_hub.reset();
        }
        Emit("npc.choice", "info", "The dialogue choices were withdrawn", {{"who", hub.who}, {"hub", hub.id}, {"withdrawn", true}});
        return json{{"withdrawn", true}, {"hub", id}, {"undo", nullptr}, {"undo_note", "nothing to undo"}};
    }
    const auto who = RequireWho(aParams);
    const auto choicesIt = aParams.find("choices");
    if (choicesIt == aParams.end() || !choicesIt->is_array() || choicesIt->size() < 2 || choicesIt->size() > 4)
    {
        Bad("'choices' must be a list of 2 to 4 short texts");
    }
    Hub hub;
    hub.who = who;
    for (const auto& choice : *choicesIt)
    {
        if (!choice.is_string() || choice.get<std::string>().empty())
        {
            Bad("each choice must be text");
        }
        const auto text = choice.get<std::string>();
        if (CountChars(text) > kMaxChoiceChars)
        {
            throw MethodError("choice_too_long", "a choice is at most " + std::to_string(kMaxChoiceChars) + " characters");
        }
        hub.choices.push_back(CleanMessageText(text, kMaxChoiceChars));
    }
    const double maxS = params::CheckNumber(aParams, "max_s", 5.0, kChoicesMaxS).value_or(kChoicesMaxS);
    const auto v = RequireV(aOps);
    {
        std::scoped_lock _(m_mutex);
        if (m_hub)
        {
            throw MethodError("one_hub_at_a_time", "hub " + std::to_string(m_hub->hub.id) + " is still showing; wait for its npc.choice or withdraw it");
        }
        auto& npc = Ours(who, false);
        RequireDirected(npc);
        hub.title = CleanMessageText(params::CheckText(aParams, "title", kMaxTitleChars * 4).value_or(npc.label.empty() ? "Stranger" : npc.label), kMaxTitleChars);
        if (npc.known)
        {
            const double d = Distance(npc.position, ToVec(v.value("position", json::array({0, 0, 0}))));
            if (d > kHubRangeM)
            {
                throw MethodError("too_far", "V is " + std::to_string(static_cast<int>(std::round(d))) + " m from " + who + "; dialogue choices show within 4 m");
            }
        }
        hub.id = kHubIdBase + m_nextHub;
    }
    aOps.hub(hub, true);
    std::scoped_lock _(m_mutex);
    ++m_nextHub;
    m_hub = HubHeld{hub, 0.0, maxS};
    return json{{"who", who}, {"hub", hub.id}, {"title", hub.title}, {"choices", hub.choices}, {"max_s", maxS},
                {"answer", "the player's pick arrives as an npc.choice event {hub, index, label}: session_wait with kinds [\"npc.choice\"]"},
                {"undo", Undo("npc.choices", {{"withdraw", hub.id}})}, {"undo_note", "the undo withdraws the choices; they go by themselves after max_s"}};
}

std::optional<Command> Service::TurnBeforeWalk(const Npc& aNpc, const Vec3& aToward, double& aGoal)
{
    if (!aNpc.known || !aNpc.yawKnown)
    {
        return std::nullopt;
    }
    const double dx = aToward[0] - aNpc.position[0], dy = aToward[1] - aNpc.position[1];
    if (std::abs(dx) + std::abs(dy) < 0.5)
    {
        return std::nullopt;
    }
    aGoal = YawTowards(dx, dy);
    if (std::abs(YawDifference(aNpc.yaw, aGoal)) <= kTurnFirstDeg)
    {
        return std::nullopt;
    }
    Command turn;
    turn.kind = "turn";
    turn.target.kind = Target::Kind::Point;
    turn.target.point = Vec3{aToward[0], aToward[1], aNpc.position[2]};
    return turn;
}

void Service::BeginWalk(Npc& aNpc, const Command& aWalk, const Vec3& aToward, Motion& aMotion, const Ops& aOps)
{
    // The game's own walks begin facing the way they go. The move command alone does not turn a standing actor to a way behind
    // it: session 16's actor, facing V, backed away from her for the whole walk. So the turn goes first, on the spot, and the
    // walk follows once she faces it (OnPoll), or after kTurnFirstMaxS.
    double goal = 0.0;
    const auto turn = TurnBeforeWalk(aNpc, aToward, goal);
    if (turn)
    {
        // A refusal of the turn (a lost actor, a closed gate) is the walk's refusal too.
        Send(aNpc.who, *turn, aOps);
        aMotion.pending = aWalk;
        aMotion.yawGoal = goal;
        aMotion.hasYawGoal = true;
        return;
    }
    Send(aNpc.who, aWalk, aOps);
}

json Service::StopHeld(Npc& aNpc, const Ops& aOps, bool aKeepLines)
{
    // Called with the mutex held (recursive); the Ops steps are the game's, each guarded so one failure doesn't stop the rest.
    json done = json::array();
    const auto guarded = [&](const char* aWhat, const std::function<void()>& aStep) {
        try
        {
            aStep();
            done.push_back(aWhat);
        }
        catch (const std::exception&)
        {
        }
    };
    if (m_hub && m_hub->hub.who == aNpc.who)
    {
        const auto hub = m_hub->hub;
        guarded("hub", [&] { aOps.hub(hub, false); });
        m_hub.reset();
        Emit("npc.choice", "info", "The dialogue choices were withdrawn", {{"who", aNpc.who}, {"hub", hub.id}, {"withdrawn", true}});
    }
    if (!aKeepLines)
    {
        for (const auto& line : aNpc.lines)
        {
            if (line.textShown)
            {
                guarded("line", [&] { aOps.hide(aNpc.who, line.number); });
            }
        }
        aNpc.lines.clear();
    }
    if (aNpc.look)
    {
        guarded("look", [&] { aOps.look(aNpc.who, Target{}, true); });
        aNpc.look.reset();
    }
    if (!aNpc.face.empty())
    {
        guarded("face", [&] { aOps.face(aNpc.who, 0, 0); });
        aNpc.face.clear();
    }
    if (!aNpc.gesture.empty())
    {
        guarded("gesture", [&] { aOps.act(aNpc.who, std::string(), true); });
        aNpc.gesture.clear();
    }
    if (aNpc.motion && aNpc.kind == "actor")
    {
        Command stop;
        stop.kind = "stop";
        guarded("command", [&] { Send(aNpc.who, stop, aOps); });
        aNpc.motion.reset();
    }
    return done;
}

void Service::ReleaseOne(const std::string& aWho, const std::string& aHow, const std::string& aReason, const Ops& aOps)
{
    std::scoped_lock _(m_mutex);
    const auto it = m_npcs.find(aWho);
    if (it == m_npcs.end())
    {
        return;
    }
    auto& npc = it->second;
    StopHeld(npc, aOps, false);
    try
    {
        aOps.release(aWho, npc.kind == "pick" ? "leave" : "despawn");
    }
    catch (const std::exception&)
    {
    }
    json data{{"who", aWho}, {"how", aHow}};
    if (!aReason.empty())
    {
        data["reason"] = aReason;
        Emit("npc.auto_released", "warn", aWho + " was released (" + aReason + ")", data);
    }
    Emit("npc.released", "done", aWho + " was released (" + aHow + ")", data);
    m_npcs.erase(it);
}

json Service::Release(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.release", aParams);
    const auto who = RequireWho(aParams, true);
    const auto how = params::CheckText(aParams, "how", 16);
    if (how && *how != "despawn" && *how != "walk_away" && *how != "leave" && *how != "dissolve")
    {
        Bad("'how' must be despawn, walk_away, dissolve or leave");
    }
    if ((aParams.contains("walk") || aParams.contains("distance_m")) && how.value_or("") != "dissolve")
    {
        Bad("walk and distance_m go with how: dissolve");
    }
    if (who == "all")
    {
        std::vector<std::string> whos;
        {
            std::scoped_lock _(m_mutex);
            for (const auto& [handle, _npc] : m_npcs)
            {
                whos.push_back(handle);
            }
        }
        for (const auto& handle : whos)
        {
            ReleaseOne(handle, handle[0] == 'p' ? "leave" : "despawn", "", aOps);
        }
        {
            std::scoped_lock _(m_mutex);
            if (m_hub)
            {
                const auto hub = m_hub->hub;
                try
                {
                    aOps.hub(hub, false);
                }
                catch (const std::exception&)
                {
                }
                m_hub.reset();
            }
        }
        HideVoices(aOps);
        return json{{"released", whos}, {"undo", nullptr}, {"undo_note", "nothing to undo"}};
    }
    std::string kind;
    {
        std::scoped_lock _(m_mutex);
        kind = Ours(who, false).kind;
    }
    const auto chosen = how.value_or(kind == "pick" ? "leave" : "despawn");
    if (kind == "pick" && chosen != "leave")
    {
        Bad(who + " is someone else's NPC: release it with how: leave (it goes back to its own AI)");
    }
    if (kind == "actor" && chosen == "leave")
    {
        Bad(who + " is an XF actor: release it with how: despawn, walk_away or dissolve");
    }
    if (chosen == "dissolve")
    {
        // V16: stop directing it now, walk it off (walk, the default) and despawn it only once V can't see it and it is at least
        // distance_m from her; with walk false it stays where it is until V walks away. No time limit: release it again with
        // despawn to remove it at once.
        const bool walk = params::CheckBoolean(aParams, "walk").value_or(true);
        const double distance = params::CheckNumber(aParams, "distance_m", 5.0, kMaxRangeM).value_or(kDissolveM);
        json v;
        try
        {
            v = aOps.v();
        }
        catch (const std::exception&)
        {
        }
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        if (npc.releasing == "dissolve")
        {
            return json{{"who", who}, {"how", "dissolve"}, {"already", true}, {"undo", nullptr}};
        }
        StopHeld(npc, aOps, false);
        npc.facing.reset();
        npc.releasing = "dissolve";
        npc.dissolveM = distance;
        npc.dissolveAge = 0.0;
        json out{{"who", who}, {"how", "dissolve"}, {"walk", walk}, {"distance_m", distance}};
        if (walk && !npc.handedBack && !npc.deadKept)
        {
            const auto vPos = ToVec(v.value("position", json::array({0, 0, 0})));
            const double d = HorizontalDistance(npc.position, vPos);
            Vec3 away = npc.known && d > 0.1
                            ? Vec3{vPos[0] + (npc.position[0] - vPos[0]) * (kDissolveWalkM / d), vPos[1] + (npc.position[1] - vPos[1]) * (kDissolveWalkM / d), npc.position[2]}
                            : OffsetPoint(npc.position, v.value("yaw", 0.0), kDissolveWalkM, 0.0);
            Command command;
            command.kind = "move";
            command.target.kind = Target::Kind::Point;
            command.target.point = away;
            command.distance = 1.0;
            try
            {
                Motion motion;
                motion.kind = "walk_away";
                motion.target = command.target;
                motion.point = away;
                motion.stopM = 1.5;
                motion.maxS = kWalkAwayMaxS * 3;
                BeginWalk(npc, command, away, motion, aOps);
                npc.motion = motion;
                out["to"] = json::array({away[0], away[1], away[2]});
                if (motion.pending)
                {
                    out["turns_first"] = true;
                }
            }
            catch (const std::exception&)
            {
                out["walk"] = false;
                out["note"] = "it couldn't walk off (no path), so it waits where it is until V can't see it";
            }
        }
        out["undo"] = nullptr;
        out["undo_note"] = "nothing to undo: npc.released follows once V can't see it and it is far enough from her; npc_release with despawn removes it at once";
        return out;
    }
    if (chosen == "walk_away")
    {
        // Stop what it holds, then walk 15 m away from V; the tick despawns it on arrival or after 20 s.
        json v;
        try
        {
            v = aOps.v();
        }
        catch (const std::exception&)
        {
        }
        std::scoped_lock _(m_mutex);
        auto& npc = Ours(who, true);
        if (!npc.releasing.empty())
        {
            return json{{"who", who}, {"how", "walk_away"}, {"already", true}, {"undo", nullptr}};
        }
        StopHeld(npc, aOps, true);
        const auto vPos = ToVec(v.value("position", json::array({0, 0, 0})));
        Vec3 away = npc.position;
        const double d = HorizontalDistance(npc.position, vPos);
        if (npc.known && d > 0.1)
        {
            const double scale = (d + kWalkAwayM) / d;
            away = {vPos[0] + (npc.position[0] - vPos[0]) * scale, vPos[1] + (npc.position[1] - vPos[1]) * scale, npc.position[2]};
        }
        else
        {
            away = OffsetPoint(npc.position, v.value("yaw", 0.0), kWalkAwayM, 0.0);
        }
        Command command;
        command.kind = "move";
        command.target.kind = Target::Kind::Point;
        command.target.point = away;
        command.distance = 1.0;
        bool walking = true;
        Motion motion;
        motion.kind = "walk_away";
        motion.target = command.target;
        motion.point = away;
        motion.stopM = 1.5;
        motion.maxS = kWalkAwayMaxS;
        try
        {
            // 0.8.10 (session 16's N3 and N5: backwards away from V): facing V when released, she turns to the way she is going first.
            npc.facing.reset();
            BeginWalk(npc, command, away, motion, aOps);
        }
        catch (const std::exception&)
        {
            walking = false;
        }
        if (!walking)
        {
            ReleaseOne(who, "despawn", "", aOps);
            return json{{"who", who}, {"how", "despawn"}, {"note", "it couldn't walk away (no path), so it was despawned"}, {"undo", nullptr}};
        }
        npc.motion = motion;
        npc.releasing = "walk_away";
        json released{{"who", who}, {"how", "walk_away"}, {"to", json::array({away[0], away[1], away[2]})},
                      {"undo", nullptr}, {"undo_note", "nothing to undo: npc.released follows when it has walked off and gone"}};
        if (motion.pending)
        {
            released["turns_first"] = true;
        }
        return released;
    }
    ReleaseOne(who, chosen, "", aOps);
    return json{{"who", who}, {"how", chosen}, {"undo", nullptr}, {"undo_note", "nothing to undo"}};
}

void Service::HideVoices(const Ops& aOps)
{
    std::vector<VoiceLine> voices;
    {
        std::scoped_lock _(m_mutex);
        voices.swap(m_voice);
    }
    for (const auto& line : voices)
    {
        try
        {
            aOps.hide(std::string(), line.number);
        }
        catch (const std::exception&)
        {
        }
    }
}

void Service::ReleaseEverything(const std::string& aReason, const Ops& aOps)
{
    // A voice with no body stays through a fight or a ride (only the actors go); anything that takes the game away from the
    // bridge (a handover, the pause, a story scene) takes its lines down too.
    if (aReason == "handover" || aReason == "paused" || aReason == "scene" || aReason == "not_v")
    {
        HideVoices(aOps);
    }
    std::vector<std::string> whos;
    {
        std::scoped_lock _(m_mutex);
        for (auto& [who, npc] : m_npcs)
        {
            // V15: a fight hands stand-ins back to their own AI (once) instead of removing them; they stay until released, the
            // kill switch, a handover or a load.
            if (aReason == "combat" && npc.StandsIn())
            {
                if (!npc.handedBack)
                {
                    HandBack(npc, aReason, aOps);
                }
                continue;
            }
            whos.push_back(who);
        }
    }
    for (const auto& who : whos)
    {
        ReleaseOne(who, who[0] == 'p' ? "leave" : "despawn", aReason, aOps);
    }
    std::scoped_lock _(m_mutex);
    if (m_hub)
    {
        try
        {
            aOps.hub(m_hub->hub, false);
        }
        catch (const std::exception&)
        {
        }
        Emit("npc.choice", "info", "The dialogue choices were withdrawn", {{"who", m_hub->hub.who}, {"hub", m_hub->hub.id}, {"withdrawn", true}, {"reason", aReason}});
        m_hub.reset();
    }
}

void Service::HandBack(Npc& aNpc, const std::string& aReason, const Ops& aOps)
{
    // Called with the mutex held. What the bridge holds on it is given back (a put-back step), its walk cancelled so its own AI
    // decides; the actor itself stays.
    RestoreScope restoring;
    const auto done = StopHeld(aNpc, aOps, false);
    aNpc.facing.reset();
    aNpc.handedBack = true;
    if (aNpc.releasing == "walk_away")
    {
        aNpc.releasing.clear(); // a walk off for the release is over; it fights or flees now
    }
    Emit("npc.handed_back", "warn", aNpc.who + " was handed back to its own AI (" + aReason + ")",
         {{"who", aNpc.who}, {"reason", aReason}, {"attitude", aNpc.attitude}, {"immortal", aNpc.immortal}, {"given_back", done}});
}

void Service::NoteHandoverRelease()
{
    std::scoped_lock _(m_mutex);
    if (m_handoverDone.is_null())
    {
        m_handoverDone = json{{"released", json::array()}, {"hub_withdrawn", false}, {"voice_lines_hidden", 0}};
    }
    for (const auto& [who, npc] : m_npcs)
    {
        m_handoverDone["released"].push_back(who);
    }
    if (m_hub)
    {
        m_handoverDone["hub_withdrawn"] = true;
    }
    m_handoverDone["voice_lines_hidden"] = m_handoverDone["voice_lines_hidden"].get<size_t>() + m_voice.size();
}

json Service::ReleaseAllNow(const std::string& aReason, const Ops& aOps)
{
    // The tick may have seen the handover's flag first and released already (its safety net): the answer says what this
    // handover released either way.
    if (Active())
    {
        RestoreScope restoring;
        NoteHandoverRelease();
        // A handover takes the voice lines down too, and keeps no stand-in (only a fight hands them back).
        ReleaseEverything(aReason, aOps);
    }
    std::scoped_lock _(m_mutex);
    json out = m_handoverDone.is_null() ? json{{"released", json::array()}, {"hub_withdrawn", false}, {"voice_lines_hidden", 0}} : m_handoverDone;
    m_handoverDone = nullptr;
    return out;
}

bool Service::Active() const
{
    std::scoped_lock _(m_mutex);
    return !m_npcs.empty() || m_hub.has_value() || !m_voice.empty();
}

json Service::Holds() const
{
    std::scoped_lock _(m_mutex);
    json out = json::array();
    const auto actors = ActorCount();
    if (actors > 0)
    {
        out.push_back(std::to_string(actors) + " XF actor(s) spawned by the bridge (npc_release all)");
    }
    return out;
}

void Service::DropAll(const std::string& aReason)
{
    std::vector<std::string> whos;
    {
        std::scoped_lock _(m_mutex);
        for (const auto& [who, npc] : m_npcs)
        {
            whos.push_back(who);
        }
        m_npcs.clear();
        m_hub.reset();
        m_voice.clear();
        m_sincePoll = 0.0;
    }
    for (const auto& who : whos)
    {
        Emit("npc.auto_released", "warn", who + " is gone (" + aReason + ")", {{"who", who}, {"reason", aReason}});
    }
}

json Service::RestoreAfterKill(const Ops& aOps)
{
    std::vector<std::string> whos;
    {
        std::scoped_lock _(m_mutex);
        for (const auto& [who, npc] : m_npcs)
        {
            whos.push_back(who);
        }
    }
    // One step in the game, whatever the bookkeeping says: the script's own registry knows what it holds.
    json out = aOps.releaseAll("kill");
    {
        std::scoped_lock _(m_mutex);
        m_npcs.clear();
        m_hub.reset();
        m_voice.clear(); // the script hides its voice lines in the same step
    }
    for (const auto& who : whos)
    {
        Emit("npc.auto_released", "warn", who + " was released (the kill switch)", {{"who", who}, {"reason", "kill"}});
    }
    out["forgotten"] = whos;
    return out;
}

void Service::Tick(double aDt, const TickInput& aInput, const Ops& aOps)
{
    {
        std::scoped_lock _(m_mutex);
        if (!m_detachesKnown)
        {
            m_detaches = aInput.detaches;
            m_detachesKnown = true;
        }
    }
    bool detached = false;
    {
        std::scoped_lock _(m_mutex);
        if (aInput.detaches != m_detaches)
        {
            m_detaches = aInput.detaches;
            detached = true;
        }
    }
    if (detached)
    {
        // A load: Codeware dropped every non-persistent entity with the world, and the script registry went with the session.
        DropAll("load");
        return;
    }
    if (!aInput.handedOver)
    {
        std::scoped_lock _(m_mutex);
        m_handoverDone = nullptr; // what a handover's tick released is reported by that handover only
    }
    if (aInput.killed || !aInput.gateOpen || !Active())
    {
        return; // the kill switch's restore releases; a closed gate waits
    }
    // Every game step the tick takes from here puts something back (a line hidden, a gesture ended, a hub withdrawn, a walk
    // stopped, a release), except a held facing's re-turn, which checks the write gate itself (TickInput::writesOpen).
    RestoreScope restoring;
    if (aInput.handedOver || aInput.paused)
    {
        if (aInput.handedOver)
        {
            NoteHandoverRelease();
        }
        ReleaseEverything(aInput.handedOver ? "handover" : "paused", aOps);
        return;
    }
    // Timers: lines, gestures, the hub's and each motion's limit.
    std::vector<std::pair<std::string, int32_t>> linesDone;
    std::vector<std::string> gesturesDone;
    std::vector<VoiceLine> voicesDone;
    bool hubTimedOut = false;
    bool poll = false;
    {
        std::scoped_lock _(m_mutex);
        for (auto& [who, npc] : m_npcs)
        {
            for (auto& line : npc.lines)
            {
                line.left -= aDt;
                if (line.left <= 0.0)
                {
                    linesDone.emplace_back(who, line.number);
                }
            }
            if (!npc.gesture.empty())
            {
                npc.gestureLeft -= aDt;
                if (npc.gestureLeft <= 0.0)
                {
                    gesturesDone.push_back(who);
                }
            }
            if (npc.motion)
            {
                npc.motion->age += aDt;
            }
            if (npc.facing)
            {
                npc.facing->sinceIssue += aDt;
            }
            if (!npc.face.empty())
            {
                npc.sinceFace += aDt;
            }
            if (!npc.spawned)
            {
                npc.sinceSpawn += aDt;
            }
            if (npc.releasing == "dissolve")
            {
                npc.dissolveAge += aDt;
            }
        }
        for (auto& line : m_voice)
        {
            line.left -= aDt;
            if (line.left <= 0.0)
            {
                voicesDone.push_back(line);
            }
        }
        if (!voicesDone.empty())
        {
            m_voice.erase(std::remove_if(m_voice.begin(), m_voice.end(), [](const VoiceLine& l) { return l.left <= 0.0; }), m_voice.end());
        }
        if (m_hub)
        {
            m_hub->age += aDt;
            hubTimedOut = m_hub->age >= m_hub->maxS;
        }
        m_sincePoll += aDt;
        if (m_sincePoll >= kPollSeconds)
        {
            m_sincePoll = 0.0;
            poll = true;
        }
    }
    for (const auto& [who, number] : linesDone)
    {
        bool shown = false;
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end())
            {
                continue;
            }
            auto& lines = it->second.lines;
            const auto line = std::find_if(lines.begin(), lines.end(), [&](const LineHeld& l) { return l.number == number; });
            if (line == lines.end())
            {
                continue;
            }
            shown = line->textShown;
            lines.erase(line);
        }
        if (shown)
        {
            try
            {
                aOps.hide(who, number);
            }
            catch (const std::exception&)
            {
            }
        }
        Emit("npc.said", "info", who + " finished a line", {{"who", who}, {"line", "l" + std::to_string(number)}});
    }
    for (const auto& line : voicesDone)
    {
        try
        {
            aOps.hide(std::string(), line.number);
        }
        catch (const std::exception&)
        {
        }
        Emit("npc.said", "info", line.speaker + " finished a line", {{"voice", true}, {"speaker", line.speaker}, {"line", "l" + std::to_string(line.number)}});
    }
    for (const auto& who : gesturesDone)
    {
        std::string gesture;
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end() || it->second.gesture.empty())
            {
                continue;
            }
            gesture = it->second.gesture;
            it->second.gesture.clear();
        }
        try
        {
            aOps.act(who, std::string(), true);
        }
        catch (const std::exception&)
        {
        }
        Emit("npc.act_done", "info", who + " finished a gesture", {{"who", who}, {"gesture", gesture}});
    }
    // The review's finding 5: a hub whose time is up is read once more first, so a pick made just before max_s counts.
    if (hubTimedOut)
    {
        poll = true;
    }
    if (poll)
    {
        std::string whos;
        bool any = false;
        {
            std::scoped_lock _(m_mutex);
            for (const auto& [who, npc] : m_npcs)
            {
                whos += (whos.empty() ? "" : ",") + who;
            }
            any = !whos.empty() || m_hub.has_value();
        }
        if (any)
        {
            json reading;
            bool read = false;
            try
            {
                reading = aOps.poll(whos);
                read = true;
            }
            catch (const std::exception&)
            {
                // the next poll tries again
            }
            if (read)
            {
                OnPoll(reading, aOps, aInput);
            }
        }
    }
    ExpireHub(aOps);
}

void Service::ExpireHub(const Ops& aOps)
{
    Hub hub;
    {
        std::scoped_lock _(m_mutex);
        if (!m_hub || m_hub->age < m_hub->maxS)
        {
            return;
        }
        hub = m_hub->hub;
        m_hub.reset();
    }
    try
    {
        aOps.hub(hub, false);
    }
    catch (const std::exception&)
    {
    }
    Emit("npc.choice", "info", "The player didn't choose in time", {{"who", hub.who}, {"hub", hub.id}, {"timeout", true}});
}

void Service::OnPoll(const json& aReading, const Ops& aOps, const TickInput& aInput)
{
    const auto camera = CameraFrom(aReading);
    const auto v = aReading.value("v", json::object());
    const auto vPos = ToVec(v.value("position", json::array({0, 0, 0})));
    const auto busy = v.value("busy", std::string());
    if (busy == "in_combat" || busy == "in_scene" || busy == "in_vehicle" || busy == "not_v")
    {
        ReleaseEverything(busy == "in_combat" ? "combat" : busy == "in_scene" ? "scene" : busy == "in_vehicle" ? "vehicle" : "not_v", aOps);
        if (busy != "in_combat" || !Active())
        {
            return;
        }
        // V15: in a fight only handed-back stand-ins are left; they are still watched (lost, died, dissolve).
    }
    std::vector<std::string> lost, died, spawnedNow, arrived, walkedAway, dissolved, toPrepare, toStartAct;
    std::vector<std::pair<std::string, std::string>> picksEnded;
    std::vector<std::pair<std::string, std::string>> failed, followEnded;
    std::vector<json> blocked, turned;
    std::vector<std::pair<std::string, Command>> holdTurns, startWalks;
    std::vector<std::pair<std::string, std::string>> refaces; // 0.8.11: who and the held face to send again
    std::vector<std::string> clearFacings;                    // 0.8.11: who is idle with a facing target left from a move
    {
        std::scoped_lock _(m_mutex);
        for (const auto& entry : aReading.value("npcs", json::array()))
        {
            const auto who = entry.value("who", std::string());
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end())
            {
                continue;
            }
            auto& npc = it->second;
            const bool exists = entry.value("exists", false);
            if (entry.contains("position") && exists)
            {
                npc.position = ToVec(entry["position"]);
                npc.known = true;
            }
            if (entry.contains("yaw") && exists && entry["yaw"].is_number())
            {
                npc.yaw = entry["yaw"].get<double>();
                npc.yawKnown = true;
            }
            if (npc.kind == "actor" && !npc.spawned)
            {
                if (entry.value("spawned", false) && exists)
                {
                    npc.spawned = true;
                    spawnedNow.push_back(who);
                }
                else if (npc.sinceSpawn > 20.0 && !npc.announced)
                {
                    npc.announced = true;
                    failed.emplace_back(who, "not_spawned");
                }
                continue;
            }
            if (!exists)
            {
                lost.push_back(who);
                continue;
            }
            // V16: dissolve: gone once it is far enough from V and out of her sight (it may still be walking off).
            if (npc.releasing == "dissolve" && npc.known && Distance(npc.position, vPos) >= npc.dissolveM && OutOfSight(camera, npc.position, aOps))
            {
                dissolved.push_back(who);
                continue;
            }
            if (entry.value("dead", false))
            {
                if (!npc.deadKept)
                {
                    died.push_back(who);
                }
                continue;
            }
            if (npc.handedBack || npc.deadKept)
            {
                continue; // its own AI has it; nothing to track but lost, died and dissolve
            }
            // The review's finding 1: a pick stays adopted only while it would still be picked (a plain passer-by, not busy,
            // not fighting, not protected); otherwise it is given back at once.
            if (npc.kind == "pick")
            {
                const auto pickBusy = entry.value("busy", std::string());
                if (!pickBusy.empty())
                {
                    picksEnded.emplace_back(who, "npc_busy");
                    continue;
                }
                if (entry.value("protected", false))
                {
                    picksEnded.emplace_back(who, "npc_protected");
                    continue;
                }
            }
            // The review's finding 2: an actor's first moment (its attitude, god mode) and a gesture's start change the game,
            // so the poll only reports them; they are sent below, each behind the write gate.
            if (npc.kind == "actor" && !entry.value("prepared", true))
            {
                toPrepare.push_back(who);
            }
            if (entry.value("gesture_ready", false))
            {
                toStartAct.push_back(who);
            }
            // 0.8.11: a held face is sent again on a schedule after attitude preparation; this does not test animation readiness.
            if (!npc.face.empty() && !npc.handedBack && exists && (npc.kind != "actor" || entry.value("prepared", true)))
            {
                const double due = npc.faceSends == 0 ? kFaceFirstS : npc.faceSends == 1 ? kFaceSecondS : kFaceSteadyS;
                if (npc.sinceFace >= due)
                {
                    npc.sinceFace = 0.0;
                    ++npc.faceSends;
                    refaces.emplace_back(who, npc.face);
                }
            }
            if (!npc.motion)
            {
                if (npc.facingSet)
                {
                    npc.facingSet = false;
                    clearFacings.push_back(who);
                }
                // A held facing (npc.turn hold): turned back when it drifts, including after a walk ends.
                if (npc.facing && npc.known && npc.yawKnown && npc.facing->sinceIssue >= kFacingReissueS)
                {
                    Vec3 there = npc.facing->target.point;
                    bool have = npc.facing->target.kind == Target::Kind::Point;
                    if (npc.facing->target.kind == Target::Kind::V)
                    {
                        there = vPos;
                        have = true;
                    }
                    else if (npc.facing->target.kind == Target::Kind::Who)
                    {
                        const auto other = m_npcs.find(npc.facing->target.who);
                        if (other != m_npcs.end() && other->second.known)
                        {
                            there = other->second.position;
                            have = true;
                        }
                    }
                    const double dx = there[0] - npc.position[0], dy = there[1] - npc.position[1];
                    if (have && std::abs(dx) + std::abs(dy) > 0.05)
                    {
                        const bool away = npc.facing->away;
                        const double goal = YawTowards(away ? -dx : dx, away ? -dy : dy);
                        if (std::abs(YawDifference(npc.yaw, goal)) > kFacingToleranceDeg)
                        {
                            Command turn;
                            turn.kind = "turn";
                            turn.target.kind = Target::Kind::Point;
                            turn.target.point = away ? Vec3{npc.position[0] - dx, npc.position[1] - dy, npc.position[2]} : Vec3{there[0], there[1], npc.position[2]};
                            holdTurns.emplace_back(who, turn);
                            npc.facing->sinceIssue = 0.0;
                            Motion motion;
                            motion.kind = "turn";
                            motion.target = npc.facing->target;
                            motion.maxS = 5.0;
                            motion.yawGoal = goal;
                            motion.hasYawGoal = true;
                            motion.away = away;
                            motion.fromHold = true;
                            npc.motion = motion;
                        }
                    }
                }
                continue;
            }
            auto& motion = *npc.motion;
            const auto state = entry.value("command_state", std::string());
            motion.lastState = state;
            if (motion.pending)
            {
                // 0.8.10: the turn on the spot before a walk: the walk goes out once she faces her way (or the turn ended, or it took too long).
                const bool faced = npc.yawKnown && std::abs(YawDifference(npc.yaw, motion.yawGoal)) <= kTurnedToleranceDeg;
                const bool ended = state == "Success" || state == "Failure" || state == "Cancelled" || state == "Interrupted";
                if (faced || ended || motion.age >= kTurnFirstMaxS)
                {
                    startWalks.emplace_back(who, *motion.pending);
                    motion.pending.reset();
                    motion.age = 0.0;
                    motion.lastAge = 0.0;
                    motion.sinceProgress = 0.0;
                    motion.bestDistance = 1e9;
                    motion.blockedSent = false;
                }
                continue;
            }
            if (motion.kind == "move" || motion.kind == "walk_away")
            {
                Vec3 target = motion.point;
                if (motion.target.kind == Target::Kind::V)
                {
                    target = vPos;
                }
                else if (motion.target.kind == Target::Kind::Who)
                {
                    const auto other = m_npcs.find(motion.target.who);
                    if (other != m_npcs.end() && other->second.known)
                    {
                        target = other->second.position;
                    }
                }
                const double d = HorizontalDistance(npc.position, target);
                const bool near = d <= motion.stopM + kArriveSlackM;
                // Progress: a walk that gains less than kProgressM for kBlockedAfterS is blocked (once per stall).
                if (d < motion.bestDistance - kProgressM)
                {
                    motion.bestDistance = d;
                    motion.sinceProgress = 0.0;
                    motion.blockedSent = false;
                }
                else
                {
                    motion.sinceProgress += motion.age - motion.lastAge;
                }
                motion.lastAge = motion.age;
                if (!near && state != "Success" && motion.sinceProgress >= kBlockedAfterS && !motion.blockedSent)
                {
                    motion.blockedSent = true;
                    blocked.push_back({{"who", who}, {"reason", "stuck"}, {"distance_m", std::round(d * 100) / 100}, {"walking", motion.kind}});
                }
                if (near || state == "Success")
                {
                    (motion.kind == "walk_away" ? walkedAway : arrived).push_back(who);
                }
                else if (state == "Failure" || state == "Cancelled" || state == "Interrupted")
                {
                    if (motion.kind == "walk_away")
                    {
                        walkedAway.push_back(who);
                    }
                    else
                    {
                        failed.emplace_back(who, state);
                        blocked.push_back({{"who", who}, {"reason", state == "Failure" ? "no_path" : "interrupted"}, {"state", state}, {"final", true}});
                    }
                }
                else if (motion.age >= motion.maxS)
                {
                    if (motion.kind == "walk_away")
                    {
                        walkedAway.push_back(who);
                    }
                    else
                    {
                        failed.emplace_back(who, "timeout");
                    }
                }
            }
            else if (motion.kind == "follow")
            {
                if (state == "Failure" || state == "Cancelled" || state == "Interrupted")
                {
                    followEnded.emplace_back(who, state);
                }
                else if (motion.age >= motion.maxS)
                {
                    followEnded.emplace_back(who, "max_s");
                }
            }
            else if (motion.kind == "turn")
            {
                const bool faced = motion.hasYawGoal && npc.yawKnown && std::abs(YawDifference(npc.yaw, motion.yawGoal)) <= kTurnedToleranceDeg;
                const bool ended = state == "Success" || state == "Failure" || state == "Cancelled" || state == "Interrupted" || motion.age >= motion.maxS;
                if (faced || ended)
                {
                    turned.push_back({{"who", who}, {"yaw", std::round(npc.yaw * 10) / 10}, {"yaw_goal", std::round(motion.yawGoal * 10) / 10}, {"away", motion.away},
                                      {"hold", npc.facing.has_value()}, {"reached", faced || state == "Success"}, {"again", motion.fromHold}});
                    npc.motion.reset();
                }
            }
        }
    }
    const auto gateOpen = [&aInput] { return !aInput.writesOpen || aInput.writesOpen(); };
    for (const auto& who : toPrepare)
    {
        if (!aOps.prepare || !gateOpen())
        {
            continue; // the next poll asks again while it is unprepared
        }
        try
        {
            aOps.prepare(who);
        }
        catch (const std::exception&)
        {
        }
    }
    for (const auto& who : toStartAct)
    {
        if (!aOps.startAct || !gateOpen())
        {
            continue;
        }
        try
        {
            aOps.startAct(who);
        }
        catch (const std::exception&)
        {
        }
    }
    for (const auto& [who, why] : picksEnded)
    {
        ReleaseOne(who, "leave", why, aOps);
    }
    for (const auto& who : clearFacings)
    {
        // 0.8.11: the move ended with a facing target set; a stop command clears it (the script side clears it with every command).
        try
        {
            if (aInput.writesOpen && !aInput.writesOpen())
            {
                throw MethodError("writes_closed", "the write gate closed before the facing target was cleared");
            }
            Command stop;
            stop.kind = "stop";
            Send(who, stop, aOps);
        }
        catch (const std::exception&)
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end())
            {
                it->second.facingSet = true; // asked again on the next poll
            }
        }
    }
    for (const auto& [who, name] : refaces)
    {
        const auto* expression = FindExpression(name);
        if (!expression || !aOps.face)
        {
            continue;
        }
        try
        {
            if (aInput.writesOpen && !aInput.writesOpen())
            {
                throw MethodError("writes_closed", "the write gate closed before the face was sent again");
            }
            aOps.face(who, expression->category, expression->idle);
        }
        catch (const std::exception&)
        {
        }
    }
    for (const auto& [who, turn] : holdTurns)
    {
        try
        {
            if (aInput.writesOpen && !aInput.writesOpen())
            {
                throw MethodError("writes_closed", "the write gate closed before the re-turn");
            }
            Send(who, turn, aOps);
        }
        catch (const std::exception&)
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end())
            {
                it->second.motion.reset();
            }
        }
    }
    for (const auto& [who, walk] : startWalks)
    {
        try
        {
            if (aInput.writesOpen && !aInput.writesOpen())
            {
                throw MethodError("writes_closed", "the write gate closed before the walk");
            }
            Send(who, walk, aOps);
        }
        catch (const std::exception&)
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end() && it->second.motion)
            {
                if (it->second.motion->kind == "walk_away")
                {
                    walkedAway.push_back(who);
                }
                else
                {
                    failed.emplace_back(who, "no_path");
                }
                it->second.motion.reset();
            }
        }
    }
    for (const auto& data : turned)
    {
        Emit("npc.turned", "info", data.value("who", std::string()) + (data.value("reached", false) ? " faces its mark" : " stopped turning"), data);
    }
    for (const auto& data : blocked)
    {
        Emit("npc.blocked", "warn", data.value("who", std::string()) + " is blocked (" + data.value("reason", std::string()) + ")", data);
    }
    for (const auto& who : spawnedNow)
    {
        json data{{"who", who}};
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end())
            {
                data["position"] = json::array({it->second.position[0], it->second.position[1], it->second.position[2]});
                data["cast"] = it->second.cast;
                data["distance_v"] = std::round(Distance(it->second.position, vPos) * 100) / 100;
            }
        }
        Emit("npc.spawned", "done", who + " appeared", data);
    }
    for (const auto& who : arrived)
    {
        double d = 0.0;
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end())
            {
                continue;
            }
            d = Distance(it->second.position, vPos);
            it->second.motion.reset();
        }
        Emit("npc.arrived", "done", who + " arrived", {{"who", who}, {"distance_v", std::round(d * 100) / 100}});
    }
    for (const auto& [who, state] : failed)
    {
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end() && it->second.motion)
            {
                Command stop;
                stop.kind = "stop";
                try
                {
                    Send(who, stop, aOps);
                }
                catch (const std::exception&)
                {
                }
                it->second.motion.reset();
            }
        }
        Emit("npc.move_failed", "warn", who + " didn't get there (" + state + ")", {{"who", who}, {"state", state}});
    }
    for (const auto& [who, why] : followEnded)
    {
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end())
            {
                Command stop;
                stop.kind = "stop";
                try
                {
                    Send(who, stop, aOps);
                }
                catch (const std::exception&)
                {
                }
                it->second.motion.reset();
            }
        }
        Emit("npc.follow_ended", "info", who + " stopped following (" + why + ")", {{"who", who}, {"why", why}});
    }
    for (const auto& who : walkedAway)
    {
        bool dissolving = false;
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it != m_npcs.end() && it->second.releasing == "dissolve")
            {
                dissolving = true;
                Command stop;
                stop.kind = "stop";
                try
                {
                    Send(who, stop, aOps);
                }
                catch (const std::exception&)
                {
                }
                it->second.motion.reset();
            }
        }
        if (!dissolving)
        {
            ReleaseOne(who, "walk_away", "", aOps);
        }
    }
    for (const auto& who : dissolved)
    {
        double waited = 0.0;
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end())
            {
                continue;
            }
            waited = std::round(it->second.dissolveAge * 10) / 10;
        }
        ReleaseOne(who, "dissolve", "", aOps);
        Emit("npc.dissolved", "done", who + " was out of V's sight and was removed", {{"who", who}, {"waited_s", waited}});
    }
    for (const auto& who : lost)
    {
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end())
            {
                continue;
            }
            if (m_hub && m_hub->hub.who == who)
            {
                try
                {
                    aOps.hub(m_hub->hub, false);
                }
                catch (const std::exception&)
                {
                }
                m_hub.reset();
            }
            try
            {
                aOps.release(who, it->second.kind == "pick" ? "leave" : "despawn");
            }
            catch (const std::exception&)
            {
            }
            m_npcs.erase(it);
        }
        Emit("npc.lost", "warn", who + " is gone (streamed out or removed by the game)", {{"who", who}});
    }
    for (const auto& who : died)
    {
        bool keep = false;
        {
            std::scoped_lock _(m_mutex);
            const auto it = m_npcs.find(who);
            if (it == m_npcs.end())
            {
                continue;
            }
            auto& npc = it->second;
            if (npc.kind == "actor" && !npc.immortal)
            {
                // V15: shooting a mortal stand-in isn't a bug: its body stays (npc_release, or dissolve once V can't see it).
                keep = true;
                StopHeld(npc, aOps, false);
                npc.facing.reset();
                npc.deadKept = true;
                if (npc.releasing == "walk_away")
                {
                    npc.releasing.clear();
                }
            }
        }
        Emit("npc.died", "warn", who + " died", {{"who", who}, {"kept_body", keep}});
        if (!keep)
        {
            ReleaseOne(who, who[0] == 'p' ? "leave" : "despawn", "died", aOps);
        }
    }
    // The hub: an answer, or V walked away.
    const auto hub = aReading.value("hub", json::object());
    std::optional<Hub> answered;
    int32_t index = -1;
    bool walkedOff = false;
    bool gameTook = false;
    {
        std::scoped_lock _(m_mutex);
        if (m_hub)
        {
            const bool same = hub.value("id", 0) == m_hub->hub.id;
            index = same ? hub.value("answer", -1) : -1;
            if (index >= 0 && index < static_cast<int32_t>(m_hub->hub.choices.size()))
            {
                answered = m_hub->hub;
                m_hub.reset();
            }
            else if (same && hub.value("withdrawn", std::string()) == "busy")
            {
                // The review's finding 8: a door or device prompt, or the game's own dialogue, came up while ours showed; the
                // game's comes first, so ours was withdrawn.
                answered = m_hub->hub;
                gameTook = true;
                m_hub.reset();
            }
            else
            {
                const auto it = m_npcs.find(m_hub->hub.who);
                if (it != m_npcs.end() && it->second.known && Distance(it->second.position, vPos) > kHubLeaveM)
                {
                    answered = m_hub->hub;
                    walkedOff = true;
                    m_hub.reset();
                }
            }
        }
    }
    if (answered && gameTook)
    {
        try
        {
            aOps.hub(*answered, false);
        }
        catch (const std::exception&)
        {
        }
        Emit("npc.choice", "warn", "The game showed its own prompt or dialogue, so the choices were withdrawn",
             {{"who", answered->who}, {"hub", answered->id}, {"withdrawn", true}, {"reason", "choices_busy"}});
    }
    else if (answered && walkedOff)
    {
        try
        {
            aOps.hub(*answered, false);
        }
        catch (const std::exception&)
        {
        }
        Emit("npc.choice", "warn", "V walked away from the dialogue choices", {{"who", answered->who}, {"hub", answered->id}, {"walked_away", true}});
    }
    else if (answered)
    {
        try
        {
            aOps.hub(*answered, false);
        }
        catch (const std::exception&)
        {
        }
        const auto label = answered->choices[static_cast<size_t>(index)];
        Emit("npc.choice", "ask", "The player chose: " + label, {{"who", answered->who}, {"hub", answered->id}, {"index", index}, {"label", label}});
    }
}
void RegisterMethods(Dispatcher& aDispatcher, Service& aService, std::function<Ops(const std::string& aCid)> aOpsFor,
                     std::function<MethodSpec(MethodSpec)> aMarkWrite)
{
    using Fn = json (Service::*)(const json&, const Ops&);
    auto* service = &aService;
    const auto bound = [service, aOpsFor](Fn aFn) {
        return [service, aOpsFor, aFn](const MethodContext& aContext) { return (service->*aFn)(aContext.params, aOpsFor(aContext.cid)); };
    };
    aDispatcher.Register({"npc.list", Access::Read, RunOn::GameThread, "NPCs near V, with who may be directed.", bound(&Service::List)});
    aDispatcher.Register({"npc.pick", Access::Read, RunOn::GameThread, "Adopts an unprotected NPC near V for look, face and say.", bound(&Service::Pick)});
    aDispatcher.Register({"npc.status", Access::Read, RunOn::GameThread, "The session's actors, picks, lines and dialogue choices.",
                          [service](const MethodContext& aContext) { return service->Status(aContext.params); }});
    // Written as {name, access, summary, fn} so the tools' catalogue test reads each access class from this source.
    const std::vector<std::tuple<const char*, Access, const char*, Fn>> writes{
        {"npc.spawn", Access::WriteNpc, "Spawns an XF actor near V (never saved).", &Service::Spawn},
        {"npc.move", Access::WriteNpc, "Walks or runs an actor to V, another NPC or a point.", &Service::Move},
        {"npc.follow", Access::WriteNpc, "An actor follows V or another NPC.", &Service::Follow},
        {"npc.turn", Access::WriteNpc, "Turns an actor to face V, an NPC or a point.", &Service::Turn},
        {"npc.place", Access::WriteNpc, "Places an actor at a point (staging).", &Service::Place},
        {"npc.stop", Access::WriteNpc, "Stops an actor's walk, follow or turn.", &Service::Stop},
        {"npc.say", Access::WriteNpc, "A line of text and/or a vanilla voice line from an NPC.", &Service::Say},
        {"npc.look", Access::WriteNpc, "An NPC looks at V, an NPC or a point, or stops looking.", &Service::Look},
        {"npc.face", Access::WriteNpc, "Sets or resets an NPC's facial expression.", &Service::Face},
        {"npc.act", Access::WriteNpc, "Plays or ends a body gesture on an actor.", &Service::Act},
        {"npc.choices", Access::WriteNpc, "Offers V dialogue choices in the game's own widget.", &Service::Choices},
        {"npc.release", Access::WriteNpc, "Ends an actor or a pick.", &Service::Release},
    };
    for (const auto& [name, access, summary, fn] : writes)
    {
        aDispatcher.Register(aMarkWrite(MethodSpec{name, access, RunOn::GameThread, summary, bound(fn)}));
    }
}
} // namespace xfb::npc
