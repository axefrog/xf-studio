#pragma once

// The senses for the Story Engine (research/story-engine/runtime-requirements.md S2 to S6): read-only additions, game-independent
// pieces shared by the plugin (plugin/HandlersSenses.cpp) and the self-test host (selftest/SimSenses.cpp), so both refuse the same
// requests the same way. The game side is the redscript layer's XFSenses (XFRuntimeBridgeSenses.reds).
//
//   world.facts (read)      up to 128 named quest facts in one call, names validated here
//   world.district (read)   V's district, subdistrict and place from the game's district system
//   player.status (read)    vitals, level and street cred, money, wanted level, vehicle, inventory summary, scanner
//   scene.read npc_detail   each NPC row gains its character record's affiliation, type, rarity and flags

#include <cstddef>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::senses
{
using json = nlohmann::json;

// world.facts: at most this many names in a request (the main-story table of 93 fits in one call).
inline constexpr size_t kMaxFacts = 128;
// A fact name: letters, digits, '_' and '.', 1 to 96 characters.
inline constexpr size_t kMaxFactNameLength = 96;
bool FactNameOk(const std::string& aName);

struct FactsRequest
{
    std::vector<std::string> facts; // in the order given, each once
};
FactsRequest ParseFacts(const json& aParams);
// The names as the script layer takes them: a comma list.
std::string Csv(const std::vector<std::string>& aNames);
// The script's {facts: {name: value}} gains how many were asked for, how many read non-zero, and the names that read zero count
// as "unset or 0" (the game answers 0 for a fact it never set).
void FinishFacts(json& aOut, size_t aRequested);

// world.district takes no parameters.
void ParseDistrict(const json& aParams);

// player.status: which parts, by name (empty: all).
const std::vector<std::string>& StatusParts();
struct StatusRequest
{
    std::vector<std::string> parts;
};
StatusRequest ParseStatus(const json& aParams);

// scene.read's npc_detail: the character records of the rows' "record" names (each once, only names a record can have),
// and the rows given their "character" from the script's answer ({record: detail or null}).
std::vector<std::string> NpcRecords(const json& aNpcs);
void MergeNpcDetail(json& aNpcs, const json& aCharacters);
} // namespace xfb::senses
