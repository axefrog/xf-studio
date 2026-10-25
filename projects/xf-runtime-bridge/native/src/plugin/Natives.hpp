#pragma once
#include <string>

#include <nlohmann/json.hpp>

namespace xfb::plugin
{
// RTTI callbacks: CRTTISystem::AddRegisterCallback / AddPostRegisterCallback.
void RegisterTypes();
void PostRegisterTypes();
bool RecordingWanted(const std::string& channel);
std::string RecordingIdentity(const std::string& channel); // the active run's identity while it wants the channel, else empty
bool RecordingIngress(const std::string& channel, const std::string& payload);
// 0.8.20 (HandlersIncidents.cpp): the incident taps' observations and ticks (XFBridge_IncidentSeen), whether the taps are on
// (XFBridge_ProbeFlags bit 16), and the recorder's incidents-channel coverage sample.
bool IncidentSeen(const std::string& payload);
bool IncidentAdmit(const std::string& evidence, const std::string& key);
bool IncidentTapOn();
// 0.8.21: the actors (a1,a2) the sight sampler should look at now, or nothing.
std::string IncidentSightPlan();
nlohmann::json IncidentCoverage();
} // namespace xfb::plugin
