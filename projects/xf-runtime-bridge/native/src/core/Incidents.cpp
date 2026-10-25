#include "core/Incidents.hpp"

#include <algorithm>
#include <cmath>

#include "core/Dispatcher.hpp"
#include "core/Params.hpp"

namespace xfb::incidents
{
namespace
{
// The evidence the taps send, and how much of a report each is worth. A direct act (a shot, a blow, a death, a stop, a theft, a
// collision) is 1; a scream or a body is half; a combat bark alone is a quarter, so four of them in one place make a report.
constexpr EvidenceInfo kEvidence[] = {
    {"gunshot", 1.0},   {"explosion", 1.0}, {"melee", 1.0},   {"crime", 1.0},     {"combat", 1.0},
    {"death", 1.0},     {"collision", 1.0}, {"vehicle_hit", 1.0}, {"reprimand", 1.0}, {"theft", 1.0},
    {"fear", 0.5},      {"body", 0.5},      {"voice", 0.25},
};

double Round(double aValue, int aPlaces = 2)
{
    if (!std::isfinite(aValue))
    {
        return 0;
    }
    const double scale = std::pow(10.0, aPlaces);
    return std::round(aValue * scale) / scale;
}

json Pos(const double (&aPos)[3])
{
    return json::array({Round(aPos[0]), Round(aPos[1]), Round(aPos[2])});
}

double Distance(const double (&aA)[3], const double (&aB)[3])
{
    return std::sqrt((aA[0] - aB[0]) * (aA[0] - aB[0]) + (aA[1] - aB[1]) * (aA[1] - aB[1]) + (aA[2] - aB[2]) * (aA[2] - aB[2]));
}

std::string IdText(uint64_t aNumber)
{
    return "inc-" + std::to_string(aNumber);
}

json RoleList(uint32_t aRoles)
{
    json out = json::array();
    for (size_t i = 0; i < std::size(kRoleNames); ++i)
    {
        if (aRoles & (1u << i))
        {
            out.push_back(kRoleNames[i]);
        }
    }
    return out;
}

// The wire readers: a field of the wrong type is a refusal, never an exception.
bool Number(const json& aObject, const char* aKey, double& aOut, bool aRequired, std::string& aWhy)
{
    const auto it = aObject.find(aKey);
    if (it == aObject.end() || it->is_null())
    {
        if (aRequired)
        {
            aWhy = std::string("missing ") + aKey;
        }
        return !aRequired;
    }
    if (!it->is_number() || !std::isfinite(it->get<double>()) || std::fabs(it->get<double>()) > 1.0e7)
    {
        aWhy = std::string(aKey) + " is not a number in range";
        return false;
    }
    aOut = it->get<double>();
    return true;
}

bool Text(const json& aObject, const char* aKey, size_t aMax, std::string& aOut, std::string& aWhy)
{
    const auto it = aObject.find(aKey);
    if (it == aObject.end() || it->is_null())
    {
        return true;
    }
    if (!it->is_string() || it->get_ref<const std::string&>().size() > aMax)
    {
        aWhy = std::string(aKey) + " is not text of at most " + std::to_string(aMax) + " characters";
        return false;
    }
    aOut = it->get<std::string>();
    return true;
}

bool Flag(const json& aObject, const char* aKey, bool& aOut, std::string& aWhy)
{
    const auto it = aObject.find(aKey);
    if (it == aObject.end() || it->is_null())
    {
        return true;
    }
    if (it->is_boolean())
    {
        aOut = it->get<bool>();
        return true;
    }
    if (it->is_number_integer() && (it->get<int>() == 0 || it->get<int>() == 1))
    {
        aOut = it->get<int>() == 1;
        return true;
    }
    aWhy = std::string(aKey) + " is not a flag";
    return false;
}

bool Point(const json& aObject, const char* aKey, bool& aHas, double (&aOut)[3], std::string& aWhy)
{
    const auto it = aObject.find(aKey);
    if (it == aObject.end() || it->is_null())
    {
        return true;
    }
    if (!it->is_array() || it->size() != 3)
    {
        aWhy = std::string(aKey) + " is not [x, y, z]";
        return false;
    }
    double v[3] = {0, 0, 0};
    for (size_t i = 0; i < 3; ++i)
    {
        if (!(*it)[i].is_number() || !std::isfinite((*it)[i].get<double>()) || std::fabs((*it)[i].get<double>()) > 1.0e6)
        {
            aWhy = std::string(aKey) + " is not [x, y, z]";
            return false;
        }
        v[i] = (*it)[i].get<double>();
    }
    aHas = true;
    std::copy(v, v + 3, aOut);
    return true;
}

// The "who" list of an observation or a sight sample: at most aMax people.
bool ParseFacts(const json& aWire, size_t aMax, std::vector<Fact>& aOut, std::string& aWhy)
{
    const auto who = aWire.find("who");
    if (who == aWire.end() || who->is_null())
    {
        return true;
    }
    if (!who->is_array() || who->size() > aMax)
    {
        aWhy = "who is a list of at most " + std::to_string(aMax) + " people";
        return false;
    }
    for (const auto& item : *who)
    {
        if (!item.is_object())
        {
            aWhy = "each of who is an object";
            return false;
        }
        Fact f;
        std::string role;
        if (!Text(item, "id", 48, f.id, aWhy) || !Text(item, "w", 16, f.who, aWhy) || !Text(item, "rec", 96, f.record, aWhy) ||
            !Text(item, "aff", 48, f.affiliation, aWhy) || !Text(item, "role", 12, role, aWhy) || !Flag(item, "v", f.isV, aWhy) ||
            !Flag(item, "crowd", f.crowd, aWhy) || !Flag(item, "in", f.inView, aWhy) || !Number(item, "d", f.dist, false, aWhy) ||
            !Point(item, "pos", f.hasPos, f.pos, aWhy))
        {
            return false;
        }
        f.roles = RoleFromName(role);
        if (!role.empty() && f.roles == 0)
        {
            aWhy = "role '" + role + "' is not a role";
            return false;
        }
        if (f.id.empty() && !f.isV)
        {
            aWhy = "a person needs an id";
            return false;
        }
        double los = 2;
        if (!Number(item, "los", los, false, aWhy))
        {
            return false;
        }
        f.los = los == 0 ? Los::Clear : los == 1 ? Los::Blocked : Los::Unchecked;
        aOut.push_back(std::move(f));
    }
    return true;
}
} // namespace

uint32_t RoleFromName(const std::string& aName)
{
    for (size_t i = 0; i < std::size(kRoleNames); ++i)
    {
        if (aName == kRoleNames[i])
        {
            return 1u << i;
        }
    }
    return 0;
}

const char* KindName(Kind aKind)
{
    switch (aKind)
    {
    case Kind::Theft: return "theft";
    case Kind::Assault: return "assault";
    case Kind::Accident: return "accident";
    case Kind::StreetFight: return "street_fight";
    case Kind::PoliceStop: return "police_stop";
    case Kind::Gunfire: return "gunfire";
    case Kind::Other: break;
    }
    return "other";
}

const EvidenceInfo* FindEvidence(const std::string& aName)
{
    for (const auto& info : kEvidence)
    {
        if (aName == info.name)
        {
            return &info;
        }
    }
    return nullptr;
}

json ConfigJson(const Config& aConfig)
{
    return {{"quiet_s", aConfig.quietS},
            {"max_open_s", aConfig.maxOpenS},
            {"join_radius_m", aConfig.joinRadiusM},
            {"see_range_m", aConfig.seeRangeM},
            {"min_score", aConfig.minScore},
            {"max_open", aConfig.maxOpen},
            {"max_closed", aConfig.maxClosed},
            {"max_participants", aConfig.maxParticipants},
            {"max_observations_per_s", aConfig.maxObservationsPerSecond},
            {"max_reports_per_min", aConfig.maxReportsPerMinute},
            {"max_pending_reports", aConfig.maxPendingReports},
            {"max_built_per_s", aConfig.maxBuiltPerSecond},
            {"max_weak_built_per_s", aConfig.maxWeakBuiltPerSecond},
            {"max_per_key_per_s", aConfig.maxPerKeyPerSecond},
            {"max_declared", aConfig.maxDeclared},
            {"max_declared_roles", aConfig.maxRoles},
            {"declared_ttl_default_s", aConfig.ttlDefaultS},
            {"declared_ttl_max_s", aConfig.ttlMaxS},
            {"max_sight_per_s", aConfig.maxSightPerSecond}};
}

std::optional<Observation> ParseObservation(const json& aWire, std::string& aWhy)
{
    if (!aWire.is_object())
    {
        aWhy = "an observation is a JSON object";
        return std::nullopt;
    }
    Observation o;
    if (!Text(aWire, "ev", 24, o.evidence, aWhy) || !FindEvidence(o.evidence))
    {
        if (aWhy.empty())
        {
            aWhy = "ev is not a known kind of evidence";
        }
        return std::nullopt;
    }
    if (!Text(aWire, "type", 40, o.type, aWhy) || !Text(aWire, "dist", 80, o.district, aWhy) || !Text(aWire, "view", 12, o.view, aWhy))
    {
        return std::nullopt;
    }
    if (!Number(aWire, "sim", o.simS, true, aWhy) || !Number(aWire, "game", o.gameS, false, aWhy) || !Number(aWire, "radius", o.radius, false, aWhy) ||
        !Number(aWire, "vd", o.vDist, false, aWhy) || !Point(aWire, "pos", o.hasPos, o.pos, aWhy))
    {
        return std::nullopt;
    }
    if (o.radius < 0 || o.radius > 1000)
    {
        aWhy = "radius is outside 0 to 1000 metres";
        return std::nullopt;
    }
    if (!ParseFacts(aWire, kMaxFacts, o.who, aWhy))
    {
        return std::nullopt;
    }
    return o;
}

std::optional<SightSample> ParseSight(const json& aWire, std::string& aWhy)
{
    if (!aWire.is_object())
    {
        aWhy = "a sight sample is a JSON object";
        return std::nullopt;
    }
    SightSample s;
    if (!Text(aWire, "dist", 80, s.district, aWhy) || !Text(aWire, "view", 12, s.view, aWhy) || !Number(aWire, "sim", s.simS, true, aWhy) ||
        !Number(aWire, "game", s.gameS, false, aWhy) || !ParseFacts(aWire, kMaxSightFacts, s.who, aWhy))
    {
        return std::nullopt;
    }
    if (s.view != "gameplay" && s.view != "photo")
    {
        aWhy = "view is gameplay or photo";
        return std::nullopt;
    }
    return s;
}

bool SafeText(const std::string& aText, size_t aMax, bool aAllowSpace)
{
    if (aText.empty() || aText.size() > aMax)
    {
        return false;
    }
    for (size_t i = 0; i < aText.size(); ++i)
    {
        const unsigned char c = static_cast<unsigned char>(aText[i]);
        const bool plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' || c == ':' ||
                           c == '/' || c == '+';
        if (plain)
        {
            continue;
        }
        // One space between other characters, never at an end or doubled.
        if (aAllowSpace && c == ' ' && i > 0 && i + 1 < aText.size() && aText[i - 1] != ' ' && aText[i + 1] != ' ')
        {
            continue;
        }
        return false;
    }
    return true;
}

bool IsActorHandle(const std::string& aHandle)
{
    if (aHandle.size() < 2 || aHandle.size() > 8 || aHandle[0] != 'a')
    {
        return false;
    }
    return std::all_of(aHandle.begin() + 1, aHandle.end(), [](char c) { return c >= '0' && c <= '9'; });
}

Declaration ParseDeclaration(const json& aParams, const ActorLookup& aLookup, const Config& aConfig)
{
    params::RequireOnly(aParams, {"id", "kind", "roles", "at", "ttl_s"});
    Declaration d;
    const auto id = params::CheckText(aParams, "id", 64);
    if (!id)
    {
        params::CheckFail("'id' is required: your own text for the incident, kept exactly as given (1 to 64 letters, digits and _ - . : / +)");
    }
    if (!SafeText(*id, 64, false))
    {
        params::CheckFail("'id' is 1 to 64 letters, digits and _ - . : / + only");
    }
    d.id = *id;
    const auto kind = params::CheckText(aParams, "kind", 48);
    if (!kind)
    {
        params::CheckFail("'kind' is required: your own name for what happened, kept exactly as given (1 to 48 letters, digits, spaces and _ - . : / +)");
    }
    if (!SafeText(*kind, 48, true))
    {
        params::CheckFail("'kind' is 1 to 48 letters, digits, single spaces and _ - . : / + only");
    }
    d.kind = *kind;
    const auto roles = aParams.find("roles");
    if (roles != aParams.end() && !roles->is_null() && !roles->is_object())
    {
        params::CheckFail("'roles' maps XF actor handles to role names, e.g. {\"a1\": \"thief\", \"a2\": \"mark\"}");
    }
    if (roles != aParams.end() && roles->is_object())
    {
        if (roles->size() > aConfig.maxRoles)
        {
            throw MethodError("incident_limit", "a declared incident holds at most " + std::to_string(aConfig.maxRoles) + " actors");
        }
        for (const auto& [handle, role] : roles->items())
        {
            if (handle == "v" || handle == "V")
            {
                params::CheckFail("V can't be named in 'roles': a declared incident is about XF actors, and V is the one who witnesses it");
            }
            if (!handle.empty() && handle[0] == 'p')
            {
                params::CheckFail("'" + handle.substr(0, 16) + "' is a picked passer-by; only XF actors (a1, a2, ...) can be named in 'roles'");
            }
            if (!IsActorHandle(handle))
            {
                params::CheckFail("'" + handle.substr(0, 16) + "' isn't an XF actor's handle (a1, a2, ...)");
            }
            if (!role.is_string() || !SafeText(role.get<std::string>(), 32, true))
            {
                params::CheckFail("the role of " + handle + " is 1 to 32 letters, digits, single spaces and _ - . : / + only");
            }
            d.roles.emplace_back(handle, role.get<std::string>());
        }
    }
    if (aParams.contains("at") && !aParams["at"].is_null())
    {
        const auto at = params::CheckPoint(aParams, "at");
        if (!at)
        {
            params::CheckFail("'at' is [x, y, z] in world metres");
        }
        d.hasAt = true;
        std::copy(at->begin(), at->end(), d.at);
    }
    if (d.roles.empty() && !d.hasAt)
    {
        params::CheckFail("'roles' names at least one XF actor, or 'at' gives the place (actors can then join with npc.spawn's incident)");
    }
    d.ttlS = params::CheckNumber(aParams, "ttl_s", aConfig.ttlMinS, aConfig.ttlMaxS).value_or(aConfig.ttlDefaultS);
    // The actors must be the bridge's own now (or spawning); the default place is where they stand.
    double sum[3] = {0, 0, 0};
    int n = 0;
    for (const auto& [handle, role] : d.roles)
    {
        const auto info = aLookup ? aLookup(handle) : ActorInfo{};
        if (!info.exists)
        {
            throw MethodError("npc_not_found", handle + " isn't one of the bridge's actors (npc.status lists them); a declared incident names XF actors only");
        }
        if (info.hasPos)
        {
            for (int i = 0; i < 3; ++i)
            {
                sum[i] += info.pos[i];
            }
            ++n;
        }
    }
    if (!d.hasAt)
    {
        if (n == 0)
        {
            throw MethodError("no_place", "none of the actors has a known place yet (one that is still appearing has none); give 'at'");
        }
        for (int i = 0; i < 3; ++i)
        {
            d.at[i] = sum[i] / n;
        }
        d.hasAt = true;
        d.atFromActors = true;
    }
    return d;
}

Perception Perceive(const Observation& aObservation, const Config& aConfig)
{
    Perception p;
    bool other = false;
    for (const auto& f : aObservation.who)
    {
        if (!f.isV)
        {
            other = true;
        }
    }
    if (!other && !aObservation.who.empty())
    {
        p.participantOnly = true; // V's own act: every person in it is V
        return p;
    }
    for (const auto& f : aObservation.who)
    {
        // A person is seen only when every part holds: in V's view, near enough, and a ray from the camera met no static
        // geometry first. A ray that wasn't cast (Unchecked) proves nothing, so it is not a sighting.
        if (f.isV || f.dist < 0 || f.dist > aConfig.seeRangeM || !f.inView || f.los != Los::Clear)
        {
            continue;
        }
        if (!p.saw || f.dist < p.sawDist)
        {
            p.sawDist = f.dist;
            p.sawVia = f.id;
        }
        p.saw = true;
    }
    if (aObservation.radius > 0 && aObservation.vDist >= 0 && aObservation.vDist <= aObservation.radius)
    {
        p.heard = true;
        p.heardDist = aObservation.vDist;
    }
    return p;
}

ListQuery ParseListQuery(const json& aParams)
{
    params::RequireOnly(aParams, {"state", "witnessed", "v_involved", "declared", "id", "limit", "tap"});
    ListQuery q;
    if (const auto state = params::CheckText(aParams, "state", 8))
    {
        if (*state != "open" && *state != "closed" && *state != "any")
        {
            throw MethodError("bad_params", "'state' is open, closed or any");
        }
        q.state = *state;
    }
    q.witnessed = params::CheckBoolean(aParams, "witnessed");
    q.vInvolved = params::CheckBoolean(aParams, "v_involved");
    q.declared = params::CheckBoolean(aParams, "declared");
    q.declaredId = params::CheckText(aParams, "id", 64).value_or(std::string());
    q.limit = static_cast<size_t>(params::CheckInteger(aParams, "limit", 1, 64).value_or(20));
    return q;
}

Service::Service(Config aConfig) : m_config(aConfig) {}

void Service::SetWorld(uint64_t aWorld)
{
    std::scoped_lock lock(m_mutex);
    m_world = aWorld;
}

uint64_t Service::World() const
{
    std::scoped_lock lock(m_mutex);
    return m_world;
}

void Service::NoteInvalid()
{
    std::scoped_lock lock(m_mutex);
    ++m_stats.observed;
    ++m_stats.droppedInvalid;
}

Stats Service::GetStats() const
{
    std::scoped_lock lock(m_mutex);
    return m_stats;
}

Kind Service::Resolve(const Incident& aIncident)
{
    const auto has = [&](const char* name) { return aIncident.evidence.count(name) > 0; };
    if (has("reprimand"))
    {
        return Kind::PoliceStop;
    }
    if (has("theft"))
    {
        return Kind::Theft;
    }
    int attackers = 0, victims = 0, both = 0;
    for (const auto& p : aIncident.parts)
    {
        const bool a = (p.fact.roles & kAggressor) != 0, v = (p.fact.roles & kVictim) != 0;
        attackers += a ? 1 : 0;
        victims += v ? 1 : 0;
        both += a && v ? 1 : 0;
    }
    if (attackers == 0 && (has("collision") || has("vehicle_hit")))
    {
        return Kind::Accident;
    }
    if (both > 0 || (attackers >= 2 && victims >= 1))
    {
        return Kind::StreetFight;
    }
    if (attackers >= 1 && victims >= 1)
    {
        return Kind::Assault;
    }
    if (has("gunshot") || has("explosion"))
    {
        return Kind::Gunfire;
    }
    return Kind::Other;
}

double Service::Confidence(const Incident& aIncident) const
{
    double base = 0;
    if (aIncident.saw && aIncident.heard)
    {
        base = 0.95;
    }
    else if (aIncident.saw)
    {
        base = 0.9;
    }
    else if (aIncident.heard)
    {
        base = aIncident.heardNonVoice ? 0.6 : 0.4;
    }
    return Round(base * (0.6 + 0.4 * std::min(1.0, aIncident.score / 3.0)));
}

json Service::Describe(const Incident& aIncident) const
{
    json participants = json::array();
    for (const auto& p : aIncident.parts)
    {
        json item = {{"entity", p.fact.id},
                     {"record", p.fact.record},
                     {"affiliation", p.fact.affiliation.empty() ? json(nullptr) : json(p.fact.affiliation)},
                     {"roles", RoleList(p.fact.roles)},
                     {"is_v", p.fact.isV},
                     {"crowd", p.fact.crowd},
                     {"nearest_m", p.nearest < 0 ? json(nullptr) : json(Round(p.nearest))}};
        if (!p.fact.who.empty())
        {
            item["who"] = p.fact.who;
        }
        if (p.fact.hasPos)
        {
            item["position"] = Pos(p.fact.pos);
        }
        participants.push_back(std::move(item));
    }
    double centre[3] = {0, 0, 0};
    if (aIncident.posN > 0)
    {
        for (int i = 0; i < 3; ++i)
        {
            centre[i] = aIncident.sumPos[i] / aIncident.posN;
        }
    }
    json evidence = json::object();
    for (const auto& [name, n] : aIncident.evidence)
    {
        evidence[name] = n;
    }
    json modes = json::array();
    if (aIncident.saw)
    {
        modes.push_back("saw");
    }
    if (aIncident.heard)
    {
        modes.push_back("heard");
    }
    json perceived = {{"witnessed", Witnessed(aIncident)},
                      {"modes", modes},
                      {"saw", aIncident.saw ? json{{"n", aIncident.sawN}, {"first_sim_s", Round(aIncident.sawFirstSim)}, {"nearest_m", Round(aIncident.sawNearest)}, {"via", aIncident.sawVia}}
                                            : json(nullptr)},
                      {"heard", aIncident.heard ? json{{"n", aIncident.heardN}, {"first_sim_s", Round(aIncident.heardFirstSim)}, {"nearest_m", Round(aIncident.heardNearest)},
                                                       {"radius_m", Round(aIncident.heardRadius)}}
                                                : json(nullptr)},
                      {"told", {{"supported", false}, {"note", "was told comes from dialogue and isn't sensed; the bridge does not report it"}}}};
    json out = {{"schema", "xfb/witness-1"},
                {"incident", IdText(aIncident.number)},
                {"kind", KindName(Resolve(aIncident))},
                {"state", aIncident.open ? "open" : "closed"},
                {"world", aIncident.world},
                {"v_involved", aIncident.vInvolved},
                {"participants", std::move(participants)},
                {"participants_dropped", aIncident.partsDropped},
                {"place", {{"position", Pos(centre)}, {"first", Pos(aIncident.firstPos)}, {"last", Pos(aIncident.lastPos)}, {"district_v", aIncident.district}}},
                {"when", {{"start_sim_s", Round(aIncident.startSim)}, {"end_sim_s", Round(aIncident.lastSim)}, {"duration_s", Round(aIncident.lastSim - aIncident.startSim)},
                          {"start_game_s", aIncident.startGame < 0 ? json(nullptr) : json(Round(aIncident.startGame))},
                          {"end_game_s", aIncident.lastGame < 0 ? json(nullptr) : json(Round(aIncident.lastGame))}}},
                {"perceived", std::move(perceived)},
                {"confidence", Confidence(aIncident)},
                {"evidence", std::move(evidence)},
                {"evidence_score", Round(aIncident.score)},
                {"observations", aIncident.observations},
                {"closed", aIncident.open ? json(nullptr) : json(aIncident.closeReason)},
                {"reported", aIncident.reported},
                {"report_pending", aIncident.reportPending},
                {"report_gap", aIncident.reportGap},
                {"continues", aIncident.continues ? json(IdText(aIncident.continues)) : json(nullptr)},
                {"passive", true}};
    if (!aIncident.merged.empty())
    {
        json merged = json::array();
        for (const auto n : aIncident.merged)
        {
            merged.push_back(IdText(n));
        }
        out["merged"] = std::move(merged);
    }
    if (aIncident.declared.on)
    {
        const auto& d = aIncident.declared;
        out["declared"] = DeclaredJson(aIncident);
        // How the sampler saw it: one count per sample taken (an actor missing from a sample counts once, as missing).
        out["perceived"]["sight"] = {{"samples", d.samples}, {"in_range", d.inRange}, {"in_view", d.inView}, {"blocked", d.blocked},
                                     {"unchecked", d.unchecked}, {"view_unavailable", d.noView}, {"actors_missing", d.missing}};
    }
    return out;
}

json Service::DeclaredJson(const Incident& aIncident)
{
    const auto& d = aIncident.declared;
    json roles = json::object();
    for (const auto& [handle, role] : d.roles)
    {
        roles[handle] = role;
    }
    return {{"id", d.id}, {"kind", d.kind}, {"roles", std::move(roles)}, {"at", Pos(d.at)}, {"ttl_s", Round(d.ttlS)}};
}

// Why a declared incident V never perceived went unperceived, from the furthest the sampler got: no sample at all (it closed before the
// first, or the sampler was not running), the actors not found, no camera of V's own (photo mode), then the chain every sighting must
// pass: in range, in view, with a clear ray.
std::string Service::UnwitnessedReason(const Incident& aIncident)
{
    const auto& d = aIncident.declared;
    if (d.samples == 0)
    {
        return d.missing > 0 ? "actors_missing" : "no_samples";
    }
    if (d.noView == d.samples)
    {
        return "no_view";
    }
    if (d.blocked > 0)
    {
        return "occluded";
    }
    if (d.unchecked > 0)
    {
        return "unchecked";
    }
    if (d.inRange > 0)
    {
        return "not_in_view";
    }
    return "out_of_range";
}

json Service::UnwitnessedEvent(const Incident& aIncident) const
{
    const auto& d = aIncident.declared;
    return {{"event", "witness.unwitnessed"},
            {"schema", "xfb/witness-unwitnessed-1"},
            {"incident", IdText(aIncident.number)},
            {"declared", DeclaredJson(aIncident)},
            {"reason", UnwitnessedReason(aIncident)},
            {"closed", aIncident.closeReason},
            {"world", aIncident.world},
            {"sight", {{"samples", d.samples}, {"in_range", d.inRange}, {"in_view", d.inView}, {"blocked", d.blocked}, {"unchecked", d.unchecked},
                       {"view_unavailable", d.noView}, {"actors_missing", d.missing}}},
            {"observations", aIncident.observations},
            {"when", {{"start_sim_s", Round(aIncident.startSim)}, {"end_sim_s", Round(aIncident.lastSim)}, {"duration_s", Round(aIncident.lastSim - aIncident.startSim)}}},
            {"note", "V neither saw nor heard it: " + UnwitnessedReason(aIncident) + ". The engine's own staging is not sensed by V unless V looked at its actors or the game raised a sound near V."},
            {"passive", true}};
}

void Service::PurgeReportTimes()
{
    while (!m_reportTimes.empty() && m_lastWall - m_reportTimes.front() > 60.0)
    {
        m_reportTimes.pop_front();
    }
}

json Service::BuildReport(const Incident& aIncident) const
{
    auto report = Describe(aIncident);
    report["event"] = "witness.report";
    // The recorder keeps 8 KiB a record: a crowd of people shrinks to eight, then loses its positions.
    if (SerializeJson(report).size() > 7000)
    {
        auto& list = report["participants"];
        while (list.size() > 8)
        {
            list.erase(list.size() - 1);
        }
        report["truncated"] = true;
    }
    if (SerializeJson(report).size() > 7000)
    {
        for (auto& p : report["participants"])
        {
            p.erase("position");
            p.erase("record");
        }
    }
    return report;
}

void Service::DrainPending(std::vector<json>& aReports)
{
    PurgeReportTimes();
    while (!m_pending.empty() && m_reportTimes.size() < m_config.maxReportsPerMinute)
    {
        auto entry = std::move(m_pending.front());
        m_pending.pop_front();
        m_reportTimes.push_back(m_lastWall);
        entry.report["reported"] = true;
        entry.report["report_pending"] = false;
        entry.report["delayed"] = true;
        for (auto& closed : m_closed)
        {
            if (closed.number == entry.number)
            {
                closed.reported = true;
                closed.reportPending = false;
            }
        }
        ++m_stats.reports;
        ++m_stats.reportsDelayed;
        aReports.push_back(std::move(entry.report));
    }
}

void Service::RetainGap(const json& aGap)
{
    m_gaps.push_back(aGap);
    while (m_gaps.size() > 64)
    {
        m_gaps.pop_front();
    }
}

size_t Service::PendingCount() const
{
    std::scoped_lock lock(m_mutex);
    return m_pending.size();
}

std::vector<json> Service::ResolvePending(bool aTransportUp, const std::string& aCause)
{
    std::vector<json> out;
    std::scoped_lock lock(m_mutex);
    while (!m_pending.empty())
    {
        auto entry = std::move(m_pending.front());
        m_pending.pop_front();
        Incident* kept = nullptr;
        for (auto& closed : m_closed)
        {
            if (closed.number == entry.number)
            {
                kept = &closed;
            }
        }
        if (aTransportUp)
        {
            entry.report["reported"] = true;
            entry.report["report_pending"] = false;
            entry.report["delayed"] = true;
            entry.report["resolved_by"] = aCause;
            if (kept)
            {
                kept->reported = true;
                kept->reportPending = false;
            }
            ++m_stats.reports;
            ++m_stats.reportsDelayed;
            out.push_back(std::move(entry.report));
            continue;
        }
        const auto& r = entry.report;
        json gap = {{"event", "witness.gap"},
                    {"schema", "xfb/witness-gap-1"},
                    {"incident", r.value("incident", std::string())},
                    {"kind", r.value("kind", std::string("other"))},
                    {"world", r.value("world", uint64_t{0})},
                    {"modes", r.contains("perceived") ? r["perceived"].value("modes", json::array()) : json::array()},
                    {"v_involved", r.value("v_involved", false)},
                    {"reason", "transport_down"},
                    {"closed_by", aCause},
                    {"note", "this incident was witnessed and its report was still waiting for the minute's allowance when " + aCause + " ended delivery; it is kept here"},
                    {"passive", true}};
        if (r.contains("declared"))
        {
            gap["declared"] = r["declared"];
        }
        if (kept)
        {
            kept->reportPending = false;
            kept->reportGap = true;
        }
        ++m_stats.reportGaps;
        RetainGap(gap);
        out.push_back(std::move(gap));
    }
    return out;
}

std::vector<json> Service::Drain(double aWallS)
{
    std::vector<json> reports;
    std::scoped_lock lock(m_mutex);
    m_lastWall = aWallS;
    DrainPending(reports);
    return reports;
}

bool Service::Admit(const std::string& aEvidence, const std::string& aKey, double aWallS)
{
    std::scoped_lock lock(m_mutex);
    const auto* info = FindEvidence(aEvidence);
    if (!info)
    {
        ++m_stats.tapDroppedCap;
        return false;
    }
    const auto second = static_cast<int64_t>(std::floor(aWallS));
    if (second != m_admitSecond)
    {
        m_admitSecond = second;
        m_admitTotal = 0;
        m_admitWeak = 0;
        m_admitKeys.clear();
    }
    const std::string key = aEvidence + ":" + aKey;
    auto found = std::find_if(m_admitKeys.begin(), m_admitKeys.end(), [&](const auto& item) { return item.first == key; });
    // Checked in this order so that a burst from one entity is counted as repeats, not as the cap, and never uses up the room
    // other evidence needs.
    if (found != m_admitKeys.end() && found->second >= m_config.maxPerKeyPerSecond)
    {
        ++m_stats.tapDroppedRepeat;
        return false;
    }
    if (m_admitTotal >= m_config.maxBuiltPerSecond)
    {
        ++m_stats.tapDroppedCap;
        return false;
    }
    const bool weak = info->weight < 1.0;
    if (weak && m_admitWeak >= m_config.maxWeakBuiltPerSecond)
    {
        ++m_stats.tapDroppedWeak;
        return false;
    }
    ++m_admitTotal;
    m_admitWeak += weak ? 1 : 0;
    if (found != m_admitKeys.end())
    {
        ++found->second;
    }
    else
    {
        m_admitKeys.emplace_back(key, 1);
    }
    ++m_stats.tapAdmitted;
    return true;
}

void Service::Close(Incident& aIncident, const std::string& aReason, std::vector<json>& aReports)
{
    aIncident.open = false;
    aIncident.closeReason = aReason;
    ++m_stats.closed;
    // A declared incident is the engine's own: it is reported whatever its evidence score (a silent staging has none), and one V never
    // perceived is said so explicitly, with the reason, instead of being left out.
    const bool declared = aIncident.declared.on;
    if (declared)
    {
        ++m_stats.declaredClosed;
        aIncident.lastSim = std::max(aIncident.lastSim, m_lastSim);
    }
    if (!Witnessed(aIncident))
    {
        ++m_stats.unwitnessed;
        if (declared)
        {
            ++m_stats.declaredUnwitnessed;
            aReports.push_back(UnwitnessedEvent(aIncident));
        }
    }
    else if (!declared && aIncident.score < m_config.minScore)
    {
        ++m_stats.belowScore;
    }
    else
    {
        // A witnessed incident gets its report or a visible gap, never silence. Over the minute's allowance the report waits in a
        // bounded queue and goes out as the allowance recovers; if the queue is full too, a witness.gap event names the incident.
        PurgeReportTimes();
        auto report = BuildReport(aIncident);
        if (m_pending.empty() && m_reportTimes.size() < m_config.maxReportsPerMinute)
        {
            m_reportTimes.push_back(m_lastWall);
            aIncident.reported = true;
            report["reported"] = true;
            ++m_stats.reports;
            aReports.push_back(std::move(report));
        }
        else if (m_pending.size() < m_config.maxPendingReports)
        {
            aIncident.reportPending = true;
            report["report_pending"] = true;
            m_pending.push_back({aIncident.number, std::move(report)});
            ++m_stats.reportsQueued;
        }
        else
        {
            aIncident.reportGap = true;
            ++m_stats.reportGaps;
            json gap = {{"event", "witness.gap"},
                        {"schema", "xfb/witness-gap-1"},
                        {"incident", IdText(aIncident.number)},
                        {"kind", KindName(Resolve(aIncident))},
                        {"world", aIncident.world},
                        {"modes", report["perceived"]["modes"]},
                        {"v_involved", aIncident.vInvolved},
                        {"reason", "report_queue_full"},
                        {"queue_limit", m_config.maxPendingReports},
                        {"note", "this incident was witnessed and its report was lost: the reports waiting for the minute's allowance filled the queue"},
                        {"passive", true}};
            if (declared)
            {
                gap["declared"] = DeclaredJson(aIncident);
            }
            RetainGap(gap);
            aReports.push_back(std::move(gap));
        }
    }
    m_closed.push_back(aIncident);
    while (m_closed.size() > m_config.maxClosed)
    {
        m_closed.pop_front();
    }
}

void Service::CloseExpired(double aSimS, std::vector<json>& aReports)
{
    std::vector<Incident> expired;
    for (size_t i = 0; i < m_open.size();)
    {
        if (!m_open[i].declared.on && aSimS - m_open[i].lastSim > m_config.quietS)
        {
            expired.push_back(std::move(m_open[i]));
            m_open.erase(m_open.begin() + static_cast<std::ptrdiff_t>(i));
        }
        else
        {
            ++i;
        }
    }
    std::sort(expired.begin(), expired.end(), [](const Incident& a, const Incident& b) { return a.number < b.number; });
    for (auto& incident : expired)
    {
        Close(incident, "quiet", aReports);
    }
}

void Service::CloseEverything(const std::string& aReason, std::vector<json>& aReports)
{
    std::vector<Incident> all = std::move(m_open);
    m_open.clear();
    std::sort(all.begin(), all.end(), [](const Incident& a, const Incident& b) { return a.number < b.number; });
    for (auto& incident : all)
    {
        Close(incident, aReason, aReports);
    }
}

// The simulation clock moves on. One that went back is a load or a reset, and nothing open can continue across it.
void Service::AdvanceClock(double aSimS, std::vector<json>& aReports)
{
    if (m_haveSim && aSimS + 5.0 < m_lastSim)
    {
        CloseEverything("clock_reset", aReports);
        m_lastSim = aSimS;
    }
    else
    {
        m_lastSim = m_haveSim ? std::max(m_lastSim, aSimS) : aSimS;
    }
    m_haveSim = true;
    CloseExpired(m_lastSim, aReports);
    CloseOverlong(aReports);
    CloseDeclaredExpired(aReports);
    DrainPending(aReports);
}

// A declared incident's TTL runs in simulation seconds from the clock it was declared at (or, declared before any clock was known,
// from the first clock that arrives), so a paused game ages nothing. It runs from its own anchor, never from startSim: a merge moves
// startSim back to the older incident's start (the evidence timeline), and the TTL must not move with it. The clock arrives with every tick, so an expiry is noticed
// within a second.
void Service::CloseDeclaredExpired(std::vector<json>& aReports)
{
    std::vector<Incident> expired;
    for (size_t i = 0; i < m_open.size();)
    {
        auto& incident = m_open[i];
        if (incident.declared.on && !incident.declared.anchored)
        {
            incident.declared.anchored = true;
            incident.declared.anchorSim = m_lastSim;
            incident.startSim = incident.lastSim = m_lastSim;
        }
        if (incident.declared.on && m_lastSim - incident.declared.anchorSim >= incident.declared.ttlS)
        {
            expired.push_back(std::move(incident));
            m_open.erase(m_open.begin() + static_cast<std::ptrdiff_t>(i));
        }
        else
        {
            ++i;
        }
    }
    std::sort(expired.begin(), expired.end(), [](const Incident& a, const Incident& b) { return a.number < b.number; });
    for (auto& incident : expired)
    {
        Close(incident, "ttl", aReports);
    }
}

// An incident that has run for maxOpenS is closed as the clock advances (a tick or an observation, before that observation is
// assigned), so the next part starts fresh and names it in continues.
void Service::CloseOverlong(std::vector<json>& aReports)
{
    std::vector<Incident> over;
    for (size_t i = 0; i < m_open.size();)
    {
        if (!m_open[i].declared.on && m_lastSim - m_open[i].startSim >= m_config.maxOpenS)
        {
            over.push_back(std::move(m_open[i]));
            m_open.erase(m_open.begin() + static_cast<std::ptrdiff_t>(i));
        }
        else
        {
            ++i;
        }
    }
    std::sort(over.begin(), over.end(), [](const Incident& a, const Incident& b) { return a.number < b.number; });
    for (auto& incident : over)
    {
        Close(incident, "max_duration", aReports);
    }
}

std::vector<json> Service::Tick(double aSimS, double aWallS)
{
    std::vector<json> reports;
    std::scoped_lock lock(m_mutex);
    m_lastWall = aWallS;
    if (std::isfinite(aSimS))
    {
        AdvanceClock(aSimS, reports);
    }
    return reports;
}

std::vector<json> Service::CloseAll(const std::string& aReason)
{
    std::vector<json> reports;
    std::scoped_lock lock(m_mutex);
    CloseEverything(aReason, reports);
    return reports;
}

void Service::MergeInto(Incident& aInto, Incident& aFrom)
{
    for (auto& p : aFrom.parts)
    {
        auto found = std::find_if(aInto.parts.begin(), aInto.parts.end(), [&](const Participant& q) {
            return (!p.fact.id.empty() && q.fact.id == p.fact.id) || (!p.fact.who.empty() && q.fact.who == p.fact.who);
        });
        if (found != aInto.parts.end())
        {
            found->fact.roles |= p.fact.roles;
            if (found->fact.id.empty())
            {
                found->fact.id = p.fact.id;
            }
            found->seen += p.seen;
            if (p.nearest >= 0 && (found->nearest < 0 || p.nearest < found->nearest))
            {
                found->nearest = p.nearest;
            }
        }
        else if (aInto.parts.size() < m_config.maxParticipants)
        {
            aInto.parts.push_back(p);
        }
        else
        {
            ++aInto.partsDropped;
            ++m_stats.participantsDropped;
        }
    }
    aInto.partsDropped += aFrom.partsDropped;
    for (const auto& [name, n] : aFrom.evidence)
    {
        aInto.evidence[name] += n;
    }
    aInto.score += aFrom.score;
    aInto.observations += aFrom.observations;
    if (aFrom.startSim < aInto.startSim)
    {
        aInto.startSim = aFrom.startSim;
        aInto.startGame = aFrom.startGame;
        std::copy(aFrom.firstPos, aFrom.firstPos + 3, aInto.firstPos);
    }
    if (aFrom.lastSim > aInto.lastSim)
    {
        aInto.lastSim = aFrom.lastSim;
        aInto.lastGame = aFrom.lastGame;
        std::copy(aFrom.lastPos, aFrom.lastPos + 3, aInto.lastPos);
        if (!aFrom.district.empty())
        {
            aInto.district = aFrom.district;
        }
    }
    for (int i = 0; i < 3; ++i)
    {
        aInto.sumPos[i] += aFrom.sumPos[i];
    }
    aInto.posN += aFrom.posN;
    if (aFrom.saw)
    {
        if (!aInto.saw || aFrom.sawFirstSim < aInto.sawFirstSim)
        {
            aInto.sawFirstSim = aFrom.sawFirstSim;
        }
        if (!aInto.saw || aFrom.sawNearest < aInto.sawNearest)
        {
            aInto.sawNearest = aFrom.sawNearest;
            aInto.sawVia = aFrom.sawVia;
        }
        aInto.saw = true;
        aInto.sawN += aFrom.sawN;
    }
    if (aFrom.heard)
    {
        if (!aInto.heard || aFrom.heardFirstSim < aInto.heardFirstSim)
        {
            aInto.heardFirstSim = aFrom.heardFirstSim;
        }
        if (!aInto.heard || aFrom.heardNearest < aInto.heardNearest)
        {
            aInto.heardNearest = aFrom.heardNearest;
        }
        aInto.heardRadius = std::max(aInto.heardRadius, aFrom.heardRadius);
        aInto.heard = true;
        aInto.heardN += aFrom.heardN;
        aInto.heardNonVoice = aInto.heardNonVoice || aFrom.heardNonVoice;
    }
    aInto.vInvolved = aInto.vInvolved || aFrom.vInvolved;
    aInto.merged.push_back(aFrom.number);
    for (const auto n : aFrom.merged)
    {
        aInto.merged.push_back(n);
    }
    if (!aInto.continues)
    {
        aInto.continues = aFrom.continues;
    }
    ++m_stats.merged;
}

void Service::Absorb(Incident& aIncident, const Observation& aObservation)
{
    const auto* info = FindEvidence(aObservation.evidence);
    ++aIncident.observations;
    ++aIncident.evidence[aObservation.evidence];
    aIncident.score += info ? info->weight : 0.0;
    if (aObservation.simS < aIncident.startSim)
    {
        aIncident.startSim = aObservation.simS;
        if (aObservation.gameS >= 0)
        {
            aIncident.startGame = aObservation.gameS;
        }
    }
    if (aObservation.simS >= aIncident.lastSim)
    {
        aIncident.lastSim = aObservation.simS;
        if (aObservation.gameS >= 0)
        {
            aIncident.lastGame = aObservation.gameS;
        }
    }
    if (aIncident.startGame < 0 && aObservation.gameS >= 0)
    {
        aIncident.startGame = aObservation.gameS;
    }
    double place[3] = {0, 0, 0};
    bool hasPlace = aObservation.hasPos;
    if (hasPlace)
    {
        std::copy(aObservation.pos, aObservation.pos + 3, place);
    }
    else
    {
        for (const auto& f : aObservation.who)
        {
            if (f.hasPos)
            {
                std::copy(f.pos, f.pos + 3, place);
                hasPlace = true;
                break;
            }
        }
    }
    if (hasPlace)
    {
        if (aIncident.posN == 0)
        {
            std::copy(place, place + 3, aIncident.firstPos);
        }
        std::copy(place, place + 3, aIncident.lastPos);
        for (int i = 0; i < 3; ++i)
        {
            aIncident.sumPos[i] += place[i];
        }
        ++aIncident.posN;
    }
    if (!aObservation.district.empty())
    {
        aIncident.district = aObservation.district;
    }
    AbsorbPeople(aIncident, aObservation.who);
    ApplyPerception(aIncident, Perceive(aObservation, m_config), aObservation);
}

// The people of an observation or a sight sample, into the incident's participants. An XF actor is found by its handle as well as by
// its entity id, so a declared incident's actors (known by handle alone until the game shows them) are one participant each.
void Service::AbsorbPeople(Incident& aIncident, const std::vector<Fact>& aWho)
{
    for (const auto& f : aWho)
    {
        if (f.isV)
        {
            aIncident.vInvolved = true;
        }
        auto found = std::find_if(aIncident.parts.begin(), aIncident.parts.end(), [&](const Participant& p) {
            return f.isV ? p.fact.isV : ((!f.id.empty() && p.fact.id == f.id) || (!f.who.empty() && p.fact.who == f.who));
        });
        if (found == aIncident.parts.end())
        {
            if (aIncident.parts.size() >= m_config.maxParticipants)
            {
                ++aIncident.partsDropped;
                ++m_stats.participantsDropped;
                continue;
            }
            Participant p;
            p.fact = f;
            p.nearest = f.dist;
            p.seen = 1;
            aIncident.parts.push_back(std::move(p));
            continue;
        }
        found->fact.roles |= f.roles;
        ++found->seen;
        if (f.hasPos)
        {
            found->fact.hasPos = true;
            std::copy(f.pos, f.pos + 3, found->fact.pos);
        }
        if (f.dist >= 0 && (found->nearest < 0 || f.dist < found->nearest))
        {
            found->nearest = f.dist;
        }
        if (found->fact.id.empty()) found->fact.id = f.id;
        if (found->fact.record.empty()) found->fact.record = f.record;
        if (found->fact.affiliation.empty()) found->fact.affiliation = f.affiliation;
        if (found->fact.who.empty()) found->fact.who = f.who;
        found->fact.crowd = found->fact.crowd || f.crowd;
    }
}

void Service::ApplyPerception(Incident& aIncident, const Perception& p, const Observation& aObservation)
{
    if (p.saw)
    {
        if (!aIncident.saw || aObservation.simS < aIncident.sawFirstSim)
        {
            aIncident.sawFirstSim = aObservation.simS;
        }
        if (!aIncident.saw || p.sawDist < aIncident.sawNearest)
        {
            aIncident.sawNearest = p.sawDist;
            aIncident.sawVia = p.sawVia;
        }
        aIncident.saw = true;
        ++aIncident.sawN;
    }
    if (p.heard)
    {
        if (!aIncident.heard || aObservation.simS < aIncident.heardFirstSim)
        {
            aIncident.heardFirstSim = aObservation.simS;
        }
        if (!aIncident.heard || p.heardDist < aIncident.heardNearest)
        {
            aIncident.heardNearest = p.heardDist;
        }
        aIncident.heardRadius = std::max(aIncident.heardRadius, aObservation.radius);
        aIncident.heard = true;
        ++aIncident.heardN;
        aIncident.heardNonVoice = aIncident.heardNonVoice || aObservation.evidence != "voice";
    }
}

Outcome Service::Observe(const Observation& aObservation, double aWallS)
{
    Outcome out;
    std::scoped_lock lock(m_mutex);
    m_lastWall = aWallS;
    ++m_stats.observed;
    const auto second = static_cast<int64_t>(std::floor(aWallS));
    if (second != m_rateSecond)
    {
        m_rateSecond = second;
        m_rateCount = 0;
    }
    if (m_rateCount >= m_config.maxObservationsPerSecond)
    {
        ++m_stats.droppedRate;
        out.reason = "rate";
        return out;
    }
    ++m_rateCount;
    if (!std::isfinite(aObservation.simS))
    {
        ++m_stats.droppedInvalid;
        out.reason = "invalid";
        return out;
    }
    AdvanceClock(aObservation.simS, out.reports);

    double place[3] = {0, 0, 0};
    bool hasPlace = aObservation.hasPos;
    if (hasPlace)
    {
        std::copy(aObservation.pos, aObservation.pos + 3, place);
    }
    else
    {
        for (const auto& f : aObservation.who)
        {
            if (f.hasPos)
            {
                std::copy(f.pos, f.pos + 3, place);
                hasPlace = true;
                break;
            }
        }
    }
    if (!hasPlace)
    {
        ++m_stats.droppedNoPlace;
        out.reason = "no_place";
        return out;
    }

    // Rule 0 (0.8.21): a declared incident holds its actors by handle, and only those explicit roles choose it: the declared incident
    // that holds the most of the observation's actors (the oldest on a tie). What an incident has merely accumulated (a past
    // participant, an entity id it learned) never competes with another declaration's explicit actor, so after one observation naming
    // a1 and a2 together a later a2-only observation still goes to the incident that declared a2.
    // Rule 1: open incidents already holding one of its people by entity id (V excluded); declared ones only when no explicit role
    // matched at all. A declared incident is the keeper of any ordinary incident that shares people with the observation (the
    // ordinary one merges into it, keeping its id and kind); two declared incidents are never merged.
    uint64_t explicitTarget = 0;
    int explicitBest = 0;
    for (const auto& incident : m_open)
    {
        if (!incident.declared.on)
        {
            continue;
        }
        int held = 0;
        std::vector<std::string> counted;
        for (const auto& f : aObservation.who)
        {
            if (f.isV || f.who.empty() || std::find(counted.begin(), counted.end(), f.who) != counted.end())
            {
                continue;
            }
            if (std::any_of(incident.declared.roles.begin(), incident.declared.roles.end(), [&](const auto& r) { return r.first == f.who; }))
            {
                ++held;
                counted.push_back(f.who);
            }
        }
        if (held > explicitBest || (held == explicitBest && held > 0 && incident.number < explicitTarget))
        {
            explicitBest = held;
            explicitTarget = incident.number;
        }
    }
    std::vector<uint64_t> shared;
    for (const auto& incident : m_open)
    {
        if (incident.declared.on && explicitTarget)
        {
            continue; // an explicit role has chosen; accumulated participants do not compete
        }
        bool hit = false;
        for (const auto& f : aObservation.who)
        {
            if (!f.isV && !f.id.empty() && std::any_of(incident.parts.begin(), incident.parts.end(), [&](const Participant& p) { return p.fact.id == f.id; }))
            {
                hit = true;
                break;
            }
        }
        if (hit)
        {
            shared.push_back(incident.number);
        }
    }
    const auto byNumber = [&](uint64_t number) -> Incident* {
        for (auto& incident : m_open)
        {
            if (incident.number == number)
            {
                return &incident;
            }
        }
        return nullptr;
    };
    uint64_t target = 0;
    if (explicitTarget)
    {
        target = explicitTarget;
        for (const auto number : shared)
        {
            Incident* from = byNumber(number);
            Incident* into = byNumber(target);
            if (from && into && !from->declared.on)
            {
                MergeInto(*into, *from);
                m_open.erase(m_open.begin() + (from - m_open.data()));
            }
        }
    }
    else if (!shared.empty())
    {
        std::sort(shared.begin(), shared.end());
        target = shared.front();
        for (const auto number : shared)
        {
            const Incident* candidate = byNumber(number);
            if (candidate && candidate->declared.on)
            {
                target = number; // the oldest declared one
                break;
            }
        }
        for (const auto number : shared)
        {
            Incident* from = byNumber(number);
            Incident* into = byNumber(target);
            if (number != target && from && into && !from->declared.on)
            {
                MergeInto(*into, *from);
                m_open.erase(m_open.begin() + (from - m_open.data()));
            }
        }
    }
    else
    {
        // Rule 2: the nearest open incident whose last place is close enough. A declared incident belongs to its actors: strangers
        // near it do not join it.
        double best = m_config.joinRadiusM;
        for (const auto& incident : m_open)
        {
            const double d = Distance(place, incident.lastPos);
            if (!incident.declared.on && d <= best)
            {
                best = d;
                target = incident.number;
            }
        }
    }
    Incident* incident = target ? byNumber(target) : nullptr;
    if (!incident)
    {
        if (m_open.size() >= m_config.maxOpen && !EvictOne(out.reports))
        {
            // Only declared incidents are open (a tiny maxOpen): nothing may be evicted, so this observation is not kept.
            ++m_stats.droppedInvalid;
            out.reason = "full";
            return out;
        }
        Incident fresh;
        fresh.number = m_next++;
        fresh.world = m_world;
        fresh.startSim = fresh.lastSim = aObservation.simS;
        fresh.startGame = fresh.lastGame = aObservation.gameS;
        std::copy(place, place + 3, fresh.firstPos);
        std::copy(place, place + 3, fresh.lastPos);
        // A part of a long incident that was split names the one it continues: the nearest recently split one in this place or
        // holding one of these people.
        int scanned = 0;
        for (auto it = m_closed.rbegin(); it != m_closed.rend() && scanned < 8; ++it, ++scanned)
        {
            if (it->closeReason != "max_duration" || aObservation.simS - it->lastSim > m_config.quietS || it->world != m_world)
            {
                continue;
            }
            bool same = Distance(place, it->lastPos) <= m_config.joinRadiusM;
            for (const auto& f : aObservation.who)
            {
                for (const auto& p : it->parts)
                {
                    same = same || (!f.isV && !f.id.empty() && p.fact.id == f.id);
                }
            }
            if (same)
            {
                fresh.continues = it->number;
                break;
            }
        }
        m_open.push_back(std::move(fresh));
        incident = &m_open.back();
        ++m_stats.opened;
    }
    Absorb(*incident, aObservation);
    out.accepted = true;
    out.incident = IdText(incident->number);
    ++m_stats.accepted;
    return out;
}

// The least recently active ordinary incident goes to make room; it is closed (and reported if it earned one), never silently lost. A
// declared incident is the engine's and is never the one: false when nothing else is open.
bool Service::EvictOne(std::vector<json>& aReports)
{
    int victim = -1;
    for (size_t i = 0; i < m_open.size(); ++i)
    {
        if (m_open[i].declared.on)
        {
            continue;
        }
        if (victim < 0 || m_open[i].lastSim < m_open[victim].lastSim || (m_open[i].lastSim == m_open[victim].lastSim && m_open[i].number < m_open[victim].number))
        {
            victim = static_cast<int>(i);
        }
    }
    if (victim < 0)
    {
        return false;
    }
    Incident gone = std::move(m_open[victim]);
    m_open.erase(m_open.begin() + victim);
    Close(gone, "evicted", aReports);
    ++m_stats.evictedOpen;
    return true;
}

Service::Incident* Service::FindDeclaredOpen(const std::string& aId)
{
    for (auto& incident : m_open)
    {
        if (incident.declared.on && incident.declared.id == aId)
        {
            return &incident;
        }
    }
    return nullptr;
}

DeclareOutcome Service::Declare(const Declaration& aDeclaration, double aWallS)
{
    DeclareOutcome out;
    std::scoped_lock lock(m_mutex);
    m_lastWall = aWallS;
    if (FindDeclaredOpen(aDeclaration.id))
    {
        throw MethodError("duplicate_id", "an incident is open under the id '" + aDeclaration.id + "'; close it (incidents.close) or use another id");
    }
    for (const auto& closed : m_closed)
    {
        if (closed.declared.on && closed.declared.id == aDeclaration.id)
        {
            throw MethodError("duplicate_id", "the id '" + aDeclaration.id + "' was used by " + IdText(closed.number) + ", closed (" + closed.closeReason +
                                                  "); the bridge still remembers it, so use another id");
        }
    }
    if (aDeclaration.roles.size() > m_config.maxRoles)
    {
        throw MethodError("incident_limit", "a declared incident holds at most " + std::to_string(m_config.maxRoles) + " actors");
    }
    size_t declaredOpen = 0;
    for (const auto& incident : m_open)
    {
        declaredOpen += incident.declared.on ? 1 : 0;
    }
    if (declaredOpen >= m_config.maxDeclared)
    {
        throw MethodError("incident_limit", std::to_string(m_config.maxDeclared) + " declared incidents are open already (the sight sampler's bound); close one first");
    }
    if (m_open.size() >= m_config.maxOpen && !EvictOne(out.reports))
    {
        throw MethodError("incident_limit", "no room for another open incident");
    }
    Incident fresh;
    fresh.number = m_next++;
    fresh.world = m_world;
    fresh.startSim = fresh.lastSim = m_haveSim ? m_lastSim : 0.0;
    fresh.startGame = fresh.lastGame = -1;
    auto& d = fresh.declared;
    d.on = true;
    d.id = aDeclaration.id;
    d.kind = aDeclaration.kind;
    d.roles = aDeclaration.roles;
    d.hasAt = true;
    std::copy(aDeclaration.at, aDeclaration.at + 3, d.at);
    d.ttlS = aDeclaration.ttlS;
    d.anchored = m_haveSim;
    d.anchorSim = m_haveSim ? m_lastSim : 0.0;
    std::copy(d.at, d.at + 3, fresh.firstPos);
    std::copy(d.at, d.at + 3, fresh.lastPos);
    std::copy(d.at, d.at + 3, fresh.sumPos);
    fresh.posN = 1;
    // The actors are participants from the start (a silent staging has no observation to name them): by handle until the game shows them.
    for (const auto& [handle, role] : d.roles)
    {
        Participant p;
        p.fact.who = handle;
        fresh.parts.push_back(std::move(p));
    }
    const auto number = fresh.number;
    m_open.push_back(std::move(fresh));
    ++m_stats.opened;
    ++m_stats.declared;
    const auto& made = m_open.back();
    out.declared = {{"incident", IdText(number)}, {"world", m_world}, {"declared", DeclaredJson(made)}, {"ttl_s", Round(made.declared.ttlS)},
                    {"clock_known", m_haveSim}, {"state", "open"}, {"passive", true}};
    return out;
}

CloseOutcome Service::CloseDeclared(const std::string& aId, const std::string& aReason, double aWallS)
{
    CloseOutcome out;
    std::scoped_lock lock(m_mutex);
    m_lastWall = aWallS;
    for (size_t i = 0; i < m_open.size(); ++i)
    {
        if (!m_open[i].declared.on || m_open[i].declared.id != aId)
        {
            continue;
        }
        Incident incident = std::move(m_open[i]);
        m_open.erase(m_open.begin() + static_cast<std::ptrdiff_t>(i));
        out.found = true;
        out.incident = IdText(incident.number);
        Close(incident, aReason, out.reports);
        if (!Witnessed(incident))
        {
            out.outcome = "unwitnessed";
            out.unwitnessedReason = UnwitnessedReason(incident);
        }
        else if (m_closed.back().reportGap)
        {
            out.outcome = "gap";
        }
        else if (m_closed.back().reportPending)
        {
            out.outcome = "report_queued";
        }
        else
        {
            out.outcome = "report";
        }
        return out;
    }
    return out;
}

std::vector<json> Service::CloseAllDeclared(const std::string& aReason)
{
    std::vector<json> reports;
    std::scoped_lock lock(m_mutex);
    std::vector<Incident> declared;
    for (size_t i = 0; i < m_open.size();)
    {
        if (m_open[i].declared.on)
        {
            declared.push_back(std::move(m_open[i]));
            m_open.erase(m_open.begin() + static_cast<std::ptrdiff_t>(i));
        }
        else
        {
            ++i;
        }
    }
    std::sort(declared.begin(), declared.end(), [](const Incident& a, const Incident& b) { return a.number < b.number; });
    for (auto& incident : declared)
    {
        Close(incident, aReason, reports);
    }
    return reports;
}

json Service::JoinDeclared(const std::string& aId, const std::string& aWho, const std::string& aRole, const ActorInfo& aActor)
{
    std::scoped_lock lock(m_mutex);
    auto* incident = FindDeclaredOpen(aId);
    if (!incident)
    {
        throw MethodError("incident_unknown", "no declared incident is open under the id '" + aId.substr(0, 64) + "' (incidents.declare opens one; it may have closed)");
    }
    if (!SafeText(aRole, 32, true))
    {
        throw MethodError("bad_params", "the incident role is 1 to 32 letters, digits, single spaces and _ - . : / + only");
    }
    auto& d = incident->declared;
    if (std::any_of(d.roles.begin(), d.roles.end(), [&](const auto& r) { return r.first == aWho; }))
    {
        throw MethodError("bad_params", aWho + " is in the incident already");
    }
    if (d.roles.size() >= m_config.maxRoles)
    {
        throw MethodError("incident_limit", "a declared incident holds at most " + std::to_string(m_config.maxRoles) + " actors");
    }
    d.roles.emplace_back(aWho, aRole);
    Participant p;
    p.fact.who = aWho;
    if (aActor.hasPos)
    {
        p.fact.hasPos = true;
        std::copy(aActor.pos, aActor.pos + 3, p.fact.pos);
    }
    if (incident->parts.size() < m_config.maxParticipants)
    {
        incident->parts.push_back(std::move(p));
    }
    ++m_stats.joinedBySpawn;
    return {{"incident", IdText(incident->number)}, {"id", d.id}, {"kind", d.kind}, {"role", aRole}, {"who", aWho}};
}

void Service::LeaveDeclared(const std::string& aId, const std::string& aWho)
{
    std::scoped_lock lock(m_mutex);
    auto* incident = FindDeclaredOpen(aId);
    if (!incident)
    {
        return;
    }
    auto& roles = incident->declared.roles;
    const auto before = roles.size();
    roles.erase(std::remove_if(roles.begin(), roles.end(), [&](const auto& r) { return r.first == aWho; }), roles.end());
    auto& parts = incident->parts;
    parts.erase(std::remove_if(parts.begin(), parts.end(), [&](const Participant& p) { return p.fact.who == aWho && p.fact.id.empty(); }), parts.end());
    if (roles.size() < before && m_stats.joinedBySpawn > 0)
    {
        --m_stats.joinedBySpawn;
    }
}

size_t Service::DeclaredOpen() const
{
    std::scoped_lock lock(m_mutex);
    return static_cast<size_t>(std::count_if(m_open.begin(), m_open.end(), [](const Incident& i) { return i.declared.on; }));
}

std::vector<std::string> Service::SightPlan() const
{
    std::scoped_lock lock(m_mutex);
    std::vector<std::string> handles;
    size_t seen = 0;
    for (const auto& incident : m_open)
    {
        if (!incident.declared.on)
        {
            continue;
        }
        if (++seen > m_config.maxDeclared)
        {
            break;
        }
        for (const auto& [handle, role] : incident.declared.roles)
        {
            if (std::find(handles.begin(), handles.end(), handle) == handles.end())
            {
                handles.push_back(handle);
            }
        }
    }
    return handles;
}

SightOutcome Service::Sight(const SightSample& aSample, double aWallS)
{
    SightOutcome out;
    std::scoped_lock lock(m_mutex);
    m_lastWall = aWallS;
    ++m_stats.sightSamples;
    const auto second = static_cast<int64_t>(std::floor(aWallS));
    if (second != m_sightSecond)
    {
        m_sightSecond = second;
        m_sightCount = 0;
    }
    if (m_sightCount >= m_config.maxSightPerSecond)
    {
        ++m_stats.sightDroppedRate;
        out.reason = "rate";
        return out;
    }
    ++m_sightCount;
    if (!std::isfinite(aSample.simS))
    {
        ++m_stats.sightDroppedInvalid;
        out.reason = "invalid";
        return out;
    }
    AdvanceClock(aSample.simS, out.reports);
    out.accepted = true;
    size_t looked = 0;
    for (auto& incident : m_open)
    {
        if (!incident.declared.on)
        {
            continue;
        }
        if (++looked > m_config.maxDeclared)
        {
            break;
        }
        auto& d = incident.declared;
        std::vector<Fact> mine;
        for (const auto& f : aSample.who)
        {
            if (!f.isV && !f.who.empty() && std::any_of(d.roles.begin(), d.roles.end(), [&](const auto& r) { return r.first == f.who; }))
            {
                mine.push_back(f);
            }
        }
        if (mine.empty())
        {
            ++d.missing; // none of its actors could be found: despawned, or not yet appeared
            continue;
        }
        ++d.samples;
        Observation view;
        view.evidence = "sight";
        view.simS = aSample.simS;
        view.who = mine;
        if (aSample.view != "gameplay")
        {
            ++d.noView; // photo mode's camera is not V's view: nothing can be seen through it
        }
        else
        {
            bool inRange = false, inView = false, blocked = false, unchecked = false;
            for (const auto& f : mine)
            {
                if (f.dist < 0 || f.dist > m_config.seeRangeM)
                {
                    continue;
                }
                inRange = true;
                if (!f.inView)
                {
                    continue;
                }
                inView = true;
                blocked = blocked || f.los == Los::Blocked;
                unchecked = unchecked || f.los == Los::Unchecked;
            }
            d.inRange += inRange ? 1 : 0;
            d.inView += inView ? 1 : 0;
            d.blocked += blocked ? 1 : 0;
            d.unchecked += unchecked ? 1 : 0;
            ApplyPerception(incident, Perceive(view, m_config), view);
        }
        AbsorbPeople(incident, mine);
        if (!aSample.district.empty())
        {
            incident.district = aSample.district;
        }
        if (aSample.gameS >= 0)
        {
            incident.lastGame = aSample.gameS;
            if (incident.startGame < 0)
            {
                incident.startGame = aSample.gameS;
            }
        }
        // Where the actors are now: the middle of the ones the sample placed.
        double sum[3] = {0, 0, 0};
        int n = 0;
        for (const auto& f : mine)
        {
            if (f.hasPos)
            {
                for (int i = 0; i < 3; ++i)
                {
                    sum[i] += f.pos[i];
                }
                ++n;
            }
        }
        if (n > 0)
        {
            for (int i = 0; i < 3; ++i)
            {
                incident.lastPos[i] = sum[i] / n;
            }
        }
        incident.lastSim = std::max(incident.lastSim, aSample.simS);
    }
    return out;
}

json Service::List(const ListQuery& aQuery) const
{
    std::scoped_lock lock(m_mutex);
    std::vector<const Incident*> pool;
    if (aQuery.state != "closed")
    {
        for (const auto& incident : m_open)
        {
            pool.push_back(&incident);
        }
    }
    if (aQuery.state != "open")
    {
        for (const auto& incident : m_closed)
        {
            pool.push_back(&incident);
        }
    }
    std::sort(pool.begin(), pool.end(), [](const Incident* a, const Incident* b) { return a->number > b->number; });
    json list = json::array();
    for (const auto* incident : pool)
    {
        if (aQuery.witnessed && Witnessed(*incident) != *aQuery.witnessed)
        {
            continue;
        }
        if (aQuery.vInvolved && incident->vInvolved != *aQuery.vInvolved)
        {
            continue;
        }
        if (aQuery.declared && incident->declared.on != *aQuery.declared)
        {
            continue;
        }
        if (!aQuery.declaredId.empty() && !(incident->declared.on && incident->declared.id == aQuery.declaredId))
        {
            continue;
        }
        if (list.size() >= aQuery.limit)
        {
            break;
        }
        list.push_back(Describe(*incident));
    }
    const auto& s = m_stats;
    return {{"schema", "xfb/incidents-1"},
            {"incidents", std::move(list)},
            {"open", m_open.size()},
            {"kept_closed", m_closed.size()},
            {"pending_reports", m_pending.size()},
            {"retained_gaps", json(std::vector<json>(m_gaps.begin(), m_gaps.end()))},
            {"world", m_world},
            {"sim_s", m_haveSim ? json(Round(m_lastSim)) : json(nullptr)},
            {"stats", {{"observed", s.observed}, {"accepted", s.accepted}, {"dropped_rate", s.droppedRate}, {"dropped_invalid", s.droppedInvalid},
                       {"dropped_no_place", s.droppedNoPlace}, {"opened", s.opened}, {"closed", s.closed}, {"merged", s.merged},
                       {"evicted_open", s.evictedOpen}, {"reports", s.reports}, {"reports_queued", s.reportsQueued}, {"reports_delayed", s.reportsDelayed}, {"report_gaps", s.reportGaps},
                       {"tap_admitted", s.tapAdmitted}, {"tap_dropped_cap", s.tapDroppedCap}, {"tap_dropped_weak", s.tapDroppedWeak}, {"tap_dropped_repeat", s.tapDroppedRepeat},
                       {"unwitnessed", s.unwitnessed}, {"below_score", s.belowScore}, {"participants_dropped", s.participantsDropped},
                       {"declared", s.declared}, {"declared_closed", s.declaredClosed}, {"declared_unwitnessed", s.declaredUnwitnessed}, {"joined_by_spawn", s.joinedBySpawn},
                       {"sight_samples", s.sightSamples}, {"sight_dropped_rate", s.sightDroppedRate}, {"sight_dropped_invalid", s.sightDroppedInvalid}}},
            {"config", ConfigJson(m_config)},
            {"told", {{"supported", false}, {"note", "was told comes from dialogue and isn't sensed"}}},
            {"passive", true}};
}

json Service::Coverage() const
{
    std::scoped_lock lock(m_mutex);
    const auto& s = m_stats;
    return {{"valid", true},
            {"event", "incident.coverage"},
            {"open", m_open.size()},
            {"kept_closed", m_closed.size()},
            {"observed", s.observed},
            {"accepted", s.accepted},
            {"dropped_rate", s.droppedRate},
            {"dropped_invalid", s.droppedInvalid},
            {"reports", s.reports},
            {"reports_queued", s.reportsQueued},
            {"reports_delayed", s.reportsDelayed},
            {"pending_reports", m_pending.size()},
            {"report_gaps", s.reportGaps},
            {"tap_admitted", s.tapAdmitted},
            {"tap_dropped_cap", s.tapDroppedCap},
            {"tap_dropped_weak", s.tapDroppedWeak},
            {"tap_dropped_repeat", s.tapDroppedRepeat},
            {"evicted_open", s.evictedOpen},
            {"declared_open", static_cast<uint64_t>(std::count_if(m_open.begin(), m_open.end(), [](const Incident& i) { return i.declared.on; }))},
            {"declared", s.declared},
            {"declared_unwitnessed", s.declaredUnwitnessed},
            {"sight_samples", s.sightSamples},
            {"sight_dropped_rate", s.sightDroppedRate},
            {"told_supported", false},
            {"passive", true}};
}

namespace
{
void Gate(const MethodHooks& aHooks, const char* aMethod)
{
    if (!aHooks.allowTestHooks)
    {
        throw MethodError("test_hooks_off", std::string(aMethod) + " is a test feature; this build's config.ini has [bridge] allow_test_hooks off (only the -writes package sets it)");
    }
    if (!aHooks.taps)
    {
        throw MethodError("test_hooks_off", std::string(aMethod) + " needs the autonomous -writes test build, which carries the incident taps");
    }
}
double Wall(const MethodHooks& aHooks)
{
    return aHooks.wall ? aHooks.wall() : 0.0;
}
void Emit(const MethodHooks& aHooks, std::vector<json> aReports)
{
    if (aHooks.emit && !aReports.empty())
    {
        aHooks.emit(std::move(aReports));
    }
}
} // namespace

void RegisterMethods(Dispatcher& aDispatcher, Service& aService, MethodHooks aHooks)
{
    aDispatcher.Register({"incidents.list", Access::Read, RunOn::BridgeThread,
                          "What V witnessed: the recent incidents (grouped game events) and whether V saw or heard each; read only.",
                          [&aService, aHooks](const MethodContext& aContext) {
                              Gate(aHooks, "incidents.list");
                              const auto query = ParseListQuery(aContext.params);
                              if (const auto tap = params::CheckBoolean(aContext.params, "tap"))
                              {
                                  aHooks.setTap(*tap);
                              }
                              if (aHooks.sync)
                              {
                                  aHooks.sync();
                              }
                              auto out = aService.List(query);
                              out["tap"] = aHooks.tapOn ? aHooks.tapOn() : true;
                              return out;
                          }});
    aDispatcher.Register({"incidents.declare", Access::Read, RunOn::BridgeThread,
                          "Declares an incident the engine staged with XF actors, so V's report carries its id and kind; opens at once, passive.",
                          [&aService, aHooks](const MethodContext& aContext) {
                              Gate(aHooks, "incidents.declare");
                              if (aHooks.tapOn && !aHooks.tapOn())
                              {
                                  throw MethodError("tap_off", "the incident taps are off (incidents.list {tap: true} switches them on); a declared incident needs them for the clock and the sight samples");
                              }
                              if (aHooks.handedOver && aHooks.handedOver())
                              {
                                  throw MethodError("handed_over", "the session is handed over to the player; a declared incident would be closed at once (session.resume first)");
                              }
                              if (aHooks.sync)
                              {
                                  aHooks.sync();
                              }
                              const auto declaration = ParseDeclaration(aContext.params, aHooks.actor, aService.GetConfig());
                              auto outcome = aService.Declare(declaration, Wall(aHooks));
                              Emit(aHooks, std::move(outcome.reports));
                              json out = outcome.declared["declared"];
                              out["incident"] = outcome.declared["incident"];
                              out["world"] = outcome.declared["world"];
                              out["state"] = "open";
                              out["at_from"] = declaration.atFromActors ? "actors_centroid" : "given";
                              out["clock_known"] = outcome.declared["clock_known"];
                              out["sampling"] = {{"hz", 2}, {"max_incidents", aService.GetConfig().maxDeclared}};
                              out["closes"] = {{"by", json::array({"incidents.close", "ttl", "kill", "load", "handover", "tap_off"})},
                                               {"result", json::array({"witness.report", "witness.gap", "witness.unwitnessed"})}};
                              out["undo"] = {{"method", "incidents.close"}, {"params", {{"id", declaration.id}}}};
                              out["passive"] = true;
                              return out;
                          }});
    aDispatcher.Register({"incidents.close", Access::Read, RunOn::BridgeThread,
                          "Closes a declared incident: one witness.report, a witness.gap, or a witness.unwitnessed with the reason; passive.",
                          [&aService, aHooks](const MethodContext& aContext) {
                              Gate(aHooks, "incidents.close");
                              params::RequireOnly(aContext.params, {"id"});
                              const auto id = params::CheckText(aContext.params, "id", 64);
                              if (!id || id->empty())
                              {
                                  params::CheckFail("'id' is required: the id the incident was declared under");
                              }
                              if (aHooks.sync)
                              {
                                  aHooks.sync();
                              }
                              auto outcome = aService.CloseDeclared(*id, "engine_close", Wall(aHooks));
                              if (!outcome.found)
                              {
                                  throw MethodError("incident_unknown", "no declared incident is open under the id '" + id->substr(0, 64) + "' (it may have closed already: incidents.list {id} shows how)");
                              }
                              json out = {{"closed", true}, {"incident", outcome.incident}, {"id", *id}, {"reason", "engine_close"}, {"outcome", outcome.outcome}, {"passive", true}};
                              if (!outcome.unwitnessedReason.empty())
                              {
                                  out["unwitnessed_reason"] = outcome.unwitnessedReason;
                              }
                              if (outcome.outcome == "report" && !outcome.reports.empty())
                              {
                                  out["report"] = outcome.reports.front();
                              }
                              Emit(aHooks, std::move(outcome.reports));
                              return out;
                          }});
}
} // namespace xfb::incidents
