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
