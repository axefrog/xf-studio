#include <Windows.h>
#include <regex>
#include <RED4ext/RED4ext.hpp>
#include "core/Supervisor.hpp"
#include "core/Recording.hpp"
#include "core/DmMicro.hpp"
#include "core/Params.hpp"
#include "plugin/Supervisor.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
namespace
{
using json = nlohmann::json;
using supervisor::Work;
std::atomic<bool> gWatchOwed{false};
uint64_t World() { return Get().scriptLayer.Describe().value("detaches", uint64_t{0}); }
uint64_t Connection() { return Get().bridge ? Get().bridge->ConnectionsAccepted() : 0; }
supervisor::Service& Owner()
{
    static supervisor::Service service([](const std::string& event, const json& data) {
        auto payload = data; payload["event"] = event;
        Get().events.Push(event, event == "supervisor.violation" ? "warn" : "info", "supervisor", "While you were away: " + event, payload);
        RecordingIngress("supervisor", SerializeJson(payload));
    });
    return service;
}
supervisor::Observation Observe()
{
    RED4ext::CString channel("v"), actors("");
    auto sample = ScriptCall("XFRecording", "Sample", {"String", "String"}, {&channel, &actors}, "supervisor-read");
    sample.update(ScriptCall("XFSupervisor", "Read", {}, {}, "supervisor-read"));
    return supervisor::ReadObservation(sample);
}
// 0.8.19: one XF actor's reading (XFSupervisorActors.Read), with the phase and world-freeze of V's reading.
supervisor::Observation ObserveNpc(const std::string& ref, const supervisor::Observation& global)
{
    RED4ext::CString who(ref.c_str());
    return supervisor::ReadNpcObservation(ScriptCall("XFSupervisor", "ReadActor", {"String"}, {&who}, "supervisor-read"), global);
}
supervisor::Observation ObserveKey(const std::string& key, const supervisor::Observation& global)
{
    if (key.rfind("npc:", 0) == 0) return ObserveNpc(key.substr(4), global);
    return global;
}
// V's entry needs the player class; an XF actor's entries need the NPC class (the actions they take are npc writes).
void Gate(Access cls = Access::WritePlayer)
{
    auto& s = Get();
    if (!s.config.allowTestHooks || !s.bridge || !s.bridge->HasClient()) throw MethodError("test_hooks_off", "Supervisor needs autonomous hooks and a connected owner");
    s.scriptLayer.Require("supervisor");
    auto& d = s.bridge->GetDispatcher(); d.RequireWritesOpen(); d.RequireWriteClass(cls);
}
Access ClassOf(const std::string& key) { return key.rfind("npc:", 0) == 0 ? Access::WriteNpc : Access::WritePlayer; }
// "all" or absent: every entry (nullopt); {kind, ref}: that one entry's key.
std::optional<std::string> ActorKey(const json& params)
{
    if (!params.contains("actor") || (params["actor"].is_string() && params["actor"].get<std::string>() == "all")) return std::nullopt;
    if (!params["actor"].is_object()) throw MethodError("bad_params", "actor must be \"all\" or {kind, ref}");
    const auto& a = params["actor"];
    for (const auto& [k, v] : a.items()) if (k != "kind" && k != "ref") throw MethodError("bad_params", "Unknown actor field: " + k);
    if (!a.contains("kind") || !a.contains("ref") || !a["kind"].is_string() || !a["ref"].is_string()) throw MethodError("bad_params", "actor needs a kind and a ref");
    auto kind = a["kind"].get<std::string>(), ref = a["ref"].get<std::string>();
    if (kind == "player" && ref == "v") ref = "V";
    if (kind == "npc" && ref.size() > 1 && (ref[0] == 'A' || ref[0] == 'P')) ref[0] = static_cast<char>(ref[0] + 32);
    if (!((kind == "player" && ref == "V") || (kind == "npc" && std::regex_match(ref, std::regex("[ap][0-9]{1,15}")))))
        throw MethodError("bad_params", "actor must be \"all\", V or a returned NPC handle");
    return kind + ":" + ref;
}
bool Near(const json& item, const supervisor::Point& v)
{
    try { return item.value("present", true) && item.contains("position") && supervisor::Distance(item.at("position").get<supervisor::Point>(), v) <= 30; }
    catch (...) { return false; }
}
// Internal envelopes never come from client data. The only methods are built below.
json Pack(const Work& w, const json& params)
{
    return {{"actor", w.actor}, {"generation", w.generation}, {"incident", w.incident}, {"contact", w.contact}, {"violation", w.violation}, {"action", w.action}, {"safe", w.safe}, {"caller_write_classes", w.callerWriteClasses}, {"params", params}};
}
std::unique_ptr<dm::MicroRunner>& RunnerSlot() { static std::unique_ptr<dm::MicroRunner> runner; return runner; }
dm::MicroRunner& Runner()
{
    auto& runner = RunnerSlot();
    if (!runner) runner = std::make_unique<dm::MicroRunner>(
        [](const std::string& method, const json& p, const std::string& cid, const std::string& token) {
            Work w{p.at("actor").get<std::string>(), p.at("generation").get<uint64_t>(), p.at("incident").get<uint64_t>(), p.at("contact").get<uint64_t>(),
                   p.at("violation").get<std::string>(), p.at("action").get<std::string>(), p.at("safe")};
            w.callerWriteClasses = p.at("caller_write_classes").get<uint32_t>();
            json response;
            try {
                auto& s = Get();
                if (!s.bridge) throw MethodError("no_bridge", "Supervisor lost its dispatcher");
                auto guard = [w, method, params = p.at("params")](bool changing) {
                    Gate(ClassOf(w.actor));
                    const auto global = Observe();
                    const auto o = ObserveKey(w.actor, global); Owner().Require(w, o, recording::Now(), World(), Connection(), changing);
                    // Despawn only bridge-owned actors/props still within 30 m on this frame.
                    if (w.action == "withdraw_nearby") {
                        const auto items = method == "npc.release" ? SupervisorNpcs() : SupervisorProps();
                        bool found = false;
                        for (const auto& item : items) {
                            const bool same = method == "npc.release" ? item.at("who") == params.at("who") : item.at("handle") == params.at("id");
                            found |= same && Near(item, o.position);
                        }
                        if (!found) throw MethodError("precondition_failed", "Owned target moved away or disappeared");
                    }
                };
                const json request{{"v", kProtocolVersion}, {"id", cid}, {"cid", cid}, {"token", token}, {"method", method}, {"params", p.at("params")},
                                   {"caller_write_classes", supervisor::CallerClasses(w.callerWriteClasses)}};
                response = json::parse(s.bridge->GetDispatcher().HandleGuarded(request.dump(), GetCurrentProcessId(), guard).line);
            } catch (const MethodError& e) { response = {{"ok", false}, {"error", {{"code", e.code}, {"message", e.what()}}}}; }
            catch (const std::exception& e) { response = {{"ok", false}, {"error", {{"code", "failed"}, {"message", e.what()}}}}; }
            Owner().Result(w, method, response);
            Owner().Flush();
            return response;
        }, [](const std::string&, const std::string&, const std::string&, const json&) {});
    return *runner;
}
void Enqueue(const Work& w, const supervisor::Observation& o)
{
    dm::MicroBatch batch; batch.watch = "supervisor"; batch.seq = w.incident; batch.sessionToken = Get().session.token;
    auto add = [&](const std::string& method, json p) { batch.actions.push_back({method, Pack(w, p), 0}); };
    if (w.actor.rfind("npc:", 0) == 0) {
        // An XF actor: release is a despawn (npc.release never refuses for an actor that is gone), return_last_safe an npc.place
        // to the observed quiet point (the normal range and ground checks apply), handover and pause as for V.
        const auto ref = w.actor.substr(4);
        if (w.action == "release") add("npc.release", {{"who", ref}, {"how", "despawn"}});
        else if (w.action == "handover") add("bridge.handover", {{"on", true}, {"note", "Supervisor: " + w.actor + " " + w.violation}});
        else if (w.action == "pause_world") add("world.pause", {{"paused", true}});
        else if (w.action == "return_last_safe" && !w.safe.is_null()) add("npc.place", {{"who", ref}, {"at", w.safe.at("at")}, {"yaw", w.safe.at("yaw")}});
    } else if (w.action == "stop_behaviours") add("behave.stop", {{"all", true}});
    else if (w.action == "release_holds") add("player.stop", json::object());
    else if (w.action == "handover") add("bridge.handover", {{"on", true}, {"note", "Supervisor: " + w.violation}});
    else if (w.action == "pause_world") add("world.pause", {{"paused", true}});
    else if (w.action == "return_last_safe" && !w.safe.is_null()) {
        add("player.stop", json::object());
        add("player.teleport", {{"position", w.safe.at("at")}, {"yaw", w.safe.at("yaw")}});
        batch.actions.back().delayS = .4; // player.stop's behaviour cleanup runs on the next game tick
    } else if (w.action == "withdraw_nearby") {
        for (const auto& item : SupervisorNpcs()) if (Near(item, o.position)) add("npc.release", {{"who", item.at("who")}, {"how", "despawn"}});
        for (const auto& item : SupervisorProps()) if (Near(item, o.position)) add("world.despawn", {{"id", item.at("handle")}});
    }
    if (batch.actions.empty()) { Owner().Result(w, "none", {{"ok", false}, {"error", {{"code", w.action == "return_last_safe" ? "no_safe_position" : "no_owned_target"}}}}); return; }
    // One bounded worker, no delay/burst loop, and a terminal result for every admitted intervention.
    if (Runner().Pending() + batch.actions.size() > 16) { Owner().Result(w, "none", {{"ok", false}, {"error", {{"code", "supervisor_busy"}}}}); return; }
    Runner().Enqueue(std::move(batch));
}
}
#endif
void RegisterSupervisor(Dispatcher& d)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    d.SetSafetyCancellation(CancelSupervisor);
    // Access::Write, not WritePlayer: admission is actor-aware (0.8.19). The write classes the entry really needs (RequiredWriteClasses:
    // the player class for V's entry, the NPC class for an XF actor's, plus each selected policy's) are checked below, so an NPC-only
    // entry does not need to be allowed to change the player.
    d.Register({"supervisor.set", Access::Write, RunOn::BridgeThread, "Arm a bounded safety supervisor entry for V or an XF actor.", [&d](const MethodContext& c) {
        // Validate everything before replacing the current owner or its input watch.
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        const auto entry = supervisor::Parse(c.params);
        const auto key = entry.actor.Key();
        Gate(ClassOf(key));
        const auto capabilities = supervisor::RequireCapabilities(entry, c.callerWriteClasses);
        const auto required = supervisor::RequiredWriteClasses(entry);
        for (auto access : {Access::WritePlayer, Access::WriteWorld, Access::WriteNpc, Access::WriteDm})
            if (required & WriteClassBit(access)) d.RequireWriteClass(access);
        if (entry.actor.kind == "spawn") throw MethodError("actor_unavailable", "Spawned-object references are a reserved adapter, not commissioned yet");
        if (entry.actor.kind == "npc" && entry.actor.ref[0] != 'a') throw MethodError("actor_unavailable", "Only XF actors (a1, a2, ...) can be supervised, never picked passers-by");
        const auto generation = Owner().Generation(key);
        return d.RunWrite(GameTimeout(), [c, key, generation, capabilities, ref = entry.actor.ref, player = entry.actor.kind == "player"] {
            Gate(ClassOf(key));
            auto global = Observe();
            auto observed = player ? global : ObserveNpc(ref, global);
            if (player && !Owner().Active(key)) observed.input.clear(); // explicit re-arm starts a new watch
            auto out = Owner().Set(c.params, observed, recording::Now(), World(), Connection(), generation, capabilities);
            if (player) {
                gWatchOwed = true;
                try { bool on = true; ScriptCall("XFSupervisor", "Watch", {"Bool"}, {&on}, c.cid); }
                catch (...) { Owner().Clear("input_watch_failed", key); throw; }
            }
            Owner().Flush(); return out;
        }, "supervisor.set");
    }});
    d.Register({"supervisor.state", Access::Read, RunOn::BridgeThread, "Read the supervisor entries and quiet-position evidence.", [](const MethodContext& c) {
        params::RequireOnly(c.params, {"actor"});
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        const auto key = ActorKey(c.params);
        return key ? Owner().State(*key) : Owner().StateAll();
    }});
    d.Register({"supervisor.clear", Access::Control, RunOn::BridgeThread, "Cancel supervisor ownership (one actor, or all) without touching game objects.", [](const MethodContext& c) {
        params::RequireOnly(c.params, {"actor"});
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        const auto key = ActorKey(c.params);
        if (key) Owner().Clear("cleared", *key); else Owner().Clear("cleared");
        auto out = Owner().StateAll(); // the answer is about every entry: "active" says whether any remains
        out["cleared"] = key ? json(*key) : json("all");
        Owner().Flush(); return out;
    }});
#else
    (void)d;
#endif
}
void CancelSupervisor(const std::string& reason)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    Owner().Clear(reason);
#else
    (void)reason;
#endif
}
bool SupervisorWanted(const std::string& channel)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    return (channel == "contacts" || channel == "supervisor") && Owner().Active();
#else
    (void)channel; return false;
#endif
}
void SupervisorIngress(const std::string& channel, const nlohmann::json& event)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    // VM ingress may run inside the recorder's sample. Only copy/cancel here; flush outside
    // recorder/VM locks on the supervisor tick or worker, avoiding a recorder -> sink lock cycle.
    if (channel == "contacts") Owner().Contact(event, recording::Now());
    else if (channel == "supervisor" && event.value("event", std::string()) == "supervisor.input") Owner().Input(event.value("action", std::string("unknown")));
#else
    (void)channel; (void)event;
#endif
}
void TickSupervisor(bool ready)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!ready) { if (Owner().Active()) CancelSupervisor("game_loading"); gWatchOwed = false; Owner().Flush(); return; }
    try {
        std::optional<supervisor::Observation> global; // V's reading, taken once per tick for every entry that needs it
        for (const auto& key : Owner().ActiveKeys()) {
            if (!Owner().Due(key, recording::Now())) continue;
            try {
                Gate(ClassOf(key));
                if (!global) global = Observe();
                const auto o = ObserveKey(key, *global);
                for (const auto& w : Owner().Tick(o, recording::Now(), World(), Connection())) {
                    try { Enqueue(w, o); }
                    catch (const std::exception& e) { Owner().Result(w, "plan", {{"ok", false}, {"error", {{"code", "plan_unavailable"}, {"message", e.what()}}}}); }
                }
            } catch (const std::exception&) { Owner().Clear("gate_or_read_unavailable", key); }
        }
    } catch (const std::exception&) { CancelSupervisor("gate_or_read_unavailable"); }
    if (!Owner().Active("player:V") && gWatchOwed.exchange(false)) {
        try { bool on = false; ScriptCall("XFSupervisor", "Watch", {"Bool"}, {&on}, "supervisor-clear"); } catch (...) {}
    }
    Owner().Flush();
#else
    (void)ready;
#endif
}
void StopSupervisor()
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    CancelSupervisor("shutdown");
    if (RunnerSlot()) RunnerSlot()->Stop();
    Owner().Flush();
#endif
}
}
