#pragma once
#include "core/Dispatcher.hpp"
namespace xfb::plugin
{
void RegisterSupervisor(Dispatcher&);
void TickSupervisor(bool ready);
void CancelSupervisor(const std::string& reason);
void StopSupervisor(); // unload: joins worker before dispatcher destruction
bool SupervisorWanted(const std::string& channel);
void SupervisorIngress(const std::string& channel, const nlohmann::json& event);
// Read-only, executing-frame ownership and position adapters, implemented by their owners.
nlohmann::json SupervisorNpcs();
nlohmann::json SupervisorProps();
}
