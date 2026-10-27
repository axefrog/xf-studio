#pragma once
#include "core/InputChoices.hpp"
#include "core/Recording.hpp"
#include "core/WorldEvents.hpp"
#include "core/Supervisor.hpp"
#include "selftest/SimNpc.hpp"
namespace xfb::selftest
{
class SimInput
{
public:
    SimInput(Dispatcher& aDispatcher, SimNpc& aNpc, EventLog& aEvents, bool aHooks,
             std::function<std::string()> aContext, std::function<uint64_t()> aWorld, std::function<bool()> aLive,
             std::function<uint64_t()> aConnection, const Session& aSession);
    void Tick();
private:
    input::Ops Ops();
    input::Service m_service;
    recording::Service m_recording;
    worldevents::Feed m_worldEvents;
    supervisor::Service m_supervisor;
    Dispatcher& m_dispatcher;
    SimNpc& m_npc;
    std::function<std::string()> m_context;
    std::function<uint64_t()> m_world;
    std::function<bool()> m_live;
    std::function<uint64_t()> m_connection;
    bool m_hooks;
    uint64_t m_recordTick = 0;
    uint32_t m_trackedJournal = 0;
    bool m_changed = true, m_modal = true, m_confirmation = false, m_offered = false;
    int m_generation = 100;
};
}
