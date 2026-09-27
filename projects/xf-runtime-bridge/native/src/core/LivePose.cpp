#include "core/LivePose.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <set>
#include <utility>

#include "core/Dispatcher.hpp"

namespace xfb::livepose
{
namespace
{
constexpr float kUnitBallSlack = 1.0e-3f;

std::string Hex(uintptr_t aValue)
{
    char text[32];
    std::snprintf(text, sizeof(text), "0x%llx", static_cast<unsigned long long>(aValue));
    return text;
}

bool Finite(float aValue)
{
    return std::isfinite(aValue);
}

const char* ChannelName(uint8_t aChannel)
{
    switch (aChannel)
    {
    case Translation:
        return "translation";
    case Rotation:
        return "rotation";
    case Scale:
        return "scale";
    default:
        return "unknown";
    }
}
} // namespace

uint16_t JointOf(uint16_t aHeader)
{
    return static_cast<uint16_t>(aHeader & 0x1FFF);
}

uint8_t ChannelOf(uint16_t aHeader)
{
    return static_cast<uint8_t>((aHeader & 0x6000) >> 13);
}

bool WSignOf(uint16_t aHeader)
{
    return (aHeader & 0x8000) != 0;
}

uint16_t Header(uint16_t aJoint, uint8_t aChannel, bool aWSign)
{
    return static_cast<uint16_t>((aJoint & 0x1FFF) | ((aChannel & 0x3) << 13) | (aWSign ? 0x8000 : 0));
}

std::array<float, 4> DecodeRotation(float aX, float aY, float aZ, bool aWSign)
{
    const float d = aX * aX + aY * aY + aZ * aZ;
    const float scale = std::sqrt(std::max(0.0f, 2.0f - d));
    float w = 1.0f - d;
    if (aWSign)
    {
        w = -w;
    }
    return {aX * scale, aY * scale, aZ * scale, w};
}

void EncodeRotation(const std::array<float, 4>& aQ, float& aX, float& aY, float& aZ, bool& aWSign)
{
    const double length =
        std::sqrt(double(aQ[0]) * aQ[0] + double(aQ[1]) * aQ[1] + double(aQ[2]) * aQ[2] + double(aQ[3]) * aQ[3]);
    const double x = aQ[0] / length;
    const double y = aQ[1] / length;
    const double z = aQ[2] / length;
    const double w = aQ[3] / length;
    aWSign = w < 0.0;
    const double divisor = std::sqrt(1.0 + std::fabs(w));
    aX = static_cast<float>(x / divisor);
    aY = static_cast<float>(y / divisor);
    aZ = static_cast<float>(z / divisor);
}

std::vector<std::string> CheckSpans(const BufferCounts& aCounts, const BufferSpans& aSpans)
{
    std::vector<std::string> problems;
    struct Run
    {
        const char* name;
        Span span;
        uint64_t count;
        size_t bytes;
    };
    const Run runs[] = {{"compressed keys", aSpans.compressed, aCounts.numAnimKeys, kCompressedKeyBytes},
                        {"raw keys", aSpans.raw, aCounts.numAnimKeysRaw, kRawKeyBytes},
                        {"constant keys", aSpans.constKeys, aCounts.numConstAnimKeys, kConstKeyBytes},
                        {"track keys", aSpans.tracks, aCounts.numTrackKeys, kTrackKeyBytes},
                        {"constant track keys", aSpans.constTracks, aCounts.numConstTrackKeys, kConstTrackKeyBytes}};
    uintptr_t previousEnd = 0;
    const char* previousName = nullptr;
    uint64_t total = 0;
    for (const auto& run : runs)
    {
        const uint64_t expected = run.count * run.bytes;
        total += expected;
        if (run.count == 0)
        {
            if (run.span.begin != run.span.end)
            {
                problems.push_back(std::string(run.name) + ": the count is 0 but the span holds " +
                                   std::to_string(run.span.end - run.span.begin) + " bytes");
            }
            continue;
        }
        if (run.span.begin == 0 || run.span.end < run.span.begin)
        {
            problems.push_back(std::string(run.name) + ": " + std::to_string(run.count) +
                               " expected, but the span is empty or reversed");
            continue;
        }
        const uint64_t size = run.span.end - run.span.begin;
        if (size != expected)
        {
            problems.push_back(std::string(run.name) + ": the span holds " + std::to_string(size) + " bytes, " +
                               std::to_string(run.count) + " keys of " + std::to_string(run.bytes) + " bytes need " +
                               std::to_string(expected));
        }
        if (previousName && run.span.begin != previousEnd)
        {
            problems.push_back(std::string(run.name) + " start at " + Hex(run.span.begin) + ", not where the " +
                               previousName + " end (" + Hex(previousEnd) + ")");
        }
        previousEnd = run.span.end;
        previousName = run.name;
    }
    if (aCounts.numConstAnimKeys > 0 && (aSpans.constKeys.begin % 2) != 0)
    {
        problems.push_back("the constant keys aren't 2-byte aligned (" + Hex(aSpans.constKeys.begin) + ")");
    }
    if (aCounts.dataBytes != 0 && total != aCounts.dataBytes)
    {
        problems.push_back("the counts add up to " + std::to_string(total) + " bytes, the buffer's data address says " +
                           std::to_string(aCounts.dataBytes));
    }
    return problems;
}

std::vector<std::string> CheckConstKeys(const BufferCounts& aCounts, const std::vector<RawConstKey>& aKeys)
{
    std::vector<std::string> problems;
    std::set<std::pair<uint16_t, uint8_t>> seen;
    for (size_t i = 0; i < aKeys.size(); ++i)
    {
        const auto& key = aKeys[i];
        const auto joint = JointOf(key.header);
        const auto channel = ChannelOf(key.header);
        const auto where = "constant key " + std::to_string(i) + " (joint " + std::to_string(joint) + ")";
        if (joint >= aCounts.numJoints)
        {
            problems.push_back(where + ": the joint index is not below " + std::to_string(aCounts.numJoints));
        }
        if (channel > Scale)
        {
            problems.push_back(where + ": unknown channel " + std::to_string(channel));
        }
        if (!Finite(key.x) || !Finite(key.y) || !Finite(key.z))
        {
            problems.push_back(where + ": a value isn't a finite number");
        }
        else if (channel == Rotation && key.x * key.x + key.y * key.y + key.z * key.z > 1.0f + kUnitBallSlack)
        {
            problems.push_back(where + ": the rotation's encoding is outside the unit ball");
        }
        if (!seen.insert({joint, channel}).second)
        {
            problems.push_back(where + ": joint and channel appear twice");
        }
        if (problems.size() > 16)
        {
            problems.push_back("... (stopped after 16 problems)");
            break;
        }
    }
    return problems;
}

std::vector<std::string> CheckCarrier(const BufferCounts& aCounts, const std::vector<RawConstKey>& aKeys)
{
    std::vector<std::string> problems;
    if (aCounts.numAnimKeys != 0 || aCounts.numAnimKeysRaw != 0)
    {
        problems.push_back("the carrier must hold only constant joint keys, but it has " +
                           std::to_string(aCounts.numAnimKeys) + " compressed and " + std::to_string(aCounts.numAnimKeysRaw) +
                           " raw keys");
    }
    if (aCounts.numJoints == 0)
    {
        problems.push_back("the carrier has no joints");
    }
    std::vector<int> rotations(aCounts.numJoints, 0);
    for (const auto& key : aKeys)
    {
        const auto joint = JointOf(key.header);
        if (ChannelOf(key.header) == Rotation && joint < rotations.size())
        {
            ++rotations[joint];
        }
    }
    std::string missing;
    int missingCount = 0;
    for (size_t joint = 0; joint < rotations.size(); ++joint)
    {
        if (rotations[joint] != 1)
        {
            ++missingCount;
            if (missingCount <= 8)
            {
                missing += (missing.empty() ? "" : ", ") + std::to_string(joint);
            }
        }
    }
    if (missingCount > 0)
    {
        problems.push_back(std::to_string(missingCount) + " joints don't have exactly one constant rotation key (" + missing +
                           (missingCount > 8 ? ", ..." : "") + ")");
    }
    return problems;
}

std::string KeysHash(const std::vector<RawConstKey>& aKeys)
{
    uint64_t hash = 0xcbf29ce484222325ull;
    const auto feed = [&hash](const void* aData, size_t aSize) {
        const auto* bytes = static_cast<const uint8_t*>(aData);
        for (size_t i = 0; i < aSize; ++i)
        {
            hash ^= bytes[i];
            hash *= 0x100000001b3ull;
        }
    };
    for (const auto& key : aKeys)
    {
        feed(&key.header, sizeof(key.header));
        feed(&key.x, sizeof(key.x));
        feed(&key.y, sizeof(key.y));
        feed(&key.z, sizeof(key.z));
    }
    char text[17];
    std::snprintf(text, sizeof(text), "%016llx", static_cast<unsigned long long>(hash));
    return text;
}

json DescribeKeys(const std::vector<RawConstKey>& aKeys, const std::vector<std::string>& aJointNames)
{
    json out = json::array();
    for (const auto& key : aKeys)
    {
        const auto joint = JointOf(key.header);
        const auto channel = ChannelOf(key.header);
        json item{{"joint", joint}, {"channel", ChannelName(channel)}};
        if (joint < aJointNames.size())
        {
            item["name"] = aJointNames[joint];
        }
        if (channel == Rotation)
        {
            const auto q = DecodeRotation(key.x, key.y, key.z, WSignOf(key.header));
            item["rotation"] = {q[0], q[1], q[2], q[3]};
        }
        else
        {
            item[channel == Translation ? "translation" : "scale"] = {key.x, key.y, key.z};
        }
        out.push_back(std::move(item));
    }
    return out;
}

std::vector<KeyWrite> PlanApply(const std::vector<RawConstKey>& aKeys, const std::vector<JointRotation>& aRotations,
                                const std::optional<std::array<float, 3>>& aHips, int32_t aHipsJoint)
{
    const auto find = [&aKeys](uint16_t aJoint, uint8_t aChannel) -> std::optional<size_t> {
        for (size_t i = 0; i < aKeys.size(); ++i)
        {
            if (JointOf(aKeys[i].header) == aJoint && ChannelOf(aKeys[i].header) == aChannel)
            {
                return i;
            }
        }
        return std::nullopt;
    };
    std::vector<KeyWrite> writes;
    std::set<uint16_t> joints;
    for (const auto& rotation : aRotations)
    {
        if (!joints.insert(rotation.joint).second)
        {
            throw MethodError("bad_params", "joint " + std::to_string(rotation.joint) + " is given twice");
        }
        const auto index = find(rotation.joint, Rotation);
        if (!index)
        {
            throw MethodError("bad_params", "the carrier has no constant rotation key for joint " + std::to_string(rotation.joint));
        }
        KeyWrite write{*index, aKeys[*index]};
        bool wSign = false;
        EncodeRotation(rotation.rotation, write.value.x, write.value.y, write.value.z, wSign);
        write.value.header = Header(rotation.joint, Rotation, wSign);
        writes.push_back(write);
    }
    if (aHips)
    {
        const auto index = aHipsJoint >= 0 ? find(static_cast<uint16_t>(aHipsJoint), Translation) : std::nullopt;
        if (!index)
        {
            throw MethodError("bad_params", "the carrier has no constant translation key for the Hips joint");
        }
        KeyWrite write{*index, aKeys[*index]};
        write.value.x = (*aHips)[0];
        write.value.y = (*aHips)[1];
        write.value.z = (*aHips)[2];
        writes.push_back(write);
    }
    return writes;
}
} // namespace xfb::livepose
