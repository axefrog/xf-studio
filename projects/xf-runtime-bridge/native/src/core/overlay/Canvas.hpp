#pragma once

// canvas@1: one owner for validation, lifetimes, connections and bounded geometry. No game/ImGui dependencies.
#include "core/overlay/Host.hpp"
#include "core/Events.hpp"
#include "core/KillKey.hpp"
#include <deque>
#include <map>
#include <memory>
#include <set>

namespace xfb { class Dispatcher; }
namespace xfb::canvas
{
using json = nlohmann::json;
using Vec = std::array<double, 3>;
using XY = std::array<double, 2>;
using Clock = std::chrono::steady_clock;
double Now();
enum ViewMask : unsigned { World = 1, Radar = 2 };
struct Camera
{
    Vec position{}, forward{0, 1, 0}, right{1, 0, 0}, up{0, 0, 1};
    Vec player{};
    double yaw = 0, fov = 60, width = 1920, height = 1080;
    bool valid = false;
};
struct RadarView
{
    std::string corner = "bottom_right", orientation = "heading_up";
    double size = 240, range = 50, opacity = 1;
};
struct Anchor
{
    enum Kind { Fixed, Entity, Screen } kind = Fixed;
    Vec point{}, offset{};
    std::string entity;
};
struct Item
{
    std::string id, kind, color = "text", text, style = "plain", glyph, title;
    Anchor anchor;
    unsigned views = World;
    int priority = 5;
    double opacity = 1, width = 1.5, size = 6, pad = 6, corner = 12, fill = 0;
    bool leader = false, plate = false, relative = false, ground = true;
    XY offset{};
    XY dash{};
    std::array<double, 4> rect{};
    std::vector<std::pair<std::string, std::string>> lines;
    // World endpoints are expanded at admission; radar keeps solid world-unit endpoints and expands pixel dashes at draw time.
    std::vector<Vec> worldLines, radarLines, polygon;
    size_t vertices = 0;
};
struct Batch
{
    std::string producer, layer, digest;
    uint64_t world = 0, seq = 0;
    double ttl = 5, expires = 0;
    size_t vertices = 0;
    std::vector<Item> items;
};
size_t SolidVertices(const Item&);
// Structured refusal travels unchanged through both the pipe and Lua routes.
struct Refusal : std::runtime_error
{
    json detail;
    explicit Refusal(json data) : std::runtime_error(data.dump()), detail(std::move(data)) {}
};
std::string Canonical(const json& value);
std::string Digest(const json& value);
json ParseJson(const std::string& raw);
Batch Parse(const std::string& raw, const RadarView& radar, bool cet = false);
bool Project(const Camera&, const Vec&, XY& out); // near plane and viewport culling
bool ProjectSegment(const Camera&, Vec a, Vec b, XY& outA, XY& outB);
Vec WorldVertex(const Item&, const Camera&, Vec point, const Vec& anchor);
std::vector<XY> ProjectPolygon(const Camera&, const std::vector<Vec>&);
bool ClipSegment(XY& a, XY& b, double width, double height);
XY RadarPoint(const Camera&, const RadarView&, const Vec&); // local radar pixels, centre at size / 2
struct RadarDashes {
    std::array<XY,128> points{};
    size_t count = 0;
    size_t size() const { return count; }
    const XY& operator[](size_t i) const { return points[i]; }
};
// budget is additional vertices after reserving every source segment's two solid endpoints.
RadarDashes RadarSegments(XY a, XY b, XY dash, size_t& budget, size_t& downgraded, double phase = 0);
const char* TextToken(const Item&); // plate text is always --text; colour tints the edge
bool KnownGlyph(const std::string&);
struct GlyphPath { bool fill, closed; double alpha; std::vector<XY> points; };
struct Glyph { std::string name; size_t vertices; std::vector<GlyphPath> paths; };
const Glyph* FindGlyph(const std::string&);

struct EntityPosition { std::string id; std::optional<Vec> position; };
struct AnchorState
{
    Vec position{};
    double last = -1, attempted = -1, expectedRefresh = .1;
    enum State { Resolved, Holding, Lost } state = Lost;
    double opacity = 0;
};
AnchorState AnchorAt(AnchorState, double now);
struct LayerFrame { std::shared_ptr<const Batch> batch; };
struct Frame
{
    Camera camera;
    RadarView radar;
    std::vector<LayerFrame> layers;
    std::map<std::string, AnchorState> anchors;
    bool visible = false, worldMarkers = false;
    uint64_t generation = 0;
    double at = 0;
};
struct Costs
{
    std::array<double, 256> samples{};
    size_t count = 0, next = 0;
    double last = 0, max = 0;
    void Add(double ms);
    json State() const;
};
// One writer per clock (game or render), read from any pipe. Telemetry never loses a sample because publication was busy.
class AtomicCosts
{
public:
    void Add(double ms) {
        const auto next=m_total.load(); m_samples[next % m_samples.size()].store(ms);
        m_last.store(ms);m_max.store(std::max(m_max.load(),ms));m_total.store(next+1);
    }
    json State(bool active) const;
private:
    std::array<std::atomic<double>,256> m_samples{};
    std::atomic<size_t> m_total{0};
    std::atomic<double> m_last{0},m_max{0};
};
class Service
{
public:
    explicit Service(EventLog* events = nullptr) : m_events(events) {}
    void Configure(bool enabled, killkey::Chord toggle, killkey::Chord mode, uint32_t anchorHz = 10, uint32_t anchorsPerRead = 16);
    void SetStateFile(std::filesystem::path path);
    json Feed(uint64_t connection, const std::string& raw, double now = Now(), bool cet = false);
    json Clear(uint64_t connection, const json&, double now = Now(), bool cet = false);
    json View(const json&);
    json State(double now = Now());
    void Disconnect(uint64_t connection);
    void SetWorld(uint64_t world);
    void Stop(); // kill/shutdown: invalidates all published frames immediately
    void Toggle();
    void Mode();
    bool Visible() const { return m_visible.load() && m_enabled.load(); }
    uint64_t Generation() const { return m_generation.load(); }
    std::pair<killkey::Chord, killkey::Chord> Keys() const;
    std::optional<std::pair<killkey::Chord, killkey::Chord>> TryKeys() const {
        std::unique_lock lock(m_mutex,std::try_to_lock);
        if (!lock.owns_lock()) return {};
        return std::make_pair(m_toggle,m_mode);
    }
    json SetKeys(const json&); // bare key only, persisted by plugin adapter
    // Paced entity reads: no catch-up bursts; oldest attempted first with producer-interleaved ties.
    // Both read adapters and publication use try-locks; game calls always happen outside the lock.
    std::vector<std::string> Wanted(double now = Now());
    void Resolve(const std::vector<EntityPosition>&, double now, double anchorMs, std::optional<uint64_t> expected = {});
    void Publish(const Camera&, double now, double cameraMs, std::optional<uint64_t> expected = {});
    // Single render consumer; returns the newest frame, no mutex. Validate generation before using it.
    const Frame& Take() { m_frames.Take(); return m_frames.Front(); }
    void RenderCost(double ms) { m_render.Add(ms); }
    void RadarDowngraded(size_t count) { m_radarDowngraded.store(count); }
private:
    struct Layer { uint64_t seq = 0; bool hasSeq = false; std::shared_ptr<const Batch> batch; json refused; std::deque<double> rate; };
    struct Producer { uint64_t connection = 0; std::map<std::string, Layer> layers; std::deque<double> rate; double refusedAt = -1e9; };
    void Expire(double now);
    void Reset();
    void VisibilityEvent(bool resend);
    json Refuse(const std::string&, const std::string&, const json&, double now);
    mutable std::mutex m_mutex;
    std::mutex m_viewMutex; // serialize persistent view changes, never touched by game publication or rendering
    std::atomic<bool> m_enabled{false}, m_visible{false};
    std::atomic<uint64_t> m_generation{0};
    std::atomic<uint64_t> m_admission{0};
    std::atomic<size_t> m_radarDowngraded{0};
    std::atomic<uint64_t> m_knownWorld{0};
    uint64_t m_world = 0;
    bool m_worldMarkers = false;
    RadarView m_radar;
    killkey::Chord m_toggle, m_mode;
    std::filesystem::path m_stateFile;
    std::map<std::string, Producer> m_producers;
    std::map<std::string, AnchorState> m_anchors;
    std::map<std::pair<std::string,std::string>,json> m_refusals;
    std::map<std::string,double> m_refusalTimes;
    uint32_t m_anchorHz = 10, m_anchorsPerRead = 16;
    double m_nextAnchorRead = -1, m_anchorRefresh = .1;
    std::array<std::atomic<double>,32> m_anchorReadTimes{};
    std::atomic<size_t> m_anchorReadCount{0};
    Costs m_parse;
    AtomicCosts m_camera,m_anchor,m_publication,m_render;
    EventLog* m_events;
    overlay::TripleBuffer<Frame> m_frames;
};
void RegisterMethods(Dispatcher&, Service&);
} // namespace xfb::canvas
