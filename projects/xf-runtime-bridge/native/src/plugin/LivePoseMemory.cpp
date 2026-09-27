#include "plugin/LivePoseMemory.hpp"

#include <Windows.h>

#include <atomic>
#include <cstddef>
#include <cstring>
#include <mutex>
#include <optional>
#include <vector>

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Detail/AddressHashes.hpp>
#include <RED4ext/ResourceLoader.hpp>
#include <RED4ext/Scripting/Natives/Generated/anim/AnimSetEntry.hpp>
#include <RED4ext/Scripting/Natives/Generated/anim/Animation.hpp>
#include <RED4ext/Scripting/Natives/Generated/anim/IAnimationBuffer.hpp>
#include <RED4ext/Scripting/Natives/animAnimSet.hpp>
#include <RED4ext/Scripting/Natives/animRig.hpp>

#include "core/Dispatcher.hpp"
#include "core/LivePose.hpp"
#include "core/Log.hpp"
#include "core/ScriptFrame.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin::live
{
namespace
{
using json = nlohmann::json;
namespace lp = xfb::livepose;

std::atomic<bool> gAvailable{false};

// animAnimationBufferCompressed as RED4ext.SDK (tag 1.0.0) lays it out. The SDK's own header can't be
// included at that tag (it names AnimBufferState.hpp and AnimKeyFrames.hpp, which ship as
// animAnimBufferState.hpp and animKeyFrames.hpp), so the fields read here are declared again, at the
// same offsets; the reflection-backed ones are checked against the game on every call (kFields).
struct CompressedBufferView
{
    uint8_t unk00[0x44];               // 00 ISerializable, fallbackFrameIndices, duration
    uint32_t numFrames;                // 44
    uint8_t numExtraJoints;            // 48
    uint8_t numExtraTracks;            // 49
    bool isScaleConstant;              // 4A
    bool hasRawRotations;              // 4B
    uint16_t numJoints;                // 4C
    uint16_t numTracks;                // 4E
    uint32_t numAnimKeysCompressed;    // 50
    uint32_t numAnimKeysRaw;           // 54
    uint32_t numConstAnimKeys;         // 58
    uint32_t numTrackKeys;             // 5C
    uint32_t numConstTrackKeys;        // 60
    uint32_t dataUnkIndex;             // 64 dataAddress
    uint32_t dataOffset;               // 68
    uint32_t dataBytes;                // 6C
    uint8_t unk70[0x110 - 0x70];       // 70 deferred and in-place buffers, extraDataNames
    uintptr_t compressed[2];           // 110 Span<KeyFrameCompressed>
    uintptr_t raw[2];                  // 120 Span<KeyFrameRaw>
    uintptr_t constKeys[2];            // 130 Span<KeyFrameConst>
    uintptr_t tracks[2];               // 140 Span<TrackKey>
    uintptr_t constTracks[2];          // 150 Span<TrackKeyConst>
    uint8_t stateUnk[0x1C];            // 160 AnimBufferState: token, job, requests
    uint8_t state;                     // 17C AnimBufferState::state
    uint8_t unk17D[0x188 - 0x17D];     // 17D
};
static_assert(sizeof(CompressedBufferView) == 0x188, "animAnimationBufferCompressed is 0x188 bytes at SDK 1.0.0");
static_assert(offsetof(CompressedBufferView, numFrames) == 0x44);
static_assert(offsetof(CompressedBufferView, numJoints) == 0x4C);
static_assert(offsetof(CompressedBufferView, numAnimKeysCompressed) == 0x50);
static_assert(offsetof(CompressedBufferView, numConstTrackKeys) == 0x60);
static_assert(offsetof(CompressedBufferView, dataBytes) == 0x6C);
static_assert(offsetof(CompressedBufferView, constKeys) == 0x130);
static_assert(offsetof(CompressedBufferView, state) == 0x17C);

// The carrier's original keys, taken before the first write into a buffer.
struct Snapshot
{
    uintptr_t buffer = 0;
    std::vector<lp::RawConstKey> keys;
};
std::mutex gSnapshotMutex;
std::optional<Snapshot> gSnapshot;

// Field offsets from RED4ext.SDK (tag 1.0.0) that the reads below use, checked against the game's own
// reflection data on every call: a patch that moves one refuses instead of reading the wrong memory.
struct Field
{
    const char* cls;
    const char* property;
    uint32_t offset;
};
constexpr Field kFields[] = {
    {"animAnimSet", "animations", 0x40},
    {"animAnimSet", "rig", 0x130},
    {"animAnimSetEntry", "animation", 0x30},
    {"animAnimation", "animBuffer", 0x58},
    {"animAnimation", "name", 0x90},
    {"animAnimationBufferCompressed", "numFrames", 0x44},
    {"animAnimationBufferCompressed", "numJoints", 0x4C},
    {"animAnimationBufferCompressed", "numTracks", 0x4E},
    {"animAnimationBufferCompressed", "numAnimKeys", 0x50},
    {"animAnimationBufferCompressed", "numAnimKeysRaw", 0x54},
    {"animAnimationBufferCompressed", "numConstAnimKeys", 0x58},
    {"animAnimationBufferCompressed", "numTrackKeys", 0x5C},
    {"animAnimationBufferCompressed", "numConstTrackKeys", 0x60},
    {"animAnimationBufferCompressed", "dataAddress", 0x64},
    {"animAnimationBufferCompressed", "extraDataNames", 0xF0},
    {"animRig", "boneNames", 0x50},
};
struct ClassSize
{
    const char* cls;
    uint32_t size;
};
constexpr ClassSize kSizes[] = {{"animAnimationBufferCompressed", 0x188}, {"animAnimSet", 0x1F0}, {"animRig", 0x180}};

std::vector<std::string> CheckFields()
{
    std::vector<std::string> problems;
    auto* rtti = RED4ext::CRTTISystem::Get();
    for (const auto& field : kFields)
    {
        auto* cls = rtti->GetClass(field.cls);
        auto* property = cls ? cls->GetProperty(field.property) : nullptr;
        if (!property)
        {
            problems.push_back(std::string(field.cls) + "." + field.property + " isn't in the game's reflection data");
        }
        else if (property->valueOffset != field.offset)
        {
            problems.push_back(std::string(field.cls) + "." + field.property + " is at offset " +
                               std::to_string(property->valueOffset) + ", the bridge expects " + std::to_string(field.offset));
        }
    }
    for (const auto& size : kSizes)
    {
        auto* cls = rtti->GetClass(size.cls);
        if (!cls || cls->GetSize() != size.size)
        {
            problems.push_back(std::string(size.cls) + " is " + (cls ? std::to_string(cls->GetSize()) : "missing") +
                               " bytes, the bridge expects " + std::to_string(size.size));
        }
    }
    return problems;
}

std::string Join(const std::vector<std::string>& aItems)
{
    std::string out;
    for (const auto& item : aItems)
    {
        out += (out.empty() ? "" : "; ") + item;
    }
    return out;
}

std::string NameText(const RED4ext::CName& aName)
{
    const auto* text = aName.ToString();
    return text ? text : "";
}

bool IsA(RED4ext::ISerializable* aObject, const char* aClass)
{
    auto* cls = RED4ext::CRTTISystem::Get()->GetClass(aClass);
    auto* type = aObject ? aObject->GetType() : nullptr;
    return cls && type && type->IsA(cls);
}

// What Locate found: the set, the clip, and a copy of its keys and counts.
struct Located
{
    CompressedBufferView* buffer = nullptr;
    uint32_t clipIndex = 0;
    uint32_t clips = 0;
    lp::BufferCounts counts;
    lp::BufferSpans spans;
    std::vector<lp::RawConstKey> keys;
    std::vector<std::string> jointNames; // empty when the rig isn't readable
    std::string rigNote;
    std::vector<std::string> problems; // layout problems (empty: the layout is the expected one)
    uint8_t dataState = 0;
};

lp::Span SpanOf(const uintptr_t (&aSpan)[2])
{
    return {aSpan[0], aSpan[1]};
}

// Finds aClip in the loaded set aSetPath and reads what the checks need. Throws MethodError when it
// can't be found or read; layout problems are returned in Located::problems for the caller to judge.
Located Locate(const std::string& aSetPath, const std::string& aClip)
{
    if (!gAvailable.load())
    {
        throw MethodError("live_pose_unavailable",
                          "an engine address the live-pose commands need is missing from this game version's address "
                          "library, so they are off this session");
    }
    if (const auto problems = CheckFields(); !problems.empty())
    {
        throw MethodError("layout_unrecognised", "the game's animation data isn't laid out as the bridge expects: " + Join(problems));
    }
    auto* loader = RED4ext::ResourceLoader::Get();
    if (!loader)
    {
        throw MethodError("game_not_ready", "the game's resource loader isn't ready");
    }
    const auto token = loader->FindToken<RED4ext::CResource>(RED4ext::ResourcePath(aSetPath.c_str()));
    if (!token || !token.GetPtr())
    {
        throw MethodError("carrier_not_loaded", "the animation set " + aSetPath +
                                                    " isn't loaded (photo mode not open, or its package isn't installed)");
    }
    if (!token->IsLoaded())
    {
        throw MethodError("carrier_not_loaded", "the animation set " + aSetPath + " is still loading (or failed to load)");
    }
    auto* resource = token->resource.GetPtr();
    if (!resource || !IsA(resource, "animAnimSet"))
    {
        throw MethodError("layout_unrecognised", aSetPath + " didn't load as an animation set");
    }
    auto* set = reinterpret_cast<RED4ext::anim::AnimSet*>(resource);

    Located out;
    out.clips = set->animations.size;
    const RED4ext::CName wanted(aClip.c_str());
    RED4ext::anim::Animation* animation = nullptr;
    for (uint32_t i = 0; i < set->animations.size; ++i)
    {
        auto* entry = set->animations[i].GetPtr();
        auto* candidate = entry ? entry->animation.GetPtr() : nullptr;
        if (candidate && candidate->name == wanted)
        {
            animation = candidate;
            out.clipIndex = i;
            break;
        }
    }
    if (!animation)
    {
        throw MethodError("clip_not_found", "the set " + aSetPath + " has " + std::to_string(out.clips) +
                                                " clips, none named " + aClip);
    }
    auto* buffer = animation->animBuffer.GetPtr();
    if (!buffer || !IsA(buffer, "animAnimationBufferCompressed"))
    {
        throw MethodError("layout_unrecognised", "the clip " + aClip + " doesn't use the compressed buffer the bridge reads");
    }
    auto* compressed = reinterpret_cast<CompressedBufferView*>(buffer);
    out.buffer = compressed;
    out.counts.numFrames = compressed->numFrames;
    out.counts.numJoints = compressed->numJoints;
    out.counts.numTracks = compressed->numTracks;
    out.counts.numAnimKeys = compressed->numAnimKeysCompressed;
    out.counts.numAnimKeysRaw = compressed->numAnimKeysRaw;
    out.counts.numConstAnimKeys = compressed->numConstAnimKeys;
    out.counts.numTrackKeys = compressed->numTrackKeys;
    out.counts.numConstTrackKeys = compressed->numConstTrackKeys;
    out.counts.dataBytes = compressed->dataBytes;
    out.dataState = compressed->state;
    out.spans.compressed = SpanOf(compressed->compressed);
    out.spans.raw = SpanOf(compressed->raw);
    out.spans.constKeys = SpanOf(compressed->constKeys);
    out.spans.tracks = SpanOf(compressed->tracks);
    out.spans.constTracks = SpanOf(compressed->constTracks);

    out.problems = lp::CheckSpans(out.counts, out.spans);
    if (out.problems.empty() && out.counts.numConstAnimKeys > 0)
    {
        out.keys.resize(out.counts.numConstAnimKeys);
        std::memcpy(out.keys.data(), reinterpret_cast<const void*>(out.spans.constKeys.begin),
                    out.keys.size() * sizeof(lp::RawConstKey));
        const auto keyProblems = lp::CheckConstKeys(out.counts, out.keys);
        out.problems.insert(out.problems.end(), keyProblems.begin(), keyProblems.end());
    }

    // The rig's joint names, when the set's rig is loaded (a read only; nothing is loaded here).
    auto& rig = set->rig;
    auto* rigToken = rig.token.GetPtr();
    if (rigToken && rigToken->IsLoaded() && rigToken->resource.GetPtr() && IsA(rigToken->resource.GetPtr(), "animRig"))
    {
        auto* rigResource = reinterpret_cast<RED4ext::anim::Rig*>(rigToken->resource.GetPtr());
        for (uint32_t i = 0; i < rigResource->boneNames.size && i < 512; ++i)
        {
            out.jointNames.push_back(NameText(rigResource->boneNames[i]));
        }
    }
    else
    {
        out.rigNote = "the set's rig isn't loaded, so joints are given by index";
    }
    return out;
}

const char* DataStateName(uint8_t aState)
{
    switch (aState)
    {
    case 0:
        return "empty";
    case 1:
        return "loading";
    case 2:
        return "ready";
    case 3:
        return "external";
    default:
        return "unknown";
    }
}

json Describe(const Located& aLocated, const std::string& aSet, const std::string& aClip)
{
    json out{{"found", true},
             {"set", aSet},
             {"clip", aClip},
             {"clip_index", aLocated.clipIndex},
             {"clips", aLocated.clips},
             {"buffer",
              {{"num_frames", aLocated.counts.numFrames},
               {"num_joints", aLocated.counts.numJoints},
               {"num_tracks", aLocated.counts.numTracks},
               {"num_anim_keys", aLocated.counts.numAnimKeys},
               {"num_anim_keys_raw", aLocated.counts.numAnimKeysRaw},
               {"num_const_anim_keys", aLocated.counts.numConstAnimKeys},
               {"num_track_keys", aLocated.counts.numTrackKeys},
               {"num_const_track_keys", aLocated.counts.numConstTrackKeys},
               {"data_bytes", aLocated.counts.dataBytes},
               {"data_state", DataStateName(aLocated.dataState)}}},
             {"spans",
              {{"compressed", aLocated.spans.compressed.end - aLocated.spans.compressed.begin},
               {"raw", aLocated.spans.raw.end - aLocated.spans.raw.begin},
               {"const", aLocated.spans.constKeys.end - aLocated.spans.constKeys.begin},
               {"tracks", aLocated.spans.tracks.end - aLocated.spans.tracks.begin},
               {"const_tracks", aLocated.spans.constTracks.end - aLocated.spans.constTracks.begin},
               {"const_non_null", aLocated.spans.constKeys.begin != 0}}}};
    if (!aLocated.rigNote.empty())
    {
        out["rig_note"] = aLocated.rigNote;
    }
    return out;
}

std::optional<uint16_t> JointIndex(const std::string& aName, const std::vector<std::string>& aNames, uint16_t aJoints)
{
    if (!aName.empty() && aName.find_first_not_of("0123456789") == std::string::npos && aName.size() <= 5)
    {
        const auto index = std::stoul(aName);
        return index < aJoints ? std::optional<uint16_t>(static_cast<uint16_t>(index)) : std::nullopt;
    }
    for (size_t i = 0; i < aNames.size() && i < aJoints; ++i)
    {
        if (aNames[i] == aName)
        {
            return static_cast<uint16_t>(i);
        }
    }
    return std::nullopt;
}

void WriteKeys(const Located& aLocated, const std::vector<lp::KeyWrite>& aWrites)
{
    auto* keys = reinterpret_cast<lp::RawConstKey*>(aLocated.spans.constKeys.begin);
    for (const auto& write : aWrites)
    {
        std::memcpy(&keys[write.keyIndex], &write.value, sizeof(lp::RawConstKey));
    }
}

// The carrier, found and checked in full; throws unless it passes every check.
Located LocateCarrier()
{
    auto located = Locate(lp::kCarrierSet, lp::kCarrierClip);
    if (!located.problems.empty())
    {
        throw MethodError("layout_unrecognised", "the carrier's keys aren't laid out as the bridge expects, so nothing was "
                                                 "written: " + Join(located.problems));
    }
    if (const auto contract = lp::CheckCarrier(located.counts, located.keys); !contract.empty())
    {
        throw MethodError("layout_unrecognised", "the carrier clip doesn't meet the carrier contract, so nothing was written: " +
                                                     Join(contract));
    }
    return located;
}
} // namespace

bool ResolveAddresses()
{
    // Everything the loader lookup reaches through RED4ext.SDK: the loader itself, its token lookup, and
    // what releasing a token copy may call (the weak-reference release, the token's destructor parts and
    // the engine allocator's free).
    namespace hashes = RED4ext::Detail::AddressHashes;
    const std::vector<script::Address> addresses{
        {"ResourceLoader", hashes::ResourceLoader},
        {"ResourceLoader_FindTokenFast", hashes::ResourceLoader_FindTokenFast},
        {"Handle_DecWeakRef", hashes::Handle_DecWeakRef},
        {"ResourceToken_CancelUnk38", hashes::ResourceToken_CancelUnk38},
        {"ResourceToken_DestructUnk38", hashes::ResourceToken_DestructUnk38},
        {"Memory_Vault", hashes::Memory_Vault},
        {"Memory_Vault_Free", hashes::Memory_Vault_Free},
        {"Memory_Vault_Unk1", hashes::Memory_Vault_Unk1},
    };
    using Resolve_t = uintptr_t (*)(uint32_t);
    Resolve_t resolve = nullptr;
    if (const auto red4ext = GetModuleHandleW(L"RED4ext.dll"))
    {
        resolve = reinterpret_cast<Resolve_t>(GetProcAddress(red4ext, "RED4ext_ResolveAddress"));
    }
    std::vector<uintptr_t> resolved;
    const auto missing = script::MissingAddresses(
        addresses, [resolve](uint32_t aHash) -> uintptr_t { return resolve ? resolve(aHash) : 0; }, resolved);
    if (!resolve || !missing.empty())
    {
        std::string names;
        for (const auto& name : missing)
        {
            names += (names.empty() ? "" : ",") + name;
        }
        log::Warn("live_pose.addresses_missing", "missing=" + names + " live_pose=off");
        gAvailable.store(false);
        return false;
    }
    gAvailable.store(true);
    log::Info("live_pose.addresses_resolved", "count=" + std::to_string(resolved.size()) + " live_pose=on");
    return true;
}

bool Available()
{
    return gAvailable.load();
}

bool HasSnapshot()
{
    std::scoped_lock _(gSnapshotMutex);
    return gSnapshot.has_value();
}

json Read(const params::PoseLiveReadRequest& aRequest, const std::string& aCid)
{
    const auto located = Locate(aRequest.set, aRequest.clip);
    auto out = Describe(located, aRequest.set, aRequest.clip);
    if (!located.problems.empty())
    {
        // Stop at the first mismatch: nothing is decoded from a layout the bridge doesn't recognise.
        log::Warn("live_pose.layout_unrecognised", "set=" + aRequest.set + " clip=" + aRequest.clip + " problems=" +
                                                       std::to_string(located.problems.size()),
                  aCid);
        throw MethodError("layout_unrecognised",
                          "the clip's keys aren't laid out as the bridge expects (stop here, and keep the answer): " +
                              Join(located.problems));
    }
    out["layout"] = "ok";
    out["keys_hash"] = lp::KeysHash(located.keys);
    out["keys"] = lp::DescribeKeys(located.keys, located.jointNames);
    if (!located.jointNames.empty())
    {
        out["joint_names"] = located.jointNames;
    }
    const auto contract = lp::CheckCarrier(located.counts, located.keys);
    out["carrier_contract"] = contract.empty() ? json("ok") : json(contract);
    if (!aRequest.expectHash.empty())
    {
        out["expect_hash"] = aRequest.expectHash;
        out["matches_offline"] = aRequest.expectHash == out["keys_hash"].get<std::string>();
    }
    {
        std::scoped_lock _(gSnapshotMutex);
        out["bridge_wrote"] = gSnapshot.has_value() && gSnapshot->buffer == reinterpret_cast<uintptr_t>(located.buffer);
    }
    log::Info("live_pose.read", "set=" + aRequest.set + " clip=" + aRequest.clip + " keys=" +
                                    std::to_string(located.keys.size()) + " hash=" + out["keys_hash"].get<std::string>(),
              aCid);
    return out;
}

json Apply(const params::PoseLiveApplyRequest& aRequest, const std::string& aCid)
{
    if (aRequest.restore)
    {
        return Restore(aCid, false);
    }
    const auto located = LocateCarrier();
    std::vector<lp::JointRotation> rotations;
    json names = json::array();
    for (const auto& [name, rotation] : aRequest.joints)
    {
        const auto index = JointIndex(name, located.jointNames, located.counts.numJoints);
        if (!index)
        {
            throw MethodError("bad_params", located.jointNames.empty()
                                                ? "joint '" + name + "' can't be looked up (the rig isn't readable); give joint indices"
                                                : "the carrier's rig has no joint named '" + name + "'");
        }
        rotations.push_back({*index, rotation});
        names.push_back(name);
    }
    int32_t hips = -1;
    if (aRequest.hips)
    {
        const auto index = JointIndex("Hips", located.jointNames, located.counts.numJoints);
        if (!index)
        {
            throw MethodError("bad_params", "the carrier's rig has no joint named Hips (or it isn't readable)");
        }
        hips = *index;
    }
    const auto writes = lp::PlanApply(located.keys, rotations, aRequest.hips, hips);
    const auto address = reinterpret_cast<uintptr_t>(located.buffer);
    {
        std::scoped_lock _(gSnapshotMutex);
        if (!gSnapshot || gSnapshot->buffer != address || gSnapshot->keys.size() != located.keys.size())
        {
            gSnapshot = Snapshot{address, located.keys};
        }
    }
    WriteKeys(located, writes);
    auto after = located.keys;
    for (const auto& write : writes)
    {
        after[write.keyIndex] = write.value;
    }
    const auto hash = lp::KeysHash(after);
    log::Info("live_pose.applied", "keys=" + std::to_string(writes.size()) + " hash=" + hash + " tick=" +
                                       std::to_string(Get().runningTicks.load()),
              aCid);
    return json{{"applied", writes.size()},
                {"joints", names},
                {"hips", aRequest.hips.has_value()},
                {"keys_hash", hash},
                {"tick", Get().runningTicks.load()},
                {"undo", {{"method", "pose.live.apply"}, {"params", {{"restore", true}}}}},
                {"undo_note", "puts the carrier's own keys back (the kill switch does too); leaving photo mode unloads the "
                              "carrier, which then loads with its own keys again"}};
}

json Restore(const std::string& aCid, bool aQuiet)
{
    std::optional<Snapshot> snapshot;
    {
        std::scoped_lock _(gSnapshotMutex);
        snapshot.swap(gSnapshot);
    }
    if (!snapshot)
    {
        return json{{"restored", false}, {"note", "the bridge hasn't changed the carrier since it last put it back"},
                    {"undo", nullptr}};
    }
    try
    {
        const auto located = LocateCarrier();
        if (reinterpret_cast<uintptr_t>(located.buffer) != snapshot->buffer || located.keys.size() != snapshot->keys.size())
        {
            log::Info("live_pose.restore_skipped", "reason=reloaded", aCid);
            return json{{"restored", false},
                        {"note", "the carrier was loaded again since the bridge wrote it, so it has its own keys already"},
                        {"undo", nullptr}};
        }
        std::vector<lp::KeyWrite> writes;
        for (size_t i = 0; i < snapshot->keys.size(); ++i)
        {
            writes.push_back({i, snapshot->keys[i]});
        }
        WriteKeys(located, writes);
        log::Info("live_pose.restored", "keys=" + std::to_string(writes.size()) + " hash=" + lp::KeysHash(snapshot->keys), aCid);
        return json{{"restored", true}, {"keys", writes.size()}, {"keys_hash", lp::KeysHash(snapshot->keys)}, {"undo", nullptr}};
    }
    catch (const MethodError& e)
    {
        if (!aQuiet && e.code != "carrier_not_loaded")
        {
            throw;
        }
        log::Info("live_pose.restore_skipped", std::string("reason=") + e.code, aCid);
        return json{{"restored", false},
                    {"note", std::string("the carrier isn't loaded any more (") + e.what() + "), so nothing needs putting back"},
                    {"undo", nullptr}};
    }
}
} // namespace xfb::plugin::live
