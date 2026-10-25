#pragma once
#include <string>

namespace xfb::plugin
{
// RTTI callbacks: CRTTISystem::AddRegisterCallback / AddPostRegisterCallback.
void RegisterTypes();
void PostRegisterTypes();
bool RecordingWanted(const std::string& channel);
std::string RecordingIdentity(const std::string& channel); // the active run's identity while it wants the channel, else empty
bool RecordingIngress(const std::string& channel, const std::string& payload);
} // namespace xfb::plugin
