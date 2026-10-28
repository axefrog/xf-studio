#include "core/JournalTrack.hpp"
#include "core/Params.hpp"
namespace xfb::journal {
void RegisterTrack(Dispatcher& d, bool enabled, Track track) {
    d.Register({"test.journal.track", Access::ActPlayer, RunOn::GameThread, "Test-only: track an existing active journal quest entry.",
        [enabled, track](const MethodContext& c) {
            if (!enabled) throw MethodError("test_hooks_off", "Journal tracking needs the autonomous build and allow_test_hooks.");
            params::RequireOnly(c.params, {"entry"});
            Entry entry;
            const auto value = c.params.find("entry");
            if (value == c.params.end() || value->is_null()) params::CheckFail("entry is an existing quest/objective path or Uint32 journal hash");
            if (value->is_string()) {
                entry.path = params::CheckText(c.params, "entry", 256).value_or("");
                if (entry.path.empty()) params::CheckFail("entry path cannot be empty");
                for (unsigned char ch : entry.path) if (ch < 32 || ch == 127) params::CheckFail("entry path cannot contain control characters");
            } else {
                entry.hash = static_cast<uint32_t>(params::CheckInteger(c.params, "entry", 0, UINT32_MAX).value_or(0));
            }
            return track(entry, c.cid);
        }});
}
}
