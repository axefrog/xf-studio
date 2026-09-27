#pragma once

// The live-posing experiment's pure part (research/animation/pose-editor-design.md §7.4, phase L0):
// the in-memory layout of a loaded animAnimationBufferCompressed's keys, the checks that decide
// whether that layout is the one we expect, the rotation encoding, the carrier contract, and the plan
// that pose.live.apply writes. No game calls: the plugin reads the game's memory into the structures
// below (plugin/LivePoseMemory.cpp), and the self-test host and the unit tests use fakes.
//
// The layout. A compressed buffer's key block is one flat run of records, in this order (WolvenKit's
// animAnimationBufferCompressed.ReadBuffer, the same byte layout the engine keeps in memory, where
// RED4ext.SDK's animAnimationBufferCompressed has one span per run, animKeyFrames.hpp):
//   compressed keys   10 bytes: time u16, header u16, x y z u16 (quantised over [-1, 1])
//   raw keys          16 bytes: time u16, header u16, x y z float32
//   constant keys     16 bytes: header u16, time u16, x y z float32
//   track keys         8 bytes: time u16, track u16, value float32
//   constant tracks    8 bytes: track u16, time u16, value float32
// header: bits 0-12 joint index, bits 13-14 channel (0 translation, 1 rotation, 2 scale), bit 15 the
// rotation's w sign (1 = negative).
//
// The rotation encoding (the same source): a unit quaternion (x, y, z, w) is stored as
// e = (x, y, z) / sqrt(1 + |w|) and the sign of w. Decoding: d = |e|^2 = 1 - |w|, (x, y, z) = e * sqrt(2 - d),
// w = +-(1 - d). The live check decodes with this rule; the Studio's offline decode of the same file
// must agree (the hash below).

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::livepose
{
using json = nlohmann::json;

// The XF carrier (test package only): one clip in one set, attached to V's photo-mode puppet, selected
// through the pose record below. pose.live.apply writes this clip only.
inline constexpr const char* kCarrierSet = "xf\\live_pose\\xfs_live_carrier_female.anims";
inline constexpr const char* kCarrierClip = "xfs_live_carrier";
inline constexpr const char* kCarrierRecord = "PhotoModePoses.xfs_live_carrier";
inline constexpr const char* kCarrierPoseLabel = "XF Live Carrier";
inline constexpr const char* kCarrierCategoryLabel = "XF Live";

enum Channel : uint8_t
{
    Translation = 0,
    Rotation = 1,
    Scale = 2,
};

// One constant key as the engine keeps it (16 bytes).
#pragma pack(push, 1)
struct RawConstKey
{
    uint16_t header;
    uint16_t time;
    float x;
    float y;
    float z;
};
#pragma pack(pop)
static_assert(sizeof(RawConstKey) == 16, "constant keys are 16 bytes");

inline constexpr size_t kCompressedKeyBytes = 10;
inline constexpr size_t kRawKeyBytes = 16;
inline constexpr size_t kConstKeyBytes = 16;
inline constexpr size_t kTrackKeyBytes = 8;
inline constexpr size_t kConstTrackKeyBytes = 8;

uint16_t JointOf(uint16_t aHeader);
uint8_t ChannelOf(uint16_t aHeader);
bool WSignOf(uint16_t aHeader);
uint16_t Header(uint16_t aJoint, uint8_t aChannel, bool aWSign);

// Rotation codec (see above). Decode returns (x, y, z, w). Encode normalises aQ first and keeps w's sign.
std::array<float, 4> DecodeRotation(float aX, float aY, float aZ, bool aWSign);
void EncodeRotation(const std::array<float, 4>& aQ, float& aX, float& aY, float& aZ, bool& aWSign);

// The buffer's counts as the game's reflection reports them (animAnimationBufferCompressed properties).
struct BufferCounts
{
    uint32_t numFrames = 0;
    uint16_t numJoints = 0;
    uint16_t numTracks = 0;
    uint32_t numAnimKeys = 0;    // compressed
    uint32_t numAnimKeysRaw = 0; // raw
    uint32_t numConstAnimKeys = 0;
    uint32_t numTrackKeys = 0;
    uint32_t numConstTrackKeys = 0;
    uint32_t dataBytes = 0; // dataAddress.zeInBytes; 0 = unknown
};

// One span as the engine holds it: [begin, end) addresses (0 when empty).
struct Span
{
    uintptr_t begin = 0;
    uintptr_t end = 0;
};

// The five runs, in memory order.
struct BufferSpans
{
    Span compressed;
    Span raw;
    Span constKeys;
    Span tracks;
    Span constTracks;
};

// Checks that the spans are the key block the counts describe: each non-empty run's size is its count
// times its record size, the runs follow each other with no gap, the whole is dataBytes long when that
// is known, and the constant keys are aligned for reading. Returns every problem found (empty: ok).
std::vector<std::string> CheckSpans(const BufferCounts& aCounts, const BufferSpans& aSpans);

// Checks the constant keys themselves: joint index below numJoints, a known channel, finite values, a
// rotation encoding inside the unit ball, and no joint and channel twice. Returns every problem found.
std::vector<std::string> CheckConstKeys(const BufferCounts& aCounts, const std::vector<RawConstKey>& aKeys);

// The carrier contract on top of that: nothing but constant joint keys (no compressed or raw keys) and
// exactly one constant rotation key for every joint. Returns every problem found.
std::vector<std::string> CheckCarrier(const BufferCounts& aCounts, const std::vector<RawConstKey>& aKeys);

// FNV-1a 64 over each constant key's header and x, y, z bytes (not the time field, which the engine
// may not keep), as 16 hex digits. The carrier build writes the same hash for its planned keys.
std::string KeysHash(const std::vector<RawConstKey>& aKeys);

// The decoded keys for pose.live.read: [{joint, name?, channel, rotation [x,y,z,w] | translation | scale}].
json DescribeKeys(const std::vector<RawConstKey>& aKeys, const std::vector<std::string>& aJointNames);

// pose.live.apply: which joint to set, by index (resolved from a name by the caller) to which rotation.
struct JointRotation
{
    uint16_t joint = 0;
    std::array<float, 4> rotation{0, 0, 0, 1};
};

struct KeyWrite
{
    size_t keyIndex = 0;
    RawConstKey value{};
};

// The writes for these rotations (and the Hips translation, when given and the carrier has a constant
// translation key for aHipsJoint) against the carrier's current keys. Throws MethodError(bad_params)
// for a joint without a constant rotation key, a joint set twice, or a Hips translation without its key.
std::vector<KeyWrite> PlanApply(const std::vector<RawConstKey>& aKeys, const std::vector<JointRotation>& aRotations,
                                const std::optional<std::array<float, 3>>& aHips, int32_t aHipsJoint);
} // namespace xfb::livepose
