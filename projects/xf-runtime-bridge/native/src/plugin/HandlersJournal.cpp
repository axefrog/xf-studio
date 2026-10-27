#include <RED4ext/RED4ext.hpp>
#include "core/JournalTrack.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"
namespace xfb::plugin {
void RegisterJournalTrack(Dispatcher& d) {
    bool enabled = false;
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    enabled = Get().config.allowTestHooks;
#endif
    journal::RegisterTrack(d, enabled, [](const journal::Entry& entry, const std::string& cid) {
        Get().restore.MarkWrite();
        uint32_t hash = entry.hash;
        RED4ext::CString path(entry.path.c_str());
        return ScriptCall("XFJournalTest", "Track", {"Uint32", "String"}, {&hash, &path}, cid);
    });
}
}
