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

// world.time.set on the world's clock: the script's {before_total_seconds, ...} with an undo that restores
// that exact time (total_seconds, target world).
json TimeResult(json aScript);

// world.time.set's route (0.5.1; RB-67, RB-70). In photo mode (phase photo_mode) the time is photo mode's own
// time-of-day slider (attribute 70): refused with target world (the world's clock is set outside photo
// mode), with total_seconds, and unless the photo write class is allowed (write_class_disabled: a photo-mode
// setting, whatever class the method is registered under). Outside photo mode target photo is a no-op
// (PhotoClosed: photo mode's time of day went with it, and its undo must never reach the world's clock, which
// can trigger timed quest events); otherwise the world's clock.
enum class TimeRoute
{
    World,
    Photo,
    PhotoClosed,
};
TimeRoute ChooseTimeRoute(const params::TimeRequest& aRequest, const std::string& aPhase, bool aPhotoClassAllowed);

// The PhotoClosed answer: nothing changed, no undo.
json PhotoClosedTimeResult(const std::string& aPhase);

// Photo mode's time-of-day slider, as XFWorld.PhotoTimeSlider describes attribute 70: {seen, kind, label,
// label_key, min, max}. PlanPhotoTime checks it is a time of day (a slider whose label or label key names a
// time, RB-70, over a day's range: 0-24 hours or 0-1440 minutes) and converts the request into its unit.
struct PhotoTimePlan
{
    double value = 0;          // what to set, in the slider's unit
    double minutesPerUnit = 1; // 1 (minutes) or 60 (hours)
    std::string label;
};
PhotoTimePlan PlanPhotoTime(const json& aSlider, const params::TimeRequest& aRequest);

// The answer after XFPhoto.SetAttribute ({before, before_known, after, label}): minutes before and after,
// and an undo in hours and minutes with target photo, or none when the earlier value is unknown.
json PhotoTimeResult(const json& aSet, const PhotoTimePlan& aPlan);

// photo.expression.set: the attribute result with an undo to the earlier expression, if known.
json ExpressionResult(json aScript);

// photo.expression.index's list check (0.5.1, RB-72). aList is XFPhoto.FaceIndexEntries' answer, {seen,
// entries: [{data, table_index, table_index_by: "label" | "position", table_index_verified}]}: each
// expression option's face table index, found by the option's name among the face records (verified) or,
// when no single record matches, taken from the record at the option's list position (unverified: session 4
// found position isn't the table index with an expression pack installed). Returns how the index stands:
// "unlisted" (the caller passed unlisted; nothing checked), "label" (a verified index), or "position" (only an
// unverified one matches, and the caller passed force). Throws unavailable (the list wasn't seen),
// unverified_index (position only, without force) or bad_params (no option has that table index).
std::string CheckFaceIndex(const params::ExpressionIndexRequest& aRequest, const json& aList);

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
    // Moves light aLight's entity (place about V or at a world position), aimed at V's head:
    // {before: {x,y,z}, after: {x,y,z}, ...}. Throws MethodError (unavailable when the entity isn't found).
    std::function<json(int32_t aLight, const params::LightPlacement& aPlacement)> place;
    // Where light aLight's entity is now: {position: {x,y,z}}. Optional; throws MethodError.
    std::function<json(int32_t aLight)> position;
};

// photo.light.set: select the light, wait for photo mode to load it, set the values, place it if asked
// (place), then select select_after if given. On a failure after the selection changed, the previous
// selection is put back where possible, and the message says exactly what changed. The undo restores the
// values, the light's earlier position (place: {world}) and, when this call changed it, the menu's
// selection (select_after).
//  - type (setting 45) isn't in every game version's menu (2.31 has no type row): when photo mode doesn't
//    offer it, it is skipped with a note (skipped: [{name, reason}]) instead of failing the call.
//  - place "camera" switches the light off and on again (photo mode places a light where the camera is
//    when it switches on); a position moves the light's entity and reads it back after a few frames
//    (held: whether photo mode kept it there). Both record the light's earlier position for the undo
//    (RB-59; camera reads it first); once a light has moved, a later failure names the undo that puts
//    it back, and a failed read-back is reported (now_unknown), never a failure (RB-60).
json LightSet(const params::LightRequest& aRequest, const LightOps& aOps);

// --- inventory.equip / inventory.unequip --------------------------------------------------------------

struct InventoryOps
{
    // Game thread, step 1 of equip: checks, adds the item if asked, queues the equip request:
    // {item, slot, added, already_equipped, previous}.
    std::function<json()> equip;
    // Game thread, step 1 of unequip: {slot, previous, was_empty}.
    std::function<json()> unequip;
    // Game thread: what a slot holds now ({slot, item, empty, matches}); by slot name or by an item's own
    // slot. matches: the slot holds aItem, compared by record ID in the script (RB-63).
    std::function<json(const std::string& aSlot, const std::string& aItem)> slot;
    // Game thread: removes an item the bridge added this session ({removed}).
    std::function<json(const std::string& aItem)> removeAdded;
    // Waits a few game ticks (the equipment system handles requests on later frames).
    std::function<void()> settle;
};
inline constexpr int kInventoryPolls = 15;

// inventory.equip: equip, then read the slot until it shows the item (kInventoryPolls settles). The result
// says whether it did (equipped) and carries the undo: the earlier item back, or the slot emptied (and an
// added item removed again).
json InventoryEquip(const params::InventoryEquipRequest& aRequest, const InventoryOps& aOps);
// inventory.unequip: unequip the slot (or the item's slot), read it until it's empty, then remove the item
// if asked and the bridge added it. The undo equips the earlier item again (not after a removal).
json InventoryUnequip(const params::InventoryUnequipRequest& aRequest, const InventoryOps& aOps);

// --- game.save / game.load --------------------------------------------------------------------------

// A clock for the save and load waits (steady_clock::now when empty; the unit tests pass a fake that
// their sleep advances).
using Clock = std::function<std::chrono::steady_clock::time_point()>;

struct SaveOps
{
    // Bridge thread, before each step that changes the game (releasing the lock, asking for the save):
    // throws MethodError (killed, writes_paused) when the kill switch or the panel's pause came since the
    // request arrived (RB-53). Optional.
    std::function<void()> guard;
    // Game thread: checks the moment, and with override_lock releases the bridge's own save lock
    // ({lock_released}). Throws bridge_save_lock or saving_locked.
    std::function<json()> prepare;
    // Game thread: {locked, state} (state: none, pending, saved, failed).
    std::function<json()> status;
    // Game thread: asks for one new manual save ({requested}).
    std::function<json()> save;
    // Takes the bridge's save lock again after it was released. Never throws: when the game thread can't
    // take it now (the kill switch closed the queue, a timeout), the plugin retakes it on the next tick.
    std::function<void()> relock;
    std::function<void(std::chrono::milliseconds)> sleep;
    Clock now;
};
inline constexpr int32_t kSaveUnlockWaitMs = 3000;

// game.save: prepare, wait for a released lock to go (kSaveUnlockWaitMs), save, then wait for the game's
// answer (aRequest.timeoutMs). saved: {saved: true, ...}; failed: save_failed; no answer: save_uncertain.
// The waits are steady-clock deadlines (RB-55). Once prepare has released the bridge's lock, every way
// out takes it back (RB-52): success, a refusal, the kill switch or pause (guard), a game-thread timeout,
// save() throwing, save_failed and save_uncertain.
//
// Worst case on the server, with T the longest game-thread step (request_timeout_ms to start plus the
// queue's running grace, GameThreadQueue::kDefaultRunningGrace; 2000 + 1000 ms by default): prepare T, the unlock wait kSaveUnlockWaitMs plus one status step T, save T, the answer wait
// timeoutMs plus one status step T, and the relock T: timeoutMs + kSaveUnlockWaitMs + 5 T. The tools'
// client timeout is derived from this (tools/api/catalogue.ts, saveClientTimeoutMs).
json GameSave(const params::GameSaveRequest& aRequest, const SaveOps& aOps);

struct LoadOps
{
    std::function<void()> guard;                                  // as SaveOps::guard, before loading
    std::function<json()> latest;                                 // game thread: quick-load path
    std::function<json()> list;                                   // game thread: ask for the save list again
    std::function<json()> saves;                                  // game thread: {ready, saves: [...]}
    std::function<json(const std::string& aName)> load;           // game thread: look the name up in the list and load it
    std::function<void(std::chrono::milliseconds)> sleep;
    Clock now;
};
inline constexpr int32_t kSaveListWaitMs = 5000;

// A save's position in the game's list: the exact name, else the one name equal ignoring case; -1 when
// none, -2 when several match ignoring case.
int32_t FindSave(const std::vector<std::string>& aSaves, const std::string& aName);

// game.load: latest, or the save by name. By name, the game's list is fetched again for every load
// (kSaveListWaitMs, a steady-clock deadline), the name is resolved in it (FindSave), and the load step
// looks that exact name up again in the game's list in the same game-thread step as it loads, so a list
// that changed since can't load another save (RB-58). The answer lists some names when the name isn't
// found. Worst case on the server: list T, the wait kSaveListWaitMs plus one step T, load T:
// kSaveListWaitMs + 3 T (tools/api/catalogue.ts, loadClientTimeoutMs).
json GameLoad(const params::GameLoadRequest& aRequest, const LoadOps& aOps);

// cc.confirm / cc.back: how the appearance screen is left. Back discards every change on the screen, so
// cc.confirm uses it only when it is certain nothing changed (RB-51): aState is the script's
// {changes, unchanged} (change events of every kind since the screen opened; every option equal to the
// snapshot taken when the screen set its options up). A missing or unexpected value counts as changed.
enum class LeaveRoute
{
    Confirm,          // ConfirmCustomizedCharacter: the look is kept
    Back,             // cc.back: every change discarded
    NothingToConfirm, // cc.confirm with certainly nothing changed: closed through Back, nothing discarded
};
LeaveRoute ChooseLeave(bool aKeep, const json& aState);
int32_t LeaveRouteCode(LeaveRoute aRoute); // the script's mode: 0 Back, 1 Confirm, 2 NothingToConfirm

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
    // {withdrawn: true} when the request was still waiting (the screen can't open now; with
    // pause_menu_may_open: true, its pause-menu event was raised, so the pause menu may open as usual),
    // {taken: true} when the menu had already picked it up (the screen may still be opening), or {} when
    // the game couldn't say (the cancel itself failed).
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
//    waiting is the answer creator_open_timeout (the screen won't open). When the menu had already taken
//    it, the phase is polled a little longer (kCreatorLateOpen) and a late screen counts as opened;
//    otherwise, or when the game couldn't say, the answer is creator_open_uncertain, which tells the
//    caller to check the phase and use cc.back (RB-42).
//  - A request withdrawn while still waiting had its pause-menu event raised in the same step, so the
//    withdrawal answers pause_menu_may_open and the error says the pause menu may open as usual (RB-69).
inline constexpr int32_t kCreatorLateOpenMs = 2000;
json CreatorOpen(const params::CreatorOpenRequest& aRequest, const CreatorOpenOps& aOps);

// cc.open's pause-menu redirect (the script's MenuScenario_PauseMenu.OnEnterScenario wrap asks through the
// native XFBridge_CreatorRedirect; RB-69, RB-75). aState is {pending, age_s, prev, refused, withdrawn_age_s}:
// whether a bridge request waits, its age in seconds of engine time, the scenario the pause menu came from,
// whether the moment no longer allows it, and seconds since a waiting request was withdrawn (-1 none).
// The answer:
//  - "redirect": a request at most kCreatorRedirectWindowS old, the pause menu entered from normal play
//    (kCreatorRedirectFrom) and the moment still right: switch to the mirror's scenario.
//  - "foreign": a request waits, but the pause menu came from another scenario (the credits picker, the debug
//    hub): the pause menu opens as usual and the request keeps waiting.
//  - "expired": older than the window, negative (an engine-time reset) or not a number: taken, pause menu.
//  - "refused": fresh but the moment passed (combat, a scene, a vehicle, not V): taken, pause menu.
//  - "withdrawn": no request, but one withdrawn within the window after its event was raised, from normal
//    play: the pause menu opens as usual, logged.
//  - "none": the pause menu opens as usual.
// Anything the script doesn't recognise (an empty answer when the native fails) also opens the pause menu.
inline constexpr double kCreatorRedirectWindowS = 3.0;
inline constexpr const char* kCreatorRedirectFrom = "MenuScenario_Idle";
std::string CreatorRedirect(const json& aState);

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
