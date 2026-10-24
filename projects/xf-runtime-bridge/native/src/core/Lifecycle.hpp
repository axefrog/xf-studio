#pragma once
#include "core/Dispatcher.hpp"

namespace xfb::lifecycle
{
// Copied on the native ink callback thread. No engine pointer crosses this boundary.
struct Snapshot
{
    uint64_t atMs = 0, generation = 0, thread = 0;
    bool observed = false, complete = false, engagementVisible = false, engagementKnown = false;
    unsigned initialCount = 0;
    bool loadingReady = false, animationReady = false, subscribed = false;
    bool panelResolved = false, panelVisible = false, consumed = false, automatic = false;
};
inline nlohmann::json Describe(const Snapshot& s, uint64_t now)
{
    const bool fresh = s.observed && now >= s.atMs && now - s.atMs <= 500;
    std::string state = "unknown", reason = "observer_unavailable_or_stale";
    if (fresh && s.complete) {
        if (s.initialCount > 1 || (s.initialCount && s.engagementVisible)) reason = "ambiguous_controllers";
        else if (s.initialCount == 1) {
            if (s.consumed || s.automatic) { state = "continuing"; reason = "initial_skip_consumed_or_automatic"; }
            else if (!s.loadingReady || !s.animationReady) { state = "loading"; reason = "initial_readiness_gates"; }
            else if (s.subscribed && s.panelResolved && s.panelVisible) { state = "initial_continue"; reason = "initial_controller_offer_observed"; }
            else reason = "initial_panel_or_subscription_unresolved";
        } else if (s.engagementVisible) { state = "start_screen"; reason = "engagement_menu_observed_gsm_acceptance_unknown"; }
        else if (s.engagementKnown) { state = "none"; reason = "no_prompt_in_observed_ui_scope"; }
        else reason = "engagement_observer_not_seeded";
    } else if (fresh) reason = "ui_snapshot_truncated_or_unresolved";
    return {{"prompt_state", state}, {"prompt_observed", state != "unknown"}, {"waiting_for_input", state == "initial_continue" || state == "start_screen"},
        {"generation", s.generation}, {"age_ms", s.observed && now >= s.atMs ? nlohmann::json(now - s.atMs) : nlohmann::json()},
        {"fresh", fresh}, {"complete", s.complete}, {"reason", reason}, {"ui_thread", s.thread},
        {"engagement_visible", s.engagementVisible}, {"engagement_scope_observed", s.engagementKnown}, {"gsm_phase", nullptr}, {"start_phase", nullptr}, {"start_accepting", nullptr},
        {"initial_controllers", s.initialCount}, {"loading_ready", s.loadingReady}, {"animation_ready", s.animationReady},
        {"skip_subscribed", s.subscribed}, {"skip_panel_resolved", s.panelResolved}, {"skip_panel_visible", s.panelVisible},
        {"skip_consumed", s.consumed}, {"automatic", s.automatic}, {"continue_available", false}, {"commissioned", false}, {"pixel_proof", false}};
}
inline nlohmann::json Probe(const nlohmann::json& observed)
{
    const auto state = observed.value("prompt_state", std::string("unknown"));
    nlohmann::json target = nullptr;
    if (state == "initial_continue") target = {{"action", "UI_Skip"}, {"consumer_rva", "0xff2bdc"}};
    if (state == "start_screen") target = {{"action", "Start"}, {"consumer_rva", "0x62b000"}};
    return {{"observed", observed}, {"would_call", target}, {"called", false}, {"execution_frame", false},
        {"route_available", false}, {"admissible", false}, {"preconditions_complete", false}, {"reason", "read_only_plan; consumer event ABI, current owner and execution-thread lifetime uncommissioned"},
        {"game_quit", "not_implemented; shutdown/save-flush ordering unresolved"}};
}
}
