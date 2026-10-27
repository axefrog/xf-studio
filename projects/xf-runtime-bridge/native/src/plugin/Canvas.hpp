#pragma once
#include <nlohmann/json.hpp>
namespace xfb { class Dispatcher; }
namespace xfb::plugin
{
void RegisterCanvas(Dispatcher&);
void TickCanvas(bool ready);
nlohmann::json CanvasLua(const std::string& module, const std::string& action, const std::string& payload);
}
