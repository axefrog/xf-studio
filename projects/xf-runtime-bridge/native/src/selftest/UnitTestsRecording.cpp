#include "core/Recording.hpp"
#include "core/Bridge.hpp"
#include "core/Lifecycle.hpp"
#include "core/Dispatcher.hpp"
#include <cstdio>
#include <fstream>
#include <future>
#include <ctime>
#include <cmath>
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
        // RS1: discovery works before the first run and on reader connections, with no game queue or lease.
        Config config; config.maxRequestsPerSecond = 1000;
        Session session; session.token = "fixture"; session.sessionId = "observer-session";
        GameThreadQueue queue; // deliberately not pumping: an accidental game-thread call must fail
        Dispatcher dispatcher(config, session, queue); Service recorder;
        int gameCalls = 0;
        RegisterMethods(dispatcher, recorder, true,
            [&] { ++gameCalls; return 99; }, [&] { ++gameCalls; return 99; },
            [&] { return session.sessionId; }, [&] { ++gameCalls; });
        auto request = [&](bool reader, json params = json::object()) {
            return json::parse(dispatcher.Handle(SerializeJson(json{{"v", 1}, {"token", session.token},
                {"method", "recorder.status"}, {"params", params}}), 1, false, reader).line);
        };
        const auto empty = request(true);
        Check(empty["ok"] == true && empty["result"] == json{{"active", false}, {"run", nullptr},
            {"session", session.sessionId}, {"world", nullptr}, {"channels", json::array()}, {"start", nullptr},
            {"latest", nullptr}, {"stop_reason", nullptr}, {"requested_hz", nullptr}, {"duration_s", nullptr},
            {"byte_cap", nullptr}, {"ack", nullptr}}, "RS1: reader discovers no run with explicit nulls");
        Check(dispatcher.AccessOf("recorder.status") == Access::Read && gameCalls == 0,
              "RS1: read class without game-thread work");
        Check(request(false)["result"] == empty["result"], "RS1: writer gets the same empty snapshot");
        Check(request(true, {{"run", 1}})["error"]["code"] == "bad_params", "RS1: status accepts no parameters");

        const double start = Now() - 2;
        recorder.Start({{"channels", {"v", "voice"}}, {"duration_s", 23}, {"byte_cap", 123456}}, start, 7, 4, session.sessionId);
        Ops ops; ops.guard = [] {}; ops.sample = [](const auto&, const auto&) { return json{{"valid", true}}; };
        recorder.Tick(start, 7, 4, true, 1, ops);
        const auto before = recorder.Read({{"run", 1}}, start + 0.1, false);
        const auto generation = recorder.CancellationGeneration();
        const auto identity = recorder.Identity("voice");
        const auto active = request(true)["result"];
        Check(active["active"] == true && active["run"] == 1 && active["session"] == session.sessionId &&
              active["world"] == 7 && active["channels"] == json::array({"v", "voice"}) &&
              active["start"]["s"] == start && active["latest"] == before["latest"] && active["ack"] == 0 &&
              active["requested_hz"] == 10 && active["duration_s"] == 23 && active["byte_cap"] == 123456 && active["stop_reason"].is_null(),
              "RS1: reader discovers active run and its existing limits/cursors");
        const auto at = active["start"]["at"].get<std::string>();
        int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, ms = 0;
        const auto fields = sscanf_s(at.c_str(), "%d-%d-%dT%d:%d:%d.%dZ", &year, &month, &day, &hour, &minute, &second, &ms);
        std::tm tm{}; tm.tm_year = year - 1900; tm.tm_mon = month - 1; tm.tm_mday = day;
        tm.tm_hour = hour; tm.tm_min = minute; tm.tm_sec = second;
        const auto derived = std::chrono::system_clock::from_time_t(_mkgmtime(&tm)) + std::chrono::milliseconds(ms);
        const auto expected = std::chrono::system_clock::now() - std::chrono::duration<double>(Now() - start);
        Check(fields == 7 && at.size() == 24 && at.back() == 'Z' && ms >= 0 && ms <= 999 &&
              std::abs(std::chrono::duration<double>(derived - expected).count()) < 1,
              "RS1: start.at is derived UTC with millisecond precision");
        Check(recorder.Read({{"run", 1}}, start + 0.1, false) == before && recorder.CancellationGeneration() == generation &&
              recorder.Identity("voice") == identity && recorder.Wants("voice"), "RS1: observer leaves recorder state untouched");
        recorder.Read({{"run", 1}, {"since", 1}}, start + 0.1); // the writer alone advances ack
        Check(request(true)["result"]["ack"] == 1 && request(false)["result"]["ack"] == 1,
              "RS1: reader and writer status report but never advance writer acknowledgement");
        recorder.Stop("load_requested", start + 1);
        const auto stopped = request(true)["result"];
        Check(stopped["active"] == false && stopped["run"] == 1 && stopped["world"] == 7 &&
              stopped["stop_reason"] == "load_requested" && stopped["start"]["s"] == start &&
              stopped["latest"] == active["latest"] && stopped["ack"] == 1 && stopped["channels"] == active["channels"],
              "RS1: stopped run retains identity, cursors and stop reason");
        Refuses([&] { recorder.Start(json::object(), start + 2, 7, 4, session.sessionId); }, "recording_busy");
        Check(gameCalls == 0, "RS1: every status call avoids world/connection/guard callbacks");

        Dispatcher off(config, session, queue); Service disabled;
        RegisterMethods(off, disabled, false, [] { return 1; }, [] { return 1; }, [] { return "fixture"; }, [] {});
        const auto refused = json::parse(off.Handle(SerializeJson(json{{"v", 1}, {"token", session.token},
            {"method", "recorder.status"}, {"params", json::object()}}), 1, false, true).line);
        Check(refused["error"]["code"] == "test_hooks_off", "RS1: status mirrors recorder test-hook gate");
    }
    {
        Service recorder;
        recorder.Start({{"channels", {"voice"}}}, 10, 1, 1, "pending");
        recorder.RequestStop("cancelled");
        const auto generation = recorder.CancellationGeneration();
        const auto pending = recorder.ObserverStatus("pending");
        Check(pending["active"] == true && pending["stop_reason"].is_null() && recorder.CancellationGeneration() == generation,
              "RS1: status does not apply or replace a pending cancellation");
        Check(recorder.Read({{"run", 1}}, 11)["reason"] == "cancelled", "RS1: pending stop remains for the existing recorder consumer");
        Check(recorder.ObserverStatus("pending")["stop_reason"] == "cancelled", "RS1: applied cancellation reason is observable");
        recorder.Start({{"channels", {"v"}}, {"duration_s", 1}}, 20, 2, 1, "pending");
        recorder.Tick(21, 2, 1, true, 1, {});
        const auto expired = recorder.ObserverStatus("pending");
        Check(expired["active"] == false && expired["run"] == 2 && expired["world"] == 2 &&
              expired["stop_reason"] == "duration", "RS1: automatic duration stop reason is observable");
    }
    {
        // R8 §3–4: presence/readiness are observations, not an attach heuristic or invocation ABI.
        lifecycle::Snapshot s; s.observed = s.complete = true; s.atMs = 1000; s.generation = 7;
        auto state = [&](uint64_t now = 1000) { return lifecycle::Describe(s, now); };
        Check(state()["prompt_state"] == "unknown", "lifecycle: missing engagement scope is unknown");
        s.engagementKnown = true;
        Check(state()["prompt_state"] == "none", "lifecycle: complete observed scope with no prompt");
        s.engagementVisible = true;
        Check(state()["prompt_state"] == "start_screen" && state()["start_accepting"].is_null(), "lifecycle: visible engagement is presence, not GSM acceptance");
        Check(lifecycle::Probe(state())["would_call"]["action"] == "Start" && lifecycle::Probe(state())["admissible"] == false, "lifecycle: Start plan remains read-only and inadmissible");
        s.engagementVisible = false; s.initialCount = 1;
        Check(state()["prompt_state"] == "loading", "lifecycle: initial controller alone is not an offered prompt");
        s.loadingReady = true;
        Check(state()["prompt_state"] == "loading", "lifecycle: both native readiness gates required");
        s.animationReady = s.subscribed = s.panelResolved = s.panelVisible = true;
        Check(state()["prompt_state"] == "initial_continue" && state()["waiting_for_input"] == true, "lifecycle: current initial controller offers visible panel with subscription");
        Check(lifecycle::Probe(state())["would_call"]["action"] == "UI_Skip" && lifecycle::Probe(state())["called"] == false, "lifecycle: UI_Skip consumer is planned, never called");
        s.panelVisible = false;
        Check(state()["prompt_state"] == "unknown", "lifecycle: hidden initial skip panel cannot offer continue");
        s.panelVisible = true; s.subscribed = false;
        Check(state()["prompt_state"] == "unknown", "lifecycle: no subscription cannot offer continue");
        s.subscribed = true; s.consumed = true;
        Check(state()["prompt_state"] == "continuing" && state()["waiting_for_input"] == false, "lifecycle: consumed prompt is not offered again");
        s.consumed = false; s.automatic = true;
        Check(state()["prompt_state"] == "continuing", "lifecycle: automatic completion is not UI_Skip attribution");
        s.automatic = false; s.initialCount = 2;
        Check(state()["prompt_state"] == "unknown", "lifecycle: duplicate initial controllers are ambiguous");
        s.initialCount = 1; s.complete = false;
        Check(state()["prompt_state"] == "unknown", "lifecycle: truncated native tree cannot classify");
        s.complete = true;
        Check(state(1501)["prompt_state"] == "unknown" && state(999)["prompt_state"] == "unknown", "lifecycle: stale/future snapshots cannot identify a current prompt");
        s.observed = false;
        Check(state()["prompt_state"] == "unknown" && lifecycle::Probe(state())["would_call"].is_null(), "lifecycle: missing observer never invents a route");
    }
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
    {
        // 0.8.22 (B318-1 tripped on a load): a subtitle or voice coverage sample with no controllers yet, in the run's first
        // seconds before the tap has been ready, is not_ready, not invalid; later, or once ready, it is invalid as before.
        Service early;
        early.Start({{"channels", {"subtitles", "voice"}}}, 50, 1, 1, "not-ready");
        int controllers = 0;
        Ops tap; tap.guard = [] {}; tap.sample = [&](const std::string&, const std::vector<std::string>&) {
            return json{{"event", "tap.coverage"}, {"valid", controllers == 2}, {"controller_count", controllers}, {"source_listeners", 3}, {"registry_overflow", false}}; };
        early.Tick(50.0, 1, 1, true, 1, tap);  // the first heartbeat, no controllers: not ready
        controllers = 2;
        early.Tick(51.0, 1, 1, true, 2, tap);  // ready
        controllers = 0;
        early.Tick(52.0, 1, 1, true, 3, tap);  // gone after being ready: invalid
        auto page = early.Read({{"run", 1}}, 52.1);
        const auto& rows = page["records"];
        Check(page["invalid"] == 2 && page["not_ready"] == 2 && rows.size() == 5 && rows[0]["valid"] == true && rows[0]["data"]["reason"] == "not_ready" &&
                  rows[1]["data"]["reason"] == "not_ready" && rows[2]["valid"] == true && !rows[2]["data"].contains("reason") && page["channel_stats"]["subtitles"]["not_ready"] == 1,
              "0.8.22: tap coverage with no controllers early in a run is not_ready, not invalid");
        early.Stop("test", 52.2);
        early.Read({{"run", 1}, {"since", 6}}, 52.3);
        Service late;
        late.Start({{"channels", {"voice"}}}, 60, 1, 1, "late");
        controllers = 0;
        late.Tick(63.0, 1, 1, true, 1, tap); // past the window: invalid
        Check(late.Read({{"run", 1}}, 63.1)["invalid"] == 1, "0.8.22: no controllers past the not-ready window is invalid");
        late.Stop("test", 63.2);
        // Review (Low 7): ready on the first heartbeat, then the controllers go at 1 s, inside the window: invalid, no not_ready.
        Service lost;
        lost.Start({{"channels", {"subtitles"}}}, 70, 1, 1, "lost");
        controllers = 2;
        lost.Tick(70.0, 1, 1, true, 1, tap);
        controllers = 0;
        lost.Tick(71.0, 1, 1, true, 2, tap);
        const auto lostPage = lost.Read({{"run", 1}}, 71.1);
        Check(lostPage["invalid"] == 1 && lostPage["not_ready"] == 0 && lostPage["records"][1]["valid"] == false,
              "0.8.22 review: controllers lost after the tap was ready are invalid even inside the start-up window");
        lost.Stop("test", 71.2);
        // Review (Medium 5): the exception covers only an otherwise healthy tap (all listeners, no overflow), and a run whose tap
        // never became ready says so: the channel is not ready and the run is not complete.
        Service unhealthy;
        unhealthy.Start({{"channels", {"voice"}}}, 80, 1, 1, "unhealthy");
        Ops broken; broken.guard = [] {}; broken.sample = [](const std::string&, const std::vector<std::string>&) {
            return json{{"event", "tap.coverage"}, {"valid", false}, {"controller_count", 0}, {"source_listeners", 2}, {"registry_overflow", false}}; };
        unhealthy.Tick(80.0, 1, 1, true, 1, broken);
        const auto unhealthyPage = unhealthy.Read({{"run", 1}}, 80.1);
        Check(unhealthyPage["invalid"] == 1 && unhealthyPage["not_ready"] == 0, "0.8.22 review: a missing source listener is invalid even at start-up");
        unhealthy.Stop("test", 80.2);
        Service never;
        never.Start({{"channels", {"subtitles", "v"}}}, 90, 1, 1, "never");
        controllers = 0;
        never.Tick(90.0, 1, 1, true, 1, tap);
        const auto neverPage = never.Read({{"run", 1}}, 90.1);
        Check(neverPage["not_ready"] == 1 && neverPage["channel_stats"]["subtitles"]["ready"] == false && neverPage["tap_not_ready"] == json::array({"subtitles"}) &&
                  neverPage["complete_coverage"] == false,
              "0.8.22 review: a run whose tap never became ready shows the channel not ready and its coverage incomplete");
        controllers = 2;
        never.Tick(91.0, 1, 1, true, 2, tap);
        const auto readyPage = never.Read({{"run", 1}}, 91.1);
        Check(readyPage["channel_stats"]["subtitles"]["ready"] == true && readyPage["tap_not_ready"].empty(), "0.8.22 review: readiness once the tap is ready");
        never.Stop("test", 91.2);
    }
    {
        Service replay;
        replay.Start({{"channels", {"v"}}}, 10, 1, 1, "reader-ack");
        Ops sample; sample.guard = [] {}; sample.sample = [](const auto&, const auto&) { return json{{"valid", true}}; };
        replay.Tick(10, 1, 1, true, 1, sample);
        replay.Stop("test", 10.1);
        replay.Read({{"run", 1}, {"since", 1}}, 10.2, false);
        Refuses([&] { replay.Start({{"channels", {"v"}}}, 11, 1, 1, "reader-ack"); }, "recording_busy");
        replay.Read({{"run", 1}, {"since", 1}}, 10.3);
        Check(replay.Start({{"channels", {"v"}}}, 11, 1, 1, "owner-ack")["active"] == true, "only owner/native persistence acknowledges replay");
    }
    Service s; int reads = 0, guarded = 0;
    Ops ops; ops.guard = [&] { ++guarded; }; ops.sample = [&](const std::string&, const std::vector<std::string>&) {
        ++reads; return json{{"valid", true}, {"position", {1, 2, 3}}}; };
    const auto start = s.Start({{"actors", {"a1"}}, {"channels", {"v", "actors", "camera"}}}, 100, 1, 2, "test-session");
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
    {
        // 0.8.17 (Borg 2): the polled UI snapshot is recorded on change plus a heartbeat, not every tick.
        Service ui;
        std::string screen = "still"; int uiReads = 0;
        Ops uiOps; uiOps.guard = [] {};
        uiOps.sample = [&](const std::string& channel, const std::vector<std::string>&) {
            if (channel == "ui") { ++uiReads; return json{{"valid", true}, {"hud", screen}}; }
            return json{{"valid", true}};
        };
        ui.Start({{"channels", {"ui", "v"}}, {"duration_s", 60}}, 1000, 1, 1, "ui-test");
        for (int i = 0; i < 200; ++i) ui.Tick(1000 + i * 0.1, 1, 1, true, i, uiOps); // 20 s of an unchanged screen
        auto first = ui.Read({{"run", 1}}, 1020);
        Check(uiReads == 200, "ui: the snapshot is still read every tick");
        int uiRecords = 0, vRecords = 0, changes = 0;
        for (uint64_t since = 0; since < first["latest"].get<uint64_t>();)
        {
            const auto uiPage = ui.Read({{"run", 1}, {"since", since}}, 1020);
            if (uiPage["records"].empty()) break;
            for (const auto& r : uiPage["records"])
            {
                if (r["channel"] == "ui") { ++uiRecords; changes += r["data"]["reason"] == "change"; }
                else ++vRecords;
            }
            since = uiPage["next"].get<uint64_t>();
        }
        Check(vRecords == 200, "ui: other channels keep their cadence");
        Check(changes == 1 && uiRecords >= 10 && uiRecords <= 12, "ui: a still screen records once plus a heartbeat about every 2 s");
        screen = "changed";
        ui.Tick(1020, 1, 1, true, 201, uiOps);
        const auto latest = ui.Read({{"run", 1}}, 1020)["latest"].get<uint64_t>();
        const auto tail = ui.Read({{"run", 1}, {"since", latest - 2}}, 1020);
        bool sawChange = false;
        for (const auto& r : tail["records"]) sawChange |= r["channel"] == "ui" && r["data"]["reason"] == "change" && r["data"]["hud"] == "changed";
        Check(sawChange, "ui: a changed snapshot is recorded at once");
        // 0.8.17: a stop and a fast restart changes who is recording, so an observer can drop old-run state.
        const auto firstIdentity = ui.Identity("ui");
        Check(!firstIdentity.empty() && ui.Identity("v").empty(), "identity: only an active run's wanted channel has one");
        ui.Stop("test", 1021); ui.Read({{"run", 1}, {"since", ui.Read({{"run", 1}}, 1021)["latest"].get<uint64_t>()}}, 1021);
        Check(ui.Identity("ui").empty(), "identity: none while stopped");
        ui.Start({{"channels", {"ui"}}}, 1022, 1, 1, "ui-test");
        Check(!ui.Identity("ui").empty() && ui.Identity("ui") != firstIdentity, "identity: a restart in the same world is a different run");
        ui.Stop("test", 1023);
        ui.Read({{"run", 2}, {"since", ui.Read({{"run", 2}}, 1023)["latest"].get<uint64_t>()}}, 1023);
        ui.Start({{"channels", {"ui"}}}, 1024, 2, 1, "ui-test");
        Check(ui.Identity("ui").find(".w2.") != std::string::npos, "identity: carries the world generation");
    }
    // Event ingress uses the same run/ring/cap and source QPC, without resampling each line.
    Service taps;
    taps.Start({{"channels", {"subtitles", "voice"}}}, 600, 7, 4, "tap-test");
    Check(taps.Wants("subtitles") && taps.Wants("voice") && !taps.Wants("v"), "selected event channels only");
    Check(taps.Ingress("subtitles", R"({"event":"line.requested","text":"Question?"})", 600.01, 7, 4, 1), "bounded event accepted");
    Check(taps.Ingress("voice", R"({"event":"voice.requested","trigger":"greeting"})", 600.02, 7, 4, 2), "voice request accepted");
    auto events = taps.Read({{"run", 1}}, 600.1);
    Check(events["records"].size() == 2 && events["records"][0]["source_s"] == 600.01 && events["records"][1]["channel"] == "voice", "events in shared sequence with source time");
    {
        // 0.8.18 (Borg 3): the ellipsis and the inverted exclamation mark of a real subtitle come back byte for byte, in the ring's
        // rows and in the wire text the pipe carries.
        Service text; text.Start({{"channels", {"subtitles"}}}, 650, 7, 4, "utf8-test");
        const std::string line = "I need a napâ¦ just a short one. Â¡Pide ayuda! ð";
        Check(text.Ingress("subtitles", json{{"event", "line.delivered"}, {"display_text", line}, {"text", "<kiroshi o=\"Â¡Pide ayuda!\"/>"}}.dump(-1, ' ', false), 650.01, 7, 4, 1), "utf-8 line accepted");
        const auto read = text.Read({{"run", 1}}, 650.1);
        const auto wire = SerializeJson(read);
        Check(read["records"][0]["data"]["display_text"].get<std::string>() == line, "utf-8 line: the row's text is byte for byte");
        Check(wire.find("napâ¦ just") != std::string::npos && wire.find("ï¿½") == std::string::npos, "utf-8 line: the wire text keeps the ellipsis and has no replacement character");
    }
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
    {
        // 0.8.18 (Borg 3): a coverage sample that fails says why in its record (the code and the message), is counted invalid,
        // and a sample that answers valid:false for its own reason is invalid with that reason; a valid one never is.
        Service failBeat; failBeat.Start({{"channels", {"subtitles", "face"}}}, 1100, 8, 4, "hb-test");
        recording::Ops failing;
        failing.guard = [] {};
        failing.sample = [](const std::string& channel, const std::vector<std::string>&) -> json {
            if (channel == "subtitles") throw MethodError("failed", "the script layer answered something that isn't JSON");
            return json{{"event", "face.coverage"}, {"valid", true}};
        };
        for (int i = 0; i < 12; ++i) failBeat.Tick(1100.0 + i * 0.1, 8, 4, true, i, failing);
        int invalidSubtitles = 0, validFace = 0, invalidFace = 0;
        bool saysWhy = false;
        uint64_t since = 0;
        for (int pageNo = 0; pageNo < 6; ++pageNo)
        {
        const auto failPage = failBeat.Read({{"run", 1}, {"since", since}}, 1102);
        since = failPage["next"].get<uint64_t>();
        for (const auto& row : failPage["records"])
        {
            if (row["channel"] == "subtitles" && !row["valid"].get<bool>()) { ++invalidSubtitles; saysWhy = row["data"]["error"] == "failed" && row["data"]["message"].get<std::string>().find("JSON") != std::string::npos; }
            if (row["channel"] == "face") { if (row["valid"].get<bool>()) ++validFace; else ++invalidFace; }
        }
        }
        Check(invalidSubtitles >= 1 && saysWhy && validFace >= 1 && invalidFace == 0, "heartbeat: a failing sample is invalid with its code and message, a good one is never invalid");
    }
    Service contacts;
    const auto contactStart = contacts.Start(json::object(), 1000, 8, 4, "contacts");
    Check(contacts.Wants("contacts"), "contacts enabled in default source selection");
    Check(contacts.Ingress("contacts", R"({"event":"contact.car_hit_player","other_entity":"42","position":[1,2,3]})", 1000.01, 8, 4, 12), "contact callback accepted without sampler tick");
    auto contactPage = contacts.Read({{"run", 1}}, 1000.1);
    Check(contactPage["records"][0]["source_s"] == 1000.01 && contactPage["records"][0]["data"]["other_entity"] == "42", "contact identity and source time preserved");
    contacts.RequestStop("cancelled");
    Check(!contacts.Ingress("contacts", R"({"event":"contact.controller_report"})", 1000.2, 8, 4, 13), "contact callback stops at cancellation");
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
