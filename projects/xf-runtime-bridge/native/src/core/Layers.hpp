#pragma once

// What the native layer has heard from the other layers (redscript, CET, TweakXL data).
// Each layer announces itself through the XFBridge_Announce native; the bridge method
// `layers.status` returns this table, which proves the cross-layer round trip in one query.

#include <map>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Win32.hpp"

namespace xfb
{
class LayerRegistry
{
public:
    void Announce(const std::string& aLayer, const std::string& aDetail)
    {
        std::scoped_lock _(m_mutex);
        auto& entry = m_layers[aLayer];
        entry.detail = aDetail;
        entry.lastSeen = win32::UtcNowIso8601();
        entry.count += 1;
    }

    bool Has(const std::string& aLayer) const
    {
        std::scoped_lock _(m_mutex);
        return m_layers.find(aLayer) != m_layers.end();
    }

    nlohmann::json Snapshot() const
    {
        std::scoped_lock _(m_mutex);
        auto out = nlohmann::json::object();
        for (const auto& [name, entry] : m_layers)
        {
            out[name] = {{"detail", entry.detail}, {"last_seen", entry.lastSeen}, {"count", entry.count}};
        }
        return out;
    }

private:
    struct Entry
    {
        std::string detail;
        std::string lastSeen;
        uint64_t count = 0;
    };
    mutable std::mutex m_mutex;
    std::map<std::string, Entry> m_layers;
};
} // namespace xfb
