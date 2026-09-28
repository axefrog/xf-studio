#pragma once

// XF Finish Showroom (bridge 0.5): mannequin heads and creator-style light rigs from the XF Finish Showroom test mod, spawned
// in front of V through Codeware's static entity system (redscript/XFRuntimeBridgeShowroom.reds), turned for highlight
// sweeps and removed again. Game-independent: parameter checks and the multi-step sequences, shared by the plugin and the
// self-test host, which supply the game steps (ShowroomOps).
//
// Where the pieces go is worked out by the tools (tools/showroom/layout.ts) from showroom.anchor; the bridge only places
// what it is given, within bounds, and only the XF Finish Showroom's own templates (its paths are checked here).
// Nothing persists: static entities have no persistence, the kill switch clears them, and loading a save removes them.

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::showroom
{
using json = nlohmann::json;

// Limits: a lineup of at most 24 heads, one rig per head plus one for V, placed within this distance of V.
inline constexpr size_t kMaxPieces = 24;
inline constexpr size_t kMaxRigs = 25;
inline constexpr double kMaxDistanceFromV = 30.0;

enum class Kind
{
    Piece, // a mannequin head (xfs_showroom.ent, appearance xfs_p<preset>)
    Rig    // a light rig (xfs_showroom_rig.ent, appearance xfs_rig_<profile>)
};
const char* KindName(Kind aKind);

struct Placement
{
    int32_t index = 0; // 0-based; pieces are numbered in the lineup, a rig carries the index of the piece it lights (-1: V)
    std::string templatePath;
    std::string appearance;
    std::string label;
    double x = 0, y = 0, z = 0;
    double yaw = 0; // degrees about +Z; 0 faces +Y (world north)
};

// showroom.place / showroom.lights: {items: [{index, template, appearance, label, x, y, z, yaw}], replace (default true: remove
// every earlier item of this kind first)}. Templates must be the XF Finish Showroom's own (TemplateOk).
struct PlaceRequest
{
    Kind kind = Kind::Piece;
    std::vector<Placement> items;
    bool replace = true;
};
PlaceRequest ParsePlace(const json& aParams, Kind aKind);

// showroom.turn: {turns: [{index, yaw}]} (pieces only; world yaw in degrees).
struct Turn
{
    int32_t index = 0;
    double yaw = 0;
};
std::vector<Turn> ParseTurn(const json& aParams);

// showroom.clear: {what: "all" (default), "pieces" or "lights"}.
std::string ParseClear(const json& aParams);

// The XF Finish Showroom's templates and appearance names; nothing else can be spawned.
bool TemplateOk(Kind aKind, const std::string& aPath);
bool AppearanceOk(Kind aKind, const std::string& aName);

struct Ops
{
    // Before each step that changes the game: throws killed or writes_paused (RB-53).
    std::function<void()> guard;
    // Game thread: spawns one item ({entity, spawning}) or throws what the script refused.
    std::function<json(Kind, const Placement&)> spawn;
    // Game thread: removes every item of a kind ("pieces", "lights" or "all"): {removed_pieces, removed_lights}.
    std::function<json(const std::string&)> clear;
    // Game thread: turns one piece to a world yaw: {index, previous_yaw, yaw}.
    std::function<json(int32_t, double)> turn;
    // Game thread: what the showroom holds now (showroom.state's answer).
    std::function<json()> status;
    // Waits a few game ticks (static entities spawn asynchronously).
    std::function<void()> settle;
};
inline constexpr int kSpawnPolls = 20;

// showroom.place / showroom.lights: optionally clears the kind, spawns each item (checking the kill switch before each), then
// waits until the entities exist (kSpawnPolls settles at most) and answers with the state and the undo (showroom.clear).
// A refusal part-way leaves the items already spawned in place and says so; showroom.clear removes them.
json Place(const PlaceRequest& aRequest, const Ops& aOps);
// showroom.turn: each turn in order; the undo turns them back.
json TurnPieces(const std::vector<Turn>& aTurns, const Ops& aOps);
// showroom.clear.
json Clear(const std::string& aWhat, const Ops& aOps);
} // namespace xfb::showroom
