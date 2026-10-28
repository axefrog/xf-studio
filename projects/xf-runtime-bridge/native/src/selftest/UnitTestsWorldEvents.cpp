#include "core/WorldEvents.hpp"
#include <cstdio>
#include <future>
#include <thread>
int WorldEventsUnitTests() {
    using namespace xfb;
    using nlohmann::json;
    int checks = 0, failed = 0;
    const auto check = [&](bool ok, const char* label) { ++checks; if (!ok) { ++failed; std::printf("WORLD FAIL %s\n", label); } };
    const auto push = [](worldevents::Feed& target, const std::string& kind, json data, double source, uint64_t world, bool admitted = false) {
        const auto epoch = target.CaptureEpoch(kind, data, [world] { return world; });
        return target.Push(kind, std::move(data), source, epoch, admitted);
    };
    {
        worldevents::Feed families(100, 1);
        for (const auto& kind : worldevents::Kinds) {
            const auto kept = push(families, kind, {{"fixture", true}}, 1, 7);
            check(kept && (*kept)["kind"] == kind && (*kept)["world_generation"] == 7, "each family is admitted and stamped");
            check(!push(families, kind, json::object(), 1, 7), "each family has an independent rate cap");
            const auto refill = push(families, kind, json::object(), 2, 7);
            check(refill && (*refill)["dropped"] == 1, "each family carries its own rate loss on refill");
        }
        check(families.Read({{"kinds", {"district", "vehicle", "vehicle.acquired", "time"}}})["events"].size() == 8, "second-cut filter retains all four families");
    }
    {
        worldevents::ClockJumps clock;
        const auto sample = [&](double s, double game, worldevents::Epoch epoch = {7, 2}, uint64_t run = 1) {
            return clock.Observe({{"valid", true}, {"game_time_s", game}}, s, epoch, run);
        };
        check(!sample(1, 1000), "first recorder sample only establishes a clock baseline");
        check(!sample(2, 1008) && !sample(3, 1008), "normal accelerated time and pause are not skips");
        auto jump = sample(4, 22608);
        check(jump && (*jump)["what"] == "jump" && (*jump)["delta_game_s"] == 21600 && (*jump)["elapsed_real_s"] == 1 &&
              (*jump)["inferred"] == true && (*jump)["cause"] == "unknown", "large forward jump retains explicit inference and sample deltas");
        jump = sample(5, 19008);
        check(jump && (*jump)["delta_game_s"] == -3600, "backward game-time skip is signed");
        check(!sample(6, 19308), "small or threshold-equal changes do not assert a skip");
        check(!sample(16, 19908), "threshold scales with real elapsed time");
        check(!sample(47, 40000), "long sampling gaps rebaseline rather than invent coverage");
        check(!sample(48, 100, {8, 2}) && !sample(49, 30000, {8, 3}) && !sample(50, 100, {8, 3}, 2), "world, session and recorder restart each reset the baseline");
        check(!sample(51, 200, {8, 3}, 2) && !clock.Observe(nlohmann::json(), 52, {8, 3}, 2) && !sample(53, 50000, {8, 3}, 2),
              "a failed sample (the plugin passes null when the script call throws) breaks continuity: no jump across it");
        check(!sample(50, 30000, {8, 3}, 2) && !sample(49, 100, {8, 3}, 2), "equal or backward source clocks rebaseline");
        for (const auto& bad : {json(), json{{"valid", false}, {"game_time_s", 30000}}, json{{"valid", true}, {"game_time_s", nullptr}},
                                json{{"valid", true}, {"game_time_s", "30000"}}, json{{"valid", true}, {"game_time_s", -1}}}) {
            check(!clock.Observe(bad, 51, {8, 3}, 2) && !sample(52, 1000, {8, 3}, 2), "missing or invalid samples break clock continuity");
        }
        check(!sample(53, 1000, {8, 3}, 0) && !sample(54, 1000, {8, 3}, 2), "inactive recorder identity breaks continuity");
        jump = sample(55, 5000, {8, 3}, 2);
        worldevents::Feed sink;
        const auto row = jump ? sink.Push("time", *jump, 55, {8, 3}) : std::nullopt;
        check(row && (*row)["game_time_s"] == 5000 && (*row)["world_generation"] == 8 && (*row)["session_counter"] == 3 &&
              (*row)["data"]["previous_game_time_s"] == 1000, "inferred jumps use the same bounded feed envelope and immutable epoch");
    }
    // Hold an old ingress after its epoch capture, and insert a new-world Start before releasing it.
    // No sleeps or probabilistic races: both scheduling edges are controlled, with finite deadlines.
    {
        worldevents::Feed concurrent;
        std::atomic<uint64_t> world{3};
        const auto readWorld = [&] { return world.load(); };
        const json start{{"phase", "start"}, {"codeware", true}};
        auto epoch = concurrent.CaptureEpoch("session", start, readWorld);
        concurrent.Push("session", start, 10, epoch);
        std::promise<void> captured, release;
        auto capturedFuture = captured.get_future(), releaseFuture = release.get_future();
        std::optional<json> oldRow;
        bool releasedInTime = false;
        std::thread oldProducer([&] {
            const auto oldEpoch = concurrent.CaptureEpoch("death", json::object(), readWorld);
            captured.set_value();
            releasedInTime = releaseFuture.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
            oldRow = concurrent.Push("death", json::object(), 10.1, oldEpoch);
        });
        const bool capturedInTime = capturedFuture.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
        world = 4;
        epoch = concurrent.CaptureEpoch("session", start, readWorld);
        auto newRow = concurrent.Push("session", start, 11, epoch);
        release.set_value(); oldProducer.join();
        check(capturedInTime && releasedInTime && oldRow && newRow && (*oldRow)["world_generation"] == 3 && (*oldRow)["session_counter"] == 1 &&
              (*newRow)["world_generation"] == 4 && (*newRow)["session_counter"] == 2 && (*oldRow)["seq"] > (*newRow)["seq"],
              "controlled concurrent load: old ingress retains its coherent world/session epoch through later insertion");
        // A dropped Start still advances the epoch independently of ring admission.
        epoch = concurrent.CaptureEpoch("session", start, readWorld);
        epoch = concurrent.CaptureEpoch("death", json::object(), readWorld);
        check(epoch.world == 4 && epoch.session == 3, "lifecycle bookkeeping survives an omitted ring insertion");
    }
    worldevents::IncidentReceipt receipt;
    receipt.Set("event-1", "inc-7"); check(receipt.Take("event-1") == "inc-7", "exact accepted death receipt");
    check(receipt.Take("event-1").empty(), "receipt consumed once");
    receipt.Set("event-2", "inc-8"); check(receipt.Take("event-1").empty() && receipt.Take("event-2").empty(), "unmatched callback cannot consume a stale join later");
    receipt.Set("event-3", "inc-9"); receipt.Clear(); check(receipt.Take("event-3").empty(), "rejected incident clears older receipt");
    receipt.Set("reused", "inc-old", 3); check(receipt.Take("reused", 4).empty(), "script counter reuse after a load cannot join an older world's receipt");
    worldevents::Feed feed(4, 2);
    auto row = push(feed, "session", {{"phase", "start"}, {"codeware", true}, {"game_time_s", nullptr}}, 100, 3);
    check(row && (*row)["s"] == 100 && (*row)["world_generation"] == 3 && (*row)["session_counter"] == 1 && (*row)["game_time_s"].is_null(), "early lifecycle native stamps/null clock");
    row = push(feed, "death", {{"victim", "18446744073709551615"}, {"game_time_s", 900}}, 100, 3);
    check(row && (*row)["data"]["victim"].is_string() && (*row)["game_time_s"] == 900, "decimal id and game clock retained");
    check(push(feed, "death", json::object(), 100, 3).has_value(), "second fixed-time admission");
    check(!push(feed, "death", json::object(), 100, 3), "burst rate frozen deterministically");
    check(push(feed, "heat", json::object(), 100, 3).has_value(), "families have separate budgets");
    row = push(feed, "death", json::object(), 101, 3);
    check(row && (*row)["dropped"] == 1 && (*row)["seq"] == 5, "explicit refill carries drops, refused ingress gets no sequence");
    auto page = feed.Read({{"since", 1}, {"limit", 1}, {"kinds", {"heat"}}});
    check(page["missed"] == 1 && page["evicted"] == 1 && page["next"] == 5 && page["events"].size() == 1, "filter/eviction cursor");
    page = feed.Read({{"since", 5}, {"kinds", {"session"}}});
    check(page["events"].empty() && page["next"] == 6, "filtered cursor advances over skipped rows");
    check(feed.Read({{"since", 999}})["next"] == 999, "future cursor never regresses");
    check(!push(feed, "unknown", json::object(), 101, 3) && !push(feed, "call", {{"large", std::string(4096, 'a')}}, 101, 3), "fixed kinds and payload bound");
    feed.NoteDrop("dialogue");
    check(feed.Admit("dialogue", 102), "pre-copy native admission");
    row = push(feed, "dialogue", {{"what", "hubs"}}, 102, 3, true);
    check(row && (*row)["dropped"] == 1, "pre-copy admission consumes one budget and carries omitted copies");
    check(push(feed, "dialogue", json::object(), 102, 3).has_value() && !feed.Admit("dialogue", 102), "pre-copy and direct paths share a single family cap");
    push(feed, "session", {{"phase", "start"}, {"codeware", true}}, 103, 4);
    row = push(feed, "call", {{"game_time_s", "bad"}}, 103, 4);
    check(row && (*row)["session_counter"] == 2 && (*row)["game_time_s"].is_null(), "load epoch increments and invalid game clock becomes null");
    worldevents::Feed fallback;
    push(fallback, "session", {{"phase", "attach"}, {"codeware", false}}, 1, 0);
    check(fallback.Read(json::object())["coverage"]["session_callbacks"] == "script_layer_only", "Codeware-free limitation is explicit");
    worldevents::Feed large;
    for (unsigned i = 0; i < 40; ++i) push(large, "journal", {{"text", std::string(3900, 'a')}}, i, 0);
    page = large.Read(json::object());
    check(page["byte_limited"] == true && SerializeJson(page).size() < 64 * 1024 && page["events"].size() < 40, "wire-safe page cap");
    auto second = large.Read({{"since", page["next"]}});
    check(second["events"][0]["seq"] == page["next"], "byte cap keeps next unread row");
    for (const auto& bad : {json{{"limit", 101}}, json{{"kinds", {"x"}}}, json{{"since", -1}}}) {
        try { feed.Read(bad); check(false, "bad params refused"); } catch (const MethodError& e) { check(e.code == "bad_params", "bad params refused"); }
    }
    std::printf("WORLD EVENTS UNIT: %d checks, %d failures\n", checks, failed); return failed;
}
