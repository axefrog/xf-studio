#pragma once
#include <string>
#include <nlohmann/json.hpp>
namespace xfb::plugin
{
// [source] Contract diagnostics for 2.31; [hypothesis] dispatch remains uncommissioned.
// Every entry fails closed until receiver ownership, overlap and neutralisation are proved.
nlohmann::json InputDispatchStatus();
void DispatchInput(const std::string& aControl, const std::string& aKind, float aValue);
bool PhysicalInputHeld(const std::string& aControl);
}
