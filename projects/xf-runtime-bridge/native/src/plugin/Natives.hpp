#pragma once
#include <string>

namespace xfb::plugin
{
// RTTI callbacks: CRTTISystem::AddRegisterCallback / AddPostRegisterCallback.
void RegisterTypes();
void PostRegisterTypes();
bool RecordingWanted(const std::string& channel);
bool RecordingIngress(const std::string& channel, const std::string& payload);
} // namespace xfb::plugin
