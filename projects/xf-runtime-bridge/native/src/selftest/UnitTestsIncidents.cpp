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
    std::printf("INCIDENTS %d checks, %d failed\n", checks, failures);
    return failures;
}
