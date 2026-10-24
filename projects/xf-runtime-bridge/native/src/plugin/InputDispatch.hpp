#pragma once
#include <nlohmann/json.hpp>
namespace xfb::plugin
{
// Read-only diagnostics. No speculative receiver/vtable call is made.
nlohmann::json InputDispatchStatus();
}
