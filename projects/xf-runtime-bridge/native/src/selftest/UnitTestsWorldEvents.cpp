#include "core/WorldEvents.hpp"
#include <cstdio>
int WorldEventsUnitTests() {
    using namespace xfb;
    using nlohmann::json;
    int checks = 0, failed = 0;
    const auto check = [&](bool ok, const char* label) { ++checks; if (!ok) { ++failed; std::printf("WORLD FAIL %s\n", label); } };
    worldevents::IncidentReceipt receipt;
    receipt.Set("event-1", "inc-7"); check(receipt.Take("event-1") == "inc-7", "exact accepted death receipt");
    check(receipt.Take("event-1").empty(), "receipt consumed once");
    receipt.Set("event-2", "inc-8"); check(receipt.Take("event-1").empty() && receipt.Take("event-2").empty(), "unmatched callback cannot consume a stale join later");
    receipt.Set("event-3", "inc-9"); receipt.Clear(); check(receipt.Take("event-3").empty(), "rejected incident clears older receipt");
    receipt.Set("reused", "inc-old", 3); check(receipt.Take("reused", 4).empty(), "script counter reuse after a load cannot join an older world's receipt");
    worldevents::Feed feed(4, 2);
    auto row = feed.Push("session", {{"phase", "start"}, {"codeware", true}, {"game_time_s", nullptr}}, 100, 3);
    check(row && (*row)["s"] == 100 && (*row)["world_generation"] == 3 && (*row)["session_counter"] == 1 && (*row)["game_time_s"].is_null(), "early lifecycle native stamps/null clock");
    row = feed.Push("death", {{"victim", "18446744073709551615"}, {"game_time_s", 900}}, 100, 3);
    check(row && (*row)["data"]["victim"].is_string() && (*row)["game_time_s"] == 900, "decimal id and game clock retained");
    check(feed.Push("death", json::object(), 100, 3).has_value(), "second fixed-time admission");
    check(!feed.Push("death", json::object(), 100, 3), "burst rate frozen deterministically");
    check(feed.Push("heat", json::object(), 100, 3).has_value(), "families have separate budgets");
    row = feed.Push("death", json::object(), 101, 3);
    check(row && (*row)["dropped"] == 1 && (*row)["seq"] == 5, "explicit refill carries drops, refused ingress gets no sequence");
    auto page = feed.Read({{"since", 1}, {"limit", 1}, {"kinds", {"heat"}}});
    check(page["missed"] == 1 && page["evicted"] == 1 && page["next"] == 5 && page["events"].size() == 1, "filter/eviction cursor");
    page = feed.Read({{"since", 5}, {"kinds", {"session"}}});
    check(page["events"].empty() && page["next"] == 6, "filtered cursor advances over skipped rows");
    check(feed.Read({{"since", 999}})["next"] == 999, "future cursor never regresses");
    check(!feed.Push("unknown", json::object(), 101, 3) && !feed.Push("call", {{"large", std::string(4096, 'a')}}, 101, 3), "fixed kinds and payload bound");
    feed.NoteDrop("dialogue");
    check(feed.Admit("dialogue", 102), "pre-copy native admission");
    row = feed.Push("dialogue", {{"what", "hubs"}}, 102, 3, true);
    check(row && (*row)["dropped"] == 1, "pre-copy admission consumes one budget and carries omitted copies");
    check(feed.Push("dialogue", json::object(), 102, 3).has_value() && !feed.Admit("dialogue", 102), "pre-copy and direct paths share a single family cap");
    feed.Push("session", {{"phase", "start"}, {"codeware", true}}, 103, 4);
    row = feed.Push("call", {{"game_time_s", "bad"}}, 103, 4);
    check(row && (*row)["session_counter"] == 2 && (*row)["game_time_s"].is_null(), "load epoch increments and invalid game clock becomes null");
    worldevents::Feed fallback;
    fallback.Push("session", {{"phase", "attach"}, {"codeware", false}}, 1, 0);
    check(fallback.Read(json::object())["coverage"]["session_callbacks"] == "script_layer_only", "Codeware-free limitation is explicit");
    worldevents::Feed large;
    for (unsigned i = 0; i < 40; ++i) large.Push("journal", {{"text", std::string(3900, 'a')}}, i, 0);
    page = large.Read(json::object());
    check(page["byte_limited"] == true && SerializeJson(page).size() < 64 * 1024 && page["events"].size() < 40, "wire-safe page cap");
    auto second = large.Read({{"since", page["next"]}});
    check(second["events"][0]["seq"] == page["next"], "byte cap keeps next unread row");
    for (const auto& bad : {json{{"limit", 101}}, json{{"kinds", {"x"}}}, json{{"since", -1}}}) {
        try { feed.Read(bad); check(false, "bad params refused"); } catch (const MethodError& e) { check(e.code == "bad_params", "bad params refused"); }
    }
    std::printf("WORLD EVENTS UNIT: %d checks, %d failures\n", checks, failed); return failed;
}
