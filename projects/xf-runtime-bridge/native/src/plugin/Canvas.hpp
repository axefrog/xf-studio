#pragma once
#include <nlohmann/json.hpp>
namespace xfb { class Dispatcher; }
namespace xfb::plugin
{
nlohmann::json RecordingSnapshot(double,uint64_t);
nlohmann::json IncidentsSnapshot(uint64_t,double);
nlohmann::json SupervisorSnapshot(uint64_t);
void RegisterCanvas(Dispatcher&);
void TickCanvas(bool ready);
nlohmann::json CanvasLua(const std::string& module, const std::string& action, const std::string& payload);
}
