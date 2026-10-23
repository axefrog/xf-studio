#pragma once

// 0.8.9 (the Sol review of 0.8.9, finding 3): which views have drawn each XF pin (world.pin's drawn_by). The mappin
// controllers that report it run on the UI's worker threads, several at once, so the bits live here and are OR-ed under
// one lock (XFBridge_PinDrawn); the script layer only reads the answer and logs outside it. Bookkeeping only: no game call.

#include <cstdint>
#include <mutex>
#include <unordered_map>

namespace xfb
{
class PinViews
{
public:
    // ORs aBits into pin aPin's set and answers the set before (so a caller learns whether its bit is new). aBits 0 reads.
    uint32_t Or(int32_t aPin, uint32_t aBits)
    {
        std::scoped_lock _(m_mutex);
        if (m_bits.size() >= kMaxPins && m_bits.find(aPin) == m_bits.end())
        {
            m_bits.clear(); // pins come and go with world.pin and the session; a runaway count starts again
        }
        auto& bits = m_bits[aPin];
        const uint32_t before = bits;
        bits |= aBits;
        return before;
    }

    // A pin made again under a used id (a new session restarts the ids) starts with no views.
    void Reset(int32_t aPin)
    {
        std::scoped_lock _(m_mutex);
        m_bits.erase(aPin);
    }

    static constexpr size_t kMaxPins = 1024;

private:
    std::mutex m_mutex;
    std::unordered_map<int32_t, uint32_t> m_bits;
};
} // namespace xfb
