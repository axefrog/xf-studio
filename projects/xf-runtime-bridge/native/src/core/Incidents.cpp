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
            {"max_reports_per_min", aConfig.maxReportsPerMinute}};
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
    const auto who = aWire.find("who");
    if (who != aWire.end() && !who->is_null())
    {
        if (!who->is_array() || who->size() > kMaxFacts)
        {
            aWhy = "who is a list of at most " + std::to_string(kMaxFacts) + " people";
            return std::nullopt;
        }
        for (const auto& item : *who)
        {
            if (!item.is_object())
            {
                aWhy = "each of who is an object";
                return std::nullopt;
            }
            Fact f;
            std::string role;
            if (!Text(item, "id", 48, f.id, aWhy) || !Text(item, "w", 16, f.who, aWhy) || !Text(item, "rec", 96, f.record, aWhy) ||
                !Text(item, "aff", 48, f.affiliation, aWhy) || !Text(item, "role", 12, role, aWhy) || !Flag(item, "v", f.isV, aWhy) ||
                !Flag(item, "crowd", f.crowd, aWhy) || !Flag(item, "in", f.inView, aWhy) || !Number(item, "d", f.dist, false, aWhy) ||
                !Point(item, "pos", f.hasPos, f.pos, aWhy))
            {
                return std::nullopt;
            }
            f.roles = RoleFromName(role);
            if (!role.empty() && f.roles == 0)
            {
                aWhy = "role '" + role + "' is not a role";
                return std::nullopt;
            }
            if (f.id.empty() && !f.isV)
            {
                aWhy = "a person needs an id";
                return std::nullopt;
            }
            double los = 2;
            if (!Number(item, "los", los, false, aWhy))
            {
                return std::nullopt;
            }
            f.los = los == 0 ? Los::Clear : los == 1 ? Los::Blocked : Los::Unchecked;
            o.who.push_back(std::move(f));
        }
    }
    return o;
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
    params::RequireOnly(aParams, {"state", "witnessed", "v_involved", "limit", "tap"});
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
                {"report_dropped", aIncident.reportDropped},
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
    return out;
}

void Service::Close(Incident& aIncident, const std::string& aReason, std::vector<json>& aReports)
{
    aIncident.open = false;
    aIncident.closeReason = aReason;
    ++m_stats.closed;
    if (!Witnessed(aIncident))
    {
        ++m_stats.unwitnessed;
    }
    else if (aIncident.score < m_config.minScore)
    {
        ++m_stats.belowScore;
    }
    else
    {
        while (!m_reportTimes.empty() && m_lastWall - m_reportTimes.front() > 60.0)
        {
            m_reportTimes.pop_front();
        }
        if (m_reportTimes.size() >= m_config.maxReportsPerMinute)
        {
            aIncident.reportDropped = true;
            ++m_stats.reportsDropped;
        }
        else
        {
            m_reportTimes.push_back(m_lastWall);
            aIncident.reported = true;
            ++m_stats.reports;
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
            aReports.push_back(std::move(report));
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
        if (aSimS - m_open[i].lastSim > m_config.quietS)
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
        auto found = std::find_if(aInto.parts.begin(), aInto.parts.end(), [&](const Participant& q) { return !p.fact.id.empty() && q.fact.id == p.fact.id; });
        if (found != aInto.parts.end())
        {
            found->fact.roles |= p.fact.roles;
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
    for (const auto& f : aObservation.who)
    {
        if (f.isV)
        {
            aIncident.vInvolved = true;
        }
        auto found = std::find_if(aIncident.parts.begin(), aIncident.parts.end(), [&](const Participant& p) {
            return f.isV ? p.fact.isV : (!f.id.empty() && p.fact.id == f.id);
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
        if (found->fact.record.empty()) found->fact.record = f.record;
        if (found->fact.affiliation.empty()) found->fact.affiliation = f.affiliation;
        if (found->fact.who.empty()) found->fact.who = f.who;
        found->fact.crowd = found->fact.crowd || f.crowd;
    }
    const auto p = Perceive(aObservation, m_config);
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

    // Rule 1: open incidents already holding one of its people (V excluded).
    std::vector<uint64_t> shared;
    for (const auto& incident : m_open)
    {
        bool hit = false;
        for (const auto& f : aObservation.who)
        {
            if (f.isV || f.id.empty())
            {
                continue;
            }
            for (const auto& p : incident.parts)
            {
                if (p.fact.id == f.id)
                {
                    hit = true;
                    break;
                }
            }
            if (hit)
            {
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
    if (!shared.empty())
    {
        std::sort(shared.begin(), shared.end());
        target = shared.front();
        for (size_t i = 1; i < shared.size(); ++i)
        {
            Incident* from = byNumber(shared[i]);
            Incident* into = byNumber(target);
            if (from && into)
            {
                MergeInto(*into, *from);
                m_open.erase(m_open.begin() + (from - m_open.data()));
            }
        }
    }
    else
    {
        // Rule 2: the nearest open incident whose last place is close enough.
        double best = m_config.joinRadiusM;
        for (const auto& incident : m_open)
        {
            const double d = Distance(place, incident.lastPos);
            if (d <= best)
            {
                best = d;
                target = incident.number;
            }
        }
    }
    Incident* incident = target ? byNumber(target) : nullptr;
    if (!incident)
    {
        if (m_open.size() >= m_config.maxOpen)
        {
            // The least recently active goes to make room; it is closed (and reported if it earned one), never silently lost.
            size_t victim = 0;
            for (size_t i = 1; i < m_open.size(); ++i)
            {
                if (m_open[i].lastSim < m_open[victim].lastSim || (m_open[i].lastSim == m_open[victim].lastSim && m_open[i].number < m_open[victim].number))
                {
                    victim = i;
                }
            }
            Incident gone = std::move(m_open[victim]);
            m_open.erase(m_open.begin() + static_cast<std::ptrdiff_t>(victim));
            Close(gone, "evicted", out.reports);
            ++m_stats.evictedOpen;
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
    if (incident->lastSim - incident->startSim >= m_config.maxOpenS)
    {
        Incident done = std::move(*incident);
        m_open.erase(m_open.begin() + (incident - m_open.data()));
        Close(done, "max_duration", out.reports);
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
            {"world", m_world},
            {"sim_s", m_haveSim ? json(Round(m_lastSim)) : json(nullptr)},
            {"stats", {{"observed", s.observed}, {"accepted", s.accepted}, {"dropped_rate", s.droppedRate}, {"dropped_invalid", s.droppedInvalid},
                       {"dropped_no_place", s.droppedNoPlace}, {"opened", s.opened}, {"closed", s.closed}, {"merged", s.merged},
                       {"evicted_open", s.evictedOpen}, {"reports", s.reports}, {"reports_dropped", s.reportsDropped},
                       {"unwitnessed", s.unwitnessed}, {"below_score", s.belowScore}, {"participants_dropped", s.participantsDropped}}},
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
            {"reports_dropped", s.reportsDropped},
            {"evicted_open", s.evictedOpen},
            {"told_supported", false},
            {"passive", true}};
}

void RegisterMethods(Dispatcher& aDispatcher, Service& aService, MethodHooks aHooks)
{
    aDispatcher.Register({"incidents.list", Access::Read, RunOn::BridgeThread,
                          "What V witnessed: the recent incidents (grouped game events) and whether V saw or heard each; read only.",
                          [&aService, aHooks](const MethodContext& aContext) {
                              if (!aHooks.allowTestHooks)
                              {
                                  throw MethodError("test_hooks_off", "incidents.list is a test feature; this build's config.ini has [bridge] allow_test_hooks off (only the -writes package sets it)");
                              }
                              if (!aHooks.taps)
                              {
                                  throw MethodError("test_hooks_off", "incidents.list needs the autonomous -writes test build, which carries the incident taps");
                              }
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
}
} // namespace xfb::incidents
