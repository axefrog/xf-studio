#include "core/Recording.hpp"
#include "core/Bridge.hpp"
#include <cstdio>
#include <fstream>
#include <future>
namespace
{
using namespace xfb;
int checks = 0, failures = 0;
void Check(bool ok, const char* label) { ++checks; if (!ok) { ++failures; std::printf("RECORD FAIL %s\n", label); } }
template<class F> void Refuses(F fn, const char* code)
{ try { fn(); Check(false, code); } catch (const MethodError& e) { Check(e.code == code, code); } }
}
int RecordingUnitTests()
{
    using namespace xfb::recording;
    {
        Service cancelled;
        const auto pending = cancelled.CancellationGeneration();
        cancelled.RequestStop("cancelled");
        Refuses([&] { cancelled.Start(json::object(), 1, 1, 1, "fixture", pending); }, "interrupted");
        Check(cancelled.Start({{"channels", {"voice"}}}, 2, 1, 1, "fixture")["active"] == true, "fresh start allowed after cancelled pending start");
        Check(cancelled.Wants("voice"), "fresh generation opens ingress despite previous stop reason");
        cancelled.RequestStop("cancelled");
        Check(!cancelled.Read({{"run", 1}}, 3)["active"].get<bool>(), "new stop still closes fresh generation");
    }
    {
        // A stop on the control route wins over a start admitted but not yet run by the game.
        Config config; config.maxRequestsPerSecond = 1000;
        Session session; session.token = "fixture";
        GameThreadQueue queue; queue.SetPumping(true);
        Dispatcher dispatcher(config, session, queue); Service queued;
        RegisterMethods(dispatcher, queued, true, [] { return 1; }, [] { return 1; }, [] { return "fixture"; }, [] {});
        auto request = [&](const char* method, bool control = false) {
            return json::parse(dispatcher.Handle(SerializeJson(json{{"v", 1}, {"token", session.token}, {"method", method}, {"params", json::object()}}), 1, control).line);
        };
        auto pending = std::async(std::launch::async, [&] { return request("test.record.start"); });
        // No game pumping during admission; the future must remain waiting for its queued step.
        Check(pending.wait_for(std::chrono::milliseconds(40)) == std::future_status::timeout, "recorder start awaits game queue");
        Check(request("test.record.stop", true)["ok"] == true, "control stop acknowledged before pending start executes");
        queue.Drain(1);
        const auto answer = pending.get();
        Check(answer["ok"] == false && answer["error"]["code"] == "interrupted", "queued native start cannot overwrite emergency stop");
    }
    Service s; int reads = 0, guarded = 0;
    Ops ops; ops.guard = [&] { ++guarded; }; ops.sample = [&](const std::string&, const std::vector<std::string>&) {
        ++reads; return json{{"valid", true}, {"position", {1, 2, 3}}}; };
    const auto start = s.Start({{"actors", {"a1"}}}, 100, 1, 2, "test-session");
    Check(start["requested_hz"] == 10, "source target 10 Hz");
    Refuses([&] { s.Start(json::object(), 100, 1, 2, "test-session"); }, "recording_busy");
    for (int i = 0; i < 20; ++i) s.Tick(100 + i * 0.05, 1, 2, true, i, ops);
    auto page = s.Read({{"run", 1}}, 101);
    Check(reads == 30 && guarded == reads, "ten fresh samples per channel, guarded each time");
    Check(page["sample_ticks"] == 10 && page["actual_hz"] == 10, "actual cadence");
    Check(page["records"].size() == 5 && page["next"] == 5, "wire-bounded page");
    s.Tick(101.35, 1, 2, true, 30, ops);
    page = s.Read({{"run", 1}}, 101.35);
    Check(page["missed_deadlines"] == 3 && reads == 33, "missed deadlines counted, no catch-up duplicates");
    const auto before = reads;
    s.Tick(101.5, 2, 2, false, 31, ops);
    page = s.Read({{"run", 1}}, 101.5);
    Check(!page["active"].get<bool>() && reads == before && page["reason"] == "world_changed", "load stops before source read");
    s.Stop("cancel", 102); Check(s.Read({{"run", 1}}, 102)["latest"] == 33, "stopped ring drainable");
    Refuses([&] { s.Read({{"run", 2}}, 102); }, "recording_changed");
    Refuses([&] { s.Read({{"run", 1}, {"since", -1}}, 102); }, "bad_params");
    s.Read({{"run", 1}, {"since", 33}}, 102);
    Refuses([&] { s.Start({{"actors", {"a1,a2"}}}, 102, 1, 2, "test"); }, "bad_params");
    Refuses([&] { s.Start({{"channels", {"v", "v"}}}, 102, 1, 2, "test"); }, "bad_params");
    s.Start({{"channels", {"v"}}}, 200, 3, 2, "test");
    for (int i = 0; i < 550; ++i) s.Tick(200 + i * 0.1, 3, 2, true, i, ops);
    page = s.Read({{"run", 2}}, 255);
    Check(page["dropped"] == 38 && page["lost"] == 38 && page["records"][0]["seq"] == 39, "ring overflow visible");
    s.Stop("kill", 255); s.Read({{"run", 2}, {"since", 550}}, 255);
    s.Start({{"channels", {"v"}}, {"byte_cap", 8192}}, 300, 4, 3, "test");
    ops.sample = [](const std::string&, const std::vector<std::string>&) { return json{{"text", std::string(9000, 'x')}}; };
    s.Tick(300, 4, 3, true, 1, ops);
    page = s.Read({{"run", 3}}, 300);
    Check(page["lost"] == 1 && page["records"].empty(), "oversize cannot replay previous run slot");
    s.Stop("cancel", 300); s.Read({{"run", 3}, {"since", 1}}, 300);
    s.Start({{"channels", {"v"}}, {"duration_s", 1}}, 400, 5, 3, "test");
    s.Tick(401, 5, 3, true, 1, ops);
    Check(s.Read({{"run", 4}}, 401)["reason"] == "duration", "bounded duration");
    s.Start({{"channels", {"v"}}}, 500, 6, 3, "test");
    s.Tick(500, 6, 4, true, 1, ops);
    Check(!s.Read({{"run", 5}}, 500)["active"].get<bool>(), "new connection cancels owner");
    // Event ingress uses the same run/ring/cap and source QPC, without resampling each line.
    Service taps;
    taps.Start({{"channels", {"subtitles", "voice"}}}, 600, 7, 4, "tap-test");
    Check(taps.Wants("subtitles") && taps.Wants("voice") && !taps.Wants("v"), "selected event channels only");
    Check(taps.Ingress("subtitles", R"({"event":"line.requested","text":"Question?"})", 600.01, 7, 4, 1), "bounded event accepted");
    Check(taps.Ingress("voice", R"({"event":"voice.requested","trigger":"greeting"})", 600.02, 7, 4, 2), "voice request accepted");
    auto events = taps.Read({{"run", 1}}, 600.1);
    Check(events["records"].size() == 2 && events["records"][0]["source_s"] == 600.01 && events["records"][1]["channel"] == "voice", "events in shared sequence with source time");
    Check(!taps.Ingress("voice", std::string(9000, 'x'), 600.03, 7, 4, 3), "oversize ingress refused");
    Check(!taps.Ingress("voice", "{bad", 600.04, 7, 4, 3), "malformed ingress refused");
    Check(!taps.Ingress("voice", std::string(20, '[') + "0" + std::string(20, ']'), 600.05, 7, 4, 3), "nested ingress refused before parse");
    Check(taps.Read({{"run", 1}}, 600.1)["invalid"] == 3, "ingress failures invalidate absence proof");
    int heartbeats = 0;
    ops.sample = [&](const std::string&, const std::vector<std::string>&) { ++heartbeats; return json{{"event", "tap.coverage"}, {"valid", true}}; };
    for (int i = 0; i < 10; ++i) taps.Tick(600.1 + i * 0.1, 7, 4, true, i, ops);
    Check(heartbeats == 2, "one coverage heartbeat per channel, no per-line polling flood");
    taps.RequestStop("cancelled");
    Check(!taps.Wants("voice") && !taps.Ingress("voice", R"({"event":"voice.requested"})", 601, 7, 4, 4), "cancel closes event ingress immediately");
    Check(!taps.Read({{"run", 1}}, 601)["active"].get<bool>(), "cancel drain retains events");
    Service changed; changed.Start({{"channels", {"voice"}}}, 700, 8, 4, "tap-test");
    Check(!changed.Ingress("voice", R"({"event":"voice.requested"})", 700.1, 9, 4, 1) && !changed.Wants("voice"), "world change closes ingress before record");
    Service capped; capped.Start({{"channels", {"voice"}}, {"byte_cap", 8192}}, 800, 8, 4, "tap-test");
    for (int i = 0; i < 20; ++i) capped.Ingress("voice", R"({"event":"voice.requested"})", 800.1, 8, 4, i);
    Check(capped.Read({{"run", 1}}, 801)["reason"] == "byte_cap", "event byte cap stops run");
    Service fu; fu.Start({{"channels", {"face", "ui"}}}, 900, 8, 4, "fu-test");
    int faceHeartbeats = 0, uiSamples = 0;
    ops.sample = [&](const std::string& channel, const std::vector<std::string>&) {
        if (channel == "face") ++faceHeartbeats; else if (channel == "ui") ++uiSamples;
        return json{{"valid", true}};
    };
    for (int i = 0; i < 10; ++i) fu.Tick(900 + i * 0.1, 8, 4, true, i, ops);
    Check(faceHeartbeats == 1 && uiSamples == 10, "F coverage at 1 Hz, U fresh consumer reads at 10 Hz");
    Check(fu.Ingress("face", R"({"event":"face.bridge_resend","attitude_prepared":true})", 900.91, 8, 4, 11), "F submission ingress uses same bounded recorder");
    fu.RequestStop("cancelled");
    Check(!fu.Wants("face") && !fu.Wants("ui"), "F/U ingress stops immediately");
    // File writer is the single off-thread drain, independent of a killed/disconnected pipe.
    const std::string sid = "fixture";
    const auto dir = std::filesystem::temp_directory_path() / ("xfb-record-" + std::to_string(Now()));
    {
        Service files; files.SetDirectory(dir);
        files.Start({{"channels", {"v"}}}, Now(), 1, 1, sid);
        ops.sample = [](const std::string&, const std::vector<std::string>&) { return json{{"valid", true}}; };
        files.Tick(Now(), 1, 1, true, 1, ops);
        Config config; Session session; session.sessionId = sid; session.runtimeDir = dir;
        GameThreadQueue queue; Bridge bridge(config, session, queue);
        bridge.SetStopObserver([&files] { files.RequestStop("kill"); });
        bridge.Kill("recorder-fixture"); files.JoinWriter();
        std::ifstream input(dir / sid / "run-1" / "manifest.json"); json manifest; input >> manifest;
        Check(manifest["complete"] == true && manifest["latest"] == 1 && manifest["reason"] == "kill", "kill drains chunks and final manifest");
        Check(manifest["chunks"].size() == 1 && !manifest["writer_pending"].get<bool>(), "writer joined and accounted");
    }
    if (std::filesystem::equivalent(dir.parent_path(), std::filesystem::temp_directory_path()) && dir.filename().string().starts_with("xfb-record-"))
        std::filesystem::remove_all(dir);
    std::printf("RECORDING UNIT: %d checks, %d failures\n", checks, failures); return failures;
}
