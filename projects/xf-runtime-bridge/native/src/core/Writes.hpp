#pragma once

// What the write methods decide, kept apart from the game calls so the plugin and the self-test
// host share it and the unit tests (`xfb_selftest --unit`) cover it: the undo each write returns,
// the light-set sequence, waiting for game ticks, and the kill switch's once-only restore.
//
// The game side is reached only through the small function objects below: the plugin fills them
// with redscript calls on the game thread, the self-test host and the unit tests with fakes.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/GameThreadQueue.hpp"
#include "core/Params.hpp"

namespace xfb::writes
{
using json = nlohmann::json;

// An attribute result from the script layer is {key, label, before, after, before_known}, plus the
// parameter name the plugin adds. before_known = false (or a missing value) means the game could
// not report the earlier value; such an attribute is left out of the undo and named in aUnknown.
json UndoParams(const json& aApplied, std::vector<std::string>* aUnknown = nullptr);

// Sets aResult["undo"] to {"method": m, "params": p}, or to null when p is empty (nothing to undo),
// with aEmptyNote as "undo_note". Values the game could not report are named in "undo_note" too.
void AttachUndo(json& aResult, const std::string& aMethod, const json& aParams,
                const std::vector<std::string>& aUnknown = {}, const std::string& aEmptyNote = "nothing to undo");

// photo.camera.set reset = true: the per-key reset results (each given its parameter name) and an
// undo that puts back every value the reset changed.
json CameraResetResult(json aResets);

// photo.camera.set reset = true: resets each key through aReset (which returns an attribute
// result or throws MethodError). A key photo mode doesn't offer ("unavailable") is skipped; any
// other failure is collected and the rest still run, so the answer is partial (partial = true,
// errors [{name, key, code, message}]) with an undo for what was reset. When nothing was reset
// and something failed, the first failure is thrown, naming the rest.
json CameraReset(const std::vector<int32_t>& aKeys, const std::function<json(int32_t aKey)>& aReset);

// photo.hud.hide: the script's {hidden, was_hidden, cursor_hidden, was_cursor_hidden} with an undo
// that puts the menu (and the cursor, when both were in the same state) back.
json HudResult(json aScript);

// world.pause: the script's {frozen, was_frozen} with an undo to the state before the call; no
// undo when nothing changed or the earlier state is unknown.
json PauseResult(json aScript);

// photo.expression.set: the attribute result with an undo to the earlier expression, if known.
json ExpressionResult(json aScript);

// photo.expression.index: the script's {target, index, menu_value, menu_value_known}. The face index
// bypasses the menu, so the undo selects the menu's own expression again (photo.expression.set with
// the menu's value, which re-applies it through the menu); no undo when the menu's value is unknown.
json ExpressionIndexResult(json aScript);

// What LightSet needs from the game.
struct LightOps
{
    // Sets one photo-mode attribute and returns its result (see UndoParams). Throws MethodError.
    std::function<json(int32_t aKey, float aValue)> set;
    // Waits until photo mode has loaded the newly selected light's values into its sliders.
    // Throws MethodError("timeout", ...) when that doesn't happen in time.
    std::function<void()> settle;
};

// photo.light.set: select the light, wait for photo mode to load it, set the values, then select
// select_after if given. On a failure after the selection changed, the previous selection is put
// back where possible, and the message says exactly what changed. The undo restores the values
// and, when this call changed it, the menu's selection (select_after).
json LightSet(const params::LightRequest& aRequest, const LightOps& aOps);

// What CreatorOpen needs from the game. Each game step throws MethodError to refuse.
struct CreatorOpenOps
{
    // Game thread: checks that this is a safe moment (V in the world, no combat, scene, vehicle or
    // menu) and requests the save lock. Answers {already_open: true} when the screen is open already.
    std::function<json()> prepare;
    // Waits a few game ticks, so the game has processed the save-lock request.
    std::function<void()> settle;
    // Game thread: checks the moment again, refuses unless saving is locked, then asks the idle menu
    // scenario to open the appearance screen (the request is picked up a frame or two later).
    std::function<json()> open;
    // Game thread: the game's phase now (game.status's phase).
    std::function<std::string()> phase;
    // Game thread: withdraws a request that didn't open the screen in time. Answers
    // {withdrawn: true} when the request was still waiting (nothing can open now), {taken: true} when
    // the menu had already picked it up (the screen may still be opening), or {} when the game
    // couldn't say (the cancel itself failed).
    std::function<json()> cancel;
    std::function<void(std::chrono::milliseconds)> sleep;
};

// cc.open: prepare, settle, open, then wait until the phase is character_menu (aRequest.timeoutMs).
// The result carries the undo (cc.back, which discards every change and closes the screen).
//  - A refusal from open() (stage 2, after prepare took the save lock) says that saving stays locked
//    until a save is loaded (RB-46).
//  - Anything that throws once open() has started (open itself, a phase poll) withdraws the request
//    before the error goes back (RB-43), and says whether the withdrawal worked.
//  - On a timeout the request is withdrawn. Only when the withdrawal says the request was still
//    waiting is the answer creator_open_timeout ("nothing opened"). When the menu had already taken
//    it, the phase is polled a little longer (kCreatorLateOpen) and a late screen counts as opened;
//    otherwise, or when the game couldn't say, the answer is creator_open_uncertain, which tells the
//    caller to check the phase and use cc.back (RB-42).
inline constexpr int32_t kCreatorLateOpenMs = 2000;
json CreatorOpen(const params::CreatorOpenRequest& aRequest, const CreatorOpenOps& aOps);

// What PoseSet needs from the game. Each step throws MethodError to refuse.
struct PoseSetOps
{
    // Game thread: finds the requested category in the photo-mode menu (attribute 5), notes the menu's
    // category and pose before the call ({before_category, before_pose, before_known}), and selects the
    // category if it isn't selected already ({changed, category_value, category_text}).
    std::function<json()> category;
    // Waits a few game ticks, so photo mode can rebuild the pose list for a newly selected category.
    std::function<void()> settle;
    // Game thread: selects the requested pose (attribute 6) in the current list ({changed, pose_value,
    // pose_text}).
    std::function<json()> pose;
    // Game thread: selects this category again after a failure (option data).
    std::function<void(int32_t aCategoryValue)> restoreCategory;
};

// photo.pose.set: category, settle (only after a change), pose. The undo selects the earlier category
// and pose by option data; a failure after the category changed puts the category back.
json PoseSet(const PoseSetOps& aOps);

// Bridge thread: waits until the game thread has drained the queue aTicks more times (one drain
// per engine tick), up to aTimeout. False on timeout (or a closed queue).
bool WaitTicks(const GameThreadQueue& aQueue, uint64_t aTicks, std::chrono::milliseconds aTimeout);

// The kill switch's restore, at most once per process: only after a write ran, and only once the
// bridge says it is ready (killed, and the queue closed so no write can follow it).
class RestoreOnce
{
public:
    // A write method is about to run (it may change the game even if it then fails).
    void MarkWrite();
    bool WritesUsed() const;
    bool Done() const;
    // True while a kill switch restore is still owed: a write ran and the restore hasn't run yet.
    bool Pending() const;
    // Re-arm (a fresh bridge after the kill switch): forget the last generation's writes, so the next
    // kill switch restores again. Only once nothing is owed (Pending() false); returns false otherwise.
    bool Reset();

    // Game thread, once per tick. Runs aRestore when aReady, a write ran and it hasn't run yet.
    // Never throws: a failing restore is reported through aOnError and is not retried.
    // Returns true when it ran in this call.
    bool Tick(bool aReady, const std::function<void()>& aRestore,
              const std::function<void(const std::string&)>& aOnError = {});

private:
    std::atomic<bool> m_writes{false};
    std::atomic<bool> m_done{false};
};
} // namespace xfb::writes
