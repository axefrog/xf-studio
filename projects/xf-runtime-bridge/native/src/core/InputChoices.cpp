#include "core/InputChoices.hpp"
#include <cmath>
#include <algorithm>
#include <climits>

namespace xfb::input
{
namespace
{
void Fields(const json& p, std::initializer_list<const char*> fields)
{
    if (!p.is_object()) throw MethodError("bad_params", "Supply an object.");
    for (auto it = p.begin(); it != p.end(); ++it)
    {
        bool found = false;
        for (const auto* f : fields) found |= it.key() == f;
        if (!found) throw MethodError("bad_params", "Unknown field: " + it.key());
    }
}
int32_t Integer(const json& p, const char* key, int32_t lo, int32_t hi, int32_t fallback = -1)
{
    if (!p.contains(key) && fallback >= 0) return fallback;
    if (!p.contains(key) || !p[key].is_number_integer() || p[key] < lo || p[key] > hi)
        throw MethodError("bad_params", std::string(key) + " is outside its bounds.");
    return p[key].get<int32_t>();
}
std::string Text(const json& p, const char* key)
{
    if (!p.contains(key) || !p[key].is_string() || p[key].get_ref<const std::string&>().empty() || p[key].get_ref<const std::string&>().size() > 80)
        throw MethodError("bad_params", std::string("Supply a short ") + key + ".");
    return p[key].get<std::string>();
}
}
json Service::Arm(const json& p, double now, uint64_t world, const std::string& context, uint64_t connection)
{
    std::scoped_lock lock(m_mutex);
    Fields(p, {"run_id", "context", "duration_ms"});
    if (!m_held.empty() || !m_job.is_null()) throw MethodError("input_busy", "Finish the pending test first.");
    if (now < m_deadline && !m_result.is_null() && m_result.value("reason", std::string()) == "activated" && m_result.value("ui_stage", std::string()) != "native")
        throw MethodError("input_busy", "Wait for the consumed button action to drain or expire.");
    const auto run = Text(p, "run_id"), expected = Text(p, "context");
    if (expected != context || (context != "gameplay" && context != "photo_mode" && context != "menu"))
        throw MethodError("stale_context", "The fixture's expected game context is not active.");
    const int duration = Integer(p, "duration_ms", 100, 120000, 30000);
    m_run = run; m_context = context; m_world = world; m_expires = now + duration / 1000.0;
    m_connection = connection;
    m_result = nullptr; m_offer = nullptr; m_selection = json::object(); m_stopReason.clear();
    return {{"armed", true}, {"run_id", m_run}, {"world_generation", m_world}, {"context", context}, {"duration_ms", duration}};
}
void Service::CheckRun(const json& p, double now) const
{
    if (m_run.empty() || Text(p, "run_id") != m_run) throw MethodError("test_run_required", "Arm this test run first.");
    if (now >= m_expires) throw MethodError("activation_expired", "The test run expired; arm a fresh fixture.");
}
json Service::Submit(const std::string& kind, const json& p, double now, const Ops& ops)
{
    std::scoped_lock lock(m_mutex);
    if (kind == "choice" || kind == "native_choice") Fields(p, {"run_id", "hub", "generation", "index", "commit", "timeout_ms"});
    else if (kind == "photo") Fields(p, {"run_id", "controller_generation", "route", "timeout_ms"});
    else if (kind == "ui") Fields(p, {"run_id", "target", "lock_generation", "timeout_ms"});
    else Fields(p, {"run_id", "control", "duration_ms", "value", "timeout_ms"});
    CheckRun(p, now);
    if (ops.connection && ops.connection() != m_connection) { Stop("connection_changed", ops); throw MethodError("stale_context", "Arm a fresh run after reconnecting."); }
    if (!m_job.is_null() || !m_held.empty() || !m_stopReason.empty()) throw MethodError("input_busy", "Only one test input may be pending; cleanup must finish first.");
    if (now < m_deadline && !m_result.is_null() && m_result.value("reason", std::string()) == "activated" && m_result.value("ui_stage", std::string()) != "native")
        throw MethodError("input_busy", "Wait for the consumed button action to drain or expire.");
    json job = p;
    const int timeout = Integer(p, "timeout_ms", 100, 5000, 2000);
    if (kind == "choice" || kind == "native_choice")
    {
        Integer(p, "hub", 1, INT32_MAX); Integer(p, "generation", 1, INT32_MAX); Integer(p, "index", 0, 15);
        if (p.contains("commit") && !p["commit"].is_boolean()) throw MethodError("bad_params", "commit must be true or false.");
        job["commit"] = p.value("commit", true);
        if (kind == "native_choice")
        {
            ops.guard();
            if (!ops.inputReady || !ops.inputReady() || !ops.dispatch || !ops.physicalHeld || !ops.releaseGuard)
                throw MethodError("input_unavailable", "R1 receiver lifetime, release/axis-zero and physical overlap are not validated. No input was submitted.");
            if (m_context != "gameplay") throw MethodError("input_unavailable", "Only the commissioned on-foot dialogue fixture is supported.");
            const auto h = NativeHub();
            if (h.value("id", 0) != p["hub"].get<int>() || h.value("generation", 0) != p["generation"].get<int>())
                throw MethodError("stale_context", "Read the current native offer first.");
            if (!h.value("input_eligible", false) || static_cast<size_t>(p["index"].get<int>()) >= h["choices"].size())
                throw MethodError("choice_unsupported", "This offer's eligibility and dedicated input protocol have not been validated.");
            job["offer"] = m_offer;
        }
    }
    else if (kind == "photo")
    {
        const auto gen = Integer(p, "controller_generation", 1, INT32_MAX);
        const auto route = p.value("route", json("event"));
        if (route != "event" && route != "callback") throw MethodError("bad_params", "route must be event or callback.");
        if (m_context != "photo_mode") throw MethodError("stale_context", "The photo menu must be active.");
        job["route"] = route;
        ops.guard(); const auto before = ops.photo();
        if (!before.value("shown", false) || before.value("generation", 0) != gen)
            throw MethodError("stale_context", "Read the currently shown photo controller first.");
        if (before.value("confirmation", false)) throw MethodError("input_busy", "Close the current photo exit confirmation first.");
        job["before"] = before;
    }
    else if (kind == "ui")
    {
        if (Text(p, "target") != "save_anyway") throw MethodError("bad_params", "Only save_anyway is a test target.");
        const auto gen = Integer(p, "lock_generation", 1, INT32_MAX);
        if (!m_offered || static_cast<uint64_t>(gen) != m_lock)
            throw MethodError("ui_target_unavailable", "Wait for a real Save anyway offer and read its generation.");
    }
    else
    {
        const auto control = Text(p, "control");
        if (control != "confirm" && control != "move_y") throw MethodError("bad_params", "Only confirm and move_y are allowlisted.");
        const int duration = Integer(p, "duration_ms", 10, 150);
        double value = p.value("value", json(0.1)).is_number() ? p.value("value", json(0.1)).get<double>() : 2;
        if (!std::isfinite(value) || std::abs(value) > 0.2) throw MethodError("bad_params", "Axis value must be within -0.2 to 0.2.");
        if (m_context != "gameplay") throw MethodError("input_unavailable", "Only the on-foot fixture can commission this adapter.");
        ops.guard();
        if (!ops.inputReady || !ops.inputReady() || !ops.dispatch || !ops.releaseGuard) throw MethodError("input_unavailable", "R1 receiver type, lifetime and release ABI are not validated. No input was submitted.");
        if (!ops.physicalHeld || ops.physicalHeld(control)) throw MethodError("input_overlap", "A physical control overlaps this test.");
        // Record ownership BEFORE entering the adapter: even an error after submission owes a release.
        m_held = control; m_heldKind = control == "move_y" ? "axis" : "button";
        try { ops.guard(); ops.dispatch(control, m_heldKind == "axis" ? "axis" : "press", static_cast<float>(value)); }
        catch (...) { m_stopReason = "error"; Neutralize(ops); m_stopReason.clear(); throw; }
        job["release_at"] = now + duration / 1000.0;
    }
    job["kind"] = kind; job["request_id"] = ++m_serial; job["steps"] = 0; job["stage"] = "queued";
    job["world_generation"] = m_world;
    job["coverage"] = kind == "choice" ? "xf_action_handler" : kind == "native_choice" ? "engine_dispatch_correlated_choice" : kind == "photo" ? (job["route"] == "callback" ? "consumer_callback" : "native_exit_event") : kind == "ui" ? "rendered_button_activation" : "engine_dispatch";
    m_cursor = m_events.Latest(); m_deadline = std::min(m_expires, now + timeout / 1000.0);
    m_photoReceipt = nullptr; m_choiceReceipt = nullptr; m_job = job;
    m_events.Push("input.submitted", "info", "xf", kind, job);
    return {{"pending", true}, {"request_id", m_serial}, {"run_id", m_run}, {"world_generation", m_world}, {"coverage", job["coverage"]}};
}
void Service::Finish(const std::string& reason, json data)
{
    data["reason"] = reason; data["request_id"] = m_job.value("request_id", uint64_t{0});
    data["run_id"] = m_run; data["world_generation"] = m_world;
    data["coverage"] = m_job.value("coverage", std::string());
    m_result = data; m_job = nullptr;
    m_events.Push("input.result", reason == "committed" || reason == "selected" || reason == "callback" || reason == "released" || reason == "activated" ? "done" : "warn", "xf", reason, data);
}
void Service::Neutralize(const Ops& ops)
{
    if (m_held.empty()) return;
    // RestoreScope permits only the adapter's own release/axis-zero; never ReleaseAllInput.
    RestoreScope restore;
    if (!ops.dispatch || !ops.releaseGuard) throw MethodError("input_cleanup_failed", "The owned control still needs neutralising.");
    ops.releaseGuard();
    ops.dispatch(m_held, m_heldKind == "axis" ? "axis" : "release", 0);
    m_held.clear(); m_heldKind.clear();
}
void Service::Stop(const std::string& reason, const Ops& ops)
{
    std::scoped_lock lock(m_mutex);
    m_stopReason = reason; // A refused release must never allow the old job to resume.
    Neutralize(ops);
    if (!m_job.is_null()) Finish(reason);
    m_run.clear(); m_offer = nullptr; m_photoReceipt = nullptr; m_choiceReceipt = nullptr; m_stopReason.clear();
}
json Service::NativeHub() const
{
    if (m_offer.is_null() || m_offer.value("truncated", true) || !m_offer.contains("hubs") ||
        !m_offer["hubs"].is_array() || m_offer["hubs"].size() != 1)
        throw MethodError("choice_unsupported", "A single complete native offer is required.");
    auto h = m_offer["hubs"][0];
    if (!h.contains("choices") || !h["choices"].is_array() || h["choices"].empty() ||
        m_selection.value("active_hub", 0) != h.value("id", 0))
        throw MethodError("choice_changed", "The observed native hub is no longer active.");
    h["generation"] = m_offer.value("generation", 0);
    h["index"] = m_selection.value("index", -1);
    return h;
}
void Service::TickNative(double now, const Ops& ops)
{
    // [hypothesis] The bounded protocol is testable offline. Retail inputReady remains false:
    // neither a callback mock nor LastAttemptedChoice commissions the native receiver.
    ops.guard();
    if (!ops.inputReady()) { Stop("input_unavailable", ops); return; }
    for (const auto* control : {"choice_up", "choice_down", "choice_apply"})
        if (ops.physicalHeld(control)) { Stop("handover", ops); return; }
    if (!m_held.empty())
    {
        if (now < m_job["release_at"].get<double>()) return;
        Neutralize(ops);
    }
    const auto window = m_events.Read(m_cursor, 1000, {"choice.result"});
    if (window.value("dropped", uint64_t{0}) != 0) { Finish("inconclusive", {{"terminal", "event_loss"}}); return; }
    m_cursor = window.value("latest", m_cursor);
    if (!m_choiceReceipt.is_null())
    {
        const auto receipt = m_choiceReceipt;
        // The observed hub is paired with the attempt, never promoted to native scene identity.
        Finish(!receipt.value("success", false) ? "native_rejected" :
               receipt.value("hub_attribution", std::string()) == "correlated" ? "committed" : "inconclusive",
               {{"attempt", receipt}, {"hub_attribution", receipt.value("hub_attribution", std::string("ambiguous"))}});
        return;
    }
    const auto h = NativeHub();
    if (h.value("id", 0) != m_job["hub"].get<int>() || h["generation"] != m_job["generation"] ||
        m_offer["hubs"] != m_job["offer"]["hubs"])
    { Finish("choice_changed"); return; }
    const int index = h.value("index", -1), target = m_job["index"].get<int>();
    if (!h.value("input_eligible", false) || index < 0 || static_cast<size_t>(index) >= h["choices"].size())
    { Finish("choice_unsupported"); return; }
    if (m_job["stage"] == "applied") return; // never retry an uncertain commit
    if (m_job["stage"] == "scroll_wait")
    {
        if (index == m_job["previous_index"].get<int>()) return; // no read-back, no repeated press
        if (index != m_job["next_index"].get<int>()) { Finish("choice_changed"); return; }
        m_job["stage"] = "queued";
        return; // a separate update before another scroll or commit
    }
    if (index == target && !m_job.value("commit", true))
    { Finish("selected", {{"selected", h}, {"committed", false}}); return; }
    if (m_job["steps"].get<int>() >= 32) { Finish("inconclusive", {{"terminal", "step_limit"}}); return; }
    const bool apply = index == target;
    const std::string control = apply ? "choice_apply" : index < target ? "choice_down" : "choice_up";
    m_job["previous_index"] = index;
    m_job["next_index"] = index + (index < target ? 1 : -1);
    m_job["stage"] = apply ? "applied" : "scroll_wait";
    m_job["apply_seq"] = m_sourceSeq;
    m_job["steps"] = m_job["steps"].get<int>() + 1;
    m_job["release_at"] = now + 0.03;
    m_held = control; m_heldKind = "button"; // own the release before an uncertain call
    ops.guard(); ops.dispatch(control, "press", 1);
}
void Service::Tick(double now, uint64_t world, const std::string& context, bool open, const Ops& ops)
{
    std::scoped_lock lock(m_mutex);
    if (m_run.empty()) return;
    if (!m_stopReason.empty()) { Stop(m_stopReason, ops); return; }
    if (ops.connection && ops.connection() != m_connection) { Stop("connection_changed", ops); return; }
    // An unchanged photo menu can close synchronously inside the callback. Its receipt was
    // observed in this world before that context transition; do not discard it as a stale menu.
    if (open && world == m_world && now < m_deadline && !m_job.is_null() && !m_photoReceipt.is_null())
    { Finish("callback", m_photoReceipt); return; }
    if (!open || world != m_world || context != m_context || now >= m_expires)
    { Stop(world != m_world ? "world_changed" : !open ? "stopped" : now >= m_expires ? "expired" : "context_changed", ops); return; }
    if (m_job.is_null()) return;
    try
    {
        if (now >= m_deadline) { Neutralize(ops); Finish("inconclusive", {{"terminal", "timeout_no_receipt"}}); return; }
        const auto kind = m_job.value("kind", std::string());
        if (kind == "ui") return; // CET's real draw is the sole consumer.
        if (kind == "pulse")
        {
            ops.guard();
            if (ops.physicalHeld(m_held)) { Stop("handover", ops); return; }
            if (now >= m_job["release_at"].get<double>()) { Neutralize(ops); Finish("released"); }
            return;
        }
        if (kind == "native_choice") { TickNative(now, ops); return; }
        if (kind == "photo")
        {
            ops.guard(); const auto state = ops.photo();
            if (state.value("generation", 0) != m_job["controller_generation"].get<int>() || (!state.value("shown", false) && m_photoReceipt.is_null()))
            { Finish("inconclusive", {{"terminal", "controller_changed"}}); return; }
            if (!m_photoReceipt.is_null()) { Finish("callback", m_photoReceipt); return; }
            if (m_job["stage"] == "queued")
            {
                m_job["stage"] = "submitted"; // no retry after uncertain dispatch
                ops.guard(); ops.exitAttempt(m_job["controller_generation"].get<int32_t>(), m_job["route"] == "callback");
            }
            return;
        }
        const auto window = m_events.Read(m_cursor, 1000, {"npc.choice"});
        if (window.value("dropped", uint64_t{0}) != 0) { Finish("inconclusive", {{"terminal", "event_loss"}}); return; }
        m_cursor = window.value("latest", m_cursor);
        for (const auto& event : window["events"])
        {
            const auto& d = event["data"];
            if (d.value("hub", 0) == m_job["hub"].get<int>())
            {
                if (m_job["stage"] == "applied" && !d.value("timeout", false) && !d.value("withdrawn", false) && !d.value("walked_away", false) && d.value("index", -1) == m_job["index"].get<int>())
                    Finish("committed", {{"npc_choice", d}, {"event_seq", event["seq"]}});
                else Finish("choice_changed", {{"observed", d}});
                return;
            }
        }
        ops.guard(); const auto h = ops.hub();
        if (h.value("id", 0) != m_job["hub"].get<int>() || h.value("generation", 0) != m_job["generation"].get<int>())
        { Finish("stale_context"); return; }
        if (m_job["stage"] == "applied") return; // only npc.choice is an answer
        if (!h.value("shown", false) || h.value("busy", true) || h.value("count", 0) <= m_job["index"].get<int>())
        { Finish("choice_changed"); return; }
        if (!m_job.contains("count")) m_job["count"] = h["count"];
        if (m_job["count"] != h["count"]) { Finish("choice_changed"); return; }
        const bool apply = h.value("index", -1) == m_job["index"].get<int>();
        if (apply && !m_job.value("commit", true)) { Finish("selected", {{"selected", h}, {"committed", false}}); return; }
        const int steps = m_job["steps"].get<int>();
        if (steps >= 32) { Finish("inconclusive", {{"terminal", "step_limit"}}); return; }
        ops.guard(); const auto action = ops.choice(m_job["hub"].get<int32_t>(), m_job["generation"].get<int32_t>(), m_job["index"].get<int32_t>(), apply);
        if (!action.value("deferred", false)) m_job["steps"] = steps + 1;
        if (apply && action.value("applied", false)) m_job["stage"] = "applied";
    }
    catch (const std::exception& e)
    {
        m_stopReason = "error";
        Neutralize(ops);
        if (!m_job.is_null()) Finish("error", {{"detail", e.what()}});
        m_run.clear(); m_stopReason.clear();
    }
}
void Service::SetLock(uint64_t gen, bool offered) { std::scoped_lock lock(m_mutex); m_lock = gen; m_offered = offered; }
json Service::TakeUi(double now, uint64_t world, uint64_t lockGen, bool offered)
{
    std::scoped_lock lock(m_mutex);
    if (m_job.is_null() || m_job.value("kind", std::string()) != "ui" || m_job["stage"] != "queued") return nullptr;
    if (now >= m_deadline || now >= m_expires || world != m_world || lockGen != m_lock || lockGen != m_job["lock_generation"].get<uint64_t>() || !offered || !m_offered)
    { Finish("activation_expired"); return nullptr; }
    m_job["stage"] = "consumed";
    const auto token = m_job;
    m_events.Push("input.ui.consumed", "info", "xf", "save_anyway", token);
    return token;
}
bool Service::ValidateUi(double now, uint64_t world, uint64_t lockGen, bool offered) const
{
    std::scoped_lock lock(m_mutex);
    return !m_run.empty() && now < m_deadline && now < m_expires && world == m_world &&
           lockGen == m_lock && offered && m_offered && !m_result.is_null() &&
           m_result.value("reason", std::string()) == "activated" &&
           m_result.value("lock_generation", uint64_t{0}) == lockGen;
}
bool Service::ReportUi(const json& report)
{
    std::scoped_lock lock(m_mutex);
    if (m_run.empty() || report.value("run_id", std::string()) != m_run) return false;
    if (!m_result.is_null() && m_result.value("reason", std::string()) == "activated" && report.value("request_id", uint64_t{0}) == m_result.value("request_id", uint64_t{0}) && report.contains("stage"))
    {
        const auto stage = report.value("stage", std::string());
        const auto previous = m_result.value("ui_stage", std::string("activated"));
        if (!((previous == "activated" && stage == "queued") || (previous == "queued" && stage == "dequeued") || (previous == "dequeued" && stage == "native"))) return false;
        m_result["ui_stage"] = stage;
        m_events.Push("input.ui." + stage, "info", "xf", "save_anyway", report);
        return true;
    }
    if (m_job.is_null() || m_job.value("kind", std::string()) != "ui" || m_job["stage"] != "consumed" || report.value("request_id", uint64_t{0}) != m_job["request_id"].get<uint64_t>()) return false;
    const auto generation = m_job["lock_generation"];
    Finish(report.value("activated", false) ? "activated" : "ui_target_not_drawn", {{"lock_generation", generation}, {"receipt", report}});
    return true;
}
json Service::State() const
{
    std::scoped_lock lock(m_mutex);
    return {{"run_id", m_run}, {"connection", m_connection}, {"context", m_context}, {"world_generation", m_world}, {"lock_generation", m_lock}, {"save_anyway_offered", m_offered}, {"pending", m_job}, {"last", m_result}, {"offer", m_offer}, {"selection", m_selection}, {"source_seq", m_sourceSeq}, {"held", m_held}, {"cleanup_pending", m_stopReason}};
}
void Service::Observe(const std::string& kind, json data)
{
    std::scoped_lock lock(m_mutex);
    if (m_run.empty()) return;
    data["source_seq"] = ++m_sourceSeq; data["world_generation"] = m_world;
    data["run_id"] = m_run;
    if (!m_job.is_null() && kind.starts_with("input.photo.")) data["request_id"] = m_job.value("request_id", uint64_t{0});
    if (kind == "choice.offer")
    {
        m_offer = data;
        m_selection = {{"active_hub", data.value("active_hub", 0)}, {"index", data.value("index", -1)}};
    }
    if (kind == "choice.selection")
    {
        if (data.contains("active_hub")) m_selection["active_hub"] = data["active_hub"];
        if (data.contains("index")) m_selection["index"] = data["index"];
    }
    if (kind == "choice.attempt")
    {
        // LastAttemptedChoice contains NO hub id. Even a unique match is correlation, not native identity.
        data["pre_attempt_offer"] = m_offer;
        data["hub_attribution"] = "ambiguous";
        if (!m_offer.is_null() && !m_offer.value("truncated", true) && m_offer.contains("hubs") && m_offer["hubs"].size() == 1 && data.value("dialog", false) && data.value("generation", -1) == m_offer.value("generation", -2))
        {
            const auto& hub = m_offer["hubs"][0]; const int index = data.value("index", -1);
            size_t matches = 0;
            if (hub.contains("choices")) for (const auto& caption : hub["choices"]) if (caption == data.value("caption", std::string())) ++matches;
            if (matches == 1 && index >= 0 && hub.contains("choices") && static_cast<size_t>(index) < hub["choices"].size() && hub["choices"][index] == data.value("caption", std::string()) && data.value("active_hub", 0) == hub.value("id", 0))
            { data["hub_attribution"] = "correlated"; data["observed_hub"] = hub["id"]; }
        }
        if (!m_job.is_null() && m_job.value("kind", std::string()) == "native_choice" &&
            m_job["stage"] == "applied" && m_choiceReceipt.is_null() &&
            data.value("source_seq", uint64_t{0}) > m_job.value("apply_seq", uint64_t{0}) && data.value("dialog", false))
        {
            // A different index/hub or an ambiguous notification invalidates proof; it cannot
            // be ignored in favour of a later convenient match. No commit is ever retried.
            if (data.value("index", -1) != m_job["index"].get<int>() ||
                data.value("observed_hub", 0) != m_job["hub"].get<int>() ||
                data.value("generation", 0) != m_job["generation"].get<int>()) data["hub_attribution"] = "ambiguous";
            m_choiceReceipt = data;
        }
    }
    if (kind == "input.photo.callback" && !m_job.is_null() && m_job.value("kind", std::string()) == "photo" && data.value("generation", 0) == m_job.value("controller_generation", -1) && m_job["stage"] == "submitted") m_photoReceipt = data;
    m_events.Push(kind, "info", kind.starts_with("choice.") ? "game" : "xf", kind, data);
    if (kind == "choice.attempt") m_events.Push("choice.result", data.value("success", false) ? "done" : "warn", "game", "Native attempt; hub identity is correlated separately", data);
}
void RegisterMethods(Dispatcher& dispatcher, Service& service, bool hooks, bool engineGate, std::function<double()> now,
                     std::function<uint64_t()> world, std::function<std::string()> context, std::function<Ops()> ops)
{
    const auto gate = [hooks] { if (!hooks) throw MethodError("test_hooks_off", "Enable allow_test_hooks in the autonomous -writes candidate."); };
    const auto state = [&service, gate, ops](const MethodContext&) {
        gate(); auto out = service.State(); auto adapter = ops();
        if (adapter.inputStatus) out["engine_input"] = adapter.inputStatus();
        try { adapter.guard(); out["xf_hub"] = adapter.hub(); out["photo"] = adapter.photo(); }
        catch (const MethodError& e) { out["unavailable"] = e.code; }
        return out;
    };
    dispatcher.Register({"test.input.state", Access::Read, RunOn::GameThread, "Autonomous test owner and last receipt.", state});
    dispatcher.Register({"test.input.arm", Access::WritePlayer, RunOn::GameThread, "Arm a bounded autonomous fixture.", [&service, gate, now, world, context, ops](const MethodContext& c) {
        gate(); auto adapter = ops(); adapter.guard();
        auto result = service.Arm(c.params, now(), world(), context(), adapter.connection ? adapter.connection() : 0);
        if (adapter.seedOffers) { adapter.guard(); adapter.seedOffers(); }
        return result;
    }});
    const auto add = [&](const char* method, const char* kind, Access access) {
        dispatcher.Register({method, access, RunOn::GameThread, "Bounded autonomous test input.", [&service, gate, now, ops, kind, engineGate](const MethodContext& c) {
            gate(); if ((std::string(kind) == "pulse" || std::string(kind) == "native_choice") && !engineGate) throw MethodError("test_build_required", "Rebuild with XFB_ENGINE_INPUT_TESTS; native receiver commissioning is still required.");
            return service.Submit(kind, c.params, now(), ops());
        }});
    };
    add("test.npc.choice", "choice", Access::WriteNpc); add("test.photo.exit_attempt", "photo", Access::WritePhoto);
    add("test.ui.activate", "ui", Access::WriteSave); add("test.input.pulse", "pulse", Access::ActPlayer);
    dispatcher.Register({"player.choice.state", Access::Read, RunOn::GameThread, "Observed native offers; no historical commit is seeded.", state});
    add("player.choice.select", "native_choice", Access::ActPlayer);
}
} // namespace xfb::input
