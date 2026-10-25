// Bridge 0.8.20: the incident core (core/Incidents.hpp): the wire form, perception gating, grouping into incidents, kinds, reports and
// the bounds. Offline, with explicit clocks; the game side (the redscript taps) is compiled and linted, not run here.
#include "core/Incidents.hpp"

#include <cmath>
#include <cstdio>

#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Recording.hpp"
#include "core/Session.hpp"

namespace
{
using namespace xfb::incidents;
int checks = 0, failures = 0;
void Check(bool ok, const char* label)
{
    ++checks;
    if (!ok)
    {
        ++failures;
        std::printf("INCIDENT FAIL %s\n", label);
    }
}

// A person as the taps send it: dist, in view and the ray, then the role.
Fact Person(const char* id, uint32_t roles, double x, double dist, bool view = true, Los los = Los::Clear)
{
    Fact f;
    f.id = id;
    f.record = std::string("Character.") + id;
    f.affiliation = "Maelstrom";
    f.roles = roles;
    f.hasPos = true;
    f.pos[0] = x;
    f.dist = dist;
    f.inView = view;
    f.los = los;
    return f;
}
Fact V()
{
    Fact f;
    f.id = "V";
    f.isV = true;
    f.roles = 0;
    return f;
}

Observation Obs(const char* evidence, double sim, double x, std::vector<Fact> who, double radius = 0, double vDist = 50)
{
    Observation o;
    o.evidence = evidence;
    o.type = evidence;
    o.simS = sim;
    o.gameS = 1000 + sim;
    o.hasPos = true;
    o.pos[0] = x;
    o.radius = radius;
    o.vDist = vDist;
    o.district = "Watson_Kabuki";
    o.view = "gameplay";
    o.who = std::move(who);
    return o;
}

json Wire(const char* ev, double sim, json who = json::array())
{
    return {{"ev", ev}, {"type", "Gunshot"}, {"sim", sim}, {"game", 1000 + sim}, {"pos", {1, 2, 3}}, {"radius", 50}, {"vd", 20}, {"dist", "Watson_Kabuki"}, {"view", "gameplay"}, {"who", std::move(who)}};
}

json L(Service& s, const json& params = json::object())
{
    return s.List(ParseListQuery(params));
}

bool Refuses(const json& wire)
{
    std::string why;
    return !ParseObservation(wire, why).has_value() && !why.empty();
}

} // namespace

int IncidentUnitTests()
{
    // ---- the wire form --------------------------------------------------------------------------------------------------
    {
        std::string why;
        const json fact = {{"id", "1"}, {"role", "aggressor"}, {"d", 12.5}, {"in", 1}, {"los", 0}, {"pos", {1, 2, 3}}, {"rec", "Character.x"}, {"aff", "NCPD"}, {"w", "a1"}};
        const auto ok = ParseObservation(Wire("gunshot", 5, json::array({fact})), why);
        Check(ok.has_value() && ok->who.size() == 1 && ok->who[0].roles == kAggressor && ok->who[0].inView && ok->who[0].los == Los::Clear && ok->who[0].dist == 12.5, "wire: a full observation parses");
        Check(ok && ok->who[0].who == "a1" && ok->who[0].affiliation == "NCPD" && ok->radius == 50 && ok->vDist == 20 && ok->district == "Watson_Kabuki", "wire: handle, affiliation, radius, distance and district kept");
        const auto bare = ParseObservation(json{{"ev", "voice"}, {"sim", 1}, {"pos", {0, 0, 0}}}, why);
        Check(bare.has_value() && bare->who.empty() && bare->vDist < 0 && bare->radius == 0, "wire: only ev, sim and a place are needed");
        Check(Refuses(json{{"ev", "dance"}, {"sim", 1}}), "wire: an unknown kind of evidence is refused");
        Check(Refuses(json{{"ev", "gunshot"}}), "wire: no clock is refused");
        Check(Refuses(json{{"ev", "gunshot"}, {"sim", "soon"}}), "wire: a clock that isn't a number is refused");
        Check(Refuses(json{{"ev", "gunshot"}, {"sim", 1e30}}), "wire: a clock out of range is refused");
        Check(Refuses(json::array()), "wire: not an object is refused");
        Check(Refuses(Wire("gunshot", 1, json::array({{{"id", "1"}, {"role", "wizard"}}}))), "wire: an unknown role is refused");
        Check(Refuses(Wire("gunshot", 1, json::array({{{"role", "aggressor"}}}))), "wire: a person without an id is refused");
        Check(Refuses(Wire("gunshot", 1, json::array({{{"id", "1"}, {"in", 7}}}))), "wire: a flag that isn't 0 or 1 is refused");
        Check(Refuses(Wire("gunshot", 1, json::array({{{"id", std::string(60, '9')}}}))), "wire: an overlong id is refused");
        json many = json::array();
        for (int i = 0; i < 5; ++i) many.push_back({{"id", std::to_string(i)}});
        Check(Refuses(Wire("gunshot", 1, many)), "wire: more than four people is refused");
        auto bad = Wire("gunshot", 1);
        bad["radius"] = 5000;
        Check(Refuses(bad), "wire: a radius over 1000 m is refused");
        bad = Wire("gunshot", 1);
        bad["pos"] = json::array({1, 2});
        Check(Refuses(bad), "wire: a place that isn't x, y, z is refused");
        for (const char* name : {"gunshot", "explosion", "melee", "crime", "combat", "death", "collision", "vehicle_hit", "reprimand", "theft", "fear", "body", "voice"})
            Check(FindEvidence(name) != nullptr, "evidence: every tap's name is known");
        Check(FindEvidence("voice")->weight == 0.25 && FindEvidence("gunshot")->weight == 1.0 && FindEvidence("fear")->weight == 0.5, "evidence: the weights");
    }

    // ---- perception: seen only when every part holds, heard inside the audible radius --------------------------------------
    {
        const Config c;
        auto saw = [&](Fact f) { return Perceive(Obs("gunshot", 1, 0, {f}), c).saw; };
        Check(saw(Person("a", kAggressor, 0, 20)), "saw: in view, near, clear");
        Check(!saw(Person("a", kAggressor, 0, 20, false)), "saw: not in V's view is not seen");
        Check(!saw(Person("a", kAggressor, 0, 20, true, Los::Blocked)), "saw: behind static geometry is not seen");
        Check(!saw(Person("a", kAggressor, 0, 20, true, Los::Unchecked)), "saw: a ray that wasn't cast proves nothing");
        Check(!saw(Person("a", kAggressor, 0, 80.5)), "saw: past the see range is not seen");
        Check(saw(Person("a", kAggressor, 0, 80.0)), "saw: exactly at the see range is seen");
        Check(!saw(Person("a", kAggressor, 0, -1)), "saw: an unknown distance is not seen");
        Check(!saw(V()), "saw: V does not see V");
        auto p = Perceive(Obs("gunshot", 1, 0, {Person("far", 0, 0, 60), Person("near", 0, 0, 30)}), c);
        Check(p.saw && p.sawDist == 30 && p.sawVia == "near", "saw: the nearest person seen is named");
        auto heard = [&](double radius, double vDist) { return Perceive(Obs("gunshot", 1, 0, {Person("a", kAggressor, 0, 20, false)}, radius, vDist), c).heard; };
        Check(heard(50, 49.9) && heard(50, 50.0), "heard: inside the stimulus' own radius");
        Check(!heard(50, 50.1), "heard: outside the radius is not heard");
        Check(!heard(0, 1), "heard: a silent observation (radius 0) is never heard");
        Check(!heard(50, -1), "heard: an unknown distance is not heard");
        p = Perceive(Obs("gunshot", 1, 0, {V()}, 50, 0), c);
        Check(p.participantOnly && !p.saw && !p.heard, "V's own act: nothing for V to perceive");
        p = Perceive(Obs("gunshot", 1, 0, {V(), Person("a", kAggressor, 0, 12)}, 50, 12), c);
        Check(p.saw && p.heard && !p.participantOnly, "V and another: the other is perceived");
        Check(!Perceive(Obs("combat", 1, 0, {}, 50, 10), c).saw && Perceive(Obs("explosion", 1, 0, {}, 50, 10), c).heard, "heard: no people is still heard when the radius reaches V");
    }

    // ---- grouping -----------------------------------------------------------------------------------------------------------
    {
        Service s;
        s.SetWorld(1);
        auto r = s.Observe(Obs("gunshot", 100, 0, {Person("A", kAggressor, 0, 15)}, 50, 15), 1.0);
        Check(r.accepted && r.incident == "inc-1" && r.reports.empty(), "group: the first observation opens inc-1");
        r = s.Observe(Obs("gunshot", 104, 3, {Person("A", kAggressor, 3, 15)}, 50, 15), 1.1);
        Check(r.incident == "inc-1", "group: the same shooter, 4 s later, is the same incident");
        r = s.Observe(Obs("gunshot", 105, 12, {Person("B", kAggressor, 12, 15)}, 50, 15), 1.2);
        Check(r.incident == "inc-1", "group: another shooter 12 m from the last place joins by place");
        r = s.Observe(Obs("gunshot", 106, 300, {Person("C", kAggressor, 300, 15)}, 50, 15), 1.3);
        Check(r.incident == "inc-2", "group: a shooter 290 m away opens another incident");
        r = s.Observe(Obs("gunshot", 107, 600, {Person("A", kAggressor, 600, 15)}, 50, 15), 1.4);
        Check(r.incident == "inc-1", "group: a person already in an incident joins it wherever they are");
        Check(L(s) ["open"] == 2, "group: two open incidents");
        // quiet closes (inc-2 went quiet first; the tick at 120 is 14 s after its last observation, 13 s after inc-1's)
        auto reports = s.Tick(120, 2.0);
        Check(reports.size() == 2 && reports[0]["incident"] == "inc-1" && reports[1]["incident"] == "inc-2", "group: the quiet ones close in order and report");
        Check(L(s)["open"] == 0 && L(s)["kept_closed"] == 2, "group: closed incidents are kept");
        Check(reports[0]["closed"] == "quiet" && reports[0]["state"] == "closed" && reports[0]["event"] == "witness.report", "group: reports say why they closed");
    }
    {
        Service s;
        s.Observe(Obs("gunshot", 10, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1);
        s.Observe(Obs("gunshot", 11, 200, {Person("B", kAggressor, 200, 20)}, 50, 20), 1);
        Check(L(s)["open"] == 2, "merge: two far incidents");
        auto r = s.Observe(Obs("melee", 12, 100, {Person("A", kAggressor, 100, 20), Person("B", kVictim, 100, 20)}), 1);
        auto list = L(s);
        Check(r.incident == "inc-1" && list["open"] == 1, "merge: an observation holding people of two incidents merges them into the oldest");
        const auto& merged = list["incidents"][0];
        Check(merged["merged"].size() == 1 && merged["merged"][0] == "inc-2" && merged["observations"] == 3 && merged["evidence"]["gunshot"] == 2, "merge: the evidence and the history carry over");
        Check(merged["participants"].size() == 2 && merged["kind"] == "street_fight", "merge: the people carry over, and A and B who hit each other make a street fight");
        Check(s.GetStats().merged == 1, "merge: counted");
    }
    {
        // V is in every incident V takes part in: V alone never joins two incidents.
        Service s;
        s.Observe(Obs("combat", 10, 0, {Person("A", kAggressor, 0, 20), [] { auto f = V(); f.roles = kVictim; return f; }()}), 1);
        auto r = s.Observe(Obs("combat", 11, 500, {Person("B", kAggressor, 500, 20), [] { auto f = V(); f.roles = kVictim; return f; }()}), 1);
        Check(r.incident == "inc-2", "V: sharing only V does not merge incidents");
        Check(L(s)["incidents"][0]["v_involved"] == true, "V: an incident V takes part in says so");
    }
    {
        // a long incident is split, and the next part names what it continues
        Service s;
        for (int i = 0; i < 12; ++i) s.Observe(Obs("gunshot", 100 + i * 11, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1 + i * 0.01);
        // 12 observations 11 s apart: the 11th is at 210 (110 s), the 12th at 221 (121 s): max_open_s 120 reached on the 12th.
        auto list = L(s, {{"state", "closed"}});
        Check(list["incidents"].size() == 1 && list["incidents"][0]["closed"] == "max_duration", "split: an incident open for 120 s is closed");
        auto r = s.Observe(Obs("gunshot", 225, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 2);
        list = L(s, {{"state", "open"}});
        Check(r.incident == "inc-2" && list["incidents"][0]["continues"] == "inc-1", "split: the next part names the one it continues");
        // the observation that came at 221 s was assigned to the NEW part (inc-2 started at 221), not absorbed into the overlong one
        Check(list["incidents"][0]["when"]["start_sim_s"] == 221.0 && L(s, {{"state", "closed"}})["incidents"][0]["when"]["end_sim_s"] == 210.0,
              "split: the overlong incident ends at its last observation and the next observation starts the continuation");
    }
    {
        // Review fix 4: the maximum duration is enforced as the clock advances, with no observation to trigger it.
        Service s;
        for (int i = 0; i < 11; ++i) s.Observe(Obs("gunshot", 100 + i * 11, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1 + i * 0.01);
        // last observation at 210 s; the incident began at 100 s
        Check(s.Tick(219, 5).empty() && L(s)["open"] == 1, "split on the poll: 119 s is not yet 120");
        const auto reports = s.Tick(220.5, 6);
        Check(reports.size() == 1 && reports[0]["closed"] == "max_duration" && L(s)["open"] == 0, "split on the poll: a tick at 120 s closes and reports it without any new observation");
        const auto next = s.Observe(Obs("gunshot", 221, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 7);
        Check(next.accepted && next.incident == "inc-2" && L(s, {{"state", "open"}})["incidents"][0]["continues"] == "inc-1", "split on the poll: the next observation opens the continuation and keeps the link");
        // a quiet incident is closed as quiet, not as overlong, even when both hold
        Service q;
        q.Observe(Obs("gunshot", 100, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1);
        const auto quiet = q.Tick(300, 2);
        Check(quiet.size() == 1 && quiet[0]["closed"] == "quiet", "split on the poll: quiet takes precedence over overlong");
    }
    {
        // a lone voice request joins a nearby incident; four of them make a report on their own
        Service s;
        s.Observe(Obs("melee", 10, 0, {Person("A", kAggressor, 0, 20), Person("B", kVictim, 0, 20)}), 1);
        auto r = s.Observe(Obs("voice", 11, 5, {Person("B", kSpeaker, 5, 22)}, 15, 22), 1);
        Check(r.incident == "inc-1", "voice: a bark near a fight joins it");
        Service t;
        for (int i = 0; i < 3; ++i) t.Observe(Obs("voice", 10 + i, 0, {Person("S", kSpeaker, 0, 10)}, 15, 10), 1);
        auto quiet = t.Tick(100, 2);
        Check(quiet.empty(), "voice: three barks are 0.75, below the score a report needs");
        Service u;
        for (int i = 0; i < 4; ++i) u.Observe(Obs("voice", 10 + i, 0, {Person("S", kSpeaker, 0, 10)}, 15, 10), 1);
        quiet = u.Tick(100, 2);
        Check(quiet.size() == 1 && quiet[0]["kind"] == "other" && quiet[0]["evidence_score"] == 1.0, "voice: four barks are 1.0 and make a report");
    }

    // ---- kinds ----------------------------------------------------------------------------------------------------------------
    {
        auto kindOf = [](std::vector<Observation> observations) {
            Service s;
            for (auto& o : observations) s.Observe(o, 1);
            auto list = L(s);
            return list["incidents"][0]["kind"].get<std::string>();
        };
        Check(kindOf({Obs("gunshot", 1, 0, {Person("A", kAggressor, 0, 10)})}) == "gunfire", "kind: shots with no known victim are gunfire");
        Check(kindOf({Obs("explosion", 1, 0, {Person("A", kSource, 0, 10)})}) == "gunfire", "kind: an explosion is gunfire");
        Check(kindOf({Obs("melee", 1, 0, {Person("A", kAggressor, 0, 10), Person("B", kVictim, 0, 10)})}) == "assault", "kind: an attacker and a victim is an assault");
        Check(kindOf({Obs("melee", 1, 0, {Person("A", kAggressor, 0, 10), Person("B", kVictim, 0, 10)}),
                      Obs("melee", 2, 0, {Person("B", kAggressor, 0, 10), Person("A", kVictim, 0, 10)})}) == "street_fight", "kind: both ways is a street fight");
        Check(kindOf({Obs("combat", 1, 0, {Person("A", kAggressor, 0, 10), Person("C", kVictim, 0, 10)}),
                      Obs("combat", 2, 0, {Person("B", kAggressor, 0, 10), Person("C", kVictim, 0, 10)})}) == "street_fight", "kind: two attackers on one victim is a street fight");
        Check(kindOf({Obs("collision", 1, 0, {Person("car", kVehicle, 0, 10)})}) == "accident", "kind: a collision with no attacker is an accident");
        Check(kindOf({Obs("vehicle_hit", 1, 0, {Person("car", kSource, 0, 10)})}) == "accident", "kind: a vehicle hit with no attacker is an accident");
        Check(kindOf({Obs("collision", 1, 0, {Person("car", kVehicle, 0, 10)}), Obs("melee", 2, 0, {Person("A", kAggressor, 0, 10), Person("B", kVictim, 0, 10)})}) == "assault",
              "kind: a collision and then an attack is judged by the attack");
        Check(kindOf({Obs("reprimand", 1, 0, {Person("cop", kOfficer, 0, 10), Person("p", kSubject, 0, 10)})}) == "police_stop", "kind: a reprimand is a police stop");
        Check(kindOf({Obs("theft", 1, 0, {Person("T", kThief, 0, 10), Person("car", kVehicle, 0, 10)})}) == "theft", "kind: a vehicle theft is a theft");
        Check(kindOf({Obs("fear", 1, 0, {Person("S", kSource, 0, 10)})}) == "other", "kind: a scream alone is other");
        Check(kindOf({Obs("theft", 1, 0, {Person("T", kThief, 0, 10)}), Obs("melee", 2, 0, {Person("A", kAggressor, 0, 10), Person("B", kVictim, 0, 10)})}) == "theft", "kind: police stop and theft outrank the rest");
    }

    // ---- reports ----------------------------------------------------------------------------------------------------------------
    {
        Service s;
        s.SetWorld(7);
        s.Observe(Obs("melee", 100, 10, {Person("A", kAggressor, 10, 20), Person("B", kVictim, 11, 21)}, 20, 20), 1);
        s.Observe(Obs("melee", 103, 12, {Person("B", kAggressor, 12, 19, false), Person("A", kVictim, 10, 20)}, 20, 19), 1);
        const auto reports = s.Tick(116, 2);
        Check(reports.size() == 1, "report: one report for one incident");
        const auto& r = reports[0];
        Check(r["event"] == "witness.report" && r["schema"] == "xfb/witness-1" && r["passive"] == true, "report: event, schema and the passive flag");
        Check(r["incident"] == "inc-1" && r["kind"] == "street_fight" && r["world"] == 7, "report: the incident's identity, its kind and the world");
        Check(r["participants"].size() == 2 && r["participants"][0]["entity"] == "A" && r["participants"][0]["roles"] == json::array({"aggressor", "victim"}), "report: who took part, with the roles each played");
        Check(r["participants"][0]["record"] == "Character.A" && r["participants"][0]["affiliation"] == "Maelstrom" && r["participants"][0]["is_v"] == false, "report: record and affiliation");
        Check(r["place"]["district_v"] == "Watson_Kabuki" && r["place"]["first"] == json::array({10.0, 0.0, 0.0}) && r["place"]["last"] == json::array({12.0, 0.0, 0.0}), "report: where");
        Check(r["when"]["start_sim_s"] == 100.0 && r["when"]["end_sim_s"] == 103.0 && r["when"]["duration_s"] == 3.0 && r["when"]["start_game_s"] == 1100.0, "report: when, in simulation and game seconds");
        Check(r["perceived"]["modes"] == json::array({"saw", "heard"}) && r["perceived"]["saw"]["n"] == 2 && r["perceived"]["heard"]["n"] == 2, "report: how V perceived it");
        Check(r["perceived"]["saw"]["nearest_m"] == 20.0 && r["perceived"]["heard"]["radius_m"] == 20.0, "report: the nearest sighting and the audible radius");
        Check(r["perceived"]["told"]["supported"] == false, "report: was told is not supported and says so");
        Check(std::fabs(r["confidence"].get<double>() - 0.82) < 0.001, "report: confidence from the modes and the evidence");
        Check(r["evidence"]["melee"] == 2 && r["observations"] == 2 && r["closed"] == "quiet", "report: the evidence behind it");
        Check(xfb::SerializeJson(r).size() < 7000, "report: fits the recorder's record");
        Check(s.GetStats().reports == 1, "report: counted");
    }
    {
        // seen only / heard only / neither; confidence ordering
        auto run = [](std::vector<Fact> who, double radius, double vDist, const char* evidence = "gunshot") {
            Service s;
            s.Observe(Obs(evidence, 1, 0, std::move(who), radius, vDist), 1);
            return s.Tick(100, 2);
        };
        const auto seen = run({Person("A", kAggressor, 0, 40)}, 0, 40);
        const auto heard = run({Person("A", kAggressor, 0, 40, true, Los::Blocked)}, 60, 40);
        const auto both = run({Person("A", kAggressor, 0, 40)}, 60, 40);
        const auto neither = run({Person("A", kAggressor, 0, 40, true, Los::Blocked)}, 30, 40);
        Check(seen.size() == 1 && seen[0]["perceived"]["modes"] == json::array({"saw"}), "modes: seen only");
        Check(heard.size() == 1 && heard[0]["perceived"]["modes"] == json::array({"heard"}), "behind a wall: heard, not seen");
        Check(both.size() == 1 && both[0]["perceived"]["modes"] == json::array({"saw", "heard"}), "modes: both");
        Check(neither.empty(), "out of range or behind a wall and out of earshot: no report");
        Check(both[0]["confidence"].get<double>() > seen[0]["confidence"].get<double>() && seen[0]["confidence"].get<double>() > heard[0]["confidence"].get<double>(), "confidence: both over seen over heard");
        Service s;
        s.Observe(Obs("gunshot", 1, 0, {Person("A", kAggressor, 0, 40, true, Los::Blocked)}, 30, 40), 1);
        Check(L(s)["incidents"][0]["perceived"]["witnessed"] == false, "list: an unwitnessed incident says so");
        s.Tick(100, 2);
        Check(s.GetStats().unwitnessed == 1 && s.GetStats().reports == 0, "unwitnessed: counted, never reported");
        const auto unwitnessed = L(s, {{"witnessed", false}});
        const auto witnessedList = L(s, {{"witnessed", true}});
        Check(unwitnessed["incidents"].size() == 1 && witnessedList["incidents"].empty(), "list: the witnessed filter");
        // voice-only hearing is weaker
        Service v;
        for (int i = 0; i < 4; ++i) v.Observe(Obs("voice", 1 + i, 0, {Person("S", kSpeaker, 0, 10, false)}, 15, 10), 1);
        const auto voice = v.Tick(100, 2);
        Check(voice.size() == 1 && voice[0]["perceived"]["modes"] == json::array({"heard"}) && voice[0]["confidence"].get<double>() < 0.5, "confidence: heard through voice alone is weak");
    }
    {
        // V in it: reported with v_involved, perceived through the others only
        Service s;
        Fact v = V();
        v.roles = kVictim;
        s.Observe(Obs("combat", 10, 0, {Person("A", kAggressor, 0, 8), v}), 1);
        s.Observe(Obs("gunshot", 11, 0, {Person("A", kAggressor, 0, 8)}, 40, 8), 1);
        const auto reports = s.Tick(100, 2);
        Check(reports.size() == 1 && reports[0]["v_involved"] == true && reports[0]["kind"] == "assault", "V: an attack on V is reported with v_involved");
        Check(reports[0]["participants"][1]["is_v"] == true, "V: V is listed among the participants");
        Service t;
        Fact self = V();
        self.roles = kAggressor;
        t.Observe(Obs("gunshot", 10, 0, {self}, 50, 0), 1);
        Check(t.Tick(100, 2).empty(), "V: V's own shot alone is nothing for V to have witnessed");
    }

    // ---- bounds ---------------------------------------------------------------------------------------------------------------
    {
        Config c;
        c.maxObservationsPerSecond = 5;
        Service s(c);
        int accepted = 0;
        for (int i = 0; i < 12; ++i) accepted += s.Observe(Obs("gunshot", 10 + i * 0.01, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 5.1 + i * 0.01).accepted ? 1 : 0;
        Check(accepted == 5 && s.GetStats().droppedRate == 7, "bounds: observations over the rate are dropped and counted");
        accepted = 0;
        for (int i = 0; i < 3; ++i) accepted += s.Observe(Obs("gunshot", 20 + i * 0.01, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 6.2 + i * 0.01).accepted ? 1 : 0;
        Check(accepted == 3, "bounds: a new second has a new allowance");
    }
    {
        Config c;
        c.maxOpen = 3;
        Service s(c);
        std::vector<json> evicted;
        for (int i = 0; i < 5; ++i)
        {
            auto r = s.Observe(Obs("gunshot", 10 + i, i * 500.0, {Person(std::to_string(i + 100).c_str(), kAggressor, i * 500.0, 20)}, 50, 20), 1 + i * 0.1);
            for (auto& rep : r.reports) evicted.push_back(rep);
        }
        const auto list = L(s);
        Check(list["open"] == 3 && s.GetStats().evictedOpen == 2, "bounds: open incidents are capped, the least recently active closed");
        Check(evicted.size() == 2 && evicted[0]["closed"] == "evicted" && evicted[0]["incident"] == "inc-1", "bounds: an evicted incident is closed and reported, not lost");
    }
    {
        Config c;
        c.maxClosed = 4;
        Service s(c);
        for (int i = 0; i < 9; ++i)
        {
            s.Observe(Obs("gunshot", 100.0 * i, i * 500.0, {Person(std::to_string(i + 100).c_str(), kAggressor, i * 500.0, 20)}, 50, 20), 1 + i * 0.1);
            s.Tick(100.0 * i + 50, 1 + i * 0.1);
        }
        const auto list = L(s, {{"state", "closed"}, {"limit", 64}});
        Check(list["kept_closed"] == 4 && list["incidents"].size() == 4 && list["incidents"][0]["incident"] == "inc-9", "bounds: the closed ring keeps the newest, newest first");
        Check(L(s, {{"limit", 2}})["incidents"].size() == 2, "list: the limit");
    }
    {
        // Review fix 1: past the minute's allowance a witnessed incident's report waits and goes out as the allowance recovers.
        Config c;
        c.maxReportsPerMinute = 2;
        Service s(c);
        std::vector<json> delivered;
        for (int i = 0; i < 5; ++i)
        {
            s.Observe(Obs("gunshot", 1000.0 * i, i * 500.0, {Person(std::to_string(i + 100).c_str(), kAggressor, i * 500.0, 20)}, 50, 20), 10 + i);
            for (auto& r : s.Tick(1000.0 * i + 100, 10 + i + 0.5)) delivered.push_back(r);
        }
        Check(delivered.size() == 2 && s.GetStats().reports == 2 && s.GetStats().reportsQueued == 3, "queue: over the allowance, two go out and three wait");
        Check(L(s)["pending_reports"] == 3 && s.Coverage()["pending_reports"] == 3, "queue: the pending count is visible in the list and the coverage");
        const auto waiting = L(s, {{"limit", 1}});
        Check(waiting["incidents"][0]["report_pending"] == true && waiting["incidents"][0]["reported"] == false && waiting["incidents"][0]["report_gap"] == false, "queue: the incident says its report is pending");
        Check(s.Drain(30).empty(), "queue: nothing goes out while the allowance is spent");
        const auto first = s.Drain(75); // the first two went out at 10.5 and 11.5: both are over a minute old
        Check(first.size() == 2 && first[0]["incident"] == "inc-3" && first[1]["incident"] == "inc-4" && first[0]["delayed"] == true && first[0]["event"] == "witness.report",
              "queue: as the allowance recovers the oldest wait goes first, marked delayed");
        const auto last = s.Tick(5000, 140);
        Check(last.size() == 1 && last[0]["incident"] == "inc-5" && s.GetStats().reportsDelayed == 3 && L(s)["pending_reports"] == 0, "queue: every witnessed incident got its report");
        Check(L(s, {{"limit", 1}})["incidents"][0]["reported"] == true && L(s, {{"limit", 1}})["incidents"][0]["report_pending"] == false, "queue: the kept incident is updated when its report goes");
        Check(s.GetStats().reportGaps == 0, "queue: no gap while the queue held them");
        // a fresh incident with an empty queue and room goes straight out (order is kept: nothing overtakes the queue)
        s.Observe(Obs("gunshot", 9000, 0, {Person("late", kAggressor, 0, 20)}, 50, 20), 300);
        Check(s.Tick(9100, 301).size() == 1, "queue: the allowance returns after a minute");
    }
    {
        // Review fix 1: when the queue is full too, a witness.gap names the incident; nothing is lost silently.
        Config c;
        c.maxReportsPerMinute = 1;
        c.maxPendingReports = 2;
        Service s(c);
        std::vector<json> out;
        for (int i = 0; i < 5; ++i)
        {
            s.Observe(Obs("gunshot", 1000.0 * i, i * 500.0, {Person(std::to_string(i + 100).c_str(), kAggressor, i * 500.0, 20)}, 50, 20), 10 + i);
            for (auto& r : s.Tick(1000.0 * i + 100, 10 + i + 0.5)) out.push_back(r);
        }
        int reports = 0, gaps = 0;
        for (const auto& r : out) (r["event"] == "witness.gap" ? gaps : reports)++;
        Check(reports == 1 && gaps == 2 && s.GetStats().reportsQueued == 2 && s.GetStats().reportGaps == 2, "gap: one report, two waiting, the other two named in witness.gap events");
        const auto& gap = out[1];
        Check(gap["event"] == "witness.gap" && gap["schema"] == "xfb/witness-gap-1" && gap["incident"] == "inc-4" && gap["reason"] == "report_queue_full" && gap["modes"] == json::array({"saw", "heard"}) && gap["passive"] == true,
              "gap: the event names the incident, why, and how V perceived it");
        const auto flagged = L(s, {{"limit", 1}});
        Check(flagged["incidents"][0]["report_gap"] == true && flagged["incidents"][0]["reported"] == false, "gap: the incident says its report was lost");
        Check(s.Coverage()["report_gaps"] == 2 && s.Coverage()["pending_reports"] == 2, "gap: coverage counts the gaps");
        // the two that waited are not lost: they still go out
        const auto later = s.Drain(200);
        Check(later.size() == 1 && later[0]["delayed"] == true, "gap: the queue still drains as the allowance returns");
    }
    {
        // Review fix 2: admission is bounded per second, per entity and per kind, and every refusal is counted.
        Config c;
        c.maxBuiltPerSecond = 6;
        c.maxWeakBuiltPerSecond = 3;
        c.maxPerKeyPerSecond = 2;
        Service s(c);
        int vShots = 0;
        for (int i = 0; i < 20; ++i) vShots += s.Admit("gunshot", "V", 50.1) ? 1 : 0;
        Check(vShots == 2 && s.GetStats().tapDroppedRepeat == 18, "admit: a burst of V's own shots is held to two a second and counted as repeats");
        Check(s.Admit("death", "victim-1", 50.2) && s.Admit("collision", "car-1", 50.3) && s.Admit("gunshot", "npc-1", 50.4) && s.Admit("melee", "npc-2", 50.5),
              "admit: a separately witnessed death, collision, other shooter and blow are all let in after the burst");
        Check(s.GetStats().tapDroppedCap == 0 && s.GetStats().tapAdmitted == 6, "admit: the burst did not use the cap");
        Check(!s.Admit("death", "victim-2", 50.6) && s.GetStats().tapDroppedCap == 1, "admit: past the per-second total it is refused and counted as the cap");
        Check(s.Admit("death", "victim-3", 51.1), "admit: the next second has a fresh allowance");
        // weak kinds cannot take the whole allowance
        Service w(c);
        int weak = 0;
        for (int i = 0; i < 6; ++i) weak += w.Admit("voice", "bark-" + std::to_string(i), 7.1) ? 1 : 0;
        Check(weak == 3 && w.GetStats().tapDroppedWeak == 3, "admit: barks are held to the weak share and counted");
        int strong = 0;
        for (int i = 0; i < 4; ++i) strong += w.Admit("death", "d-" + std::to_string(i), 7.2) ? 1 : 0;
        Check(strong == 3, "admit: the room kept for direct acts is still there after a storm of barks");
        Check(!w.Admit("not_a_kind", "x", 7.3), "admit: an unknown kind of evidence is refused");
        const auto cover = w.Coverage();
        Check(cover["tap_admitted"] == 6 && cover["tap_dropped_weak"] == 3 && cover["tap_dropped_cap"] >= 1 && cover["tap_dropped_repeat"] == 0, "admit: the counters are in the coverage heartbeat");
        Check(L(w)["stats"]["tap_dropped_weak"] == 3 && L(w)["config"]["max_per_key_per_s"] == 2, "admit: and in incidents.list");
    }
    {
        Config c;
        c.maxParticipants = 3;
        Service s(c);
        for (int i = 0; i < 6; ++i) s.Observe(Obs("gunshot", 10 + i * 0.1, 0, {Person(std::to_string(i + 100).c_str(), kAggressor, 0, 20)}, 50, 20), 1 + i * 0.01);
        const auto list = L(s);
        Check(list["incidents"][0]["participants"].size() == 3 && list["incidents"][0]["participants_dropped"] == 3 && s.GetStats().participantsDropped == 3, "bounds: participants are capped and the rest counted");
    }
    {
        // sixteen people with long names still fit one recorder record
        Service s;
        for (int i = 0; i < 16; ++i)
        {
            auto f = Person((std::string(40, '1') + std::to_string(i)).c_str(), kAggressor, 0, 20);
            f.record = "Character." + std::string(86, 'x');
            f.affiliation = std::string(46, 'y');
            f.who = "a" + std::to_string(i);
            s.Observe(Obs("gunshot", 10 + i * 0.1, 0, {f}, 50, 20), 1 + i * 0.01);
        }
        const auto reports = s.Tick(100, 2);
        Check(reports.size() == 1 && xfb::SerializeJson(reports[0]).size() < 8192 && reports[0]["participants"].size() <= 16, "bounds: the biggest report still fits the recorder's 8 KiB record");
    }
    {
        // clock handling: a clock that goes back closes everything; a paused clock ages nothing; invalid observations are counted
        Service s;
        s.Observe(Obs("gunshot", 500, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1);
        Check(s.Tick(500, 50).empty(), "clock: wall time passing without simulation time closes nothing");
        const auto reset = s.Tick(100, 51);
        Check(reset.size() == 1 && reset[0]["closed"] == "clock_reset", "clock: a simulation clock that went back closes what was open");
        s.Observe(Obs("gunshot", 700, 0, {Person("B", kAggressor, 0, 20)}, 50, 20), 52);
        const auto world = s.CloseAll("world_changed");
        Check(world.size() == 1 && world[0]["closed"] == "world_changed" && L(s)["open"] == 0, "world: a world change closes and reports the open ones");
        s.NoteInvalid();
        Check(s.GetStats().droppedInvalid == 1, "invalid observations are counted");
        Observation noPlace = Obs("gunshot", 800, 0, {Person("C", kAggressor, 0, 20)});
        noPlace.hasPos = false;
        noPlace.who[0].hasPos = false;
        Check(!s.Observe(noPlace, 53).accepted && s.GetStats().droppedNoPlace == 1, "an observation with no place is dropped and counted");
        Observation fromFact = noPlace;
        fromFact.who[0].hasPos = true;
        Check(s.Observe(fromFact, 54).accepted, "a person's place stands in for the observation's");
        Check(L(s)["incidents"][0]["place"]["first"] == json::array({0.0, 0.0, 0.0}), "the place falls back to the person's position");
    }
    {
        // the method: refused without test hooks or without the taps, a read with them, tap switch, world sync
        xfb::Config config;
        config.maxRequestsPerSecond = 1000;
        xfb::Session session;
        session.token = "incidents";
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        auto call = [&](bool hooks, bool taps, const json& params, int& synced, bool& tap) {
            xfb::Dispatcher dispatcher(config, session, queue);
            Service s;
            s.Observe(Obs("gunshot", 1, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1);
            MethodHooks h;
            h.allowTestHooks = hooks;
            h.taps = taps;
            h.tapOn = [&] { return tap; };
            h.setTap = [&](bool on) { tap = on; };
            h.sync = [&] { ++synced; };
            RegisterMethods(dispatcher, s, h);
            return json::parse(dispatcher.Handle(xfb::SerializeJson(json{{"v", 1}, {"token", session.token}, {"method", "incidents.list"}, {"params", params}}), 1, false).line);
        };
        int synced = 0;
        bool tap = true;
        auto answer = call(false, true, json::object(), synced, tap);
        Check(answer["ok"] == false && answer["error"]["code"] == "test_hooks_off" && synced == 0, "method: refused without allow_test_hooks");
        answer = call(true, false, json::object(), synced, tap);
        Check(answer["ok"] == false && answer["error"]["code"] == "test_hooks_off", "method: refused in a build without the taps");
        answer = call(true, true, json::object(), synced, tap);
        Check(answer["ok"] == true && answer["result"]["incidents"].size() == 1 && answer["result"]["tap"] == true && synced == 1 && answer["result"]["passive"] == true, "method: a read, after the world sync");
        answer = call(true, true, {{"tap", false}}, synced, tap);
        Check(answer["ok"] == true && !tap && answer["result"]["tap"] == false, "method: tap switches the observation tap");
        answer = call(true, true, {{"state", "later"}}, synced, tap);
        Check(answer["ok"] == false && answer["error"]["code"] == "bad_params", "method: a state that isn't one is refused");
        answer = call(true, true, {{"limit", 0}}, synced, tap);
        Check(answer["ok"] == false && answer["error"]["code"] == "bad_params", "method: a limit of 0 is refused");
        answer = call(true, true, {{"colour", "red"}}, synced, tap);
        Check(answer["ok"] == false && answer["error"]["code"] == "bad_params", "method: an unknown parameter is refused");
    }
    {
        // the recorder's tenth channel: opt-in, a witness.report goes in whole, other channels are not widened
        xfb::recording::Service recorder;
        const auto started = recorder.Start({{"channels", {"incidents", "v"}}}, 10, 1, 1, "incidents");
        Check(started["active"] == true && recorder.Wants("incidents") && !recorder.Wants("voice"), "recorder: incidents is a channel a run can ask for, and only asked-for channels are wanted");
        Service s;
        s.Observe(Obs("melee", 1, 0, {Person("A", kAggressor, 0, 20), Person("B", kVictim, 0, 20)}, 20, 20), 1);
        const auto reports = s.Tick(100, 2);
        Check(reports.size() == 1 && recorder.Ingress("incidents", xfb::SerializeJson(reports[0]), 10.5, 1, 1, 1), "recorder: a whole witness.report is taken by the incidents channel");
        Check(!recorder.Ingress("voice", xfb::SerializeJson(reports[0]), 10.6, 1, 1, 1), "recorder: a channel the run did not ask for takes nothing");
        const auto page = recorder.Read({{"run", 1}}, 11);
        Check(page["records"].size() == 1 && page["records"][0]["channel"] == "incidents" && page["records"][0]["data"]["event"] == "witness.report" &&
              page["records"][0]["data"]["incident"] == "inc-1" && page["records"][0]["valid"] == true, "recorder: the record reads back as the report");
        recorder.Stop("test", 12);
        recorder.Read({{"run", 1}, {"since", 1}}, 12);
        bool refused = false;
        try { recorder.Start({{"channels", {"v", "actors", "camera", "subtitles", "voice", "face", "ui", "contacts", "supervisor", "incidents"}}}, 20, 1, 1, "ten"); }
        catch (const xfb::MethodError&) { refused = true; }
        Check(!refused, "recorder: all ten channels may be asked for together");
        recorder.Stop("test", 21);
        recorder.Read({{"run", 2}}, 21);
        refused = false;
        try { recorder.Start({{"channels", {"v", "v"}}}, 30, 1, 1, "dup"); }
        catch (const xfb::MethodError&) { refused = true; }
        Check(refused, "recorder: a duplicate channel is still refused");
    }
    {
        const auto cfg = ConfigJson(xfb::incidents::Config{});
        Check(cfg["quiet_s"] == 12.0 && cfg["max_open_s"] == 120.0 && cfg["join_radius_m"] == 35.0 && cfg["see_range_m"] == 80.0 && cfg["max_open"] == 32 && cfg["max_reports_per_min"] == 20 && cfg["max_pending_reports"] == 64 && cfg["max_built_per_s"] == 24 && cfg["max_weak_built_per_s"] == 12 && cfg["max_per_key_per_s"] == 2, "config: the documented defaults");
        Service s;
        const auto cover = s.Coverage();
        Check(cover["valid"] == true && cover["event"] == "incident.coverage" && cover["passive"] == true && cover["told_supported"] == false, "coverage: the recorder heartbeat's sample");
    }
    // ==== 0.8.21: the engine's declared incidents ==========================================================================
    {
        // the safe text rule, and the handle rule
        Check(SafeText("pickpocket", 48, true) && SafeText("stall collection", 48, true) && SafeText("eng-1:a/b+c_d.e", 64, false), "safe text: letters, digits, single spaces and _ - . : / +");
        Check(!SafeText("", 48, true) && !SafeText(std::string(49, 'x'), 48, true) && !SafeText("a\"b", 48, true) && !SafeText("a\nb", 48, true) && !SafeText("<b>", 48, true) &&
              !SafeText("caf\xC3\xA9", 48, true) && !SafeText("a  b", 48, true) && !SafeText(" a", 48, true) && !SafeText("a ", 48, true) && !SafeText("a b", 48, false) && !SafeText("a\\b", 48, true),
              "safe text: empty, overlong, quotes, control characters, markup, non-ASCII, doubled or edge spaces, backslashes and (when not allowed) spaces are refused");
        Check(IsActorHandle("a1") && IsActorHandle("a12") && !IsActorHandle("p1") && !IsActorHandle("v") && !IsActorHandle("a") && !IsActorHandle("a1b") && !IsActorHandle("A1") && !IsActorHandle("a123456789"),
              "handle: a, then digits");
    }
    {
        const Config cfg;
        const ActorLookup lookup = [](const std::string& h) {
            ActorInfo info;
            if (h == "a1" || h == "a2" || h == "a3" || h == "a4" || h == "a5" || h == "a6")
            {
                info.exists = true;
                info.hasPos = h != "a3";
                info.pos[0] = h == "a1" ? 10.0 : h == "a2" ? 14.0 : 0.0;
                info.pos[1] = 2.0;
            }
            return info;
        };
        auto code = [&](const json& params) {
            try { ParseDeclaration(params, lookup, cfg); }
            catch (const xfb::MethodError& e) { return e.code; }
            return std::string();
        };
        const json ok = {{"id", "steal-1"}, {"kind", "pickpocket"}, {"roles", {{"a1", "thief"}, {"a2", "mark"}}}, {"ttl_s", 30}};
        const auto d = ParseDeclaration(ok, lookup, cfg);
        Check(d.id == "steal-1" && d.kind == "pickpocket" && d.roles.size() == 2 && d.ttlS == 30 && d.atFromActors && d.at[0] == 12.0 && d.at[1] == 2.0, "declare parse: id, kind, roles, ttl, and the centroid of the actors as the place");
        auto given = ok;
        given["at"] = json::array({1, 2, 3});
        const auto dg = ParseDeclaration(given, lookup, cfg);
        Check(dg.hasAt && !dg.atFromActors && dg.at[0] == 1 && dg.at[2] == 3, "declare parse: 'at' as given wins");
        auto noTtl = ok;
        noTtl.erase("ttl_s");
        Check(ParseDeclaration(noTtl, lookup, cfg).ttlS == 60.0, "declare parse: the default TTL is 60 s");
        const auto placeLess = json{{"id", "x"}, {"kind", "k"}, {"roles", {{"a3", "r"}}}};
        Check(code(placeLess) == "no_place", "declare parse: no 'at' and no actor with a place is refused (no_place)");
        Check(code({{"id", "x"}, {"kind", "k"}, {"roles", {{"a3", "r"}}}, {"at", {1, 2, 3}}}) == "", "declare parse: an actor still appearing is fine when 'at' is given");
        Check(code({{"id", "x"}, {"kind", "k"}, {"at", {1, 2, 3}}}) == "", "declare parse: no roles is fine when 'at' is given (actors join by npc.spawn's incident)");
        auto bad = [&](json patch) { auto p = ok; for (auto& [k, v] : patch.items()) { if (v.is_null()) p.erase(k); else p[k] = v; } return code(p); };
        Check(bad({{"id", nullptr}}) == "bad_params" && bad({{"kind", nullptr}}) == "bad_params", "declare parse: id and kind are required");
        Check(bad({{"id", "a\"b"}}) == "bad_params" && bad({{"id", "has space"}}) == "bad_params" && bad({{"id", std::string(65, 'x')}}) == "bad_params" && bad({{"id", 5}}) == "bad_params", "declare parse: an unsafe, spaced, overlong or non-text id is refused");
        Check(bad({{"kind", "a\nb"}}) == "bad_params" && bad({{"kind", "<script>"}}) == "bad_params" && bad({{"kind", std::string(49, 'k')}}) == "bad_params", "declare parse: an unsafe or overlong kind is refused");
        Check(bad({{"roles", {{"v", "thief"}}}}) == "bad_params" && bad({{"roles", {{"V", "thief"}}}}) == "bad_params", "declare parse: V is refused");
        Check(bad({{"roles", {{"p1", "thief"}}}}) == "bad_params" && bad({{"roles", {{"p12", "x"}}}}) == "bad_params", "declare parse: a picked passer-by is refused");
        Check(bad({{"roles", {{"x1", "thief"}}}}) == "bad_params" && bad({{"roles", {{"a1b", "thief"}}}}) == "bad_params" && bad({{"roles", json::array({"a1"})}}) == "bad_params", "declare parse: anything that is not an actor handle is refused");
        Check(bad({{"roles", {{"a1", "th\"ief"}}}}) == "bad_params" && bad({{"roles", {{"a1", 7}}}}) == "bad_params" && bad({{"roles", {{"a1", ""}}}}) == "bad_params", "declare parse: an unsafe or empty role is refused");
        Check(bad({{"roles", {{"a9", "thief"}}}}) == "npc_not_found", "declare parse: a handle that is not one of the bridge's actors is refused (npc_not_found)");
        Check(bad({{"roles", {{"a1", "r"}, {"a2", "r"}, {"a3", "r"}, {"a4", "r"}, {"a5", "r"}, {"a6", "r"}}}}) == "incident_limit", "declare parse: more than five actors is refused (incident_limit)");
        Check(bad({{"ttl_s", 0.5}}) == "bad_params" && bad({{"ttl_s", 301}}) == "bad_params" && bad({{"ttl_s", "soon"}}) == "bad_params" && bad({{"ttl_s", 1}}) == "" && bad({{"ttl_s", 300}}) == "", "declare parse: ttl_s is 1 to 300 seconds");
        Check(bad({{"at", {1, 2}}}) == "bad_params" && bad({{"at", "here"}}) == "bad_params" && bad({{"colour", "red"}}) == "bad_params", "declare parse: a bad place and an unknown parameter are refused");
        Check(code({{"id", "x"}, {"kind", "k"}}) == "bad_params", "declare parse: neither roles nor a place is refused");
    }
    // The engine's staging in a street: pickpocket by a1 of a2, declared, then seen, then reported once.
    const auto stage = [](Service& s, const char* id = "steal-1", double sim = 100, double ttl = 60) {
        s.Tick(sim, 1.0);
        Declaration d;
        d.id = id;
        d.kind = "pickpocket";
        d.roles = {{"a1", "thief"}, {"a2", "mark"}};
        d.hasAt = true;
        d.at[0] = 10;
        d.ttlS = ttl;
        return s.Declare(d, 1.0);
    };
    const auto actor = [](const char* handle, double dist, bool view = true, Los los = Los::Clear) {
        Fact f;
        f.id = std::string("E-") + handle;
        f.who = handle;
        f.record = "Character.xfs_actor_woman";
        f.hasPos = true;
        f.pos[0] = 10;
        f.dist = dist;
        f.inView = view;
        f.los = los;
        return f;
    };
    const auto sample = [&](double sim, std::vector<Fact> who, const char* view = "gameplay") {
        SightSample sm;
        sm.simS = sim;
        sm.gameS = 5000 + sim;
        sm.district = "Watson_Kabuki";
        sm.view = view;
        sm.who = std::move(who);
        return sm;
    };
    {
        // declare: opens at once, answers our id beside theirs, is listed, counts
        Service s;
        const auto made = stage(s);
        Check(made.declared["incident"] == "inc-1" && made.declared["declared"]["id"] == "steal-1" && made.declared["declared"]["kind"] == "pickpocket" && made.declared["declared"]["roles"]["a1"] == "thief" &&
              made.declared["state"] == "open" && made.declared["clock_known"] == true, "declare: opens at once and answers inc-N beside the engine's id, kind and roles");
        const auto list = L(s, {{"state", "open"}});
        Check(list["open"] == 1 && list["incidents"][0]["declared"]["id"] == "steal-1" && list["incidents"][0]["participants"].size() == 2 && list["incidents"][0]["participants"][0]["who"] == "a1" &&
              list["incidents"][0]["perceived"]["witnessed"] == false && list["incidents"][0]["perceived"]["sight"]["samples"] == 0, "declare: listed as open with its actors as participants and its sight counters");
        Check(L(s, {{"declared", true}})["incidents"].size() == 1 && L(s, {{"declared", false}})["incidents"].empty() && L(s, {{"id", "steal-1"}})["incidents"].size() == 1 && L(s, {{"id", "other"}})["incidents"].empty(),
              "declare: incidents.list filters by declared and by the engine's id");
        Check(s.GetStats().declared == 1 && s.DeclaredOpen() == 1 && L(s)["stats"]["declared"] == 1, "declare: counted");
        // ordinary incidents carry no declared object
        s.Observe(Obs("gunshot", 101, 500, {Person("Z", kAggressor, 500, 20)}, 50, 20), 1.1);
        Check(!L(s, {{"declared", false}})["incidents"][0].contains("declared"), "declare: an ordinary incident has no 'declared'");
    }
    {
        // refusals: a duplicate id (open, and still remembered after it closed), the cap of four, the room
        Service s;
        stage(s, "a");
        bool dup = false, dupClosed = false, cap = false;
        try { stage(s, "a"); } catch (const xfb::MethodError& e) { dup = std::string(e.code) == "duplicate_id"; }
        Check(dup, "declare: an id that is open is refused (duplicate_id)");
        s.CloseDeclared("a", "engine_close", 2.0);
        try { stage(s, "a"); } catch (const xfb::MethodError& e) { dupClosed = std::string(e.code) == "duplicate_id"; }
        Check(dupClosed, "declare: an id the bridge still remembers as closed is refused too");
        for (const char* id : {"b", "c", "d", "e"}) stage(s, id);
        try { stage(s, "f"); } catch (const xfb::MethodError& e) { cap = std::string(e.code) == "incident_limit"; }
        Check(cap && s.DeclaredOpen() == 4, "declare: a fifth declared incident is refused (limit): four is the sight sampler's bound");
        Check(s.SightPlan() == std::vector<std::string>({"a1", "a2"}), "declare: the sight plan lists each actor once, however many incidents hold it");
    }
    {
        // join: any observation involving a declared actor joins; strangers near it do not; ordinary incidents sharing people merge in
        Service s;
        stage(s);
        auto r = s.Observe(Obs("gunshot", 101, 10, {actor("a1", 20)}, 50, 20), 1.0);
        Check(r.accepted && r.incident == "inc-1" && L(s)["open"] == 1, "join: an observation that names a declared actor joins it, not a new 'other'");
        auto stranger = s.Observe(Obs("gunshot", 102, 11, {Person("Z", kAggressor, 11, 20)}, 50, 20), 1.1);
        Check(stranger.incident == "inc-2", "join: a stranger's shot a metre from the staging does not join it");
        // an ordinary incident the declared actor also takes part in merges into the declared one, keeping its id and kind
        s.Observe(Obs("melee", 103, 400, {Person("Q", kAggressor, 400, 20), Person("Y", kVictim, 400, 20)}), 1.2);
        const auto mixed = s.Observe(Obs("melee", 104, 400, {actor("a2", 20), Person("Q", kAggressor, 400, 20)}), 1.3);
        const auto list = L(s, {{"declared", true}});
        Check(mixed.incident == "inc-1" && list["incidents"].size() == 1 && list["incidents"][0]["declared"]["id"] == "steal-1" && list["incidents"][0]["merged"].size() >= 1 &&
              list["incidents"][0]["evidence"]["melee"] == 2, "join: an ordinary incident sharing people with it merges into it; the declared id and kind stay");
        Check(list["incidents"][0]["participants"].size() == 4, "join: an actor seen again, by handle and by entity id, is one participant (a1, a2 and the two strangers)");
        // two declared incidents: never merged, the oldest takes an observation naming both
        stage(s, "second");
        Declaration d2;
        d2.id = "third";
        d2.kind = "chase";
        d2.roles = {{"a3", "runner"}};
        d2.hasAt = true;
        s.Declare(d2, 1.0);
        const auto both = s.Observe(Obs("combat", 106, 10, {actor("a1", 20), actor("a3", 20)}), 1.4);
        Check(both.incident == "inc-1" && s.DeclaredOpen() == 3, "join: an observation naming the actors of two declared incidents goes to the oldest; they are never merged");
    }
    {
        // sight: a silent staging can be "saw"; the report is one witness.report with declared; heard comes from a stimulus
        Service s;
        stage(s);
        auto out = s.Sight(sample(101, {actor("a1", 20), actor("a2", 22)}), 2.0);
        Check(out.accepted && out.reports.empty(), "sight: a sample is accepted");
        const auto open = L(s, {{"state", "open"}})["incidents"][0];
        Check(open["perceived"]["saw"]["n"] == 1 && open["perceived"]["saw"]["nearest_m"] == 20.0 && open["perceived"]["sight"]["samples"] == 1 && open["perceived"]["sight"]["in_view"] == 1 &&
              open["place"]["district_v"] == "Watson_Kabuki" && open["participants"][0]["entity"] == "E-a1" && open["participants"][0]["nearest_m"] == 20.0, "sight: it counts as saw, with the nearest distance, and fills in the actors' entity ids");
        const auto closed = s.CloseDeclared("steal-1", "engine_close", 3.0);
        Check(closed.found && closed.incident == "inc-1" && closed.outcome == "report" && closed.reports.size() == 1, "close: exactly one report");
        const auto& r = closed.reports[0];
        Check(r["event"] == "witness.report" && r["incident"] == "inc-1" && r["closed"] == "engine_close" && r["declared"]["id"] == "steal-1" && r["declared"]["kind"] == "pickpocket" &&
              r["declared"]["roles"] == json({{"a1", "thief"}, {"a2", "mark"}}) && r["perceived"]["modes"] == json::array({"saw"}) && r["kind"] == "other" && r["evidence_score"] == 0.0 &&
              r["reported"] == true && r["passive"] == true, "close: the report carries declared {id, kind, roles} beside the usual fields, whatever the evidence score");
        Check(r["perceived"]["sight"]["samples"] == 1 && r["place"]["last"][0] == 10.0 && r["when"]["start_sim_s"] == 100.0, "close: the sight counters, the actors' last place and the clock are in the report");
        Check(!s.CloseDeclared("steal-1", "engine_close", 3.1).found && L(s)["open"] == 0 && s.GetStats().reports == 1 && s.GetStats().declaredClosed == 1, "close: a second close finds nothing; one report in all");
        // heard: a stimulus near V that names an actor, no sight at all
        Service h;
        stage(h);
        h.Observe(Obs("gunshot", 101, 10, {actor("a1", 70, false, Los::Unchecked)}, 100, 70), 1.0);
        const auto heard = h.CloseDeclared("steal-1", "engine_close", 2.0);
        Check(heard.outcome == "report" && heard.reports[0]["perceived"]["modes"] == json::array({"heard"}) && heard.reports[0]["declared"]["id"] == "steal-1", "heard: a gunshot or shout stimulus gives heard, carried by the declared incident");
    }
    {
        // unwitnessed: an explicit event with the furthest the sampler got
        auto why = [&](std::vector<SightSample> samples, bool missingSamples = false) {
            Service s;
            stage(s);
            for (size_t i = 0; i < samples.size(); ++i) s.Sight(samples[i], 10.0 + static_cast<double>(i));
            (void)missingSamples;
            const auto c = s.CloseDeclared("steal-1", "engine_close", 99.0);
            Check(c.outcome == "unwitnessed" && c.reports.size() == 1 && c.reports[0]["event"] == "witness.unwitnessed" && c.reports[0]["declared"]["id"] == "steal-1" && c.reports[0]["incident"] == "inc-1" &&
                  c.reports[0]["schema"] == "xfb/witness-unwitnessed-1" && c.reports[0]["closed"] == "engine_close" && c.reports[0]["passive"] == true, "unwitnessed: one explicit event naming the incident and the declared id");
            return c.reports[0]["reason"].get<std::string>();
        };
        Check(why({}) == "no_samples", "unwitnessed: closed before any sample");
        Check(why({sample(101, {})}) == "actors_missing", "unwitnessed: the actors were not found in the world");
        Check(why({sample(101, {actor("a1", 20, false, Los::Unchecked)}, "photo")}) == "no_view", "unwitnessed: photo mode's camera is not V's view");
        Check(why({sample(101, {actor("a1", 95)}), sample(102, {actor("a1", 100)})}) == "out_of_range", "unwitnessed: past the see range");
        Check(why({sample(101, {actor("a1", 20, false, Los::Unchecked)}), sample(102, {actor("a1", 25, false, Los::Unchecked)})}) == "not_in_view", "unwitnessed: V turned away (in range, not in view)");
        Check(why({sample(101, {actor("a1", 20, true, Los::Blocked)})}) == "occluded", "unwitnessed: in view but behind static geometry");
        Check(why({sample(101, {actor("a1", 20, true, Los::Unchecked)})}) == "unchecked", "unwitnessed: a ray that could not be cast proves nothing");
        Check(why({sample(101, {actor("a1", 20, false, Los::Unchecked)}), sample(102, {actor("a1", 20, true, Los::Blocked)})}) == "occluded", "unwitnessed: the furthest the sampler got is the reason");
        // turned away, then looked: seen
        Service s;
        stage(s);
        s.Sight(sample(101, {actor("a1", 20, false, Los::Unchecked)}), 5.0);
        s.Sight(sample(102, {actor("a1", 20)}), 6.0);
        Check(s.CloseDeclared("steal-1", "engine_close", 7.0).outcome == "report", "sight: turned away, then looking, is seen");
        const auto st = s.GetStats();
        Check(st.declaredUnwitnessed == 0 && st.sightSamples == 2, "sight: counted");
    }
    {
        // sampling bounds: three a wall second, the rest counted; invalid and unknown actors; only the declared incidents' actors count
        Service s;
        stage(s);
        int accepted = 0;
        for (int i = 0; i < 5; ++i) accepted += s.Sight(sample(101 + i * 0.1, {actor("a1", 20, false, Los::Unchecked)}), 7.0 + i * 0.1).accepted ? 1 : 0;
        Check(accepted == 3 && s.GetStats().sightSamples == 5 && s.GetStats().sightDroppedRate == 2, "sight bounds: three samples a wall-clock second are accepted, the others counted");
        Check(s.Sight(sample(102, {actor("a1", 20)}), 8.0).accepted, "sight bounds: the allowance comes back with the next second");
        auto nan = sample(102, {});
        nan.simS = std::nan("");
        Check(!s.Sight(nan, 9.0).accepted && s.GetStats().sightDroppedInvalid == 1, "sight bounds: a sample with no clock is counted invalid");
        const auto before = L(s, {{"state", "open"}})["incidents"][0]["perceived"]["sight"]["samples"];
        s.Sight(sample(103, {actor("a7", 20)}), 10.0);
        Check(L(s, {{"state", "open"}})["incidents"][0]["perceived"]["sight"]["samples"] == before, "sight bounds: a sample of someone else's actor is not a sample of this incident");
        // the plan is bounded to four incidents
        Config big;
        big.maxDeclared = 2;
        Service two(big);
        stage(two, "p");
        stage(two, "q");
        Check(two.DeclaredOpen() == 2 && two.SightPlan().size() == 2, "sight bounds: the plan covers at most maxDeclared incidents");
        Check(ConfigJson(Config{})["max_declared"] == 4 && ConfigJson(Config{})["max_sight_per_s"] == 3 && ConfigJson(Config{})["max_declared_roles"] == 5 && ConfigJson(Config{})["declared_ttl_max_s"] == 300.0, "config: the declared incidents' defaults");
    }
    {
        // TTL on the simulation clock; quiet and the 120 s split do not close a declared incident
        Service s;
        stage(s, "t", 100, 10);
        Check(s.Tick(109.9, 2.0).empty() && s.DeclaredOpen() == 1, "ttl: still open just before it");
        Check(s.Tick(109.9, 50.0).empty() && s.DeclaredOpen() == 1, "ttl: wall time passing without simulation time ages nothing");
        const auto gone = s.Tick(110.0, 3.0);
        Check(gone.size() == 1 && gone[0]["event"] == "witness.unwitnessed" && gone[0]["closed"] == "ttl" && gone[0]["declared"]["id"] == "t" && s.DeclaredOpen() == 0, "ttl: it closes at ttl_s of simulation time, with the reason, and says so when nobody saw it");
        Service q;
        stage(q, "long", 100, 300);
        q.Sight(sample(101, {actor("a1", 20)}), 1.0);
        Check(q.Tick(150, 2.0).empty() && q.Tick(230, 3.0).empty() && q.DeclaredOpen() == 1, "ttl: the 12 s quiet close and the 120 s split do not apply to a declared incident");
        const auto late = q.Tick(400.5, 4.0);
        Check(late.size() == 1 && late[0]["event"] == "witness.report" && late[0]["closed"] == "ttl" && late[0]["declared"]["id"] == "long", "ttl: a seen incident reports when its TTL runs out");
        // declared before any clock is known: the TTL runs from the first clock that arrives
        Service c;
        Declaration d;
        d.id = "early";
        d.kind = "k";
        d.roles = {{"a1", "r"}};
        d.hasAt = true;
        d.ttlS = 10;
        const auto made = c.Declare(d, 1.0);
        Check(made.declared["clock_known"] == false, "ttl: declared before any clock is known, it says so");
        Check(c.Tick(500, 2.0).empty() && c.Tick(509, 3.0).empty() && c.Tick(510, 4.0).size() == 1, "ttl: ...and the TTL runs from the first clock that arrives");
        // a clock that went back (a load) closes it with the existing reason
        Service r;
        stage(r, "reset", 500, 100);
        const auto reset = r.Tick(100, 2.0);
        Check(reset.size() == 1 && reset[0]["closed"] == "clock_reset", "ttl: a clock that went back closes a declared incident (clock_reset)");
    }
    {
        // kill, load, handover, tap off: every declared incident closes with its reason; ordinary ones carry on
        Service s;
        stage(s, "k1");
        stage(s, "k2");
        s.Sight(sample(101, {actor("a1", 20)}), 2.0);
        s.Observe(Obs("gunshot", 102, 900, {Person("Z", kAggressor, 900, 20)}, 50, 20), 2.1);
        const auto out = s.CloseAllDeclared("kill");
        int reports = 0, silent = 0;
        for (const auto& e : out)
        {
            reports += e["event"] == "witness.report" ? 1 : 0;
            silent += e["event"] == "witness.unwitnessed" ? 1 : 0;
            Check(e["closed"] == "kill" && e["declared"]["id"].is_string(), "kill: each carries the reason and its declared id");
        }
        Check(out.size() == 2 && reports == 2 && silent == 0 && s.DeclaredOpen() == 0 && L(s)["open"] == 1, "kill: every declared incident closes (both were seen: sight covers both actors' incidents); the ordinary one carries on");
        Service h;
        stage(h, "h1");
        const auto handover = h.CloseAllDeclared("handover");
        Check(handover.size() == 1 && handover[0]["event"] == "witness.unwitnessed" && handover[0]["closed"] == "handover" && handover[0]["reason"] == "no_samples", "handover: closed with its reason; unwitnessed says why");
        Service w;
        stage(w, "w1");
        w.Observe(Obs("gunshot", 101, 600, {Person("Z", kAggressor, 600, 20)}, 50, 20), 2.0);
        const auto world = w.CloseAll("world_changed");
        bool declaredClosed = false;
        for (const auto& e : world) declaredClosed = declaredClosed || (e.contains("declared") && e["closed"] == "world_changed");
        Check(world.size() == 2 && declaredClosed && L(w)["open"] == 0, "load: closing everything for a world change closes the declared ones with it, each exactly once");
        Check(w.CloseAllDeclared("load").empty(), "load: and a second sweep finds none");
    }
    {
        // report allowance: a declared incident's report waits in the queue, then a gap names it with the declared id
        Config c;
        c.maxReportsPerMinute = 1;
        c.maxPendingReports = 1;
        Service s(c);
        for (const char* id : {"r1", "r2", "r3"}) stage(s, id);
        s.Sight(sample(101, {actor("a1", 20)}), 2.0);
        const auto r1 = s.CloseDeclared("r1", "engine_close", 3.0);
        const auto r2 = s.CloseDeclared("r2", "engine_close", 3.1);
        const auto r3 = s.CloseDeclared("r3", "engine_close", 3.2);
        Check(r1.outcome == "report" && r2.outcome == "report_queued" && r3.outcome == "gap" && r3.reports.size() == 1 && r3.reports[0]["event"] == "witness.gap" && r3.reports[0]["declared"]["id"] == "r3",
              "allowance: a declared report is delivered, queued or becomes a gap that names the declared incident; never silent");
        const auto later = s.Drain(70.0);
        Check(later.size() == 1 && later[0]["declared"]["id"] == "r2" && later[0]["delayed"] == true, "allowance: the queued one goes out later with its declared id");
    }
    {
        // a declared incident is never evicted for room
        Config c;
        c.maxOpen = 2;
        Service s(c);
        s.Observe(Obs("gunshot", 100, 0, {Person("A", kAggressor, 0, 20)}, 50, 20), 1.0);
        s.Observe(Obs("gunshot", 100, 900, {Person("B", kAggressor, 900, 20)}, 50, 20), 1.0);
        const auto made = stage(s, "keep", 101);
        Check(made.reports.size() == 1 && made.reports[0]["closed"] == "evicted" && s.DeclaredOpen() == 1 && L(s)["open"] == 2, "evict: declaring makes room by closing the least recently active ordinary incident");
        s.Observe(Obs("gunshot", 102, 1800, {Person("C", kAggressor, 1800, 20)}, 50, 20), 1.1);
        Config one;
        one.maxOpen = 1;
        Service t(one);
        stage(t, "only");
        const auto dropped = t.Observe(Obs("gunshot", 102, 900, {Person("B", kAggressor, 900, 20)}, 50, 20), 1.0);
        Check(!dropped.accepted && dropped.reason == "full" && t.DeclaredOpen() == 1, "evict: with only declared incidents open, an ordinary observation is dropped (full), never the declared one");
        bool limit = false;
        try { stage(t, "another"); } catch (const xfb::MethodError& e) { limit = std::string(e.code) == "incident_limit"; }
        Check(limit, "evict: and a declaration with no room is refused (limit)");
    }
    {
        // the spawn link's side in the incident service
        Service s;
        stage(s);
        ActorInfo at;
        at.exists = true;
        at.hasPos = true;
        at.pos[0] = 3;
        const auto joined = s.JoinDeclared("steal-1", "a3", "lookout", at);
        Check(joined["incident"] == "inc-1" && joined["role"] == "lookout" && joined["who"] == "a3" && joined["id"] == "steal-1" && joined["kind"] == "pickpocket", "join link: an actor joins under a role");
        const auto list = L(s, {{"state", "open"}})["incidents"][0];
        Check(list["declared"]["roles"]["a3"] == "lookout" && list["participants"].size() == 3 && s.SightPlan().size() == 3 && s.GetStats().joinedBySpawn == 1, "join link: the role, the participant and the sight plan follow");
        auto code = [&](const std::string& id, const std::string& who, const std::string& role) {
            try { s.JoinDeclared(id, who, role, at); }
            catch (const xfb::MethodError& e) { return std::string(e.code); }
            return std::string();
        };
        Check(code("nobody", "a4", "r") == "incident_unknown" && code("steal-1", "a4", "bad\"role") == "bad_params" && code("steal-1", "a3", "again") == "bad_params", "join link: an unknown incident, an unsafe role and a repeat are refused");
        Check(code("steal-1", "a4", "r") == "" && code("steal-1", "a5", "r") == "" && code("steal-1", "a6", "r") == "incident_limit", "join link: five actors at most (incident_limit)");
        s.LeaveDeclared("steal-1", "a6");
        s.LeaveDeclared("steal-1", "a5");
        s.LeaveDeclared("steal-1", "a4");
        Check(code("steal-1", "a4", "r") == "" && L(s, {{"state", "open"}})["incidents"][0]["declared"]["roles"].size() == 4, "join link: leaving takes the role back out");
        s.CloseDeclared("steal-1", "engine_close", 5.0);
        Check(code("steal-1", "a5", "r") == "incident_unknown", "join link: a closed incident takes no more actors");
    }
    {
        // the sight wire form
        std::string why;
        const json fact = {{"id", "9"}, {"w", "a1"}, {"d", 12.5}, {"in", 1}, {"los", 0}, {"pos", {1, 2, 3}}};
        const auto ok = ParseSight({{"sight", true}, {"sim", 10.5}, {"game", 99}, {"dist", "Watson"}, {"view", "gameplay"}, {"who", json::array({fact})}}, why);
        Check(ok && ok->simS == 10.5 && ok->who.size() == 1 && ok->who[0].who == "a1" && ok->who[0].los == Los::Clear && ok->view == "gameplay", "sight wire: a sample parses");
        Check(ParseSight({{"sight", true}, {"sim", 1}, {"view", "photo"}}, why).has_value() && !ParseSight({{"sight", true}, {"sim", 1}, {"view", "x"}}, why).has_value() && !ParseSight({{"sight", true}}, why).has_value() &&
              !ParseSight(json::array(), why).has_value(), "sight wire: photo is a view; an unknown view, no clock and a non-object are refused");
        json nine = json::array();
        for (int i = 0; i < 9; ++i) nine.push_back({{"id", std::to_string(i)}});
        json eight = json::array();
        for (int i = 0; i < 8; ++i) eight.push_back({{"id", std::to_string(i)}});
        Check(!ParseSight({{"sight", true}, {"sim", 1}, {"who", nine}}, why).has_value() && ParseSight({{"sight", true}, {"sim", 1}, {"view", "gameplay"}, {"who", eight}}, why).has_value(), "sight wire: eight people at most");
    }
    {
        // the methods: gates, refusals, the answer, the delivery hook, and the close
        xfb::Config config;
        config.maxRequestsPerSecond = 1000;
        xfb::Session session;
        session.token = "declared";
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        xfb::Dispatcher dispatcher(config, session, queue);
        Service s;
        bool tap = true, handed = false;
        int synced = 0;
        std::vector<json> delivered;
        MethodHooks h;
        h.allowTestHooks = true;
        h.taps = true;
        h.tapOn = [&] { return tap; };
        h.setTap = [&](bool on) { tap = on; };
        h.sync = [&] { ++synced; };
        h.emit = [&](std::vector<json> reports) { for (auto& r : reports) delivered.push_back(std::move(r)); };
        h.handedOver = [&] { return handed; };
        h.wall = [] { return 1.0; };
        h.actor = [](const std::string& handle) {
            ActorInfo info;
            info.exists = handle == "a1" || handle == "a2";
            info.hasPos = info.exists;
            info.pos[0] = handle == "a1" ? 4.0 : 8.0;
            return info;
        };
        RegisterMethods(dispatcher, s, h);
        auto call = [&](const char* method, const json& params) {
            return json::parse(dispatcher.Handle(xfb::SerializeJson(json{{"v", 1}, {"token", session.token}, {"method", method}, {"params", params}}), 1, false).line);
        };
        const json good = {{"id", "e1"}, {"kind", "pickpocket"}, {"roles", {{"a1", "thief"}, {"a2", "mark"}}}, {"ttl_s", 20}};
        s.Tick(100, 1.0);
        auto answer = call("incidents.declare", good);
        Check(answer["ok"] == true && answer["result"]["incident"] == "inc-1" && answer["result"]["id"] == "e1" && answer["result"]["kind"] == "pickpocket" && answer["result"]["roles"]["a2"] == "mark" &&
              answer["result"]["at"] == json::array({6.0, 0.0, 0.0}) && answer["result"]["at_from"] == "actors_centroid" && answer["result"]["ttl_s"] == 20.0 && answer["result"]["sampling"]["hz"] == 2 &&
              answer["result"]["undo"]["method"] == "incidents.close" && answer["result"]["passive"] == true && synced == 1, "method declare: opens it and answers our id with theirs, the place, the TTL and how it ends");
        answer = call("incidents.declare", good);
        Check(answer["ok"] == false && answer["error"]["code"] == "duplicate_id", "method declare: a duplicate is refused");
        answer = call("incidents.declare", {{"id", "e2"}, {"kind", "k"}, {"roles", {{"v", "x"}}}});
        Check(answer["ok"] == false && answer["error"]["code"] == "bad_params", "method declare: V is refused");
        answer = call("incidents.declare", {{"id", "e2"}, {"kind", "k"}, {"roles", {{"a9", "x"}}}});
        Check(answer["ok"] == false && answer["error"]["code"] == "npc_not_found", "method declare: an unknown actor is refused");
        tap = false;
        answer = call("incidents.declare", {{"id", "e3"}, {"kind", "k"}, {"roles", {{"a1", "x"}}}});
        Check(answer["ok"] == false && answer["error"]["code"] == "tap_off", "method declare: refused while the taps are off");
        tap = true;
        handed = true;
        answer = call("incidents.declare", {{"id", "e3"}, {"kind", "k"}, {"roles", {{"a1", "x"}}}});
        Check(answer["ok"] == false && answer["error"]["code"] == "handed_over", "method declare: refused while the session is handed over");
        handed = false;
        answer = call("incidents.close", {{"id", "nope"}});
        Check(answer["ok"] == false && answer["error"]["code"] == "incident_unknown", "method close: an id that is not open is refused (incident_unknown)");
        answer = call("incidents.close", json::object());
        Check(answer["ok"] == false && answer["error"]["code"] == "bad_params", "method close: the id is required");
        s.Sight(sample(101, {actor("a1", 20)}), 2.0);
        answer = call("incidents.close", {{"id", "e1"}});
        Check(answer["ok"] == true && answer["result"]["closed"] == true && answer["result"]["outcome"] == "report" && answer["result"]["incident"] == "inc-1" && answer["result"]["report"]["declared"]["id"] == "e1" &&
              delivered.size() == 1 && delivered[0]["event"] == "witness.report", "method close: one report, in the answer and delivered");
        answer = call("incidents.declare", {{"id", "e4"}, {"kind", "silent"}, {"roles", {{"a2", "x"}}}});
        answer = call("incidents.close", {{"id", "e4"}});
        Check(answer["ok"] == true && answer["result"]["outcome"] == "unwitnessed" && answer["result"]["unwitnessed_reason"] == "no_samples" && delivered.size() == 2 && delivered[1]["event"] == "witness.unwitnessed", "method close: unwitnessed says why, and is delivered");
        // the gates
        for (const char* m : {"incidents.declare", "incidents.close"})
        {
            xfb::Dispatcher off(config, session, queue);
            Service t;
            MethodHooks g;
            g.allowTestHooks = false;
            g.taps = true;
            RegisterMethods(off, t, g);
            const auto a = json::parse(off.Handle(xfb::SerializeJson(json{{"v", 1}, {"token", session.token}, {"method", m}, {"params", json::object()}}), 1, false).line);
            Check(a["ok"] == false && a["error"]["code"] == "test_hooks_off", "method: refused without allow_test_hooks");
        }
    }
    // ==== 0.8.21 review: four regressions =================================================================================
    {
        // 1. A terminal close leaves an outcome. The allowance is exhausted, so the second declared report waits; nothing but wall time or a
        // terminal shutdown may settle it, whether or not later evidence arrives.
        Config c;
        c.maxReportsPerMinute = 1;
        c.maxPendingReports = 4;
        const auto waiting = [&](Service& s) {
            stage(s, "r1");
            stage(s, "r2");
            s.Sight(sample(101, {actor("a1", 20)}), 2.0);
            const auto first = s.CloseDeclared("r1", "engine_close", 3.0);
            const auto second = s.CloseDeclared("r2", "kill", 3.1);
            Check(first.outcome == "report" && second.outcome == "report_queued" && s.PendingCount() == 1, "pending: the second report waits for the allowance");
        };
        {
            Service s(c);
            waiting(s);
            Check(s.Drain(20.0).empty() && s.PendingCount() == 1, "pending: with no later evidence and the allowance not recovered it still waits");
            const auto later = s.Drain(70.0);
            Check(later.size() == 1 && later[0]["declared"]["id"] == "r2" && later[0]["delayed"] == true && s.PendingCount() == 0, "pending: wall-clock housekeeping alone (no observation, no tap) delivers it as the allowance recovers");
        }
        {
            Service s(c);
            waiting(s);
            const auto out = s.ResolvePending(true, "tap_off");
            const auto listed = L(s, {{"id", "r2"}})["incidents"][0];
            Check(out.size() == 1 && out[0]["event"] == "witness.report" && out[0]["delayed"] == true && out[0]["resolved_by"] == "tap_off" && out[0]["declared"]["id"] == "r2" && s.PendingCount() == 0 &&
                  listed["reported"] == true && listed["report_pending"] == false, "pending: taps off with the transport up delivers every waiting report at once, marked");
            Check(s.ResolvePending(true, "tap_off").empty() && s.GetStats().reports == 2, "pending: and a second settle finds nothing");
        }
        {
            Service s(c);
            waiting(s);
            const auto out = s.ResolvePending(false, "kill");
            const auto list = L(s, {{"id", "r2"}});
            Check(out.size() == 1 && out[0]["event"] == "witness.gap" && out[0]["reason"] == "transport_down" && out[0]["closed_by"] == "kill" && out[0]["declared"]["id"] == "r2" && out[0]["incident"] == "inc-2" &&
                  out[0]["modes"] == json::array({"saw"}) && s.PendingCount() == 0, "pending: a kill with the transport down turns each waiting report into a witness.gap with the reason");
            Check(list["incidents"][0]["report_gap"] == true && list["incidents"][0]["report_pending"] == false && list["retained_gaps"].size() == 1 && list["retained_gaps"][0]["incident"] == "inc-2" &&
                  list["stats"]["report_gaps"] == 1 && list["pending_reports"] == 0, "pending: the gap is kept for the next incidents.list, and the incident says so");
            Check(s.ResolvePending(false, "kill").empty() && L(s)["retained_gaps"].size() == 1, "pending: settling twice makes one gap");
        }
        {
            // a queue-full gap is retained too
            Config tiny;
            tiny.maxReportsPerMinute = 1;
            tiny.maxPendingReports = 0;
            Service s(tiny);
            stage(s, "g1");
            stage(s, "g2");
            s.Sight(sample(101, {actor("a1", 20)}), 2.0);
            s.CloseDeclared("g1", "engine_close", 3.0);
            const auto gap = s.CloseDeclared("g2", "engine_close", 3.1);
            Check(gap.outcome == "gap" && L(s)["retained_gaps"].size() == 1 && L(s)["retained_gaps"][0]["declared"]["id"] == "g2", "pending: a witness.gap from a full queue is kept as well");
        }
    }
    {
        // 3. A merge moves the evidence timeline back, never the TTL.
        Service s;
        s.Tick(100, 1.0);
        s.Observe(Obs("melee", 95, 400, {Person("Q", kAggressor, 400, 20), Person("Y", kVictim, 400, 20)}), 1.0);
        stage(s, "ttl", 100, 10);
        const auto merged = s.Observe(Obs("melee", 101, 400, {actor("a1", 20), Person("Q", kAggressor, 400, 20)}), 1.1);
        const auto listed = L(s, {{"id", "ttl"}})["incidents"][0];
        Check(merged.incident == "inc-2" && listed["merged"].size() == 1 && listed["when"]["start_sim_s"] == 95.0, "ttl anchor: the merge moved the evidence timeline back to the older incident's start");
        Check(s.Tick(105.5, 2.0).empty() && s.DeclaredOpen() == 1, "ttl anchor: ...but the TTL did not move with it (it would have run out at 105)");
        const auto gone = s.Tick(110.0, 3.0);
        Check(gone.size() == 1 && gone[0]["closed"] == "ttl" && gone[0]["declared"]["id"] == "ttl", "ttl anchor: it runs out ttl_s after the declaration");
        // declared before any clock, merged, then anchored by the first clock
        Service c;
        Declaration d;
        d.id = "early";
        d.kind = "k";
        d.roles = {{"a1", "r"}};
        d.hasAt = true;
        d.ttlS = 10;
        c.Declare(d, 1.0);
        c.Tick(500, 1.0); // the first clock: the TTL starts here
        c.Observe(Obs("melee", 495, 400, {Person("Q", kAggressor, 400, 20), Person("Y", kVictim, 400, 20)}), 1.0);
        c.Observe(Obs("melee", 501, 400, {actor("a1", 20), Person("Q", kAggressor, 400, 20)}), 1.1);
        Check(c.Tick(509, 2.0).empty() && c.Tick(510, 3.0).size() == 1, "ttl anchor: anchored by the first clock, a merge does not move it either");
    }
    {
        // 4. Explicit declared roles choose first; accumulated participants never pull another declaration's actor.
        Service s;
        s.Tick(100, 1.0);
        const auto one = [&](const char* id, std::vector<std::pair<std::string, std::string>> roles) {
            Declaration d;
            d.id = id;
            d.kind = "k";
            d.roles = std::move(roles);
            d.hasAt = true;
            return s.Declare(d, 1.0);
        };
        one("A", {{"a1", "r"}});
        one("B", {{"a2", "r"}});
        const auto both = s.Observe(Obs("combat", 101, 0, {actor("a1", 20), actor("a2", 20)}), 1.0);
        Check(both.incident == "inc-1", "explicit: an observation naming one actor of each goes to the oldest declaration");
        const auto aList = L(s, {{"id", "A"}})["incidents"][0];
        bool aHoldsA2 = false;
        for (const auto& p : aList["participants"]) aHoldsA2 = aHoldsA2 || p["who"] == "a2";
        Check(aHoldsA2, "explicit: A now holds a2 as an accumulated participant");
        const auto later = s.Observe(Obs("gunshot", 102, 0, {actor("a2", 20)}, 50, 20), 1.1);
        Check(later.incident == "inc-2", "explicit: a later a2-only observation goes to B, whose explicit role it is, not to A");
        const auto laterSeen = s.Observe(Obs("gunshot", 103, 0, {actor("a1", 20)}, 50, 20), 1.2);
        Check(laterSeen.incident == "inc-1" && L(s, {{"id", "B"}})["incidents"][0]["evidence"]["gunshot"] == 1, "explicit: and a1 stays with A");
        one("C", {{"a1", "r"}, {"a2", "r"}});
        const auto most = s.Observe(Obs("combat", 104, 0, {actor("a1", 20), actor("a2", 20)}), 1.3);
        Check(most.incident == "inc-3", "explicit: the declaration holding the most of the observation's actors takes it, though younger");
        // a stranger an incident accumulated still groups by entity id when no explicit role matched
        s.Observe(Obs("melee", 105, 400, {Person("Q", kAggressor, 400, 20), Person("Y", kVictim, 400, 20)}), 1.4);
        const auto strangerJoins = s.Observe(Obs("melee", 106, 900, {actor("a1", 20), Person("Q", kAggressor, 900, 20)}), 1.5);
        Check(strangerJoins.incident == "inc-1", "explicit: an ordinary incident sharing a person with the chosen declaration merges into it");
        const auto afterQ = s.Observe(Obs("melee", 107, 900, {Person("Q", kAggressor, 900, 20)}), 1.6);
        Check(afterQ.incident == "inc-1", "explicit: with no explicit role in the observation, a participant still groups it (the stranger Q now belongs to A)");
    }
    std::printf("INCIDENTS %d checks, %d failed\n", checks, failures);
    return failures;
}
