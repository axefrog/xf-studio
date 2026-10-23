#pragma once

// Bridge 0.7's new hooks, game-independent: parameter checks and the undo each write answers with, shared by the plugin
// (plugin/Handlers070.cpp) and the self-test host (selftest/Sim070.cpp), so both refuse the same requests the same way.
// research/runtime/bridge-hook-inventory.md ranks what these serve.
//
//   cyberware.state (read)            what each cyberware area holds; the arms' holster chain
//   cyberware.equip (write-inventory) an item into its cyberware area's slot, the earlier item as the undo
//   cyberware.unequip (write-inventory) one slot emptied, the item as the undo; remove_added drops a copy the bridge added
//   world.state (read)                the clock, rain, the weather state, named quest facts, photo mode's scene rows
//   world.probe (read)                streaming, walkable ground, ground and ceiling at points (observe only)
//   world.weather.set (write-world)   hold a weather state (Codeware), or give the weather back to the game's cycle
//   ui.state (read)                   menus, popups, photo mode's UI, the prompt, the CET overlay, the ink panel and the XF pins
//   game.saves (read)                 the save list with each save's metadata
//   photo.scene.set (write-photo)     photo mode's surrounding NPCs, weather and game speed rows
//   overlay.state (read)              the ImGui overlay host (core/overlay/Host.hpp)

#include <array>
#include <chrono>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::hooks
{
using json = nlohmann::json;

// The cyberware areas by the game's names (gamedataEquipmentArea), as XFCyberware lists them.
const std::vector<std::string>& CyberwareAreas();

struct CyberwareStateRequest
{
    std::vector<std::string> areas; // empty: all
};
CyberwareStateRequest ParseCyberwareState(const json& aParams);
std::string AreasCsv(const std::vector<std::string>& aAreas);

struct CyberwareEquipRequest
{
    std::string item;     // a record name, "Items.StrongArms"
    int32_t slot = -1;    // -1: the first empty slot (else slot 0)
    bool addIfMissing = false;
    std::string id;              // RB-109: the exact copy (its combined hash, digits), as an undo names the earlier item
    std::string removeAddedItem; // RB-109: after the equip, remove the copy of this record the bridge added (a swap's undo)
};
CyberwareEquipRequest ParseCyberwareEquip(const json& aParams);

// cyberware.equip's sequence (RB-101), shared by the plugin and the self-test host: the equip step (the script checks,
// adds only if asked, refuses before changing anything or takes an added copy back out itself), then the slot read back
// until it shows the item, then (a swap's undo) the added copy removed. Once the equip step has run its undo is always
// answered: a later failure (the slot never read back, the game gate closing, a timeout) answers `equipped: "unknown"`
// with the undo and the reason instead of losing it.
struct CyberwareEquipOps
{
    std::function<json()> equip;                              // the script's step: {area, slot, added, previous, id?, ...}
    std::function<json(const std::string&, int32_t)> settle;  // the slot read back until it shows the item: {item, empty}
    std::function<json(const std::string&)> removeAdded;      // remove the bridge's added copy of a record: {removed}
};
json RunCyberwareEquip(const CyberwareEquipRequest& aRequest, const CyberwareEquipOps& aOps);

struct CyberwareUnequipRequest
{
    std::string area;     // an area name, or empty with item
    std::string item;     // the record in the slot, optional
    int32_t slot = -1;    // -1: the item's slot, else 0
    bool removeAdded = false;
};
CyberwareUnequipRequest ParseCyberwareUnequip(const json& aParams);

// The undo of an equip, from its first step's answer {area, slot, previous, added}: the earlier item back, or the slot
// emptied (and an item the bridge added removed).
json CyberwareEquipUndo(const json& aStep, const std::string& aItem);
// The undo of an unequip, from {area, slot, previous}: the earlier item equipped again into its slot (null when the slot
// was empty or the item was removed).
json CyberwareUnequipUndo(const json& aStep, bool aRemoved);

struct WorldStateRequest
{
    std::vector<std::string> facts; // quest fact names, at most 16
};
WorldStateRequest ParseWorldState(const json& aParams);

struct WorldProbeRequest
{
    std::vector<std::array<double, 3>> points; // at most 16
    double radius = 2.0;                        // the navmesh search, 0.2-10 m
    double down = 10.0;                         // how far below each point the ground ray looks, 0.5-100 m
    // around V instead of points: a ring of count points at ring_m from V (plus V's own place)
    bool aroundV = false;
    double clearance = 0.0;                      // 0.7: level rays this long from each point (0: none), 0.05-3 m
    std::optional<std::array<double, 3>> sightFrom; // a sight line from here to each point

    double ringM = 3.0;
    int32_t count = 8;
};
WorldProbeRequest ParseWorldProbe(const json& aParams);
// The ring's points about a centre, facing yaw 0 = +Y, counter-clockwise, first point straight ahead of yaw.
std::vector<std::array<double, 3>> RingPoints(const std::array<double, 3>& aCentre, double aYawDeg, double aRadius, int32_t aCount);

struct WeatherRequest
{
    std::string name; // a weather state, "24h_weather_rain"; empty with cycle: give the weather back to the game
    double blend = 2.0;
    bool cycle = false;
};
WeatherRequest ParseWeather(const json& aParams);
json WeatherUndo(const json& aStep);

struct PhotoSceneRow
{
    int32_t key = 0;
    std::optional<double> value; // the option data or slider value
    std::string label;           // or an option's on-screen label
};
struct PhotoSceneRequest
{
    std::vector<PhotoSceneRow> rows;
};
// photo.scene.set's sequence (RB-111): each row resolved (a label to its option's value) and set in order; when a later row
// fails, the rows already set are put back (newest first) before the refusal, which names what was put back.
struct PhotoSceneOps
{
    std::function<json(const PhotoSceneRow&)> resolve; // {value, matched_by}
    std::function<json(int32_t, double)> set;          // {before, before_known, after, ...}
};
json RunPhotoScene(const PhotoSceneRequest& aRequest, const PhotoSceneOps& aOps);
inline constexpr int32_t kPhotoNpcs = 54;
inline constexpr int32_t kPhotoWeather = 69;
inline constexpr int32_t kPhotoGameSpeed = 71;
PhotoSceneRequest ParsePhotoScene(const json& aParams);

struct SavesRequest
{
    int32_t limit = 20;
    int32_t waitMs = 3000;
};
SavesRequest ParseSaves(const json& aParams);
// game.saves' sequence (RB-118): the request, reads until the details stop arriving or the wait ends, and always a final
// step that stops collecting (even when a read throws), so the load menu's callback never stays registered.
struct SavesOps
{
    // 0.8 (session 8's H1): the request names how many of the newest saves' details to ask for (each one's screenshot
    // request, as the Load menu makes; the game answers with the details).
    std::function<void(int32_t aLimit)> request;
    std::function<json(bool)> read; // read(done): the names and metadata so far; done stops collecting
    std::function<void(std::chrono::milliseconds)> sleep;
    std::function<std::chrono::steady_clock::time_point()> now;
};
json RunSaves(const SavesRequest& aRequest, const SavesOps& aOps);
// Keeps the newest aLimit saves' metadata (by timestamp) and marks names without metadata.
json TrimSaves(const json& aAnswer, int32_t aLimit);
} // namespace xfb::hooks
