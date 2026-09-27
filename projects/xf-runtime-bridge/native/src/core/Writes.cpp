#include "core/Writes.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <thread>

#include "core/Dispatcher.hpp"

namespace xfb::writes
{
namespace
{
bool BeforeKnown(const json& aItem)
{
    const auto it = aItem.find("before");
    return aItem.value("before_known", true) && it != aItem.end() && it->is_number();
}

std::string Join(const std::vector<std::string>& aNames)
{
    std::string out;
    for (const auto& name : aNames)
    {
        out += (out.empty() ? "" : ", ") + name;
    }
    return out;
}

std::string LightName(int32_t aLight)
{
    return "light " + std::to_string(aLight);
}
} // namespace

json UndoParams(const json& aApplied, std::vector<std::string>* aUnknown)
{
    json undo = json::object();
    for (const auto& item : aApplied)
    {
        const auto name = item.value("name", std::string());
        if (name.empty())
        {
            continue;
        }
        if (!BeforeKnown(item))
        {
            if (aUnknown)
            {
                aUnknown->push_back(name);
            }
            continue;
        }
        const auto before = item["before"].get<double>();
        if (name.rfind("subject.", 0) == 0)
        {
            undo["subject"][name.substr(8)] = before;
        }
        else if (name == "dof" || name == "autofocus" || name == "on" || name == "shadow")
        {
            undo[name] = before != 0.0;
        }
        else if (name == "type")
        {
            // Light type option data: 1 Spot, 2 Ambient. Anything else (-1: the menu showed no
            // type) can't be put back.
            const auto data = std::llround(before);
            if (data != 1 && data != 2)
            {
                if (aUnknown)
                {
                    aUnknown->push_back(name);
                }
                continue;
            }
            undo[name] = data == 1 ? "spot" : "ambient";
        }
        else if (name == "look_at" || name == "look_at_part" || name == "faceId" || name == "camera_preset")
        {
            if (before < 0.0)
            {
                if (aUnknown)
                {
                    aUnknown->push_back(name);
                }
                continue;
            }
            undo[name] = static_cast<int64_t>(std::llround(before));
        }
        else
        {
            undo[name] = before;
        }
    }
    return undo;
}

void AttachUndo(json& aResult, const std::string& aMethod, const json& aParams, const std::vector<std::string>& aUnknown,
                const std::string& aEmptyNote)
{
    std::string note;
    if (aParams.empty())
    {
        aResult["undo"] = nullptr;
        note = aEmptyNote;
    }
    else
    {
        aResult["undo"] = {{"method", aMethod}, {"params", aParams}};
    }
    if (!aUnknown.empty())
    {
        note += std::string(note.empty() ? "" : "; ") + "the game didn't report the earlier value of " + Join(aUnknown) +
                ", so the undo can't restore it";
    }
    if (!note.empty())
    {
        aResult["undo_note"] = note;
    }
}

json CameraResetResult(json aResets)
{
    json changed = json::array();
    std::vector<std::string> unknown;
    for (auto& item : aResets)
    {
        item["name"] = params::CameraParamName(item.value("key", 0));
        if (!BeforeKnown(item))
        {
            unknown.push_back(item["name"].get<std::string>());
        }
        else if (item.value("after", item["before"].get<double>()) != item["before"].get<double>())
        {
            changed.push_back(item);
        }
    }
    json out{{"reset", aResets}};
    AttachUndo(out, "photo.camera.set", UndoParams(changed), unknown, "the reset changed nothing");
    return out;
}

json CameraReset(const std::vector<int32_t>& aKeys, const std::function<json(int32_t aKey)>& aReset)
{
    json resets = json::array();
    json errors = json::array();
    for (const auto key : aKeys)
    {
        try
        {
            resets.push_back(aReset(key));
        }
        catch (const MethodError& e)
        {
            if (e.code != "unavailable")
            {
                errors.push_back({{"name", params::CameraParamName(key)}, {"key", key}, {"code", e.code}, {"message", e.what()}});
            }
        }
    }
    if (resets.empty() && !errors.empty())
    {
        std::string message = "nothing was reset: ";
        for (size_t i = 0; i < errors.size(); ++i)
        {
            message += (i ? "; " : "") + errors[i]["name"].get<std::string>() + ": " + errors[i]["message"].get<std::string>();
        }
        throw MethodError(errors[0]["code"].get<std::string>(), message);
    }
    auto out = CameraResetResult(resets);
    if (!errors.empty())
    {
        out["partial"] = true;
        out["errors"] = errors;
    }
    return out;
}

json HudResult(json aScript)
{
    const bool wasHidden = aScript.value("was_hidden", false);
    const bool wasCursorHidden = aScript.value("was_cursor_hidden", false);
    // One call moves the menu and (with cursor = true) the cursor together, so the undo can put
    // both back only when they were in the same state before; otherwise it restores the menu and
    // leaves the cursor, and says so.
    aScript["undo"] = {{"method", "photo.hud.hide"},
                       {"params", {{"hidden", wasHidden}, {"cursor", wasHidden == wasCursorHidden}}}};
    if (wasHidden != wasCursorHidden)
    {
        aScript["undo_note"] = std::string("the menu was ") + (wasHidden ? "hidden" : "shown") + " and the cursor " +
                               (wasCursorHidden ? "hidden" : "shown") +
                               " before; the undo restores the menu only; leaving photo mode resets both";
    }
    return aScript;
}

json PauseResult(json aScript)
{
    const auto was = aScript.find("was_frozen");
    const auto now = aScript.find("frozen");
    if (was == aScript.end() || !was->is_boolean() || now == aScript.end() || !now->is_boolean())
    {
        AttachUndo(aScript, "world.pause", json::object(), {}, "the earlier state is unknown");
        return aScript;
    }
    const bool before = was->get<bool>();
    AttachUndo(aScript, "world.pause", before == now->get<bool>() ? json::object() : json{{"paused", before}}, {},
               before ? "the world was already frozen" : "the world wasn't frozen");
    return aScript;
}

json ExpressionResult(json aScript)
{
    aScript["name"] = "faceId";
    std::vector<std::string> unknown;
    const auto undo = UndoParams(json::array({aScript}), &unknown);
    aScript.erase("name");
    AttachUndo(aScript, "photo.expression.set", undo, unknown, "");
    return aScript;
}

json ExpressionIndexResult(json aScript)
{
    const bool known = aScript.value("menu_value_known", false) && aScript.contains("menu_value") &&
                       aScript["menu_value"].is_number() && aScript["menu_value"].get<double>() >= 0.0;
    if (known)
    {
        const auto faceId = static_cast<int32_t>(std::lround(aScript["menu_value"].get<double>()));
        aScript["undo"] = {{"method", "photo.expression.set"}, {"params", {{"faceId", faceId}}}};
        aScript["undo_note"] = "selects the expression the photo-mode menu shows again, through the menu; if the "
                               "face doesn't change back, pick an expression in the menu";
    }
    else
    {
        aScript["undo"] = nullptr;
        aScript["undo_note"] = "the photo-mode menu's expression wasn't known; pick an expression in the menu (or "
                               "photo.expression.set) to replace the applied face";
    }
    return aScript;
}

json LightSet(const params::LightRequest& aRequest, const LightOps& aOps)
{
    const auto select = aOps.set(params::key::kLightSelect, static_cast<float>(aRequest.light - 1));
    const bool previousKnown = BeforeKnown(select) && select["before"].get<double>() >= 0.0;
    const int32_t previous = previousKnown ? static_cast<int32_t>(std::lround(select["before"].get<double>())) + 1 : 0;
    const bool selectionChanged = !previousKnown || previous != aRequest.light;

    // After a failure: put the menu's selection back, and say what the menu shows now.
    const auto putBack = [&]() -> std::string {
        if (!selectionChanged)
        {
            return {};
        }
        if (!previousKnown)
        {
            return LightName(aRequest.light) + " is now selected in the menu (the earlier selection is unknown)";
        }
        try
        {
            aOps.set(params::key::kLightSelect, static_cast<float>(previous - 1));
            return LightName(previous) + " is selected again, as before";
        }
        catch (const std::exception&)
        {
            return LightName(aRequest.light) + " is still selected in the menu (it was " + LightName(previous) + ")";
        }
    };

    json applied = json::array();
    json skipped = json::array();
    json placement;
    json placeUndo;
    bool moved = false;
    std::string current;
    try
    {
        if (selectionChanged)
        {
            aOps.settle();
        }
        for (const auto& attribute : aRequest.attributes)
        {
            current = attribute.name;
            json result;
            try
            {
                result = aOps.set(attribute.key, attribute.value);
            }
            catch (const MethodError& e)
            {
                // Game 2.31's photo-mode menu has no light type row (setting 45): the light keeps its type.
                if (attribute.key == params::key::kLightType && e.code == "unavailable")
                {
                    skipped.push_back({{"name", attribute.name}, {"reason", e.what()}});
                    continue;
                }
                throw;
            }
            result["name"] = attribute.name;
            applied.push_back(result);
        }
        if (aRequest.place)
        {
            current = "place";
            const auto& place = *aRequest.place;
            // Where the light's entity is now, or null when it can't be read (never fails the call).
            const auto readPosition = [&](json& aInto, const char* aKey, const char* aUnknownKey) {
                if (!aOps.position)
                {
                    return;
                }
                try
                {
                    aInto[aKey] = aOps.position(aRequest.light).value("position", json());
                }
                catch (const std::exception& e)
                {
                    aInto[aUnknownKey] = e.what();
                }
            };
            const auto worldOf = [](const json& aPosition) {
                return json{{"world", {aPosition.value("x", 0.0), aPosition.value("y", 0.0), aPosition.value("z", 0.0)}}};
            };
            if (place.kind == params::LightPlacement::Kind::Camera)
            {
                // The position before, so the undo can put the light back there (RB-59).
                json was;
                readPosition(was, "position", "unknown");
                // Photo mode places a light where the camera is when it switches on: off, then on again.
                const auto off = aOps.set(params::key::kLightState, 0.0f);
                placement = {{"requested", "camera"}, {"route", "switched_again"}};
                if (was["position"].is_object())
                {
                    placement["before"] = was["position"];
                    placeUndo["place"] = worldOf(was["position"]);
                    moved = true;
                }
                else if (was.contains("unknown"))
                {
                    placement["before_unknown"] = was["unknown"];
                }
                if (BeforeKnown(off) && off["before"].get<double>() < 0.5)
                {
                    placeUndo["on"] = false;
                }
                aOps.settle();
                aOps.set(params::key::kLightState, 1.0f);
                aOps.settle();
                readPosition(placement, "now", "now_unknown");
            }
            else
            {
                if (!aOps.place)
                {
                    throw MethodError("unavailable", "this build can't move photo-mode lights");
                }
                const auto result = aOps.place(aRequest.light, place);
                placement = {{"requested", params::PlacementJson(place)}, {"route", "moved"}, {"before", result.value("before", json())},
                             {"after", result.value("after", json())}};
                if (result.contains("head"))
                {
                    placement["head"] = result["head"];
                }
                // The undo is known from here on, whatever fails next (RB-60).
                const auto& before = placement["before"];
                if (before.is_object())
                {
                    placeUndo["place"] = worldOf(before);
                }
                moved = true;
                aOps.settle();
                readPosition(placement, "now", "now_unknown");
                const auto& now = placement.contains("now") ? placement["now"] : json();
                const auto& after = placement["after"];
                if (now.is_object() && after.is_object())
                {
                    const bool held = std::hypot(now.value("x", 0.0) - after.value("x", 0.0), now.value("y", 0.0) - after.value("y", 0.0),
                                                 now.value("z", 0.0) - after.value("z", 0.0)) < 0.05;
                    placement["held"] = held;
                    if (!held)
                    {
                        placement["note"] = "photo mode put the light somewhere else again a few frames later; place \"camera\" is the fallback";
                    }
                }
            }
        }
    }
    catch (const std::exception& e)
    {
        const auto* methodError = dynamic_cast<const MethodError*>(&e);
        std::vector<std::string> done;
        for (const auto& item : applied)
        {
            done.push_back(item.value("name", std::string()));
        }
        std::string what = done.empty() ? "no light value was changed" : "already changed: " + Join(done);
        if (moved)
        {
            json undo = placeUndo;
            undo["light"] = aRequest.light;
            what += placeUndo.contains("place") ? "; the light was moved: photo.light.set " + undo.dump() + " puts it back"
                                                : "; the light may have moved (its earlier position is unknown)";
        }
        if (const auto selection = putBack(); !selection.empty())
        {
            what += "; " + selection;
        }
        throw MethodError(methodError ? methodError->code : "failed",
                          (current.empty() ? "" : current + ": ") + e.what() + " (" + what + ")");
    }

    json out{{"light", aRequest.light}, {"applied", applied}, {"selected_before", previousKnown ? json(previous) : json(nullptr)}};
    if (!skipped.empty())
    {
        out["skipped"] = skipped;
        out["note"] = "the light type (spot or ambient) isn't in this game version's photo-mode menu, so the light keeps its type";
    }
    if (!placement.is_null())
    {
        out["placement"] = placement;
    }
    int32_t selectedNow = aRequest.light;
    if (aRequest.selectAfter > 0 && aRequest.selectAfter != aRequest.light)
    {
        try
        {
            aOps.set(params::key::kLightSelect, static_cast<float>(aRequest.selectAfter - 1));
            selectedNow = aRequest.selectAfter;
        }
        catch (const std::exception& e)
        {
            out["note"] = "the values were set, but selecting " + LightName(aRequest.selectAfter) +
                          " afterwards failed: " + e.what();
        }
    }
    out["selected"] = selectedNow;

    std::vector<std::string> unknown;
    auto undo = UndoParams(applied, &unknown);
    for (const auto& [name, value] : placeUndo.items())
    {
        undo[name] = value;
    }
    if (!undo.empty())
    {
        undo["light"] = aRequest.light;
        if (previousKnown && previous != selectedNow)
        {
            undo["select_after"] = previous;
        }
    }
    AttachUndo(out, "photo.light.set", undo, unknown, "");
    return out;
}

namespace
{
constexpr const char* kSaveLockNote = "saving stays locked until a save is loaded (the bridge took its save lock first)";

// Withdraws cc.open's request; never throws. Returns what the game said ({withdrawn}, {taken} or {}).
json WithdrawCreatorOpen(const CreatorOpenOps& aOps)
{
    try
    {
        auto answer = aOps.cancel();
        return answer.is_object() ? answer : json::object();
    }
    catch (const std::exception&)
    {
        return json::object();
    }
}

std::string WithdrawnText(const json& aWithdrawal)
{
    if (aWithdrawal.value("withdrawn", false))
    {
        return "the request was withdrawn, so nothing will open";
    }
    if (aWithdrawal.value("taken", false))
    {
        return "the menu had already taken the request, so the appearance screen may still open: check game.status and "
               "use cc.back to close it";
    }
    return "the bridge couldn't confirm that the request was withdrawn, so the appearance screen may still open: check "
           "game.status and use cc.back to close it";
}
} // namespace

json CreatorOpen(const params::CreatorOpenRequest& aRequest, const CreatorOpenOps& aOps)
{
    const auto mode = std::string(params::CreatorModeName(aRequest.mode));
    auto prepared = aOps.prepare();
    if (prepared.value("already_open", false))
    {
        return json{{"changed", false},
                    {"opened", true},
                    {"note", "the appearance screen was already open"},
                    {"undo", nullptr},
                    {"undo_note", "nothing was opened by this call"}};
    }
    try
    {
        aOps.settle();
    }
    catch (const MethodError& e)
    {
        throw MethodError(e.code, std::string(e.what()) + "; " + kSaveLockNote);
    }

    json requested;
    try
    {
        requested = aOps.open();
    }
    catch (const MethodError& e)
    {
        // Stage 2 refused (the moment passed, the save lock isn't confirmed, ...) or the call failed
        // part-way: make sure no request is left pending, and say that the lock stays (RB-43, RB-46).
        const auto withdrawal = WithdrawCreatorOpen(aOps);
        std::string message = std::string(e.what()) + "; " + kSaveLockNote;
        if (!withdrawal.value("withdrawn", false) && (withdrawal.value("taken", false) || withdrawal.empty()))
        {
            message += "; " + WithdrawnText(withdrawal);
        }
        throw MethodError(e.code, message);
    }

    const auto opened = [&](int32_t aWaited, bool aLate) {
        json out{{"changed", true}, {"opened", true}, {"mode", mode}, {"waited_ms", aWaited}};
        for (const char* key : {"edit_mode", "saving_locked", "route"})
        {
            if (requested.contains(key))
            {
                out[key] = requested[key];
            }
        }
        if (aLate)
        {
            out["note"] = "the appearance screen opened after the wait ran out (the menu had already taken the request)";
        }
        out["undo"] = {{"method", "cc.back"}, {"params", json::object()}};
        out["undo_note"] = "cc.back (or Back in the appearance screen) discards every change made there and closes it";
        return out;
    };

    constexpr auto kStep = std::chrono::milliseconds(100);
    int32_t waited = 0;
    try
    {
        for (;;)
        {
            if (aOps.phase() == "character_menu")
            {
                return opened(waited, false);
            }
            if (waited >= aRequest.timeoutMs)
            {
                break;
            }
            aOps.sleep(kStep);
            waited += static_cast<int32_t>(kStep.count());
        }
    }
    catch (const MethodError& e)
    {
        const auto withdrawal = WithdrawCreatorOpen(aOps);
        throw MethodError(e.code, std::string("while waiting for the appearance screen: ") + e.what() + "; " +
                                      WithdrawnText(withdrawal) + "; " + kSaveLockNote);
    }

    const auto withdrawal = WithdrawCreatorOpen(aOps);
    if (withdrawal.value("withdrawn", false))
    {
        throw MethodError("creator_open_timeout",
                          "asked the game to open the appearance screen, but it wasn't open after " +
                              std::to_string(aRequest.timeoutMs) +
                              " ms; the request was withdrawn and nothing opened (a menu or the pause screen may have been "
                              "open); " + kSaveLockNote);
    }
    int32_t late = 0;
    if (withdrawal.value("taken", false))
    {
        // The menu took the request: the screen is on its way, or the menu refused it (the moment passed).
        try
        {
            while (late < kCreatorLateOpenMs)
            {
                aOps.sleep(kStep);
                late += static_cast<int32_t>(kStep.count());
                if (aOps.phase() == "character_menu")
                {
                    return opened(waited + late, true);
                }
            }
        }
        catch (const MethodError&)
        {
        }
    }
    throw MethodError("creator_open_uncertain", "asked the game to open the appearance screen, but it wasn't open after " +
                                                    std::to_string(waited + late) + " ms; " + WithdrawnText(withdrawal) +
                                                    "; " + kSaveLockNote);
}

json PoseSet(const PoseSetOps& aOps)
{
    auto category = aOps.category();
    const bool beforeKnown = category.value("before_known", false) && category.contains("before_category") &&
                             category["before_category"].is_number() && category.contains("before_pose") &&
                             category["before_pose"].is_number();
    const bool categoryChanged = category.value("changed", false);
    json pose;
    try
    {
        if (categoryChanged)
        {
            aOps.settle();
        }
        pose = aOps.pose();
    }
    catch (const std::exception& e)
    {
        const auto* methodError = dynamic_cast<const MethodError*>(&e);
        std::string what = categoryChanged ? "the pose category had already changed" : "no pose was changed";
        if (categoryChanged && beforeKnown)
        {
            try
            {
                aOps.restoreCategory(category["before_category"].get<int32_t>());
                what = "the pose category was put back";
            }
            catch (const std::exception&)
            {
                what = "the pose category stays changed (putting it back failed)";
            }
        }
        throw MethodError(methodError ? methodError->code : "failed", std::string(e.what()) + " (" + what + ")");
    }
    const bool changed = categoryChanged || pose.value("changed", false);
    json out{{"category", category.value("category_text", std::string())},
             {"category_value", category.value("category_value", -1)},
             {"pose", pose.value("pose_text", std::string())},
             {"pose_value", pose.value("pose_value", -1)},
             {"changed", changed}};
    if (pose.contains("animation"))
    {
        out["animation"] = pose["animation"];
    }
    if (!changed)
    {
        AttachUndo(out, "photo.pose.set", json::object(), {}, "that pose was already selected");
    }
    else if (beforeKnown)
    {
        AttachUndo(out, "photo.pose.set",
                   json{{"category_value", category["before_category"]}, {"pose_value", category["before_pose"]}});
        out["undo_note"] = "selects the earlier category and pose again through the menu";
    }
    else
    {
        AttachUndo(out, "photo.pose.set", json::object(), {"the pose"}, "");
    }
    return out;
}

bool WaitTicks(const GameThreadQueue& aQueue, uint64_t aTicks, std::chrono::milliseconds aTimeout)
{
    const auto target = aQueue.TicksSeen() + aTicks;
    const auto deadline = std::chrono::steady_clock::now() + aTimeout;
    while (aQueue.TicksSeen() < target)
    {
        if (aQueue.IsClosed() || std::chrono::steady_clock::now() >= deadline)
        {
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return true;
}

void RestoreOnce::MarkWrite()
{
    m_writes.store(true);
}

bool RestoreOnce::WritesUsed() const
{
    return m_writes.load();
}

bool RestoreOnce::Done() const
{
    return m_done.load();
}

bool RestoreOnce::Pending() const
{
    return m_writes.load() && !m_done.load();
}

bool RestoreOnce::Reset()
{
    if (Pending())
    {
        return false;
    }
    m_writes.store(false);
    m_done.store(false);
    return true;
}

bool RestoreOnce::Tick(bool aReady, const std::function<void()>& aRestore,
                       const std::function<void(const std::string&)>& aOnError)
{
    if (!aReady || !m_writes.load() || m_done.exchange(true))
    {
        return false;
    }
    try
    {
        aRestore();
    }
    catch (const std::exception& e)
    {
        if (aOnError)
        {
            aOnError(e.what());
        }
    }
    catch (...)
    {
        if (aOnError)
        {
            aOnError("unknown exception");
        }
    }
    return true;
}
// --- inventory.equip / inventory.unequip --------------------------------------------------------------

namespace
{
// Reads the slot until aWanted says it's done, settling between reads. The last reading, or null.
json PollSlot(const InventoryOps& aOps, const std::string& aSlot, const std::string& aItem, const std::function<bool(const json&)>& aWanted)
{
    json last;
    for (int i = 0; i < kInventoryPolls; ++i)
    {
        aOps.settle();
        last = aOps.slot(aSlot, aItem);
        if (aWanted(last))
        {
            break;
        }
    }
    return last;
}
} // namespace

json InventoryEquip(const params::InventoryEquipRequest& aRequest, const InventoryOps& aOps)
{
    auto step = aOps.equip();
    const auto slot = step.value("slot", aRequest.slot);
    const auto previous = step.value("previous", std::string());
    const bool added = step.value("added", false);
    // Whether the slot holds the item is decided in the script by record ID ("matches"; RB-63), never by
    // comparing debug names here.
    const bool alreadyWorn = step.value("already_equipped", false);
    bool equipped = alreadyWorn;
    json out{{"item", aRequest.item}, {"slot", slot}, {"added", added}, {"previous", previous}};
    if (!equipped)
    {
        const auto now = PollSlot(aOps, slot, aRequest.item, [](const json& aNow) { return aNow.value("matches", false); });
        equipped = now.value("matches", false);
        if (!equipped)
        {
            out["note"] = "the game took the request, but the slot didn't show the item within the wait (it may still change)";
            out["slot_now"] = now.value("item", std::string());
        }
    }
    out["equipped"] = equipped;
    if (!previous.empty() && !alreadyWorn)
    {
        out["undo"] = {{"method", "inventory.equip"}, {"params", {{"item", previous}, {"slot", slot}}}};
        if (added)
        {
            out["undo_note"] = "then inventory.unequip with this item and remove_added: true takes the added item out of V's inventory";
        }
    }
    else if (previous.empty())
    {
        out["undo"] = added ? json{{"method", "inventory.unequip"}, {"params", {{"item", aRequest.item}, {"remove_added", true}}}}
                            : json{{"method", "inventory.unequip"}, {"params", {{"slot", slot}}}};
    }
    else
    {
        out["undo"] = nullptr;
        out["undo_note"] = "the item was already worn; nothing to undo";
    }
    return out;
}

json InventoryUnequip(const params::InventoryUnequipRequest& aRequest, const InventoryOps& aOps)
{
    json out;
    std::string previous;
    std::string slot = aRequest.slot;
    bool worn = true;
    if (!aRequest.item.empty() && aRequest.removeAdded)
    {
        // An added item that isn't worn (another item was equipped over it) is only removed.
        const auto now = aOps.slot(std::string(), aRequest.item);
        slot = now.value("slot", slot);
        worn = now.value("matches", false);
    }
    if (worn)
    {
        const auto step = aOps.unequip();
        slot = step.value("slot", slot);
        previous = step.value("previous", std::string());
        bool empty = step.value("was_empty", false);
        if (!empty)
        {
            const auto now = PollSlot(aOps, slot, std::string(), [](const json& aNow) { return aNow.value("empty", false); });
            empty = now.value("empty", false);
            if (!empty)
            {
                out["note"] = "the game took the request, but the slot still showed an item at the end of the wait";
            }
        }
        out["unequipped"] = empty;
    }
    else
    {
        out["unequipped"] = false;
        out["note"] = "the item wasn't worn, so it was only removed";
    }
    out["slot"] = slot;
    out["previous"] = previous;
    bool removed = false;
    if (aRequest.removeAdded)
    {
        removed = aOps.removeAdded(aRequest.item).value("removed", false);
        out["removed"] = removed;
    }
    if (!previous.empty() && !removed)
    {
        out["undo"] = {{"method", "inventory.equip"}, {"params", {{"item", previous}, {"slot", slot}}}};
    }
    else
    {
        out["undo"] = nullptr;
        out["undo_note"] = removed ? "the item the bridge added was removed again; inventory.equip with add_if_missing adds it back"
                                   : "the slot was already empty; nothing to undo";
    }
    return out;
}

// --- cc.confirm / cc.back ----------------------------------------------------------------------------

LeaveRoute ChooseLeave(bool aKeep, const json& aState)
{
    if (!aKeep)
    {
        return LeaveRoute::Back;
    }
    const auto changes = aState.find("changes");
    const auto unchanged = aState.find("unchanged");
    const bool noChanges = changes != aState.end() && changes->is_number_integer() && changes->get<int64_t>() == 0;
    const bool same = unchanged != aState.end() && unchanged->is_boolean() && unchanged->get<bool>();
    return noChanges && same ? LeaveRoute::NothingToConfirm : LeaveRoute::Confirm;
}

int32_t LeaveRouteCode(LeaveRoute aRoute)
{
    switch (aRoute)
    {
    case LeaveRoute::Back:
        return 0;
    case LeaveRoute::Confirm:
        return 1;
    case LeaveRoute::NothingToConfirm:
        return 2;
    }
    return 1;
}

// --- game.save / game.load --------------------------------------------------------------------------

namespace
{
std::chrono::steady_clock::time_point Now(const Clock& aClock)
{
    return aClock ? aClock() : std::chrono::steady_clock::now();
}

// Takes the bridge's save lock back when this object goes out of scope, however that happens (RB-52).
class RelockOnExit
{
public:
    RelockOnExit(const SaveOps& aOps, bool aArmed) : m_ops(aOps), m_armed(aArmed) {}
    RelockOnExit(const RelockOnExit&) = delete;
    RelockOnExit& operator=(const RelockOnExit&) = delete;
    ~RelockOnExit()
    {
        if (m_armed && m_ops.relock)
        {
            try
            {
                m_ops.relock();
            }
            catch (...)
            {
                // relock never throws by contract; a destructor must not either.
            }
        }
    }

private:
    const SaveOps& m_ops;
    bool m_armed;
};
} // namespace

json GameSave(const params::GameSaveRequest& aRequest, const SaveOps& aOps)
{
    if (aOps.guard)
    {
        aOps.guard();
    }
    const auto prepared = aOps.prepare();
    const bool released = prepared.value("lock_released", false);
    // From here on, every way out of this function takes the released lock back.
    RelockOnExit relock(aOps, released);
    if (released)
    {
        const auto deadline = Now(aOps.now) + std::chrono::milliseconds(kSaveUnlockWaitMs);
        bool unlocked = false;
        while (true)
        {
            if (!aOps.status().value("locked", true))
            {
                unlocked = true;
                break;
            }
            if (Now(aOps.now) >= deadline)
            {
                break;
            }
            aOps.sleep(std::chrono::milliseconds(100));
        }
        if (!unlocked)
        {
            throw MethodError("saving_locked", "the game still reported saving locked after the bridge released its own lock, so nothing was "
                                               "saved; the bridge's lock is back on");
        }
    }
    if (aOps.guard)
    {
        aOps.guard();
    }
    aOps.save();
    const auto deadline = Now(aOps.now) + std::chrono::milliseconds(aRequest.timeoutMs);
    std::string state = "pending";
    while (true)
    {
        aOps.sleep(std::chrono::milliseconds(200));
        state = aOps.status().value("state", std::string("pending"));
        if (state == "saved" || state == "failed" || Now(aOps.now) >= deadline)
        {
            break;
        }
    }
    const std::string lockNote = released ? "; the bridge's save lock is back on" : "";
    if (state == "failed")
    {
        throw MethodError("save_failed", "the game answered that the manual save failed; nothing new was saved" + lockNote);
    }
    if (state != "saved")
    {
        throw MethodError("save_uncertain", "the game took the save request but didn't confirm it within " + std::to_string(aRequest.timeoutMs / 1000) +
                                                " s; check the game's Load menu before saving again" + lockNote);
    }
    json out{{"saved", true}, {"slot", "a new manual save (the game names it ManualSave-<n>)"}, {"lock_overridden", released}};
    if (!aRequest.name.empty())
    {
        out["name"] = aRequest.name;
    }
    if (released)
    {
        out["note"] = "saved with the bridge's save lock overridden: this save keeps whatever the bridge changed since the last load; the lock is back on";
    }
    out["undo"] = nullptr;
    out["undo_note"] = "a save can't be unsaved; delete it in the game's Load menu if it isn't wanted";
    return out;
}

int32_t FindSave(const std::vector<std::string>& aSaves, const std::string& aName)
{
    for (size_t i = 0; i < aSaves.size(); ++i)
    {
        if (aSaves[i] == aName)
        {
            return static_cast<int32_t>(i);
        }
    }
    const auto lower = [](std::string aText) {
        std::transform(aText.begin(), aText.end(), aText.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return aText;
    };
    const auto wanted = lower(aName);
    int32_t found = -1;
    for (size_t i = 0; i < aSaves.size(); ++i)
    {
        if (lower(aSaves[i]) == wanted)
        {
            if (found >= 0)
            {
                return -2;
            }
            found = static_cast<int32_t>(i);
        }
    }
    return found;
}

json GameLoad(const params::GameLoadRequest& aRequest, const LoadOps& aOps)
{
    json out;
    if (aRequest.latest)
    {
        if (aOps.guard)
        {
            aOps.guard();
        }
        out = aOps.latest();
    }
    else
    {
        // A fresh list for every load: the game's own list, as the Load menu would show it now.
        aOps.list();
        const auto deadline = Now(aOps.now) + std::chrono::milliseconds(kSaveListWaitMs);
        json list;
        while (true)
        {
            aOps.sleep(std::chrono::milliseconds(100));
            list = aOps.saves();
            if (list.value("ready", false) || Now(aOps.now) >= deadline)
            {
                break;
            }
        }
        if (!list.value("ready", false))
        {
            throw MethodError("timeout", "the game didn't list its saves in time; nothing was loaded");
        }
        std::vector<std::string> saves;
        for (const auto& name : list.value("saves", json::array()))
        {
            if (name.is_string())
            {
                saves.push_back(name.get<std::string>());
            }
        }
        const auto index = FindSave(saves, aRequest.name);
        if (index < 0)
        {
            std::string some;
            for (size_t i = 0; i < saves.size() && i < 12; ++i)
            {
                some += (some.empty() ? "" : ", ") + saves[i];
            }
            throw MethodError("save_not_found", (index == -2 ? "more than one save is named '" : "no save is named '") + aRequest.name +
                                                    "'; nothing was loaded (the game lists " + std::to_string(saves.size()) + " saves" +
                                                    (some.empty() ? "" : ": " + some + (saves.size() > 12 ? ", ..." : "")) + ")");
        }
        if (aOps.guard)
        {
            aOps.guard();
        }
        // The load step looks this exact name up in the game's list again and loads that position.
        out = aOps.load(saves[static_cast<size_t>(index)]);
    }
    out["undo"] = nullptr;
    out["undo_note"] = "loading can't be undone: everything since that save was discarded, the bridge's save lock with it";
    out["note"] = "the game is loading; wait for game_wait with phase gameplay before the next command";
    return out;
}
} // namespace xfb::writes
