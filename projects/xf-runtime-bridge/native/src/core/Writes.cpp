#include "core/Writes.hpp"

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
            auto result = aOps.set(attribute.key, attribute.value);
            result["name"] = attribute.name;
            applied.push_back(result);
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
        if (const auto selection = putBack(); !selection.empty())
        {
            what += "; " + selection;
        }
        throw MethodError(methodError ? methodError->code : "failed",
                          (current.empty() ? "" : current + ": ") + e.what() + " (" + what + ")");
    }

    json out{{"light", aRequest.light}, {"applied", applied}, {"selected_before", previousKnown ? json(previous) : json(nullptr)}};
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
} // namespace xfb::writes
