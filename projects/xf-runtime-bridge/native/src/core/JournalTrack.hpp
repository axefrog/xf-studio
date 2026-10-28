#pragma once
#include "core/Dispatcher.hpp"
namespace xfb::journal {
struct Entry { uint32_t hash = 0; std::string path; };
using Track = std::function<nlohmann::json(const Entry&, const std::string& cid)>;
// Shared validation and act admission; the adapter alone touches JournalManager.
void RegisterTrack(Dispatcher&, bool enabled, Track);
}
