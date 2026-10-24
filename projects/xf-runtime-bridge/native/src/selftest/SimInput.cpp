#include "selftest/SimInput.hpp"
#include "core/Win32.hpp"
#include "core/Lifecycle.hpp"
#include "core/Params.hpp"
namespace xfb::selftest
{
namespace { double Now() { return static_cast<double>(win32::MonotonicMs()) / 1000.0; } }
SimInput::SimInput(Dispatcher& d, SimNpc& npc, EventLog& events, bool hooks, std::function<std::string()> context,
                   std::function<uint64_t()> world, std::function<bool()> live, std::function<uint64_t()> connection)
    : m_service(events), m_dispatcher(d), m_npc(npc), m_context(std::move(context)), m_world(std::move(world)), m_live(std::move(live)), m_connection(std::move(connection)), m_hooks(hooks)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    d.Register({"game.lifecycle.probe", Access::Read, RunOn::BridgeThread, "Read-only lifecycle plan with unavailable simulated UI observer.", [this, &events](const MethodContext& c) {
        if (!m_hooks) throw MethodError("test_hooks_off", "Lifecycle probe requires test hooks.");
        params::RequireOnly(c.params, {"generation"});
        if (const auto generation = params::CheckInteger(c.params, "generation", 0, 9007199254740991LL); generation && *generation != 0)
            throw MethodError("precondition_failed", "Simulated observer generation is zero; no native UI is present.");
        auto out = lifecycle::Probe(lifecycle::Describe({}, 0));
        out["simulated"] = true;
        events.Push("lifecycle.probe", "info", "simulation", "Read-only lifecycle plan; native UI unavailable", out);
        return out;
    }});
    recording::RegisterMethods(d, m_recording, hooks, m_world, m_connection, [] { return "simulated"; }, [this] {
        if (!m_live() || m_dispatcher.IsKilled()) throw MethodError("game_loading", "Simulation gate closed.");
    });
    // No retail actor/input adapter in this host; state-machine/frame races have native fixtures.
    d.Register({"supervisor.set", Access::WritePlayer, RunOn::BridgeThread, "Requires a retail actor adapter.", [this](const MethodContext& c) -> nlohmann::json {
        if (!m_hooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        supervisor::Parse(c.params);
        throw MethodError("supervisor_unavailable", "Simulated host has no retail input/actor adapter; use supervisor core fixtures");
    }});
    d.Register({"supervisor.state", Access::Read, RunOn::BridgeThread, "Read inactive simulated supervisor.", [this](const MethodContext& c) {
        params::RequireOnly(c.params, {});
        if (!m_hooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        auto state = m_supervisor.State(); state["simulated"] = true; return state;
    }});
    d.Register({"supervisor.clear", Access::Control, RunOn::BridgeThread, "Clear inactive simulated supervisor.", [this](const MethodContext& c) {
        params::RequireOnly(c.params, {});
        if (!m_hooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        auto state = m_supervisor.Clear("cleared"); state["simulated"] = true; return state;
    }});
    input::RegisterMethods(d, m_service, hooks,
#ifdef XFB_ENGINE_INPUT_TESTS
                          true,
#else
                          false,
#endif
                          Now, m_world, m_context, [this] { return Ops(); });
    d.Register({"selftest.input", Access::Control, RunOn::GameThread, "Steer the simulated input fixture only.", [this](const MethodContext& c) -> nlohmann::json {
        if (c.params.contains("offer")) m_offered = c.params.at("offer").get<bool>();
        if (c.params.contains("modal")) m_modal = c.params.at("modal").get<bool>();
        if (c.params.contains("changed")) m_changed = c.params.at("changed").get<bool>();
        if (c.params.contains("new_controller")) { ++m_generation; m_confirmation = false; }
        if (c.params.value("cancel_confirmation", false))
        {
            m_confirmation = false;
            m_service.Observe("input.photo.confirmation", {{"generation", m_generation}, {"confirmation", false}, {"observed_at", "update"}});
        }
        m_service.SetLock(1, m_offered);
        if (c.params.contains("observe")) m_service.Observe(c.params.at("kind").get<std::string>(), c.params.at("observe"));
        if (c.params.value("draw", false))
        {
            const auto token = m_service.TakeUi(Now(), m_world(), 1, m_offered);
            if (!token.is_null()) m_service.ReportUi({{"request_id", token["request_id"]}, {"run_id", token["run_id"]}, {"activated", true}});
        }
        return m_service.State();
    }});
#endif
}
input::Ops SimInput::Ops()
{
    input::Ops ops;
    ops.connection = m_connection;
    ops.guard = [this] { if (!m_live()) throw MethodError("game_loading", "Simulated session detached."); m_dispatcher.RequireWritesOpen(); };
    ops.hub = [this] { return m_npc.InputHub(); };
    ops.choice = [this](int32_t h, int32_t g, int32_t i, bool a) { return m_npc.InputStep(h, g, i, a); };
    ops.photo = [this] { return input::json{{"generation", m_generation}, {"shown", m_context() == "photo_mode"}, {"changed", m_changed}, {"confirmation", m_confirmation}}; };
    ops.exitAttempt = [this](int32_t, bool comparison) {
        m_confirmation = !m_modal && m_changed;
        m_service.Observe("input.photo.entry", {{"generation", m_generation}, {"comparison", comparison}});
        if (m_modal) m_service.Observe("input.photo.held", {{"generation", m_generation}});
        if (m_confirmation) m_service.Observe("input.photo.confirmation", {{"generation", m_generation}, {"confirmation", true}});
        m_service.Observe("input.photo.callback", {{"generation", m_generation}, {"held", m_modal}, {"changed", m_changed}, {"confirmation", m_confirmation}});
        return input::json{{"submitted", true}};
    };
    ops.inputReady = [] { return false; }; // simulation does not commission the retail adapter
    ops.inputStatus = [] { return input::json{{"available", false}, {"coverage", "simulation_only"}, {"blocker", "Retail receiver lifetime/release is not commissioned by a simulated host."}}; };
    return ops;
}
void SimInput::Tick()
{
    recording::Ops recorderOps;
    recorderOps.guard = [this] { if (!m_live() || m_dispatcher.IsKilled()) throw MethodError("game_loading", "Simulation gate closed."); };
    recorderOps.sample = [](const std::string& channel, const std::vector<std::string>&) {
        return input::json{{"simulated", true}, {"valid", true}, {"channel", channel}, {"position", {0, 0, 0}}};
    };
    m_recording.Tick(recording::Now(), m_world(), m_connection(), m_hooks && m_live() && !m_dispatcher.IsKilled(), ++m_recordTick, recorderOps);
    bool open = m_hooks && m_live();
    try { m_dispatcher.RequireWritesOpen(); } catch (...) { open = false; }
    m_service.SetLock(1, m_offered);
    m_service.Tick(Now(), m_world(), m_context(), open, Ops());
}
}
