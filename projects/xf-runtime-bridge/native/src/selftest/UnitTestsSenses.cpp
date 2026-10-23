// Unit checks for the senses (core/Senses.cpp, scene.read's npc_detail): parameter checks and the merge helpers shared by the
// plugin and the self-test host. Run with `xfb_selftest --unit`; same PASS/FAIL line format as UnitTests.cpp.

#include <cstdio>
#include <functional>
#include <string>

#include "core/Dispatcher.hpp"
#include "core/Scene.hpp"
#include "core/Senses.hpp"

namespace
{
using json = nlohmann::json;
namespace s = xfb::senses;

int gFailures = 0;

void Check(const char* aName, bool aOk)
{
    if (!aOk)
    {
        ++gFailures;
    }
    std::printf("%s unit: %s\n", aOk ? "PASS" : "FAIL", aName);
    std::fflush(stdout);
}

std::string Code(const std::function<void()>& aParse)
{
    try
    {
        aParse();
        return "ok";
    }
    catch (const xfb::MethodError& e)
    {
        return e.code;
    }
    catch (const std::exception& e)
    {
        return std::string("exception: ") + e.what();
    }
}

json Names(size_t aCount)
{
    json list = json::array();
    for (size_t i = 0; i < aCount; ++i)
    {
        list.push_back("q" + std::to_string(i) + "_done");
    }
    return list;
}

void FactTests()
{
    Check("senses: a fact name is letters, digits, _ and . up to 96 characters",
          s::FactNameOk("q000_done") && s::FactNameOk("Quest.fact_1") && s::FactNameOk(std::string(96, 'a')) && !s::FactNameOk("") &&
              !s::FactNameOk(std::string(97, 'a')) && !s::FactNameOk("a b") && !s::FactNameOk("a-b") && !s::FactNameOk("a\"b") && !s::FactNameOk("a,b") &&
              !s::FactNameOk("caf\xC3\xA9"));
    Check("senses: world.facts takes one name and 128 names, in order", [] {
        const auto one = s::ParseFacts(json{{"facts", json::array({"q000_done"})}});
        const auto many = s::ParseFacts(json{{"facts", Names(128)}});
        return one.facts.size() == 1 && many.facts.size() == 128 && many.facts.front() == "q0_done" && many.facts.back() == "q127_done";
    }());
    Check("senses: world.facts refuses 129 names, none, a missing list, a non-list",
          Code([] { s::ParseFacts(json{{"facts", Names(129)}}); }) == "bad_params" && Code([] { s::ParseFacts(json{{"facts", json::array()}}); }) == "bad_params" &&
              Code([] { s::ParseFacts(json::object()); }) == "bad_params" && Code([] { s::ParseFacts(json{{"facts", "q000_done"}}); }) == "bad_params" &&
              Code([] { s::ParseFacts(json{{"facts", nullptr}}); }) == "bad_params");
    Check("senses: world.facts refuses a bad name anywhere in the list, a non-string and an unknown parameter",
          Code([] { s::ParseFacts(json{{"facts", json::array({"ok_one", "bad name"})}}); }) == "bad_params" &&
              Code([] { s::ParseFacts(json{{"facts", json::array({"ok_one", 7})}}); }) == "bad_params" &&
              Code([] { s::ParseFacts(json{{"facts", json::array({"ok_one", nullptr})}}); }) == "bad_params" &&
              Code([] { s::ParseFacts(json{{"facts", json::array({std::string(97, 'x')})}}); }) == "bad_params" &&
              Code([] { s::ParseFacts(json{{"facts", json::array({"a"})}, {"preset", "main_story"}}); }) == "bad_params");
    Check("senses: world.facts reads a repeated name once", [] {
        const auto request = s::ParseFacts(json{{"facts", json::array({"a_b", "c_d", "a_b"})}});
        return request.facts.size() == 2 && s::Csv(request.facts) == "a_b,c_d";
    }());
    Check("senses: the facts answer counts what was asked and what reads non-zero", [] {
        json out{{"facts", {{"a", 0}, {"b", 2}, {"c", 1}}}};
        s::FinishFacts(out, 3);
        return out["requested"] == 3 && out["nonzero"] == 2 && out.contains("note");
    }());
}

void StatusAndDistrictTests()
{
    Check("senses: world.district takes no parameters", Code([] { s::ParseDistrict(json::object()); }) == "ok" && Code([] { s::ParseDistrict(json{{"x", 1}}); }) == "bad_params");
    Check("senses: player.status reads every part by default, or the named ones once each", [] {
        const auto all = s::ParseStatus(json::object());
        const auto some = s::ParseStatus(json{{"parts", json::array({"heat", "money", "heat"})}});
        return all.parts.empty() && some.parts.size() == 2 && some.parts[0] == "heat" && some.parts[1] == "money" && s::StatusParts().size() == 7;
    }());
    Check("senses: player.status refuses an unknown part, a non-list and an unknown parameter",
          Code([] { s::ParseStatus(json{{"parts", json::array({"wallet"})}}); }) == "bad_params" && Code([] { s::ParseStatus(json{{"parts", "heat"}}); }) == "bad_params" &&
              Code([] { s::ParseStatus(json{{"mode", 1}}); }) == "bad_params" &&
              Code([] { s::ParseStatus(json{{"parts", json::array({"vitals", "progress", "money", "heat", "vehicle", "inventory", "scanner", "vitals"})}}); }) == "bad_params");
}

void NpcDetailTests()
{
    Check("senses: scene.read's npc_detail is off by default, true when asked and refused when not a boolean", [] {
        const auto off = xfb::scene::ParseRead(json::object());
        const auto on = xfb::scene::ParseRead(json{{"npc_detail", true}});
        return !off.npcDetail && on.npcDetail && Code([] { xfb::scene::ParseRead(json{{"npc_detail", "yes"}}); }) == "bad_params";
    }());
    const json npcs = json::array({{{"id", "1"}, {"record", "Character.Judy"}},
                                   {{"id", "2"}, {"record", "Character.HomelessMan"}},
                                   {{"id", "3"}, {"record", "Character.Judy"}},
                                   {{"id", "4"}, {"record", "has space.x"}},
                                   {{"id", "5"}, {"record", "nodot"}},
                                   {{"id", "6"}, {"class", "Door"}}});
    Check("senses: the rows' records are asked for once each, only names a record can have", [&] {
        const auto records = s::NpcRecords(npcs);
        return records.size() == 2 && records[0] == "Character.Judy" && records[1] == "Character.HomelessMan" && s::NpcRecords(json::object()).empty();
    }());
    Check("senses: each row gets its character, null when the game has none or the row has no record", [&] {
        json rows = npcs;
        s::MergeNpcDetail(rows, json{{"Character.Judy", {{"npc_type", "Human"}}}, {"Character.HomelessMan", nullptr}});
        return rows[0]["character"]["npc_type"] == "Human" && rows[1]["character"].is_null() && rows[2]["character"]["npc_type"] == "Human" && rows[3]["character"].is_null() &&
               rows[4]["character"].is_null() && rows[5]["character"].is_null();
    }());
}
} // namespace

int SensesUnitTests()
{
    FactTests();
    StatusAndDistrictTests();
    NpcDetailTests();
    return gFailures;
}
