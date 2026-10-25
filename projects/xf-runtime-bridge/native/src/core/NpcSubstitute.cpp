// Bridge 0.8.19: npc.substitute (Story Engine requirement V17, route (a); research/story-engine/probes/v17-crowd-substitution.md).
// A person of the game's street crowd is replaced by an XF actor with the same look, standing where they stood and facing the
// way they faced. Game-independent, like the rest of core/Npc: the game steps are Ops (redscript/XFRuntimeBridgeNpc.reds).
//
// Why a clone and not the crowd person's own record. A crowd record is a lane walker (isCrowd true): spawned as itself it
// would join the traffic lanes, be recycled by the crowd system and not obey commands. The XF casts are TweakXL clones of the
// base game's civilian records with isCrowd false (tweaks/test-profile/xf_npc_actors.yaml), which take commands [runtime:
// session 15]. So the nearest cast stands in, wearing the original's appearance name; whether the template has that name is
// settled in the game, and the report says what it found.
//
// The swap order. The original is held still (the game's own stop levers on a crowd member), the actor is requested at its
// spot, and only when the actor exists is the original removed, so V never sees an empty spot. The request waits for a moment V
// cannot see the original (outside her view, or behind static geometry: the same test npc.release's dissolve uses); an
// original that stays in view is waited for, not touched.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <regex>

#include "core/Dispatcher.hpp"
#include "core/Events.hpp"
#include "core/Npc.hpp"
#include "core/Params.hpp"

namespace xfb::npc
{
namespace
{
[[noreturn]] void Bad(const std::string& aMessage)
{
    params::CheckFail(aMessage);
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

json Arr(const Vec3& aV)
{
    return json::array({aV[0], aV[1], aV[2]});
}

std::string Lower(std::string aText)
{
    std::transform(aText.begin(), aText.end(), aText.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return aText;
}

bool Has(const std::string& aHay, const char* aNeedle)
{
    return aHay.find(aNeedle) != std::string::npos;
}

bool EndsWith(const std::string& aText, const char* aSuffix)
{
    const std::string suffix(aSuffix);
    return aText.size() >= suffix.size() && aText.compare(aText.size() - suffix.size(), suffix.size(), suffix) == 0;
}

// 'F', 'M' or '?': from the game's own gender and body type first, then from the template-style names in the record and the
// appearance ("_wa" / "_ma", Woman / Man / Male in the record names).
char GenderOf(const OriginalLook& aLook)
{
    const auto fromGame = Lower(aLook.gender + " " + aLook.bodyType);
    if (Has(fromGame, "female") || Has(fromGame, "woman"))
    {
        return 'F';
    }
    if (Has(fromGame, "male") || Has(fromGame, "man"))
    {
        return 'M';
    }
    const auto record = Lower(aLook.record);
    const auto text = Lower(aLook.appearance) + " " + record;
    if (Has(text, "_wa") || Has(text, "woman") || Has(text, "female"))
    {
        return 'F';
    }
    if (Has(text, "_ma") || Has(text, "male") || EndsWith(record, "man") || Has(text, "_man"))
    {
        return 'M';
    }
    return '?';
}

// The base-game civilian families the XF casts clone. exactMan / exactWoman: the cast really is that family's body for that
// gender (a family with no cast of one gender borrows the nearest, which is an approximation).
struct Family
{
    const char* token;
    const char* woman;
    const char* man;
    bool exactWoman;
    bool exactMan;
};
const std::vector<Family>& Families()
{
    static const std::vector<Family> families{
        {"creole", "woman_masked", "man_lowlife", true, false},
        {"corpo", "woman_corpo", "man_corpo", true, true},
        {"nightlife", "woman_nightlife", "man_youngster", true, false},
        {"youngster", "woman_nightlife", "man_youngster", false, true},
        {"king_of_the_stoop", "woman_lowlife", "man_lowlife", true, true},
        {"lowlife", "woman_lowlife", "man_lowlife", true, true},
    };
    return families;
}

// The vanilla record each civilian cast is a clone of (xf_npc_actors.yaml $base).
const char* BaseRecordOf(const std::string& aCast)
{
    if (aCast == "woman_corpo") return "Character.CorpoWoman";
    if (aCast == "man_corpo") return "Character.CorpoMan";
    if (aCast == "woman_nightlife") return "Character.NightlifeWoman";
    if (aCast == "man_youngster") return "Character.YoungsterMale";
    if (aCast == "woman_lowlife") return "Character.LowlifeWoman";
    if (aCast == "man_lowlife") return "Character.LowlifeMale";
    if (aCast == "woman_masked") return "Character.CreoleWoman";
    if (aCast == "man_masked") return "Character.LowlifeMale";
    return "";
}

std::string Quantised(double aValue)
{
    double r = std::round(aValue * 10.0) / 10.0;
    if (r == 0.0)
    {
        r = 0.0; // no negative zero
    }
    char buffer[40];
    std::snprintf(buffer, sizeof buffer, "%.1f", r);
    return buffer;
}

std::string Safe(const std::string& aText)
{
    std::string out;
    for (const char c : aText)
    {
        out += (std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '.' || c == '-') ? c : '_';
    }
    return out;
}

bool IsPickHandle(const std::string& aText)
{
    static const std::regex pattern("^p[0-9]{1,5}$");
    return std::regex_match(aText, pattern);
}

json Undo(const std::string& aMethod, json aParams)
{
    return json{{"method", aMethod}, {"params", std::move(aParams)}};
}

json LookJson(const OriginalLook& aLook)
{
    json out{{"entity", aLook.entity},       {"record", aLook.record},         {"class", aLook.className},
             {"appearance", aLook.appearance}, {"colour_variant", aLook.variant}, {"gender", aLook.gender},
             {"body_type", aLook.bodyType},  {"crowd", aLook.crowd},           {"position", Arr(aLook.position)},
             {"heading", aLook.yaw}};
    out["community"] = aLook.hasStub ? json{{"spawner", aLook.spawner}, {"entry", aLook.entry}, {"ordinal", aLook.ordinal >= 0 ? json(aLook.ordinal) : json(nullptr)}} : json(nullptr);
    return out;
}
} // namespace

// --- the pure parts -----------------------------------------------------------------------------------

OriginalLook LookFromJson(const json& aReading)
{
    OriginalLook look;
    look.entity = aReading.value("entity", std::string());
    look.record = aReading.value("record", std::string());
    look.className = aReading.value("class", std::string());
    look.appearance = aReading.value("appearance", std::string());
    look.variant = aReading.value("variant", std::string());
    look.gender = aReading.value("gender", std::string());
    look.bodyType = aReading.value("body_type", std::string());
    look.crowd = aReading.value("crowd", false);
    if (aReading.contains("position"))
    {
        look.position = ToVec(aReading["position"]);
    }
    look.yaw = aReading.value("yaw", 0.0);
    const auto stub = aReading.find("stub");
    if (stub != aReading.end() && stub->is_object())
    {
        look.spawner = stub->value("spawner", std::string());
        look.entry = stub->value("entry", std::string());
        look.hasStub = !look.spawner.empty() && !look.entry.empty();
        look.ordinal = stub->contains("ordinal") && (*stub)["ordinal"].is_number_integer() ? (*stub)["ordinal"].get<int>() : -1;
    }
    return look;
}

Match MatchLook(const OriginalLook& aLook, const std::string& aCastOverride)
{
    Match match;
    const char gender = GenderOf(aLook);
    const auto text = Lower(aLook.appearance) + " " + Lower(aLook.record);
    const Family* family = nullptr;
    for (const auto& candidate : Families())
    {
        if (Has(text, candidate.token))
        {
            family = &candidate;
            break;
        }
    }
    std::string how;
    if (!aCastOverride.empty())
    {
        const auto* chosen = FindCast(aCastOverride);
        if (!chosen || chosen->research || chosen->combat)
        {
            throw MethodError("cast_unknown", "'" + aCastOverride.substr(0, 32) + "' isn't a civilian XF actor (npc_spawn's casts list them; the research and fighter casts can't stand in for a passer-by)");
        }
        match.cast = chosen->name;
        how = "chosen_by_caller";
    }
    else
    {
        if (gender == '?')
        {
            throw MethodError("look_unmatched", "the game didn't say whether that person is a woman or a man, so no cast can stand in; name one with 'cast'");
        }
        if (family)
        {
            match.cast = gender == 'F' ? family->woman : family->man;
            how = "family_and_gender";
        }
        else
        {
            match.cast = gender == 'F' ? "woman_lowlife" : "man_lowlife";
            how = "gender_only";
        }
    }
    const std::string base = BaseRecordOf(match.cast);
    const bool sameRecord = !base.empty() && Lower(aLook.record) == Lower(base);
    const bool inFamily = family && (match.cast == family->woman || match.cast == family->man);
    const bool exactInFamily = family && ((match.cast == family->woman && family->exactWoman) || (match.cast == family->man && family->exactMan));
    const std::string recordMatch = sameRecord ? "clone_of_same_record" : exactInFamily ? "same_family" : inFamily ? "nearest_in_family" : "gender_only";
    const std::string expected = sameRecord ? "exact" : exactInFamily ? "close" : "approximate";
    const auto* cast = FindCast(match.cast);
    match.appearance = aLook.appearance.empty() ? "random" : aLook.appearance;
    json notMatched = json::array({"props and held items (umbrellas, phones, cans): the clones carry none",
                                   "body proportions and skin beyond what the template's appearance defines",
                                   "the voice: the cast keeps its own voiceset",
                                   "colour variants: the spawn names an appearance only"});
    match.report = json{
        {"confirmed", false},
        {"level", nullptr},
        {"expected_level", expected},
        {"cast", match.cast},
        {"cast_rig", cast ? cast->rig : std::string()},
        {"chosen_by", how},
        {"record", {{"original", aLook.record}, {"cast_is_a_clone_of", base}, {"match", recordMatch}}},
        {"appearance", {{"original", aLook.appearance}, {"requested", match.appearance}, {"actual", nullptr}, {"match", "pending"}}},
        {"colour_variant", {{"original", aLook.variant}, {"actual", nullptr}, {"match", "pending"}}},
        {"position", {{"original", Arr(aLook.position)}, {"requested", nullptr}, {"actual", nullptr}, {"moved_m", nullptr}}},
        {"heading", {{"original", aLook.yaw}, {"requested", aLook.yaw}, {"actual", nullptr}, {"difference_deg", nullptr}}},
        {"not_matched", notMatched},
        {"why_a_clone", "the crowd person's own record is a lane walker that would rejoin the crowd and ignore commands; the XF casts are clones of the same civilians that take commands"},
    };
    return match;
}

json ConfirmLook(const json& aReport, const OriginalLook& aLook, const std::string& aActualAppearance, const std::string& aActualVariant, const Vec3& aActualAt,
                 double aActualYaw)
{
    json out = aReport;
    std::string level = out.value("expected_level", std::string("approximate"));
    bool confirmed = true;
    auto& appearance = out["appearance"];
    appearance["actual"] = aActualAppearance;
    if (aActualAppearance.empty())
    {
        appearance["match"] = "unconfirmed";
        confirmed = false;
    }
    else if (aLook.appearance.empty())
    {
        appearance["match"] = "cast_default";
    }
    else if (aActualAppearance == aLook.appearance)
    {
        appearance["match"] = "exact";
    }
    else
    {
        appearance["match"] = "fell_back";
        level = "approximate";
    }
    auto& variant = out["colour_variant"];
    variant["actual"] = aActualVariant;
    if (aLook.variant.empty())
    {
        variant["match"] = "not_applicable";
    }
    else if (aActualVariant == aLook.variant)
    {
        variant["match"] = "exact";
    }
    else
    {
        variant["match"] = "different";
        if (level == "exact")
        {
            level = "close";
        }
    }
    auto& position = out["position"];
    position["requested"] = position["requested"].is_null() ? Arr(aLook.position) : position["requested"];
    position["actual"] = Arr(aActualAt);
    position["moved_m"] = std::round(Distance(aLook.position, aActualAt) * 100.0) / 100.0;
    auto& heading = out["heading"];
    heading["actual"] = aActualYaw;
    heading["difference_deg"] = std::round(std::abs(YawDifference(aLook.yaw, aActualYaw)) * 10.0) / 10.0;
    out["confirmed"] = confirmed;
    out["level"] = confirmed ? json(level) : json(nullptr);
    if (!confirmed)
    {
        out["expected_level"] = level;
    }
    return out;
}

std::string Fnv64Hex(const std::string& aText)
{
    uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char c : aText)
    {
        hash ^= c;
        hash *= 1099511628211ULL;
    }
    char buffer[24];
    std::snprintf(buffer, sizeof buffer, "%016llx", static_cast<unsigned long long>(hash));
    return buffer;
}

json ResidentFor(const OriginalLook& aLook, const std::string& aAppearance, const Vec3& aSpot)
{
    const std::string basis = aLook.record + "|" + aAppearance + "|" + Quantised(aSpot[0]) + "," + Quantised(aSpot[1]) + "," + Quantised(aSpot[2]);
    const auto hash = Fnv64Hex(basis);
    const bool community = aLook.hasStub && aLook.ordinal >= 0;
    json out{{"key", community ? "xfc1-" + Safe(aLook.spawner) + "-" + Safe(aLook.entry) + "-" + std::to_string(aLook.ordinal) : "xfr1-" + hash},
             {"kind", community ? "community" : "crowd"},
             {"hash", "xfr1-" + hash},
             {"basis", {{"record", aLook.record}, {"appearance", aAppearance}, {"spot", json::array({std::stod(Quantised(aSpot[0])), std::stod(Quantised(aSpot[1])), std::stod(Quantised(aSpot[2]))})}}},
             {"community", aLook.hasStub ? json{{"spawner", aLook.spawner}, {"entry", aLook.entry}, {"ordinal", aLook.ordinal >= 0 ? json(aLook.ordinal) : json(nullptr)}} : json(nullptr)},
             {"ours", true}};
    out["note"] = community
                      ? "xfc1: the game's own pair for a community NPC (spawner, entry name) plus the person's index in the community's fixed list; stable across a sector reload only if the game's list is [hypothesis: knowledge/crowd-adoption-and-identity.md, CA6 and CA7]"
                      : "xfr1: a hash of the record, the appearance and the spawn spot (to 0.1 m). A lane-crowd person has no key of the game's own; this one is ours.";
    out["scope"] = "ours, not the game's: a reload or a stream-out loses the actor until the engine brings it back with npc_spawn and the look in 'respawn'";
    return out;
}

json RespawnFor(const std::string& aCast, const std::string& aAppearance, const Vec3& aSpot, double aYaw, const std::string& aReactions)
{
    const auto ahead = OffsetPoint(aSpot, aYaw, 5.0, 0.0);
    return json{{"method", "npc.spawn"},
                {"params", {{"cast", aCast}, {"appearance", aAppearance}, {"at", Arr(aSpot)}, {"face", Arr(ahead)}, {"reactions", aReactions}}},
                {"note", "brings the same look back at the same spot and heading; at must be within 30 m of V"}};
}

// --- the service --------------------------------------------------------------------------------------

json Service::SwapJson(const Swap& aSwap) const
{
    return json{{"who", aSwap.who},
                {"state", aSwap.spawning ? "spawning" : "waiting"},
                {"original", aSwap.original},
                {"age_s", std::round(aSwap.age * 10) / 10},
                {"max_wait_s", aSwap.maxWait},
                {"cast", aSwap.cast},
                {"appearance", aSwap.appearance},
                {"restore", aSwap.restore},
                {"original_position", Arr(aSwap.look.position)},
                {"look_match", aSwap.report}};
}

void Service::BeginSwap(Swap& aSwap, const json& aV, const Ops& aOps)
{
    (void)aV;
    const auto* cast = FindCast(aSwap.cast);
    if (!cast)
    {
        throw MethodError("cast_unknown", aSwap.cast + " isn't an XF actor");
    }
    const auto record = aSwap.reactions == "game" ? ReactiveRecord(*cast) : cast->record;
    // Hold the original still while the actor appears: the game's own stop levers on a crowd member. Best effort; the swap goes
    // on without it (the original is then removed a moment after, wherever it walked to).
    bool detached = false;
    aSwap.hold = nullptr;
    if (aOps.detachOriginal)
    {
        try
        {
            aSwap.hold = aOps.detachOriginal(aSwap.original);
            detached = aSwap.hold.value("detached", true);
        }
        catch (const std::exception& e)
        {
            aSwap.hold = json{{"detached", false}, {"error", e.what()}};
        }
    }
    json step;
    try
    {
        step = aOps.spawn(aSwap.who, record, aSwap.look.position, aSwap.look.yaw, aSwap.appearance, !aSwap.inViewAllowed, 0, true);
    }
    catch (...)
    {
        if (detached && aOps.reattachOriginal)
        {
            try
            {
                aOps.reattachOriginal(aSwap.original);
            }
            catch (const std::exception&)
            {
            }
        }
        throw;
    }
    aSwap.detached = detached;
    aSwap.spawning = true;
    aSwap.sinceSpawn = 0.0;
    const Vec3 spot = step.contains("position") ? ToVec(step["position"]) : aSwap.look.position;
    Npc npc;
    npc.who = aSwap.who;
    npc.kind = "actor";
    npc.cast = cast->name;
    npc.record = record;
    npc.rig = cast->rig;
    npc.label = aSwap.label.empty() ? cast->label : aSwap.label;
    npc.reactions = aSwap.reactions;
    npc.entity = step.value("entity", std::string());
    npc.position = spot;
    npc.substituteOf = aSwap.original;
    npc.restore = aSwap.restore;
    npc.originalRecord = aSwap.look.record;
    npc.originalAppearance = aSwap.look.appearance;
    npc.yawAsked = aSwap.look.yaw;
    npc.resident = ResidentFor(aSwap.look, aSwap.appearance, spot);
    aSwap.report["position"]["requested"] = Arr(spot);
    npc.lookMatch = aSwap.report;
    npc.respawn = RespawnFor(cast->name, aSwap.appearance, spot, aSwap.look.yaw, aSwap.reactions);
    m_npcs[aSwap.who] = npc;
}

void Service::FailSwap(const std::string& aWho, const std::string& aReason, const std::string& aDetail, const Ops& aOps)
{
    Swap swap;
    {
        std::scoped_lock _(m_mutex);
        const auto it = std::find_if(m_swaps.begin(), m_swaps.end(), [&](const Swap& w) { return w.who == aWho; });
        if (it == m_swaps.end())
        {
            return;
        }
        swap = *it;
        m_swaps.erase(it);
    }
    bool returned = false;
    if (swap.detached && aOps.reattachOriginal)
    {
        try
        {
            aOps.reattachOriginal(swap.original);
            returned = true;
        }
        catch (const std::exception&)
        {
        }
    }
    bool hasActor = false;
    {
        std::scoped_lock _(m_mutex);
        hasActor = m_npcs.find(aWho) != m_npcs.end();
    }
    if (hasActor)
    {
        ReleaseOne(aWho, "despawn", "substitute_failed", aOps);
    }
    Emit("npc.substitute_failed", "warn", aWho + "'s substitution didn't happen (" + aReason + ")",
         {{"who", aWho}, {"original", swap.original}, {"reason", aReason}, {"detail", aDetail}, {"original_returned", returned}, {"waited_s", std::round(swap.age * 10) / 10}});
}

json Service::Substitute(const json& aParams, const Ops& aOps)
{
    RequireKnown("npc.substitute", aParams);
    const auto id = params::CheckText(aParams, "id", 64);
    const auto pickAsked = params::CheckText(aParams, "who", 8);
    const bool lookAt = params::CheckBoolean(aParams, "look_at").value_or(false);
    const int sources = (id ? 1 : 0) + (pickAsked ? 1 : 0) + (lookAt ? 1 : 0);
    if (sources != 1)
    {
        Bad("give exactly one of id (an NPC's id from npc_list), who (the handle of a picked NPC) or look_at: true (the NPC V is looking at)");
    }
    if (pickAsked && !IsPickHandle(*pickAsked))
    {
        Bad("'who' must be the handle of a picked NPC (p1, p2, ...); an XF actor can't be substituted");
    }
    const auto castAsked = params::CheckText(aParams, "cast", 32).value_or(std::string());
    const auto reactions = params::CheckText(aParams, "reactions", 16).value_or("quiet");
    if (reactions != "quiet" && reactions != "game")
    {
        Bad("'reactions' must be quiet (the default: no crime or panic reactions) or game (the civilian's own, so it flinches and flees as the crowd does)");
    }
    const bool restore = params::CheckBoolean(aParams, "restore").value_or(false);
    const bool inView = params::CheckBoolean(aParams, "in_view").value_or(false);
    const bool dryRun = params::CheckBoolean(aParams, "dry_run").value_or(false);
    const double maxWait = params::CheckNumber(aParams, "max_wait_s", 1.0, kSwapWaitMaxS).value_or(kSwapWaitDefaultS);
    const auto label = params::CheckText(aParams, "label", kMaxTitleChars).value_or(std::string());
    const auto v = RequireV(aOps);

    // Which person.
    std::string entity, pickWho;
    if (pickAsked)
    {
        std::scoped_lock _(m_mutex);
        const auto& held = Ours(*pickAsked, false);
        if (held.kind != "pick")
        {
            Bad(*pickAsked + " isn't a picked passer-by");
        }
        entity = held.entity;
        pickWho = *pickAsked;
    }
    else if (id)
    {
        entity = *id;
    }
    else
    {
        const auto looked = aOps.lookedAt();
        entity = looked.value("id", std::string());
        if (entity.empty())
        {
            throw MethodError("npc_not_found", "V isn't looking at an NPC (npc_list gives ids to pick from)");
        }
    }
    {
        std::scoped_lock _(m_mutex);
        for (const auto& swap : m_swaps)
        {
            if (swap.original == entity)
            {
                throw MethodError("already_substituting", "that person is being substituted already (" + swap.who + ")");
            }
        }
        for (const auto& [handle, held] : m_npcs)
        {
            if (held.kind == "actor" && held.entity == entity)
            {
                throw MethodError("npc_protected", "that is one of the bridge's own actors (" + handle + "), not a passer-by of the crowd");
            }
        }
        if (!dryRun && ActorCount() + static_cast<size_t>(std::count_if(m_swaps.begin(), m_swaps.end(), [](const Swap& w) { return !w.spawning; })) >= kMaxActors)
        {
            throw MethodError("limit", "the bridge has " + std::to_string(kMaxActors) + " actors out already; npc_release one first");
        }
    }

    // The same eligibility as npc.pick (the game step refuses: npc_protected, npc_busy, too_far, npc_not_found).
    OriginalLook look = LookFromJson(aOps.readLook(entity));
    look.entity = entity;
    auto match = MatchLook(look, castAsked);
    const auto camera = CameraFrom(v);
    const bool hidden = OutOfSight(camera, look.position, aOps);
    const bool swapNow = hidden || inView;

    json out{{"original", LookJson(look)},
             {"cast", match.cast},
             {"reactions", reactions},
             {"look_match", match.report},
             {"swap",
              {{"mode", swapNow ? "now" : "waiting"},
               {"original_out_of_sight", hidden},
               {"in_view_allowed", inView},
               {"max_wait_s", maxWait},
               {"removes_original", "once the actor stands there: npc.substituted follows in the event stream"}}},
             {"restore", restore}};
    if (!camera.known)
    {
        out["swap"]["warning"] = "the game didn't report V's camera, so what V sees can't be judged: the swap waits (in_view: true swaps anyway)";
    }
    if (dryRun)
    {
        const std::string appearance = match.appearance;
        out["dry_run"] = true;
        out["respawn"] = RespawnFor(match.cast, appearance, look.position, look.yaw, reactions);
        out["resident"] = ResidentFor(look, appearance, look.position);
        out["undo"] = nullptr;
        out["undo_note"] = "a dry run changes nothing";
        return out;
    }

    Swap swap;
    {
        std::scoped_lock _(m_mutex);
        swap.who = "a" + std::to_string(m_nextActor++);
    }
    swap.original = entity;
    swap.pickWho = pickWho;
    swap.look = look;
    swap.cast = match.cast;
    swap.appearance = match.appearance;
    swap.reactions = reactions;
    swap.label = label;
    swap.restore = restore;
    swap.inViewAllowed = inView;
    swap.maxWait = maxWait;
    swap.report = match.report;
    out["who"] = swap.who;
    if (swapNow)
    {
        std::scoped_lock _(m_mutex);
        BeginSwap(swap, v, aOps); // refuses (and puts the original back) when the spawn is refused
        const auto& npc = m_npcs[swap.who];
        out["state"] = "spawning";
        out["resident"] = npc.resident;
        out["respawn"] = npc.respawn;
        out["look_match"] = npc.lookMatch;
        out["swap"]["hold"] = swap.hold;
        if (npc.position != look.position)
        {
            out["moved_to_walkable_m"] = std::round(Distance(npc.position, look.position) * 100.0) / 100.0;
        }
        m_swaps.push_back(swap);
    }
    else
    {
        std::scoped_lock _(m_mutex);
        out["state"] = "waiting";
        out["resident"] = nullptr;
        out["resident_pending"] = "the key is fixed when the actor is placed: npc.substituted carries it";
        out["respawn"] = nullptr;
        m_swaps.push_back(swap);
    }
    Emit("npc.substitute_started", "info", swap.who + " will replace " + look.record + " (" + (swapNow ? "now" : "once V can't see them") + ")",
         {{"who", swap.who}, {"original", entity}, {"state", out["state"]}, {"cast", swap.cast}});
    out["undo"] = Undo("npc.release", {{"who", swap.who}, {"how", "despawn"}});
    out["undo_note"] = "releasing before the swap is done cancels it and gives the original back; after it, the actor goes (restore: true leaves a fresh crowd person), but the original cannot be brought back (it was hidden for good and the game recycles it)";
    out["note"] = "explicit: the actor appears as the original's stand-in with the closest look the clones allow; npc.substituted reports what really matched";
    return out;
}

void Service::StepSwaps(double aDt, const Ops& aOps)
{
    std::vector<std::string> due, spawning;
    {
        std::scoped_lock _(m_mutex);
        if (m_swaps.empty())
        {
            return;
        }
        for (auto& swap : m_swaps)
        {
            swap.age += aDt;
            swap.sincePoll += aDt;
            if (swap.spawning)
            {
                swap.sinceSpawn += aDt;
                spawning.push_back(swap.who);
            }
            else if (swap.sincePoll >= kPollSeconds)
            {
                swap.sincePoll = 0.0;
                due.push_back(swap.who);
            }
        }
    }
    json v;
    Camera camera;
    if (!due.empty() || !spawning.empty())
    {
        try
        {
            v = aOps.v();
            camera = CameraFrom(v);
        }
        catch (const std::exception&)
        {
            return; // the next tick tries again
        }
        // V leaving normal play (a fight, a scene, a ride, a menu or photo mode) ends every swap: the original is given back.
        const auto busy = v.value("busy", std::string());
        const auto phase = v.value("phase", std::string("gameplay"));
        if (phase != "gameplay" || busy == "in_combat" || busy == "in_scene" || busy == "in_vehicle" || busy == "not_v")
        {
            std::vector<std::string> all;
            {
                std::scoped_lock _(m_mutex);
                for (const auto& swap : m_swaps)
                {
                    all.push_back(swap.who);
                }
            }
            for (const auto& who : all)
            {
                FailSwap(who, phase != "gameplay" ? phase : busy, "V is not in normal play", aOps);
            }
            return;
        }
    }
    // Waiting swaps: is the original out of V's sight now?
    for (const auto& who : due)
    {
        Swap snapshot;
        {
            std::scoped_lock _(m_mutex);
            const auto it = std::find_if(m_swaps.begin(), m_swaps.end(), [&](const Swap& w) { return w.who == who && !w.spawning; });
            if (it == m_swaps.end())
            {
                continue;
            }
            snapshot = *it;
        }
        if (snapshot.age >= snapshot.maxWait)
        {
            FailSwap(who, "never_hidden", "the original stayed in V's sight for " + std::to_string(static_cast<int>(snapshot.maxWait)) + " s; nothing was changed", aOps);
            continue;
        }
        json reading;
        try
        {
            reading = aOps.readLook(snapshot.original);
        }
        catch (const MethodError& e)
        {
            FailSwap(who, e.code == "npc_not_found" ? "original_lost" : e.code, e.what(), aOps);
            continue;
        }
        catch (const std::exception&)
        {
            continue;
        }
        auto look = LookFromJson(reading);
        look.entity = snapshot.original;
        if (!OutOfSight(camera, look.position, aOps))
        {
            std::scoped_lock _(m_mutex);
            const auto it = std::find_if(m_swaps.begin(), m_swaps.end(), [&](const Swap& w) { return w.who == who; });
            if (it != m_swaps.end())
            {
                it->look.position = look.position; // it walks on; the swap happens where it is when it is hidden
                it->look.yaw = look.yaw;
            }
            continue;
        }
        try
        {
            std::scoped_lock _(m_mutex);
            const auto it = std::find_if(m_swaps.begin(), m_swaps.end(), [&](const Swap& w) { return w.who == who && !w.spawning; });
            if (it == m_swaps.end())
            {
                continue;
            }
            it->look = look;
            it->report["position"]["original"] = Arr(look.position);
            it->report["heading"]["original"] = look.yaw;
            it->report["heading"]["requested"] = look.yaw;
            BeginSwap(*it, v, aOps);
        }
        catch (const std::exception& e)
        {
            FailSwap(who, "spawn_failed", e.what(), aOps);
        }
    }
    // Swaps whose actor was requested: the original goes the moment the actor stands there.
    for (const auto& who : spawning)
    {
        Swap swap;
        bool appeared = false, gone = false;
        Npc npc;
        {
            std::scoped_lock _(m_mutex);
            const auto it = std::find_if(m_swaps.begin(), m_swaps.end(), [&](const Swap& w) { return w.who == who && w.spawning; });
            if (it == m_swaps.end())
            {
                continue;
            }
            swap = *it;
            const auto held = m_npcs.find(who);
            gone = held == m_npcs.end();
            if (!gone)
            {
                appeared = held->second.spawned;
                npc = held->second;
            }
        }
        if (gone)
        {
            FailSwap(who, "actor_gone", "the actor was released or lost before the swap finished", aOps);
            continue;
        }
        if (!appeared)
        {
            if (swap.sinceSpawn >= kSwapSpawnS)
            {
                FailSwap(who, "not_spawned", "the actor did not appear within " + std::to_string(static_cast<int>(kSwapSpawnS)) + " s; the original was given back", aOps);
            }
            continue;
        }
        json removal = json::object();
        try
        {
            removal = aOps.removeOriginal(swap.original);
        }
        catch (const MethodError& e)
        {
            if (e.code == "npc_not_found")
            {
                removal = json{{"removed", false}, {"note", "the original was gone already (the game recycled it first)"}};
            }
            else
            {
                FailSwap(who, "remove_refused", e.what(), aOps);
                continue;
            }
        }
        catch (const std::exception& e)
        {
            FailSwap(who, "remove_refused", e.what(), aOps);
            continue;
        }
        const Vec3 at = npc.position;
        const double yaw = npc.yawKnown ? npc.yaw : swap.look.yaw;
        const auto confirmed = ConfirmLook(npc.lookMatch.is_null() ? swap.report : npc.lookMatch, swap.look, npc.appearanceNow, npc.variantNow, at, yaw);
        const bool seen = !OutOfSight(camera, at, aOps);
        {
            std::scoped_lock _(m_mutex);
            const auto held = m_npcs.find(who);
            if (held != m_npcs.end())
            {
                held->second.lookMatch = confirmed;
            }
            m_swaps.erase(std::remove_if(m_swaps.begin(), m_swaps.end(), [&](const Swap& w) { return w.who == who; }), m_swaps.end());
        }
        Emit("npc.substituted", "done", who + " took " + swap.look.record + "'s place (look " + (confirmed.value("confirmed", false) ? confirmed.value("level", std::string("?")) : std::string("unconfirmed")) + ")",
             {{"who", who},
              {"original", swap.original},
              {"look_match", confirmed},
              {"resident", npc.resident},
              {"respawn", npc.respawn},
              {"in_view_at_swap", seen},
              {"hold", swap.hold},
              {"waited_s", std::round(swap.age * 10) / 10},
              {"removal", removal}});
        if (!swap.pickWho.empty())
        {
            ReleaseOne(swap.pickWho, "leave", "", aOps);
        }
    }
}

void Service::StepRestores(double aDt, const Ops& aOps)
{
    std::vector<Restoring> due;
    {
        std::scoped_lock _(m_mutex);
        if (m_restores.empty() || !aOps.restoreStep)
        {
            return;
        }
        for (auto& restoring : m_restores)
        {
            restoring.age += aDt;
            restoring.sinceStep += aDt;
            if (restoring.sinceSpawned >= 0.0)
            {
                restoring.sinceSpawned += aDt;
            }
            if (restoring.sinceStep >= kPollSeconds)
            {
                restoring.sinceStep = 0.0;
                due.push_back(restoring);
            }
        }
    }
    for (const auto& restoring : due)
    {
        json reading;
        try
        {
            reading = aOps.restoreStep(restoring.entity, !restoring.sent);
        }
        catch (const std::exception&)
        {
            reading = json{{"spawned", false}};
        }
        const bool spawned = reading.value("spawned", false);
        const bool inCrowd = reading.value("in_crowd", false);
        bool done = false;
        double waited = 0.0;
        {
            std::scoped_lock _(m_mutex);
            const auto it = std::find_if(m_restores.begin(), m_restores.end(), [&](const Restoring& r) { return r.entity == restoring.entity; });
            if (it == m_restores.end())
            {
                continue;
            }
            if (spawned && it->sinceSpawned < 0.0)
            {
                it->sinceSpawned = 0.0;
            }
            if (spawned)
            {
                it->sent = true;
            }
            waited = it->age;
            done = (spawned && inCrowd) || (it->sinceSpawned >= kRestoreJoinS) || it->age >= kRestoreMaxS;
            if (done)
            {
                m_restores.erase(it);
            }
        }
        if (done)
        {
            Emit("npc.restored", "done", "a fresh crowd person was left where the actor stood (" + std::string(inCrowd ? "in the crowd" : "not seen joining the crowd") + ")",
                 {{"entity", restoring.entity}, {"spawned", spawned}, {"in_crowd", inCrowd}, {"waited_s", std::round(waited * 10) / 10}});
        }
    }
}
} // namespace xfb::npc
