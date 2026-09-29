#pragma once

// scene.read (bridge 0.6): the parameters the plugin and the self-test host check the same way. The game side is the
// redscript layer's XFScene (XFRuntimeBridgeScene.reds); the tools build scene.report on top (tools/scene/report.ts).

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::scene
{
struct ReadRequest
{
    // camera, v, npcs, showroom, lights, world, ui; empty: all.
    std::vector<std::string> parts;
    float radius = 20.0f;   // metres around V for NPCs
    int32_t maxNpcs = 8;    // NPCs listed (the nearest the game's query returns first)
    bool occlusion = true;  // static-geometry rays from the camera to each face
    std::vector<std::array<double, 3>> points; // world points to push through the game's own projection (at most 32)
    std::array<double, 3> pieceEyes{0.0, 0.0497, 1.691}; // a showroom head's eyes in its entity frame
};

// photo.camera.preset (0.6, research): a photo-mode camera preset's flats rewritten through TweakXL, then selected, the camera
// read back. values: flat name -> value (dist, pitchDeg, yawDeg, rollDeg, distUpDown, distLeftRight, fov); select (default
// true) selects the preset afterwards; camera_preset (the undo) selects that preset instead (0: Customization).
struct PresetRequest
{
    int32_t preset = 9;
    std::vector<std::pair<std::string, float>> values;
    bool select = true;
    int32_t selectAfter = -1; // the undo's earlier selection (-1: the preset itself when select)
};
PresetRequest ParsePreset(const nlohmann::json& aParams);
// The flat names in the order the game lists them, with their ranges.
const std::vector<std::pair<std::string, std::pair<double, double>>>& PresetFlats();

const std::vector<std::string>& Parts();
ReadRequest ParseRead(const nlohmann::json& aParams);
// The parts as the redscript layer takes them: a comma list ("" for all).
std::string PartsText(const ReadRequest& aRequest);
} // namespace xfb::scene
