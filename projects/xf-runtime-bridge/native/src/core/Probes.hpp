#pragma once

// Bridge 0.8.7: three test probes for session 15, behind [bridge] allow_test_hooks (only the -writes package sets it, and only
// that package stages their redscript and the companion executable). They come out, or move into XF Lab, when XF Core's tracks
// C1 to C3 land (research/runtime/runtime-bridge-design.md §3.15).
//
//  * The game-events probe's ring (test.events): the log-only hooks of knowledge/game-events.md §12 write here through
//    XFBridge_Event, apart from the session's 1,000-entry ring, so a firefight can't evict an answer. A per-kind rate guard
//    drops what goes over and counts it.
//  * The companion probe (test.companion.probe): launches the bundled xfb_companion_probe.exe under companion@1's containment
//    (XF Core architecture §7.6): created suspended in a job (kill-on-close, one process, a memory cap, UI limits), its
//    inheritable handles named, checked in the job before it resumes, a fixed command line, no shell. It answers whether it
//    sees MO2's virtual files and its own job's limits (XF Core's O4).
// No game headers here: the self-test runs both.

#include <cstdint>
#include <deque>
#include <filesystem>
#include <map>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

namespace xfb::probes
{
// A probe event's kind: 1 to 40 of a-z, 0-9, '_', '.', ':' and '/'.
bool KindOk(const std::string& aKind);

class ProbeRing
{
public:
    explicit ProbeRing(size_t aCapacity = 512, int aPerKindPerSecond = 20);

    // One record, stamped with the ring's sequence and aNowMs (steady milliseconds). Over its kind's rate in this second it
    // is dropped and counted; the kind's next record carries the count (dropped_before). Answers whether it was kept.
    bool Push(const std::string& aKind, nlohmann::json aData, int64_t aNowMs);
    // {events: [{seq, t_ms, kind, data}], next, latest, evicted, dropped: {kind: n}} from aSince on, at most aLimit (1-500).
    nlohmann::json Read(uint64_t aSince, size_t aLimit) const;
    size_t Size() const;

private:
    struct Entry
    {
        uint64_t seq = 0;
        int64_t tMs = 0;
        std::string kind;
        nlohmann::json data;
    };
    mutable std::mutex m_mutex;
    std::deque<Entry> m_entries;
    size_t m_capacity;
    int m_rate;
    uint64_t m_next = 1;
    uint64_t m_evicted = 0;
    std::map<std::string, std::pair<int64_t, int>> m_window; // kind -> (second, records in it)
    std::map<std::string, uint64_t> m_dropped;               // kind -> total dropped
    std::map<std::string, uint64_t> m_pendingDrops;          // kind -> dropped since its last kept record
};

// test.companion.probe's modes.
struct CompanionRequest
{
    std::string mode = "probe"; // probe (report and exit), sleep (stay until the job ends), stop (end the sleeping one)
    int seconds = 600;          // sleep only, 1 to 3600
    uint32_t memoryMb = 64;     // the job's memory cap, 16 to 1024
};
CompanionRequest ParseCompanion(const nlohmann::json& aParams);

// Launches aExe (absolute, inside the plugin's folder) with a fixed command line under the job, as described above. probe
// waits up to aWaitMs for its report; sleep returns once it runs and keeps its job (kill-on-close: the job's last handle
// closing, at game exit or a crash, ends it); stop closes a kept job. aSeeFile and aSeeDir are what the child is asked to
// look for (a file from the game's archive/pc/mod folder, and that folder), which the plugin found itself.
nlohmann::json RunCompanion(const CompanionRequest& aRequest, const std::filesystem::path& aExe, const std::filesystem::path& aSeeFile,
                            const std::filesystem::path& aSeeDir, int aWaitMs);
} // namespace xfb::probes
