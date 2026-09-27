#pragma once

// The live-posing experiment's game side (research/animation/pose-editor-design.md §7.4, phase L0):
// finding a loaded animation set and one of its clips in the game's memory, checking the clip's key
// layout, and (pose.live.apply) writing the XF carrier clip's constant keys. The checks and the plan are
// core/LivePose.hpp (unit-tested); this file only reads and writes the game's memory, on the game thread.
//
// Safety:
//  - Engine addresses (the resource loader and what its tokens release) are resolved when the plugin
//    loads, as for script calls (RB-32); without them every live-pose method is refused.
//  - Every field offset the code relies on is checked against the game's own reflection data before
//    any read (a patch that moves a field refuses with layout_unrecognised instead of reading wrong
//    memory); the key runs must match the counts exactly and follow each other (core/LivePose.cpp).
//  - Nothing is kept between calls but the carrier's original keys: every call finds the set again
//    through the resource loader, and a restore writes the originals back only into the same buffer
//    (same address, same key count), so a set that was unloaded and loaded again is never written.
//  - Writes go into the XF carrier clip only (core/LivePose.hpp kCarrierSet, kCarrierClip), which only
//    the test package ships, and only when it passes the carrier contract.

#include <string>

#include <nlohmann/json.hpp>

#include "core/Params.hpp"

namespace xfb::plugin::live
{
// At load: resolves the engine addresses the live-pose methods need. False (and every live-pose method
// refused for the session) when one is missing.
bool ResolveAddresses();
bool Available();

// pose.live.read (game thread).
nlohmann::json Read(const params::PoseLiveReadRequest& aRequest, const std::string& aCid);

// pose.live.apply (game thread): writes the rotations (and the Hips translation) into the carrier,
// keeping its original keys for the undo. The caller checks the gate and that the carrier is selected.
nlohmann::json Apply(const params::PoseLiveApplyRequest& aRequest, const std::string& aCid);

// pose.live.apply {restore: true}, and the kill switch (game thread): writes the original keys back
// when the same carrier buffer is still loaded; drops them otherwise. Never throws when aQuiet.
nlohmann::json Restore(const std::string& aCid, bool aQuiet);

// Whether original keys are held (a write happened and wasn't restored).
bool HasSnapshot();
} // namespace xfb::plugin::live
